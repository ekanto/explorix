import { Router, type Request } from 'express';
import type { AutomationRun, Prisma, StatusCategory, TestResultStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Tx } from '../db.js';
import { AppError, badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { keys, nextNumber, paging, toArray } from '../lib/util.js';
import { emitEvent } from '../lib/webhooks.js';
import { requireRole } from '../middleware/access.js';
import { flakiness, parseJUnit, parsePlaywright, type NormalizedResult } from '../integrations/parsers.js';

export const automationRouter = Router({ mergeParams: true });

const MAX_RESULTS_PER_REQUEST = 20_000;

const resultSchema = z.object({
  key: z.string().max(1000).optional(),
  name: z.string().trim().min(1).max(1000),
  suite: z.string().max(1000).nullish(),
  file: z.string().max(1000).nullish(),
  status: z.string().trim().min(1).max(50),
  durationMs: z.number().int().min(0).max(2_147_483_647).nullish(),
  message: z.string().max(10_000).nullish(),
  stackTrace: z.string().max(50_000).nullish(),
  retries: z.number().int().min(0).max(100).optional(),
  artifacts: z.array(z.object({ name: z.string().max(300), url: z.string().url().max(2000).optional(), path: z.string().max(2000).optional(), contentType: z.string().max(100).optional() })).max(50).optional(),
});

const runMeta = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  source: z.string().trim().max(120).optional(),
  framework: z.string().trim().max(60).optional(),
  branch: z.string().max(300).nullish(),
  commitSha: z.string().max(100).nullish(),
  buildNumber: z.string().max(100).nullish(),
  ciProvider: z.string().max(60).nullish(),
  ciUrl: z.string().url().max(2000).nullish(),
  environment: z.string().max(200).nullish(),
  milestoneId: z.string().nullish(),
  milestone: z.string().max(200).nullish(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/** Maps a raw framework status to a configured project status via key/aliases. Unknown → "error"/failed. */
function statusMapper(statuses: TestResultStatus[]) {
  const usable = statuses.filter((s) => s.scope !== 'MANUAL' && !s.archivedAt);
  const fallback = usable.find((s) => s.key === 'error') ?? usable.find((s) => s.category === 'FAILED');
  if (!fallback) throw new AppError(500, 'config_error', 'Project has no failed automation status configured');
  return (raw: string) => {
    const r = raw.trim().toLowerCase();
    return usable.find((s) => s.key === r) ?? usable.find((s) => s.aliases.map((a) => a.toLowerCase()).includes(r)) ?? fallback;
  };
}

async function resolveMilestone(req: Request, meta: z.infer<typeof runMeta>) {
  if (meta.milestoneId) {
    if (!(await prisma.milestone.findFirst({ where: { id: meta.milestoneId, projectId: req.project!.id } }))) throw badRequest('Unknown milestone');
    return meta.milestoneId;
  }
  if (meta.milestone) return (await prisma.milestone.findFirst({ where: { name: meta.milestone, projectId: req.project!.id } }))?.id ?? null;
  return null;
}

async function createRun(tx: Tx, req: Request, meta: z.infer<typeof runMeta>, defaults: { framework?: string; startedAt?: Date; status: 'RUNNING' | 'COMPLETED' }, milestoneId: string | null) {
  const pid = req.project!.id;
  const sourceName = meta.source?.trim() || meta.framework || defaults.framework || 'default';
  const source = await tx.automationSource.upsert({
    where: { projectId_name: { projectId: pid, name: sourceName } },
    update: {},
    create: { projectId: pid, name: sourceName, framework: meta.framework ?? defaults.framework ?? null },
  });
  const number = await nextNumber(tx, pid, 'automationSeq');
  return tx.automationRun.create({
    data: {
      projectId: pid,
      number,
      sourceId: source.id,
      name: meta.name ?? `${sourceName}${meta.branch ? ` · ${meta.branch}` : ''}${meta.buildNumber ? ` #${meta.buildNumber}` : ''}`,
      framework: meta.framework ?? defaults.framework ?? null,
      status: defaults.status,
      branch: meta.branch ?? null,
      commitSha: meta.commitSha ?? null,
      buildNumber: meta.buildNumber ?? null,
      ciProvider: meta.ciProvider ?? null,
      ciUrl: meta.ciUrl ?? null,
      environment: meta.environment ?? null,
      milestoneId,
      startedAt: meta.startedAt ? new Date(meta.startedAt) : defaults.startedAt ?? new Date(),
      metadata: (meta.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

/** Appends results to a run, upserting AutomationTest identities and updating counters. */
async function appendResults(tx: Tx, run: AutomationRun, results: NormalizedResult[]) {
  if (!results.length) return;
  const statuses = await tx.testResultStatus.findMany({ where: { projectId: run.projectId } });
  const map = statusMapper(statuses);
  const counts: Record<StatusCategory, number> = { PASSED: 0, FAILED: 0, SKIPPED: 0, BLOCKED: 0, RETEST: 0, UNTESTED: 0 };
  const testKeys = Array.from(new Set(results.map((r) => (r.key ?? `${r.suite ?? ''}::${r.name}`).slice(0, 1000))));
  const existing = await tx.automationTest.findMany({ where: { projectId: run.projectId, key: { in: testKeys } } });
  const byKey = new Map(existing.map((t) => [t.key, t]));
  const missing = results.filter((r) => !byKey.has((r.key ?? `${r.suite ?? ''}::${r.name}`).slice(0, 1000)));
  if (missing.length) {
    await tx.automationTest.createMany({
      data: Array.from(new Map(missing.map((r) => {
        const key = (r.key ?? `${r.suite ?? ''}::${r.name}`).slice(0, 1000);
        return [key, { projectId: run.projectId, key, name: r.name.slice(0, 1000), suite: r.suite?.slice(0, 1000) ?? null, file: r.file?.slice(0, 1000) ?? null }];
      })).values()),
      skipDuplicates: true,
    });
    for (const t of await tx.automationTest.findMany({ where: { projectId: run.projectId, key: { in: testKeys } } })) byKey.set(t.key, t);
  }
  const rows: Prisma.AutomationResultCreateManyInput[] = results.map((r) => {
    const status = map(r.status);
    counts[status.category]++;
    return {
      runId: run.id,
      testId: byKey.get((r.key ?? `${r.suite ?? ''}::${r.name}`).slice(0, 1000))!.id,
      statusId: status.id,
      category: status.category,
      rawStatus: r.status.slice(0, 50),
      durationMs: r.durationMs ?? null,
      message: r.message?.slice(0, 10_000) ?? null,
      stackTrace: r.stackTrace?.slice(0, 50_000) ?? null,
      retries: r.retries ?? 0,
      artifacts: (r.artifacts ?? []) as Prisma.InputJsonValue,
    };
  });
  for (let i = 0; i < rows.length; i += 1000) await tx.automationResult.createMany({ data: rows.slice(i, i + 1000) });
  await tx.automationRun.update({
    where: { id: run.id },
    data: {
      totalCount: { increment: results.length },
      passedCount: { increment: counts.PASSED },
      failedCount: { increment: counts.FAILED },
      skippedCount: { increment: counts.SKIPPED },
      otherCount: { increment: counts.BLOCKED + counts.RETEST + counts.UNTESTED },
    },
  });
}

async function completeRun(tx: Tx, run: AutomationRun, completedAt?: Date, durationMs?: number) {
  const end = completedAt ?? new Date();
  return tx.automationRun.update({
    where: { id: run.id },
    data: { status: 'COMPLETED', completedAt: end, durationMs: durationMs ?? Math.max(0, end.getTime() - run.startedAt.getTime()) },
  });
}

function summarize(run: AutomationRun) {
  return { id: run.id, key: keys.automationRun(run.number), name: run.name, status: run.status, total: run.totalCount, passed: run.passedCount, failed: run.failedCount, skipped: run.skippedCount, url: `/projects/${run.projectId}/automation/runs/${run.id}` };
}

async function ingest(req: Request, meta: z.infer<typeof runMeta>, parsed: { framework: string; startedAt?: Date; durationMs?: number; results: NormalizedResult[] }, complete: boolean) {
  if (parsed.results.length > MAX_RESULTS_PER_REQUEST) throw badRequest(`At most ${MAX_RESULTS_PER_REQUEST} results per request; use staged ingestion for larger suites`);
  const milestoneId = await resolveMilestone(req, meta);
  const run = await prisma.$transaction(
    async (tx) => {
      let run = await createRun(tx, req, meta, { framework: parsed.framework, startedAt: parsed.startedAt, status: complete ? 'COMPLETED' : 'RUNNING' }, milestoneId);
      await appendResults(tx, run, parsed.results);
      run = await tx.automationRun.findUniqueOrThrow({ where: { id: run.id } });
      if (complete) run = await completeRun(tx, run, meta.completedAt ? new Date(meta.completedAt) : undefined, parsed.durationMs);
      await audit(tx, req, { projectId: run.projectId, entityType: 'automation_run', entityId: run.id, action: 'ingested', changes: { framework: parsed.framework, results: parsed.results.length } });
      return run;
    },
    { timeout: 120_000 },
  );
  if (complete) emitEvent(run.projectId, 'automation_run.completed', summarize(run));
  return run;
}

// ---------------------------------------------------------------------------
// Ingestion endpoints (session or API token with tester role)
// ---------------------------------------------------------------------------

/** Native JSON: create a run (optionally with results). status "RUNNING" starts a staged run. */
automationRouter.post('/runs', requireRole('TESTER'), async (req, res) => {
  const b = parse(runMeta.extend({ status: z.enum(['RUNNING', 'COMPLETED']).optional(), results: z.array(resultSchema).max(MAX_RESULTS_PER_REQUEST).optional() }), req.body);
  const run = await ingest(req, b, { framework: b.framework ?? 'custom', results: b.results ?? [] }, b.status !== 'RUNNING');
  res.status(201).json({ run: summarize(run) });
});

automationRouter.post('/runs/:id/results', requireRole('TESTER'), async (req, res) => {
  const b = parse(z.object({ results: z.array(resultSchema).min(1).max(MAX_RESULTS_PER_REQUEST) }), req.body);
  const run = await prisma.automationRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!run) throw notFound('Automation run');
  if (run.status !== 'RUNNING') throw badRequest('Results can only be appended to a running run');
  await prisma.$transaction((tx) => appendResults(tx, run, b.results), { timeout: 120_000 });
  const fresh = await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } });
  res.status(201).json({ run: summarize(fresh), appended: b.results.length });
});

automationRouter.post('/runs/:id/complete', requireRole('TESTER'), async (req, res) => {
  const b = parse(z.object({ completedAt: z.string().datetime({ offset: true }).optional(), durationMs: z.number().int().min(0).optional() }), req.body ?? {});
  const run = await prisma.automationRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!run) throw notFound('Automation run');
  if (run.status !== 'RUNNING') throw badRequest('Run is already completed');
  const done = await prisma.$transaction((tx) => completeRun(tx, run, b.completedAt ? new Date(b.completedAt) : undefined, b.durationMs));
  emitEvent(done.projectId, 'automation_run.completed', summarize(done));
  res.json({ run: summarize(done) });
});

const queryMeta = (q: Record<string, unknown>) =>
  parse(runMeta, Object.fromEntries(Object.entries(q).filter(([k, v]) => typeof v === 'string' && k !== 'format' && k !== 'metadata')));

/** JUnit XML upload: body is the XML document (Content-Type: application/xml); run metadata in query params. */
automationRouter.post('/import/junit', requireRole('TESTER'), async (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) throw badRequest('Send the JUnit XML as the request body with Content-Type: application/xml');
  let parsed;
  try {
    parsed = parseJUnit(req.body);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const meta = queryMeta(req.query as Record<string, unknown>);
  const run = await ingest(req, { ...meta, framework: meta.framework ?? 'junit' }, parsed, true);
  res.status(201).json({ run: summarize(run) });
});

/** Playwright JSON reporter upload: body is the report JSON; run metadata in query params. */
automationRouter.post('/import/playwright', requireRole('TESTER'), async (req, res) => {
  let parsed;
  try {
    parsed = parsePlaywright(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  const meta = queryMeta(req.query as Record<string, unknown>);
  const run = await ingest(req, { ...meta, framework: 'playwright' }, parsed, true);
  res.status(201).json({ run: summarize(run) });
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function runWhere(req: Request, q: Record<string, string>): Prisma.AutomationRunWhereInput {
  return {
    projectId: req.project!.id,
    framework: q.framework ? { in: toArray(q.framework) } : undefined,
    branch: q.branch || undefined,
    environment: q.environment || undefined,
    milestoneId: q.milestoneId || undefined,
    sourceId: q.sourceId || undefined,
    status: q.status === 'RUNNING' ? 'RUNNING' : q.status === 'COMPLETED' ? 'COMPLETED' : undefined,
    startedAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined } : undefined,
    name: q.q ? { contains: q.q, mode: 'insensitive' } : undefined,
  };
}

automationRouter.get('/runs', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const where = runWhere(req, q);
  const [total, runs, sources, facets] = await Promise.all([
    prisma.automationRun.count({ where }),
    prisma.automationRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip, take, include: { source: { select: { id: true, name: true } }, milestone: { select: { id: true, name: true } } } }),
    prisma.automationSource.findMany({ where: { projectId: req.project!.id }, orderBy: { name: 'asc' } }),
    prisma.automationRun.findMany({ where: { projectId: req.project!.id }, distinct: ['framework', 'branch', 'environment'], select: { framework: true, branch: true, environment: true }, take: 500 }),
  ]);
  const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter((x): x is string => !!x))).sort();
  res.json({
    total,
    page,
    pageSize,
    runs: runs.map((r) => ({ ...r, key: keys.automationRun(r.number), passRate: r.totalCount ? Math.round((r.passedCount / Math.max(1, r.totalCount - r.skippedCount)) * 1000) / 10 : null })),
    sources,
    facets: { frameworks: uniq(facets.map((f) => f.framework)), branches: uniq(facets.map((f) => f.branch)), environments: uniq(facets.map((f) => f.environment)) },
  });
});

automationRouter.get('/runs/:id', async (req, res) => {
  const q = req.query as Record<string, string>;
  const run = await prisma.automationRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: { source: true, milestone: { select: { id: true, name: true } } } });
  if (!run) throw notFound('Automation run');
  const results = await prisma.automationResult.findMany({
    where: {
      runId: run.id,
      category: q.category ? { in: toArray(q.category) as StatusCategory[] } : undefined,
      test: q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { suite: { contains: q.q, mode: 'insensitive' } }] } : undefined,
    },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Number(q.limit) || 2000, 5000),
    include: { test: true, status: true, issue: { select: { id: true, number: true, title: true, status: true } }, attachments: true },
  });
  // Flaky indicator per test from its recent history (last 10 completed results across runs).
  const testIds = results.map((r) => r.testId);
  const history = await prisma.automationResult.findMany({
    where: { testId: { in: testIds }, run: { status: 'COMPLETED' } },
    orderBy: { createdAt: 'desc' },
    select: { testId: true, category: true, retries: true },
    take: Math.min(testIds.length * 10, 50_000),
  });
  const byTest = new Map<string, { category: string; retries: number }[]>();
  for (const h of history) {
    const list = byTest.get(h.testId) ?? [];
    if (list.length < 10) list.push(h);
    byTest.set(h.testId, list);
  }
  const previous = await prisma.automationRun.findFirst({
    where: { projectId: run.projectId, sourceId: run.sourceId, branch: run.branch, startedAt: { lt: run.startedAt }, status: 'COMPLETED' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, number: true },
  });
  res.json({
    run: { ...run, key: keys.automationRun(run.number) },
    previousRun: previous ? { ...previous, key: keys.automationRun(previous.number) } : null,
    results: results.map((r) => ({ ...r, flaky: flakiness(byTest.get(r.testId) ?? []), issue: r.issue ? { ...r.issue, key: keys.issue(req.project!.key, r.issue.number) } : null })),
  });
});

automationRouter.delete('/runs/:id', requireRole('LEAD'), async (req, res) => {
  const run = await prisma.automationRun.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!run) throw notFound('Automation run');
  await prisma.$transaction(async (tx) => {
    await tx.automationRun.delete({ where: { id: run.id } });
    await audit(tx, req, { projectId: run.projectId, entityType: 'automation_run', entityId: run.id, action: 'deleted', changes: { key: keys.automationRun(run.number), name: run.name } });
  });
  res.json({ ok: true });
});

/** Compares two runs test-by-test: new failures, fixed tests, still failing, added/removed tests. */
automationRouter.get('/compare', async (req, res) => {
  const q = parse(z.object({ base: z.string(), head: z.string() }), req.query);
  const [base, head] = await Promise.all([
    prisma.automationRun.findFirst({ where: { id: q.base, projectId: req.project!.id } }),
    prisma.automationRun.findFirst({ where: { id: q.head, projectId: req.project!.id } }),
  ]);
  if (!base || !head) throw notFound('Automation run');
  const [br, hr] = await Promise.all([
    prisma.automationResult.findMany({ where: { runId: base.id }, include: { test: true } }),
    prisma.automationResult.findMany({ where: { runId: head.id }, include: { test: true } }),
  ]);
  const bm = new Map(br.map((r) => [r.testId, r]));
  const hm = new Map(hr.map((r) => [r.testId, r]));
  const row = (r: (typeof hr)[number], prev?: (typeof br)[number]) => ({ testId: r.testId, name: r.test.name, suite: r.test.suite, before: prev?.category ?? null, after: r.category, message: r.message, durationMs: r.durationMs, previousDurationMs: prev?.durationMs ?? null });
  const newFailures = [], fixed = [], stillFailing = [], added = [];
  for (const r of hr) {
    const p = bm.get(r.testId);
    if (!p) added.push(row(r));
    else if (r.category === 'FAILED' && p.category !== 'FAILED') newFailures.push(row(r, p));
    else if (r.category !== 'FAILED' && p.category === 'FAILED') fixed.push(row(r, p));
    else if (r.category === 'FAILED' && p.category === 'FAILED') stillFailing.push(row(r, p));
  }
  const removed = br.filter((r) => !hm.has(r.testId)).map((r) => ({ testId: r.testId, name: r.test.name, suite: r.test.suite, before: r.category }));
  res.json({
    base: { ...base, key: keys.automationRun(base.number) },
    head: { ...head, key: keys.automationRun(head.number) },
    newFailures,
    fixed,
    stillFailing,
    added,
    removed,
    durationDeltaMs: (head.durationMs ?? 0) - (base.durationMs ?? 0),
  });
});

/** Automation test catalog with flakiness (last 10 completed results per test). */
automationRouter.get('/tests', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q, 100);
  const where: Prisma.AutomationTestWhereInput = {
    projectId: req.project!.id,
    OR: q.q ? [{ name: { contains: q.q, mode: 'insensitive' } }, { suite: { contains: q.q, mode: 'insensitive' } }, { file: { contains: q.q, mode: 'insensitive' } }] : undefined,
  };
  const tests = await prisma.automationTest.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { results: { where: { run: { status: 'COMPLETED' } }, orderBy: { createdAt: 'desc' }, take: 10, select: { category: true, retries: true, createdAt: true, durationMs: true, runId: true } } },
    take: q.flaky === 'true' ? 5000 : undefined,
    skip: q.flaky === 'true' ? undefined : skip,
  });
  let rows = tests.map(({ results, ...t }) => ({
    ...t,
    lastStatus: results[0]?.category ?? null,
    lastRunAt: results[0]?.createdAt ?? null,
    avgDurationMs: results.length ? Math.round(results.reduce((a, r) => a + (r.durationMs ?? 0), 0) / results.length) : null,
    history: results.map((r) => r.category),
    flaky: flakiness(results),
  }));
  let total = await prisma.automationTest.count({ where });
  if (q.flaky === 'true') {
    rows = rows.filter((r) => r.flaky.flaky).sort((a, b) => b.flaky.score - a.flaky.score);
    total = rows.length;
    rows = rows.slice(skip, skip + take);
  } else rows = rows.slice(0, take);
  res.json({ total, page, pageSize, tests: rows });
});

automationRouter.get('/tests/:testId', async (req, res) => {
  const t = await prisma.automationTest.findFirst({ where: { id: String(req.params.testId), projectId: req.project!.id } });
  if (!t) throw notFound('Automation test');
  const results = await prisma.automationResult.findMany({
    where: { testId: t.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { status: true, run: { select: { id: true, number: true, name: true, branch: true, commitSha: true, startedAt: true } } },
  });
  res.json({
    test: t,
    flaky: flakiness(results.filter((r) => r.run).slice(0, 10)),
    results: results.map((r) => ({ ...r, run: { ...r.run, key: keys.automationRun(r.run.number) } })),
  });
});

/** Links an automation failure to an internal issue (or creates one). */
automationRouter.post('/results/:resultId/issue', requireRole('TESTER'), async (req, res) => {
  const r = await prisma.automationResult.findFirst({ where: { id: String(req.params.resultId), run: { projectId: req.project!.id } }, include: { test: true, run: true } });
  if (!r) throw notFound('Automation result');
  const b = parse(z.object({ issueId: z.string().optional(), title: z.string().trim().max(300).optional() }), req.body ?? {});
  const pid = req.project!.id;
  const issue = await prisma.$transaction(async (tx) => {
    let issueId = b.issueId;
    if (issueId) {
      if (!(await tx.issue.findFirst({ where: { id: issueId, projectId: pid } }))) throw badRequest('Unknown issue');
    } else {
      const number = await nextNumber(tx, pid, 'issueSeq');
      const created = await tx.issue.create({
        data: {
          projectId: pid,
          number,
          title: b.title || `Automated test failing: ${r.test.name}`.slice(0, 300),
          description: [`Failing in automation run ${keys.automationRun(r.run.number)} (${r.run.name}).`, r.run.branch && `Branch: ${r.run.branch}`, r.run.commitSha && `Commit: ${r.run.commitSha}`, r.message && `**Message**\n${r.message}`, r.stackTrace && `**Stack trace**\n\`\`\`\n${r.stackTrace.slice(0, 5000)}\n\`\`\``].filter(Boolean).join('\n\n'),
          reporterId: req.user!.id,
          milestoneId: r.run.milestoneId,
        },
      });
      await audit(tx, req, { projectId: pid, entityType: 'issue', entityId: created.id, action: 'created', changes: { fromAutomation: keys.automationRun(r.run.number) } });
      issueId = created.id;
    }
    await tx.automationResult.update({ where: { id: r.id }, data: { issueId } });
    return tx.issue.findUniqueOrThrow({ where: { id: issueId } });
  });
  res.status(201).json({ issue: { ...issue, key: keys.issue(req.project!.key, issue.number) } });
});

/** Daily pass/fail trend over completed runs. */
automationRouter.get('/trends', async (req, res) => {
  const q = req.query as Record<string, string>;
  const days = Math.min(180, Math.max(1, Number(q.days) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const runs = await prisma.automationRun.findMany({ where: { ...runWhere(req, q), status: 'COMPLETED', startedAt: { gte: since } }, orderBy: { startedAt: 'asc' } });
  const byDay = new Map<string, { date: string; runs: number; passed: number; failed: number; skipped: number; total: number }>();
  for (const r of runs) {
    const d = r.startedAt.toISOString().slice(0, 10);
    const e = byDay.get(d) ?? { date: d, runs: 0, passed: 0, failed: 0, skipped: 0, total: 0 };
    e.runs++;
    e.passed += r.passedCount;
    e.failed += r.failedCount;
    e.skipped += r.skippedCount;
    e.total += r.totalCount;
    byDay.set(d, e);
  }
  res.json({ days, trend: Array.from(byDay.values()).map((e) => ({ ...e, passRate: e.total - e.skipped > 0 ? Math.round((e.passed / (e.total - e.skipped)) * 1000) / 10 : null })) });
});
