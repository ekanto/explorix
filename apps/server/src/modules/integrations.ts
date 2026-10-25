import dns from 'node:dns/promises';
import net from 'node:net';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict, notFound, parse } from '../lib/errors.js';
import { requireRole } from '../middleware/access.js';
import { requireSessionAuth } from '../middleware/auth.js';
import { accessibleProjectIds } from '../middleware/access.js';
import { audit } from '../lib/audit.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { randomToken, sha256 } from '../lib/passwords.js';
import { deliver, WEBHOOK_EVENTS, emitEvent } from '../lib/webhooks.js';
import { keys } from '../lib/util.js';

// ======================= API tokens (personal, for CI and scripts) =======================

export const tokensRouter = Router();

tokensRouter.get('/', async (req, res) => {
  const tokens = await prisma.apiToken.findMany({
    where: { userId: req.user!.id },
    select: { id: true, name: true, prefix: true, projectId: true, project: { select: { key: true, name: true } }, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ tokens });
});

// Tokens can only be minted from an interactive session, never by another token.
tokensRouter.post('/', requireSessionAuth, async (req, res) => {
  const body = parse(
    z.object({ name: z.string().trim().min(1).max(100), projectId: z.string().nullish(), expiresInDays: z.number().int().min(1).max(3650).nullish() }),
    req.body,
  );
  if (body.projectId && !(await accessibleProjectIds(req)).includes(body.projectId)) throw notFound('Project');
  const secret = randomToken(32);
  const prefix = `exp_${secret.slice(0, 6)}`;
  const raw = `${prefix}_${secret.slice(6)}`;
  const token = await prisma.apiToken.create({
    data: {
      name: body.name,
      prefix,
      tokenHash: sha256(raw),
      userId: req.user!.id,
      projectId: body.projectId ?? null,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
    },
  });
  await audit(prisma, req, { projectId: body.projectId ?? null, entityType: 'api_token', entityId: token.id, action: 'created', changes: { name: body.name } });
  res.status(201).json({ token: { id: token.id, name: token.name, prefix, projectId: token.projectId, expiresAt: token.expiresAt, createdAt: token.createdAt }, secret: raw });
});

tokensRouter.delete('/:id', async (req, res) => {
  const r = await prisma.apiToken.updateMany({ where: { id: String(req.params.id), userId: req.user!.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw notFound('Token');
  await audit(prisma, req, { entityType: 'api_token', entityId: String(req.params.id), action: 'revoked' });
  res.status(204).end();
});

// ======================= Project integrations =======================

export const integrationsRouter = Router({ mergeParams: true });

/** Honest capability catalog shown in the UI. */
export const INTEGRATION_CATALOG = [
  { key: 'WEBHOOK', name: 'Outgoing webhooks', status: 'available', description: 'Signed (HMAC-SHA256) JSON POSTs for session, finding, issue, test run and automation events.' },
  { key: 'GITHUB', name: 'GitHub Issues', status: 'available', description: 'Push an Explorix issue to a GitHub repository (one-way create, link stored). Status sync back from GitHub is not implemented.' },
  { key: 'JUNIT', name: 'JUnit XML import', status: 'available', description: 'Upload JUnit XML (Jest, pytest, Maven/Gradle, Cypress, Selenium, PHPUnit…) via the REST API from any CI.' },
  { key: 'PLAYWRIGHT', name: 'Playwright JSON reporter', status: 'available', description: 'Import Playwright JSON reporter output including retries (flaky detection) and attachments metadata.' },
  { key: 'CI', name: 'GitHub Actions / GitLab CI / Jenkins', status: 'available', description: 'Supported via REST API + API token (curl recipes in docs/INTEGRATIONS.md). No dedicated plugins.' },
  { key: 'JIRA', name: 'Jira', status: 'planned', description: 'Planned: two-way issue sync. Not implemented.' },
  { key: 'GITLAB', name: 'GitLab Issues', status: 'planned', description: 'Planned: issue push and sync. Not implemented.' },
  { key: 'SLACK', name: 'Slack / Teams notifications', status: 'planned', description: 'Planned. Use outgoing webhooks with a relay in the meantime.' },
] as const;

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
const isPrivateIp = (ip: string): boolean => (net.isIPv6(ip) ? ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || /^::ffff:/i.test(ip) && isPrivateIp(ip.slice(7)) : PRIVATE_V4.some((r) => r.test(ip)));

/** In production, outbound URLs must be http(s) and must not resolve to private/loopback addresses (SSRF guard). */
async function assertSafeUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('Invalid URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw badRequest('URL must use http or https');
  if (config.isProd && process.env.ALLOW_PRIVATE_WEBHOOKS !== 'true') {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addrs.length) throw badRequest('URL host could not be resolved');
    if (host === 'localhost' || addrs.some(isPrivateIp)) throw badRequest('URL resolves to a private or loopback address');
  }
  return u.toString();
}

const webhookBody = z.object({
  provider: z.literal('WEBHOOK'),
  name: z.string().trim().min(1).max(100),
  url: z.string().url().max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(8).max(200).optional(),
  enabled: z.boolean().optional(),
});
const githubBody = z.object({
  provider: z.literal('GITHUB'),
  name: z.string().trim().min(1).max(100),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Use owner/repository'),
  token: z.string().min(10).max(500),
  apiUrl: z.string().url().optional(),
  labels: z.array(z.string().max(50)).max(10).optional(),
  enabled: z.boolean().optional(),
});

function serialize(i: { id: string; provider: string; name: string; config: unknown; secretEncrypted: string | null; events: string[]; enabled: boolean; lastStatus: string | null; lastError: string | null; lastDeliveryAt: Date | null; createdAt: Date; updatedAt: Date }) {
  const { secretEncrypted, ...rest } = i;
  return { ...rest, hasSecret: !!secretEncrypted };
}

integrationsRouter.get('/', requireRole('LEAD'), async (req, res) => {
  const items = await prisma.integration.findMany({ where: { projectId: req.project!.id }, orderBy: { createdAt: 'asc' } });
  res.json({ integrations: items.map(serialize), catalog: INTEGRATION_CATALOG, webhookEvents: WEBHOOK_EVENTS });
});

integrationsRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const provider = String(req.body?.provider ?? '');
  if (provider === 'JIRA' || provider === 'GITLAB') throw new AppError(501, 'not_implemented', `${provider} integration is planned but not implemented yet.`);
  let created;
  if (provider === 'WEBHOOK') {
    const b = parse(webhookBody, req.body);
    const url = await assertSafeUrl(b.url);
    created = await prisma.integration.create({
      data: { projectId: req.project!.id, provider: 'WEBHOOK', name: b.name, config: { url }, events: b.events, secretEncrypted: b.secret ? encryptSecret(b.secret) : null, enabled: b.enabled ?? true },
    });
  } else if (provider === 'GITHUB') {
    const b = parse(githubBody, req.body);
    const apiUrl = b.apiUrl ? await assertSafeUrl(b.apiUrl) : 'https://api.github.com';
    created = await prisma.integration.create({
      data: { projectId: req.project!.id, provider: 'GITHUB', name: b.name, config: { repo: b.repo, apiUrl, labels: b.labels ?? [] }, secretEncrypted: encryptSecret(b.token), enabled: b.enabled ?? true },
    });
  } else throw badRequest('provider must be WEBHOOK or GITHUB');
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'integration', entityId: created.id, action: 'created', changes: { provider, name: created.name } });
  res.status(201).json({ integration: serialize(created) });
});

integrationsRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const existing = await prisma.integration.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!existing) throw notFound('Integration');
  const cfg = existing.config as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (existing.provider === 'WEBHOOK') {
    const b = parse(webhookBody.omit({ provider: true }).partial().extend({ secret: z.string().min(8).max(200).nullable().optional() }), req.body);
    if (b.name !== undefined) data.name = b.name;
    if (b.events !== undefined) data.events = b.events;
    if (b.enabled !== undefined) data.enabled = b.enabled;
    if (b.url !== undefined) data.config = { ...cfg, url: await assertSafeUrl(b.url) };
    if (b.secret !== undefined) data.secretEncrypted = b.secret ? encryptSecret(b.secret) : null;
  } else {
    const b = parse(githubBody.omit({ provider: true }).partial(), req.body);
    if (b.name !== undefined) data.name = b.name;
    if (b.enabled !== undefined) data.enabled = b.enabled;
    if (b.token !== undefined) data.secretEncrypted = encryptSecret(b.token);
    if (b.repo !== undefined || b.apiUrl !== undefined || b.labels !== undefined)
      data.config = { ...cfg, ...(b.repo ? { repo: b.repo } : {}), ...(b.apiUrl ? { apiUrl: await assertSafeUrl(b.apiUrl) } : {}), ...(b.labels ? { labels: b.labels } : {}) };
  }
  const updated = await prisma.integration.update({ where: { id: existing.id }, data });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'integration', entityId: existing.id, action: 'updated', changes: { fields: Object.keys(data) } });
  res.json({ integration: serialize(updated) });
});

integrationsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const r = await prisma.integration.deleteMany({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!r.count) throw notFound('Integration');
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'integration', entityId: String(req.params.id), action: 'deleted' });
  res.status(204).end();
});

async function githubFetch(integration: { config: unknown; secretEncrypted: string | null }, path: string, init: RequestInit = {}) {
  const cfg = integration.config as { apiUrl?: string };
  if (!integration.secretEncrypted) throw badRequest('Integration has no token configured');
  return fetch(`${(cfg.apiUrl ?? 'https://api.github.com').replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${decryptSecret(integration.secretEncrypted)}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Explorix',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'manual',
  });
}

integrationsRouter.post('/:id/test', requireRole('ADMIN'), async (req, res) => {
  const i = await prisma.integration.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!i) throw notFound('Integration');
  if (i.provider === 'WEBHOOK') {
    const r = await deliver(i.id, 'ping', { message: 'Explorix webhook test', project: { id: req.project!.id, key: req.project!.key } });
    return res.json({ result: r });
  }
  const cfg = i.config as { repo: string };
  let ok = false;
  let message = '';
  try {
    const r = await githubFetch(i, `/repos/${cfg.repo}`);
    ok = r.ok;
    message = r.ok ? 'Repository reachable' : `GitHub returned HTTP ${r.status}`;
  } catch (e) {
    message = (e as Error).message;
  }
  await prisma.integration.update({ where: { id: i.id }, data: { lastStatus: ok ? 'ok' : 'error', lastError: ok ? null : message, lastDeliveryAt: new Date() } });
  res.json({ result: { success: ok, message } });
});

integrationsRouter.get('/:id/deliveries', requireRole('LEAD'), async (req, res) => {
  const i = await prisma.integration.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!i) throw notFound('Integration');
  const deliveries = await prisma.webhookDelivery.findMany({ where: { integrationId: i.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ deliveries });
});

/** One-way push of an Explorix issue to GitHub Issues. Stores the external key/URL on the issue. */
integrationsRouter.post('/:id/push-issue', requireRole('TESTER'), async (req, res) => {
  const { issueId } = parse(z.object({ issueId: z.string() }), req.body);
  const integ = await prisma.integration.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id, provider: 'GITHUB', enabled: true } });
  if (!integ) throw notFound('GitHub integration');
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId: req.project!.id },
    include: { sourceFinding: { include: { session: { select: { id: true, number: true } } } }, reporter: { select: { name: true } } },
  });
  if (!issue) throw notFound('Issue');
  if (issue.externalKey) throw conflict(`Issue is already linked to ${issue.externalKey}`, { externalUrl: issue.externalUrl });
  const f = issue.sourceFinding;
  const link = `${config.APP_URL.replace(/\/$/, '')}/projects/${req.project!.id}/issues/${issue.id}`;
  const body = [
    issue.description ?? '',
    f?.reproSteps ? `\n### Steps to reproduce\n${f.reproSteps}` : '',
    f?.expected ? `\n### Expected\n${f.expected}` : '',
    f?.actual ? `\n### Actual\n${f.actual}` : '',
    f?.environment ? `\n### Environment\n${f.environment}` : '',
    `\n---\n**Severity:** ${issue.severity} · **Priority:** ${issue.priority} · Reported by ${issue.reporter.name} in Explorix ${keys.issue(req.project!.key, issue.number)}${f?.session ? ` (session ${keys.session(f.session.number)})` : ''}\n${link}`,
  ].join('\n');
  const cfg = integ.config as { repo: string; labels?: string[] };
  let r: Response;
  try {
    r = await githubFetch(integ, `/repos/${cfg.repo}/issues`, { method: 'POST', body: JSON.stringify({ title: issue.title, body, labels: cfg.labels?.length ? cfg.labels : undefined }) });
  } catch (e) {
    await prisma.integration.update({ where: { id: integ.id }, data: { lastStatus: 'error', lastError: (e as Error).message, lastDeliveryAt: new Date() } });
    throw new AppError(502, 'integration_error', `Could not reach GitHub: ${(e as Error).message}`);
  }
  if (!r.ok) {
    const msg = `GitHub returned HTTP ${r.status}`;
    await prisma.integration.update({ where: { id: integ.id }, data: { lastStatus: 'error', lastError: msg, lastDeliveryAt: new Date() } });
    throw new AppError(502, 'integration_error', msg);
  }
  const gh = (await r.json()) as { number: number; html_url: string };
  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: { externalProvider: 'GITHUB', externalKey: `${cfg.repo}#${gh.number}`, externalUrl: gh.html_url },
  });
  await prisma.integration.update({ where: { id: integ.id }, data: { lastStatus: 'ok', lastError: null, lastDeliveryAt: new Date() } });
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'issue', entityId: issue.id, action: 'pushed_external', changes: { externalKey: updated.externalKey } });
  emitEvent(req.project!.id, 'issue.updated', { id: issue.id, externalKey: updated.externalKey });
  res.json({ issue: { id: updated.id, externalProvider: updated.externalProvider, externalKey: updated.externalKey, externalUrl: updated.externalUrl } });
});
