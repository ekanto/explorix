import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  // index.js: CLI/server entry. server.js: library entry (startServer) used by the desktop shell.
  entryPoints: { index: 'src/index.ts', server: 'src/server.ts' },
  outdir: 'dist',
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  logLevel: 'info',
});
fs.copyFileSync('src/openapi.yaml', 'dist/openapi.yaml');
