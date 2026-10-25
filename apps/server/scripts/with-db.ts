/**
 * Runs a command with PostgreSQL available. If no server is listening on the
 * DATABASE_URL port, an embedded one is started for the duration of the command.
 * Usage: tsx scripts/with-db.ts <command> [...args]
 */
import { spawn } from 'node:child_process';
import { ensurePostgres, serverRoot } from './pg.js';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: with-db <command> [...args]');
  process.exit(1);
}

const handle = await ensurePostgres();
const code: number = await new Promise((resolve) => {
  const child = spawn([cmd, ...args].join(' '), { cwd: serverRoot, stdio: 'inherit', shell: true, env: process.env });
  child.on('exit', (c) => resolve(c ?? 1));
});
if (handle.started) await handle.stop();
process.exit(code);
