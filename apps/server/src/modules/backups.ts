import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { backupPath, backupsDir, createBackup, listBackups, readMeta, restoreBackup } from '../lib/backup.js';
import { AppError, badRequest, forbidden, notFound, parse } from '../lib/errors.js';

/**
 * Installation-wide backup and restore. Only the organization owner may use it,
 * and only on single-organization installations (the desktop app); multi-tenant
 * servers should use database-level backups instead.
 */
export const backupsRouter = Router();

backupsRouter.use((req, _res, next) => {
  void (async () => {
    if (req.user!.orgRole !== 'OWNER') throw forbidden('Only the workspace owner can manage backups');
    if ((await prisma.organization.count()) > 1) throw new AppError(409, 'multi_tenant', 'Backups cover the whole installation and are only available when it hosts a single organization.');
  })().then(() => next(), next);
});

const confirmBody = z.object({ confirm: z.literal('RESTORE', { errorMap: () => ({ message: 'Type RESTORE to confirm' }) }) });

backupsRouter.get('/', async (_req, res) => {
  res.json({ backups: await listBackups(), location: config.isDesktop ? backupsDir() : null });
});

backupsRouter.post('/', async (req, res) => {
  const b = await createBackup({ reason: 'manual' });
  await audit(prisma, req, { entityType: 'backup', entityId: b.name, action: 'created', changes: { bytes: b.bytes, evidence: b.evidenceCount } });
  res.status(201).json({ backup: b });
});

backupsRouter.get('/:name/download', async (req, res) => {
  const file = backupPath(String(req.params.name));
  if (!fs.existsSync(file)) throw notFound('Backup');
  res.download(file, path.basename(file), { dotfiles: 'allow' });
});

backupsRouter.delete('/:name', async (req, res) => {
  const file = backupPath(String(req.params.name));
  if (!fs.existsSync(file)) throw notFound('Backup');
  await fsp.rm(file);
  await audit(prisma, req, { entityType: 'backup', entityId: path.basename(file), action: 'deleted' });
  res.status(204).end();
});

async function doRestore(req: Request, res: Response, file: string) {
  const name = path.basename(file);
  const result = await restoreBackup(file);
  // Login sessions are not part of a backup, so everyone (including this user) signs in again.
  res.clearCookie('explorix_sid', { path: '/' });
  res.json({ restored: name, ...result, signInRequired: true });
}

backupsRouter.post('/:name/restore', async (req, res) => {
  parse(confirmBody, req.body);
  const file = backupPath(String(req.params.name));
  if (!fs.existsSync(file)) throw notFound('Backup');
  await doRestore(req, res, file);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = backupsDir();
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, _file, cb) => cb(null, `upload-${crypto.randomUUID()}.partial`),
  }),
  limits: { files: 1, fields: 5 },
});

function receive(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC') return next(new AppError(507, 'insufficient_storage', 'The disk ran out of space while receiving the backup'));
    if (err instanceof multer.MulterError) return next(badRequest(err.message));
    next(err as Error | undefined);
  });
}

/** Restores from an uploaded file; it is kept in the backups folder so it can be restored again later. */
backupsRouter.post('/restore-upload', receive, async (req, res) => {
  const tmp = req.file?.path;
  if (!tmp) throw badRequest('Choose a backup file');
  try {
    parse(confirmBody, req.body);
    const meta = await readMeta(tmp);
    const name = `Explorix_Backup_${meta.createdAt.slice(0, 19).replace(/[-:]/g, '').replace('T', '_')}_uploaded.zip`;
    let dest = path.join(backupsDir(), name);
    if (fs.existsSync(dest)) dest = dest.replace(/\.zip$/, `_${crypto.randomUUID().slice(0, 8)}.zip`);
    await fsp.rename(tmp, dest);
    await doRestore(req, res, dest);
  } finally {
    await fsp.rm(tmp, { force: true });
  }
});
