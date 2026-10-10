// electron/preload/index.ts
//
// The ONLY bridge between the sandboxed renderer (React UI) and the main
// process. No Node globals (fs, child_process, process, require) are ever
// exposed — only these specific, purpose-built functions.

import { contextBridge, ipcRenderer } from 'electron';

const api = {
  isElectron: true,

  invokeTool: (tool: string, args: Record<string, any> = {}) =>
    ipcRenderer.invoke('anushka:invoke-tool', { tool, args }),

  onConfirmRequest: (cb: (payload: { id: string; tool: string; args: any; risk: string }) => void) => {
    const listener = (_evt: unknown, payload: any) => cb(payload);
    ipcRenderer.on('anushka:confirm-request', listener);
    return () => ipcRenderer.removeListener('anushka:confirm-request', listener);
  },
  sendConfirmResponse: (id: string, approved: boolean) =>
    ipcRenderer.send('anushka:confirm-response', { id, approved }),

  emergencyStop: () => ipcRenderer.send('anushka:emergency-stop'),
  resume: () => ipcRenderer.send('anushka:resume'),

  getStartupEnabled: () => ipcRenderer.invoke('anushka:get-startup'),
  setStartupEnabled: (enabled: boolean) => ipcRenderer.send('anushka:set-startup', enabled),

  getSettings: () => ipcRenderer.invoke('anushka:get-settings'),
  updateSettings: (patch: Record<string, any>) => ipcRenderer.invoke('anushka:update-settings', patch),

  // Pass 6 — passive notice only. This never injects anything into the
  // live voice conversation by itself; it just lets the UI show a
  // dismissible banner when the background loop flags something notable.
  onScreenNotableChange: (cb: (payload: { summary: string; reason?: string; at: number }) => void) => {
    const listener = (_evt: unknown, payload: any) => cb(payload);
    ipcRenderer.on('anushka:screen-notable-change', listener);
    return () => ipcRenderer.removeListener('anushka:screen-notable-change', listener);
  },

  // Pass 11 — same passive-notice shape as onScreenNotableChange above:
  // never injected into the live voice conversation on its own, just
  // available for the UI to show a dismissible banner when a scheduled
  // task fires (or is skipped because it needed an unattended confirmation
  // it couldn't get — see electron/main/scheduler.ts).
  onScheduledTaskNotice: (cb: (payload: { id: string; label: string; outcome: 'ran' | 'failed' | 'skipped'; reason?: string; at: number }) => void) => {
    const listener = (_evt: unknown, payload: any) => cb(payload);
    ipcRenderer.on('anushka:scheduled-task-notice', listener);
    return () => ipcRenderer.removeListener('anushka:scheduled-task-notice', listener);
  },
};

contextBridge.exposeInMainWorld('anushka', api);

export type AnushkaBridge = typeof api;
