#!/usr/bin/env node
/**
 * Starts the full Explorix development stack with prefixed output:
 *   db  - embedded PostgreSQL (skipped automatically if something already listens on the port)
 *   api - Express API with tsx watch (http://localhost:4000)
 *   web - Vite dev server (http://localhost:5173, proxies /api to the API)
 * Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'apps', 'server', '.env');

if (!existsSync(envFile)) {
  console.error('[dev] apps/server/.env not found. Run `npm run setup` first.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const dbPort = Number(new URL(env.DATABASE_URL ?? 'postgresql://localhost:54329/explorix').port || 5432);
const useEmbedded = (process.env.USE_EMBEDDED_PG ?? env.USE_EMBEDDED_PG ?? 'true') !== 'false';

const colors = { db: 35, api: 36, web: 32 };
const children = [];

function run(name, args) {
  const child = spawn('npm', args, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `\x1b[${colors[name]}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    if (name !== 'db' || code !== 0) shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => (socket.end(), resolve(true)));
    socket.once('error', () => resolve(false));
  });
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGINT');
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (useEmbedded && !(await portOpen(dbPort))) {
  run('db', ['run', 'db', '-w', '@explorix/server']);
  const deadline = Date.now() + 60_000;
  while (!(await portOpen(dbPort))) {
    if (Date.now() > deadline) {
      console.error(`[dev] PostgreSQL did not start on port ${dbPort} within 60s.`);
      shutdown(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
run('api', ['run', 'dev', '-w', '@explorix/server']);
run('web', ['run', 'dev', '-w', '@explorix/web']);
