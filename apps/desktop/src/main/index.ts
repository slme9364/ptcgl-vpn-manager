import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron';
import { existsSync } from 'node:fs';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import Store from 'electron-store';
import { gameProcessIds, detectGame, localDiagnostics, diagnosticError } from './desktop-tools';
import electronUpdater from 'electron-updater';
import { z } from 'zod';
import { DEFAULT_SETTINGS, REGIONS, launchGame, SessionExitGuard, redactDiagnosticText, type ActivityEntry, type DiagnosticReport, type LaunchMode, type AppSettings, type DashboardState } from '@ptcgl/core';
import { GcpVmClient, TerraformRunner, type DeploymentInput } from '@ptcgl/gcp';
import { readClientPublicKey, updateClientAddressFile, updateEndpointFile, WireGuardController, WireSockController } from '@ptcgl/vpn';

// This utility does not need GPU rendering. Disabling it avoids black windows
// seen with some Windows GPU/driver combinations.
app.disableHardwareAcceleration();
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

const schema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$|^$/),
  zone: z.string().regex(/^[a-z]+-[a-z]+\d-[a-z]$/), instanceName: z.string().regex(/^[a-z]([-a-z0-9]*[a-z0-9])?$/),
  region: z.string().regex(/^[a-z]+-[a-z]+\d$/), ptcglExecutable: z.string(), wireGuardConfigPath: z.string(),
  vpnClient: z.enum(['wireguard', 'wiresock']), vpnMode: z.enum(['full-tunnel', 'destination-split', 'windows-app-split']),
  maxRuntimeMinutes: z.number().int().min(15).max(1440), autoStop: z.boolean(), disconnectOnGameExit: z.boolean().default(true), logLevel: z.enum(['error', 'warn', 'info', 'debug']),
  terraformExecutable: z.string().min(1), infrastructurePath: z.string(), clientPublicKey: z.string(), clientAddress: z.string()
});
const store = new Store<{ settings: AppSettings }>({ defaults: { settings: DEFAULT_SETTINGS }, encryptionKey: 'ptcgl-vpn-settings-v1' });
const gcp = new GcpVmClient();
const wireguard = new WireGuardController();
const wiresock = new WireSockController(message => publish({ vpnStatus: 'ERROR', vpnHandshakeAt: undefined, message }), at => publish({ vpnHandshakeAt: at }));
const { autoUpdater } = electronUpdater;
const getSettings = (): AppSettings => ({ ...DEFAULT_SETTINGS, ...store.get('settings') });
let state: DashboardState = { vmStatus: 'UNKNOWN', vpnStatus: 'DISCONNECTED', region: getSettings().region, estimatedMonthlyCost: 0, busy: false, infraStatus: 'IDLE', activities: [] };
let operation: Promise<unknown> | undefined;
let plannedDeploymentId: string | undefined;
let activityId = 0;
let latestReport: DiagnosticReport | undefined;
const exitGuard = new SessionExitGuard(15000);
let checkingGame = false;
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
function activity(level: ActivityEntry['level'], title: string, detail?: string) {
  const safe = detail ? diagnosticError(new Error(detail), getSettings()) : undefined;
  publish({ activities: [...(state.activities ?? []), { id: ++activityId, at: new Date().toISOString(), level, title, detail: safe }].slice(-80) });
}
function publish(patch: Partial<DashboardState>) {
  const entries = [...(patch.activities ?? state.activities ?? [])];
  if (patch.vpnStatus && patch.vpnStatus !== state.vpnStatus) entries.push({ id: ++activityId, at: new Date().toISOString(), level: patch.vpnStatus === 'ERROR' ? 'error' : 'info', title: 'VPN: ' + patch.vpnStatus });
  if (patch.vmStatus && patch.vmStatus !== state.vmStatus) entries.push({ id: ++activityId, at: new Date().toISOString(), level: 'info', title: 'VM: ' + patch.vmStatus });
  state = { ...state, ...patch, activities: entries.slice(-80) };
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('state:changed', state));
}
function publishUpdate(patch: Partial<UpdateState>) { updateState = { ...updateState, ...patch }; BrowserWindow.getAllWindows().forEach(w => w.webContents.send('update:changed', updateState)); }
async function refreshVpnStatus() {
  const s = getSettings();
  if (process.platform !== 'win32' || !s.wireGuardConfigPath || state.vpnStatus === 'CONNECTING' || state.vpnStatus === 'DISCONNECTING') return;
  if (s.vpnClient === 'wiresock') {
    if (wiresock.isRunning) publish({ vpnStatus: wiresock.hasRecentHandshake ? 'CONNECTED' : 'ERROR', vpnScope: 'ptcgl', vpnHandshakeAt: wiresock.lastHandshakeAt });
    return;
  }
  try {
    const health = await wireguard.diagnostics(s.wireGuardConfigPath);
    publish({ vpnHealth: health, vpnStatus: health.connected ? 'CONNECTED' : 'DISCONNECTED' });
  } catch {
    publish({ vpnHealth: undefined, vpnStatus: state.vpnStatus === 'CONNECTED' ? 'ERROR' : state.vpnStatus });
  }
}
async function refresh() { const vm = await gcp.get(target()); publish({ vmStatus: vm.status, externalIp: vm.externalIp, region: getSettings().region }); await refreshVpnStatus(); return vm; }
async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  if (operation) throw new Error('別の操作が進行中です');
  publish({ busy: true, message: undefined });
  const pending = Promise.resolve().then(task); operation = pending;
  try { return await pending; }
  catch (error) { activity('error', '操作に失敗しました', error instanceof Error ? error.message : String(error)); throw error; }
  finally { operation = undefined; publish({ busy: false }); }
}

async function connect() {
  const s = getSettings();
  if (!s.projectId) throw new Error('Project IDを設定してください');
  if (!s.wireGuardConfigPath) throw new Error('WireGuard設定ファイルを設定してください');
  activity('info', 'VPN接続を開始');
  const report = await localDiagnostics(s);
  const required = new Set(['client','admin','config','interface','peer','target']);
  if (s.vpnClient === 'wiresock') required.add('game');
  const failure = report.checks.find(check => check.status === 'error' && required.has(check.id));
  if (failure) throw new Error(failure.title + ': ' + failure.detail);
  publish({ vpnStatus: 'CONNECTING', message: 'VMの状態を確認しています' });
  try {
    let vm = await refresh();
    if (vm.status !== 'RUNNING') {
      publish({ vmStatus: 'STARTING', message: 'VMを起動しています' });
      await gcp.start(target());
      vm = await refresh();
    }
    if (vm.status !== 'RUNNING') throw new Error('VMが起動状態になりませんでした');
    if (!vm.externalIp) throw new Error('VMの外部IPv4を取得できません');
    publish({ vpnStatus: 'CONNECTING', message: 'VPNへ接続しています' });
    await updateEndpointFile(s.wireGuardConfigPath, vm.externalIp);
    if (s.vpnClient === 'wiresock') {
      if (process.platform !== 'win32') throw new Error('WireSockはWindowsでのみ利用できます');
      if (!s.ptcglExecutable) throw new Error('WireSockにはPTCGL実行ファイルの設定が必要です');
      await wireguard.disconnect(s.wireGuardConfigPath);
      const health = await wiresock.connect(s.wireGuardConfigPath, s.ptcglExecutable);
      publish({ vpnHealth: undefined, vpnScope: 'ptcgl', vpnHandshakeAt: health.lastHandshakeAt });
    } else {
      await wiresock.disconnect();
      const health = await wireguard.connect(s.wireGuardConfigPath);
      publish({ vpnHealth: health, vpnScope: 'full', vpnHandshakeAt: undefined });
    }
    publish({ vpnStatus: 'CONNECTED', message: s.vpnClient === 'wireguard' ? (process.platform === 'win32' ? 'WireGuardサーバーとのハンドシェイクを確認しました' : 'WireGuardを起動しました。通信の確認は別途必要です') : 'PTCGL専用VPNのハンドシェイクを確認しました。Chromeなど他のアプリは通常回線です' });
  } catch (error) {
    publish({ vpnStatus: 'ERROR', vpnHealth: undefined, vpnHandshakeAt: undefined, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function disconnectLocalVpn() {
  exitGuard.disarm();
  const s = getSettings();
  await wiresock.disconnect();
  if (s.wireGuardConfigPath && (process.platform === 'win32' || state.vpnStatus !== 'DISCONNECTED')) await wireguard.disconnect(s.wireGuardConfigPath);
  publish({ vpnStatus: 'DISCONNECTED', vpnHealth: undefined, vpnHandshakeAt: undefined, vpnScope: undefined });
}

async function runLaunch(mode: LaunchMode) {
  const s = getSettings();
  if (!s.ptcglExecutable || !existsSync(s.ptcglExecutable)) throw new Error('設定画面からPTCGLの実行ファイルを選択してください');
  exitGuard.disarm();
  activity('info', mode === 'normal' ? '通常回線でPTCGLを開く' : 'VPNでPTCGLを開く');
  const result = await launchGame(mode, {
    connect, disconnect: disconnectLocalVpn,
    isRunning: async () => (await gameProcessIds(s.ptcglExecutable)).length > 0,
    start: () => new Promise<void>((resolveSpawn, reject) => {
      const child = spawn(s.ptcglExecutable, [], { detached: false, stdio: 'ignore' });
      child.once('spawn', resolveSpawn); child.once('error', reject);
    })
  });
  if (mode === 'vpn') exitGuard.arm();
  publish({ gameRunning: true, lastLaunchMode: mode, startedAt: new Date().toISOString(),
    message: result.alreadyRunning ? 'PTCGLまたは更新ツールは起動済みです。新しいプロセスは起動していません。' : mode === 'normal' ? 'ManagerのVPNを使わずPTCGLを起動しました。ログインはゲーム内で進めてください。' : 'VPNへ接続し、PTCGLを起動しました' });
}

async function refreshGameState() {
  if (checkingGame) return;
  checkingGame = true;
  try {
    const s = getSettings();
    const running = (await gameProcessIds(s.ptcglExecutable)).length > 0;
    if (state.gameRunning !== running) publish({ gameRunning: running });
    if (!state.busy && s.disconnectOnGameExit !== false && exitGuard.observe(running)) {
      await exclusive(async () => { await disconnectLocalVpn(); activity('info','ゲーム終了を確認しVPNを切断'); publish({ message:'ゲーム終了を確認してVPNを切断しました。VM停止は別操作です。' }); });
    }
  } catch { publish({ gameRunning: undefined }); }
  finally { checkingGame = false; }
}

async function diagnose() {
  const s = getSettings();
  const report = await localDiagnostics(s);
  if (report.checks.find(check => check.id === 'target')?.status === 'ok' && report.checks.find(check => check.id === 'credentials')?.status === 'ok') {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const vm = await Promise.race([gcp.get(target()),new Promise<never>((_,reject) => { timeout = setTimeout(() => reject(new Error('クラウド確認がタイムアウトしました')),15000); })]);
      report.checks.push({id:'cloud',title:'クラウド読み取り確認',status:'ok',detail:'VM状態: '+vm.status+'。起動・停止は行っていません。'});
      publish({vmStatus:vm.status,externalIp:vm.externalIp});
    } catch (error) { report.checks.push({id:'cloud',title:'クラウド読み取り確認',status:'error',detail:diagnosticError(error,s)}); }
    finally { if (timeout) clearTimeout(timeout); }
  }
  latestReport = report;
  activity('info','設定診断が完了',report.checks.filter(check => check.status === 'error').length+'件の要確認項目');
  return report;
}

async function copyDiagnostics() {
  const report = latestReport ?? await localDiagnostics(getSettings());
  const context = getSettings();
  const lines = ['PTCGL VPN Manager '+app.getVersion(), 'Platform: '+process.platform,
    'VM: '+state.vmStatus, 'VPN: '+state.vpnStatus, 'Scope: '+(state.vpnScope ?? 'none'), 'Checked: '+report.checkedAt,
    ...report.checks.map(check => '['+check.status+'] '+check.title+': '+check.detail),
    '', 'Recent activity:', ...(state.activities ?? []).slice(-20).map(entry => entry.at+' '+entry.title+' '+(entry.detail ?? ''))];
  clipboard.writeText(lines.map(line => redactDiagnosticText(line,[context.projectId,context.instanceName])).join('\n'));
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
  ipcMain.handle('settings:set', async (_e, input: unknown) => {
    let settings = schema.parse(input);
    const previous = getSettings();
    const critical: (keyof AppSettings)[] = ['projectId','zone','instanceName','region','ptcglExecutable','wireGuardConfigPath','vpnClient','vpnMode','clientPublicKey','clientAddress'];
    if (state.vpnStatus === 'CONNECTED' && critical.some(key => settings[key] !== previous[key])) throw new Error('接続設定はVPNを切断してから変更してください');
    if (!settings.clientPublicKey && settings.wireGuardConfigPath) settings = { ...settings, clientPublicKey: await readClientPublicKey(settings.wireGuardConfigPath) };
    store.set('settings', settings); plannedDeploymentId = undefined; latestReport = undefined;
    publish({ region:settings.region,infraStatus:'IDLE',infraLog:undefined }); activity('info','設定を保存'); return settings;
  });
  ipcMain.handle('app:detect', () => detectGame(app.getPath('home')));
  ipcMain.handle('paths:pick', async (_e, input: unknown) => {
    const kind = z.enum(['game','config']).parse(input);
    const result = await dialog.showOpenDialog({title:kind === 'game' ? 'PTCGL実行ファイルを選択' : 'WireGuard設定ファイルを選択',
      properties:['openFile'], filters:kind === 'config' ? [{name:'WireGuard設定',extensions:['conf']}] : process.platform === 'win32' ? [{name:'実行ファイル',extensions:['exe']}] : [{name:'アプリケーション・実行ファイル',extensions:['app','*']}]});
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0];
    return kind === 'game' && selected.endsWith('.app') ? join(selected,'Contents','MacOS','Pokemon TCG Live') : selected;
  });
  ipcMain.handle('diagnostics:run', () => exclusive(diagnose));
  ipcMain.handle('diagnostics:copy', copyDiagnostics);
  ipcMain.handle('vm:refresh', () => exclusive(async () => { await refresh(); }));
  ipcMain.handle('vm:stop', () => exclusive(async () => { await disconnectLocalVpn(); publish({ vmStatus: 'STOPPING' }); await gcp.stop(target()); await refresh(); publish({ startedAt: undefined, message: 'VMを停止しました' }); }));
  ipcMain.handle('vpn:connect', () => exclusive(connect));
  ipcMain.handle('vpn:disconnect', () => exclusive(async () => { await disconnectLocalVpn(); activity('info','VPNを切断'); }));
  ipcMain.handle('session:start', () => exclusive(() => runLaunch('vpn')));
  ipcMain.handle('session:normal', () => exclusive(() => runLaunch('normal')));
  ipcMain.handle('update:get', () => updateState);
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) throw new Error('更新確認はパッケージ版でのみ利用できます');
    publishUpdate({ status: 'CHECKING', message: '更新を確認しています', percent: undefined });
    await autoUpdater.checkForUpdates();
  });
  ipcMain.handle('update:download', async () => { await autoUpdater.downloadUpdate(); });
  ipcMain.handle('update:install', async () => {
    if (state.busy || state.vpnStatus === 'CONNECTED' || (await gameProcessIds(getSettings().ptcglExecutable)).length > 0) throw new Error('ゲームを終了し、VPNを切断してから更新してください');
    autoUpdater.quitAndInstall(false,true);
  });
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
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', info => publishUpdate({ status: 'AVAILABLE', availableVersion: info.version, message: `v${info.version}を利用できます` }));
  autoUpdater.on('update-not-available', () => publishUpdate({ status: 'CURRENT', availableVersion: undefined, message: '最新版です' }));
  autoUpdater.on('download-progress', progress => publishUpdate({ status: 'DOWNLOADING', percent: Math.round(progress.percent), message: `更新をダウンロード中: ${Math.round(progress.percent)}%` }));
  autoUpdater.on('update-downloaded', info => publishUpdate({ status: 'READY', availableVersion: info.version, percent: 100, message: '更新の準備ができました' }));
  autoUpdater.on('error', error => publishUpdate({ status: 'ERROR', message: error.message }));
}

function createWindow() {
  const win = new BrowserWindow({ show: false, backgroundColor: '#07110d', width: 1040, height: 720, minWidth: 860, minHeight: 620, webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
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
  void refreshVpnStatus();
  void refreshGameState();
  const gameTimer = setInterval(() => void refreshGameState(),5000); gameTimer.unref();
  const vpnStatusTimer = setInterval(() => {
    if (!state.busy && (state.vpnStatus === 'CONNECTED' || wiresock.isRunning)) void refreshVpnStatus();
  }, 5000);
  vpnStatusTimer.unref();
  if (app.isPackaged) setTimeout(() => void autoUpdater.checkForUpdates().catch(error => publishUpdate({ status: 'ERROR', message: error instanceof Error ? error.message : String(error) })), 5000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

let wireSockQuitInProgress = false;
app.on('before-quit', event => {
  if (wiresock.isRunning && !wireSockQuitInProgress) {
    event.preventDefault(); wireSockQuitInProgress = true;
    void wiresock.disconnect().finally(() => app.quit());
  }
});
