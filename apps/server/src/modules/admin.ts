import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';
import { audit } from '../lib/audit.js';
import { createSampleProject } from '../lib/sampleProject.js';
import { backupsRouter } from './backups.js';
import { paging } from '../lib/util.js';
import { requireOrgAdmin, requireSessionAuth } from '../middleware/auth.js';
import { passwordSchema } from './auth.js';

export const adminRouter = Router();
adminRouter.use(requireSessionAuth, requireOrgAdmin);

const COLORS = ['#4c6ef5', '#0ca678', '#f76707', '#ae3ec9', '#1098ad', '#e64980', '#5c940d', '#d6336c'];

adminRouter.get('/users', async (req, res) => {
  const members = await prisma.orgMember.findMany({
    where: { orgId: req.user!.orgId },
    include: {
      user: {
        select: {
          id: true, email: true, name: true, avatarColor: true, lastLoginAt: true, deactivatedAt: true, createdAt: true,
          projectMemberships: { select: { role: true, project: { select: { id: true, name: true, key: true } } } },
          teamMemberships: { select: { team: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { user: { name: 'asc' } },
  });
  res.json({
    users: members.map((m) => ({
      ...m.user,
      orgRole: m.role,
      projects: m.user.projectMemberships.map((p) => ({ ...p.project, role: p.role })),
      teams: m.user.teamMemberships.map((t) => t.team),
      projectMemberships: undefined,
      teamMemberships: undefined,
    })),
  });
});

adminRouter.post('/users', async (req, res) => {
  const body = parse(
    z.object({
      email: z.string().trim().toLowerCase().email().max(200),
      name: z.string().trim().min(1).max(100),
      password: passwordSchema,
      orgRole: z.enum(['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER'),
      projects: z.array(z.object({ projectId: z.string(), role: z.enum(['ADMIN', 'LEAD', 'TESTER', 'VIEWER']) })).default([]),
    }),
    req.body,
  );
  if (body.orgRole === 'OWNER' && req.user!.orgRole !== 'OWNER') throw forbidden('Only owners can create owners');
  const projectIds = body.projects.map((p) => p.projectId);
  const valid = await prisma.project.count({ where: { id: { in: projectIds }, orgId: req.user!.orgId } });
  if (valid !== new Set(projectIds).size) throw badRequest('Unknown project');
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        avatarColor: COLORS[Math.floor(Math.random() * COLORS.length)],
        orgMemberships: { create: { orgId: req.user!.orgId, role: body.orgRole } },
        projectMemberships: { create: body.projects.map((p) => ({ projectId: p.projectId, role: p.role })) },
      },
    });
    await audit(tx, req, { entityType: 'user', entityId: u.id, action: 'created', changes: { email: body.email, orgRole: body.orgRole } });
    return u;
  });
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      orgRole: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
      deactivated: z.boolean().optional(),
      password: passwordSchema.optional(),
    }),
    req.body,
  );
  const id = String(req.params.id);
  const member = await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: req.user!.orgId, userId: id } }, include: { user: true } });
  if (!member) throw notFound('User');
  if ((body.orgRole === 'OWNER' || member.role === 'OWNER') && body.orgRole && req.user!.orgRole !== 'OWNER') {
    throw forbidden('Only owners can change owner roles');
  }
  if (id === req.user!.id && (body.deactivated || (body.orgRole && body.orgRole !== member.role))) {
    throw badRequest('You cannot deactivate yourself or change your own role');
  }
  if (member.role === 'OWNER' && (body.deactivated || (body.orgRole && body.orgRole !== 'OWNER'))) {
    const owners = await prisma.orgMember.count({ where: { orgId: req.user!.orgId, role: 'OWNER', user: { deactivatedAt: null } } });
    if (owners <= 1) throw badRequest('The organization must keep at least one active owner');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: body.name,
        deactivatedAt: body.deactivated === undefined ? undefined : body.deactivated ? new Date() : null,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
        lockedUntil: body.password ? null : undefined,
      },
    });
    if (body.orgRole) await tx.orgMember.update({ where: { id: member.id }, data: { role: body.orgRole } });
    if (body.deactivated || body.password) await tx.authSession.deleteMany({ where: { userId: id } });
    await audit(tx, req, {
      entityType: 'user',
      entityId: id,
      action: 'updated',
      changes: { name: body.name, orgRole: body.orgRole, deactivated: body.deactivated, passwordReset: !!body.password },
    });
  });
  res.json({ ok: true });
});

// Teams -------------------------------------------------------------------

adminRouter.get('/teams', async (req, res) => {
  const teams = await prisma.team.findMany({
    where: { orgId: req.user!.orgId },
    include: { members: { include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } } } },
    orderBy: { name: 'asc' },
  });
  res.json({ teams: teams.map((t) => ({ ...t, members: t.members.map((m) => m.user) })) });
});

const teamBody = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).nullish(), userIds: z.array(z.string()).optional() });

async function setTeamMembers(teamId: string, orgId: string, userIds?: string[]) {
  if (!userIds) return;
  const valid = await prisma.orgMember.count({ where: { orgId, userId: { in: userIds } } });
  if (valid !== new Set(userIds).size) throw badRequest('Unknown user');
  await prisma.$transaction([
    prisma.teamMember.deleteMany({ where: { teamId } }),
    prisma.teamMember.createMany({ data: Array.from(new Set(userIds)).map((userId) => ({ teamId, userId })) }),
  ]);
}

adminRouter.post('/teams', async (req, res) => {
  const body = parse(teamBody, req.body);
  const team = await prisma.team.create({ data: { orgId: req.user!.orgId, name: body.name, description: body.description } });
  await setTeamMembers(team.id, req.user!.orgId, body.userIds);
  await audit(prisma, req, { entityType: 'team', entityId: team.id, action: 'created', changes: { name: body.name } });
  res.status(201).json({ team });
});

adminRouter.patch('/teams/:id', async (req, res) => {
  const body = parse(teamBody.partial(), req.body);
  const team = await prisma.team.findFirst({ where: { id: String(req.params.id), orgId: req.user!.orgId } });
  if (!team) throw notFound('Team');
  await prisma.team.update({ where: { id: team.id }, data: { name: body.name, description: body.description } });
  await setTeamMembers(team.id, req.user!.orgId, body.userIds);
  res.json({ ok: true });
});

adminRouter.delete('/teams/:id', async (req, res) => {
  const team = await prisma.team.findFirst({ where: { id: String(req.params.id), orgId: req.user!.orgId } });
  if (!team) throw notFound('Team');
  await prisma.team.delete({ where: { id: team.id } });
  await audit(prisma, req, { entityType: 'team', entityId: team.id, action: 'deleted', changes: { name: team.name } });
  res.json({ ok: true });
});

/** Adds every member of a team to a project with the given role (existing memberships are kept). */
adminRouter.post('/teams/:id/add-to-project', async (req, res) => {
  const body = parse(z.object({ projectId: z.string(), role: z.enum(['ADMIN', 'LEAD', 'TESTER', 'VIEWER']) }), req.body);
  const team = await prisma.team.findFirst({ where: { id: String(req.params.id), orgId: req.user!.orgId }, include: { members: true } });
  const project = await prisma.project.findFirst({ where: { id: body.projectId, orgId: req.user!.orgId } });
  if (!team || !project) throw notFound('Team or project');
  const result = await prisma.projectMember.createMany({
    data: team.members.map((m) => ({ projectId: project.id, userId: m.userId, role: body.role })),
    skipDuplicates: true,
  });
  await audit(prisma, req, { projectId: project.id, entityType: 'project', entityId: project.id, action: 'team_added', changes: { team: team.name, added: result.count } });
  res.json({ added: result.count });
});

// Organization settings ------------------------------------------------------

adminRouter.post('/sample-project', async (req, res) => {
  const project = await createSampleProject(req.user!.orgId, req.user!.id);
  res.status(201).json({ project: { id: project.id, key: project.key, name: project.name } });
});

adminRouter.get('/settings', async (req, res) => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.orgId } });
  res.json({ org: { id: org.id, name: org.name, slug: org.slug, settings: { allowMemberProjectCreation: false, ...(org.settings as object) } } });
});

adminRouter.patch('/settings', async (req, res) => {
  const body = parse(
    z.object({ name: z.string().trim().min(1).max(100).optional(), settings: z.object({ allowMemberProjectCreation: z.boolean().optional() }).strict().optional() }),
    req.body,
  );
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: req.user!.orgId } });
  await prisma.organization.update({
    where: { id: org.id },
    data: { name: body.name, settings: body.settings ? { ...(org.settings as object), ...body.settings } : undefined },
  });
  await audit(prisma, req, { entityType: 'organization', entityId: org.id, action: 'settings_updated', changes: body });
  res.json({ ok: true });
});

// Audit log -------------------------------------------------------------------

adminRouter.get('/audit', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { skip, take, page, pageSize } = paging(q, 50);
  const where = {
    orgId: req.user!.orgId,
    projectId: q.projectId || undefined,
    entityType: q.entityType || undefined,
    actorId: q.actorId || undefined,
    action: q.action || undefined,
    createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
  };
  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: { actor: { select: { id: true, name: true } }, project: { select: { id: true, key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);
  res.json({ total, page, pageSize, events });
});

// Data export (logical backup) -------------------------------------------------

adminRouter.get('/export', async (req, res) => {
  const orgId = req.user!.orgId;
  const projects = await prisma.project.findMany({
    where: { orgId },
    include: {
      members: { select: { userId: true, role: true } },
      milestones: true,
      environments: true,
      tags: true,
      customFields: true,
      classifications: true,
      resultStatuses: true,
      templates: true,
      charters: { include: { assignees: true, tags: true } },
      sessions: { include: { logEntries: true, tags: true } },
      findings: { include: { tags: true } },
      issues: true,
      requirements: { include: { charters: true, testCases: true } },
      comments: true,
      attachments: true,
      testFolders: true,
      testCases: { include: { steps: true, tags: true } },
      testPlans: true,
      testRuns: { include: { items: { include: { results: true } } } },
      automationSources: true,
      automationRuns: { include: { results: true } },
      automationTests: true,
    },
  });
  const users = await prisma.user.findMany({
    where: { orgMemberships: { some: { orgId } } },
    select: { id: true, email: true, name: true, createdAt: true, deactivatedAt: true },
  });
  const templates = await prisma.charterTemplate.findMany({ where: { orgId, projectId: null } });
  await audit(prisma, req, { entityType: 'organization', entityId: orgId, action: 'exported' });
  res.setHeader('Content-Disposition', `attachment; filename="explorix-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ format: 'explorix-export', version: 1, exportedAt: new Date().toISOString(), users, templates, projects });
});

adminRouter.use('/backups', backupsRouter);
