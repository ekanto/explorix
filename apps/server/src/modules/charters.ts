import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { validateCustomFields } from '../lib/customFields.js';
import { notify } from '../lib/notify.js';
import { projectSettings } from '../lib/projectDefaults.js';
import { createSessionFromCharter, validateRefs } from '../lib/sessionService.js';
import { keys, liveElapsed, nextNumber, paging, resolveTagIds, tagNames, toArray } from '../lib/util.js';
import { assertProjectMembers, hasRole, requireRole } from '../middleware/access.js';

export const chartersRouter = Router({ mergeParams: true });

const text = (max = 5000) => z.string().max(max).nullish();
const list = z.array(z.string().trim().min(1).max(500)).max(100);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const charterBody = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  mission: z.string().trim().min(1, 'Mission is required').max(2000),
  target: text(300),
  scope: text(),
  outOfScope: text(),
  objectives: text(),
  learningGoals: text(),
  risks: text(),
  assumptions: text(),
  testIdeas: list.optional(),
  heuristics: list.optional(),
  prerequisites: text(),
  testData: text(),
  environmentId: z.string().nullish(),
  browser: text(100),
  os: text(100),
  device: text(100),
  environmentNotes: text(),
  estimatedMinutes: z.number().int().min(1).max(10_000).nullish(),
  timeboxMinutes: z.number().int().min(5).max(480).optional(),
  priority: priority.optional(),
  riskLevel: priority.optional(),
  exitCriteria: text(),
  milestoneId: z.string().nullish(),
  templateId: z.string().nullish(),
  assigneeIds: z.array(z.string()).max(50).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  requirementIds: z.array(z.string()).max(100).optional(),
  customFields: z.record(z.unknown()).optional(),
  status: z.enum(['DRAFT', 'READY']).optional(),
});

const SCALAR_KEYS = [
  'title', 'mission', 'target', 'scope', 'outOfScope', 'objectives', 'learningGoals', 'risks', 'assumptions', 'testIdeas',
  'heuristics', 'prerequisites', 'testData', 'environmentId', 'browser', 'os', 'device', 'environmentNotes', 'estimatedMinutes',
  'timeboxMinutes', 'priority', 'riskLevel', 'exitCriteria', 'milestoneId', 'templateId', 'status',
] as const;

const charterInclude = {
  assignees: { include: { user: { select: { id: true, name: true, avatarColor: true } } } },
  tags: { include: { tag: true } },
  milestone: { select: { id: true, name: true, status: true } },
} satisfies Prisma.CharterInclude;

async function validateCharterRefs(req: Request, body: Partial<z.infer<typeof charterBody>>) {
  const pid = req.project!.id;
  await validateRefs(pid, { milestoneId: body.milestoneId, environmentId: body.environmentId });
  if (body.templateId) {
    const t = await prisma.charterTemplate.findFirst({ where: { id: body.templateId, orgId: req.user!.orgId, OR: [{ projectId: null }, { projectId: pid }] } });
    if (!t) throw badRequest('Unknown template');
  }
  if (body.requirementIds?.length) {
    const n = await prisma.requirement.count({ where: { id: { in: body.requirementIds }, projectId: pid } });
    if (n !== new Set(body.requirementIds).size) throw badRequest('Unknown requirement');
  }
  await assertProjectMembers(pid, req.user!.orgId, body.assigneeIds ?? []);
}

function pickScalars(body: Partial<z.infer<typeof charterBody>>) {
  const data: Record<string, unknown> = {};
  for (const k of SCALAR_KEYS) if (body[k] !== undefined) data[k] = body[k];
  return data;
}

async function findCharter(req: Request) {
  const c = await prisma.charter.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!c) throw notFound('Charter');
  return c;
}

function canEditCharter(req: Request, c: { createdById: string }) {
  if (hasRole(req, 'LEAD')) return true;
  if (!hasRole(req, 'TESTER')) return false;
  return c.createdById === req.user!.id || projectSettings(req.project!.settings).allowTesterCharterEdit;
}

chartersRouter.get('/', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q);
  const statuses = toArray(q.status) as ('DRAFT' | 'READY' | 'ARCHIVED')[];
  const where: Prisma.CharterWhereInput = {
    projectId: req.project!.id,
    status: statuses.length ? { in: statuses } : { not: 'ARCHIVED' },
    priority: q.priority ? { in: toArray(q.priority) as never } : undefined,
    riskLevel: q.riskLevel ? { in: toArray(q.riskLevel) as never } : undefined,
    milestoneId: q.milestoneId || undefined,
    assignees: q.assigneeId ? { some: { userId: q.assigneeId === 'me' ? req.user!.id : q.assigneeId } } : undefined,
    tags: q.tag ? { some: { tag: { name: { in: toArray(q.tag) } } } } : undefined,
    OR: q.q
      ? [
          { title: { contains: q.q, mode: 'insensitive' } },
          { mission: { contains: q.q, mode: 'insensitive' } },
          { target: { contains: q.q, mode: 'insensitive' } },
          ...(/^(ch-)?\d+$/i.test(q.q) ? [{ number: Number(q.q.replace(/\D/g, '')) }] : []),
        ]
      : undefined,
  };
  const orderBy: Prisma.CharterOrderByWithRelationInput =
    q.sort === 'created' ? { createdAt: 'desc' } : q.sort === 'number' ? { number: 'desc' } : q.sort === 'title' ? { title: 'asc' } : { updatedAt: 'desc' };
  const [total, charters] = await Promise.all([
    prisma.charter.count({ where }),
    prisma.charter.findMany({
      where,
      orderBy,
      skip,
      take,
      include: { ...charterInclude, _count: { select: { sessions: true, findings: true } } },
    }),
  ]);
  const ids = charters.map((c) => c.id);
  const sessionStats = await prisma.exploratorySession.groupBy({
    by: ['charterId', 'status'],
    where: { charterId: { in: ids } },
    _count: true,
    _sum: { elapsedSeconds: true },
  });
  res.json({
    total,
    page,
    pageSize,
    charters: charters.map((c) => {
      const stats = sessionStats.filter((s) => s.charterId === c.id);
      return {
        ...c,
        key: keys.charter(c.number),
        tags: tagNames(c.tags),
        assignees: c.assignees.map((a) => a.user),
        sessionCounts: {
          total: c._count.sessions,
          completed: stats.filter((s) => ['COMPLETED', 'IN_REVIEW', 'APPROVED'].includes(s.status)).reduce((a, s) => a + s._count, 0),
          active: stats.filter((s) => ['IN_PROGRESS', 'PAUSED', 'CHANGES_REQUESTED'].includes(s.status)).reduce((a, s) => a + s._count, 0),
        },
        findingsCount: c._count.findings,
        actualSeconds: stats.reduce((a, s) => a + (s._sum.elapsedSeconds ?? 0), 0),
      };
    }),
  });
});

chartersRouter.post('/', requireRole('TESTER'), async (req, res) => {
  const body = parse(charterBody, req.body);
  await validateCharterRefs(req, body);
  const pid = req.project!.id;
  const customFields = await validateCustomFields(prisma, pid, 'CHARTER', body.customFields);
  const charter = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'charterSeq');
    const tagIds = await resolveTagIds(tx, pid, body.tags);
    const c = await tx.charter.create({
      data: {
        ...(pickScalars(body) as Prisma.CharterUncheckedCreateInput),
        timeboxMinutes: body.timeboxMinutes ?? projectSettings(req.project!.settings).defaultTimeboxMinutes,
        projectId: pid,
        number,
        customFields: customFields as Prisma.InputJsonValue,
        createdById: req.user!.id,
        updatedById: req.user!.id,
        assignees: { create: (body.assigneeIds ?? []).map((userId) => ({ userId })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
        requirements: { create: (body.requirementIds ?? []).map((requirementId) => ({ requirementId })) },
      },
    });
    await audit(tx, req, { projectId: pid, entityType: 'charter', entityId: c.id, action: 'created', changes: { title: c.title, status: c.status } });
    await notify(tx, {
      recipients: body.assigneeIds ?? [],
      actorId: req.user!.id,
      projectId: pid,
      type: 'ASSIGNMENT',
      title: `You were assigned charter ${keys.charter(number)}: ${c.title}`,
      link: `/projects/${pid}/charters/${c.id}`,
    });
    return c;
  });
  res.status(201).json({ charter: { ...charter, key: keys.charter(charter.number) } });
});

chartersRouter.get('/:id', async (req, res) => {
  const c = await prisma.charter.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: {
      ...charterInclude,
      environment: true,
      template: { select: { id: true, name: true, category: true } },
      createdBy: { select: { id: true, name: true } },
      updatedBy: { select: { id: true, name: true } },
      requirements: { include: { requirement: { select: { id: true, number: true, title: true, status: true } } } },
      sessions: {
        orderBy: { number: 'desc' },
        include: { tester: { select: { id: true, name: true, avatarColor: true } }, _count: { select: { findings: true } } },
      },
      testCases: { select: { id: true, number: true, title: true } },
    },
  });
  if (!c) throw notFound('Charter');
  const findingsByClass = await prisma.finding.groupBy({ by: ['classificationId'], where: { charterId: c.id }, _count: true });
  res.json({
    charter: {
      ...c,
      key: keys.charter(c.number),
      tags: tagNames(c.tags),
      assignees: c.assignees.map((a) => a.user),
      requirements: c.requirements.map((r) => ({ ...r.requirement, key: keys.requirement(r.requirement.number) })),
      sessions: c.sessions.map((s) => ({
        id: s.id,
        key: keys.session(s.number),
        number: s.number,
        title: s.title,
        status: s.status,
        tester: s.tester,
        timeboxMinutes: s.timeboxMinutes,
        elapsedSeconds: liveElapsed(s),
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        archivedAt: s.archivedAt,
        findingsCount: s._count.findings,
      })),
      findingsByClassification: findingsByClass.map((f) => ({ classificationId: f.classificationId, count: f._count })),
    },
    permissions: { canEdit: canEditCharter(req, c), canLaunch: hasRole(req, 'TESTER') && c.status !== 'ARCHIVED', canArchive: hasRole(req, 'LEAD') || c.createdById === req.user!.id },
  });
});

chartersRouter.get('/:id/history', async (req, res) => {
  const c = await findCharter(req);
  const events = await prisma.auditEvent.findMany({
    where: { entityType: 'charter', entityId: c.id },
    include: { actor: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ events });
});

chartersRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const before = await findCharter(req);
  if (!canEditCharter(req, before)) throw forbidden('You cannot edit this charter');
  if (before.status === 'ARCHIVED') throw badRequest('Unarchive the charter before editing');
  const body = parse(charterBody.partial(), req.body);
  await validateCharterRefs(req, body);
  const pid = req.project!.id;
  const customFields = body.customFields ? await validateCustomFields(prisma, pid, 'CHARTER', body.customFields, before.customFields) : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.CharterUncheckedUpdateInput = { ...(pickScalars(body) as Prisma.CharterUncheckedUpdateInput), updatedById: req.user!.id };
    if (customFields) data.customFields = customFields as Prisma.InputJsonValue;
    const changes: Record<string, unknown> = diff(before as unknown as Record<string, unknown>, { ...before, ...data } as Record<string, unknown>, [...SCALAR_KEYS, 'customFields']);
    if (body.tags) {
      const tagIds = await resolveTagIds(tx, pid, body.tags);
      await tx.charterTag.deleteMany({ where: { charterId: before.id } });
      await tx.charterTag.createMany({ data: tagIds.map((tagId) => ({ charterId: before.id, tagId })) });
      changes.tags = { to: body.tags };
    }
    if (body.assigneeIds) {
      const prev = await tx.charterAssignee.findMany({ where: { charterId: before.id } });
      await tx.charterAssignee.deleteMany({ where: { charterId: before.id } });
      await tx.charterAssignee.createMany({ data: body.assigneeIds.map((userId) => ({ charterId: before.id, userId })) });
      const added = body.assigneeIds.filter((id) => !prev.some((p) => p.userId === id));
      if (added.length || prev.length !== body.assigneeIds.length) changes.assignees = { from: prev.map((p) => p.userId), to: body.assigneeIds };
      await notify(tx, {
        recipients: added,
        actorId: req.user!.id,
        projectId: pid,
        type: 'ASSIGNMENT',
        title: `You were assigned charter ${keys.charter(before.number)}: ${body.title ?? before.title}`,
        link: `/projects/${pid}/charters/${before.id}`,
      });
    }
    if (body.requirementIds) {
      await tx.requirementCharter.deleteMany({ where: { charterId: before.id } });
      await tx.requirementCharter.createMany({ data: body.requirementIds.map((requirementId) => ({ charterId: before.id, requirementId })) });
      changes.requirements = { to: body.requirementIds };
    }
    const c = await tx.charter.update({ where: { id: before.id }, data });
    if (Object.keys(changes).length) await audit(tx, req, { projectId: pid, entityType: 'charter', entityId: c.id, action: 'updated', changes });
    return c;
  });
  res.json({ charter: { ...updated, key: keys.charter(updated.number) } });
});

chartersRouter.post('/:id/duplicate', requireRole('TESTER'), async (req, res) => {
  const src = await prisma.charter.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id },
    include: { assignees: true, tags: true, requirements: true },
  });
  if (!src) throw notFound('Charter');
  const pid = req.project!.id;
  const copy = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, pid, 'charterSeq');
    const data: Record<string, unknown> = {};
    for (const k of SCALAR_KEYS) data[k] = (src as Record<string, unknown>)[k];
    const c = await tx.charter.create({
      data: {
        ...(data as Prisma.CharterUncheckedCreateInput),
        title: `${src.title} (copy)`.slice(0, 200),
        status: 'DRAFT',
        projectId: pid,
        number,
        customFields: (src.customFields ?? {}) as Prisma.InputJsonValue,
        duplicatedFromId: src.id,
        createdById: req.user!.id,
        updatedById: req.user!.id,
        assignees: { create: src.assignees.map((a) => ({ userId: a.userId })) },
        tags: { create: src.tags.map((t) => ({ tagId: t.tagId })) },
        requirements: { create: src.requirements.map((r) => ({ requirementId: r.requirementId })) },
      },
    });
    await audit(tx, req, { projectId: pid, entityType: 'charter', entityId: c.id, action: 'duplicated', changes: { from: keys.charter(src.number) } });
    return c;
  });
  res.status(201).json({ charter: { ...copy, key: keys.charter(copy.number) } });
});

for (const action of ['archive', 'unarchive'] as const) {
  chartersRouter.post(`/:id/${action}`, requireRole('TESTER'), async (req, res) => {
    const c = await findCharter(req);
    if (!hasRole(req, 'LEAD') && c.createdById !== req.user!.id) throw forbidden('Only leads or the author can archive this charter');
    const status = action === 'archive' ? 'ARCHIVED' : 'READY';
    await prisma.charter.update({ where: { id: c.id }, data: { status, archivedAt: action === 'archive' ? new Date() : null, updatedById: req.user!.id } });
    await audit(prisma, req, { projectId: c.projectId, entityType: 'charter', entityId: c.id, action: `${action}d`, changes: { status: { from: c.status, to: status } } });
    res.json({ ok: true });
  });
}

export const launchBody = z.object({
  title: z.string().trim().max(200).optional(),
  testerId: z.string().nullish(),
  environmentId: z.string().nullish(),
  browser: text(100),
  os: text(100),
  device: text(100),
  buildVersion: text(100),
  environmentNotes: text(),
  timeboxMinutes: z.number().int().min(5).max(480).optional(),
  dueDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
  milestoneId: z.string().nullish(),
  priority: priority.optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  start: z.boolean().optional(),
});

chartersRouter.post('/:id/sessions', requireRole('TESTER'), async (req, res) => {
  const c = await findCharter(req);
  const body = parse(launchBody, req.body ?? {});
  if (body.testerId && body.testerId !== req.user!.id && !hasRole(req, 'LEAD')) throw forbidden('Only leads can assign sessions to other testers');
  const session = await createSessionFromCharter(req, c, {
    ...body,
    browser: body.browser ?? undefined,
    os: body.os ?? undefined,
    device: body.device ?? undefined,
    dueDate: body.dueDate ? new Date(body.dueDate) : body.dueDate === null ? null : undefined,
  });
  res.status(201).json({ session: { ...session, key: keys.session(session.number) } });
});
