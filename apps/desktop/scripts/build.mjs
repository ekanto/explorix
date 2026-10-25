// Builds Explorix Desktop.
//   node scripts/build.mjs          → main/preload bundles + server desktop bundle (development: dependencies resolve from the monorepo)
//   node scripts/build.mjs --stage  → additionally builds the web UI and stages everything electron-builder packages into build/resources
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..', '..');
const serverApp = path.join(repo, 'apps', 'server');
const rootModules = path.join(repo, 'node_modules');
const out = path.join(desktop, 'build', 'resources');
const stage = process.argv.includes('--stage');
const t0 = Date.now();

// Server packages that are loaded from node_modules at runtime instead of being bundled:
// native addons (Prisma engine, sharp), packages that read their own files at runtime, pino (worker-based transports),
// and strtok3, which file-type loads with a runtime-only import() that esbuild cannot see.
const SERVER_EXTERNALS = ['@prisma/client', '.prisma/client', 'sharp', 'swagger-ui-express', 'pino', 'pino-http', 'strtok3'];
// Never shipped: development-only PDF renderer and pretty logger.
const NEVER = ['playwright-core', 'pino-pretty', 'embedded-postgres'];

// 1. Main process and preloads (CommonJS; sandboxed preloads must be single files).
await build({
  entryPoints: { main: 'src/main.ts', preload: 'src/preload.ts', 'shell-preload': 'src/shell-preload.ts' },
  absWorkingDir: desktop,
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'pg-native'],
  sourcemap: 'linked',
  logLevel: 'warning',
});

// 2. Server library bundle used in-process by the main process.
fs.rmSync(path.join(out, 'server'), { recursive: true, force: true });
await build({
  entryPoints: { server: path.join(serverApp, 'src', 'server.ts') },
  outdir: path.join(out, 'server'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: [...SERVER_EXTERNALS, ...NEVER],
  // Bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire as __explorixCreateRequire } from 'node:module'; const require = __explorixCreateRequire(import.meta.url);" },
  sourcemap: 'linked',
  logLevel: 'warning',
});
fs.copyFileSync(path.join(serverApp, 'src', 'openapi.yaml'), path.join(out, 'server', 'openapi.yaml'));
fs.cpSync(path.join(serverApp, 'prisma', 'migrations'), path.join(out, 'server', 'migrations'), { recursive: true });

if (stage) {
  // 3. Web UI.
  execSync('npm run build -w @explorix/web', { cwd: repo, stdio: 'inherit' });
  fs.rmSync(path.join(out, 'web'), { recursive: true, force: true });
  fs.cpSync(path.join(repo, 'apps', 'web', 'dist'), path.join(out, 'web'), { recursive: true });

  // 4. PostgreSQL binaries (bin, lib, share only).
  const pgSrc = path.join(rootModules, '@embedded-postgres', 'windows-x64', 'native');
  fs.rmSync(path.join(out, 'pg'), { recursive: true, force: true });
  for (const sub of ['bin', 'lib', 'share']) fs.cpSync(path.join(pgSrc, sub), path.join(out, 'pg', sub), { recursive: true });
  fs.copyFileSync(path.join(rootModules, '@embedded-postgres', 'windows-x64', 'LICENSE.md'), path.join(out, 'pg', 'LICENSE-embedded-postgres.md'));

  // 5. Runtime dependency closure of the server externals.
  const dest = path.join(out, 'server', 'node_modules');
  fs.rmSync(dest, { recursive: true, force: true });
  const staged = new Map();
  const skip = (src) => {
    const base = path.basename(src);
    return base === 'node_modules' || base.endsWith('.d.ts') || base.endsWith('.map') || base === 'CHANGELOG.md' || base === '.cache';
  };
  const locate = (name, fromDir) => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json')) || (name === '.prisma/client' && fs.existsSync(candidate))) return candidate;
      if (dir === path.dirname(dir) || dir === repo) break;
    }
    const top = path.join(rootModules, name);
    return fs.existsSync(top) ? top : null;
  };
  const visit = (name, fromDir, optional) => {
    if (NEVER.includes(name)) return;
    const src = locate(name, fromDir);
    if (!src) {
      if (!optional) throw new Error(`Missing runtime dependency ${name} (needed from ${fromDir})`);
      return;
    }
    // Nested copies keep their relative position (node_modules/a/node_modules/b); hoisted ones go to the root.
    const rel = path.relative(rootModules, src);
    if (rel.startsWith('..')) throw new Error(`Unexpected dependency location ${src}`);
    if (staged.has(rel)) return;
    staged.set(rel, src);
    fs.cpSync(src, path.join(dest, rel), { recursive: true, filter: (s) => s === src || !skip(s) });
    const pkgFile = path.join(src, 'package.json');
    if (!fs.existsSync(pkgFile)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, src, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, src, true);
    // Peers too (swagger-ui-express requires express): the packaged app has no monorepo node_modules to fall back on.
    for (const dep of Object.keys(pkg.peerDependencies ?? {})) if (!pkg.peerDependenciesMeta?.[dep]?.optional) visit(dep, src, false);
  };
  for (const name of SERVER_EXTERNALS) visit(name, serverApp, false);

  // The packaged app cannot fall back to the monorepo's node_modules, so every bare module the
  // bundle loads at runtime (static, dynamic or hidden import, or require) must be staged.
  const bundle = fs.readFileSync(path.join(out, 'server', 'server.mjs'), 'utf8');
  const builtins = new Set((await import('node:module')).builtinModules);
  const unresolved = new Set();
  for (const m of bundle.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimportAtRuntime\s*\(\s*|\brequire\s*\(\s*)["']((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.\/-]*)?)["']/g)) {
    const spec = m[1];
    if (spec.startsWith('node:') || builtins.has(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (NEVER.includes(name) || name === '.prisma') continue;
    if (!fs.existsSync(path.join(dest, name, 'package.json'))) unresolved.add(name);
  }
  if (unresolved.size) throw new Error(`The server bundle loads modules that are not staged: ${[...unresolved].join(', ')}. Add them to SERVER_EXTERNALS.`);

  const size = (p) => fs.readdirSync(p, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).reduce((a, e) => a + fs.statSync(path.join(e.parentPath, e.name)).size, 0);
  console.log(`Staged ${staged.size} runtime packages (${(size(dest) / 1048576).toFixed(1)} MB), PostgreSQL ${(size(path.join(out, 'pg')) / 1048576).toFixed(1)} MB, web ${(size(path.join(out, 'web')) / 1048576).toFixed(1)} MB`);
}
console.log(`Desktop build finished in ${((Date.now() - t0) / 1000).toFixed(1)}s${stage ? ' (staged for packaging)' : ''}`);
