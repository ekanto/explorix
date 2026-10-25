import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const DB_USER = 'explorix';
export const DB_NAME = 'explorix';

export class PgError extends Error {
  constructor(
    public code: 'pg_init' | 'pg_start' | 'pg_missing',
    message: string,
    public logTail = '',
  ) {
    super(message);
  }
}

interface RunResult {
  code: number;
  output: string;
}

/**
 * Runs a PostgreSQL tool. stdout/stderr go to a temp file rather than a pipe: on Windows the
 * background postmaster inherits pg_ctl's handles, and waiting on a pipe would never finish.
 */
function run(exe: string, args: string[], timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const outFile = path.join(os.tmpdir(), `explorix-pg-${crypto.randomUUID()}.log`);
    const fd = fs.openSync(outFile, 'w');
    const child = spawn(exe, args, { stdio: ['ignore', fd, fd], windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const finish = (code: number) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      let output = '';
      try {
        output = fs.readFileSync(outFile, 'utf8');
        fs.rmSync(outFile, { force: true });
      } catch {
        /* the postmaster may still hold the file; it is cleaned up with the temp folder */
      }
      resolve({ code, output });
    };
    child.once('error', (err) => {
      clearTimeout(timer);
      fs.closeSync(fd);
      reject(err);
    });
    child.once('exit', (code) => finish(code ?? -1));
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const tail = (file: string, lines = 25) => {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
};

/**
 * Private PostgreSQL cluster for one Windows user. It listens on a random loopback port,
 * requires a password (SCRAM) and is stopped cleanly when Explorix exits.
 */
export class LocalPostgres {
  port = 0;
  private running = false;

  constructor(
    private opts: { binDir: string; dataDir: string; logFile: string; password: string },
  ) {}

  private exe(name: string) {
    const p = path.join(this.opts.binDir, `${name}.exe`);
    if (!fs.existsSync(p)) throw new PgError('pg_missing', `The bundled database engine is missing (${name}.exe). Reinstall Explorix.`);
    return p;
  }

  get initialized() {
    return fs.existsSync(path.join(this.opts.dataDir, 'PG_VERSION'));
  }

  /** Creates the cluster in a temporary folder and renames it into place, so an interrupted setup never leaves a half-built cluster. */
  async initialize() {
    if (this.initialized) return false;
    const target = this.opts.dataDir;
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
      throw new PgError('pg_init', `The database folder exists but is not a valid database: ${target}`);
    }
    const tmp = `${target}.init-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const pwFile = path.join(os.tmpdir(), `explorix-pw-${crypto.randomUUID()}`);
    fs.writeFileSync(pwFile, this.opts.password, { mode: 0o600 });
    try {
      const r = await run(this.exe('initdb'), [
        '-D', tmp, '-U', DB_USER, '--auth=scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '--no-instructions',
      ]);
      if (r.code !== 0) throw new PgError('pg_init', 'Creating the local database failed.', r.output.slice(-4000));
    } finally {
      fs.rmSync(pwFile, { force: true });
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
    return true;
  }

  private async status(): Promise<boolean> {
    const r = await run(this.exe('pg_ctl'), ['status', '-D', this.opts.dataDir]);
    return r.code === 0;
  }

  /** Stops a postmaster left behind by a crashed session, or removes its stale lock file. */
  async stopStale() {
    const pidFile = path.join(this.opts.dataDir, 'postmaster.pid');
    if (!fs.existsSync(pidFile)) return;
    if (await this.status()) {
      await run(this.exe('pg_ctl'), ['stop', '-D', this.opts.dataDir, '-m', 'fast', '-w', '-t', '30']);
    }
    if (fs.existsSync(pidFile) && !(await this.status())) fs.rmSync(pidFile, { force: true });
  }

  async start() {
    await this.stopStale();
    fs.mkdirSync(path.dirname(this.opts.logFile), { recursive: true });
    let last: RunResult | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.port = await freePort();
      last = await run(this.exe('pg_ctl'), [
        'start', '-D', this.opts.dataDir, '-w', '-t', '90', '-l', this.opts.logFile,
        '-o', `-p ${this.port} -c listen_addresses=127.0.0.1 -c max_connections=40`,
      ]);
      if (last.code === 0) {
        this.running = true;
        return this.port;
      }
    }
    throw new PgError('pg_start', 'The local database could not be started.', `${last?.output ?? ''}\n${tail(this.opts.logFile)}`.trim());
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    const r = await run(this.exe('pg_ctl'), ['stop', '-D', this.opts.dataDir, '-m', 'fast', '-w', '-t', '30']);
    if (r.code !== 0) await run(this.exe('pg_ctl'), ['stop', '-D', this.opts.dataDir, '-m', 'immediate', '-w', '-t', '15']);
  }

  url(database = DB_NAME) {
    return `postgresql://${DB_USER}:${encodeURIComponent(this.opts.password)}@127.0.0.1:${this.port}/${database}`;
  }
}
