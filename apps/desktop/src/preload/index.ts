import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, DashboardState, DiagnosticReport } from '@ptcgl/core';
type UpdateState = { status: 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'DOWNLOADING' | 'READY' | 'CURRENT' | 'ERROR'; currentVersion: string; availableVersion?: string; percent?: number; message?: string };
contextBridge.exposeInMainWorld('ptcgl', {
  getState: (): Promise<DashboardState> => ipcRenderer.invoke('state:get'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:set', settings),
  detectPtcgl: (): Promise<string> => ipcRenderer.invoke('app:detect'),
  refresh: () => ipcRenderer.invoke('vm:refresh'), stopVm: () => ipcRenderer.invoke('vm:stop'),
  connect: () => ipcRenderer.invoke('vpn:connect'), disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
  startSession: () => ipcRenderer.invoke('session:start'),
  startNormally: (): Promise<void> => ipcRenderer.invoke('session:normal'),
  pickPath: (kind: 'game' | 'config'): Promise<string | null> => ipcRenderer.invoke('paths:pick',kind),
  diagnose: (): Promise<DiagnosticReport> => ipcRenderer.invoke('diagnostics:run'),
  copyDiagnostics: (): Promise<void> => ipcRenderer.invoke('diagnostics:copy'),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke('update:get'),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  planInfrastructure: (deploymentId: string): Promise<void> => ipcRenderer.invoke('infra:plan', deploymentId),
  applyInfrastructure: (deploymentId: string): Promise<void> => ipcRenderer.invoke('infra:apply', deploymentId),
  destroyInfrastructure: (deploymentId: string): Promise<void> => ipcRenderer.invoke('infra:destroy', { deploymentId, confirmed: true }),
  onState: (listener: (state: DashboardState) => void) => { const handler = (_: unknown, s: DashboardState) => listener(s); ipcRenderer.on('state:changed', handler); return () => ipcRenderer.removeListener('state:changed', handler); },
  onUpdate: (listener: (state: UpdateState) => void) => { const handler = (_: unknown, s: UpdateState) => listener(s); ipcRenderer.on('update:changed', handler); return () => ipcRenderer.removeListener('update:changed', handler); }
});
