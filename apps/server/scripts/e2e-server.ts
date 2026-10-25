/**
 * Starts an isolated API instance for the Playwright end-to-end suite:
 * resets the `<db>_e2e` database, loads the demo seed, then boots the server.
 * Never touches the development database.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run `npm run setup` first.');
const base = new URL(process.env.DATABASE_URL);
const dbName = `${base.pathname.replace(/^\//, '') || 'explorix'}_e2e`;
base.pathname = `/${dbName}`;

Object.assign(process.env, {
  DATABASE_URL: base.toString(),
  PORT: process.env.E2E_API_PORT ?? '4100',
  APP_URL: process.env.E2E_APP_URL ?? 'http://localhost:5174',
  STORAGE_DIR: './.data/e2e-uploads',
  AI_PROVIDER: 'none',
  SMTP_URL: '',
  RATE_LIMIT_DISABLED: 'true',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
});

const { ensurePostgres } = await import('./pg.js');
await ensurePostgres([dbName]);
const run = (cmd: string) => execSync(cmd, { cwd: serverRoot, env: process.env, stdio: 'pipe' });
run('npx prisma migrate reset --force --skip-seed --skip-generate');
run('npx tsx prisma/seed.ts');
console.log(`[explorix:e2e] Database ${dbName} reset and seeded`);

await import('../src/index.js');
