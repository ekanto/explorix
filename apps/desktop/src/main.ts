import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeTheme, safeStorage, screen, session, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { boot, BootError, loadServer, loadedServer, readPending, writePending, type Booted, type BootContext } from './boot';
import { classifyUrl, isTrustedSender, parseArgs, type Channel } from './contract';
import { copyOutput, ExportError, suggestedName, withExtension } from './export';
import { readMigrations } from './migrate';
import { dataPaths, resourcePaths } from './paths';
import { createPdfRenderer } from './pdf';
import { SettingsStore } from './settings';

// ---------------------------------------------------------------------------
// Process-wide setup (before "ready")
// ---------------------------------------------------------------------------

// Tests and power users can point Explorix at a different data folder.
if (process.env.EXPLORIX_HOME) app.setPath('userData', path.resolve(process.env.EXPLORIX_HOME));
app.setAppUserModelId('com.explorix.desktop');

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

const data = dataPaths(app.getPath('userData'));
const res = resourcePaths({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir: app.getAppPath() });
const pendingFile = path.join(data.root, 'pending.json');
fs.mkdirSync(data.logs, { recursive: true });

const desktopLog = path.join(data.logs, 'desktop.log');

// A closed stdout/stderr (e.g. the launching terminal went away) must never become an error:
// logging that error would write to the same broken pipe again and spin forever.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => undefined);
let consoleOk = !app.isPackaged && !!process.env.EXPLORIX_CONSOLE_LOG;
let logging = false;
let errorBurst = { at: 0, count: 0 };

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
  if (logging) return;
  logging = true;
  try {
    if (level === 'error') {
      const now = Date.now();
      errorBurst = now - errorBurst.at > 10_000 ? { at: now, count: 1 } : { at: errorBurst.at, count: errorBurst.count + 1 };
      if (errorBurst.count > 20) return;
    }
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra ? ` ${extra instanceof Error ? extra.stack : JSON.stringify(extra)}` : ''}\n`;
    try {
      fs.appendFileSync(desktopLog, line);
    } catch {
      /* ignore */
    }
    if (consoleOk) {
      try {
        process.stdout.write(line);
      } catch {
        consoleOk = false;
      }
    }
  } finally {
    logging = false;
  }
}

let settings: SettingsStore;
let booted: Booted | null = null;
let appOrigin: string | null = null;
let mainWindow: BrowserWindow | null = null;
let shellWindow: BrowserWindow | null = null;
let problem: { code: string; title: string; message: string; detail: string; actions: string[] } | null = null;
let shuttingDown = false;
let cleanedUp = false;

// ---------------------------------------------------------------------------
// Security policy for every web contents
// ---------------------------------------------------------------------------

const SECURE_PREFS = { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } as const;

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  const guard = (e: Electron.Event, url: string) => {
    const kind = classifyUrl(url, appOrigin);
    if (kind === 'app' || (url.startsWith('file:') && contents === shellWindow?.webContents)) return;
    e.preventDefault();
    if (kind === 'external') void shell.openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.setWindowOpenHandler(({ url }) => {
    const kind = classifyUrl(url, appOrigin);
    if (kind === 'app') {
      // Same-origin pop-ups (e.g. opening evidence in a new window) get a plain, preload-free, sandboxed window.
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: res.icon, webPreferences: { ...SECURE_PREFS, preload: undefined } } };
    }
    if (kind === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });
});

function hardenSession() {
  const ses = session.defaultSession;
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed.has(permission) && classifyUrl(details.requestingUrl, appOrigin) === 'app'));
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && classifyUrl(origin, appOrigin) === 'app');
  // The UI talks only to its own embedded server; nothing in the renderer can reach the network.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('chrome-extension:') || (u.startsWith('file:') && details.webContentsId === shellWindow?.webContents.id) || classifyUrl(u, appOrigin) === 'app';
    cb({ cancel: !ok });
  });
  ses.setDisplayMediaRequestHandler((request, cb) => {
    const pending = recordingSource;
    recordingSource = null;
    if (!pending || Date.now() - pending.at > 15_000 || classifyUrl(request.frame?.url ?? '', appOrigin) !== 'app') return cb({});
    void desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const src = sources.find((s) => s.id === pending.id);
      cb(src ? { video: src } : {});
    }, () => cb({}));
  });
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const bg = () => (nativeTheme.shouldUseDarkColors ? '#0b1220' : '#f8fafc');

function showShell(page: 'splash' | 'recovery') {
  if (!shellWindow || shellWindow.isDestroyed()) {
    shellWindow = new BrowserWindow({
      width: page === 'splash' ? 460 : 720,
      height: page === 'splash' ? 300 : 560,
      resizable: page === 'recovery',
      frame: page === 'recovery',
      show: false,
      title: 'Explorix',
      icon: res.icon,
      backgroundColor: bg(),
      autoHideMenuBar: true,
      webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'shell-preload.cjs') },
    });
    shellWindow.once('ready-to-show', () => shellWindow?.show());
    shellWindow.on('closed', () => {
      shellWindow = null;
      if (!mainWindow && !booted) app.quit();
    });
  } else if (page === 'recovery') {
    shellWindow.setResizable(true);
    shellWindow.setSize(720, 560);
    shellWindow.center();
  }
  void shellWindow.loadFile(path.join(res.staticDir, `${page}.html`));
}

function status(message: string, detail?: string) {
  log('info', `startup: ${message}${detail ? ` — ${detail}` : ''}`);
  shellWindow?.webContents.send('shell:status', { message, detail });
}

function createMainWindow(notices: string[]) {
  const s = settings.get().window;
  const win = new BrowserWindow({
    width: s?.width ?? 1440,
    height: s?.height ?? 900,
    x: s?.x,
    y: s?.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Explorix',
    icon: res.icon,
    backgroundColor: bg(),
    webPreferences: { ...SECURE_PREFS, preload: path.join(__dirname, 'preload.cjs'), spellcheck: true },
  });
  mainWindow = win;
  if (s?.maximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
    shellWindow?.destroy();
    if (notices.length) void dialog.showMessageBox(win, { type: 'info', title: 'Explorix', message: 'Explorix started', detail: notices.join('\n\n') });
  });
  win.on('close', () => {
    const b = win.getNormalBounds();
    settings.update({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized() } });
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  // Windows log-off / shutdown: stop the database cleanly.
  win.on('session-end', () => void shutdown());
  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', 'renderer gone', details);
    if (details.reason !== 'clean-exit') win.reload();
  });
  void win.loadURL(`${appOrigin}/`);
}

function navigate(p: string) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send('explorix:navigate', p);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function bootContext(): BootContext {
  return { data, res, settings, appVersion: app.getVersion(), status, pendingFile };
}

async function start() {
  showShell('splash');
  try {
    booted = await boot(bootContext());
    appOrigin = `http://127.0.0.1:${booted.running.port}`;
    booted.server.setPdfRenderer(createPdfRenderer(booted.server.pageTemplates));
    log('info', `Explorix ${app.getVersion()} ready at ${appOrigin} (data version ${booted.dataVersion})`);
    buildMenu();
    // Every launch starts at the sign-in screen: a session cookie from an earlier run is not reused.
    const jar = session.defaultSession.cookies;
    for (const c of await jar.get({ name: 'explorix_sid' })) await jar.remove(`http://${c.domain}${c.path ?? '/'}`, c.name).catch(() => undefined);
    createMainWindow(booted.notices);
  } catch (err) {
    const e = err instanceof BootError ? err : new BootError('start_failed', 'Explorix could not start', (err as Error).message, String((err as Error).stack ?? err));
    log('error', `startup failed: ${e.code}: ${e.message}`, e.detail || undefined);
    problem = { code: e.code, title: e.title, message: e.message, detail: e.detail, actions: actionsFor(e.code) };
    Menu.setApplicationMenu(null);
    showShell('recovery');
  }
}

function actionsFor(code: string) {
  switch (code) {
    case 'pg_missing':
    case 'server_missing':
      return ['open-logs', 'quit'];
    case 'backup_failed':
      return ['retry', 'skip-backup', 'open-logs', 'quit'];
    case 'data_too_new':
      return ['restore', 'open-data', 'quit'];
    case 'secrets':
      return ['restore', 'reset', 'open-data', 'quit'];
    default:
      return ['retry', 'restore', 'reset', 'open-logs', 'open-data', 'quit'];
  }
}

function relaunch() {
  app.relaunch();
  app.quit();
}

ipcMain.handle('shell:problem', (e) => (e.sender === shellWindow?.webContents ? { ...problem, logsDir: data.logs, dataDir: data.root, version: app.getVersion() } : null));
ipcMain.handle('shell:action', async (e, name: unknown) => {
  if (e.sender !== shellWindow?.webContents || !problem || !problem.actions.includes(String(name))) return false;
  const win = shellWindow;
  switch (name) {
    case 'retry':
      relaunch();
      return true;
    case 'quit':
      app.quit();
      return true;
    case 'open-logs':
      return !(await shell.openPath(data.logs));
    case 'open-data':
      return !(await shell.openPath(data.root));
    case 'skip-backup': {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Upgrade without backup', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Explorix', message: 'Upgrade the database without a safety backup?', detail: 'If the upgrade fails you may need to restore an older backup.' });
      if (r.response !== 0) return false;
      writePending(pendingFile, { ...readPending(pendingFile), skipUpgradeBackup: true });
      relaunch();
      return true;
    }
    case 'reset': {
      const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Start with an empty workspace', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Explorix', message: 'Start with an empty workspace?', detail: `Your current database and evidence are not deleted: they are moved aside inside ${data.root} so they can be recovered later.` });
      if (r.response !== 0) return false;
      writePending(pendingFile, { ...readPending(pendingFile), reset: true });
      relaunch();
      return true;
    }
    case 'restore': {
      const file = await chooseAndCheckBackup(win);
      if (!file) return false;
      writePending(pendingFile, { ...readPending(pendingFile), restore: file });
      relaunch();
      return true;
    }
  }
  return false;
});

/** Lets the user pick a backup, validates it against this build and asks for confirmation. */
async function chooseAndCheckBackup(win: BrowserWindow | null): Promise<string | null> {
  const pick = await dialog.showOpenDialog(win!, { title: 'Restore an Explorix backup', defaultPath: data.backups, properties: ['openFile'], filters: [{ name: 'Explorix backups', extensions: ['zip'] }] });
  const file = pick.filePaths[0];
  if (pick.canceled || !file) return null;
  try {
    const server = loadedServer() ?? (await loadServer(bootContext(), process.env.DATABASE_URL ?? 'postgresql://unused@127.0.0.1:1/unused', 'unused', data.defaultEvidence));
    const meta = await server.readBackupMeta(file);
    const known = new Set(readMigrations(res.migrations).map((m) => m.name));
    if (meta.migrations.some((m) => !known.has(m))) throw new Error('This backup was created by a newer version of Explorix. Update Explorix to restore it.');
    const rows = Object.values(meta.tables).reduce((a, b) => a + b, 0);
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Explorix',
      message: 'Replace all current data with this backup?',
      detail: `Backup created ${new Date(meta.createdAt).toLocaleString()} by Explorix ${meta.appVersion}\nWorkspace: ${meta.organizations.join(', ') || '—'}\n${rows.toLocaleString()} records, ${meta.evidence.count} evidence files\n\nEveryone will need to sign in again.`,
    });
    return r.response === 0 ? file : null;
  } catch (err) {
    await dialog.showMessageBox(win!, { type: 'error', title: 'Explorix', message: 'This file cannot be restored', detail: (err as Error).message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Renderer API (window.explorixDesktop)
// ---------------------------------------------------------------------------

class IpcError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function currentUser() {
  if (!booted || !appOrigin) throw new IpcError('unavailable', 'Explorix is not ready yet');
  const [cookie] = await session.defaultSession.cookies.get({ url: appOrigin, name: 'explorix_sid' });
  const user = await booted.server.userForSessionToken(cookie?.value);
  if (!user) throw new IpcError('unauthorized', 'Sign in to continue');
  return user;
}

async function requireRole(roles: string[]) {
  const user = await currentUser();
  if (!roles.includes(user.orgRole)) throw new IpcError('forbidden', 'Only workspace owners and administrators can change this');
  return user;
}

function handle<C extends Channel>(channel: C, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  ipcMain.handle(channel, async (e, ...raw: unknown[]) => {
    try {
      if (e.sender !== mainWindow?.webContents || !isTrustedSender(e.senderFrame?.url, appOrigin, e.senderFrame === e.sender.mainFrame)) {
        throw new IpcError('forbidden', 'This request is not allowed');
      }
      const args = parseArgs(channel, raw) as unknown[];
      return { ok: true, value: await fn(e, ...args) };
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err instanceof Error && err.message.startsWith('Invalid arguments') ? 'invalid' : 'error');
      if (!(err instanceof IpcError) && !(err instanceof ExportError)) log('warn', `ipc ${channel} failed`, err);
      return { ok: false, error: { code: typeof code === 'string' ? code : 'error', message: (err as Error).message } };
    }
  });
}

const saved = new Map<string, { path: string; type: 'file' | 'folder' }>();
let lastSaveDir: string | null = null;
let recordingSource: { id: string; at: number } | null = null;

const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  '.pdf': { name: 'PDF document', extensions: ['pdf'] },
  '.docx': { name: 'Word document', extensions: ['docx'] },
  '.md': { name: 'Markdown', extensions: ['md'] },
  '.html': { name: 'HTML page', extensions: ['html'] },
  '.zip': { name: 'ZIP archive', extensions: ['zip'] },
};

function uniqueSibling(p: string) {
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 2; ; i++) {
    const c = `${base} (${i})${ext}`;
    if (!fs.existsSync(c)) return c;
  }
}

/** Save As with explicit overwrite handling. Returns null when the user cancels. */
async function saveWithDialog(src: string, name: string, type: 'file' | 'folder', title: string) {
  const win = mainWindow!;
  const baseDir = lastSaveDir ?? app.getPath('documents');
  let dest: string;
  let confirmed = false;
  if (type === 'file') {
    const ext = path.extname(name).toLowerCase();
    const r = await dialog.showSaveDialog(win, { title, defaultPath: path.join(baseDir, suggestedName(name)), filters: [...(FILTERS[ext] ? [FILTERS[ext]] : []), { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePath) return null;
    dest = withExtension(r.filePath, name, false);
    // The Windows Save As dialog already asked before returning a name that exists.
    confirmed = dest === r.filePath;
  } else {
    const r = await dialog.showOpenDialog(win, { title: `${title}: choose a destination folder`, defaultPath: baseDir, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    if (r.canceled || !r.filePaths[0]) return null;
    dest = path.join(r.filePaths[0], suggestedName(name));
  }
  let overwrite = false;
  if (fs.existsSync(dest)) {
    if (confirmed) overwrite = true;
    else {
      const r = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Replace', 'Keep both', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
        title: 'Explorix',
        message: `${path.basename(dest)} already exists in ${path.dirname(dest)}.`,
        detail: type === 'folder' ? 'Replacing moves the existing folder to the Recycle Bin.' : 'Replacing overwrites the existing file.',
      });
      if (r.response === 2) return null;
      if (r.response === 1) dest = uniqueSibling(dest);
      else overwrite = true;
    }
  }
  await copyOutput(src, dest, { overwrite, discard: (p) => shell.trashItem(p) });
  lastSaveDir = path.dirname(dest);
  const id = crypto.randomUUID();
  saved.set(id, { path: dest, type });
  return { status: 'saved' as const, savedId: id, fileName: path.basename(dest), folder: path.dirname(dest), type };
}

function registerIpc() {
  handle('app:info', async () => ({
    appVersion: app.getVersion(),
    dataVersion: booted?.dataVersion ?? null,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    packaged: app.isPackaged,
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    dataDir: data.root,
    evidenceDir: booted?.evidenceDir ?? null,
    backupsDir: data.backups,
    logsDir: data.logs,
  }));

  handle('app:open-folder', async (_e, which: 'data' | 'evidence' | 'backups' | 'logs') => {
    await currentUser();
    const dir = { data: data.root, evidence: booted?.evidenceDir ?? data.defaultEvidence, backups: data.backups, logs: data.logs }[which];
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new IpcError('open_failed', err);
    return true;
  });

  handle('app:open-external', async (_e, url: string) => {
    if (classifyUrl(url, appOrigin) !== 'external') throw new IpcError('forbidden', 'Only web links can be opened');
    await shell.openExternal(url);
    return true;
  });

  handle('report:save', async (_e, { jobId, outputName }: { jobId: string; outputName: string }) => {
    const user = await currentUser();
    const job = booted!.server.getReportJob(jobId);
    if (!job || job.userId !== user.id) throw new IpcError('not_found', 'This report is no longer available. Generate it again.');
    const found = booted!.server.reportJobOutputPath(job, outputName);
    if (!found) throw new IpcError('not_found', 'This report output is not available.');
    return (await saveWithDialog(found.abs, found.output.name, found.output.type, 'Save report')) ?? { status: 'cancelled' };
  });

  handle('report:open-saved', async (_e, id: string) => {
    await currentUser();
    const s = saved.get(id);
    if (!s || !fs.existsSync(s.path)) throw new IpcError('not_found', 'The saved report was moved or deleted.');
    const target = s.type === 'folder' ? (fs.readdirSync(s.path).map((f) => path.join(s.path, f)).find((f) => /\.(html|md)$/i.test(f)) ?? s.path) : s.path;
    const err = await shell.openPath(target);
    if (err) throw new IpcError('open_failed', err);
    return true;
  });

  handle('report:show-saved', async (_e, id: string) => {
    await currentUser();
    const s = saved.get(id);
    if (!s || !fs.existsSync(s.path)) throw new IpcError('not_found', 'The saved report was moved or deleted.');
    shell.showItemInFolder(s.path);
    return true;
  });

  handle('capture:sources', async () => {
    await currentUser();
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    return sources
      .filter((s) => s.name && !s.thumbnail.isEmpty())
      .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumbnail: s.thumbnail.toDataURL(), isExplorix: s.id === mainWindow?.getMediaSourceId() }));
  });

  handle('capture:screenshot', async (_e, { sourceId, hideWindow }: { sourceId: string; hideWindow: boolean }) => {
    await currentUser();
    const win = mainWindow!;
    const isSelf = sourceId === win.getMediaSourceId();
    const hide = hideWindow && !isSelf;
    if (hide) {
      win.minimize();
      await new Promise((r) => setTimeout(r, 450));
    }
    try {
      const displays = screen.getAllDisplays();
      const max = displays.reduce((m, d) => ({ width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)), height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)) }), { width: 0, height: 0 });
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: max, fetchWindowIcons: false });
      const src = sources.find((s) => s.id === sourceId);
      if (!src || src.thumbnail.isEmpty()) throw new IpcError('source_gone', 'That screen or window is no longer available. Choose another one.');
      const png = src.thumbnail.toPNG();
      const size = src.thumbnail.getSize();
      const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      return { fileName: `Screenshot_${ts}.png`, data: new Uint8Array(png), width: size.width, height: size.height, sourceName: src.name };
    } finally {
      if (hide) {
        win.restore();
        win.focus();
      }
    }
  });

  handle('capture:recording-source', async (_e, sourceId: string) => {
    await currentUser();
    recordingSource = { id: sourceId, at: Date.now() };
    return true;
  });

  handle('backup:save-as', async (_e, name: string) => {
    await requireRole(['OWNER']);
    const src = booted!.server.backupPath(name);
    if (!fs.existsSync(src)) throw new IpcError('not_found', 'Backup not found');
    return (await saveWithDialog(src, name, 'file', 'Save backup')) ?? { status: 'cancelled' };
  });

  handle('backup:restore-file', async () => {
    await requireRole(['OWNER']);
    const file = await chooseAndCheckBackup(mainWindow);
    if (!file) return { status: 'cancelled' };
    const result = await booted!.server.restoreBackup(file, { safetyBackup: true });
    return { status: 'restored', ...result, signInRequired: true };
  });

  handle('settings:get', async () => {
    await currentUser();
    const s = settings.get();
    return {
      limits: s.limits,
      launchAtLogin: app.getLoginItemSettings().openAtLogin,
      keepBackups: s.keepBackups,
      evidenceDir: booted?.evidenceDir ?? null,
      defaultEvidenceDir: data.defaultEvidence,
      previousEvidenceDir: s.previousEvidenceDir,
      pendingEvidenceMove: readPending(pendingFile).evidenceMove ?? null,
      dataDir: data.root,
      backupsDir: data.backups,
      logsDir: data.logs,
    };
  });

  handle('settings:set', async (_e, patch: { limits?: { uploadMb: number; imageMb: number; videoMb: number }; launchAtLogin?: boolean; keepBackups?: number }) => {
    await requireRole(['OWNER', 'ADMIN']);
    if (patch.limits) {
      booted!.server.setUploadLimits(patch.limits);
      settings.update({ limits: patch.limits });
    }
    if (patch.keepBackups !== undefined) settings.update({ keepBackups: patch.keepBackups });
    if (patch.launchAtLogin !== undefined) {
      const exe = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath;
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, path: exe });
      settings.update({ launchAtLogin: patch.launchAtLogin });
    }
    return true;
  });

  handle('settings:choose-evidence-dir', async () => {
    await requireRole(['OWNER']);
    const current = booted!.evidenceDir;
    const r = await dialog.showOpenDialog(mainWindow!, { title: 'Choose a folder for Explorix evidence', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    const to = r.filePaths[0];
    if (r.canceled || !to) return { status: 'cancelled' };
    const rel = (a: string, b: string) => {
      const x = path.relative(a, b);
      return x === '' || (!x.startsWith('..') && !path.isAbsolute(x));
    };
    if (rel(current, to) || rel(to, current)) throw new IpcError('invalid', 'Choose a folder outside the current evidence folder.');
    if (rel(path.dirname(data.pg), to) || rel(path.dirname(process.execPath), to)) throw new IpcError('invalid', 'Choose a folder outside the Explorix program and database folders.');
    if (fs.existsSync(to) && fs.readdirSync(to).length > 0) throw new IpcError('invalid', 'Choose an empty folder.');
    const confirm = await dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Move and restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: 'Explorix',
      message: 'Move evidence to the new folder?',
      detail: `Explorix restarts, copies every evidence file to\n${to}\nand verifies it. The current folder is left in place so you can delete it afterwards.`,
    });
    if (confirm.response !== 0) return { status: 'cancelled' };
    writePending(pendingFile, { ...readPending(pendingFile), evidenceMove: { from: current, to } });
    setTimeout(relaunch, 100);
    return { status: 'restarting' };
  });
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

async function about() {
  await dialog.showMessageBox(mainWindow ?? undefined!, {
    type: 'info',
    title: 'About Explorix',
    message: `Explorix ${app.getVersion()}`,
    detail: [
      'Exploratory testing and QA management with evidence-rich reporting.',
      '',
      `Data version: ${booted?.dataVersion ?? 'unknown'}`,
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node.js ${process.versions.node}`,
      `Data folder: ${data.root}`,
      `Evidence folder: ${booted?.evidenceDir ?? data.defaultEvidence}`,
      '',
      'Your projects and evidence stay on this computer.',
      '',
      'Copyright © 2026 Omar Faruq. Licensed under the MIT License.',
      'Open-source components: Help > Third-Party Notices.',
    ].join('\n'),
  });
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New Report…', accelerator: 'CmdOrCtrl+Shift+R', click: () => navigate('/reports/new') },
        { label: 'Backups…', click: () => navigate('/admin/backups') },
        { type: 'separator' },
        { label: 'Open Data Folder', click: () => void shell.openPath(data.root) },
        { label: 'Open Evidence Folder', click: () => void shell.openPath(booted?.evidenceDir ?? data.defaultEvidence) },
        { label: 'Open Logs Folder', click: () => void shell.openPath(data.logs) },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => navigate('/settings/desktop') },
        { type: 'separator' },
        { label: 'E&xit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    { role: 'editMenu' },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged && !process.env.EXPLORIX_DEVTOOLS ? [] : ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Keyboard Shortcuts', accelerator: 'Shift+/', registerAccelerator: false, click: () => navigate('/?shortcuts=1') },
        { label: 'Where Is My Data?', click: () => void dialog.showMessageBox(mainWindow!, { type: 'info', title: 'Explorix data', message: 'Explorix keeps everything on this computer', detail: `Data folder: ${data.root}\nDatabase: ${data.pg}\nEvidence: ${booted?.evidenceDir}\nBackups: ${data.backups}\nLogs: ${data.logs}\n\nUninstalling Explorix does not delete this folder.` }) },
        { label: 'Open Logs Folder', click: () => void shell.openPath(data.logs) },
        { type: 'separator' },
        { label: 'Third-Party Notices', click: () => void shell.openPath(res.notices) },
        { label: 'About Explorix', click: () => void about() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function shutdown() {
  if (cleanedUp) return;
  try {
    await booted?.running.close();
  } catch (err) {
    log('warn', 'server close failed', err);
  }
  try {
    await booted?.pg.stop();
  } catch (err) {
    log('warn', 'database stop failed', err);
  }
  cleanedUp = true;
  log('info', 'shutdown complete');
}

app.on('before-quit', (e) => {
  if (cleanedUp) return;
  e.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  void shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

app.on('second-instance', () => {
  const w = mainWindow ?? shellWindow;
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

process.on('uncaughtException', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  log('error', 'uncaught exception', err);
});
process.on('unhandledRejection', (err) => log('error', 'unhandled rejection', err));

void app.whenReady().then(() => {
  settings = new SettingsStore(data.settingsFile, {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  });
  hardenSession();
  registerIpc();
  void start();
});
