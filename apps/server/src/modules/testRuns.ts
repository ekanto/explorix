import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { toCsv } from '../lib/csv.js';
import { config } from '../config.js';
import { loadRunExport, markdownZip, renderRunDocx } from '../reporting/runExport.js';
import { keys, nextNumber, paging } from '../lib/util.js';
import { emitEvent } from '../lib/webhooks.js';
import { assertProjectMembers, requireRole } from '../middleware/access.js';

/** Mounted at project root: /test-plans and /test-runs. */
export const testRunsRouter = Router({ mergeParams: true });

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const planBody = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(10_000).nullish(), milestoneId: z.string().nullish(), status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']).optional() });

async function checkMilestone(req: Request, id?: string | null) {
  if (id && !(await prisma.milestone.findFirst({ where: { id, projectId: req.project!.id } }))) throw badRequest('Unknown milestone');
}

testRunsRouter.get('/test-plans', async (req, res) => {
  const plans = await prisma.testPlan.findMany({
    where: { projectId: req.project!.id, status: req.query.status ? (String(req.query.status) as 'ACTIVE') : { not: 'ARCHIVED' } },
    orderBy: { createdAt: 'desc' },
    include: { milestone: { select: { id: true, name: true } }, runs: { select: { id: true, number: true, name: true, status: true } } },
  });
  const progress = await runProgress(plans.flatMap((p) => p.runs.map((r) => r.id)));
  res.json({
    plans: plans.map((p) => {
      const agg = p.runs.reduce((a, r) => { const x = progress.get(r.id)!; a.total += x.total; a.done += x.done; a.passed += x.passed; a.failed += x.failed; return a; }, { total: 0, done: 0, passed: 0, failed: 0 });
      return { ...p, runs: p.runs.map((r) => ({ ...r, key: keys.testRun(r.number), progress: progress.get(r.id) })), progress: agg };
    }),
  });
});

testRunsRouter.post('/test-plans', requireRole('LEAD'), async (req, res) => {
  const b = parse(planBody, req.body);
  await checkMilestone(req, b.milestoneId);
  const plan = await prisma.testPlan.create({ data: { ...b, projectId: req.project!.id } });
  await audit(prisma, req, { projectId: plan.projectId, entityType: 'test_plan', entityId: plan.id, action: 'created', changes: { name: plan.name } });
  res.status(201).json({ plan });
});

testRunsRouter.patch('/test-plans/:id', requireRole('LEAD'), async (req, res) => {
  const p = await prisma.testPlan.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!p) throw notFound('Test plan');
  const b = parse(planBody.partial(), req.body);
  await checkMilestone(req, b.milestoneId);
  const plan = await prisma.testPlan.update({ where: { id: p.id }, data: b });
  await audit(prisma, req, { projectId: p.projectId, entityType: 'test_plan', entityId: p.id, action: 'updated', changes: b });
  res.json({ plan });
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/** Progress per run, based on each item's latest status category. */
export async function runProgress(runIds: string[]) {
  const items = await prisma.testRunItem.findMany({ where: { runId: { in: runIds } }, select: { runId: true, status: { select: { category: true } } } });
  const map = new Map(runIds.map((id) => [id, { total: 0, done: 0, passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0, untested: 0 }]));
  for (const i of items) {
    const m = map.get(i.runId)!;
    m.total++;
    const cat = i.status?.category ?? 'UNTESTED';
    if (cat === 'PASSED') m.passed++;
    else if (cat === 'FAILED') m.failed++;
    else if (cat === 'BLOCKED') m.blocked++;
    else if (cat === 'SKIPPED') m.skipped++;
    else if (cat === 'RETEST') m.retest++;
    else m.untested++;
    if (!['UNTESTED', 'RETEST'].includes(cat)) m.done++;
  }
  return map;
}

testRunsRouter.get('/test-runs', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const where: Prisma.TestRunWhereInput = {
    projectId: req.project!.id,
    status: q.status === 'CLOSED' ? 'CLOSED' : q.status === 'all' ? undefined : q.status === 'ACTIVE' ? 'ACTIVE' : undefined,
    milestoneId: q.milestoneId || undefined,
    planId: q.planId || undefined,
    items: q.assigneeId ? { some: { assigneeId: q.assigneeId === 'me' ? req.user!.id : q.assigneeId } } : undefined,
    name: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
  };
  const [total, runs] = await Promise.all([
    prisma.testRun.count({ where }),
    prisma.testRun.findMany({ where, orderBy: { number: 'desc' }, skip, take, include: { milestone: { select: { id: true, name: true } }, plan: { select: { id: true, name: true } }, environment: { select: { id: true, name: true } }, createdBy: userSel } }),
  ]);
  const progress = await runProgress(runs.map((r) => r.id));
  res.json({ total, page, pageSize, runs: runs.map((r) => ({ ...r, key: keys.testRun(r.number), progress: progress.get(r.id) })) });
});

const runBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  planId: z.string().nullish(),
  milestoneId: z.string().nullish(),
  environmentId: z.string().nullish(),
  testCaseIds: z.array(z.string()).max(5000).optional(),
  folderIds: z.array(z.string()).max(200).optional(),
  includeAllActive: z.boolean().optional(),
  assigneeId: z.string().nullish(),
});

testRunsRouter.post('/test-runs', requireRole('TESTER'), async (req, res) => {
  const b = parse(runBody, req.body);
  const pid = req.project!.id;
  await checkMilestone(req, b.milestoneId);
  if (b.planId && !(await prisma.testPlan.findFirst({ where: { id: b.planId, projectId: pid } }))) throw badRequest('Unknown test plan');
  if (b.environmentId && !(await prisma.environment.findFirst({ where: { id: b.environmentId, projectId: pid } }))) throw badRequest('Unknown environment');
  await assertProjectMembers(pid, req.user!.orgId, [b.assigneeId]);
  const caseWhere: Prisma.TestCaseWhereInput[] = [];
  if (b.testCaseIds?.length) caseWhere.push({ id: { in: b.testCaseIds } });
  if (b.folderIds?.length) caseWhere.push({ folderId: { in: b.folderIds } });
  if (b.includeAllActive) caseWhere.push({ status: 'ACTIVE' });
  const cases = caseWhere.length
    ? await prisma.testCase.findMany({ where: { projectId: pid, archivedAt: null, OR: caseWhere }, orderBy: { number: 'asc' }, select: { id: true, version: true } })
    : [];
  if (b.testCaseIds?.length && b.testCaseIds.some((id) => !cases.some((c) => c.id === id))) throw badRequest('Unknown or archived test case');
  const run = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'testRunSeq');
    const r = await tx.testRun.create({
      data: {
        projectId: pid,
        number,
        name: b.name,
        description: b.description ?? null,
        planId: b.planId ?? null,
        milestoneId: b.milestoneId ?? null,
        environmentId: b.environmentId ?? null,
        createdById: req.user!.id,
        items: { create: cases.map((c, i) => ({ testCaseId: c.id, caseVersion: c.version, position: i, assigneeId: b.assigneeId ?? null })) },
      },
    });
    await audit(tx, req, { projectId: pid, entityType: 'test_run', entityId: r.id, action: 'created', changes: { name: r.name, cases: cases.length } });
    await notify(tx, { recipients: [b.assigneeId], actorId: req.user!.id, projectId: pid, type: 'ASSIGNMENT', title: `You were assigned ${cases.length} test(s) in run ${keys.testRun(number)}: ${r.name}`, link: `/projects/${pid}/test-runs/${r.id}` });
    return r;
  });
  res.status(201).json({ run: { ...run, key: keys.testRun(run.number) } });
});

async function findRun(req: Request) {
  const r = await prisma.testRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!r) throw notFound('Test run');
  return r;
}

testRunsRouter.get('/test-runs/:id', async (req, res) => {
  const r = await prisma.testRun.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      milestone: { select: { id: true, name: true } },
      plan: { select: { id: true, name: true } },
      environment: true,
      createdBy: userSel,
      items: {
        orderBy: { position: 'asc' },
        include: {
          testCase: { select: { id: true, number: true, title: true, priority: true, folder: { select: { id: true, name: true } } } },
          assignee: userSel,
          status: true,
          results: { orderBy: { createdAt: 'desc' }, take: 1, include: { createdBy: userSel, issue: { select: { id: true, number: true, title: true } } } },
        },
      },
    },
  });
  if (!r) throw notFound('Test run');
  const progress = (await runProgress([r.id])).get(r.id);
  res.json({
    run: {
      ...r,
      key: keys.testRun(r.number),
      progress,
      items: r.items.map(({ results, ...i }) => ({
        ...i,
        testCase: { ...i.testCase, key: keys.testCase(i.testCase.number) },
        lastResult: results[0] ? { ...results[0], issue: results[0].issue ? { ...results[0].issue, key: keys.issue(req.project!.key, results[0].issue.number) } : null } : null,
      })),
    },
  });
});

testRunsRouter.patch('/test-runs/:id', requireRole('TESTER'), async (req, res) => {
  const r = await findRun(req);
  const b = parse(runBody.pick({ name: true, description: true, milestoneId: true, environmentId: true, planId: true }).partial(), req.body);
  await checkMilestone(req, b.milestoneId);
  const run = await prisma.testRun.update({ where: { id: r.id }, data: b });
  await audit(prisma, req, { projectId: r.projectId, entityType: 'test_run', entityId: r.id, action: 'updated', changes: b });
  res.json({ run: { ...run, key: keys.testRun(run.number) } });
});

testRunsRouter.post('/test-runs/:id/items', requireRole('TESTER'), async (req, res) => {
  const r = await findRun(req);
  if (r.status === 'CLOSED') throw badRequest('Reopen the run before adding tests');
  const b = parse(z.object({ testCaseIds: z.array(z.string()).min(1).max(5000), assigneeId: z.string().nullish() }), req.body);
  await assertProjectMembers(r.projectId, req.user!.orgId, [b.assigneeId]);
  const cases = await prisma.testCase.findMany({ where: { id: { in: b.testCaseIds }, projectId: r.projectId, archivedAt: null }, select: { id: true, version: true } });
  if (cases.length !== new Set(b.testCaseIds).size) throw badRequest('Unknown or archived test case');
  const max = await prisma.testRunItem.aggregate({ where: { runId: r.id }, _max: { position: true } });
  const created = await prisma.testRunItem.createMany({
    data: cases.map((c, i) => ({ runId: r.id, testCaseId: c.id, caseVersion: c.version, position: (max._max.position ?? 0) + i + 1, assigneeId: b.assigneeId ?? null })),
    skipDuplicates: true,
  });
  res.status(201).json({ added: created.count });
});

testRunsRouter.patch('/test-runs/:id/items/:itemId', requireRole('TESTER'), async (req, res) => {
  const r = await findRun(req);
  const item = await prisma.testRunItem.findFirst({ where: { id: String(req.params.itemId), runId: r.id } });
  if (!item) throw notFound('Run item');
  const b = parse(z.object({ assigneeId: z.string().nullable() }), req.body);
  await assertProjectMembers(r.projectId, req.user!.orgId, [b.assigneeId]);
  await prisma.testRunItem.update({ where: { id: item.id }, data: { assigneeId: b.assigneeId } });
  if (b.assigneeId) await notify(prisma, { recipients: [b.assigneeId], actorId: req.user!.id, projectId: r.projectId, type: 'ASSIGNMENT', title: `You were assigned a test in ${keys.testRun(r.number)}: ${r.name}`, link: `/projects/${r.projectId}/test-runs/${r.id}` });
  res.json({ ok: true });
});

testRunsRouter.delete('/test-runs/:id/items/:itemId', requireRole('LEAD'), async (req, res) => {
  const r = await findRun(req);
  const item = await prisma.testRunItem.findFirst({ where: { id: String(req.params.itemId), runId: r.id } });
  if (!item) throw notFound('Run item');
  await prisma.testRunItem.delete({ where: { id: item.id } });
  await audit(prisma, req, { projectId: r.projectId, entityType: 'test_run', entityId: r.id, action: 'item_removed', changes: { testCaseId: item.testCaseId } });
  res.json({ ok: true });
});

testRunsRouter.get('/test-runs/:id/items/:itemId/results', async (req, res) => {
  const r = await findRun(req);
  const item = await prisma.testRunItem.findFirst({
    where: { id: String(req.params.itemId), runId: r.id },
    include: { testCase: { include: { steps: { orderBy: { position: 'asc' } } } } },
  });
  if (!item) throw notFound('Run item');
  const results = await prisma.testResult.findMany({ where: { runItemId: item.id }, orderBy: { createdAt: 'desc' }, include: { status: true, createdBy: userSel, attachments: { where: { deletedAt: null } }, issue: { select: { id: true, number: true, title: true } } } });
  res.json({ item: { ...item, testCase: { ...item.testCase, key: keys.testCase(item.testCase.number) } }, results });
});

/** Records a manual result (append-only history). Optionally files an internal issue for a failure. */
testRunsRouter.post('/test-runs/:id/items/:itemId/results', requireRole('TESTER'), async (req, res) => {
  const r = await findRun(req);
  if (r.status === 'CLOSED') throw badRequest('This run is closed');
  const item = await prisma.testRunItem.findFirst({ where: { id: String(req.params.itemId), runId: r.id }, include: { testCase: true } });
  if (!item) throw notFound('Run item');
  const b = parse(
    z.object({
      statusId: z.string().optional(),
      statusKey: z.string().optional(),
      comment: z.string().max(10_000).nullish(),
      elapsedSeconds: z.number().int().min(0).max(86_400).nullish(),
      issueId: z.string().nullish(),
      createIssue: z.object({ title: z.string().trim().min(1).max(300), severity: z.enum(['TRIVIAL', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']).optional() }).optional(),
    }),
    req.body,
  );
  const pid = r.projectId;
  const status = await prisma.testResultStatus.findFirst({ where: { projectId: pid, archivedAt: null, scope: { in: ['MANUAL', 'BOTH'] }, ...(b.statusId ? { id: b.statusId } : { key: b.statusKey ?? '__none__' }) } });
  if (!status) throw badRequest('Unknown result status');
  if (b.issueId && !(await prisma.issue.findFirst({ where: { id: b.issueId, projectId: pid } }))) throw badRequest('Unknown issue');
  const result = await prisma.$transaction(async (tx) => {
    let issueId = b.issueId ?? null;
    if (b.createIssue) {
      const number = await nextNumber(tx, pid, 'issueSeq');
      const issue = await tx.issue.create({
        data: {
          projectId: pid,
          number,
          title: b.createIssue.title,
          severity: b.createIssue.severity ?? 'MAJOR',
          description: `Failed in test run ${keys.testRun(r.number)} (${r.name}) for ${keys.testCase(item.testCase.number)} ${item.testCase.title}.${b.comment ? `\n\n${b.comment}` : ''}`,
          reporterId: req.user!.id,
          milestoneId: r.milestoneId,
        },
      });
      issueId = issue.id;
      await audit(tx, req, { projectId: pid, entityType: 'issue', entityId: issue.id, action: 'created', changes: { fromTestRun: keys.testRun(r.number) } });
    }
    const result = await tx.testResult.create({
      data: { runItemId: item.id, statusId: status.id, comment: b.comment ?? null, elapsedSeconds: b.elapsedSeconds ?? null, issueId, createdById: req.user!.id },
      include: { status: true, createdBy: userSel },
    });
    await tx.testRunItem.update({ where: { id: item.id }, data: { statusId: status.id, assigneeId: item.assigneeId ?? req.user!.id } });
    return result;
  });
  res.status(201).json({ result });
});

for (const action of ['close', 'reopen'] as const) {
  testRunsRouter.post(`/test-runs/:id/${action}`, requireRole('TESTER'), async (req, res) => {
    const r = await findRun(req);
    const run = await prisma.testRun.update({ where: { id: r.id }, data: action === 'close' ? { status: 'CLOSED', closedAt: new Date() } : { status: 'ACTIVE', closedAt: null } });
    await audit(prisma, req, { projectId: r.projectId, entityType: 'test_run', entityId: r.id, action: action === 'close' ? 'closed' : 'reopened' });
    if (action === 'close') {
      const progress = (await runProgress([r.id])).get(r.id);
      emitEvent(r.projectId, 'test_run.closed', { id: r.id, key: keys.testRun(r.number), name: r.name, progress });
    }
    res.json({ run: { ...run, key: keys.testRun(run.number) } });
  });
}

testRunsRouter.get('/test-runs/:id/export', async (req, res) => {
  const format = String(req.query.format ?? 'csv');
  if (format === 'md' || format === 'docx') {
    const m = await loadRunExport(req.project!, String(req.params.id), config.APP_VERSION);
    if (!m) throw notFound('Test run');
    if (format === 'docx') {
      const buf = await renderRunDocx(m);
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').setHeader('Content-Disposition', `attachment; filename="${m.key}.docx"`);
      return void res.send(buf);
    }
    res.type('application/zip').setHeader('Content-Disposition', `attachment; filename="${m.key}.zip"`);
    return void (await markdownZip(m)).pipe(res);
  }
  const r = await prisma.testRun.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: { items: { orderBy: { position: 'asc' }, include: { testCase: true, assignee: true, status: true, results: { orderBy: { createdAt: 'desc' }, take: 1, include: { createdBy: true } } } } },
  });
  if (!r) throw notFound('Test run');
  const rows = r.items.map((i) => ({
    run: keys.testRun(r.number),
    case: keys.testCase(i.testCase.number),
    title: i.testCase.title,
    status: i.status?.name ?? 'Untested',
    assignee: i.assignee?.name ?? null,
    testedBy: i.results[0]?.createdBy.name ?? null,
    testedAt: i.results[0]?.createdAt ?? null,
    comment: i.results[0]?.comment ?? null,
  }));
  if (req.query.format === 'json') return res.json({ run: { id: r.id, key: keys.testRun(r.number), name: r.name, status: r.status }, results: rows });
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${keys.testRun(r.number)}.csv"`);
  res.send(
    toCsv(rows, [
      { header: 'Run', value: (x) => x.run },
      { header: 'Case', value: (x) => x.case },
      { header: 'Title', value: (x) => x.title },
      { header: 'Status', value: (x) => x.status },
      { header: 'Assignee', value: (x) => x.assignee },
      { header: 'Tested by', value: (x) => x.testedBy },
      { header: 'Tested at', value: (x) => x.testedAt },
      { header: 'Comment', value: (x) => x.comment },
    ]),
  );
});
