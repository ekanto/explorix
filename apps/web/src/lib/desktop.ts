/**
 * Typed access to the Explorix Desktop bridge (exposed by the Electron preload script).
 * In a normal browser `desktop` is null and the UI falls back to web behaviour
 * (downloads instead of Save As, no screen capture, etc.).
 */
export type SaveResult = { status: 'cancelled' } | { status: 'saved'; savedId: string; fileName: string; folder: string; type: 'file' | 'folder' };

export interface CaptureSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
  isExplorix: boolean;
}

export interface DesktopInfo {
  appVersion: string;
  dataVersion: string | null;
  electron: string;
  chrome: string;
  node: string;
  packaged: boolean;
  portable: boolean;
  dataDir: string;
  evidenceDir: string | null;
  backupsDir: string;
  logsDir: string;
}

export interface DesktopSettings {
  limits: { uploadMb: number; imageMb: number; videoMb: number };
  launchAtLogin: boolean;
  keepBackups: number;
  evidenceDir: string | null;
  defaultEvidenceDir: string;
  previousEvidenceDir: string | null;
  pendingEvidenceMove: { from: string; to: string } | null;
  dataDir: string;
  backupsDir: string;
  logsDir: string;
}

export interface ExplorixDesktop {
  isDesktop: true;
  info(): Promise<DesktopInfo>;
  openFolder(which: 'data' | 'evidence' | 'backups' | 'logs'): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  saveReport(jobId: string, outputName: string): Promise<SaveResult>;
  openSaved(savedId: string): Promise<boolean>;
  showSavedInFolder(savedId: string): Promise<boolean>;
  captureSources(): Promise<CaptureSource[]>;
  captureScreenshot(sourceId: string, hideWindow?: boolean): Promise<{ fileName: string; data: Uint8Array; width: number; height: number; sourceName: string }>;
  selectRecordingSource(sourceId: string): Promise<boolean>;
  saveBackupAs(name: string): Promise<SaveResult>;
  restoreBackupFromFile(): Promise<{ status: 'cancelled' } | { status: 'restored'; signInRequired: true; evidenceRestored: number; rows: number }>;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<Pick<DesktopSettings, 'limits' | 'launchAtLogin' | 'keepBackups'>>): Promise<boolean>;
  chooseEvidenceFolder(): Promise<{ status: 'cancelled' | 'restarting' }>;
  onNavigate(cb: (path: string) => void): () => void;
}

declare global {
  interface Window {
    explorixDesktop?: RawBridge;
  }
}

/** A failed desktop operation. `code` is e.g. `invalid`, `unauthorized`, `forbidden`, `not_found` or `error`. */
export class DesktopError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
type RawBridge = {
  [K in keyof ExplorixDesktop]: ExplorixDesktop[K] extends (...a: infer A) => Promise<infer R> ? (...a: A) => Promise<Envelope<R>> : ExplorixDesktop[K];
};

function unwrap(raw: RawBridge): ExplorixDesktop {
  const api: Record<string, unknown> = { isDesktop: true, onNavigate: raw.onNavigate };
  for (const [name, fn] of Object.entries(raw)) {
    if (typeof fn !== 'function' || name === 'onNavigate') continue;
    api[name] = async (...args: unknown[]) => {
      const res = (await (fn as (...a: unknown[]) => Promise<Envelope<unknown>>)(...args)) as Envelope<unknown> | undefined;
      if (res && res.ok) return res.value;
      throw new DesktopError(res?.error.code ?? 'error', res?.error.message ?? 'The desktop app did not respond');
    };
  }
  return api as unknown as ExplorixDesktop;
}

export const desktop: ExplorixDesktop | null = typeof window !== 'undefined' && window.explorixDesktop?.isDesktop ? unwrap(window.explorixDesktop) : null;
export const isDesktop = !!desktop;
