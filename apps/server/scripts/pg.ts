/**
 * Local development helper: provides a real PostgreSQL server without a system
 * install by using the `embedded-postgres` binaries. Production deployments
 * should point DATABASE_URL at a managed PostgreSQL instance and set
 * USE_EMBEDDED_PG=false.
 */
import 'dotenv/config';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, '..');

export interface PgHandle {
  started: boolean;
  stop: () => Promise<void>;
}

export function parseDbUrl(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set. Run `npm run setup` or copy .env.example to .env');
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  };
}

export function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(800);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

function embeddedFor(port: number, user: string, password: string) {
  const dataDir = path.resolve(serverRoot, process.env.EMBEDDED_PG_DIR ?? '.data/pg');
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user,
    password,
    persistent: true,
    // Force UTF-8 regardless of the OS code page (Windows defaults to WIN1252).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (e) => console.error('[postgres]', e),
  });
  return { pg, dataDir };
}

/** Ensures the configured database (plus any extra ones) exists and a server is listening. */
export async function ensurePostgres(databases: string[] = []): Promise<PgHandle> {
  const cfg = parseDbUrl();
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(cfg.host);
  const wantEmbedded = process.env.USE_EMBEDDED_PG !== 'false' && isLocal;
  const allDbs = Array.from(new Set([cfg.database, ...databases]));

  if (await isPortOpen(cfg.port)) {
    if (wantEmbedded) await createDatabases(cfg, allDbs);
    return { started: false, stop: async () => {} };
  }
  if (!wantEmbedded) {
    throw new Error(`PostgreSQL is not reachable at ${cfg.host}:${cfg.port} and USE_EMBEDDED_PG=false`);
  }
  const { pg, dataDir } = embeddedFor(cfg.port, cfg.user, cfg.password);
  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`[explorix] Initialising embedded PostgreSQL in ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();
  console.log(`[explorix] Embedded PostgreSQL listening on port ${cfg.port}`);
  await createDatabases(cfg, allDbs, pg);
  return { started: true, stop: () => pg.stop() };
}

async function createDatabases(cfg: ReturnType<typeof parseDbUrl>, names: string[], pg?: EmbeddedPostgres) {
  const instance = pg ?? embeddedFor(cfg.port, cfg.user, cfg.password).pg;
  const client = instance.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  try {
    for (const name of names) {
      if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unsafe database name: ${name}`);
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE "${name}" WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
        console.log(`[explorix] Created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}
