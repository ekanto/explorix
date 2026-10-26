import fs from 'node:fs';
import path from 'node:path';

/**
 * Where Explorix keeps user data. Everything lives under the per-user application-data
 * directory (%APPDATA%\Explorix), never inside the installation directory, so updates and
 * uninstalls leave projects and evidence intact.
 */
export interface DataPaths {
  root: string;
  /** Embedded PostgreSQL cluster. */
  pg: string;
  /** Default evidence folder (screenshots, videos, attachments); the user can move it. */
  defaultEvidence: string;
  backups: string;
  work: string;
  logs: string;
  settingsFile: string;
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    pg: path.join(root, 'data', 'pg'),
    defaultEvidence: path.join(root, 'evidence'),
    backups: path.join(root, 'backups'),
    work: path.join(root, 'work'),
    logs: path.join(root, 'logs'),
    settingsFile: path.join(root, 'settings.json'),
  };
}

/** Bundled, read-only resources (server bundle, web UI, migrations, PostgreSQL binaries, licences). */
export interface ResourcePaths {
  serverEntry: string;
  webDist: string;
  migrations: string;
  pgBin: string;
  staticDir: string;
  icon: string;
  notices: string;
}

const firstExisting = (candidates: string[]) => candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;

/**
 * Packaged builds read from process.resourcesPath. Development runs (`npm start` in
 * apps/desktop) fall back to the monorepo so no staging step is needed.
 */
export function resourcePaths(opts: { packaged: boolean; resourcesPath: string; appDir: string }): ResourcePaths {
  const repo = path.resolve(opts.appDir, '..', '..');
  const res = opts.packaged ? opts.resourcesPath : path.join(opts.appDir, 'build', 'resources');
  return {
    serverEntry: path.join(res, 'server', 'server.mjs'),
    webDist: firstExisting([path.join(res, 'web'), path.join(repo, 'apps', 'web', 'dist')]),
    migrations: firstExisting([path.join(res, 'server', 'migrations'), path.join(repo, 'apps', 'server', 'prisma', 'migrations')]),
    pgBin: firstExisting([path.join(res, 'pg', 'bin'), path.join(repo, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin')]),
    staticDir: path.join(opts.appDir, 'static'),
    icon: path.join(opts.appDir, 'static', 'icon.png'),
    notices: firstExisting([path.join(res, 'legal', 'THIRD_PARTY_NOTICES.txt'), path.join(repo, 'THIRD_PARTY_NOTICES.md')]),
  };
}
