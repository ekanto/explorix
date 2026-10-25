import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { storage } from './storage.js';

const userSel = { select: { id: true, name: true, avatarColor: true } } as const;

/**
 * Prisma include for an entity's evidence list: live (non-trashed) originals in
 * user-defined order, with their derivatives (annotated copy, frames, thumbnail)
 * and video markers.
 */
export const evidenceInclude = {
  where: { deletedAt: null, derivedFromId: null },
  orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  include: {
    uploader: userSel,
    derivatives: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
    markers: { orderBy: { timeSeconds: 'asc' }, include: { author: userSel } },
  },
} satisfies Prisma.ExploratorySession$attachmentsArgs;

export type EvidenceRow = Prisma.AttachmentGetPayload<{ include: typeof evidenceInclude.include }>;
type Basic = Prisma.AttachmentGetPayload<object>;

export const contentPath = (a: { projectId: string; id: string }) => `/api/projects/${a.projectId}/attachments/${a.id}/content`;

export function serializeBasic(a: Basic) {
  const { storageKey: _k, ...rest } = a;
  return { ...rest, displayName: a.label || a.fileName, url: contentPath(a) };
}

/** Public evidence shape. Storage keys stay server-side. */
export function serializeEvidence(a: EvidenceRow | Basic) {
  const full = a as Partial<EvidenceRow>;
  const derivatives = (full.derivatives ?? []).map(serializeBasic);
  const annotated = [...derivatives].reverse().find((d) => d.derivation === 'ANNOTATED') ?? null;
  const thumbnail = derivatives.find((d) => d.derivation === 'THUMBNAIL') ?? null;
  return {
    ...serializeBasic(a),
    uploader: full.uploader ?? null,
    derivatives,
    annotatedId: annotated?.id ?? null,
    thumbnailId: thumbnail?.id ?? null,
    frames: derivatives.filter((d) => d.derivation === 'FRAME'),
    markers: full.markers ?? [],
  };
}

/** Permanently removes attachment rows (and their derivatives) plus their files. */
export async function purgeAttachments(ids: string[]) {
  if (!ids.length) return 0;
  const rows = await prisma.attachment.findMany({
    where: { OR: [{ id: { in: ids } }, { derivedFromId: { in: ids } }] },
    select: { id: true, storageKey: true },
  });
  await prisma.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await removeFiles(rows.map((r) => r.storageKey));
  return rows.length;
}

export async function removeFiles(keys: string[]) {
  for (const k of keys) await storage.remove(k).catch((e) => logger.warn({ err: e, key: k }, 'Could not remove evidence file'));
  for (const k of keys) await fsp.rm(path.join(storage.root, '.thumbs', `${k.replace(/\//g, '_')}.jpg`), { force: true }).catch(() => undefined);
}

/**
 * Startup maintenance: discards interrupted uploads and purges evidence that
 * has been in the trash longer than TRASH_RETENTION_DAYS.
 */
export async function evidenceMaintenance() {
  const incoming = storage.incomingDir();
  try {
    const cutoff = Date.now() - 60 * 60_000;
    for (const name of await fsp.readdir(incoming)) {
      const p = path.join(incoming, name);
      const st = await fsp.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fsp.rm(p, { force: true, recursive: true });
    }
  } catch {
    /* no incoming dir yet */
  }
  const before = new Date(Date.now() - config.TRASH_RETENTION_DAYS * 86_400_000);
  const old = await prisma.attachment.findMany({ where: { deletedAt: { lt: before } }, select: { id: true } });
  const n = await purgeAttachments(old.map((o) => o.id));
  if (n) logger.info({ purged: n }, 'Purged evidence older than the trash retention period');
}

/** Lists files in the evidence store that no database row references (integrity check). */
export async function findOrphanFiles(): Promise<string[]> {
  const known = new Set((await prisma.attachment.findMany({ select: { storageKey: true } })).map((a) => a.storageKey));
  const out: string[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (!known.has(r)) out.push(r);
    }
  };
  await walk(storage.root, '');
  return out;
}
