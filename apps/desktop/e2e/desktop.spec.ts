import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import yauzl from 'yauzl';

/*
 * Drives the real Explorix Desktop app: first-run setup, sample project, video evidence,
 * report generation in every format through native Save As (mocked), overwrite protection,
 * evidence packages, backup and restore, and persistence across restarts.
 *
 *   npm run test:e2e -w @explorix/desktop                         (development build)
 *   EXPLORIX_E2E_EXE=...\win-unpacked\Explorix.exe npm run test:e2e -w @explorix/desktop   (packaged build)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repo = path.resolve(appDir, '..', '..');
const packagedExe = process.env.EXPLORIX_E2E_EXE;

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'explorix-e2e-'));
const out = path.join(home, 'saved-reports');
fs.mkdirSync(out);
const OWNER = { org: 'Desktop QA', name: 'Dana Desktop', email: 'dana@example.test', password: 'Desktop-test-2026' };
const FINDING = 'Payment fails with generic error when saved card token has expired';
const VIDEO = 'checkout-recording.webm';

let app: ElectronApplication;
let page: Page;
let origin = '';
let pid = '';
let fid = '';
let videoSha = '';

test.describe.configure({ mode: 'serial' });

let failed = false;
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) failed = true;
});

test.afterAll(async () => {
  if (app) await app.close().catch(() => undefined);
  // Keep the data folder (database, evidence, logs) of a failed run for diagnosis.
  if (failed) console.log(`Explorix e2e data kept for diagnosis: ${home}`);
  else fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

function desktopLog() {
  try {
    return fs.readFileSync(path.join(home, 'logs', 'desktop.log'), 'utf8').slice(-4000);
  } catch {
    return '(no desktop log)';
  }
}

async function launch() {
  app = await electron.launch({
    executablePath: packagedExe ?? path.join(repo, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: packagedExe ? [] : [appDir],
    cwd: packagedExe ? path.dirname(packagedExe) : appDir,
    env: { ...process.env, EXPLORIX_HOME: home },
    timeout: 90_000,
  });
  await mockNativeUi();
  const deadline = Date.now() + 180_000;
  for (;;) {
    const w = app.windows().find((x) => x.url().startsWith('http://127.0.0.1:'));
    if (w) {
      page = w;
      break;
    }
    if (Date.now() > deadline || / startup failed: /.test(desktopLog())) throw new Error(`Explorix did not open its main window.\n${desktopLog()}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.waitForLoadState('domcontentloaded');
  origin = new URL(page.url()).origin;
}

/** Replaces native dialogs and shell calls in the main process with scripted answers. */
async function mockNativeUi() {
  await app.evaluate(({ dialog, shell }, outDir) => {
    const g = globalThis as any;
    g.__explorixTest = { log: [] as string[], messageBoxAnswers: [] as number[] };
    const t = g.__explorixTest;
    const base = (p: string) => p.split(/[\\/]/).pop()!;
    dialog.showSaveDialog = (async (_w: unknown, o: { defaultPath?: string }) => {
      t.log.push(`save:${base(o.defaultPath ?? '')}`);
      return { canceled: false, filePath: `${outDir}\\${base(o.defaultPath ?? 'report')}` };
    }) as any;
    dialog.showOpenDialog = (async () => {
      t.log.push('open');
      return { canceled: false, filePaths: [outDir] };
    }) as any;
    dialog.showMessageBox = (async (_w: unknown, o: { message?: string }) => {
      t.log.push(`message:${o?.message ?? ''}`);
      return { response: t.messageBoxAnswers.length ? t.messageBoxAnswers.shift() : 0, checkboxChecked: false };
    }) as any;
    shell.openExternal = (async (u: string) => void t.log.push(`external:${u}`)) as any;
    shell.openPath = (async (p: string) => (t.log.push(`openPath:${p}`), '')) as any;
    shell.showItemInFolder = ((p: string) => void t.log.push(`showItem:${p}`)) as any;
  }, out);
}

const answerNextMessageBox = (response: number) => app.evaluate((_e, r) => (globalThis as any).__explorixTest.messageBoxAnswers.push(r), response);
const nativeLog = () => app.evaluate(() => (globalThis as any).__explorixTest.log as string[]);

async function apiGet<T = any>(url: string): Promise<T> {
  return page.evaluate(async (u) => {
    const r = await fetch(`/api${u}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${u} → ${r.status}`);
    return r.json();
  }, url);
}

/** SHA-256 of a stored evidence file, read through the app's own content endpoint. */
async function contentSha(attachmentId: string) {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`content → ${r.status}`);
    const d = await crypto.subtle.digest('SHA-256', await r.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }, `/api/projects/${pid}/attachments/${attachmentId}/content`);
}

async function signIn() {
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText('Demo accounts')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(OWNER.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

function readZip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    yauzl.open(file, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName.endsWith('/')) return zip.readEntry();
        zip.openReadStream(e, (er, s) => {
          if (er || !s) return reject(er);
          const parts: Buffer[] = [];
          s.on('data', (d: Buffer) => parts.push(d));
          s.on('end', () => {
            entries.set(e.fileName, Buffer.concat(parts));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function pdfText(file: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await task.destroy();
  return pages.join('\n');
}

const mdTargets = (md: string) => [...md.matchAll(/\]\(<?([^)>\s]+)>?\)/g)].map((m) => decodeURI(m[1]!)).filter((t) => !/^(https?:|mailto:|#)/.test(t));

// ---------------------------------------------------------------------------

test('starts as a locked-down desktop window and creates the first workspace', async () => {
  await launch();
  await expect(page).toHaveTitle(/Explorix/);

  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => {
      const p = w.webContents.getLastWebPreferences();
      return { contextIsolation: p?.contextIsolation, nodeIntegration: p?.nodeIntegration, sandbox: p?.sandbox, webSecurity: p?.webSecurity };
    }),
  );
  expect(prefs.length).toBeGreaterThan(0);
  for (const p of prefs) expect(p).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });

  const renderer = await page.evaluate(() => {
    const w = window as any;
    return { require: typeof w.require, process: typeof w.process, bridge: Object.keys(w.explorixDesktop ?? {}).sort(), popup: window.open('file:///C:/Windows/win.ini') === null };
  });
  expect(renderer.require).toBe('undefined');
  expect(renderer.process).toBe('undefined');
  expect(renderer.bridge).toContain('saveReport');
  expect(renderer.popup).toBe(true);

  // Every IPC call is validated and authorized in the main process.
  const ipc = await page.evaluate(async () => {
    const d = (window as any).explorixDesktop;
    const code = (p: Promise<{ ok: boolean; error?: { code: string } }>) => p.then((r) => (r.ok ? 'ok' : r.error!.code));
    return {
      badArgs: await code(d.saveReport('../../Windows/system32', 'x')),
      badFolder: await code(d.openFolder('C:\\Windows')),
      signedOut: await code(d.getSettings()),
      badUrl: await code(d.openExternal('file:///C:/Windows/notepad.exe')),
    };
  });
  expect(ipc).toEqual({ badArgs: 'invalid', badFolder: 'invalid', signedOut: 'unauthorized', badUrl: 'invalid' });

  // First run: create the workspace owner (no demo accounts on desktop).
  await expect(page.getByLabel('Workspace name')).toBeVisible();
  await expect(page.getByText('Demo accounts')).toHaveCount(0);
  await page.getByLabel('Workspace name').fill(OWNER.org);
  await page.getByLabel('Your name').fill(OWNER.name);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(OWNER.password);
  await page.getByLabel('Confirm password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await page.getByRole('button', { name: 'Load sample project' }).first().click();
  await expect(page).toHaveURL(/\/projects\/\w{20,}/);
  pid = /\/projects\/(\w{20,})/.exec(page.url())![1]!;
  const list = await apiGet<{ findings: { id: string; title: string }[] }>(`/projects/${pid}/findings`);
  fid = list.findings.find((f) => f.title === FINDING)!.id;
  expect(fid).toBeTruthy();
});

test('attaches a real screen recording to a finding', async () => {
  await page.goto(`${origin}/projects/${pid}/findings/${fid}`);
  await expect(page.getByRole('heading', { name: FINDING })).toBeVisible();

  // Record a genuine WebM in the renderer (canvas → MediaRecorder), as a screen recording would be.
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 240;
    const ctx = c.getContext('2d')!;
    let i = 0;
    const draw = () => {
      ctx.fillStyle = `hsl(${(i * 25) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 64px sans-serif';
      ctx.fillText(String(i++), 120, 140);
    };
    draw();
    const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const timer = setInterval(draw, 66);
    rec.start(250);
    await new Promise((r) => setTimeout(r, 2200));
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.stop();
    await stopped;
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(s);
  });
  const video = Buffer.from(b64, 'base64');
  expect(video.subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML header
  videoSha = crypto.createHash('sha256').update(video).digest('hex');

  // Unsupported content is refused even with an allowed extension.
  await page.locator('input[type=file]').first().setInputFiles({ name: 'fake-video.mp4', mimeType: 'video/mp4', buffer: Buffer.from('MZ this is not a video') });
  await expect(page.getByText(/are not supported|not a recognised format/i).first()).toBeVisible();

  await page.locator('input[type=file]').first().setInputFiles({ name: VIDEO, mimeType: 'video/webm', buffer: video });
  await expect(page.getByRole('button', { name: `Open ${VIDEO}` })).toBeVisible();

  // The UI records the duration and stores a thumbnail derivative; the original is untouched.
  await expect
    .poll(async () => {
      const f = (await apiGet(`/projects/${pid}/findings/${fid}`)).finding;
      const v = f.attachments.find((a: any) => a.fileName === VIDEO);
      return v ? { duration: (v.durationSeconds ?? 0) > 1, thumb: !!v.thumbnailId, kind: v.kind } : null;
    }, { timeout: 60_000 })
    .toEqual({ duration: true, thumb: true, kind: 'VIDEO' });
  const v = (await apiGet(`/projects/${pid}/findings/${fid}`)).finding.attachments.find((a: any) => a.fileName === VIDEO);
  expect(await contentSha(v.id)).toBe(videoSha);
});

test('generates PDF, Word, HTML and Markdown reports and saves them with overwrite protection', async () => {
  await page.goto(`${origin}/projects/${pid}/reports/new?scope=finding&id=${fid}&kind=BUG_INVESTIGATION`);
  await expect(page.getByRole('heading', { name: 'Report builder' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  for (const f of [/Word \(DOCX\)/, /Markdown/, /HTML/]) await page.getByRole('checkbox', { name: f }).check();
  await expect(page.getByRole('checkbox', { name: /PDF/ })).toBeChecked();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText(VIDEO).first()).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.frameLocator('iframe').getByText(FINDING).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue to generate' }).click();
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.getByText('Report ready')).toBeVisible({ timeout: 180_000 });

  // PDF and DOCX are single files; Markdown and HTML share one folder with an evidence/ directory.
  const saveButtons = page.getByRole('button', { name: 'Save as…' });
  await expect(saveButtons).toHaveCount(3);
  while ((await saveButtons.count()) > 0) {
    const before = await saveButtons.count();
    await saveButtons.first().click();
    await expect(saveButtons).toHaveCount(before - 1);
  }
  const files = fs.readdirSync(out);
  const pdf = files.find((f) => f.endsWith('.pdf'))!;
  const docx = files.find((f) => f.endsWith('.docx'))!;
  const mdDir = files.find((f) => fs.statSync(path.join(out, f)).isDirectory())!;
  expect([pdf, docx, mdDir].every(Boolean)).toBe(true);
  expect(pdf).toMatch(/^Explorix_.+_\d{4}-\d{2}-\d{2}\.pdf$/);
  const html = path.join(mdDir, fs.readdirSync(path.join(out, mdDir)).find((f) => f.endsWith('.html'))!);

  // Parse every output instead of trusting that a file exists.
  const pdfBody = await pdfText(path.join(out, pdf));
  expect(pdfBody).toContain('Payment fails with generic error');
  expect(pdfBody).toContain(VIDEO);
  const { value: docText } = await mammoth.extractRawText({ path: path.join(out, docx) });
  expect(docText).toContain(FINDING);
  expect(docText).toContain(VIDEO);
  const htmlBody = fs.readFileSync(path.join(out, html), 'utf8');
  expect(htmlBody).toContain(FINDING);
  expect(htmlBody).not.toContain(home);
  const htmlTargets = [...htmlBody.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => decodeURI(m[1]!.replace(/&amp;/g, '&'))).filter((t) => !/^(https?:|mailto:|data:|#)/.test(t));
  expect(htmlTargets.some((t) => t.endsWith('.webm'))).toBe(true);
  for (const t of htmlTargets) expect(fs.existsSync(path.join(out, mdDir, t)), `HTML link ${t}`).toBe(true);
  const mdFile = fs.readdirSync(path.join(out, mdDir)).find((f) => f.endsWith('.md'))!;
  const md = fs.readFileSync(path.join(out, mdDir, mdFile), 'utf8');
  expect(md).toContain(`# `);
  expect(md).toContain(FINDING);
  const targets = mdTargets(md);
  expect(targets.some((t) => t.endsWith('.png'))).toBe(true);
  for (const t of targets) expect(fs.existsSync(path.join(out, mdDir, t)), `Markdown link ${t}`).toBe(true);

  // Saving a folder again over an existing one asks first: Cancel keeps everything, Keep both adds a copy.
  const folders = () => fs.readdirSync(out).filter((f) => f.startsWith(mdDir) && fs.statSync(path.join(out, f)).isDirectory()).sort();
  const mdRow = page.locator('.mantine-Paper-root').filter({ has: page.getByText(`${mdDir}\\`, { exact: true }) }).last();
  await answerNextMessageBox(2);
  await mdRow.getByRole('button', { name: 'Save again…' }).click();
  await expect.poll(async () => (await nativeLog()).filter((l) => l.startsWith('message:')).length).toBe(1);
  expect(folders()).toEqual([mdDir]);
  await answerNextMessageBox(1);
  await mdRow.getByRole('button', { name: 'Save again…' }).click();
  await expect.poll(folders).toEqual([mdDir, `${mdDir} (2)`]);
  expect((await nativeLog()).filter((l) => l.startsWith('message:'))[0]).toContain('already exists');
});

test('exports a self-contained ZIP evidence package', async () => {
  await page.getByRole('button', { name: 'Generate another format' }).click();
  await page.getByRole('radio', { name: 'Report package (ZIP)' }).check();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Continue to generate' }).click();
  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.getByText('Report ready')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole('button', { name: 'Save as…' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save as…' }).click();
  await expect(page.getByRole('button', { name: 'Save again…' })).toBeVisible();

  const zipName = fs.readdirSync(out).find((f) => f.endsWith('.zip'))!;
  const entries = await readZip(path.join(out, zipName));
  const names = [...entries.keys()];
  const find = (re: RegExp) => names.find((n) => re.test(n));
  expect(find(/README/i)).toBeTruthy();
  expect(find(/manifest\.json$/i)).toBeTruthy();
  for (const ext of ['pdf', 'docx', 'md', 'html']) expect(find(new RegExp(`\\.${ext}$`)), ext).toBeTruthy();

  // The original recording is bundled byte-for-byte.
  const videoEntry = names.find((n) => n.includes('evidence/') && n.endsWith('.webm'))!;
  expect(crypto.createHash('sha256').update(entries.get(videoEntry)!).digest('hex')).toBe(videoSha);

  // Relative Markdown links resolve inside the package, and nothing points back at this computer.
  const mdName = find(/\.md$/)!;
  const mdBase = path.posix.dirname(mdName);
  const md = entries.get(mdName)!.toString('utf8');
  for (const t of mdTargets(md)) expect(entries.has(path.posix.normalize(path.posix.join(mdBase, t))), `package link ${t}`).toBe(true);
  for (const [n, b] of entries) {
    if (!/\.(md|html|json|txt)$/i.test(n) && !/README/i.test(n)) continue;
    const text = b.toString('utf8');
    expect(text, n).not.toContain(home);
    expect(text, n).not.toMatch(/AppData\\Roaming|explorix_sid|password/i);
  }
  expect(names.some((n) => /\.(sql|dump|db)$/i.test(n) || n.includes('pg/'))).toBe(false);
});

test('backup and restore bring back the database and evidence', async () => {
  await page.goto(`${origin}/admin?tab=backups`);
  await page.getByRole('button', { name: 'Create backup' }).click();
  await expect(page.getByRole('button', { name: 'Restore…' }).first()).toBeEnabled({ timeout: 120_000 });

  // A change made after the backup...
  await page.goto(`${origin}/projects/${pid}/findings/${fid}`);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'after-backup.txt', mimeType: 'text/plain', buffer: Buffer.from('added after the backup\n') });
  await expect(page.getByRole('button', { name: 'Open after-backup.txt' })).toBeVisible();

  // ...is gone after restoring it, while the earlier evidence is intact.
  await page.goto(`${origin}/admin?tab=backups`);
  const manual = page.getByRole('row').filter({ hasText: /manual/i }).first();
  await manual.getByRole('button', { name: 'Restore…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await dlg.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 180_000 });
  await signIn();

  const f = (await apiGet(`/projects/${pid}/findings/${fid}`)).finding;
  const names = f.attachments.map((a: any) => a.fileName);
  expect(names).toContain(VIDEO);
  expect(names).not.toContain('after-backup.txt');
  expect(await contentSha(f.attachments.find((a: any) => a.fileName === VIDEO).id)).toBe(videoSha);
});

test('keeps projects and evidence across an app restart, outside the install folder', async () => {
  await page.goto(`${origin}/settings/desktop`);
  await expect(page.getByText(home).first()).toBeVisible();
  await app.close();
  expect(fs.existsSync(path.join(home, 'data', 'pg'))).toBe(true);

  await launch();
  await expect(page.getByLabel('Workspace name')).toHaveCount(0);
  await signIn();
  const projects = (await apiGet<{ projects: { id: string }[] }>('/projects')).projects;
  expect(projects.map((p) => p.id)).toContain(pid);
  const f = (await apiGet(`/projects/${pid}/findings/${fid}`)).finding;
  expect(await contentSha(f.attachments.find((a: any) => a.fileName === VIDEO).id)).toBe(videoSha);

  // Menu commands reach the renderer only through the navigation bridge.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith('http://127.0.0.1:'))!;
    w.webContents.send('explorix:navigate', '/?shortcuts=1');
  });
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});
