import { Router, type Request } from 'express';
import type { Prisma, SessionStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { validateCustomFields } from '../lib/customFields.js';
import { notify } from '../lib/notify.js';
import { projectSettings } from '../lib/projectDefaults.js';
import {
  ACTIVE_STATUSES, DONE_STATUSES, addLog, assertCanEditContent, canOperate, createSessionFromCharter, getSessionOr404, isEditable, validateRefs,
} from '../lib/sessionService.js';
import { htmlToText, keys, liveElapsed, paging, resolveTagIds, sanitizeRichText, tagNames, toArray } from '../lib/util.js';
import { emitEvent } from '../lib/webhooks.js';
import { assertProjectMembers, hasRole, requireRole } from '../middleware/access.js';
import { launchBody } from './charters.js';

export const sessionsRouter = Router({ mergeParams: true });

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;

const VIEWS: Record<string, (req: Request) => Prisma.ExploratorySessionWhereInput> = {
  active: () => ({ status: { in: ACTIVE_STATUSES }, archivedAt: null }),
  completed: () => ({ status: { in: ['COMPLETED', 'APPROVED'] }, archivedAt: null }),
  draft: () => ({ status: 'DRAFT', archivedAt: null }),
  assigned: (req) => ({ testerId: req.user!.id, status: { in: ['DRAFT', ...ACTIVE_STATUSES] }, archivedAt: null }),
  review: () => ({ status: 'IN_REVIEW', archivedAt: null }),
  abandoned: () => ({ status: 'ABANDONED', archivedAt: null }),
  archived: () => ({ archivedAt: { not: null } }),
  all: () => ({ archivedAt: null }),
};

function serializeListItem(s: Prisma.ExploratorySessionGetPayload<{ include: typeof listInclude }>, now: Date) {
  const elapsed = liveElapsed(s, now);
  return {
    id: s.id,
    key: keys.session(s.number),
    number: s.number,
    title: s.title,
    status: s.status,
    priority: s.priority,
    charter: { id: s.charter.id, key: keys.charter(s.charter.number), title: s.charter.title },
    tester: s.tester,
    milestone: s.milestone,
    tags: tagNames(s.tags),
    timeboxMinutes: s.timeboxMinutes,
    elapsedSeconds: elapsed,
    overTimebox: elapsed > s.timeboxMinutes * 60,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    dueDate: s.dueDate,
    archivedAt: s.archivedAt,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
    findingsCount: s._count.findings,
  };
}

const listInclude = {
  charter: { select: { id: true, number: true, title: true } },
  tester: userSel,
  milestone: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
  _count: { select: { findings: true } },
} satisfies Prisma.ExploratorySessionInclude;

sessionsRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const view = VIEWS[q.view ?? 'all'] ?? VIEWS.all;
  const statuses = toArray(q.status) as SessionStatus[];
  const where: Prisma.ExploratorySessionWhereInput = {
    projectId: req.project!.id,
    ...view(req),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    testerId: q.testerId ? (q.testerId === 'me' ? req.user!.id : q.testerId === 'none' ? null : q.testerId) : undefined,
    charterId: q.charterId || undefined,
    milestoneId: q.milestoneId || undefined,
    priority: q.priority ? { in: toArray(q.priority) as never } : undefined,
    tags: q.tag ? { some: { tag: { name: { in: toArray(q.tag) } } } } : undefined,
    createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59.999Z`) : undefined } : undefined,
    OR: q.q
      ? [
          { title: { contains: q.q, mode: 'insensitive' } },
          { charter: { title: { contains: q.q, mode: 'insensitive' } } },
          { notes: { contains: q.q, mode: 'insensitive' } },
          ...(/^(s-)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
        ]
      : undefined,
  };
  const orderBy: Prisma.ExploratorySessionOrderByWithRelationInput =
    q.sort === 'created' ? { createdAt: 'desc' } : q.sort === 'number' ? { number: 'desc' } : q.sort === 'due' ? { dueDate: 'asc' } : { updatedAt: 'desc' };
  const [total, sessions] = await Promise.all([
    prisma.exploratorySession.count({ where }),
    prisma.exploratorySession.findMany({ where, orderBy, skip, take, include: listInclude }),
  ]);
  const now = new Date();
  res.json({ total, page, pageSize, sessions: sessions.map((s) => serializeListItem(s, now)) });
});

sessionsRouter.post('/', requireRole('TESTER'), async (req, res) => {
  const body = parse(launchBody.extend({ charterId: z.string() }), req.body);
  const charter = await prisma.charter.findFirst({ where: { id: body.charterId, projectId: req.project!.id } });
  if (!charter) throw badRequest('Unknown charter');
  if (body.testerId && body.testerId !== req.user!.id && !hasRole(req, 'LEAD')) throw forbidden('Only leads can assign sessions to other testers');
  const session = await createSessionFromCharter(req, charter, {
    ...body,
    browser: body.browser ?? undefined,
    os: body.os ?? undefined,
    device: body.device ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
  });
  res.status(201).json({ session: { ...session, key: keys.session(session.number) } });
});

sessionsRouter.post('/bulk', requireRole('LEAD'), async (req, res) => {
  const body = parse(
    z.object({
      ids: z.array(z.string()).min(1).max(200),
      action: z.enum(['assign', 'tag', 'untag', 'archive', 'unarchive', 'milestone']),
      testerId: z.string().nullish(),
      tags: z.array(z.string().max(40)).max(30).optional(),
      milestoneId: z.string().nullish(),
    }),
    req.body,
  );
  const pid = req.project!.id;
  const sessions = await prisma.exploratorySession.findMany({ where: { id: { in: body.ids }, projectId: pid } });
  if (sessions.length !== new Set(body.ids).size) throw notFound('One or more sessions');
  if (body.action === 'assign') await assertProjectMembers(pid, req.user!.orgId, [body.testerId]);
  if (body.action === 'milestone') await validateRefs(pid, { milestoneId: body.milestoneId });
  await prisma.$transaction(async (tx) => {
    const ids = sessions.map((s) => s.id);
    switch (body.action) {
      case 'assign':
        await tx.exploratorySession.updateMany({ where: { id: { in: ids } }, data: { testerId: body.testerId ?? null } });
        if (body.testerId) {
          await notify(tx, {
            recipients: [body.testerId],
            actorId: req.user!.id,
            projectId: pid,
            type: 'ASSIGNMENT',
            title: `You were assigned ${ids.length} exploratory session(s) in ${req.project!.name}`,
            link: `/projects/${pid}/sessions?view=assigned`,
          });
        }
        break;
      case 'tag':
      case 'untag': {
        const tagIds = await resolveTagIds(tx, pid, body.tags ?? []);
        if (body.action === 'tag') {
          await tx.sessionTag.createMany({ data: ids.flatMap((sessionId) => tagIds.map((tagId) => ({ sessionId, tagId }))), skipDuplicates: true });
        } else {
          await tx.sessionTag.deleteMany({ where: { sessionId: { in: ids }, tagId: { in: tagIds } } });
        }
        break;
      }
      case 'archive':
        await tx.exploratorySession.updateMany({ where: { id: { in: ids }, status: { notIn: ['IN_PROGRESS'] } }, data: { archivedAt: new Date() } });
        break;
      case 'unarchive':
        await tx.exploratorySession.updateMany({ where: { id: { in: ids } }, data: { archivedAt: null } });
        break;
      case 'milestone':
        await tx.exploratorySession.updateMany({ where: { id: { in: ids } }, data: { milestoneId: body.milestoneId ?? null } });
        break;
    }
    for (const s of sessions) {
      await audit(tx, req, { projectId: pid, entityType: 'session', entityId: s.id, action: `bulk_${body.action}`, changes: { testerId: body.testerId, tags: body.tags, milestoneId: body.milestoneId } });
    }
  });
  res.json({ ok: true, count: sessions.length });
});

sessionsRouter.get('/:id', async (req, res) => {
  const s = await prisma.exploratorySession.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      charter: { include: { environment: true, tags: { include: { tag: true } } } },
      tester: userSel,
      createdBy: userSel,
      reviewer: userSel,
      milestone: { select: { id: true, name: true } },
      environment: true,
      tags: { include: { tag: true } },
      logEntries: {
        orderBy: { createdAt: 'asc' },
        include: {
          author: userSel,
          finding: { select: { id: true, number: true, title: true, severity: true, status: true, classification: true } },
          attachment: { select: { id: true, fileName: true, mimeType: true, size: true } },
        },
      },
      findings: {
        orderBy: { number: 'asc' },
        include: {
          classification: true,
          author: userSel,
          issue: { select: { id: true, number: true, title: true, status: true } },
          _count: { select: { attachments: true, comments: true } },
        },
      },
      attachments: { orderBy: { createdAt: 'asc' }, include: { uploader: userSel } },
      relatedFrom: { include: { to: { select: { id: true, number: true, title: true, status: true } } } },
      relatedTo: { include: { from: { select: { id: true, number: true, title: true, status: true } } } },
    },
  });
  if (!s) throw notFound('Session');
  const now = new Date();
  const pk = req.project!.key;
  res.json({
    serverTime: now.toISOString(),
    session: {
      ...s,
      key: keys.session(s.number),
      charter: { ...s.charter, key: keys.charter(s.charter.number), tags: tagNames(s.charter.tags) },
      tags: tagNames(s.tags),
      liveElapsedSeconds: liveElapsed(s, now),
      findings: s.findings.map((f) => ({ ...f, key: keys.finding(f.number), issue: f.issue ? { ...f.issue, key: keys.issue(pk, f.issue.number) } : null })),
      logEntries: s.logEntries.map((l) => ({ ...l, finding: l.finding ? { ...l.finding, key: keys.finding(l.finding.number) } : null })),
      related: [
        ...s.relatedFrom.map((r) => ({ ...r.to, key: keys.session(r.to.number) })),
        ...s.relatedTo.map((r) => ({ ...r.from, key: keys.session(r.from.number) })),
      ],
      relatedFrom: undefined,
      relatedTo: undefined,
    },
    permissions: {
      canOperate: canOperate(req, s),
      canEdit: canOperate(req, s) && isEditable(req, s),
      canReview: hasRole(req, 'LEAD') && (s.testerId !== req.user!.id || projectSettings(req.project!.settings).allowSelfReview),
      canManage: hasRole(req, 'LEAD'),
      canComment: hasRole(req, 'VIEWER'),
    },
  });
});

const sessionPatch = z.object({
  title: z.string().trim().min(1).max(200),
  testerId: z.string().nullable(),
  environmentId: z.string().nullable(),
  browser: z.string().max(100).nullable(),
  os: z.string().max(100).nullable(),
  device: z.string().max(100).nullable(),
  buildVersion: z.string().max(100).nullable(),
  environmentNotes: z.string().max(5000).nullable(),
  timeboxMinutes: z.number().int().min(5).max(480),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  dueDate: z.string().nullable(),
  milestoneId: z.string().nullable(),
  tags: z.array(z.string().max(40)).max(30),
  customFields: z.record(z.unknown()),
  summary: z.string().max(100_000).nullable(),
  setupPercent: z.number().int().min(0).max(100).nullable(),
  testPercent: z.number().int().min(0).max(100).nullable(),
  bugPercent: z.number().int().min(0).max(100).nullable(),
  charterVsOpportunity: z.number().int().min(0).max(100).nullable(),
}).partial();

sessionsRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const before = await getSessionOr404(req.project!.id, String(req.params.id));
  const body = parse(sessionPatch, req.body);
  const pid = req.project!.id;
  if (!canOperate(req, before)) throw forbidden('Only the session tester or a lead can edit this session');
  if (before.archivedAt) throw badRequest('Unarchive the session before editing');
  const metadataOnly = Object.keys(body).every((k) => ['testerId', 'tags', 'milestoneId', 'dueDate', 'priority'].includes(k));
  if (!metadataOnly && !isEditable(req, before) && !hasRole(req, 'LEAD')) throw badRequest('This session is read-only');
  if (body.testerId !== undefined && body.testerId !== before.testerId) {
    if (!hasRole(req, 'LEAD') && body.testerId !== req.user!.id) throw forbidden('Only leads can reassign sessions');
    await assertProjectMembers(pid, req.user!.orgId, [body.testerId]);
  }
  await validateRefs(pid, { milestoneId: body.milestoneId, environmentId: body.environmentId });
  const customFields = body.customFields ? await validateCustomFields(prisma, pid, 'SESSION', body.customFields, before.customFields) : undefined;
  const { tags, customFields: _cf, dueDate, summary, ...scalars } = body;
  const data: Prisma.ExploratorySessionUncheckedUpdateInput = {
    ...scalars,
    ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
    ...(summary !== undefined ? { summary: summary === null ? null : sanitizeRichText(summary) } : {}),
    ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
  };
  const updated = await prisma.$transaction(async (tx) => {
    if (tags) {
      const tagIds = await resolveTagIds(tx, pid, tags);
      await tx.sessionTag.deleteMany({ where: { sessionId: before.id } });
      await tx.sessionTag.createMany({ data: tagIds.map((tagId) => ({ sessionId: before.id, tagId })) });
    }
    const s = await tx.exploratorySession.update({ where: { id: before.id }, data });
    const changes = diff(before as unknown as Record<string, unknown>, s as unknown as Record<string, unknown>, Object.keys(data));
    if (tags) (changes as Record<string, unknown>).tags = { to: tags };
    if (Object.keys(changes).length) await audit(tx, req, { projectId: pid, entityType: 'session', entityId: s.id, action: 'updated', changes });
    if (body.testerId && body.testerId !== before.testerId) {
      await notify(tx, {
        recipients: [body.testerId],
        actorId: req.user!.id,
        projectId: pid,
        type: 'ASSIGNMENT',
        title: `You were assigned session ${keys.session(s.number)}: ${s.title}`,
        link: `/projects/${pid}/sessions/${s.id}`,
      });
    }
    return s;
  });
  res.json({ session: { ...updated, key: keys.session(updated.number), liveElapsedSeconds: liveElapsed(updated) } });
});

/**
 * Autosave endpoint for rich-text notes with optimistic concurrency: the client
 * sends the notes version it edited; a mismatch returns 409 with the server copy
 * so the UI can offer to reload or overwrite (force=true).
 */
sessionsRouter.put('/:id/notes', requireRole('TESTER'), async (req, res) => {
  const body = parse(z.object({ notes: z.string().max(1_000_000), baseVersion: z.number().int().min(0), force: z.boolean().optional() }), req.body);
  const s = await getSessionOr404(req.project!.id, String(req.params.id));
  assertCanEditContent(req, s);
  const notes = sanitizeRichText(body.notes);
  const now = new Date();
  const result = await prisma.exploratorySession.updateMany({
    where: { id: s.id, ...(body.force ? {} : { version: body.baseVersion }) },
    data: { notes, notesUpdatedAt: now, version: { increment: 1 } },
  });
  if (result.count === 0) {
    const fresh = await prisma.exploratorySession.findUniqueOrThrow({ where: { id: s.id }, select: { notes: true, version: true, notesUpdatedAt: true } });
    throw conflict('Notes were changed elsewhere since you started editing', fresh);
  }
  const fresh = await prisma.exploratorySession.findUniqueOrThrow({ where: { id: s.id }, select: { version: true, notesUpdatedAt: true } });
  res.json({ version: fresh.version, notesUpdatedAt: fresh.notesUpdatedAt });
});

sessionsRouter.post('/:id/log', requireRole('TESTER'), async (req, res) => {
  const body = parse(z.object({ content: z.string().trim().min(1).max(5000) }), req.body);
  const s = await getSessionOr404(req.project!.id, String(req.params.id));
  assertCanEditContent(req, s);
  const entry = await prisma.$transaction((tx) => addLog(tx, s, { authorId: req.user!.id, type: 'NOTE', content: body.content }));
  const full = await prisma.sessionLogEntry.findUniqueOrThrow({ where: { id: entry.id }, include: { author: userSel } });
  res.status(201).json({ entry: full });
});

sessionsRouter.delete('/:id/log/:entryId', requireRole('TESTER'), async (req, res) => {
  const s = await getSessionOr404(req.project!.id, String(req.params.id));
  assertCanEditContent(req, s);
  const entry = await prisma.sessionLogEntry.findFirst({ where: { id: String(req.params.entryId), sessionId: s.id } });
  if (!entry) throw notFound('Log entry');
  if (entry.type !== 'NOTE' || entry.authorId !== req.user!.id) throw forbidden('Only your own notes can be removed; system events are permanent');
  await prisma.sessionLogEntry.delete({ where: { id: entry.id } });
  await audit(prisma, req, { projectId: s.projectId, entityType: 'session', entityId: s.id, action: 'log_entry_deleted', changes: { content: entry.content } });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Timer & workflow transitions
// ----------------------------------------------------------------------------

type Transition = {
  from: SessionStatus[];
  to: (req: Request) => SessionStatus;
  who: 'operator' | 'reviewer' | 'lead';
  label: string;
};

const TRANSITIONS: Record<string, Transition> = {
  start: { from: ['DRAFT'], to: () => 'IN_PROGRESS', who: 'operator', label: 'Session started' },
  pause: { from: ['IN_PROGRESS'], to: () => 'PAUSED', who: 'operator', label: 'Session paused' },
  resume: { from: ['PAUSED', 'CHANGES_REQUESTED'], to: () => 'IN_PROGRESS', who: 'operator', label: 'Session resumed' },
  finish: {
    from: ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'],
    to: (req) => (projectSettings(req.project!.settings).requireReview ? 'IN_REVIEW' : 'COMPLETED'),
    who: 'operator',
    label: 'Session finished',
  },
  abandon: { from: ['DRAFT', 'IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'], to: () => 'ABANDONED', who: 'operator', label: 'Session abandoned' },
  'submit-review': { from: ['COMPLETED'], to: () => 'IN_REVIEW', who: 'operator', label: 'Submitted for review' },
  approve: { from: ['IN_REVIEW'], to: () => 'APPROVED', who: 'reviewer', label: 'Session approved' },
  'request-changes': { from: ['IN_REVIEW'], to: () => 'CHANGES_REQUESTED', who: 'reviewer', label: 'Changes requested' },
  reopen: { from: ['COMPLETED', 'APPROVED', 'ABANDONED', 'IN_REVIEW'], to: () => 'PAUSED', who: 'lead', label: 'Session reopened' },
};

const transitionBody = z.object({
  comment: z.string().max(5000).optional(),
  summary: z.string().max(100_000).optional(),
  setupPercent: z.number().int().min(0).max(100).nullish(),
  testPercent: z.number().int().min(0).max(100).nullish(),
  bugPercent: z.number().int().min(0).max(100).nullish(),
  charterVsOpportunity: z.number().int().min(0).max(100).nullish(),
});

for (const [action, t] of Object.entries(TRANSITIONS)) {
  sessionsRouter.post(`/:id/${action}`, requireRole('TESTER'), async (req, res) => {
    const body = parse(transitionBody, req.body ?? {});
    const pid = req.project!.id;
    const s = await getSessionOr404(pid, String(req.params.id));
    if (s.archivedAt) throw badRequest('Archived sessions cannot change state');
    const settings = projectSettings(req.project!.settings);
    if (t.who === 'operator' && !canOperate(req, s)) throw forbidden('Only the session tester or a lead can do this');
    if (t.who === 'lead' && !hasRole(req, 'LEAD')) throw forbidden('Only leads can reopen sessions');
    if (t.who === 'reviewer') {
      if (!hasRole(req, 'LEAD')) throw forbidden('Only leads can review sessions');
      if (s.testerId === req.user!.id && !settings.allowSelfReview) throw forbidden('You cannot review your own session');
    }
    if (!t.from.includes(s.status)) {
      throw new AppError(409, 'invalid_transition', `Cannot ${action.replace('-', ' ')} a session that is ${s.status.toLowerCase().replace('_', ' ')}`);
    }
    if (action === 'finish' && body.setupPercent != null && body.testPercent != null && body.bugPercent != null) {
      if (body.setupPercent + body.testPercent + body.bugPercent !== 100) throw badRequest('Setup, test and bug percentages must add up to 100');
    }
    const now = new Date();
    const to = t.to(req);
    const wasRunning = s.status === 'IN_PROGRESS';
    const accumulated = wasRunning && s.lastResumedAt ? s.elapsedSeconds + Math.max(0, Math.floor((now.getTime() - s.lastResumedAt.getTime()) / 1000)) : s.elapsedSeconds;
    const data: Prisma.ExploratorySessionUncheckedUpdateInput = { status: to, elapsedSeconds: accumulated };
    if (to === 'IN_PROGRESS') {
      data.lastResumedAt = now;
      if (!s.startedAt) data.startedAt = now;
      if (!s.testerId) data.testerId = req.user!.id;
    } else {
      data.lastResumedAt = null;
    }
    if (action === 'finish' || action === 'abandon') {
      data.endedAt = now;
      if (body.summary !== undefined) data.summary = sanitizeRichText(body.summary);
      for (const k of ['setupPercent', 'testPercent', 'bugPercent', 'charterVsOpportunity'] as const) if (body[k] !== undefined) data[k] = body[k];
    }
    if (action === 'approve' || action === 'request-changes') {
      data.reviewerId = req.user!.id;
      data.reviewedAt = now;
      data.reviewComment = body.comment ?? null;
    }
    if (action === 'reopen') data.endedAt = null;

    const updated = await prisma.$transaction(async (tx) => {
      // Guard against concurrent transitions: only update if the status is still what we validated.
      const r = await tx.exploratorySession.updateMany({ where: { id: s.id, status: s.status }, data: data as Prisma.ExploratorySessionUncheckedUpdateManyInput });
      if (r.count === 0) throw conflict('The session changed state concurrently; reload and try again');
      const fresh = await tx.exploratorySession.findUniqueOrThrow({ where: { id: s.id } });
      const content = body.comment ? `${t.label}: ${body.comment}` : t.label;
      await addLog(tx, { ...fresh, status: 'PAUSED' }, { authorId: req.user!.id, type: 'STATUS_CHANGE', content, metadata: { from: s.status, to } });
      await audit(tx, req, { projectId: pid, entityType: 'session', entityId: s.id, action, changes: { status: { from: s.status, to }, elapsedSeconds: accumulated } });
      const link = `/projects/${pid}/sessions/${s.id}`;
      if (to === 'IN_REVIEW') {
        const leads = await tx.projectMember.findMany({ where: { projectId: pid, role: { in: ['LEAD', 'ADMIN'] } }, select: { userId: true } });
        await notify(tx, {
          recipients: leads.map((l) => l.userId),
          actorId: req.user!.id,
          projectId: pid,
          type: 'REVIEW_REQUESTED',
          title: `Review requested: ${keys.session(s.number)} ${s.title}`,
          link,
        });
      }
      if (action === 'approve' || action === 'request-changes') {
        await notify(tx, {
          recipients: [s.testerId],
          actorId: req.user!.id,
          projectId: pid,
          type: 'REVIEW_DECISION',
          title: `${keys.session(s.number)} ${action === 'approve' ? 'approved' : 'needs changes'}`,
          body: body.comment,
          link,
        });
      }
      return fresh;
    });
    if (action === 'start') emitEvent(pid, 'session.started', { id: s.id, key: keys.session(s.number), title: s.title });
    if (action === 'finish') emitEvent(pid, 'session.completed', { id: s.id, key: keys.session(s.number), title: s.title, status: to, elapsedSeconds: accumulated });
    if (action === 'approve' || action === 'request-changes') emitEvent(pid, 'session.reviewed', { id: s.id, key: keys.session(s.number), decision: to });
    res.json({ session: { ...updated, key: keys.session(updated.number), liveElapsedSeconds: liveElapsed(updated) } });
  });
}

for (const action of ['archive', 'unarchive'] as const) {
  sessionsRouter.post(`/:id/${action}`, requireRole('TESTER'), async (req, res) => {
    const s = await getSessionOr404(req.project!.id, String(req.params.id));
    if (!hasRole(req, 'LEAD') && s.testerId !== req.user!.id) throw forbidden('Only leads or the tester can archive this session');
    if (action === 'archive' && s.status === 'IN_PROGRESS') throw badRequest('Pause or finish the session before archiving it');
    await prisma.exploratorySession.update({ where: { id: s.id }, data: { archivedAt: action === 'archive' ? new Date() : null } });
    await audit(prisma, req, { projectId: s.projectId, entityType: 'session', entityId: s.id, action: `${action}d` });
    res.json({ ok: true });
  });
}

sessionsRouter.post('/:id/duplicate', requireRole('TESTER'), async (req, res) => {
  const s = await prisma.exploratorySession.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: { charter: true, tags: { include: { tag: true } } } });
  if (!s) throw notFound('Session');
  const copy = await createSessionFromCharter(req, s.charter, {
    title: s.title,
    testerId: hasRole(req, 'LEAD') ? s.testerId : req.user!.id,
    environmentId: s.environmentId,
    browser: s.browser,
    os: s.os,
    device: s.device,
    buildVersion: s.buildVersion,
    environmentNotes: s.environmentNotes,
    timeboxMinutes: s.timeboxMinutes,
    milestoneId: s.milestoneId,
    priority: s.priority,
    tags: tagNames(s.tags),
  });
  res.status(201).json({ session: { ...copy, key: keys.session(copy.number) } });
});

sessionsRouter.post('/:id/relations', requireRole('TESTER'), async (req, res) => {
  const body = parse(z.object({ relatedId: z.string() }), req.body);
  const s = await getSessionOr404(req.project!.id, String(req.params.id));
  const other = await getSessionOr404(req.project!.id, body.relatedId);
  if (s.id === other.id) throw badRequest('A session cannot be related to itself');
  const exists = await prisma.sessionRelation.findFirst({ where: { OR: [{ fromId: s.id, toId: other.id }, { fromId: other.id, toId: s.id }] } });
  if (!exists) await prisma.sessionRelation.create({ data: { fromId: s.id, toId: other.id } });
  res.status(201).json({ ok: true });
});

sessionsRouter.delete('/:id/relations/:relatedId', requireRole('TESTER'), async (req, res) => {
  const s = await getSessionOr404(req.project!.id, String(req.params.id));
  const other = String(req.params.relatedId);
  await prisma.sessionRelation.deleteMany({ where: { OR: [{ fromId: s.id, toId: other }, { fromId: other, toId: s.id }] } });
  res.json({ ok: true });
});

/** Markdown/JSON debrief report for sharing a session outside Explorix. */
sessionsRouter.get('/:id/report', async (req, res) => {
  const s = await prisma.exploratorySession.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      charter: true,
      tester: userSel,
      logEntries: { orderBy: { createdAt: 'asc' }, include: { author: userSel } },
      findings: { orderBy: { number: 'asc' }, include: { classification: true } },
    },
  });
  if (!s) throw notFound('Session');
  const fmt = (sec: number) => `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
  const ts = (sec: number) => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  if (req.query.format === 'json') return res.json({ session: s });
  const lines = [
    `# ${keys.session(s.number)} — ${s.title}`,
    '',
    `**Charter:** ${keys.charter(s.charter.number)} ${s.charter.title}  `,
    `**Mission:** ${s.charter.mission}  `,
    `**Tester:** ${s.tester?.name ?? 'Unassigned'}  `,
    `**Status:** ${s.status}  `,
    `**Time:** ${fmt(liveElapsed(s))} of ${s.timeboxMinutes}m timebox  `,
    `**Environment:** ${[s.browser, s.os, s.device, s.buildVersion].filter(Boolean).join(' / ') || '—'}`,
    '',
    s.setupPercent != null ? `**Task breakdown:** setup ${s.setupPercent}% · test ${s.testPercent}% · bug investigation ${s.bugPercent}% · charter vs opportunity ${s.charterVsOpportunity ?? '—'}%\n` : '',
    '## Summary',
    '',
    htmlToText(s.summary) || '_No summary yet._',
    '',
    '## Findings',
    '',
    ...(s.findings.length
      ? s.findings.map((f) => `- **${keys.finding(f.number)}** [${f.classification.name}] [${f.severity}] ${f.title}${f.status !== 'NEW' ? ` _(${f.status})_` : ''}`)
      : ['_No findings._']),
    '',
    '## Notes',
    '',
    htmlToText(s.notes) || '_No notes._',
    '',
    '## Timeline',
    '',
    ...s.logEntries.map((l) => `- \`${ts(l.elapsedSeconds)}\` ${l.type === 'NOTE' ? '' : `_${l.type.replace('_', ' ').toLowerCase()}_ `}${l.content}${l.author ? ` — ${l.author.name}` : ''}`),
    '',
  ];
  res.type('text/markdown').setHeader('Content-Disposition', `attachment; filename="${keys.session(s.number)}.md"`);
  res.send(lines.join('\n'));
});

export { DONE_STATUSES };
