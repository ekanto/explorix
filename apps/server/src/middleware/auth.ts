import type { NextFunction, Request, Response } from 'express';
import type { OrgMember, User } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { sha256 } from '../lib/passwords.js';
import type { AuthUser } from '../types.js';

export const SESSION_COOKIE = 'explorix_sid';
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'explorix';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function toAuthUser(user: User & { orgMemberships: OrgMember[] }): AuthUser | null {
  const membership = user.orgMemberships[0];
  if (!membership) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarColor: user.avatarColor,
    orgId: membership.orgId,
    orgRole: membership.role,
    preferences: (user.preferences as Record<string, unknown>) ?? {},
  };
}

/**
 * Resolves the caller from either a Bearer API token (CI/automation) or the
 * httpOnly session cookie (browser). Cookie-authenticated state-changing
 * requests must carry the `X-Requested-With: explorix` header; browsers cannot
 * add custom headers cross-origin without a CORS preflight (which we never
 * grant), so this blocks CSRF in addition to SameSite=Lax cookies.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    const token = await prisma.apiToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: { include: { orgMemberships: true } } },
    });
    const now = new Date();
    if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < now) || token.user.deactivatedAt) {
      throw unauthorized('Invalid or expired API token');
    }
    const authUser = toAuthUser(token.user);
    if (!authUser) throw unauthorized('Token owner has no organization');
    req.user = authUser;
    req.auth = { type: 'token', tokenProjectId: token.projectId };
    if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > 60_000) {
      await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
    }
    return next();
  }

  const sid = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (sid) {
    const session = await prisma.authSession.findUnique({
      where: { tokenHash: sha256(sid) },
      include: { user: { include: { orgMemberships: true } } },
    });
    const now = new Date();
    if (session && session.expiresAt > now && !session.user.deactivatedAt) {
      const authUser = toAuthUser(session.user);
      if (authUser) {
        if (!SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== CSRF_VALUE) {
          throw forbidden('Missing CSRF protection header');
        }
        req.user = authUser;
        req.auth = { type: 'session', sessionId: session.id };
        // Sliding expiration, written at most every 5 minutes.
        if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60_000) {
          const expiresAt = new Date(now.getTime() + config.SESSION_TTL_HOURS * 3600_000);
          await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
          setSessionCookie(res, sid, expiresAt);
        }
      }
    } else {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
  }
  next();
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

/** Restricts API-token callers to explicitly allowed routes (automation ingestion, read APIs). */
export function requireSessionAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.type !== 'session') throw forbidden('This endpoint requires an interactive session');
  next();
}

export function requireOrgAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (req.user.orgRole !== 'OWNER' && req.user.orgRole !== 'ADMIN') throw forbidden('Organization admin role required');
  next();
}
