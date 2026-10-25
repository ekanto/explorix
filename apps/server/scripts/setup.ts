/**
 * One-time local setup: creates apps/server/.env from .env.example (with a
 * freshly generated ENCRYPTION_KEY), starts PostgreSQL if needed, applies
 * migrations and loads demonstration data.
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const key = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(envPath, example.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${key}`));
  console.log('[explorix] Created apps/server/.env with a generated ENCRYPTION_KEY');
}

const { ensurePostgres } = await import('./pg.js');
const handle = await ensurePostgres();
try {
  execSync('npx prisma migrate deploy', { cwd: root, stdio: 'inherit' });
  if (!process.argv.includes('--no-seed')) execSync('npx tsx prisma/seed.ts', { cwd: root, stdio: 'inherit' });
} finally {
  if (handle.started) await handle.stop();
}
console.log('[explorix] Setup complete. Start everything with `npm run dev` from the repository root.');
