import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { config } from '../config.js';
import { Prisma, prisma, type Tx } from '../db.js';
import { AppError } from './errors.js';
import { freeBytes, sha256File, storage } from './storage.js';

/**
 * Full logical backups: every table as JSON lines taken in one REPEATABLE READ
 * snapshot, plus every evidence file referenced by the database, in a ZIP:
 *
 *   explorix-backup.json   metadata, data version (migrations) and evidence manifest
 *   db/<Table>/<n>.jsonl   one JSON object per row (row_to_json)
 *   evidence/<storageKey>  original evidence files, verified by SHA-256 on restore
 *
 * Restores replace all data in one transaction. Backups from older data versions
 * restore into the current schema (new columns take their defaults); backups from
 * newer versions are refused.
 */

export const BACKUP_FORMAT = 'explorix-backup';
const FORMAT_VERSION = 1;
const META = 'explorix-backup.json';
const CHUNK_ROWS = 5000;
const INSERT_BATCH = 500;
/** Login sessions are never backed up: restoring one would revive old cookies. */
const SKIP_TABLES = new Set(['_prisma_migrations', 'AuthSession']);
const KEY_RE = /^[\w/-]+$/;
const NAME_RE = /^[\w.-]{1,200}\.zip$/;

export type BackupReason = 'manual' | 'auto' | 'before-restore' | 'before-migration' | 'uploaded';

export interface BackupMeta {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  dataVersion: string | null;
  migrations: string[];
  createdAt: string;
  reason: BackupReason;
  organizations: string[];
  tables: Record<string, number>;
  evidence: { count: number; bytes: number; files: { key: string; sha256: string; size: number }[]; missing: string[] };
}

export interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
  reason: BackupReason | null;
  appVersion: string | null;
  dataVersion: string | null;
  evidenceCount: number | null;
  valid: boolean;
  problem: string | null;
}

export const backupsDir = () => path.resolve(config.BACKUP_DIR ?? path.join(config.WORK_DIR, 'backups'));

let busy: string | null = null;
async function exclusive<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (busy) throw new AppError(409, 'backup_busy', `Another ${busy} is in progress. Try again when it has finished.`);
  busy = what;
  try {
    return await fn();
  } finally {
    busy = null;
  }
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Resolves a backup file name inside the backups directory; anything else is rejected. */
export function backupPath(name: string): string {
  if (!NAME_RE.test(name) || path.basename(name) !== name) throw new AppError(400, 'bad_request', 'Invalid backup name');
  return path.join(backupsDir(), name);
}

export async function appliedMigrations(db: Tx | typeof prisma = prisma): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
  );
  return rows.map((r) => r.migration_name);
}

async function userTables(db: Tx | typeof prisma): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>('SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename');
  return rows.map((r) => r.tablename).filter((t) => !SKIP_TABLES.has(t));
}

async function tableColumns(db: Tx, table: string): Promise<Set<string>> {
  const rows = await db.$queryRawUnsafe<{ column_name: string }[]>(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
    table,
  );
  return new Set(rows.map((r) => r.column_name));
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBackup(opts: { reason?: BackupReason; onProgress?: (phase: string, pct: number) => void } = {}): Promise<BackupInfo> {
  return exclusive('backup or restore', () => writeBackup(opts.reason ?? 'manual', opts.onProgress));
}

async function writeBackup(reason: BackupReason, onProgress?: (phase: string, pct: number) => void): Promise<BackupInfo> {
  const dir = backupsDir();
  await fsp.mkdir(dir, { recursive: true });
  const suffix = reason === 'manual' ? '' : `_${reason}`;
  let name = `Explorix_Backup_${stamp()}${suffix}.zip`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `Explorix_Backup_${stamp()}${suffix}_${i}.zip`;
  const final = path.join(dir, name);
  const partial = `${final}.partial`;

  onProgress?.('Reading database', 5);
  // One consistent snapshot for every table and the evidence list.
  const snapshot = await prisma.$transaction(
    async (tx) => {
      const tables = await userTables(tx);
      const data = new Map<string, string[]>();
      for (const t of tables) {
        const chunks: string[] = [];
        for (let offset = 0; ; offset += CHUNK_ROWS) {
          const rows = await tx.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(t)::text AS j FROM ${q(t)} t ORDER BY ctid LIMIT ${CHUNK_ROWS} OFFSET ${offset}`);
          if (!rows.length) break;
          chunks.push(rows.map((r) => r.j).join('\n') + '\n');
          if (rows.length < CHUNK_ROWS) break;
        }
        data.set(t, chunks);
      }
      const files = await tx.$queryRawUnsafe<{ storageKey: string; sha256: string; size: number }[]>('SELECT "storageKey", sha256, size FROM "Attachment" ORDER BY "storageKey"');
      const orgs = await tx.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM "Organization" ORDER BY name');
      return { tables, data, files, orgs: orgs.map((o) => o.name), migrations: await appliedMigrations(tx) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15 * 60_000, maxWait: 30_000 },
  );

  const present: { key: string; sha256: string; size: number }[] = [];
  const missing: string[] = [];
  for (const f of snapshot.files) {
    if (KEY_RE.test(f.storageKey) && (await storage.exists(f.storageKey))) present.push({ key: f.storageKey, sha256: f.sha256, size: Number(f.size) });
    else missing.push(f.storageKey);
  }
  const evidenceBytes = present.reduce((s, f) => s + f.size, 0);
  const free = await freeBytes(dir);
  const need = evidenceBytes + 64 * 1024 * 1024;
  if (free !== null && free < need) throw new AppError(507, 'insufficient_storage', `Not enough free disk space for the backup (needs about ${Math.ceil(need / 1048576)} MB).`);

  const meta: BackupMeta = {
    format: BACKUP_FORMAT,
    formatVersion: FORMAT_VERSION,
    appVersion: config.APP_VERSION,
    dataVersion: snapshot.migrations.at(-1) ?? null,
    migrations: snapshot.migrations,
    createdAt: new Date().toISOString(),
    reason,
    organizations: snapshot.orgs,
    tables: Object.fromEntries(snapshot.tables.map((t) => [t, snapshot.data.get(t)!.reduce((n, c) => n + c.split('\n').length - 1, 0)])),
    evidence: { count: present.length, bytes: evidenceBytes, files: present, missing },
  };

  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(meta, null, 2)), META);
  zip.addBuffer(Buffer.from(README), 'README.txt');
  for (const t of snapshot.tables) {
    snapshot.data.get(t)!.forEach((chunk, i) => zip.addBuffer(Buffer.from(chunk, 'utf8'), `db/${t}/${String(i + 1).padStart(4, '0')}.jsonl`));
  }
  for (const f of present) {
    const already = /\.(png|jpe?g|webp|mp4|webm|mov|zip|pdf)$/i.test(f.key);
    zip.addFile(storage.localPath(f.key), `evidence/${f.key}`, { compress: !already });
  }
  zip.end();
  onProgress?.('Writing evidence', 30);
  try {
    await pipeline(zip.outputStream as unknown as Readable, fs.createWriteStream(partial));
    await fsp.rename(partial, final);
  } catch (err) {
    await fsp.rm(partial, { force: true });
    if ((err as NodeJS.ErrnoException).code === 'ENOSPC') throw new AppError(507, 'insufficient_storage', 'The disk ran out of space while writing the backup.');
    throw err;
  }
  onProgress?.('Done', 100);
  const st = await fsp.stat(final);
  return infoFrom(name, st, meta, null);
}

const README = `Explorix backup
===============

This archive contains a complete Explorix workspace: every database table
(db/<Table>/*.jsonl, one JSON object per row) and every evidence file
(evidence/...). explorix-backup.json describes the data version and lists the
SHA-256 checksum of every evidence file.

Restore it from Explorix: Administration > Backup & restore > Restore from file.
Restoring replaces all current data; Explorix first saves a safety backup.

The archive contains user accounts (password hashes), findings and evidence.
Store it as securely as the workspace itself.
`;

function infoFrom(name: string, st: fs.Stats, meta: BackupMeta | null, problem: string | null): BackupInfo {
  return {
    name,
    bytes: st.size,
    createdAt: meta?.createdAt ?? st.mtime.toISOString(),
    reason: meta?.reason ?? null,
    appVersion: meta?.appVersion ?? null,
    dataVersion: meta?.dataVersion ?? null,
    evidenceCount: meta?.evidence.count ?? null,
    valid: !!meta && !problem,
    problem,
  };
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupsDir();
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => NAME_RE.test(n));
  const out: BackupInfo[] = [];
  for (const n of names) {
    const st = await fsp.stat(path.join(dir, n));
    try {
      out.push(infoFrom(n, st, await readMeta(path.join(dir, n)), null));
    } catch (err) {
      out.push(infoFrom(n, st, null, err instanceof AppError ? err.message : 'Not a readable Explorix backup'));
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` automatic backups of a reason; manual backups are never pruned. */
export async function pruneBackups(reason: Exclude<BackupReason, 'manual'>, keep: number) {
  const all = (await listBackups()).filter((b) => b.reason === reason);
  for (const b of all.slice(keep)) await fsp.rm(path.join(backupsDir(), b.name), { force: true });
}

// ---------------------------------------------------------------------------
// Read / validate
// ---------------------------------------------------------------------------

interface OpenZip {
  zip: yauzl.ZipFile;
  entries: Map<string, yauzl.Entry>;
}

function openZip(file: string): Promise<OpenZip> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) return reject(new AppError(422, 'invalid_backup', 'The file is not a valid ZIP archive.'));
      const entries = new Map<string, yauzl.Entry>();
      zip.on('entry', (e: yauzl.Entry) => {
        entries.set(e.fileName, e);
        zip.readEntry();
      });
      zip.on('end', () => resolve({ zip, entries }));
      zip.on('error', () => reject(new AppError(422, 'invalid_backup', 'The backup archive is damaged.')));
      zip.readEntry();
    });
  });
}

const entryStream = (z: OpenZip, e: yauzl.Entry) =>
  new Promise<Readable>((resolve, reject) => z.zip.openReadStream(e, (err, s) => (err || !s ? reject(err) : resolve(s))));

async function entryText(z: OpenZip, e: yauzl.Entry, max = 512 * 1024 * 1024): Promise<string> {
  if (e.uncompressedSize > max) throw new AppError(422, 'invalid_backup', 'A backup entry is unexpectedly large.');
  const parts: Buffer[] = [];
  for await (const c of await entryStream(z, e)) parts.push(c as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

async function metaOf(z: OpenZip): Promise<BackupMeta> {
  const e = z.entries.get(META);
  if (!e) throw new AppError(422, 'invalid_backup', 'This file is not an Explorix backup (explorix-backup.json is missing).');
  let meta: BackupMeta;
  try {
    meta = JSON.parse(await entryText(z, e, 64 * 1024 * 1024));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(422, 'invalid_backup', 'The backup metadata is damaged.');
  }
  if (meta?.format !== BACKUP_FORMAT || !Array.isArray(meta.migrations) || typeof meta.tables !== 'object' || !Array.isArray(meta.evidence?.files)) {
    throw new AppError(422, 'invalid_backup', 'This file is not an Explorix backup.');
  }
  if (meta.formatVersion > FORMAT_VERSION) throw new AppError(409, 'backup_too_new', 'This backup was created by a newer version of Explorix. Update Explorix to restore it.');
  return meta;
}

export async function readMeta(file: string): Promise<BackupMeta> {
  const z = await openZip(file);
  try {
    return await metaOf(z);
  } finally {
    z.zip.close();
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreResult {
  tables: number;
  rows: number;
  evidenceRestored: number;
  evidenceMissing: string[];
  safetyBackup: string | null;
  backupAppVersion: string;
  backupDataVersion: string | null;
}

export async function restoreBackup(file: string, opts: { safetyBackup?: boolean; onProgress?: (phase: string, pct: number) => void } = {}): Promise<RestoreResult> {
  return exclusive('backup or restore', async () => {
    const progress = opts.onProgress ?? (() => undefined);
    const z = await openZip(file);
    const stageDir = path.join(storage.root, `.restore-${crypto.randomUUID()}`);
    try {
      progress('Checking backup', 2);
      const meta = await metaOf(z);
      const current = await appliedMigrations();
      const unknown = meta.migrations.filter((m) => !current.includes(m));
      if (unknown.length) throw new AppError(409, 'backup_too_new', 'This backup was created by a newer version of Explorix (its data version is not known to this installation). Update Explorix to restore it.');

      // Every entry must be one we expect: no stray paths, no traversal.
      const tables = new Set(await userTables(prisma));
      const dbEntries = new Map<string, yauzl.Entry[]>();
      const evidence = new Map(meta.evidence.files.map((f) => [f.key, f]));
      for (const [n, e] of z.entries) {
        if (n === META || n === 'README.txt' || n.endsWith('/')) continue;
        const m = /^db\/([A-Za-z_][\w]*)\/\d{4}\.jsonl$/.exec(n);
        if (m) {
          if (!tables.has(m[1]!)) {
            if (SKIP_TABLES.has(m[1]!)) continue;
            throw new AppError(409, 'backup_incompatible', `The backup contains data (${m[1]}) this version of Explorix does not know.`);
          }
          dbEntries.set(m[1]!, [...(dbEntries.get(m[1]!) ?? []), e].sort((a, b) => a.fileName.localeCompare(b.fileName)));
          continue;
        }
        const key = n.startsWith('evidence/') ? n.slice('evidence/'.length) : null;
        if (!key || !KEY_RE.test(key) || key.includes('..') || !evidence.has(key)) throw new AppError(422, 'invalid_backup', `Unexpected file in backup: ${n.slice(0, 120)}`);
      }

      const needed = meta.evidence.files.reduce((s, f) => s + f.size, 0) + 64 * 1024 * 1024;
      const free = await freeBytes(storage.root);
      if (free !== null && free < needed) throw new AppError(507, 'insufficient_storage', `Not enough free disk space to restore this backup (needs about ${Math.ceil(needed / 1048576)} MB).`);

      // 1. Stage and verify evidence before touching the database.
      progress('Verifying evidence', 5);
      await fsp.mkdir(stageDir, { recursive: true });
      const staged: string[] = [];
      const missing = [...(meta.evidence.missing ?? [])];
      let done = 0;
      for (const f of meta.evidence.files) {
        const e = z.entries.get(`evidence/${f.key}`);
        done++;
        if (!e) {
          missing.push(f.key);
          continue;
        }
        if (e.uncompressedSize !== f.size) throw new AppError(422, 'invalid_backup', `Evidence file ${f.key} has the wrong size; the backup may be damaged.`);
        const dest = path.join(stageDir, ...f.key.split('/'));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await pipeline(await entryStream(z, e), fs.createWriteStream(dest));
        if ((await sha256File(dest)) !== f.sha256) throw new AppError(422, 'invalid_backup', `Evidence file ${f.key} failed its checksum; the backup is damaged.`);
        const existing = storage.localPath(f.key);
        if (fs.existsSync(existing) && (await fsp.stat(existing)).size === f.size && (await sha256File(existing)) === f.sha256) await fsp.rm(dest);
        else staged.push(f.key);
        progress(`Verifying evidence (${done}/${meta.evidence.files.length})`, 5 + (40 * done) / Math.max(1, meta.evidence.files.length));
      }

      // 2. Safety backup of the current state.
      let safety: string | null = null;
      if (opts.safetyBackup !== false) {
        progress('Saving a safety backup of the current data', 50);
        safety = (await writeBackup('before-restore')).name;
      }

      // 3. Replace all data in one transaction.
      progress('Restoring database', 70);
      let rows = 0;
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          const all = await userTables(tx);
          await tx.$executeRawUnsafe(`TRUNCATE ${[...all, 'AuthSession'].map(q).join(', ')} CASCADE`);
          for (const [table, entries] of dbEntries) {
            const cols = await tableColumns(tx, table);
            for (const e of entries) {
              const lines = (await entryText(z, e)).split('\n').filter(Boolean);
              if (!lines.length) continue;
              const keys = Object.keys(JSON.parse(lines[0]!)).filter((k) => cols.has(k));
              const list = keys.map(q).join(', ');
              for (let i = 0; i < lines.length; i += INSERT_BATCH) {
                const batch = `[${lines.slice(i, i + INSERT_BATCH).join(',')}]`;
                rows += await tx.$executeRawUnsafe(`INSERT INTO ${q(table)} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${q(table)}, $1::json)`, batch);
              }
            }
          }
          const seqs = await tx.$queryRawUnsafe<{ t: string; c: string; s: string }[]>(
            `SELECT table_name AS t, column_name AS c, pg_get_serial_sequence(quote_ident(table_name), column_name) AS s
               FROM information_schema.columns WHERE table_schema = current_schema() AND column_default LIKE 'nextval%'`,
          );
          for (const s of seqs) if (s.s) await tx.$executeRawUnsafe(`SELECT setval('${s.s.replace(/'/g, "''")}', COALESCE((SELECT MAX(${q(s.c)}) FROM ${q(s.t)}), 0) + 1, false)`);
        },
        { timeout: 30 * 60_000, maxWait: 30_000 },
      );

      // 4. Move verified evidence into place and remove files the restored data does not reference.
      progress('Restoring evidence', 90);
      for (const key of staged) {
        const dest = storage.localPath(key);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.rm(dest, { force: true });
        await fsp.rename(path.join(stageDir, ...key.split('/')), dest);
      }
      const keep = new Set(meta.evidence.files.map((f) => f.key));
      for (const e of await fsp.readdir(storage.root, { withFileTypes: true, recursive: true })) {
        if (!e.isFile()) continue;
        const rel = path.relative(storage.root, path.join(e.parentPath, e.name)).split(path.sep).join('/');
        if (rel.startsWith('.') || keep.has(rel)) continue;
        await fsp.rm(path.join(e.parentPath, e.name), { force: true });
      }
      progress('Done', 100);
      return {
        tables: dbEntries.size,
        rows,
        evidenceRestored: meta.evidence.files.length - missing.filter((k) => keep.has(k)).length,
        evidenceMissing: missing,
        safetyBackup: safety,
        backupAppVersion: meta.appVersion,
        backupDataVersion: meta.dataVersion,
      };
    } finally {
      z.zip.close();
      await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
