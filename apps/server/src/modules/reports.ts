import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toCsv } from '../lib/csv.js';
import { keys, liveElapsed } from '../lib/util.js';
import { requirementCoverage } from './requirements.js';

export const reportsRouter = Router({ mergeParams: true });

const STARTED = ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED', 'COMPLETED', 'IN_REVIEW', 'APPROVED', 'ABANDONED'] as const;
const COMPLETED = ['COMPLETED', 'IN_REVIEW', 'APPROVED'] as const;
const ACTIVE = ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'] as const;
const OPEN_FINDING = ['NEW', 'TRIAGED'] as const;
const OPEN_ISSUE = ['OPEN', 'IN_PROGRESS'] as const;

/**
 * Metric definitions (also documented in docs/METRICS.md). All values are computed from stored records at request time.
 * "measured" = derived from tracked timestamps/records; "estimate" = from user-entered timeboxes/estimates.
 */
export const METRIC_DEFINITIONS = {
  totalCharters: { kind: 'measured', definition: 'Non-archived charters in scope.' },
  activeSessions: { kind: 'measured', definition: 'Sessions in progress, paused, or with changes requested (not archived).' },
  completedSessions: { kind: 'measured', definition: 'Sessions completed, in review, or approved (not archived).' },
  completionRate: { kind: 'measured', definition: 'completed ÷ started sessions, where started = any status other than Draft. Abandoned sessions count as started but not completed.' },
  effortHours: { kind: 'measured', definition: 'Sum of timer-tracked session time (paused time excluded) for sessions in scope.' },
  estimatedVsActual: { kind: 'estimate vs measured', definition: 'For completed sessions: sum of timeboxes (estimate) vs. sum of tracked time (measured). Ratio = actual ÷ estimate.' },
  unresolvedFindings: { kind: 'measured', definition: 'Findings with status New or Triaged.' },
  confirmedDefects: { kind: 'measured', definition: 'Findings whose classification is marked "is defect" (default: Confirmed defect), any status except Duplicate.' },
  outstandingRisks: { kind: 'measured', definition: 'Open findings classified as Risk, plus high/critical-risk charters with no completed session.' },
  requirementCoverage: { kind: 'measured', definition: 'Requirements (excluding deprecated) with ≥1 linked charter that has a completed session or ≥1 linked test case with an executed result ÷ all such requirements.' },
  manualExecution: { kind: 'measured', definition: 'Latest status of each test-run item in scope (active and closed runs). Executed = any status other than Untested/Retest. Pass rate = passed ÷ executed.' },
  automationPassRate: { kind: 'measured', definition: 'passed ÷ (total − skipped) across completed automation runs in scope.' },
} as const;

interface Filters {
  milestoneId?: string;
  testerId?: string;
  from?: Date;
  to?: Date;
}

function readFilters(req: Request): Filters {
  const q = req.query as Record<string, string>;
  const parseDate = (s: string | undefined, end = false) => {
    if (!s) return undefined;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : s);
    if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date: ${s}`);
    return d;
  };
  return { milestoneId: q.milestoneId || undefined, testerId: q.testerId === 'me' ? req.user!.id : q.testerId || undefined, from: parseDate(q.from), to: parseDate(q.to, true) };
}

const range = (f: Filters) => (f.from || f.to ? { gte: f.from, lte: f.to } : undefined);

export async function computeDashboard(projectId: string, f: Filters) {
  const sessionWhere: Prisma.ExploratorySessionWhereInput = { projectId, archivedAt: null, milestoneId: f.milestoneId, testerId: f.testerId, createdAt: range(f) };
  const findingWhere: Prisma.FindingWhereInput = {
    projectId,
    createdAt: range(f),
    ...(f.milestoneId ? { session: { milestoneId: f.milestoneId } } : {}),
    ...(f.testerId ? { authorId: f.testerId } : {}),
  };
  const charterWhere: Prisma.CharterWhereInput = { projectId, status: { not: 'ARCHIVED' }, milestoneId: f.milestoneId, createdAt: range(f), ...(f.testerId ? { assignees: { some: { userId: f.testerId } } } : {}) };

  const [sessions, charterCount, chartersByStatus, findings, classifications, testers, milestones, runItems, autoRuns, riskCharters, requirements] = await Promise.all([
    prisma.exploratorySession.findMany({
      where: sessionWhere,
      select: { id: true, status: true, elapsedSeconds: true, lastResumedAt: true, timeboxMinutes: true, testerId: true, milestoneId: true, createdAt: true, endedAt: true, charter: { select: { target: true } } },
    }),
    prisma.charter.count({ where: charterWhere }),
    prisma.charter.groupBy({ by: ['status'], where: { ...charterWhere, status: undefined }, _count: true }),
    prisma.finding.findMany({
      where: findingWhere,
      select: { id: true, status: true, severity: true, classificationId: true, createdAt: true, charter: { select: { target: true } }, session: { select: { milestoneId: true } } },
    }),
    prisma.findingClassification.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
    prisma.user.findMany({ where: { projectMemberships: { some: { projectId } } }, select: { id: true, name: true, avatarColor: true } }),
    prisma.milestone.findMany({ where: { projectId }, orderBy: [{ dueDate: 'asc' }, { name: 'asc' }] }),
    prisma.testRunItem.findMany({
      where: { run: { projectId, milestoneId: f.milestoneId, createdAt: range(f) }, ...(f.testerId ? { assigneeId: f.testerId } : {}) },
      select: { status: { select: { category: true } } },
    }),
    prisma.automationRun.findMany({
      where: { projectId, status: 'COMPLETED', milestoneId: f.milestoneId, startedAt: range(f) ?? { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { startedAt: 'asc' },
      select: { id: true, number: true, name: true, startedAt: true, totalCount: true, passedCount: true, failedCount: true, skippedCount: true, branch: true },
    }),
    prisma.charter.findMany({
      where: { ...charterWhere, riskLevel: { in: ['HIGH', 'CRITICAL'] }, sessions: { none: { status: { in: [...COMPLETED] } } } },
      select: { id: true, number: true, title: true, riskLevel: true },
    }),
    requirementCoverage(projectId),
  ]);

  const now = new Date();
  const classById = new Map(classifications.map((c) => [c.id, c]));
  const started = sessions.filter((s) => (STARTED as readonly string[]).includes(s.status));
  const completed = sessions.filter((s) => (COMPLETED as readonly string[]).includes(s.status));
  const effortSeconds = sessions.reduce((a, s) => a + liveElapsed(s, now), 0);
  const completedEstimate = completed.reduce((a, s) => a + s.timeboxMinutes * 60, 0);
  const completedActual = completed.reduce((a, s) => a + s.elapsedSeconds, 0);
  const isDefect = (cid: string) => !!classById.get(cid)?.isDefect;
  const openFindings = findings.filter((x) => (OPEN_FINDING as readonly string[]).includes(x.status));
  const defects = findings.filter((x) => isDefect(x.classificationId) && x.status !== 'DUPLICATE');
  const riskClass = classifications.find((c) => c.key === 'risk');
  const openRiskFindings = riskClass ? openFindings.filter((x) => x.classificationId === riskClass.id).length : 0;

  const reqValues = Array.from(requirements.values());
  const reqRows = await prisma.requirement.findMany({ where: { projectId, status: { not: 'DEPRECATED' } }, select: { id: true } });
  const activeReq = reqRows.map((r) => requirements.get(r.id)!).filter(Boolean);
  const manual = { total: runItems.length, passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0, untested: 0 };
  for (const i of runItems) {
    const c = i.status?.category ?? 'UNTESTED';
    manual[c.toLowerCase() as keyof typeof manual]++;
  }
  const executed = manual.total - manual.untested - manual.retest;
  const autoTotals = autoRuns.reduce((a, r) => ({ total: a.total + r.totalCount, passed: a.passed + r.passedCount, failed: a.failed + r.failedCount, skipped: a.skipped + r.skippedCount }), { total: 0, passed: 0, failed: 0, skipped: 0 });
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

  const byFeature = new Map<string, number>();
  for (const d of defects) {
    const k = d.charter?.target?.trim() || 'Unspecified';
    byFeature.set(k, (byFeature.get(k) ?? 0) + 1);
  }
  const byMilestoneDefects = new Map<string, number>();
  for (const d of defects) {
    const k = d.session?.milestoneId ?? 'none';
    byMilestoneDefects.set(k, (byMilestoneDefects.get(k) ?? 0) + 1);
  }
  const msName = (id: string) => (id === 'none' ? 'No milestone' : milestones.find((m) => m.id === id)?.name ?? 'Unknown');

  // Weekly session/finding activity for trend charts.
  const weekKey = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return x.toISOString().slice(0, 10);
  };
  const weekly = new Map<string, { week: string; sessions: number; findings: number; effortHours: number }>();
  for (const s of sessions) {
    const w = weekKey(s.createdAt);
    const e = weekly.get(w) ?? { week: w, sessions: 0, findings: 0, effortHours: 0 };
    e.sessions++;
    e.effortHours += liveElapsed(s, now) / 3600;
    weekly.set(w, e);
  }
  for (const x of findings) {
    const w = weekKey(x.createdAt);
    const e = weekly.get(w) ?? { week: w, sessions: 0, findings: 0, effortHours: 0 };
    e.findings++;
    weekly.set(w, e);
  }

  return {
    generatedAt: now.toISOString(),
    filters: { milestoneId: f.milestoneId ?? null, testerId: f.testerId ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null },
    definitions: METRIC_DEFINITIONS,
    kpis: {
      totalCharters: charterCount,
      totalSessions: sessions.length,
      activeSessions: sessions.filter((s) => (ACTIVE as readonly string[]).includes(s.status)).length,
      completedSessions: completed.length,
      abandonedSessions: sessions.filter((s) => s.status === 'ABANDONED').length,
      draftSessions: sessions.filter((s) => s.status === 'DRAFT').length,
      completionRate: pct(completed.length, started.length),
      effortHours: Math.round((effortSeconds / 3600) * 10) / 10,
      estimatedHoursCompleted: Math.round((completedEstimate / 3600) * 10) / 10,
      actualHoursCompleted: Math.round((completedActual / 3600) * 10) / 10,
      actualToEstimateRatio: completedEstimate ? Math.round((completedActual / completedEstimate) * 100) / 100 : null,
      totalFindings: findings.length,
      unresolvedFindings: openFindings.length,
      confirmedDefects: defects.length,
      outstandingRisks: openRiskFindings + riskCharters.length,
      requirementCoverage: pct(activeReq.filter((r) => r.covered).length, activeReq.length),
      requirementsTotal: activeReq.length,
      manualExecutedPct: pct(executed, manual.total),
      manualPassRate: pct(manual.passed, executed),
      automationPassRate: pct(autoTotals.passed, autoTotals.total - autoTotals.skipped),
      automationRuns: autoRuns.length,
    },
    sessionsByStatus: Object.entries(sessions.reduce<Record<string, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {})).map(([status, count]) => ({ status, count })),
    chartersByStatus: chartersByStatus.map((c) => ({ status: c.status, count: c._count })),
    findingsByClassification: classifications
      .map((c) => ({ id: c.id, key: c.key, name: c.name, color: c.color, isDefect: c.isDefect, count: findings.filter((x) => x.classificationId === c.id).length, open: openFindings.filter((x) => x.classificationId === c.id).length }))
      .filter((c) => c.count > 0),
    findingsBySeverity: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'].map((s) => ({ severity: s, count: findings.filter((x) => x.severity === s).length, open: openFindings.filter((x) => x.severity === s).length })),
    defectsByFeature: Array.from(byFeature.entries()).map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    defectsByRelease: Array.from(byMilestoneDefects.entries()).map(([id, count]) => ({ milestoneId: id === 'none' ? null : id, milestone: msName(id), count })),
    byTester: testers
      .map((t) => {
        const mine = sessions.filter((s) => s.testerId === t.id);
        return { ...t, sessions: mine.length, completed: mine.filter((s) => (COMPLETED as readonly string[]).includes(s.status)).length, effortHours: Math.round((mine.reduce((a, s) => a + liveElapsed(s, now), 0) / 3600) * 10) / 10 };
      })
      .filter((t) => t.sessions > 0)
      .sort((a, b) => b.effortHours - a.effortHours),
    effortByMilestone: Array.from(
      sessions.reduce((m, s) => m.set(s.milestoneId ?? 'none', (m.get(s.milestoneId ?? 'none') ?? 0) + liveElapsed(s, now)), new Map<string, number>()).entries(),
    ).map(([id, sec]) => ({ milestoneId: id === 'none' ? null : id, milestone: msName(id), effortHours: Math.round((sec / 3600) * 10) / 10 })),
    manualExecution: manual,
    automationTrend: autoRuns.map((r) => ({ id: r.id, key: keys.automationRun(r.number), name: r.name, date: r.startedAt, branch: r.branch, passed: r.passedCount, failed: r.failedCount, skipped: r.skippedCount, passRate: pct(r.passedCount, r.totalCount - r.skippedCount) })),
    weeklyActivity: Array.from(weekly.values()).sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ ...w, effortHours: Math.round(w.effortHours * 10) / 10 })),
    riskCharters: riskCharters.map((c) => ({ ...c, key: keys.charter(c.number) })),
    requirementStatus: ['passing', 'partial', 'failing', 'untested'].map((s) => ({ status: s, count: reqValues.filter((r) => r.status === s).length })),
  };
}

reportsRouter.get('/dashboard', async (req, res) => {
  const data = await computeDashboard(req.project!.id, readFilters(req));
  if (req.query.format === 'json' && req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${req.project!.key}-dashboard.json"`);
  res.json(data);
});

type Level = 'pass' | 'warn' | 'fail' | 'na';

/**
 * Release readiness for a milestone. Each indicator has explicit thresholds; overall = worst indicator
 * (indicators without data are "na" and do not fail the release, but are listed so gaps are visible).
 */
export async function computeReadiness(projectId: string, milestoneId: string) {
  const m = await prisma.milestone.findFirst({ where: { id: milestoneId, projectId } });
  if (!m) throw notFound('Milestone');
  const [blockers, unresolvedDefects, items, latestAuto, charters, sessions] = await Promise.all([
    prisma.issue.findMany({ where: { projectId, milestoneId, status: { in: [...OPEN_ISSUE] }, severity: { in: ['BLOCKER', 'CRITICAL'] } }, select: { id: true, number: true, title: true, severity: true } }),
    prisma.finding.findMany({
      where: { projectId, status: { in: [...OPEN_FINDING] }, session: { milestoneId }, classification: { key: { in: ['potential_defect', 'confirmed_defect'] } } },
      select: { id: true, number: true, title: true, severity: true },
    }),
    prisma.testRunItem.findMany({ where: { run: { projectId, milestoneId } }, select: { status: { select: { category: true } } } }),
    prisma.automationRun.findFirst({ where: { projectId, milestoneId, status: 'COMPLETED' }, orderBy: { startedAt: 'desc' } }),
    prisma.charter.findMany({ where: { projectId, milestoneId, status: { not: 'ARCHIVED' } }, select: { id: true, sessions: { where: { status: { in: [...COMPLETED] } }, select: { id: true } } } }),
    prisma.exploratorySession.findMany({ where: { projectId, milestoneId, archivedAt: null }, select: { status: true, elapsedSeconds: true, lastResumedAt: true } }),
  ]);
  const executed = items.filter((i) => i.status && !['UNTESTED', 'RETEST'].includes(i.status.category));
  const passed = executed.filter((i) => i.status!.category === 'PASSED').length;
  const execPct = items.length ? (executed.length / items.length) * 100 : null;
  const passPct = executed.length ? (passed / executed.length) * 100 : null;
  const autoPct = latestAuto && latestAuto.totalCount - latestAuto.skippedCount > 0 ? (latestAuto.passedCount / (latestAuto.totalCount - latestAuto.skippedCount)) * 100 : null;
  const explored = charters.length ? (charters.filter((c) => c.sessions.length).length / charters.length) * 100 : null;
  const grade = (v: number | null, pass: number, warn: number): Level => (v === null ? 'na' : v >= pass ? 'pass' : v >= warn ? 'warn' : 'fail');
  const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  const indicators = [
    { key: 'blockers', label: 'No open blocker/critical issues', value: blockers.length, unit: 'open', level: (blockers.length ? 'fail' : 'pass') as Level, threshold: '0 open', items: blockers.map((b) => ({ ...b, key: `#${b.number}` })) },
    { key: 'unresolved_defects', label: 'Untriaged potential/confirmed defects from sessions', value: unresolvedDefects.length, unit: 'findings', level: (unresolvedDefects.length === 0 ? 'pass' : unresolvedDefects.length <= 3 ? 'warn' : 'fail') as Level, threshold: '0 = pass, ≤3 = warn', items: unresolvedDefects.map((d) => ({ ...d, key: keys.finding(d.number) })) },
    { key: 'charter_exploration', label: 'Milestone charters explored (≥1 completed session)', value: r1(explored), unit: '%', level: grade(explored, 80, 50), threshold: '≥80% pass, ≥50% warn' },
    { key: 'manual_execution', label: 'Manual tests executed', value: r1(execPct), unit: '%', level: grade(execPct, 90, 70), threshold: '≥90% pass, ≥70% warn' },
    { key: 'manual_pass_rate', label: 'Manual pass rate', value: r1(passPct), unit: '%', level: grade(passPct, 95, 80), threshold: '≥95% pass, ≥80% warn' },
    { key: 'automation_pass_rate', label: 'Latest automation run pass rate', value: r1(autoPct), unit: '%', level: grade(autoPct, 95, 80), threshold: '≥95% pass, ≥80% warn', run: latestAuto ? { id: latestAuto.id, key: keys.automationRun(latestAuto.number), name: latestAuto.name } : null },
  ];
  const order: Level[] = ['fail', 'warn', 'pass'];
  const graded = indicators.filter((i) => i.level !== 'na');
  const overall: Level | 'insufficient_data' = graded.length === 0 ? 'insufficient_data' : order.find((l) => graded.some((i) => i.level === l))!;
  return {
    milestone: m,
    overall,
    indicators,
    effortHours: Math.round((sessions.reduce((a, s) => a + liveElapsed(s), 0) / 3600) * 10) / 10,
    sessions: sessions.length,
  };
}

reportsRouter.get('/readiness', async (req, res) => {
  const milestones = await prisma.milestone.findMany({ where: { projectId: req.project!.id, status: { in: ['PLANNED', 'ACTIVE'] } }, orderBy: [{ dueDate: 'asc' }, { name: 'asc' }] });
  const ids = req.query.milestoneId ? [String(req.query.milestoneId)] : milestones.map((m) => m.id);
  const readiness = [];
  for (const id of ids) readiness.push(await computeReadiness(req.project!.id, id));
  res.json({ readiness });
});

/** Deterministic coverage-gap analysis (no AI required). */
export async function computeCoverageGaps(projectId: string) {
  const staleBefore = new Date(Date.now() - 30 * 86_400_000);
  const [unexplored, stale, cov, reqs, neverExecuted, targets] = await Promise.all([
    prisma.charter.findMany({
      where: { projectId, status: { not: 'ARCHIVED' }, sessions: { none: { status: { in: [...COMPLETED] } } } },
      select: { id: true, number: true, title: true, riskLevel: true, priority: true, target: true },
      orderBy: [{ riskLevel: 'desc' }, { priority: 'desc' }],
      take: 50,
    }),
    prisma.charter.findMany({
      where: { projectId, status: { not: 'ARCHIVED' }, sessions: { some: { status: { in: [...COMPLETED] } }, none: { endedAt: { gte: staleBefore } } } },
      select: { id: true, number: true, title: true, riskLevel: true, sessions: { select: { endedAt: true }, orderBy: { endedAt: 'desc' }, take: 1 } },
      take: 50,
    }),
    requirementCoverage(projectId),
    prisma.requirement.findMany({ where: { projectId, status: { not: 'DEPRECATED' } }, select: { id: true, number: true, title: true, priority: true } }),
    prisma.testCase.findMany({ where: { projectId, archivedAt: null, status: 'ACTIVE', runItems: { none: { statusId: { not: null } } } }, select: { id: true, number: true, title: true, priority: true }, take: 50 }),
    prisma.exploratorySession.findMany({ where: { projectId, archivedAt: null }, select: { elapsedSeconds: true, lastResumedAt: true, status: true, charter: { select: { target: true } }, _count: { select: { findings: true } } } }),
  ]);
  const featureEffort = new Map<string, { feature: string; effortHours: number; sessions: number; findings: number }>();
  for (const s of targets) {
    const k = s.charter.target?.trim() || 'Unspecified';
    const e = featureEffort.get(k) ?? { feature: k, effortHours: 0, sessions: 0, findings: 0 };
    e.effortHours += liveElapsed(s) / 3600;
    e.sessions++;
    e.findings += s._count.findings;
    featureEffort.set(k, e);
  }
  return {
    unexploredCharters: unexplored.map((c) => ({ ...c, key: keys.charter(c.number) })),
    staleCharters: stale.map((c) => ({ id: c.id, key: keys.charter(c.number), title: c.title, riskLevel: c.riskLevel, lastExploredAt: c.sessions[0]?.endedAt ?? null })),
    uncoveredRequirements: reqs.filter((r) => !cov.get(r.id)?.covered).map((r) => ({ ...r, key: keys.requirement(r.number) })),
    neverExecutedTestCases: neverExecuted.map((t) => ({ ...t, key: keys.testCase(t.number) })),
    featureEffort: Array.from(featureEffort.values())
      .map((e) => ({ ...e, effortHours: Math.round(e.effortHours * 10) / 10, findingsPerHour: e.effortHours > 0 ? Math.round((e.findings / e.effortHours) * 10) / 10 : null }))
      .sort((a, b) => a.effortHours - b.effortHours),
  };
}

reportsRouter.get('/coverage-gaps', async (req, res) => {
  res.json(await computeCoverageGaps(req.project!.id));
});

/** Tabular exports for reporting (CSV or JSON). */
reportsRouter.get('/export/:dataset', async (req, res) => {
  const f = readFilters(req);
  const pid = req.project!.id;
  const format = req.query.format === 'json' ? 'json' : 'csv';
  const name = `${req.project!.key}-${req.params.dataset}`;
  const send = <T>(rows: T[], columns: { header: string; value: (r: T) => unknown }[]) => {
    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`);
      return res.json({ exportedAt: new Date().toISOString(), project: req.project!.key, filters: f, count: rows.length, rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, c.value(r)]))) });
    }
    res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    return res.send(toCsv(rows, columns));
  };
  switch (req.params.dataset) {
    case 'sessions': {
      const rows = await prisma.exploratorySession.findMany({
        where: { projectId: pid, milestoneId: f.milestoneId, testerId: f.testerId, createdAt: range(f) },
        orderBy: { number: 'asc' },
        include: { charter: true, tester: true, milestone: true, _count: { select: { findings: true } } },
      });
      return send(rows, [
        { header: 'Key', value: (s) => keys.session(s.number) },
        { header: 'Title', value: (s) => s.title },
        { header: 'Charter', value: (s) => keys.charter(s.charter.number) },
        { header: 'Mission', value: (s) => s.charter.mission },
        { header: 'Status', value: (s) => s.status },
        { header: 'Tester', value: (s) => s.tester?.name ?? null },
        { header: 'Milestone', value: (s) => s.milestone?.name ?? null },
        { header: 'Timebox (min)', value: (s) => s.timeboxMinutes },
        { header: 'Tracked (min)', value: (s) => Math.round(liveElapsed(s) / 60) },
        { header: 'Findings', value: (s) => s._count.findings },
        { header: 'Setup %', value: (s) => s.setupPercent },
        { header: 'Test %', value: (s) => s.testPercent },
        { header: 'Bug %', value: (s) => s.bugPercent },
        { header: 'Started', value: (s) => s.startedAt },
        { header: 'Ended', value: (s) => s.endedAt },
        { header: 'Archived', value: (s) => s.archivedAt },
      ]);
    }
    case 'charters': {
      const rows = await prisma.charter.findMany({
        where: { projectId: pid, milestoneId: f.milestoneId, createdAt: range(f) },
        orderBy: { number: 'asc' },
        include: { milestone: true, sessions: { select: { status: true, elapsedSeconds: true, lastResumedAt: true } }, _count: { select: { findings: true } } },
      });
      return send(rows, [
        { header: 'Key', value: (c) => keys.charter(c.number) },
        { header: 'Title', value: (c) => c.title },
        { header: 'Mission', value: (c) => c.mission },
        { header: 'Target', value: (c) => c.target },
        { header: 'Status', value: (c) => c.status },
        { header: 'Priority', value: (c) => c.priority },
        { header: 'Risk', value: (c) => c.riskLevel },
        { header: 'Milestone', value: (c) => c.milestone?.name ?? null },
        { header: 'Sessions', value: (c) => c.sessions.length },
        { header: 'Completed sessions', value: (c) => c.sessions.filter((s) => (COMPLETED as readonly string[]).includes(s.status)).length },
        { header: 'Tracked (min)', value: (c) => Math.round(c.sessions.reduce((a, s) => a + liveElapsed(s), 0) / 60) },
        { header: 'Findings', value: (c) => c._count.findings },
        { header: 'Created', value: (c) => c.createdAt },
      ]);
    }
    case 'effort-by-tester': {
      const d = await computeDashboard(pid, f);
      return send(d.byTester, [
        { header: 'Tester', value: (t) => t.name },
        { header: 'Sessions', value: (t) => t.sessions },
        { header: 'Completed', value: (t) => t.completed },
        { header: 'Effort (h)', value: (t) => t.effortHours },
      ]);
    }
    case 'kpis': {
      const d = await computeDashboard(pid, f);
      const rows = Object.entries(d.kpis).map(([metric, value]) => ({ metric, value, definition: (METRIC_DEFINITIONS as Record<string, { definition: string }>)[metric]?.definition ?? '' }));
      return send(rows, [
        { header: 'Metric', value: (r) => r.metric },
        { header: 'Value', value: (r) => r.value },
        { header: 'Definition', value: (r) => r.definition },
      ]);
    }
    default:
      throw notFound('Export dataset');
  }
});
