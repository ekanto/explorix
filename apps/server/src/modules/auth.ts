import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, parse, unauthorized } from '../lib/errors.js';
import { hashPassword, passwordSchema, randomToken, sha256, verifyPassword } from '../lib/passwords.js';
import { SESSION_COOKIE, requireAuth, requireSessionAuth, setSessionCookie } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { provisionOrganization } from '../lib/bootstrap.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.rateLimitDisabled,
  message: { error: { code: 'rate_limited', message: 'Too many login attempts. Try again later.' } },
});

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, include: { orgMemberships: true } });
  const generic = () => unauthorized('Invalid email or password');
  if (!user) {
    await hashPassword(body.password); // equalize timing for unknown accounts
    throw generic();
  }
  if (user.deactivatedAt) throw generic();
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(429, 'locked', 'Account temporarily locked after repeated failed attempts. Try again later.');
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: failed >= MAX_FAILED ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLoginCount: failed },
    });
    throw generic();
  }
  if (!user.orgMemberships.length) throw generic();
  await startSession(req, res, user.id);
  res.json({ ok: true });
});

async function startSession(req: Request, res: Response, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
  await prisma.$transaction([
    prisma.authSession.create({
      data: { tokenHash: sha256(token), userId, expiresAt, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) },
    }),
    prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null } }),
  ]);
  setSessionCookie(res, token, expiresAt);
}

/** First-run wizard (desktop / single-tenant installs): only usable while the database has no organization. */
authRouter.get('/setup-status', async (_req, res) => {
  const needsSetup = config.allowSetupWizard && (await prisma.organization.count()) === 0;
  res.json({ needsSetup, desktop: config.isDesktop });
});

authRouter.post('/setup', loginLimiter, async (req, res) => {
  if (!config.allowSetupWizard) throw new AppError(404, 'not_found', 'Not found');
  const body = parse(
    z.object({
      orgName: z.string().trim().min(1).max(120),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().toLowerCase().email().max(200),
      password: passwordSchema,
    }),
    req.body,
  );
  const created = await provisionOrganization({ ...body, source: 'org.setup' });
  if (!created) throw new AppError(409, 'already_setup', 'Explorix has already been set up. Sign in instead.');
  await startSession(req, res, created.user.id);
  res.status(201).json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) await prisma.authSession.deleteMany({ where: { tokenHash: sha256(sid) } });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = req.user!;
  const org = await prisma.organization.findUnique({ where: { id: u.orgId }, select: { id: true, name: true, slug: true } });
  res.json({
    user: { id: u.id, email: u.email, name: u.name, avatarColor: u.avatarColor, orgRole: u.orgRole, preferences: u.preferences },
    org,
    desktop: config.isDesktop,
    uploadLimits: { otherBytes: config.maxUploadBytes, imageBytes: config.maxImageBytes, videoBytes: config.maxVideoBytes },
  });
});

const prefsSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'auto']).optional(),
    emailNotifications: z.boolean().optional(),
    lastProjectId: z.string().max(40).optional(),
  })
  .strict();

authRouter.patch('/me', requireAuth, requireSessionAuth, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(100).optional(),
      avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      preferences: prefsSchema.optional(),
    }),
    req.body,
  );
  const u = req.user!;
  const updated = await prisma.user.update({
    where: { id: u.id },
    data: {
      name: body.name,
      avatarColor: body.avatarColor,
      preferences: body.preferences ? { ...u.preferences, ...body.preferences } : undefined,
    },
  });
  res.json({ user: { id: updated.id, email: updated.email, name: updated.name, avatarColor: updated.avatarColor, preferences: updated.preferences } });
});

export { passwordSchema };

authRouter.post('/me/password', requireAuth, requireSessionAuth, async (req, res) => {
  const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.newPassword) } }),
    prisma.authSession.deleteMany({ where: { userId: user.id, id: { not: req.auth!.sessionId } } }),
  ]);
  await audit(prisma, req, { entityType: 'user', entityId: user.id, action: 'password_changed' });
  res.json({ ok: true });
});
