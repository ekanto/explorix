// Generates the Windows icon (multi-size .ico) and window icon from the Explorix logo SVG.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const sharp = require('sharp');
const svg = fs.readFileSync(new URL('../../web/public/favicon.svg', import.meta.url));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: Math.max(72, (72 * s) / 32) }).resize(s, s).png().toBuffer()));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../build/icon.ico', import.meta.url), Buffer.concat([header, ...entries, ...pngs]));
fs.writeFileSync(new URL('../static/icon.png', import.meta.url), pngs[sizes.indexOf(256)]);
console.log('icons written');
