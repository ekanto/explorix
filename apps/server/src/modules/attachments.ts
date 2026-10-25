import crypto from 'node:crypto';
import path from 'node:path';
import { Router, type Request } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { addLog, assertCanEditContent } from '../lib/sessionService.js';
import { newStorageKey, storage } from '../lib/storage.js';
import { keys } from '../lib/util.js';
import { hasRole, requireRole } from '../middleware/access.js';

export const attachmentsRouter = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

/** Binary types are verified by magic bytes; SVG/HTML are never accepted (script risk). */
const BINARY_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'application/zip']);
const TEXT_EXTENSIONS: Record<string, string> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.har': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
};
export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Validates an uploaded buffer and returns its canonical MIME type. */
export async function detectMime(buf: Buffer, fileName: string): Promise<string> {
  const sniffed = await fileTypeFromBuffer(buf);
  if (sniffed) {
    if (BINARY_TYPES.has(sniffed.mime)) return sniffed.mime;
    throw new AppError(415, 'unsupported_file_type', `Files of type ${sniffed.mime} are not allowed`);
  }
  const ext = path.extname(fileName).toLowerCase();
  const textMime = TEXT_EXTENSIONS[ext];
  if (!textMime) throw new AppError(415, 'unsupported_file_type', 'Allowed: PNG, JPEG, GIF, WebP, PDF, MP4, WebM, ZIP, and .txt .log .md .json .har .csv .xml');
  // Text files must be valid UTF-8 without NUL bytes.
  if (buf.includes(0) || !Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)) throw new AppError(415, 'unsupported_file_type', 'Text attachments must be UTF-8 encoded');
  return textMime;
}

const TARGETS = ['session', 'finding', 'issue', 'testResult', 'automationResult'] as const;
type Target = (typeof TARGETS)[number];

async function checkTarget(req: Request, type: Target, id: string) {
  const projectId = req.project!.id;
  switch (type) {
    case 'session': {
      const s = await prisma.exploratorySession.findFirst({ where: { id, projectId } });
      if (!s) throw badRequest('Unknown session');
      assertCanEditContent(req, s);
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

attachmentsRouter.post('/', requireRole('TESTER'), (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(err.code === 'LIMIT_FILE_SIZE' ? new AppError(413, 'file_too_large', `Files must be at most ${config.MAX_UPLOAD_MB} MB`) : badRequest(err.message));
    }
    next(err as Error | undefined);
  });
}, async (req, res) => {
  const file = req.file;
  if (!file || !file.size) throw badRequest('Attach a non-empty file in the "file" field');
  const b = parse(z.object({ targetType: z.enum(TARGETS), targetId: z.string().min(1), caption: z.string().max(500).optional() }), req.body);
  const target = await checkTarget(req, b.targetType, b.targetId);
  const mimeType = await detectMime(file.buffer, file.originalname);
  const fileName = path.basename(file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'file';
  const storageKey = newStorageKey();
  await storage.put(storageKey, file.buffer);
  const pid = req.project!.id;
  try {
    const att = await prisma.$transaction(async (tx) => {
      const { session, ...fks } = target as typeof target & { session?: Parameters<typeof addLog>[1] | null };
      const a = await tx.attachment.create({
        data: {
          projectId: pid,
          uploaderId: req.user!.id,
          fileName,
          storageKey,
          mimeType,
          size: file.size,
          sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
          caption: b.caption ?? null,
          ...fks,
        },
      });
      if (session) {
        const fresh = await tx.exploratorySession.findUniqueOrThrow({ where: { id: session.id } });
        await addLog(tx, fresh, { authorId: req.user!.id, type: 'ATTACHMENT', content: b.caption ? `${fileName} — ${b.caption}` : fileName, attachmentId: a.id, findingId: 'findingId' in fks ? fks.findingId : undefined });
      }
      await audit(tx, req, { projectId: pid, entityType: 'attachment', entityId: a.id, action: 'uploaded', changes: { fileName, size: file.size, target: b.targetType, targetId: b.targetId } });
      return a;
    });
    res.status(201).json({ attachment: { ...att, url: `/api/projects/${pid}/attachments/${att.id}/content` } });
  } catch (e) {
    await storage.remove(storageKey).catch(() => undefined);
    throw e;
  }
});

attachmentsRouter.get('/:id', async (req, res) => {
  const a = await prisma.attachment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!a) throw notFound('Attachment');
  res.json({ attachment: { ...a, url: `/api/projects/${a.projectId}/attachments/${a.id}/content` } });
});

/** Streams file content after project authorization. Non-images are always downloaded, never rendered. */
attachmentsRouter.get('/:id/content', async (req, res) => {
  const a = await prisma.attachment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id } });
  if (!a) throw notFound('Attachment');
  const inline = INLINE_TYPES.has(a.mimeType) && req.query.download !== '1';
  res.setHeader('Content-Type', a.mimeType);
  res.setHeader('Content-Length', String(a.size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${a.fileName.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.fileName)}`);
  const stream = storage.read(a.storageKey);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: { code: 'not_found', message: 'Attachment content missing' } });
    else res.destroy();
  });
  stream.pipe(res);
});

attachmentsRouter.delete('/:id', requireRole('TESTER'), async (req, res) => {
  const a = await prisma.attachment.findFirst({ where: { id: String(req.params.id), projectId: req.project!.id }, include: { session: true } });
  if (!a) throw notFound('Attachment');
  if (a.uploaderId !== req.user!.id && !hasRole(req, 'LEAD')) throw forbidden('Only the uploader or a lead can delete this attachment');
  if (a.session) assertCanEditContent(req, a.session);
  await prisma.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id: a.id } });
    if (a.sessionId) {
      const s = await tx.exploratorySession.findUniqueOrThrow({ where: { id: a.sessionId } });
      await tx.sessionLogEntry.create({ data: { sessionId: s.id, authorId: req.user!.id, type: 'SYSTEM', content: `Attachment removed: ${a.fileName}`, elapsedSeconds: s.elapsedSeconds } });
    }
    await audit(tx, req, { projectId: a.projectId, entityType: 'attachment', entityId: a.id, action: 'deleted', changes: { fileName: a.fileName, session: a.session ? keys.session(a.session.number) : null } });
  });
  await storage.remove(a.storageKey).catch(() => undefined);
  res.json({ ok: true });
});
