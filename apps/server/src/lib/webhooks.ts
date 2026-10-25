import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { decryptSecret } from './crypto.js';

export const WEBHOOK_EVENTS = [
  'session.started',
  'session.completed',
  'session.reviewed',
  'finding.created',
  'finding.converted',
  'issue.created',
  'issue.updated',
  'test_run.closed',
  'automation_run.completed',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signPayload(secret: string, timestamp: string, body: string) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Delivers a signed webhook to one integration and records the attempt. */
export async function deliver(integrationId: string, event: string, data: unknown) {
  const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
  if (!integration) return null;
  const cfg = integration.config as { url?: string };
  const payload = { event, deliveredAt: new Date().toISOString(), projectId: integration.projectId, data };
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Explorix-Webhooks/1.0',
    'x-explorix-event': event,
    'x-explorix-timestamp': ts,
  };
  if (integration.secretEncrypted) headers['x-explorix-signature'] = signPayload(decryptSecret(integration.secretEncrypted), ts, body);
  const started = Date.now();
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    if (!cfg.url) throw new Error('No URL configured');
    const res = await fetch(cfg.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    statusCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message;
  }
  const success = !error;
  const durationMs = Date.now() - started;
  await prisma.$transaction([
    prisma.webhookDelivery.create({
      data: { integrationId, event, payload: payload as object, statusCode, success, error, durationMs },
    }),
    prisma.integration.update({
      where: { id: integrationId },
      data: { lastStatus: success ? 'ok' : 'error', lastError: error, lastDeliveryAt: new Date() },
    }),
  ]);
  return { success, statusCode, error, durationMs };
}

/** Fire-and-forget dispatch to every enabled webhook subscribed to the event. */
export function emitEvent(projectId: string, event: WebhookEvent, data: unknown) {
  setImmediate(async () => {
    try {
      const hooks = await prisma.integration.findMany({
        where: { projectId, provider: 'WEBHOOK', enabled: true, events: { has: event } },
        select: { id: true },
      });
      await Promise.all(hooks.map((h) => deliver(h.id, event, data)));
    } catch (err) {
      logger.warn({ err, event }, 'Webhook dispatch failed');
    }
  });
}
