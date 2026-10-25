import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { audit, diff } from '../lib/audit.js';
import { isOrgAdmin, requireRole } from '../middleware/access.js';

export const templatesRouter = Router({ mergeParams: true });

const list = z.array(z.string().trim().min(1).max(500)).max(100);
const templateBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  description: z.string().max(2000).nullish(),
  missionTemplate: z.string().trim().min(1).max(2000),
  timeboxMinutes: z.number().int().min(5).max(480).optional(),
  heuristics: list.optional(),
  testIdeas: list.optional(),
  defaults: z.record(z.string().max(5000)).optional(),
  scope: z.enum(['project', 'org']).optional(),
});

async function findTemplate(req: Parameters<Parameters<typeof templatesRouter.get>[1]>[0]) {
  const t = await prisma.charterTemplate.findFirst({
    where: { id: String(req.params.id), orgId: req.user!.orgId, OR: [{ projectId: null }, { projectId: req.project!.id }] },
  });
  if (!t) throw notFound('Template');
  return t;
}

function assertCanManage(req: Parameters<typeof isOrgAdmin>[0], t: { projectId: string | null }) {
  if (t.projectId === null && !isOrgAdmin(req)) throw forbidden('Only organization admins can modify organization-wide templates');
}

templatesRouter.get('/', async (req, res) => {
  const templates = await prisma.charterTemplate.findMany({
    where: {
      orgId: req.user!.orgId,
      OR: [{ projectId: null }, { projectId: req.project!.id }],
      archivedAt: req.query.includeArchived === 'true' ? undefined : null,
    },
    include: { _count: { select: { charters: true } }, createdBy: { select: { id: true, name: true } } },
    orderBy: [{ isSystem: 'desc' }, { category: 'asc' }, { name: 'asc' }],
  });
  res.json({ templates });
});

templatesRouter.get('/:id', async (req, res) => {
  res.json({ template: await findTemplate(req) });
});

templatesRouter.post('/', requireRole('LEAD'), async (req, res) => {
  const { scope, ...body } = parse(templateBody, req.body);
  if (scope === 'org' && !isOrgAdmin(req)) throw forbidden('Only organization admins can create organization-wide templates');
  const t = await prisma.charterTemplate.create({
    data: { ...body, orgId: req.user!.orgId, projectId: scope === 'org' ? null : req.project!.id, createdById: req.user!.id },
  });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'template', entityId: t.id, action: 'created', changes: { name: t.name } });
  res.status(201).json({ template: t });
});

templatesRouter.patch('/:id', requireRole('LEAD'), async (req, res) => {
  const t = await findTemplate(req);
  assertCanManage(req, t);
  const { scope: _scope, ...body } = parse(templateBody.partial(), req.body);
  const updated = await prisma.charterTemplate.update({ where: { id: t.id }, data: body });
  await audit(prisma, req, {
    projectId: req.project!.id,
    entityType: 'template',
    entityId: t.id,
    action: 'updated',
    changes: diff(t as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>, Object.keys(body)),
  });
  res.json({ template: updated });
});

templatesRouter.post('/:id/duplicate', requireRole('LEAD'), async (req, res) => {
  const t = await findTemplate(req);
  const copy = await prisma.charterTemplate.create({
    data: {
      orgId: t.orgId,
      projectId: req.project!.id,
      name: `${t.name} (copy)`.slice(0, 120),
      category: t.category,
      description: t.description,
      missionTemplate: t.missionTemplate,
      timeboxMinutes: t.timeboxMinutes,
      heuristics: t.heuristics,
      testIdeas: t.testIdeas,
      defaults: t.defaults ?? {},
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ template: copy });
});

for (const action of ['archive', 'unarchive'] as const) {
  templatesRouter.post(`/:id/${action}`, requireRole('LEAD'), async (req, res) => {
    const t = await findTemplate(req);
    assertCanManage(req, t);
    await prisma.charterTemplate.update({ where: { id: t.id }, data: { archivedAt: action === 'archive' ? new Date() : null } });
    await audit(prisma, req, { projectId: req.project!.id, entityType: 'template', entityId: t.id, action: `${action}d` });
    res.json({ ok: true });
  });
}
