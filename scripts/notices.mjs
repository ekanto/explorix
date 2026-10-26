// Generates THIRD_PARTY_NOTICES.md: the licences of every third-party component Explorix redistributes
// (server and web production dependencies, the desktop main process, PostgreSQL and libvips native binaries).
//   node scripts/notices.mjs          → (re)write THIRD_PARTY_NOTICES.md
//   node scripts/notices.mjs --check  → exit 1 when the committed file no longer matches the installed dependencies
// Run on Windows x64: platform-specific packages (sharp, Prisma engine, PostgreSQL) are read from node_modules.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootModules = path.join(repo, 'node_modules');
const target = path.join(repo, 'THIRD_PARTY_NOTICES.md');
const check = process.argv.includes('--check');

const readPkg = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

// ---------------------------------------------------------------------------
// npm dependency closure
// ---------------------------------------------------------------------------

const desktopDir = path.join(repo, 'apps', 'desktop');
const desktopImports = new Set();
for (const file of fs.readdirSync(path.join(desktopDir, 'src'))) {
  if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
  const src = fs.readFileSync(path.join(desktopDir, 'src', file), 'utf8');
  for (const m of src.matchAll(/^import\s(?!type\b)[^'"]*['"]([^'"./][^'"]*)['"]/gm)) {
    const spec = m[1];
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (spec.startsWith('node:') || builtinModules.includes(name) || name === 'electron') continue;
    desktopImports.add(name);
  }
}

const roots = [
  ...['apps/server', 'apps/web'].flatMap((ws) => Object.keys(readPkg(path.join(repo, ws)).dependencies ?? {}).map((name) => [name, path.join(repo, ws)])),
  ...[...desktopImports].map((name) => [name, desktopDir]),
];

const locate = (name, fromDir) => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === repo || dir === path.dirname(dir)) break;
  }
  return null;
};

const packages = new Map();
const visited = new Set();
const visit = (name, fromDir, optional) => {
  if (name.startsWith('@explorix/')) return;
  const dir = locate(name, fromDir);
  if (!dir) {
    if (!optional) throw new Error(`Dependency ${name} (needed from ${path.relative(repo, fromDir) || '.'}) is not installed. Run npm install first.`);
    return;
  }
  if (visited.has(dir)) return;
  visited.add(dir);
  const pkg = readPkg(dir);
  const key = `${pkg.name}@${pkg.version}`;
  if (!packages.has(key)) packages.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), url: repoUrl(pkg), text: licenseText(dir) });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, false);
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, true);
  for (const dep of Object.keys(pkg.peerDependencies ?? {})) visit(dep, dir, true);
};

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return 'UNKNOWN';
}

function repoUrl(pkg) {
  let url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!url) return pkg.homepage ?? '';
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
  return url
    .replace(/^github:/, 'https://github.com/')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '');
}

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice|copyright)(?:[-._][\w.-]*)?$/i;
const NOT_TEXT = /\.(?:[cm]?[jt]s|json|html?|map)$/i;
function licenseText(dir) {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name) && !NOT_TEXT.test(e.name))
    .map((e) => e.name)
    .sort();
  const texts = files.map((f) => {
    const body = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
    return files.length > 1 ? `----- ${f} -----\n\n${body}` : body;
  });
  return texts.join('\n\n') || null;
}

for (const [name, from] of roots) visit(name, from, false);

// ---------------------------------------------------------------------------
// Native components that ship without per-file licences
// ---------------------------------------------------------------------------

const pgPkgDir = path.join(rootModules, '@embedded-postgres', 'windows-x64');
const pgVersion = fs.existsSync(pgPkgDir) ? readPkg(pgPkgDir).version.split('.').slice(0, 2).join('.') : '18';
const PG_NATIVE = [
  { files: /^(?:libpq|libecpg(?:_compat)?|libpgtypes|testplug)\.dll$/i, label: '`libpq.dll`, `libecpg*.dll`, `libpgtypes.dll`, `testplug.dll`', component: `PostgreSQL ${pgVersion}`, license: 'PostgreSQL License (below)', url: 'https://www.postgresql.org/about/licence/' },
  { files: /^icu\w+\.dll$/i, label: '`icu*.dll`', component: 'ICU (International Components for Unicode)', license: 'Unicode License v3', url: 'https://github.com/unicode-org/icu/blob/main/LICENSE' },
  { files: /^lib(?:crypto|ssl)-3-x64\.dll$/i, label: '`libcrypto-3-x64.dll`, `libssl-3-x64.dll`', component: 'OpenSSL 3', license: 'Apache-2.0', url: 'https://www.openssl.org/source/license.html' },
  { files: /^libcurl\.dll$/i, label: '`libcurl.dll`', component: 'curl', license: 'curl License (MIT-style)', url: 'https://curl.se/docs/copyright.html' },
  { files: /^libiconv-2\.dll$/i, label: '`libiconv-2.dll`', component: 'GNU libiconv', license: 'LGPL-2.1-or-later', url: 'https://www.gnu.org/software/libiconv/' },
  { files: /^libintl-9\.dll$/i, label: '`libintl-9.dll`', component: 'GNU gettext runtime (libintl)', license: 'LGPL-2.1-or-later', url: 'https://www.gnu.org/software/gettext/' },
  { files: /^liblz4\.dll$/i, label: '`liblz4.dll`', component: 'LZ4', license: 'BSD-2-Clause', url: 'https://github.com/lz4/lz4/blob/dev/lib/LICENSE' },
  { files: /^libwinpthread-1\.dll$/i, label: '`libwinpthread-1.dll`', component: 'mingw-w64 winpthreads', license: 'MIT-style (see upstream COPYING)', url: 'https://github.com/mingw-w64/mingw-w64/blob/master/mingw-w64-libraries/winpthreads/COPYING' },
  { files: /^libxml2\.dll$/i, label: '`libxml2.dll`', component: 'libxml2', license: 'MIT', url: 'https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright' },
  { files: /^libxslt\.dll$/i, label: '`libxslt.dll`', component: 'libxslt', license: 'MIT', url: 'https://gitlab.gnome.org/GNOME/libxslt/-/blob/master/Copyright' },
  { files: /^libzstd\.dll$/i, label: '`libzstd.dll`', component: 'Zstandard', license: 'BSD-3-Clause', url: 'https://github.com/facebook/zstd/blob/dev/LICENSE' },
  { files: /^zlib1\.dll$/i, label: '`zlib1.dll`', component: 'zlib', license: 'Zlib', url: 'https://zlib.net/zlib_license.html' },
  { files: /^wx\w+\.dll$/i, label: '`wx*.dll`', component: 'wxWidgets (part of the upstream Windows binaries for pgAdmin; not used by Explorix)', license: 'wxWindows Library Licence 3.1', url: 'https://www.wxwidgets.org/about/licence/' },
];
// Every DLL in the PostgreSQL bin folder must be accounted for, so a PostgreSQL upgrade cannot silently add an unlisted library.
const pgBin = path.join(pgPkgDir, 'native', 'bin');
if (fs.existsSync(pgBin)) {
  const unlisted = fs.readdirSync(pgBin).filter((f) => f.toLowerCase().endsWith('.dll') && !PG_NATIVE.some((row) => row.files.test(f)));
  if (unlisted.length) throw new Error(`Unlisted PostgreSQL DLLs: ${unlisted.join(', ')}. Add them to PG_NATIVE in scripts/notices.mjs.`);
}

const sharpVersions = (() => {
  const dir = locate('@img/sharp-win32-x64', path.join(repo, 'apps', 'server'));
  return dir && fs.existsSync(path.join(dir, 'versions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'versions.json'), 'utf8')) : {};
})();
const LIBVIPS = [
  ['aom', 'BSD-2-Clause + Alliance for Open Media Patent License 1.0'],
  ['cairo', 'MPL-1.1'],
  ['cgif', 'MIT'],
  ['expat', 'MIT'],
  ['fontconfig', 'fontconfig License (BSD-like)'],
  ['freetype', 'FreeType License (BSD-like)'],
  ['fribidi', 'LGPL-3.0'],
  ['glib', 'LGPL-3.0'],
  ['harfbuzz', 'MIT'],
  ['highway', 'BSD-3-Clause'],
  ['lcms', 'MIT'],
  ['libarchive', 'BSD-2-Clause'],
  ['libexif', 'LGPL-3.0'],
  ['libffi', 'MIT'],
  ['libheif', 'LGPL-3.0'],
  ['libimagequant', 'BSD-2-Clause'],
  ['libnsgif', 'MIT'],
  ['libpng', 'libpng License'],
  ['librsvg', 'LGPL-3.0'],
  ['libtiff', 'libtiff License (BSD-like)'],
  ['libultrahdr', 'MIT'],
  ['libvips', 'LGPL-3.0'],
  ['libwebp', 'BSD-3-Clause'],
  ['libxml2', 'MIT'],
  ['mozjpeg', 'Zlib, IJG License, BSD-3-Clause'],
  ['pango', 'LGPL-3.0'],
  ['pixman', 'MIT'],
  ['proxy-libintl', 'LGPL-3.0'],
  ['zlib-ng', 'Zlib'],
];
const vipsVersionKey = { libarchive: 'archive', libexif: 'exif', libffi: 'ffi', libheif: 'heif', libimagequant: 'imagequant', libpng: 'png', librsvg: 'rsvg', libtiff: 'tiff', libultrahdr: 'uhdr', libvips: 'vips', libwebp: 'webp', libxml2: 'xml2' };

const POSTGRESQL_LICENSE = `PostgreSQL Database Management System
(also known as Postgres, formerly known as Postgres95)

Portions Copyright (c) 1996-2026, The PostgreSQL Global Development Group

Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its
documentation for any purpose, without fee, and without a written agreement
is hereby granted, provided that the above copyright notice and this
paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS
DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS
ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.`;

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const sorted = [...packages.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version, 'en') : a.name.localeCompare(b.name, 'en')));
const fence = (text) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
const block = (text) => {
  const f = fence(text);
  return `${f}text\n${text}\n${f}`;
};
const groups = new Map();
for (const p of sorted) {
  if (!p.text) continue;
  if (!groups.has(p.text)) groups.set(p.text, []);
  groups.get(p.text).push(p);
}
const noFile = sorted.filter((p) => !p.text);
const unknown = sorted.filter((p) => p.license === 'UNKNOWN');
const counts = new Map();
for (const p of sorted) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);

const out = [];
out.push(`# Third-party notices

Explorix is licensed under the [MIT License](LICENSE). Copyright (c) 2026 Omar Faruq.

Explorix redistributes the open-source components listed below in the web application, the server, the Docker image and the Windows desktop app. Each component remains under its own licence; Explorix's MIT License does not apply to them. Full licence texts are reproduced at the end of this file.

This file is generated by \`npm run notices\` (\`scripts/notices.mjs\`) from the installed dependency tree on Windows x64, the desktop target. Do not edit it by hand. Other platforms install platform-specific builds of the same native packages (sharp, Prisma engine, PostgreSQL) under the same licences.

## Licence choices and special terms

- **JSZip** is dual-licensed \`MIT OR GPL-3.0-or-later\`. Explorix uses and redistributes it under the MIT License.
- **sharp / libvips** (image processing). The prebuilt \`@img/sharp-*\` binaries contain libvips and the libraries listed under [libvips](#libvips-bundled-with-sharp), some of which are licensed under LGPL-3.0-or-later. They ship as separate dynamic libraries (on Windows: \`resources\\server\\node_modules\\@img\\sharp-win32-x64\\lib\\libvips-*.dll\`), which you may replace with your own compatible builds.
- **PostgreSQL** (desktop app only). The embedded database ships the PostgreSQL binaries and the native libraries listed under [PostgreSQL](#postgresql-desktop-app), including LGPL-2.1-or-later libraries (GNU libiconv, GNU gettext) that are likewise separate, replaceable DLLs.
- **Inter** typeface (\`@fontsource-variable/inter\`) is licensed under the SIL Open Font License 1.1. The font files are embedded in the web UI.
- **Electron and Chromium** (desktop app only). The installer places their licences next to \`Explorix.exe\` as \`LICENSE.electron.txt\` and \`LICENSES.chromium.html\`.
- **Prisma**. The Prisma query engine binary shipped with \`@prisma/client\` is licensed under Apache-2.0.

**Source code for LGPL components.** The upstream source of each LGPL-licensed library is available from the project links below. To obtain the exact source code corresponding to the binaries in a specific Explorix release, open an issue at https://github.com/ekanto/explorix/issues.

## Summary

${sorted.length} npm packages. Licences (as declared by each package):

| Licence | Packages |
|---|---:|
${[...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([l, n]) => `| ${l} | ${n} |`).join('\n')}

## PostgreSQL (desktop app)

Windows binaries of PostgreSQL ${pgVersion}, distributed through the [\`@embedded-postgres/windows-x64\`](https://github.com/leinelissen/embedded-postgres) package (MIT; its licence is installed as \`resources\\pg\\LICENSE-embedded-postgres.md\`). \`postgres.exe\`, \`initdb.exe\`, \`pg_ctl.exe\`, \`share\\\` and the extension modules in \`lib\\\` are PostgreSQL, except as noted.

| Files | Component | Licence | Upstream licence |
|---|---|---|---|
| \`postgres.exe\`, \`initdb.exe\`, \`pg_ctl.exe\`, \`lib\\*.dll\`, \`share\\\` | PostgreSQL ${pgVersion} and contrib modules | PostgreSQL License (below) | https://www.postgresql.org/about/licence/ |
| \`lib\\plugin_debugger.dll\` | EDB pldebugger | Artistic-2.0 | https://github.com/EnterpriseDB/pldebugger |
| \`lib\\system_stats.dll\` | EDB system_stats | PostgreSQL License (EnterpriseDB Corporation) | https://github.com/EnterpriseDB/system_stats/blob/master/LICENSE |
${PG_NATIVE.map((r) => `| ${r.label.startsWith('`') ? r.label.replace(/`([^`]+)`/g, '`bin\\$1`') : r.label} | ${r.component} | ${r.license} | ${r.url} |`).join('\n')}

${block(POSTGRESQL_LICENSE)}

## libvips (bundled with sharp)

\`@img/sharp-win32-x64\` contains libvips ${sharpVersions.vips ?? ''} and the following libraries, as documented by [sharp-libvips](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md). Libraries under the LGPL are used under LGPL-3.0 via the "any later version" clause of LGPL-2.0/2.1.

| Library | Version | Licence |
|---|---|---|
${LIBVIPS.map(([lib, lic]) => `| ${lib} | ${sharpVersions[vipsVersionKey[lib] ?? lib] ?? ''} | ${lic} |`).join('\n')}

Upstream source: https://github.com/libvips/libvips${sharpVersions.vips ? `/tree/v${sharpVersions.vips}` : ''} and https://github.com/lovell/sharp-libvips.

## npm packages

| Package | Version | Licence | Source |
|---|---|---|---|
${sorted.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.url} |`).join('\n')}
`);

if (noFile.length) {
  out.push(`## Packages without a bundled licence file

These packages declare a licence in \`package.json\` but do not include its text. The standard text of the declared licence applies; see each package's source repository.

${noFile.map((p) => `- ${p.name}@${p.version} (${p.license})`).join('\n')}
`);
}

out.push('## Licence texts\n');
for (const [text, pkgs] of groups) {
  out.push(`### ${pkgs.map((p) => `${p.name}@${p.version}`).join(', ')}\n\n${block(text)}\n`);
}

const generated = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';

if (unknown.length) console.warn(`Packages without a declared licence: ${unknown.map((p) => `${p.name}@${p.version}`).join(', ')}`);

if (check) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== generated) {
    console.error('THIRD_PARTY_NOTICES.md is out of date with the installed dependencies. Run `npm run notices` and commit the result.');
    process.exit(1);
  }
  console.log(`THIRD_PARTY_NOTICES.md is up to date (${sorted.length} packages).`);
} else {
  fs.writeFileSync(target, generated);
  console.log(`Wrote THIRD_PARTY_NOTICES.md: ${sorted.length} packages, ${groups.size} distinct licence texts, ${noFile.length} without a licence file (${(generated.length / 1024).toFixed(0)} KB).`);
}
