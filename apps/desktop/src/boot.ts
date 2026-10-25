import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { applyMigrations, assertMigratable, dataVersionOf, MigrationError, planMigrations, readMigrations } from './migrate';
import { DB_NAME, LocalPostgres, PgError } from './pg';
import type { DataPaths, ResourcePaths } from './paths';
import type { SettingsStore } from './settings';

/** The subset of the server library (apps/server/src/server.ts) the shell uses. */
export interface ServerModule {
  startServer(opts: { port?: number; host?: string }): Promise<{ port: number; close(): Promise<void> }>;
  setPdfRenderer(fn: ((req: any) => Promise<void>) | null): void;
  pageTemplates(title: string, footer: string): { header: string; footer: string };
  setUploadLimits(l: { uploadMb?: number; imageMb?: number; videoMb?: number }): unknown;
  createBackup(opts?: { reason?: string; onProgress?: (phase: string, pct: number) => void }): Promise<{ name: string }>;
  pruneBackups(reason: string, keep: number): Promise<unknown>;
  restoreBackup(file: string, opts?: { safetyBackup?: boolean; onProgress?: (phase: string, pct: number) => void }): Promise<any>;
  readBackupMeta(file: string): Promise<{ createdAt: string; appVersion: string; dataVersion: string | null; migrations: string[]; organizations: string[]; tables: Record<string, number>; evidence: { count: number; bytes: number } }>;
  backupPath(name: string): string;
  getReportJob(id: string): { userId: string } | undefined;
  reportJobOutputPath(job: any, name: string): { abs: string; output: { name: string; type: 'file' | 'folder' } } | null;
  userForSessionToken(token: string | undefined | null): Promise<{ id: string; orgRole: string; name: string } | null>;
}

/** One-shot actions requested from the recovery screen or settings, carried out on the next launch before anything else runs. */
export interface PendingActions {
  restore?: string;
  reset?: boolean;
  skipUpgradeBackup?: boolean;
  evidenceMove?: { from: string; to: string };
}

export class BootError extends Error {
  constructor(
    public code: string,
    public title: string,
    message: string,
    public detail = '',
  ) {
    super(message);
  }
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

export function readPending(file: string): PendingActions {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as PendingActions;
  } catch {
    return {};
  }
}

export function writePending(file: string, p: PendingActions) {
  if (Object.keys(p).length === 0) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, JSON.stringify(p, null, 2));
}

/** Copies the evidence folder to its new location and verifies every file before switching over. */
async function moveEvidence(from: string, to: string, status: (m: string, d?: string) => void) {
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) files.push(r);
    }
  };
  if (fs.existsSync(from)) walk(from, '');
  fs.mkdirSync(to, { recursive: true });
  for (const [i, rel] of files.entries()) {
    if (i % 25 === 0) status('Moving evidence folder', `${i} of ${files.length} files`);
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(path.join(from, rel), dest);
    if (fs.statSync(dest).size !== fs.statSync(path.join(from, rel)).size) throw new Error(`Verification failed for ${rel}`);
  }
}

const rotate = (file: string, maxBytes = 10 * 1024 * 1024) => {
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, file.replace(/\.log$/, '.1.log'));
  } catch {
    /* missing */
  }
};

export interface BootContext {
  data: DataPaths;
  res: ResourcePaths;
  settings: SettingsStore;
  appVersion: string;
  status: (message: string, detail?: string) => void;
  pendingFile: string;
}

export interface Booted {
  pg: LocalPostgres;
  server: ServerModule;
  running: { port: number; close(): Promise<void> };
  dataVersion: string | null;
  evidenceDir: string;
  notices: string[];
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

let serverModule: ServerModule | null = null;

/** Sets the server's configuration (read once at import) and loads the bundled server library. */
export async function loadServer(ctx: BootContext, databaseUrl: string, encryptionKey: string, evidenceDir: string): Promise<ServerModule> {
  if (serverModule) return serverModule;
  const s = ctx.settings.get();
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DESKTOP: 'true',
    ALLOW_SETUP_WIZARD: 'true',
    COOKIE_SECURE: 'false',
    DATABASE_URL: databaseUrl,
    ENCRYPTION_KEY: encryptionKey,
    STORAGE_DIR: evidenceDir,
    WORK_DIR: ctx.data.work,
    BACKUP_DIR: ctx.data.backups,
    WEB_DIST: ctx.res.webDist,
    APP_VERSION: ctx.appVersion,
    APP_URL: 'http://127.0.0.1',
    LOG_FILE: path.join(ctx.data.logs, 'explorix.log'),
    LOG_LEVEL: 'info',
    MAX_UPLOAD_MB: String(s.limits.uploadMb),
    MAX_IMAGE_MB: String(s.limits.imageMb),
    MAX_VIDEO_MB: String(s.limits.videoMb),
    PDF_RENDERER: 'none',
    // Optional advanced overrides (e.g. SMTP_URL) may be placed in %APPDATA%\Explorix\explorix.env.
    DOTENV_CONFIG_PATH: path.join(ctx.data.root, 'explorix.env'),
  });
  if (!fs.existsSync(ctx.res.serverEntry)) throw new BootError('server_missing', 'Explorix is incomplete', 'The application files are missing or damaged. Reinstall Explorix.', ctx.res.serverEntry);
  serverModule = (await import(pathToFileURL(ctx.res.serverEntry).href)) as ServerModule;
  return serverModule;
}

export const loadedServer = () => serverModule;

export async function boot(ctx: BootContext): Promise<Booted> {
  const notices: string[] = [];
  const pending = readPending(ctx.pendingFile);
  for (const dir of [ctx.data.root, ctx.data.logs, ctx.data.work, ctx.data.backups]) fs.mkdirSync(dir, { recursive: true });
  rotate(path.join(ctx.data.logs, 'explorix.log'));
  rotate(path.join(ctx.data.logs, 'postgres.log'));

  let password: string;
  let encryptionKey: string;
  try {
    password = ctx.settings.secret('pgPassword');
    encryptionKey = ctx.settings.secret('encryptionKey');
  } catch (err) {
    throw new BootError('secrets', 'Explorix cannot unlock its data', 'The protected database credentials could not be decrypted. This happens when the data folder was copied from another Windows account or computer. Restore a backup or start with an empty database.', String(err));
  }

  // Evidence folder relocation requested in Settings.
  if (pending.evidenceMove) {
    const { from, to } = pending.evidenceMove;
    try {
      await moveEvidence(from, to, ctx.status);
      ctx.settings.update({ evidenceDir: to, previousEvidenceDir: from });
      notices.push(`Evidence moved to ${to}. The previous folder (${from}) was left in place; delete it once you have checked your evidence.`);
    } catch (err) {
      notices.push(`Moving the evidence folder failed (${(err as Error).message}); Explorix is still using ${from}.`);
    }
    delete pending.evidenceMove;
    writePending(ctx.pendingFile, pending);
  }
  const evidenceDir = ctx.settings.get().evidenceDir ?? ctx.data.defaultEvidence;
  fs.mkdirSync(evidenceDir, { recursive: true });

  const pgLog = path.join(ctx.data.logs, 'postgres.log');
  const pgFor = (dir: string) => new LocalPostgres({ binDir: ctx.res.pgBin, dataDir: dir, logFile: pgLog, password });

  // "Start with an empty database": previous data is moved aside, never deleted.
  if (pending.reset) {
    ctx.status('Preparing an empty workspace');
    await pgFor(ctx.data.pg).stopStale();
    const ts = stamp();
    if (fs.existsSync(ctx.data.pg)) fs.renameSync(ctx.data.pg, `${ctx.data.pg}-reset-${ts}`);
    if (fs.existsSync(evidenceDir) && fs.readdirSync(evidenceDir).length) fs.renameSync(evidenceDir, `${evidenceDir}.reset-${ts}`);
    fs.mkdirSync(evidenceDir, { recursive: true });
    notices.push(`Started with an empty workspace. The previous database and evidence were kept in ${path.dirname(ctx.data.pg)} and ${path.dirname(evidenceDir)}.`);
    delete pending.reset;
    writePending(ctx.pendingFile, pending);
  }

  // Restore from a backup chosen on the recovery screen: start from a fresh cluster, keep the old one aside until it succeeds.
  let restoreAside: string | null = null;
  const restoreFile = pending.restore;
  if (restoreFile) {
    delete pending.restore;
    writePending(ctx.pendingFile, pending);
    await pgFor(ctx.data.pg).stopStale();
    if (fs.existsSync(ctx.data.pg)) {
      restoreAside = `${ctx.data.pg}-before-restore-${stamp()}`;
      fs.renameSync(ctx.data.pg, restoreAside);
    }
  }

  const db = pgFor(ctx.data.pg);
  try {
    ctx.status(db.initialized ? 'Starting the local database' : 'Creating the local database', db.initialized ? undefined : 'First launch: this takes a few seconds');
    await db.initialize();
    await db.start();
  } catch (err) {
    if (restoreAside) await rollbackRestore(ctx, db, restoreAside);
    if (err instanceof PgError) {
      throw new BootError(err.code, err.code === 'pg_missing' ? 'Explorix is incomplete' : 'The local database did not start', err.message, err.logTail);
    }
    throw err;
  }

  try {
    await withClient(db.url('postgres'), async (c) => {
      const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
      if (!r.rows.length) await c.query(`CREATE DATABASE ${DB_NAME} ENCODING 'UTF8' TEMPLATE template0`);
    });

    const migrations = readMigrations(ctx.res.migrations);
    const { plan, applied } = await withClient(db.url(), async (c) => {
      const plan = await planMigrations(c, migrations);
      return { plan, applied: [] as string[] };
    });
    try {
      assertMigratable(plan);
    } catch (err) {
      const e = err as MigrationError;
      throw new BootError(e.code, e.code === 'data_too_new' ? 'This data needs a newer Explorix' : 'The database needs attention', e.message);
    }

    const server = await loadServer(ctx, db.url(), encryptionKey, evidenceDir);

    if (plan.pending.length && !plan.fresh) {
      if (!pending.skipUpgradeBackup) {
        ctx.status('Backing up your data before upgrading', `${plan.pending.length} database update(s) pending`);
        try {
          await server.createBackup({ reason: 'before-migration', onProgress: (phase, pct) => ctx.status('Backing up your data before upgrading', `${phase} (${Math.round(pct)}%)`) });
          await server.pruneBackups('before-migration', ctx.settings.get().keepBackups);
        } catch (err) {
          throw new BootError('backup_failed', 'The safety backup failed', `Explorix backs up your data before upgrading the database, and that backup failed: ${(err as Error).message}. Free up disk space and retry, or continue without the backup.`, String((err as Error).stack ?? err));
        }
      } else {
        notices.push('The database was upgraded without a safety backup, as requested.');
      }
      delete pending.skipUpgradeBackup;
      writePending(ctx.pendingFile, pending);
    }
    if (plan.pending.length) {
      ctx.status(plan.fresh ? 'Preparing the database' : 'Upgrading the database');
      try {
        await withClient(db.url(), (c) => applyMigrations(c, plan.pending, (name, i, n) => ctx.status(plan.fresh ? 'Preparing the database' : 'Upgrading the database', `Step ${i + 1} of ${n}: ${name}`)));
      } catch (err) {
        throw new BootError('migration_failed', 'The database upgrade failed', `${(err as Error).message}. Your data was left unchanged; a backup was saved before the upgrade.`);
      }
      applied.push(...plan.pending.map((m) => m.name));
    }

    if (restoreFile) {
      ctx.status('Restoring your backup');
      try {
        await server.restoreBackup(restoreFile, { safetyBackup: false, onProgress: (phase, pct) => ctx.status('Restoring your backup', `${phase} (${Math.round(pct)}%)`) });
        notices.push(`Restored ${path.basename(restoreFile)}. Sign in with an account from that backup.${restoreAside ? ` The previous database was kept in ${restoreAside}.` : ''}`);
      } catch (err) {
        throw new BootError('restore_failed', 'The backup could not be restored', `${(err as Error).message}. Your previous data was put back unchanged.`);
      }
    }

    ctx.status('Starting Explorix');
    server.setUploadLimits(ctx.settings.get().limits);
    const running = await server.startServer({ port: 0, host: '127.0.0.1' });
    return { pg: db, server, running, dataVersion: dataVersionOf(plan, applied), evidenceDir, notices };
  } catch (err) {
    if (restoreAside) await rollbackRestore(ctx, db, restoreAside);
    else await db.stop().catch(() => undefined);
    if (err instanceof BootError) throw err;
    throw new BootError('start_failed', 'Explorix could not start', (err as Error).message, String((err as Error).stack ?? err));
  }
}

async function rollbackRestore(ctx: BootContext, db: LocalPostgres, aside: string) {
  await db.stop().catch(() => undefined);
  if (fs.existsSync(ctx.data.pg)) fs.renameSync(ctx.data.pg, `${ctx.data.pg}-failed-restore-${stamp()}`);
  fs.renameSync(aside, ctx.data.pg);
}
