// electron-builder always drops node_modules folders from extraResources, so the
// server's runtime dependencies (Prisma engine, sharp, pino, ...) are copied here,
// after packing and before the NSIS and portable targets are built from appOutDir.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const from = path.join(__dirname, '..', 'build', 'resources', 'server', 'node_modules');
  const to = path.join(context.appOutDir, 'resources', 'server', 'node_modules');
  if (!fs.existsSync(path.join(from, '@prisma', 'client'))) throw new Error(`Server dependencies are not staged in ${from}. Run "node scripts/build.mjs --stage" first.`);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith('.map') });
  if (!fs.existsSync(path.join(to, '.prisma', 'client'))) throw new Error('The Prisma client was not copied into the packaged app.');
};
