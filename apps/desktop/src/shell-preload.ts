import { contextBridge, ipcRenderer } from 'electron';

/** Bridge for the local splash and recovery screens (static pages shipped with the app). */
contextBridge.exposeInMainWorld('explorixShell', {
  onStatus: (cb: (s: { message: string; detail?: string }) => void) => {
    ipcRenderer.on('shell:status', (_e, s) => cb(s));
  },
  problem: () => ipcRenderer.invoke('shell:problem'),
  action: (name: 'retry' | 'open-data' | 'open-logs' | 'restore' | 'reset' | 'skip-backup' | 'quit') => ipcRenderer.invoke('shell:action', name),
});
