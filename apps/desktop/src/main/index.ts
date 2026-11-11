import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import Store from 'electron-store';
import electronUpdater from 'electron-updater';
import { z } from 'zod';
import { DEFAULT_SETTINGS, REGIONS, type AppSettings, type DashboardState } from '@ptcgl/core';
import { GcpVmClient, TerraformRunner, type DeploymentInput } from '@ptcgl/gcp';
import { readClientPublicKey, updateClientAddressFile, updateEndpointFile, WireGuardController, WireSockController } from '@ptcgl/vpn';

// This utility does not need GPU rendering. Disabling it avoids black windows
// seen with some Windows GPU/driver combinations.
app.disableHardwareAcceleration();

const schema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$|^$/),
  zone: z.string().regex(/^[a-z]+-[a-z]+\d-[a-z]$/), instanceName: z.string().regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/),
  region: z.string().regex(/^[a-z]+-[a-z]+\d$/), ptcglExecutable: z.string(), wireGuardConfigPath: z.string(),
  vpnClient: z.enum(['wireguard', 'wiresock']), vpnMode: z.enum(['full-tunnel', 'destination-split', 'windows-app-split']),
  maxRuntimeMinutes: z.number().int().min(15).max(1440), autoStop: z.boolean(), logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  terraformExecutable: z.string().min(1), infrastructurePath: z.string(), clientPublicKey: z.string(), clientAddress: z.string()
});
const store = new Store<{ settings: AppSettings }>({ defaults: { settings: DEFAULT_SETTINGS }, encryptionKey: 'ptcgl-vpn-settings-v1' });
const gcp = new GcpVmClient();
const wireguard = new WireGuardController();
const wiresock = new WireSockController();
const { autoUpdater } = electronUpdater;
const getSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, ...store.get('settings') });
let state: DashboardState = { vmStatus: 'UNKNOWN', vpnStatus: 'DISCONNECTED', region: getSettings().region, estimatedMonthlyCost: 0, busy: false, infraStatus: 'IDLE' };
let operation: Promise<void> | undefined;
let plannedDeploymentId: string | undefined;
type UpdateState = { status: 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'DOWNLOADING' | 'READY' | 'CURRENT' | 'ERROR'; currentVersion: string; availableVersion?: string; percent?: number; message?: string };
let updateState: UpdateState = { status: 'IDLE', currentVersion: app.getVersion() };

function writeDiagnostic(message: string) {
  try {
    const directory = join(app.getPath('userData'), 'logs');
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, 'main.log'), `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch { /* Diagnostics must never prevent startup. */ }
}

function target() { const s = getSettings(); return { projectId: s.projectId, zone: s.zone, instanceName: s.instanceName }; }
function publish(patch: Partial<DashboardState>) { state = { ...state, ...patch }; BrowserWindow.getAllWindows().forEach(w => w.webContents.send('state:changed', state)); }
function publishUpdate(patch: Partial<UpdateState>) { updateState = { ...updateState, ...patch }; BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update:changed', updateState)); }
async function refresh() { const vm = await gcp.get(target()); publish({ vmStatus: vm.status, externalIp: vm.externalIp, region: getSettings().region }); return vm; }
async function exclusive(task: () => Promise<void>) { if (operation) throw new Error('別の操作が進行中です'); publish({ busy: true, message: undefined }); operation = task().finally(() => { operation = undefined; publish({ busy: false }); }); return operation; }

async function connect() {
  const s = getSettings();
  if (!s.wireGuardConfigPath) throw new Error('WireGuard設定ファイルを設定してください');
  publish({ vpnStatus: 'CONNECTING', message: 'VPNへ接続しています' });
  try {
    const vm = await refresh();
    if (!vm.externalIp) throw new Error('VMの外部IPv4を取得できません');
    await updateEndpointFile(s.wireGuardConfigPath, vm.externalIp);
    if (s.vpnClient === 'wiresock') {
      if (process.platform !== 'win32') throw new Error('WireSockはWindowsでのみ利用できます');
      if (!s.ptcglExecutable) throw new Error('WireSockにはPTCGL実行ファイルの設定が必要です');
      await wiresock.connect(s.wireGuardConfigPath, s.ptcglExecutable);
    } else await wireguard.connect(s.wireGuardConfigPath);
    publish({ vpnStatus: 'CONNECTED', message: 'VPNに接続しました' });
  } catch (error) {
    publish({ vpnStatus: 'ERROR', message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function startSession() {
  const s = getSettings();
  if (!s.projectId || !s.ptcglExecutable) throw new Error('Project IDとPTCGL実行ファイルを設定してください');
  let vm = await refresh();
  if (vm.status !== 'RUNNING') { publish({ vmStatus: 'STARTING', message: 'VMを起動しています' }); await gcp.start(target()); vm = await refresh(); }
  if (vm.status !== 'RUNNING') throw new Error('VMが起動状態になりませんでした');
  publish({ startedAt: new Date().toISOString() });
  await connect();
  const child = spawn(s.ptcglExecutable, [], { detached: false, stdio: 'ignore' });
  child.once('exit', () => void endSession());
  child.once('error', error => publish({ message: `PTCGLの起動に失敗しました: ${error.message}` }));
}

async function endSession() {
  if (operation) return;
  await exclusive(async () => {
    const s = getSettings();
    try { if (state.vpnStatus !== 'DISCONNECTED') { if (s.vpnClient === 'wiresock') await wiresock.disconnect(); else await wireguard.disconnect(s.wireGuardConfigPath); } publish({ vpnStatus: 'DISCONNECTED' }); }
    finally {
      if (s.autoStop) {
        // MVP has no authoritative multi-device presence signal. Never auto-stop blindly.
        publish({ message: '他端末の利用状況を確認できないため、VMは自動停止していません。確認後に停止してください。' });
      }
    }
  });
}

function infrastructurePath(settings: AppSettings) {
  if (settings.infrastructurePath) return resolve(settings.infrastructurePath);
  const packaged = join(process.resourcesPath, 'infrastructure', 'terraform');
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return resolve(app.getAppPath(), '..', '..', 'infrastructure', 'terraform');
}
function deploymentInput(deploymentId: string): DeploymentInput {
  const region = REGIONS.find(item => item.deploymentId === deploymentId);
  if (!region) throw new Error('未対応のリージョンです');
  const s = getSettings();
  if (!s.projectId || !s.clientPublicKey) throw new Error('Project IDとクライアント公開鍵を設定してください');
  const knownSuffix = new RegExp(`-(${REGIONS.map(item => item.deploymentId).join('|')})$`);
  return { projectId: s.projectId, region: region.region, zone: region.zone, deploymentId, instanceName: s.instanceName.replace(knownSuffix, ''), maxRuntimeMinutes: s.maxRuntimeMinutes, clientPublicKey: s.clientPublicKey, clientAddress: s.clientAddress };
}
function terraformRunner() { const s = getSettings(); return new TerraformRunner(s.terraformExecutable, infrastructurePath(s), join(app.getPath('userData'), 'terraform-stacks')); }
function appendInfraLog(value: string) { publish({ infraLog: `${state.infraLog ?? ''}${value}`.slice(-20000) }); }

function registerIpc() {
  ipcMain.handle('state:get', () => state);
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', async (_e, input: unknown) => { let settings = schema.parse(input); if (!settings.clientPublicKey && settings.wireGuardConfigPath) settings = { ...settings, clientPublicKey: await readClientPublicKey(settings.wireGuardConfigPath) }; store.set('settings', settings); publish({ region: settings.region }); return settings; });
  ipcMain.handle('app:detect', async () => {
    const candidates = process.platform === 'win32' ? [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Pokemon Trading Card Game Live', 'Pokemon TCG Live.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Pokemon Trading Card Game Live', 'Pokemon TCG Live.exe')
    ] : ['/Applications/Pokemon TCG Live.app/Contents/MacOS/Pokemon TCG Live', join(app.getPath('home'), 'Applications', 'Pokemon TCG Live.app', 'Contents', 'MacOS', 'Pokemon TCG Live')];
    return candidates.find(existsSync) ?? '';
  });
  ipcMain.handle('vm:refresh', () => exclusive(async () => { await refresh(); }));
  ipcMain.handle('vm:stop', () => exclusive(async () => { publish({ vmStatus: 'STOPPING' }); await gcp.stop(target()); await refresh(); publish({ startedAt: undefined, message: 'VMを停止しました' }); }));
  ipcMain.handle('vpn:connect', () => exclusive(connect));
  ipcMain.handle('vpn:disconnect', () => exclusive(async () => { const s = getSettings(); if (s.vpnClient === 'wiresock') await wiresock.disconnect(); else await wireguard.disconnect(s.wireGuardConfigPath); publish({ vpnStatus: 'DISCONNECTED' }); }));
  ipcMain.handle('session:start', () => exclusive(startSession));
  ipcMain.handle('update:get', () => updateState);
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) throw new Error('更新確認はパッケージ版でのみ利用できます');
    publishUpdate({ status: 'CHECKING', message: '更新を確認しています', percent: undefined });
    await autoUpdater.checkForUpdates();
  });
  ipcMain.handle('update:download', async () => { await autoUpdater.downloadUpdate(); });
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(false, true));
  ipcMain.handle('infra:regions', () => REGIONS);
  ipcMain.handle('infra:plan', (_e, deploymentId: unknown) => exclusive(async () => {
    const id = z.string().parse(deploymentId); plannedDeploymentId = undefined; publish({ infraStatus: 'PLANNING', infraLog: '', message: 'Terraform planを作成しています' });
    try { const plan = await terraformRunner().plan(deploymentInput(id), appendInfraLog); plannedDeploymentId = id; if (plan.clientAddress !== getSettings().clientAddress) { const current = getSettings(); if (current.wireGuardConfigPath) await updateClientAddressFile(current.wireGuardConfigPath, plan.clientAddress); store.set('settings', { ...current, clientAddress: plan.clientAddress }); } publish({ infraStatus: 'PLANNED', message: `Plan: ${plan.add}追加 / ${plan.change}変更 / ${plan.destroy}削除` }); }
    catch (error) { publish({ infraStatus: 'ERROR', message: error instanceof Error ? error.message : String(error) }); throw error; }
  }));
  ipcMain.handle('infra:apply', (_e, deploymentId: unknown) => exclusive(async () => {
    const id = z.string().parse(deploymentId); if (plannedDeploymentId !== id) throw new Error('先に同じリージョンのplanを実行してください');
    publish({ infraStatus: 'APPLYING', message: 'Terraform applyを実行しています' });
    try { const output = await terraformRunner().apply(deploymentInput(id), appendInfraLog); const region = REGIONS.find(item => item.deploymentId === id)!; const settings = { ...getSettings(), region: region.region, zone: output.zone, instanceName: output.instanceName }; store.set('settings', settings); plannedDeploymentId = undefined; publish({ infraStatus: 'READY', region: region.region, externalIp: output.externalIp, message: '新しいリージョン環境を作成しました' }); }
    catch (error) { publish({ infraStatus: 'ERROR', message: error instanceof Error ? error.message : String(error) }); throw error; }
  }));
  ipcMain.handle('infra:destroy', (_e, input: unknown) => exclusive(async () => {
    const { deploymentId, confirmed } = z.object({ deploymentId: z.string(), confirmed: z.literal(true) }).parse(input);
    publish({ infraStatus: 'DESTROYING', infraLog: '', message: 'リージョン環境を削除しています' });
    try { await terraformRunner().destroy(deploymentInput(deploymentId), appendInfraLog); publish({ infraStatus: 'IDLE', message: 'リージョン環境を削除しました' }); }
    catch (error) { publish({ infraStatus: 'ERROR', message: error instanceof Error ? error.message : String(error) }); throw error; }
  }));
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', info => publishUpdate({ status: 'AVAILABLE', availableVersion: info.version, message: `v${info.version}を利用できます` }));
  autoUpdater.on('update-not-available', () => publishUpdate({ status: 'CURRENT', availableVersion: undefined, message: '最新版です' }));
  autoUpdater.on('download-progress', progress => publishUpdate({ status: 'DOWNLOADING', percent: Math.round(progress.percent), message: `更新をダウンロード中: ${Math.round(progress.percent)}%` }));
  autoUpdater.on('update-downloaded', info => publishUpdate({ status: 'READY', availableVersion: info.version, percent: 100, message: '更新の準備ができました' }));
  autoUpdater.on('error', error => publishUpdate({ status: 'ERROR', message: error.message }));
}

function createWindow() {
  const win = new BrowserWindow({ show: false, backgroundColor: '#07110d', width: 1040, height: 720, minWidth: 860, minHeight: 620, webPreferences: { preload: join(__dirname, '../preload/index.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 3000);
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    writeDiagnostic(`did-fail-load code=${code} description=${description} url=${url}`);
    win.show();
  });
  win.webContents.on('render-process-gone', (_event, details) => writeDiagnostic(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) writeDiagnostic(`renderer-console level=${level} ${message}`); });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL); else void win.loadFile(join(__dirname, '../renderer/index.html'));
}
process.on('uncaughtException', error => writeDiagnostic(`uncaughtException ${error.stack ?? error.message}`));
process.on('unhandledRejection', reason => writeDiagnostic(`unhandledRejection ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`));
app.whenReady().then(() => {
  writeDiagnostic(`startup version=${app.getVersion()} platform=${process.platform} arch=${process.arch}`);
  registerIpc(); configureAutoUpdater(); createWindow();
  if (app.isPackaged) setTimeout(() => void autoUpdater.checkForUpdates().catch(error => publishUpdate({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) })), 5000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
