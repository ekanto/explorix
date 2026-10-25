import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { parse } from '../lib/errors.js';
import { accessibleProjectIds } from '../middleware/access.js';
import { keys, liveElapsed, paging } from '../lib/util.js';
import { ACTIVE_STATUSES, DONE_STATUSES } from '../lib/sessionService.js';

export const globalRouter = Router();

/** Active org users (for pickers). Optional ?projectId restricts to project members. */
globalRouter.get('/users', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  if (projectId && !(await accessibleProjectIds(req)).includes(projectId)) return res.json({ users: [] });
  const users = await prisma.user.findMany({
    where: {
      deactivatedAt: null,
      orgMemberships: { some: { orgId: req.user!.orgId } },
      ...(projectId
        ? { OR: [{ projectMemberships: { some: { projectId } } }, { orgMemberships: { some: { orgId: req.user!.orgId, role: { in: ['OWNER', 'ADMIN'] } } } }] }
        : {}),
    },
    select: { id: true, name: true, email: true, avatarColor: true },
    orderBy: { name: 'asc' },
  });
  res.json({ users });
});

/** Everything assigned to or awaiting the current user across accessible projects. */
globalRouter.get('/my-work', async (req, res) => {
  const uid = req.user!.id;
  const pids = await accessibleProjectIds(req);
  const now = new Date();
  const soon = new Date(now.getTime() + 14 * 86_400_000);
  const project = { select: { id: true, key: true, name: true, color: true } };
  const [charters, sessions, reviews, findings, issues, runItems] = await Promise.all([
    prisma.charter.findMany({
      where: { projectId: { in: pids }, status: { not: 'ARCHIVED' }, assignees: { some: { userId: uid } }, project: { archivedAt: null } },
      include: { project, milestone: { select: { id: true, name: true, dueDate: true } }, sessions: { where: { testerId: uid }, select: { status: true } } },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: 50,
    }),
    prisma.exploratorySession.findMany({
      where: { projectId: { in: pids }, testerId: uid, archivedAt: null, status: { in: ['DRAFT', ...ACTIVE_STATUSES] }, project: { archivedAt: null } },
      include: { project, charter: { select: { id: true, number: true, title: true, mission: true } }, milestone: { select: { id: true, name: true, dueDate: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100,
    }),
    prisma.exploratorySession.findMany({
      where: { projectId: { in: pids }, status: 'IN_REVIEW', archivedAt: null, OR: [{ reviewerId: uid }, { reviewerId: null, testerId: { not: uid } }] },
      include: { project, tester: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { endedAt: 'asc' },
      take: 50,
    }),
    prisma.finding.findMany({
      where: { projectId: { in: pids }, status: { in: ['NEW', 'TRIAGED'] }, OR: [{ ownerId: uid }, { authorId: uid, ownerId: null }] },
      include: { project, classification: true, session: { select: { id: true, number: true } } },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    prisma.issue.findMany({
      where: { projectId: { in: pids }, assigneeId: uid, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      include: { project },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    }),
    prisma.testRunItem.findMany({
      where: { assigneeId: uid, run: { projectId: { in: pids }, status: 'ACTIVE' }, OR: [{ statusId: null }, { status: { category: 'RETEST' } }] },
      include: { testCase: { select: { id: true, number: true, title: true } }, run: { select: { id: true, number: true, name: true, milestone: { select: { dueDate: true } }, project } }, status: true },
      take: 100,
    }),
  ]);

  const sessionRows = sessions.map((s) => ({
    id: s.id,
    key: keys.session(s.number),
    title: s.title,
    status: s.status,
    priority: s.priority,
    dueDate: s.dueDate,
    timeboxMinutes: s.timeboxMinutes,
    elapsedSeconds: liveElapsed(s, now),
    project: s.project,
    charter: { ...s.charter, key: keys.charter(s.charter.number) },
    milestone: s.milestone,
    overdue: !!s.dueDate && s.dueDate < now,
  }));
  const charterRows = charters.map((c) => ({
    id: c.id,
    key: keys.charter(c.number),
    title: c.title,
    mission: c.mission,
    priority: c.priority,
    riskLevel: c.riskLevel,
    status: c.status,
    project: c.project,
    milestone: c.milestone,
    mySessions: c.sessions.length,
    myCompletedSessions: c.sessions.filter((s) => DONE_STATUSES.includes(s.status)).length,
  }));
  const runRows = runItems.map((i) => ({
    id: i.id,
    runId: i.run.id,
    runKey: keys.testRun(i.run.number),
    runName: i.run.name,
    dueDate: i.run.milestone?.dueDate ?? null,
    project: i.run.project,
    testCase: { ...i.testCase, key: keys.testCase(i.testCase.number) },
    status: i.status,
    overdue: !!i.run.milestone?.dueDate && i.run.milestone.dueDate < now,
  }));

  type Due = { kind: string; id: string; key: string; title: string; dueDate: Date; project: { id: string; key: string }; link: string };
  const dated: Due[] = [
    ...sessionRows.filter((s) => s.dueDate).map((s) => ({ kind: 'session', id: s.id, key: s.key, title: s.title, dueDate: s.dueDate!, project: s.project, link: `/projects/${s.project.id}/sessions/${s.id}` })),
    ...charterRows.filter((c) => c.milestone?.dueDate && c.myCompletedSessions === 0).map((c) => ({ kind: 'charter', id: c.id, key: c.key, title: c.title, dueDate: c.milestone!.dueDate!, project: c.project, link: `/projects/${c.project.id}/charters/${c.id}` })),
    ...Array.from(new Map(runRows.filter((r) => r.dueDate).map((r) => [r.runId, r])).values()).map((r) => ({ kind: 'test_run', id: r.runId, key: r.runKey, title: r.runName, dueDate: r.dueDate!, project: r.project, link: `/projects/${r.project.id}/test-runs/${r.runId}` })),
  ].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  res.json({
    counts: {
      activeSessions: sessionRows.filter((s) => ACTIVE_STATUSES.includes(s.status)).length,
      assignedCharters: charterRows.length,
      reviews: reviews.length,
      openFindings: findings.length,
      issues: issues.length,
      testsToRun: runRows.length,
      overdue: dated.filter((d) => d.dueDate < now).length,
    },
    activeSessions: sessionRows.filter((s) => ACTIVE_STATUSES.includes(s.status)),
    draftSessions: sessionRows.filter((s) => s.status === 'DRAFT'),
    charters: charterRows,
    reviews: reviews.map((s) => ({ id: s.id, key: keys.session(s.number), title: s.title, project: s.project, tester: s.tester, endedAt: s.endedAt })),
    findings: findings.map((f) => ({
      id: f.id,
      key: keys.finding(f.number),
      title: f.title,
      severity: f.severity,
      status: f.status,
      classification: { key: f.classification.key, name: f.classification.name, color: f.classification.color },
      project: f.project,
      session: f.session ? { id: f.session.id, key: keys.session(f.session.number) } : null,
      createdAt: f.createdAt,
      owned: f.ownerId === uid,
    })),
    issues: issues.map((i) => ({ id: i.id, key: keys.issue(i.project.key, i.number), title: i.title, status: i.status, severity: i.severity, priority: i.priority, project: i.project })),
    testRunItems: runRows,
    overdue: dated.filter((d) => d.dueDate < now),
    upcoming: dated.filter((d) => d.dueDate >= now && d.dueDate <= soon),
  });
});

// ---------------- Notifications ----------------

globalRouter.get('/notifications', async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query as Record<string, unknown>, 30);
  const where = { userId: req.user!.id, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { actor: { select: { id: true, name: true, avatarColor: true } }, project: { select: { id: true, key: true, name: true } } },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ items, total, unread, page, pageSize });
});

globalRouter.post('/notifications/read', async (req, res) => {
  const body = parse(z.object({ ids: z.array(z.string()).max(500).optional(), all: z.boolean().optional() }), req.body);
  const r = await prisma.notification.updateMany({
    where: { userId: req.user!.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  });
  res.json({ updated: r.count });
});

// ---------------- Search ----------------

/** Cross-entity search across accessible projects. Matches titles and display keys (e.g. "S-12", "CH-3"). */
globalRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  if (q.length < 2) return res.json({ results: [] });
  let pids = await accessibleProjectIds(req);
  if (typeof req.query.projectId === 'string') pids = pids.filter((p) => p === req.query.projectId);
  const keyMatch = /^([A-Z]+)-(\d+)$/i.exec(q);
  const num = keyMatch ? Number(keyMatch[2]) : /^\d+$/.test(q) ? Number(q) : undefined;
  const prefix = keyMatch?.[1].toUpperCase();
  const text = { contains: q, mode: 'insensitive' as const };
  const byNum = (p: string) => (num !== undefined && (!prefix || prefix === p) ? [{ number: num }] : []);
  const project = { select: { id: true, key: true, name: true } };
  const take = 8;
  const [charters, sessions, findings, issues, testCases, requirements] = await Promise.all([
    prisma.charter.findMany({ where: { projectId: { in: pids }, OR: [{ title: text }, { mission: text }, ...byNum('CH')] }, include: { project }, take, orderBy: { updatedAt: 'desc' } }),
    prisma.exploratorySession.findMany({ where: { projectId: { in: pids }, OR: [{ title: text }, ...byNum('S')] }, include: { project }, take, orderBy: { updatedAt: 'desc' } }),
    prisma.finding.findMany({ where: { projectId: { in: pids }, OR: [{ title: text }, { description: text }, ...byNum('F')] }, include: { project }, take, orderBy: { updatedAt: 'desc' } }),
    prisma.issue.findMany({
      where: { projectId: { in: pids }, OR: [{ title: text }, ...(num !== undefined ? [{ number: num, ...(prefix ? { project: { key: prefix } } : {}) }] : [])] },
      include: { project },
      take,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.testCase.findMany({ where: { projectId: { in: pids }, archivedAt: null, OR: [{ title: text }, ...byNum('C')] }, include: { project }, take, orderBy: { updatedAt: 'desc' } }),
    prisma.requirement.findMany({ where: { projectId: { in: pids }, OR: [{ title: text }, { externalKey: text }, ...byNum('REQ')] }, include: { project }, take, orderBy: { updatedAt: 'desc' } }),
  ]);
  const base = (p: { id: string }) => `/projects/${p.id}`;
  res.json({
    results: [
      ...charters.map((c) => ({ type: 'charter', id: c.id, key: keys.charter(c.number), title: c.title, subtitle: c.mission, project: c.project, link: `${base(c.project)}/charters/${c.id}` })),
      ...sessions.map((s) => ({ type: 'session', id: s.id, key: keys.session(s.number), title: s.title, subtitle: s.status, project: s.project, link: `${base(s.project)}/sessions/${s.id}` })),
      ...findings.map((f) => ({ type: 'finding', id: f.id, key: keys.finding(f.number), title: f.title, subtitle: f.status, project: f.project, link: `${base(f.project)}/findings/${f.id}` })),
      ...issues.map((i) => ({ type: 'issue', id: i.id, key: keys.issue(i.project.key, i.number), title: i.title, subtitle: i.status, project: i.project, link: `${base(i.project)}/issues/${i.id}` })),
      ...testCases.map((t) => ({ type: 'test_case', id: t.id, key: keys.testCase(t.number), title: t.title, subtitle: t.status, project: t.project, link: `${base(t.project)}/test-cases/${t.id}` })),
      ...requirements.map((r) => ({ type: 'requirement', id: r.id, key: keys.requirement(r.number), title: r.title, subtitle: r.externalKey ?? r.status, project: r.project, link: `${base(r.project)}/requirements/${r.id}` })),
    ],
  });
});

// ---------------- Overview ----------------

/** Cross-project summary for the Overview page. */
globalRouter.get('/overview', async (req, res) => {
  const pids = await accessibleProjectIds(req);
  const [projects, sessionGroups, openFindings, openIssues, recentSessions, recentFindings, activity] = await Promise.all([
    prisma.project.findMany({ where: { id: { in: pids }, archivedAt: null }, select: { id: true, key: true, name: true, color: true, description: true }, orderBy: { name: 'asc' } }),
    prisma.exploratorySession.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: pids }, archivedAt: null }, _count: true }),
    prisma.finding.groupBy({ by: ['projectId'], where: { projectId: { in: pids }, status: { in: ['NEW', 'TRIAGED'] } }, _count: true }),
    prisma.issue.groupBy({ by: ['projectId'], where: { projectId: { in: pids }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, _count: true }),
    prisma.exploratorySession.findMany({
      where: { projectId: { in: pids }, archivedAt: null, status: { in: ACTIVE_STATUSES } },
      include: { project: { select: { id: true, key: true, name: true, color: true } }, tester: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
    prisma.finding.findMany({
      where: { projectId: { in: pids } },
      include: { project: { select: { id: true, key: true, name: true, color: true } }, classification: true, author: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.auditEvent.findMany({
      where: { projectId: { in: pids } },
      include: { actor: { select: { id: true, name: true, avatarColor: true } }, project: { select: { id: true, key: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  const count = (pid: string, statuses: readonly string[]) => sessionGroups.filter((g) => g.projectId === pid && statuses.includes(g.status)).reduce((a, g) => a + g._count, 0);
  res.json({
    projects: projects.map((p) => ({
      ...p,
      activeSessions: count(p.id, ACTIVE_STATUSES),
      completedSessions: count(p.id, DONE_STATUSES),
      openFindings: openFindings.find((g) => g.projectId === p.id)?._count ?? 0,
      openIssues: openIssues.find((g) => g.projectId === p.id)?._count ?? 0,
    })),
    activeSessions: recentSessions.map((s) => ({ id: s.id, key: keys.session(s.number), title: s.title, status: s.status, project: s.project, tester: s.tester, elapsedSeconds: liveElapsed(s), timeboxMinutes: s.timeboxMinutes })),
    recentFindings: recentFindings.map((f) => ({
      id: f.id,
      key: keys.finding(f.number),
      title: f.title,
      severity: f.severity,
      status: f.status,
      classification: { key: f.classification.key, name: f.classification.name, color: f.classification.color },
      project: f.project,
      author: f.author,
      createdAt: f.createdAt,
    })),
    activity,
  });
});
