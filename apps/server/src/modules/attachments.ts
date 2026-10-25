import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import type { EvidenceDerivation, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { addLog, assertCanEditContent } from '../lib/sessionService.js';
import { freeBytes, newStorageKey, sha256File, storage } from '../lib/storage.js';
import { inspectFile, IMAGE_TYPES, VIDEO_TYPES } from '../lib/media.js';
import { evidenceInclude, purgeAttachments, serializeEvidence } from '../lib/evidence.js';
import { keys } from '../lib/util.js';
import { hasRole, requireRole } from '../middleware/access.js';

export const attachmentsRouter = Router({ mergeParams: true });

/** Images/videos render inline (needed for previews and seeking); everything else is a download. */
export const INLINE_TYPES = new Set([...IMAGE_TYPES, ...VIDEO_TYPES]);
const DISK_RESERVE = 200 * 1024 * 1024;
const maxAnyUpload = () => Math.max(config.maxUploadBytes, config.maxImageBytes, config.maxVideoBytes);

// Built per request so limit changes made in the desktop settings apply immediately.
const upload = () => multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = storage.incomingDir();
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: maxAnyUpload(), files: 1, fields: 20 },
});

/** Runs multer for one file, rejecting early when the volume lacks space for the declared body. */
function receiveFile(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const declared = Number(req.headers['content-length'] ?? 0);
    const free = await freeBytes(storage.root);
    if (free !== null && declared > 0 && declared + DISK_RESERVE > free) {
      return next(new AppError(507, 'insufficient_storage', 'Not enough free disk space to store this file. Free up space or choose another evidence folder.'));
    }
    upload().single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(err.code === 'LIMIT_FILE_SIZE' ? new AppError(413, 'file_too_large', `Files must be at most ${Math.round(maxAnyUpload() / 1048576)} MB`) : badRequest(err.message));
      }
      if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC') return next(new AppError(507, 'insufficient_storage', 'The disk ran out of space while saving the file'));
      next(err as Error | undefined);
    });
  })().catch(next);
}

const safeFileName = (name: string) => path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';

/** Validates, hashes and stores an uploaded temp file. Removes the temp file on any failure. */
async function storeUpload(file: Express.Multer.File) {
  try {
    if (!file.size) throw badRequest('The file is empty');
    const info = await inspectFile(file.path, file.originalname, file.size);
    const sha256 = await sha256File(file.path);
    const storageKey = newStorageKey();
    await storage.putFile(storageKey, file.path);
    return { ...info, sha256, storageKey, size: file.size, fileName: safeFileName(file.originalname) };
  } catch (e) {
    await fsp.rm(file.path, { force: true }).catch(() => undefined);
    if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new AppError(507, 'insufficient_storage', 'The disk ran out of space while saving the file');
    throw e;
  }
}

const TARGETS = ['session', 'finding', 'issue', 'testResult', 'automationResult'] as const;
type Target = (typeof TARGETS)[number];
const targetField: Record<Target, 'sessionId' | 'findingId' | 'issueId' | 'testResultId' | 'automationResultId'> = {
  session: 'sessionId',
  finding: 'findingId',
  issue: 'issueId',
  testResult: 'testResultId',
  automationResult: 'automationResultId',
};

async function checkTarget(req: Request, type: Target, id: string, forWrite = true) {
  const projectId = req.project!.id;
  switch (type) {
    case 'session': {
      const s = await prisma.exploratorySession.findFirst({ where: { id, projectId } });
      if (!s) throw badRequest('Unknown session');
      if (forWrite) assertCanEditContent(req, s);
      return { sessionId: s.id, session: s };
    }
    case 'finding': {
      const f = await prisma.finding.findFirst({ where: { id, projectId }, include: { session: true } });
      if (!f) throw badRequest('Unknown finding');
      return { findingId: f.id, sessionId: f.sessionId ?? undefined, session: f.session && f.session.status === 'IN_PROGRESS' ? f.session : null };
    }
    case 'issue': {
      if (!(await prisma.issue.findFirst({ where: { id, projectId } }))) throw badRequest('Unknown issue');
      return { issueId: id };
    }
    case 'testResult': {
      if (!(await prisma.testResult.findFirst({ where: { id, runItem: { run: { projectId } } } }))) throw badRequest('Unknown test result');
      return { testResultId: id };
    }
    case 'automationResult': {
      if (!(await prisma.automationResult.findFirst({ where: { id, run: { projectId } } }))) throw badRequest('Unknown automation result');
      return { automationResultId: id };
    }
  }
}

/** Where-clause selecting the top-level evidence of one target (finding evidence is not repeated under its session). */
function targetWhere(projectId: string, type: Target, id: string): Prisma.AttachmentWhereInput {
  const where: Prisma.AttachmentWhereInput = { projectId, derivedFromId: null, [targetField[type]]: id };
  return where;
}

const text = (max: number) => z.string().trim().max(max).nullish();

// ---------------------------------------------------------------------------
// Listing and upload
// ---------------------------------------------------------------------------

attachmentsRouter.get('/', async (req, res) => {
  const q = parse(z.object({ targetType: z.enum(TARGETS).optional(), targetId: z.string().optional(), trash: z.enum(['1', 'true']).optional() }), req.query);
  if (q.trash) {
    const items = await prisma.attachment.findMany({
      where: { projectId: req.project!.id, deletedAt: { not: null }, derivedFromId: null, ...(hasRole(req, 'LEAD') ? {} : { uploaderId: req.user!.id }) },
      orderBy: { deletedAt: 'desc' },
      include: { ...evidenceInclude.include, finding: { select: { id: true, number: true, title: true } }, session: { select: { id: true, number: true, title: true } } },
    });
    const retentionMs = config.TRASH_RETENTION_DAYS * 86_400_000;
    return res.json({
      retentionDays: config.TRASH_RETENTION_DAYS,
      items: items.map((a) => ({
        ...serializeEvidence(a),
        finding: a.finding ? { ...a.finding, key: keys.finding(a.finding.number) } : null,
        session: a.session ? { ...a.session, key: keys.session(a.session.number) } : null,
        purgeAt: new Date(a.deletedAt!.getTime() + retentionMs),
      })),
    });
  }
  if (!q.targetType || !q.targetId) throw badRequest('targetType and targetId are required');
  const items = await prisma.attachment.findMany({
    where: { ...targetWhere(req.project!.id, q.targetType, q.targetId), deletedAt: null },
    orderBy: evidenceInclude.orderBy,
    include: evidenceInclude.include,
  });
  res.json({ items: items.map(serializeEvidence) });
});

const uploadMeta = z.object({
  targetType: z.enum(TARGETS),
  targetId: z.string().min(1),
  caption: text(500),
  label: text(200),
  description: text(5000),
  includeInReports: z.enum(['true', 'false']).optional(),
  // Client-observed metadata, only used when the server cannot read it from the file.
  durationSeconds: z.coerce.number().min(0).max(1e6).optional(),
});

attachmentsRouter.post('/', requireRole('TESTER'), receiveFile, async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Attach a non-empty file in the "file" field');
  let stored: Awaited<ReturnType<typeof storeUpload>> | null = null;
  try {
    const b = parse(uploadMeta, req.body);
    const target = await checkTarget(req, b.targetType, b.targetId);
    stored = await storeUpload(file);
    const s = stored;
    const pid = req.project!.id;
    const att = await prisma.$transaction(async (tx) => {
      const { session, ...fks } = target as typeof target & { session?: Parameters<typeof addLog>[1] | null };
      const last = await tx.attachment.aggregate({ where: targetWhere(pid, b.targetType, b.targetId), _max: { position: true } });
      const a = await tx.attachment.create({
        data: {
          projectId: pid,
          uploaderId: req.user!.id,
          fileName: s.fileName,
          storageKey: s.storageKey,
          mimeType: s.mimeType,
          kind: s.kind,
          size: s.size,
          sha256: s.sha256,
          width: s.width ?? null,
          height: s.height ?? null,
          durationSeconds: s.durationSeconds ?? (s.kind === 'VIDEO' ? (b.durationSeconds ?? null) : null),
          caption: b.caption ?? null,
          label: b.label ?? null,
          description: b.description ?? null,
          includeInReports: b.includeInReports !== 'false',
          position: (last._max.position ?? -1) + 1,
          ...fks,
        },
        include: evidenceInclude.include,
      });
      if (session) {
        const fresh = await tx.exploratorySession.findUniqueOrThrow({ where: { id: session.id } });
        await addLog(tx, fresh, { authorId: req.user!.id, type: 'ATTACHMENT', content: b.caption ? `${s.fileName} — ${b.caption}` : s.fileName, attachmentId: a.id, findingId: 'findingId' in fks ? fks.findingId : undefined });
      }
      await audit(tx, req, { projectId: pid, entityType: 'attachment', entityId: a.id, action: 'uploaded', changes: { fileName: s.fileName, size: s.size, kind: s.kind, sha256: s.sha256, target: b.targetType, targetId: b.targetId } });
      return a;
    });
    res.status(201).json({ attachment: serializeEvidence(att) });
  } catch (e) {
    await fsp.rm(file.path, { force: true }).catch(() => undefined);
    if (stored) await storage.remove(stored.storageKey).catch(() => undefined);
    throw e;
  }
});

attachmentsRouter.post('/reorder', requireRole('TESTER'), async (req, res) => {
  const b = parse(z.object({ targetType: z.enum(TARGETS), targetId: z.string().min(1), ids: z.array(z.string()).min(1).max(500) }), req.body);
  const pid = req.project!.id;
  const existing = await prisma.attachment.findMany({ where: { ...targetWhere(pid, b.targetType, b.targetId), deletedAt: null }, select: { id: true } });
  const known = new Set(existing.map((e) => e.id));
  if (new Set(b.ids).size !== b.ids.length || b.ids.some((id) => !known.has(id))) throw badRequest('ids must be distinct evidence items of this target');
  // Items not mentioned keep their relative order after the listed ones.
  const rest = existing.map((e) => e.id).filter((id) => !b.ids.includes(id));
  const order = [...b.ids, ...rest];
  await prisma.$transaction(async (tx) => {
    for (const [i, id] of order.entries()) await tx.attachment.update({ where: { id }, data: { position: i } });
    await audit(tx, req, { projectId: pid, entityType: 'attachment', entityId: b.targetId, action: 'reordered', changes: { target: b.targetType, order } });
  });
  res.json({ ok: true, order });
});

attachmentsRouter.post('/trash/empty', requireRole('LEAD'), async (req, res) => {
  const items = await prisma.attachment.findMany({ where: { projectId: req.project!.id, deletedAt: { not: null }, derivedFromId: null }, select: { id: true, fileName: true } });
  const n = await purgeAttachments(items.map((i) => i.id));
  await audit(prisma, req, { projectId: req.project!.id, entityType: 'attachment', entityId: req.project!.id, action: 'trash_emptied', changes: { count: items.length } });
  res.json({ ok: true, purged: n });
});

// ---------------------------------------------------------------------------
// Single evidence item
// ---------------------------------------------------------------------------

async function findAttachment(req: Request, opts: { includeDeleted?: boolean } = {}) {
  const a = await prisma.attachment.findFirst({
    where: { id: String(req.params.id), projectId: req.project!.id, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: { ...evidenceInclude.include, session: true },
  });
  if (!a) throw notFound('Attachment');
  return a;
}

const canManage = (req: Request, a: { uploaderId: string | null }) => a.uploaderId === req.user!.id || hasRole(req, 'LEAD');

attachmentsRouter.get('/:id', async (req, res) => {
  const a = await findAttachment(req, { includeDeleted: true });
  res.json({ attachment: serializeEvidence(a) });
});

attachmentsRouter.patch('/:id', requireRole('TESTER'), async (req, res) => {
  const b = parse(
    z.object({
      label: text(200),
      caption: text(500),
      description: text(5000),
      includeInReports: z.boolean().optional(),
      durationSeconds: z.number().min(0).max(1e6).optional(),
      width: z.number().int().positive().max(100_000).optional(),
      height: z.number().int().positive().max(100_000).optional(),
    }),
    req.body,
  );
  const a = await findAttachment(req);
  const data: Prisma.AttachmentUpdateInput = {};
  for (const k of ['label', 'caption', 'description'] as const) if (b[k] !== undefined) data[k] = b[k] || null;
  if (b.includeInReports !== undefined) data.includeInReports = b.includeInReports;
  // Media metadata measured by a client player is accepted only where the server could not read it.
  if (b.durationSeconds !== undefined && a.kind === 'VIDEO' && a.durationSeconds == null) data.durationSeconds = b.durationSeconds;
  if (b.width !== undefined && a.width == null) data.width = b.width;
  if (b.height !== undefined && a.height == null) data.height = b.height;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.attachment.update({ where: { id: a.id }, data, include: evidenceInclude.include });
    await audit(tx, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'updated', changes: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { from: (a as Record<string, unknown>)[k] ?? null, to: v }])) });
    return u;
  });
  res.json({ attachment: serializeEvidence(updated) });
});

/** Streams content after project authorization. Supports byte ranges (video seeking) and cached image thumbnails. */
attachmentsRouter.get('/:id/content', async (req, res) => {
  const a = await prisma.attachment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!a) throw notFound('Attachment');
  if (!(await storage.exists(a.storageKey))) throw new AppError(404, 'not_found', 'The evidence file is missing from the evidence folder');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (req.query.thumb === '1' && IMAGE_TYPES.has(a.mimeType)) {
    const thumbPath = path.join(storage.root, '.thumbs', `${a.storageKey.replace(/\//g, '_')}.jpg`);
    if (!fs.existsSync(thumbPath)) {
      await fsp.mkdir(path.dirname(thumbPath), { recursive: true });
      const tmp = `${thumbPath}.${crypto.randomUUID()}.tmp`;
      await sharp(storage.localPath(a.storageKey)).rotate().resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toFile(tmp);
      await fsp.rename(tmp, thumbPath).catch(() => fsp.rm(tmp, { force: true }));
    }
    res.setHeader('Content-Type', 'image/jpeg');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  const inline = INLINE_TYPES.has(a.mimeType) && req.query.download !== '1';
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  let range: { start: number; end: number } | undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, a.size - Number(m[2]));
    let end = m[1] && m[2] ? Number(m[2]) : a.size - 1;
    end = Math.min(end, a.size - 1);
    if (start > end || start >= a.size) {
      res.setHeader('Content-Range', `bytes */${a.size}`);
      return res.status(416).end();
    }
    start = Math.max(0, start);
    range = { start, end };
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${a.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
  } else {
    res.setHeader('Content-Length', String(a.size));
  }
  const stream = storage.read(a.storageKey, range);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: { code: 'not_found', message: 'Attachment content missing' } });
    else res.destroy();
  });
  stream.pipe(res);
});

/**
 * Adds a derived image (annotated copy, captured video frame or video
 * thumbnail). The original evidence is never modified.
 */
attachmentsRouter.post('/:id/derivatives', requireRole('TESTER'), receiveFile, async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Attach an image in the "file" field');
  let stored: Awaited<ReturnType<typeof storeUpload>> | null = null;
  try {
    const b = parse(z.object({ derivation: z.enum(['ANNOTATED', 'FRAME', 'THUMBNAIL']), frameTimeSeconds: z.coerce.number().min(0).max(1e6).optional(), caption: text(500), label: text(200) }), req.body);
    const parent = await findAttachment(req);
    if (parent.derivedFromId) throw badRequest('Derivatives can only be added to original evidence');
    if (b.derivation === 'ANNOTATED' && parent.kind !== 'IMAGE') throw badRequest('Only images can be annotated');
    if (b.derivation !== 'ANNOTATED' && parent.kind !== 'VIDEO') throw badRequest('Frames and thumbnails can only be added to videos');
    if (b.derivation === 'FRAME' && b.frameTimeSeconds === undefined) throw badRequest('frameTimeSeconds is required for frames');
    stored = await storeUpload(file);
    if (stored.kind !== 'IMAGE') throw new AppError(415, 'unsupported_file_type', 'Derived evidence must be an image');
    const s = stored;
    // Annotated copies and thumbnails are single-valued: replacing one discards only the previous derivative.
    const replaced = b.derivation === 'FRAME' ? [] : parent.derivatives.filter((d) => d.derivation === b.derivation);
    const created = await prisma.$transaction(async (tx) => {
      const d = await tx.attachment.create({
        data: {
          projectId: parent.projectId,
          uploaderId: req.user!.id,
          fileName: s.fileName,
          storageKey: s.storageKey,
          mimeType: s.mimeType,
          kind: 'IMAGE',
          size: s.size,
          sha256: s.sha256,
          width: s.width ?? null,
          height: s.height ?? null,
          derivedFromId: parent.id,
          derivation: b.derivation as EvidenceDerivation,
          frameTimeSeconds: b.frameTimeSeconds ?? null,
          caption: b.caption ?? null,
          label: b.label ?? null,
        },
      });
      await audit(tx, req, { projectId: parent.projectId, entityType: 'attachment', entityId: parent.id, action: `derivative_${b.derivation.toLowerCase()}`, changes: { derivativeId: d.id, frameTimeSeconds: b.frameTimeSeconds ?? null } });
      return d;
    });
    if (replaced.length) await purgeAttachments(replaced.map((r) => r.id));
    const fresh = await findAttachment(req);
    res.status(201).json({ derivative: { ...created, storageKey: undefined }, attachment: serializeEvidence(fresh) });
  } catch (e) {
    await fsp.rm(file.path, { force: true }).catch(() => undefined);
    if (stored) await storage.remove(stored.storageKey).catch(() => undefined);
    throw e;
  }
});

const markerBody = z.object({ timeSeconds: z.number().min(0).max(1e6), label: z.string().trim().min(1).max(200), note: text(2000), frameId: z.string().nullish() });

attachmentsRouter.post('/:id/markers', requireRole('TESTER'), async (req, res) => {
  const b = parse(markerBody, req.body);
  const a = await findAttachment(req);
  if (a.kind !== 'VIDEO') throw badRequest('Markers can only be added to videos');
  if (a.durationSeconds != null && b.timeSeconds > a.durationSeconds + 1) throw badRequest('The timestamp is beyond the end of the video');
  if (b.frameId && !a.derivatives.some((d) => d.id === b.frameId && d.derivation === 'FRAME')) throw badRequest('Unknown frame for this video');
  const m = await prisma.videoMarker.create({ data: { attachmentId: a.id, timeSeconds: b.timeSeconds, label: b.label, note: b.note ?? null, frameId: b.frameId ?? null, authorId: req.user!.id } });
  await audit(prisma, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'marker_added', changes: { markerId: m.id, timeSeconds: b.timeSeconds, label: b.label } });
  res.status(201).json({ marker: m });
});

attachmentsRouter.patch('/:id/markers/:markerId', requireRole('TESTER'), async (req, res) => {
  const b = parse(markerBody.partial(), req.body);
  const a = await findAttachment(req);
  const m = a.markers.find((x) => x.id === String(req.params.markerId));
  if (!m) throw notFound('Marker');
  if (b.frameId && !a.derivatives.some((d) => d.id === b.frameId && d.derivation === 'FRAME')) throw badRequest('Unknown frame for this video');
  const u = await prisma.videoMarker.update({ where: { id: m.id }, data: { timeSeconds: b.timeSeconds, label: b.label, note: b.note === undefined ? undefined : b.note || null, frameId: b.frameId === undefined ? undefined : b.frameId || null } });
  res.json({ marker: u });
});

attachmentsRouter.delete('/:id/markers/:markerId', requireRole('TESTER'), async (req, res) => {
  const a = await findAttachment(req);
  const m = a.markers.find((x) => x.id === String(req.params.markerId));
  if (!m) throw notFound('Marker');
  await prisma.videoMarker.delete({ where: { id: m.id } });
  res.json({ ok: true });
});

/**
 * Moves evidence to the project trash. The file and its links are retained so
 * it can be restored; it is purged after TRASH_RETENTION_DAYS or when the trash
 * is emptied. Derivatives (annotations, frames, thumbnails) are removed
 * immediately because they can be regenerated and the original remains intact.
 */
attachmentsRouter.delete('/:id', requireRole('TESTER'), async (req, res) => {
  const a = await findAttachment(req);
  if (!canManage(req, a)) throw forbidden('Only the uploader or a lead can delete this attachment');
  if (a.session && !a.derivedFromId) assertCanEditContent(req, a.session);
  if (a.derivedFromId) {
    await purgeAttachments([a.id]);
    await audit(prisma, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.derivedFromId, action: 'derivative_removed', changes: { derivativeId: a.id, derivation: a.derivation } });
    return res.json({ ok: true, permanent: true });
  }
  await prisma.$transaction(async (tx) => {
    await tx.attachment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    if (a.sessionId) {
      const s = await tx.exploratorySession.findUniqueOrThrow({ where: { id: a.sessionId } });
      await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: req.user!.id, type: 'SYSTEM', content: `Attachment moved to trash: ${a.fileName}`, elapsedSeconds: s.elapsedSeconds } });
    }
    await audit(tx, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'trashed', changes: { fileName: a.fileName, session: a.session ? keys.session(a.session.number) : null } });
  });
  res.json({ ok: true, permanent: false, retentionDays: config.TRASH_RETENTION_DAYS });
});

attachmentsRouter.post('/:id/restore', requireRole('TESTER'), async (req, res) => {
  const a = await findAttachment(req, { includeDeleted: true });
  if (!a.deletedAt) throw badRequest('This evidence is not in the trash');
  if (!canManage(req, a)) throw forbidden('Only the uploader or a lead can restore this attachment');
  const u = await prisma.$transaction(async (tx) => {
    const r = await tx.attachment.update({ where: { id: a.id }, data: { deletedAt: null }, include: evidenceInclude.include });
    await audit(tx, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'restored', changes: { fileName: a.fileName } });
    return r;
  });
  res.json({ attachment: serializeEvidence(u) });
});

attachmentsRouter.delete('/:id/permanent', requireRole('TESTER'), async (req, res) => {
  const a = await findAttachment(req, { includeDeleted: true });
  if (!a.deletedAt) throw badRequest('Move the evidence to the trash before deleting it permanently');
  if (!canManage(req, a)) throw forbidden('Only the uploader or a lead can delete this attachment');
  await purgeAttachments([a.id]);
  await audit(prisma, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'deleted', changes: { fileName: a.fileName, sha256: a.sha256 } });
  res.json({ ok: true });
});
