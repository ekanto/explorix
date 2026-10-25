import type { NextFunction, Request, Response } from 'express';
import type { ProjectRole } from '@prisma/client';
import { prisma } from '../db.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';

export const ROLE_RANK: Record<ProjectRole, number> = { VIEWER: 0, TESTER: 1, LEAD: 2, ADMIN: 3 };

export const isOrgAdmin = (req: Request) => req.user?.orgRole === 'OWNER' || req.user?.orgRole === 'ADMIN';

/** Returns the effective project role of a user (org admins are implicit project admins). */
export async function projectRoleFor(userId: string, orgRole: string, projectId: string): Promise<ProjectRole | null> {
  if (orgRole === 'OWNER' || orgRole === 'ADMIN') return 'ADMIN';
  const m = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  return m?.role ?? null;
}

/**
 * Loads :projectId and the caller's role. Responds 404 (not 403) for projects
 * the caller cannot access so that project existence is not disclosed.
 */
export async function loadProject(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  const projectId = String(req.params.projectId);
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId: req.user.orgId } });
  if (!project) throw notFound('Project');
  if (req.auth?.type === 'token' && req.auth.tokenProjectId && req.auth.tokenProjectId !== project.id) {
    throw notFound('Project');
  }
  const role = await projectRoleFor(req.user.id, req.user.orgRole, project.id);
  if (!role) throw notFound('Project');
  if (project.archivedAt && !['GET', 'HEAD'].includes(req.method) && !req.path.endsWith('/unarchive')) {
    throw forbidden('This project is archived and read-only');
  }
  req.project = project;
  req.projectRole = role;
  next();
}

export const hasRole = (req: Request, min: ProjectRole) =>
  !!req.projectRole && ROLE_RANK[req.projectRole] >= ROLE_RANK[min];

export const requireRole = (min: ProjectRole) => (req: Request, _res: Response, next: NextFunction) => {
  if (!hasRole(req, min)) throw forbidden(`Requires the ${min.toLowerCase()} role in this project`);
  next();
};

/** Validates that every user id is a member of the project (org admins count as members). */
export async function assertProjectMembers(projectId: string, orgId: string, userIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(userIds.filter((x): x is string => !!x)));
  if (!ids.length) return;
  const [members, admins] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId, userId: { in: ids } }, select: { userId: true } }),
    prisma.orgMember.findMany({ where: { orgId, userId: { in: ids }, role: { in: ['OWNER', 'ADMIN'] } }, select: { userId: true } }),
  ]);
  const ok = new Set([...members, ...admins].map((m) => m.userId));
  const missing = ids.filter((id) => !ok.has(id));
  if (missing.length) throw forbidden('One or more selected users are not members of this project');
}

/** Lists project ids the user can read. */
export async function accessibleProjectIds(req: Request): Promise<string[]> {
  if (!req.user) return [];
  const tokenProject = req.auth?.type === 'token' ? req.auth.tokenProjectId : null;
  if (isOrgAdmin(req)) {
    const all = await prisma.project.findMany({ where: { orgId: req.user.orgId }, select: { id: true } });
    return all.map((p) => p.id).filter((id) => !tokenProject || id === tokenProject);
  }
  const ms = await prisma.projectMember.findMany({
    where: { userId: req.user.id, project: { orgId: req.user.orgId } },
    select: { projectId: true },
  });
  return ms.map((m) => m.projectId).filter((id) => !tokenProject || id === tokenProject);
}
