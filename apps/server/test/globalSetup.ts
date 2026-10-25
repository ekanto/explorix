import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './testDb';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Resets the test database, applies migrations and loads the demo seed (known fixtures). */
export default async function setup() {
  const url = testDatabaseUrl();
  const dbName = new URL(url).pathname.slice(1);
  process.env.DATABASE_URL = url;
  const { ensurePostgres } = await import('../scripts/pg');
  const handle = await ensurePostgres([dbName]);
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', STORAGE_DIR: './.data/test-uploads' };
  const run = (cmd: string) => execSync(cmd, { cwd: serverRoot, env, stdio: 'pipe' });
  run('npx prisma migrate reset --force --skip-seed --skip-generate');
  run('npx tsx prisma/seed.ts');
  return async () => {
    if (handle.started) await handle.stop();
  };
}
