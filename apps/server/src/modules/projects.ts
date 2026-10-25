import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { applyProjectDefaults, projectSettings } from '../lib/projectDefaults.js';
import { accessibleProjectIds, assertProjectMembers, isOrgAdmin, requireRole } from '../middleware/access.js';
import { requireSessionAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';
import { paging } from '../lib/util.js';

export const projectsRouter = Router();

projectsRouter.get('/', async (req, res) => {
  const ids = await accessibleProjectIds(req);
  const includeArchived = req.query.includeArchived === 'true';
  const projects = await prisma.project.findMany({
    where: { id: { in: ids }, archivedAt: includeArchived ? undefined : null },
    orderBy: { name: 'asc' },
    include: {
      members: { where: { userId: req.user!.id }, select: { role: true } },
      _count: { select: { charters: true, sessions: true, findings: true, testCases: true, members: true } },
    },
  });
  const openFindings = await prisma.finding.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids }, status: { in: ['NEW', 'TRIAGED'] } },
    _count: true,
  });
  const active = await prisma.exploratorySession.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids }, status: { in: ['IN_PROGRESS', 'PAUSED'] }, archivedAt: null },
    _count: true,
  });
  res.json({
    projects: projects.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      color: p.color,
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
      role: isOrgAdmin(req) ? 'ADMIN' : p.members[0]?.role,
      counts: {
        ...p._count,
        openFindings: openFindings.find((f) => f.projectId === p.id)?._count ?? 0,
        activeSessions: active.find((f) => f.projectId === p.id)?._count ?? 0,
      },
    })),
  });
});

const projectBody = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key must be 2-10 letters/digits starting with a letter'),
  name: z.string().trim().min(2).max(100),
  description: z.string().max(2000).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

projectsRouter.post('/', requireSessionAuth, async (req, res) => {
  const body = parse(projectBody, req.body);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.orgId } });
  const allowMembers = (org.settings as { allowMemberProjectCreation?: boolean }).allowMemberProjectCreation;
  if (!isOrgAdmin(req) && !allowMembers) throw forbidden('Only organization admins can create projects');
  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        orgId: req.user!.orgId,
        key: body.key,
        name: body.name,
        description: body.description,
        color: body.color,
        members: { create: { userId: req.user!.id, role: 'ADMIN' } },
      },
    });
    await applyProjectDefaults(tx, p.id);
    await audit(tx, req, { projectId: p.id, entityType: 'project', entityId: p.id, action: 'created', changes: { key: p.key, name: p.name } });
    return p;
  });
  res.status(201).json({ project });
});

// ----------------------------------------------------------------------------
// Routes under /api/projects/:projectId (project already loaded + authorized)
// ----------------------------------------------------------------------------

export const projectConfigRouter = Router({ mergeParams: true });
const r = projectConfigRouter;

r.get('/', async (req, res) => {
  const pid = req.project!.id;
  const [members, milestones, environments, tags, customFields, classifications, statuses] = await Promise.all([
    prisma.projectMember.findMany({
      where: { projectId: pid },
      include: { user: { select: { id: true, name: true, email: true, avatarColor: true, deactivatedAt: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.milestone.findMany({ where: { projectId: pid }, orderBy: [{ dueDate: 'asc' }, { name: 'asc' }] }),
    prisma.environment.findMany({ where: { projectId: pid }, orderBy: { name: 'asc' } }),
    prisma.tag.findMany({ where: { projectId: pid }, orderBy: { name: 'asc' } }),
    prisma.customFieldDefinition.findMany({ where: { projectId: pid }, orderBy: [{ entity: 'asc' }, { position: 'asc' }] }),
    prisma.findingClassification.findMany({ where: { projectId: pid }, orderBy: { position: 'asc' } }),
    prisma.testResultStatus.findMany({ where: { projectId: pid }, orderBy: { position: 'asc' } }),
  ]);
  res.json({
    project: { ...req.project, settings: projectSettings(req.project!.settings) },
    role: req.projectRole,
    members: members.map((m) => ({ id: m.id, role: m.role, user: m.user })),
    milestones,
    environments,
    tags,
    customFields,
    classifications,
    statuses,
  });
});

const settingsSchema = z
  .object({
    requireReview: z.boolean(),
    allowSelfReview: z.boolean(),
    lockCompletedSessions: z.boolean(),
    defaultTimeboxMinutes: z.number().int().min(5).max(480),
    allowTesterCharterEdit: z.boolean(),
  })
  .partial()
  .strict();

r.patch('/', requireRole('ADMIN'), async (req, res) => {
  const body = parse(projectBody.omit({ key: true }).partial().extend({ settings: settingsSchema.optional() }), req.body);
  const before = req.project!;
  const settings = body.settings ? { ...projectSettings(before.settings), ...body.settings } : undefined;
  const project = await prisma.project.update({
    where: { id: before.id },
    data: { name: body.name, description: body.description, color: body.color, settings },
  });
  await audit(prisma, req, {
    projectId: before.id,
    entityType: 'project',
    entityId: before.id,
    action: 'updated',
    changes: diff(before as unknown as Record<string, unknown>, project as unknown as Record<string, unknown>, ['name', 'description', 'color', 'settings']),
  });
  res.json({ project: { ...project, settings: projectSettings(project.settings) } });
});

r.post('/archive', requireRole('ADMIN'), async (req, res) => {
  await prisma.project.update({ where: { id: req.project!.id }, data: { archivedAt: new Date() } });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'project', entityId: req.project!.id, action: 'archived' });
  res.json({ ok: true });
});

r.post('/unarchive', requireRole('ADMIN'), async (req, res) => {
  await prisma.project.update({ where: { id: req.project!.id }, data: { archivedAt: null } });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'project', entityId: req.project!.id, action: 'unarchived' });
  res.json({ ok: true });
});

r.get('/activity', async (req, res) => {
  const { skip, take, page, pageSize } = paging(req.query as Record<string, unknown>, 50);
  const where = {
    projectId: req.project!.id,
    entityType: (req.query.entityType as string) || undefined,
    entityId: (req.query.entityId as string) || undefined,
  };
  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({ where, include: { actor: { select: { id: true, name: true, avatarColor: true } } }, orderBy: { createdAt: 'desc' }, skip, take }),
  ]);
  res.json({ total, page, pageSize, events });
});

// Members -------------------------------------------------------------------

const roleEnum = z.enum(['ADMIN', 'LEAD', 'TESTER', 'VIEWER']);

r.post('/members', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.object({ userId: z.string(), role: roleEnum }), req.body);
  const orgMember = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: req.user!.orgId, userId: body.userId } } });
  if (!orgMember) throw badRequest('User is not in this organization');
  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: req.project!.id, userId: body.userId } },
    update: { role: body.role },
    create: { projectId: req.project!.id, userId: body.userId, role: body.role },
  });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'project_member', entityId: member.id, action: 'upserted', changes: body });
  await notify(prisma, {
    recipients: [body.userId],
    actorId: req.user!.id,
    projectId: req.project!.id,
    type: 'ASSIGNMENT',
    title: `You were added to ${req.project!.name} as ${body.role.toLowerCase()}`,
    link: `/projects/${req.project!.id}`,
  });
  res.status(201).json({ member });
});

r.patch('/members/:memberId', requireRole('ADMIN'), async (req, res) => {
  const body = parse(z.object({ role: roleEnum }), req.body);
  const m = await prisma.projectMember.findFirst({ where: { id: String(req.params.memberId), projectId: req.project!.id } });
  if (!m) throw notFound('Member');
  if (m.role === 'ADMIN' && body.role !== 'ADMIN') await assertAnotherAdmin(req.project!.id, m.id);
  await prisma.projectMember.update({ where: { id: m.id }, data: { role: body.role } });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'project_member', entityId: m.id, action: 'role_changed', changes: { from: m.role, to: body.role } });
  res.json({ ok: true });
});

r.delete('/members/:memberId', requireRole('ADMIN'), async (req, res) => {
  const m = await prisma.projectMember.findFirst({ where: { id: String(req.params.memberId), projectId: req.project!.id } });
  if (!m) throw notFound('Member');
  if (m.role === 'ADMIN') await assertAnotherAdmin(req.project!.id, m.id);
  await prisma.projectMember.delete({ where: { id: m.id } });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'project_member', entityId: m.id, action: 'removed', changes: { userId: m.userId } });
  res.json({ ok: true });
});

async function assertAnotherAdmin(projectId: string, excludingMemberId: string) {
  const admins = await prisma.projectMember.count({ where: { projectId, role: 'ADMIN', id: { not: excludingMemberId } } });
  if (admins === 0) throw badRequest('A project must keep at least one project admin');
}

// Generic small config collections ---------------------------------------------

function crud<T extends z.ZodRawShape>(
  path: string,
  model: 'milestone' | 'environment' | 'tag' | 'customFieldDefinition' | 'findingClassification' | 'testResultStatus',
  schema: z.ZodObject<T>,
  minRole: 'LEAD' | 'ADMIN',
  transform: (data: Record<string, unknown>) => Record<string, unknown> = (d) => d,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = () => (prisma as any)[model];
  r.post(`/${path}`, requireRole(minRole), async (req, res) => {
    const data = transform(parse(schema, req.body) as Record<string, unknown>);
    const created = await delegate().create({ data: { ...data, projectId: req.project!.id } });
    await audit(prisma, req, { projectId: req.project!.id, entityType: model, entityId: created.id, action: 'created', changes: data });
    res.status(201).json({ item: created });
  });
  r.patch(`/${path}/:itemId`, requireRole(minRole), async (req, res) => {
    const data = transform(parse(schema.partial(), req.body) as Record<string, unknown>);
    const existing = await delegate().findFirst({ where: { id: String(req.params.itemId), projectId: req.project!.id } });
    if (!existing) throw notFound();
    const updated = await delegate().update({ where: { id: existing.id }, data });
    await audit(prisma, req, { projectId: req.project!.id, entityType: model, entityId: existing.id, action: 'updated', changes: diff(existing, updated, Object.keys(data)) });
    res.json({ item: updated });
  });
  r.delete(`/${path}/:itemId`, requireRole(minRole), async (req, res) => {
    const existing = await delegate().findFirst({ where: { id: String(req.params.itemId), projectId: req.project!.id } });
    if (!existing) throw notFound();
    if (existing.isSystem) throw badRequest('Built-in records cannot be deleted; archive them instead');
    await delegate().delete({ where: { id: existing.id } });
    await audit(prisma, req, { projectId: req.project!.id, entityType: model, entityId: existing.id, action: 'deleted' });
    res.json({ ok: true });
  });
}

const dateish = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullish();
const toDate = (v: unknown) => (v === undefined ? undefined : v === null ? null : new Date(String(v)));

crud(
  'milestones',
  'milestone',
  z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).nullish(),
    status: z.enum(['PLANNED', 'ACTIVE', 'RELEASED', 'CANCELLED']).optional(),
    startDate: dateish,
    dueDate: dateish,
  }),
  'LEAD',
  (d) => ({
    ...d,
    startDate: toDate(d.startDate),
    dueDate: toDate(d.dueDate),
    ...(d.status === 'RELEASED' ? { releasedAt: new Date() } : {}),
  }),
);

crud(
  'environments',
  'environment',
  z.object({
    name: z.string().trim().min(1).max(100),
    url: z.string().url().max(500).nullish().or(z.literal('')),
    browser: z.string().max(100).nullish(),
    os: z.string().max(100).nullish(),
    device: z.string().max(100).nullish(),
    description: z.string().max(1000).nullish(),
  }),
  'LEAD',
  (d) => ({ ...d, url: d.url === '' ? null : d.url }),
);

crud('tags', 'tag', z.object({ name: z.string().trim().toLowerCase().min(1).max(40), color: z.string().max(20).optional() }), 'LEAD');

crud(
  'custom-fields',
  'customFieldDefinition',
  z.object({
    entity: z.enum(['CHARTER', 'SESSION', 'FINDING', 'TEST_CASE', 'ISSUE']),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Key must be lowercase letters, digits and underscores'),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'DATE', 'URL']),
    options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    required: z.boolean().optional(),
    helpText: z.string().max(300).nullish(),
    position: z.number().int().min(0).max(1000).optional(),
    archived: z.boolean().optional(),
  }),
  'ADMIN',
  (d) => {
    const { archived, ...rest } = d;
    if ((rest.type === 'SELECT' || rest.type === 'MULTI_SELECT') && Array.isArray(rest.options) && rest.options.length === 0) {
      throw badRequest('Select fields need at least one option');
    }
    return { ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) };
  },
);

crud(
  'classifications',
  'findingClassification',
  z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name: z.string().trim().min(1).max(60),
    color: z.string().max(20).optional(),
    isDefect: z.boolean().optional(),
    shortcut: z.string().max(2).nullish(),
    position: z.number().int().min(0).max(1000).optional(),
    archived: z.boolean().optional(),
  }),
  'ADMIN',
  ({ archived, ...rest }) => ({ ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) }),
);

crud(
  'statuses',
  'testResultStatus',
  z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name: z.string().trim().min(1).max(60),
    color: z.string().max(20).optional(),
    category: z.enum(['PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'RETEST', 'UNTESTED']),
    scope: z.enum(['MANUAL', 'AUTOMATION', 'BOTH']).optional(),
    aliases: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
    position: z.number().int().min(0).max(1000).optional(),
    archived: z.boolean().optional(),
  }),
  'ADMIN',
  ({ archived, ...rest }) => ({ ...rest, ...(archived === undefined ? {} : { archivedAt: archived ? new Date() : null }) }),
);

/** Validates assignees for routes elsewhere. */
export { assertProjectMembers };
