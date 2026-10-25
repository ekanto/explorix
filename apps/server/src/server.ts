import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { bootstrapIfEmpty } from './lib/bootstrap.js';
import { evidenceMaintenance } from './lib/evidence.js';
import { logger } from './logger.js';
import { sha256 } from './lib/passwords.js';
import { toAuthUser } from './middleware/auth.js';

export { getJob as getReportJob, jobOutputPath as reportJobOutputPath, type ReportJob } from './reporting/jobs.js';
export { setUploadLimits } from './config.js';
export { setPdfRenderer, pageTemplates, type PdfRenderRequest } from './reporting/pdf.js';
export { createBackup, restoreBackup, listBackups, pruneBackups, readMeta as readBackupMeta, backupsDir, backupPath, appliedMigrations, type BackupInfo } from './lib/backup.js';

/** Resolves the signed-in user behind a session cookie value (used to authorize desktop IPC calls). */
export async function userForSessionToken(token: string | undefined | null) {
  if (!token) return null;
  const s = await prisma.authSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { include: { orgMemberships: true } } } });
  if (!s || s.expiresAt <= new Date() || s.user.deactivatedAt) return null;
  return toAuthUser(s.user);
}

async function waitForDatabase(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (i === attempts) throw err;
      logger.warn(`Database not ready (attempt ${i}/${attempts}); retrying in 2s`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/** Removes leftovers from report jobs or uploads interrupted by a crash or forced shutdown. */
async function cleanWorkDir() {
  const root = path.resolve(config.WORK_DIR);
  for (const sub of ['report-jobs', 'backup-jobs']) {
    await fs.rm(path.join(root, sub), { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** Starts the API (and the built web app when WEB_DIST is present). Used by the CLI entry and the desktop shell. */
export async function startServer(opts: { port?: number; host?: string } = {}): Promise<RunningServer> {
  await waitForDatabase();
  await bootstrapIfEmpty();
  await cleanWorkDir();
  // Report runs cut short by a crash or forced shutdown are marked as failed rather than left running.
  await prisma.reportRun.updateMany({ where: { status: 'running' }, data: { status: 'failed', error: 'Interrupted: Explorix was closed while this report was being generated.', completedAt: new Date() } });
  const maintenance = () => evidenceMaintenance().catch((err) => logger.warn({ err }, 'Evidence maintenance failed'));
  void maintenance();
  const app = createApp();
  const host = opts.host ?? (config.isDesktop ? '127.0.0.1' : undefined);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(opts.port ?? config.PORT, host as string, () => resolve(s));
    s.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  logger.info(`Explorix API listening on http://${host ?? 'localhost'}:${port} (${config.NODE_ENV})`);

  const timers = [
    setInterval(() => void prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {}), 60 * 60_000),
    setInterval(maintenance, 6 * 60 * 60_000),
  ];
  timers.forEach((t) => t.unref());

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        timers.forEach(clearInterval);
        server.closeAllConnections?.();
        server.close(() => void prisma.$disconnect().finally(resolve));
      }),
  };
}
