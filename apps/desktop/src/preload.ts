import { contextBridge, ipcRenderer } from 'electron';

/**
 * The only bridge between the Explorix web UI and the desktop shell. It forwards to a fixed
 * set of channels; the main process validates every argument and authorizes the caller.
 * No Node.js, filesystem or Electron objects are exposed to the page.
 *
 * Every call resolves to a plain `{ ok, value | error }` envelope: custom Error properties
 * (such as `code`) do not survive the context bridge, so the web UI unwraps envelopes itself.
 */
const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('explorixDesktop', {
  isDesktop: true,
  info: () => call('app:info'),
  openFolder: (which: 'data' | 'evidence' | 'backups' | 'logs') => call('app:open-folder', which),
  openExternal: (url: string) => call('app:open-external', url),
  saveReport: (jobId: string, outputName: string) => call('report:save', { jobId, outputName }),
  openSaved: (savedId: string) => call('report:open-saved', savedId),
  showSavedInFolder: (savedId: string) => call('report:show-saved', savedId),
  captureSources: () => call('capture:sources'),
  captureScreenshot: (sourceId: string, hideWindow = true) => call('capture:screenshot', { sourceId, hideWindow }),
  selectRecordingSource: (sourceId: string) => call('capture:recording-source', sourceId),
  saveBackupAs: (name: string) => call('backup:save-as', name),
  restoreBackupFromFile: () => call('backup:restore-file'),
  getSettings: () => call('settings:get'),
  setSettings: (patch: unknown) => call('settings:set', patch),
  chooseEvidenceFolder: () => call('settings:choose-evidence-dir'),
  onNavigate: (cb: (path: string) => void) => {
    const listener = (_e: unknown, p: unknown) => {
      if (typeof p === 'string' && p.startsWith('/')) cb(p);
    };
    ipcRenderer.on('explorix:navigate', listener);
    return () => ipcRenderer.removeListener('explorix:navigate', listener);
  },
});
