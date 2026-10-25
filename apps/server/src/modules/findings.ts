import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../db.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { validateCustomFields } from '../lib/customFields.js';
import { notify } from '../lib/notify.js';
import { addLog, assertCanEditContent, getSessionOr404 } from '../lib/sessionService.js';
import { similarity } from '../lib/similarity.js';
import { toCsv } from '../lib/csv.js';
import { keys, nextNumber, paging, resolveTagIds, tagNames, toArray } from '../lib/util.js';
import { emitEvent } from '../lib/webhooks.js';
import { assertProjectMembers, hasRole, requireRole } from '../middleware/access.js';

export const findingsRouter = Router({ mergeParams: true });

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;
const severity = z.enum(['TRIVIAL', 'MINOR', 'MAJOR', 'CRITICAL', 'BLOCKER']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const findingStatus = z.enum(['NEW', 'TRIAGED', 'CONVERTED', 'RESOLVED', 'DUPLICATE', 'WONT_FIX', 'CLOSED']);
export const OPEN_FINDING_STATUSES = ['NEW', 'TRIAGED'] as const;

const findingBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(300),
  description: z.string().max(20_000).nullish(),
  classificationId: z.string().optional(),
  classificationKey: z.string().optional(),
  severity: severity.optional(),
  priority: priority.optional(),
  status: findingStatus.optional(),
  reproSteps: z.string().max(20_000).nullish(),
  expected: z.string().max(10_000).nullish(),
  actual: z.string().max(10_000).nullish(),
  environment: z.string().max(2000).nullish(),
  sessionId: z.string().nullish(),
  charterId: z.string().nullish(),
  ownerId: z.string().nullish(),
  requirementId: z.string().nullish(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  customFields: z.record(z.unknown()).optional(),
});

const SCALARS = ['title', 'description', 'severity', 'priority', 'status', 'reproSteps', 'expected', 'actual', 'environment', 'ownerId', 'requirementId', 'classificationId'] as const;

async function resolveClassification(projectId: string, body: { classificationId?: string; classificationKey?: string }) {
  if (!body.classificationId && !body.classificationKey) return undefined;
  const c = await prisma.findingClassification.findFirst({
    where: { projectId, archivedAt: null, ...(body.classificationId ? { id: body.classificationId } : { key: body.classificationKey }) },
  });
  if (!c) throw badRequest('Unknown classification');
  return c;
}

async function findFinding(req: Request) {
  const f = await prisma.finding.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!f) throw notFound('Finding');
  return f;
}

const canEditFinding = (req: Request, f: { authorId: string; ownerId: string | null }) =>
  hasRole(req, 'LEAD') || (hasRole(req, 'TESTER') && (f.authorId === req.user!.id || f.ownerId === req.user!.id));

function buildWhere(req: Request, q: Record<string, string>): Prisma.FindingWhereInput {
  const statuses = toArray(q.status);
  return {
    projectId: req.project!.id,
    status: q.open === 'true' ? { in: [...OPEN_FINDING_STATUSES] } : statuses.length ? { in: statuses as never } : undefined,
    classification: q.classification ? { key: { in: toArray(q.classification) } } : q.defects === 'true' ? { isDefect: true } : undefined,
    severity: q.severity ? { in: toArray(q.severity) as never } : undefined,
    priority: q.priority ? { in: toArray(q.priority) as never } : undefined,
    sessionId: q.sessionId || undefined,
    charterId: q.charterId || undefined,
    requirementId: q.requirementId || undefined,
    authorId: q.authorId ? (q.authorId === 'me' ? req.user!.id : q.authorId) : undefined,
    ownerId: q.ownerId ? (q.ownerId === 'me' ? req.user!.id : q.ownerId === 'none' ? null : q.ownerId) : undefined,
    session: q.milestoneId ? { milestoneId: q.milestoneId } : undefined,
    tags: q.tag ? { some: { tag: { name: { in: toArray(q.tag) } } } } : undefined,
    createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined } : undefined,
    OR: q.q
      ? [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { actual: { contains: q.q, mode: 'insensitive' } },
          ...(/^(f-)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
        ]
      : undefined,
  };
}

const listInclude = {
  classification: true,
  author: userSel,
  owner: userSel,
  session: { select: { id: true, number: true, title: true, status: true } },
  charter: { select: { id: true, number: true, title: true } },
  issue: { select: { id: true, number: true, title: true, status: true, externalUrl: true } },
  requirement: { select: { id: true, number: true, title: true } },
  tags: { include: { tag: true } },
  _count: { select: { attachments: true, comments: true } },
} satisfies Prisma.FindingInclude;

type ListFinding = Prisma.FindingGetPayload<{ include: typeof listInclude }>;

function serialize(req: Request, f: ListFinding) {
  return {
    ...f,
    key: keys.finding(f.number),
    tags: tagNames(f.tags),
    session: f.session ? { ...f.session, key: keys.session(f.session.number) } : null,
    charter: f.charter ? { ...f.charter, key: keys.charter(f.charter.number) } : null,
    issue: f.issue ? { ...f.issue, key: keys.issue(req.project!.key, f.issue.number) } : null,
    requirement: f.requirement ? { ...f.requirement, key: keys.requirement(f.requirement.number) } : null,
  };
}

findingsRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const where = buildWhere(req, q);
  const orderBy: Prisma.FindingOrderByWithRelationInput =
    q.sort === 'severity' ? { severity: 'desc' } : q.sort === 'number' ? { number: 'desc' } : q.sort === 'updated' ? { updatedAt: 'desc' } : { createdAt: 'desc' };
  const [total, findings] = await Promise.all([
    prisma.finding.count({ where }),
    prisma.finding.findMany({ where, orderBy, skip, take, include: listInclude }),
  ]);
  res.json({ total, page, pageSize, findings: findings.map((f) => serialize(req, f)) });
});

findingsRouter.get('/export', async (req, res) => {
  const q = req.query as Record<string, string>;
  const findings = await prisma.finding.findMany({ where: buildWhere(req, q), orderBy: { number: 'asc' }, include: listInclude, take: 10_000 });
  const rows = findings.map((f) => serialize(req, f));
  if (q.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-findings.json"`);
    return res.json({ exportedAt: new Date().toISOString(), project: req.project!.key, count: rows.length, findings: rows });
  }
  const csv = toCsv(rows, [
    { header: 'Key', value: (f) => f.key },
    { header: 'Title', value: (f) => f.title },
    { header: 'Classification', value: (f) => f.classification.name },
    { header: 'Severity', value: (f) => f.severity },
    { header: 'Priority', value: (f) => f.priority },
    { header: 'Status', value: (f) => f.status },
    { header: 'Session', value: (f) => f.session?.key },
    { header: 'Charter', value: (f) => f.charter?.key },
    { header: 'Issue', value: (f) => f.issue?.key },
    { header: 'Requirement', value: (f) => f.requirement?.key },
    { header: 'Author', value: (f) => f.author.name },
    { header: 'Owner', value: (f) => f.owner?.name },
    { header: 'Tags', value: (f) => f.tags },
    { header: 'Description', value: (f) => f.description },
    { header: 'Steps to reproduce', value: (f) => f.reproSteps },
    { header: 'Expected', value: (f) => f.expected },
    { header: 'Actual', value: (f) => f.actual },
    { header: 'Environment', value: (f) => f.environment },
    { header: 'Created', value: (f) => f.createdAt },
    { header: 'Updated', value: (f) => f.updatedAt },
  ]);
  res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-findings.csv"`);
  res.send(csv);
});

/** Deterministic duplicate suggestions (title + text similarity). Never merges automatically. */
async function similarFindings(projectId: string, probe: { title: string; text?: string }, excludeId?: string) {
  const candidates = await prisma.finding.findMany({
    where: { projectId, id: excludeId ? { not: excludeId } : undefined, status: { not: 'DUPLICATE' } },
    select: { id: true, number: true, title: true, description: true, actual: true, status: true, severity: true, classification: { select: { name: true, color: true } } },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  return candidates
    .map((c) => ({ ...c, key: keys.finding(c.number), score: similarity(probe, { title: c.title, text: `${c.description ?? ''} ${c.actual ?? ''}` }) }))
    .filter((c) => c.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ description: _d, actual: _a, ...rest }) => rest);
}

findingsRouter.post('/similar', async (req, res) => {
  const body = parse(z.object({ title: z.string().trim().min(3).max(300), text: z.string().max(20_000).optional() }), req.body);
  res.json({ suggestions: await similarFindings(req.project!.id, body) });
});

findingsRouter.post('/', requireRole('TESTER'), async (req, res) => {
  const body = parse(findingBody, req.body);
  const pid = req.project!.id;
  const classification = (await resolveClassification(pid, body)) ?? (await prisma.findingClassification.findFirst({ where: { projectId: pid, key: 'observation' } }));
  if (!classification) throw badRequest('A classification is required');
  const session = body.sessionId ? await getSessionOr404(pid, body.sessionId).catch(() => { throw badRequest('Unknown session'); }) : null;
  if (session) assertCanEditContent(req, session);
  const charterId = session?.charterId ?? body.charterId ?? null;
  if (!session && charterId && !(await prisma.charter.findFirst({ where: { id: charterId, projectId: pid } }))) throw badRequest('Unknown charter');
  if (body.requirementId && !(await prisma.requirement.findFirst({ where: { id: body.requirementId, projectId: pid } }))) throw badRequest('Unknown requirement');
  await assertProjectMembers(pid, req.user!.orgId, [body.ownerId]);
  const customFields = await validateCustomFields(prisma, pid, 'FINDING', body.customFields);
  const finding = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'findingSeq');
    const tagIds = await resolveTagIds(tx, pid, body.tags);
    const fresh = session ? await tx.exploratorySession.findUniqueOrThrow({ where: { id: session.id } }) : null;
    const f = await tx.finding.create({
      data: {
        projectId: pid,
        number,
        sessionId: session?.id ?? null,
        charterId,
        classificationId: classification.id,
        title: body.title,
        description: body.description ?? null,
        severity: body.severity ?? (classification.isDefect ? 'MAJOR' : 'MINOR'),
        priority: body.priority ?? 'MEDIUM',
        reproSteps: body.reproSteps ?? null,
        expected: body.expected ?? null,
        actual: body.actual ?? null,
        environment: body.environment ?? (session ? [session.browser, session.os, session.device, session.buildVersion].filter(Boolean).join(' / ') || null : null),
        authorId: req.user!.id,
        ownerId: body.ownerId ?? null,
        requirementId: body.requirementId ?? null,
        customFields: customFields as Prisma.InputJsonValue,
        sessionElapsedSeconds: fresh ? undefined : null,
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
    });
    if (fresh) {
      const log = await addLog(tx, fresh, { authorId: req.user!.id, type: 'FINDING', content: `${classification.name}: ${f.title}`, findingId: f.id });
      await tx.finding.update({ where: { id: f.id }, data: { sessionElapsedSeconds: log.elapsedSeconds } });
    }
    await audit(tx, req, { projectId: pid, entityType: 'finding', entityId: f.id, action: 'created', changes: { title: f.title, classification: classification.key, session: session ? keys.session(session.number) : null } });
    await notify(tx, { recipients: [body.ownerId], actorId: req.user!.id, projectId: pid, type: 'OWNERSHIP', title: `You own finding ${keys.finding(number)}: ${f.title}`, link: `/projects/${pid}/findings/${f.id}` });
    return f;
  });
  emitEvent(pid, 'finding.created', { id: finding.id, key: keys.finding(finding.number), title: finding.title, classification: classification.key, severity: finding.severity });
  const full = await prisma.finding.findUniqueOrThrow({ where: { id: finding.id }, include: listInclude });
  res.status(201).json({ finding: serialize(req, full) });
});

findingsRouter.get('/:id', async (req, res) => {
  const f = await prisma.finding.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      ...listInclude,
      attachments: { orderBy: { createdAt: 'asc' }, include: { uploader: userSel } },
      duplicateOf: { select: { id: true, number: true, title: true } },
      duplicates: { select: { id: true, number: true, title: true } },
      testCases: { select: { id: true, number: true, title: true } },
      sourceOfIssues: { select: { id: true, number: true, title: true } },
    },
  });
  if (!f) throw notFound('Finding');
  const history = await prisma.auditEvent.findMany({ where: { entityType: 'finding', entityId: f.id }, include: { actor: userSel }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({
    finding: {
      ...serialize(req, f),
      duplicateOf: f.duplicateOf ? { ...f.duplicateOf, key: keys.finding(f.duplicateOf.number) } : null,
      duplicates: f.duplicates.map((d) => ({ ...d, key: keys.finding(d.number) })),
      testCases: f.testCases.map((t) => ({ ...t, key: keys.testCase(t.number) })),
    },
    history,
    permissions: { canEdit: canEditFinding(req, f), canTriage: hasRole(req, 'LEAD') || canEditFinding(req, f) },
  });
});

findingsRouter.get('/:id/similar', async (req, res) => {
  const f = await findFinding(req);
  res.json({ suggestions: await similarFindings(req.project!.id, { title: f.title, text: `${f.description ?? ''} ${f.actual ?? ''}` }, f.id) });
});

findingsRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const before = await findFinding(req);
  if (!canEditFinding(req, before)) throw forbidden('Only the author, owner or a lead can edit this finding');
  const body = parse(findingBody.partial(), req.body);
  const pid = req.project!.id;
  const classification = await resolveClassification(pid, body);
  if (body.requirementId && !(await prisma.requirement.findFirst({ where: { id: body.requirementId, projectId: pid } }))) throw badRequest('Unknown requirement');
  if (body.ownerId) await assertProjectMembers(pid, req.user!.orgId, [body.ownerId]);
  const customFields = body.customFields ? await validateCustomFields(prisma, pid, 'FINDING', body.customFields, before.customFields) : undefined;
  const data: Record<string, unknown> = {};
  for (const k of SCALARS) if (body[k] !== undefined) data[k] = body[k];
  if (classification) data.classificationId = classification.id;
  if (customFields) data.customFields = customFields;
  const updated = await prisma.$transaction(async (tx) => {
    if (body.tags) {
      const tagIds = await resolveTagIds(tx, pid, body.tags);
      await tx.findingTag.deleteMany({ where: { findingId: before.id } });
      await tx.findingTag.createMany({ data: tagIds.map((tagId) => ({ findingId: before.id, tagId })) });
    }
    const f = await tx.finding.update({ where: { id: before.id }, data: data as Prisma.FindingUncheckedUpdateInput });
    const changes: Record<string, unknown> = diff(before as unknown as Record<string, unknown>, f as unknown as Record<string, unknown>, Object.keys(data));
    if (body.tags) changes.tags = { to: body.tags };
    if (Object.keys(changes).length) await audit(tx, req, { projectId: pid, entityType: 'finding', entityId: f.id, action: 'updated', changes });
    if (body.ownerId && body.ownerId !== before.ownerId) {
      await notify(tx, { recipients: [body.ownerId], actorId: req.user!.id, projectId: pid, type: 'OWNERSHIP', title: `You now own finding ${keys.finding(f.number)}: ${f.title}`, link: `/projects/${pid}/findings/${f.id}` });
    }
    return f;
  });
  const full = await prisma.finding.findUniqueOrThrow({ where: { id: updated.id }, include: listInclude });
  res.json({ finding: serialize(req, full) });
});

export async function createIssueFromFinding(tx: Tx, req: Request, f: { id: string; number: number; title: string; description: string | null; reproSteps: string | null; expected: string | null; actual: string | null; environment: string | null; severity: Prisma.IssueCreateInput['severity']; priority: Prisma.IssueCreateInput['priority']; sessionId: string | null }, overrides: { title?: string; assigneeId?: string | null; milestoneId?: string | null }) {
  const pid = req.project!.id;
  const number = await nextNumber(tx, pid, 'issueSeq');
  const parts = [
    f.description,
    f.reproSteps && `**Steps to reproduce**\n${f.reproSteps}`,
    f.expected && `**Expected**\n${f.expected}`,
    f.actual && `**Actual**\n${f.actual}`,
    f.environment && `**Environment**\n${f.environment}`,
    `_Created from finding ${keys.finding(f.number)}._`,
  ].filter(Boolean);
  let milestoneId = overrides.milestoneId;
  if (milestoneId === undefined && f.sessionId) milestoneId = (await tx.exploratorySession.findUnique({ where: { id: f.sessionId }, select: { milestoneId: true } }))?.milestoneId ?? null;
  return tx.issue.create({
    data: {
      projectId: pid,
      number,
      title: overrides.title?.trim() || f.title,
      description: parts.join('\n\n'),
      severity: f.severity,
      priority: f.priority,
      reporterId: req.user!.id,
      assigneeId: overrides.assigneeId ?? null,
      milestoneId: milestoneId ?? null,
      sourceFindingId: f.id,
    },
  });
}

/** Converts a finding into an internal issue. The finding (and its session context) is preserved and linked. */
findingsRouter.post('/:id/convert-to-issue', requireRole('TESTER'), async (req, res) => {
  const f = await findFinding(req);
  if (f.issueId) throw badRequest('This finding is already linked to an issue');
  const body = parse(z.object({ title: z.string().max(300).optional(), assigneeId: z.string().nullish(), milestoneId: z.string().nullish(), confirmDefect: z.boolean().optional() }), req.body ?? {});
  const pid = req.project!.id;
  await assertProjectMembers(pid, req.user!.orgId, [body.assigneeId]);
  if (body.milestoneId && !(await prisma.milestone.findFirst({ where: { id: body.milestoneId, projectId: pid } }))) throw badRequest('Unknown milestone');
  const issue = await prisma.$transaction(async (tx) => {
    const issue = await createIssueFromFinding(tx, req, f, body);
    const data: Prisma.FindingUncheckedUpdateInput = { issueId: issue.id, status: 'CONVERTED' };
    if (body.confirmDefect) {
      const confirmed = await tx.findingClassification.findFirst({ where: { projectId: pid, isDefect: true, archivedAt: null }, orderBy: { position: 'asc' } });
      if (confirmed) data.classificationId = confirmed.id;
    }
    await tx.finding.update({ where: { id: f.id }, data });
    if (f.sessionId) {
      const s = await tx.exploratorySession.findUniqueOrThrow({ where: { id: f.sessionId } });
      await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: req.user!.id, type: 'SYSTEM', content: `${keys.finding(f.number)} converted to issue ${keys.issue(req.project!.key, issue.number)}`, elapsedSeconds: s.elapsedSeconds, findingId: f.id } });
    }
    await audit(tx, req, { projectId: pid, entityType: 'finding', entityId: f.id, action: 'converted_to_issue', changes: { issue: keys.issue(req.project!.key, issue.number), status: { from: f.status, to: 'CONVERTED' } } });
    await audit(tx, req, { projectId: pid, entityType: 'issue', entityId: issue.id, action: 'created', changes: { fromFinding: keys.finding(f.number) } });
    await notify(tx, { recipients: [body.assigneeId], actorId: req.user!.id, projectId: pid, type: 'ASSIGNMENT', title: `You were assigned issue ${keys.issue(req.project!.key, issue.number)}: ${issue.title}`, link: `/projects/${pid}/issues/${issue.id}` });
    return issue;
  });
  emitEvent(pid, 'finding.converted', { finding: keys.finding(f.number), issue: keys.issue(req.project!.key, issue.number) });
  emitEvent(pid, 'issue.created', { id: issue.id, key: keys.issue(req.project!.key, issue.number), title: issue.title, severity: issue.severity });
  res.status(201).json({ issue: { ...issue, key: keys.issue(req.project!.key, issue.number) } });
});

findingsRouter.post('/:id/link-issue', requireRole('TESTER'), async (req, res) => {
  const f = await findFinding(req);
  if (!canEditFinding(req, f)) throw forbidden();
  const body = parse(z.object({ issueId: z.string().nullable() }), req.body);
  const pid = req.project!.id;
  if (body.issueId && !(await prisma.issue.findFirst({ where: { id: body.issueId, projectId: pid } }))) throw badRequest('Unknown issue');
  await prisma.$transaction(async (tx) => {
    await tx.finding.update({ where: { id: f.id }, data: { issueId: body.issueId, status: body.issueId ? (f.status === 'NEW' ? 'TRIAGED' : f.status) : f.status } });
    await audit(tx, req, { projectId: pid, entityType: 'finding', entityId: f.id, action: body.issueId ? 'issue_linked' : 'issue_unlinked', changes: { issueId: { from: f.issueId, to: body.issueId } } });
  });
  res.json({ ok: true });
});

/** Explicit user action: marks this finding as a duplicate of another. Nothing is merged automatically. */
findingsRouter.post('/:id/mark-duplicate', requireRole('TESTER'), async (req, res) => {
  const f = await findFinding(req);
  if (!canEditFinding(req, f)) throw forbidden();
  const body = parse(z.object({ duplicateOfId: z.string().nullable() }), req.body);
  if (body.duplicateOfId === f.id) throw badRequest('A finding cannot duplicate itself');
  const pid = req.project!.id;
  if (body.duplicateOfId) {
    const target = await prisma.finding.findFirst({ where: { id: body.duplicateOfId, projectId: pid } });
    if (!target) throw badRequest('Unknown finding');
    if (target.duplicateOfId === f.id) throw badRequest('That finding is already marked as a duplicate of this one');
  }
  await prisma.$transaction(async (tx) => {
    await tx.finding.update({ where: { id: f.id }, data: { duplicateOfId: body.duplicateOfId, status: body.duplicateOfId ? 'DUPLICATE' : 'NEW' } });
    await audit(tx, req, { projectId: pid, entityType: 'finding', entityId: f.id, action: body.duplicateOfId ? 'marked_duplicate' : 'unmarked_duplicate', changes: { duplicateOfId: body.duplicateOfId, status: { from: f.status } } });
  });
  res.json({ ok: true });
});

/** Turns a validated discovery into a reusable regression test case (steps parsed from repro steps). */
findingsRouter.post('/:id/create-test-case', requireRole('TESTER'), async (req, res) => {
  const f = await findFinding(req);
  const body = parse(z.object({ title: z.string().max(300).optional(), folderId: z.string().nullish(), steps: z.array(z.object({ action: z.string().min(1).max(5000), expected: z.string().max(5000).nullish() })).max(100).optional() }), req.body ?? {});
  const pid = req.project!.id;
  if (body.folderId && !(await prisma.testFolder.findFirst({ where: { id: body.folderId, projectId: pid } }))) throw badRequest('Unknown folder');
  const parsedSteps =
    body.steps ??
    (f.reproSteps ?? '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim())
      .filter(Boolean)
      .map((action, i, arr) => ({ action, expected: i === arr.length - 1 ? f.expected : null }));
  const tc = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'testCaseSeq');
    const created = await tx.testCase.create({
      data: {
        projectId: pid,
        number,
        folderId: body.folderId ?? null,
        title: body.title?.trim() || `Regression: ${f.title}`.slice(0, 300),
        description: f.description,
        preconditions: f.environment ? `Environment: ${f.environment}` : null,
        priority: f.priority,
        type: 'Regression',
        sourceFindingId: f.id,
        sourceCharterId: f.charterId,
        createdById: req.user!.id,
        updatedById: req.user!.id,
        steps: { create: (parsedSteps.length ? parsedSteps : [{ action: f.title, expected: f.expected }]).map((s, i) => ({ position: i + 1, action: s.action, expected: s.expected ?? null })) },
      },
      include: { steps: true },
    });
    await tx.testCaseRevision.create({ data: { testCaseId: created.id, version: 1, snapshot: JSON.parse(JSON.stringify(created)), authorId: req.user!.id } });
    await audit(tx, req, { projectId: pid, entityType: 'test_case', entityId: created.id, action: 'created_from_finding', changes: { finding: keys.finding(f.number) } });
    return created;
  });
  res.status(201).json({ testCase: { ...tc, key: keys.testCase(tc.number) } });
});
