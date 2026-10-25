import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Tx } from '../db.js';

type Db = Tx | PrismaClient;

function jsonSafe(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v ?? null;
}

/** Field-level diff for audit history. Long text values are truncated. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, keys?: string[]) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys ?? Object.keys(after)) {
    if (!(k in after)) continue;
    const a = JSON.stringify(jsonSafe(before[k]));
    const b = JSON.stringify(jsonSafe(after[k]));
    if (a !== b) {
      const trim = (x: unknown) => (typeof x === 'string' && x.length > 500 ? x.slice(0, 500) + '…' : x);
      changes[k] = { from: trim(jsonSafe(before[k])), to: trim(jsonSafe(after[k])) };
    }
  }
  return changes;
}

export async function audit(
  db: Db,
  req: Request,
  e: { projectId?: string | null; entityType: string; entityId: string; action: string; changes?: Record<string, unknown> },
) {
  if (!req.user) return;
  await db.auditEvent.create({
    data: {
      orgId: req.user.orgId,
      projectId: e.projectId ?? null,
      actorId: req.user.id,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      changes: (jsonSafe(e.changes ?? {}) as object) ?? {},
      ip: req.ip ?? null,
    },
  });
}
