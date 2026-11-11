import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { parseWireGuardHealth, waitForWireGuardHandshake } from './handshake';
import { stageWindowsConfig } from './windows-config';
import { parseWireSockEvent } from './wiresock-health';

export function updateEndpoint(config: string, endpointIp: string, port = 51820): string {
  if (isIP(endpointIp) !== 4) throw new Error('Invalid IPv4 endpoint');
  const entry = /^(Endpoint\s*=\s*)[^\r\n]+/m;
  if (!entry.test(config)) throw new Error('WireGuard config has no Endpoint entry');
  return config.replace(entry, `$1${endpointIp}:${port}`);
}
export function updateClientAddress(config: string, address: string) {
  if (!/^10\.66\.0\.\d{1,3}\/32$/.test(address)) throw new Error('Invalid client tunnel address');
  const host = Number(address.match(/10\.66\.0\.(\d+)/)?.[1]); if (host < 2 || host > 254) throw new Error('Invalid client tunnel address');
  const entry = /^(Address\s*=\s*)[^\r\n]+/m;
  if (!entry.test(config)) throw new Error('WireGuard config has no Address entry');
  return config.replace(entry, `$1${address}`);
}

export async function updateEndpointFile(path: string, ip: string) {
  const original = await fs.readFile(path, 'utf8');
  const temporary = `${path}.tmp`;
  await fs.writeFile(temporary, updateEndpoint(original, ip), { mode: 0o600 });
  await fs.rename(temporary, path);
}
export async function updateClientAddressFile(path: string, address: string) {
  const original = await fs.readFile(path, 'utf8'); const temporary = `${path}.tmp`;
  await fs.writeFile(temporary, updateClientAddress(original, address), { mode: 0o600 }); await fs.rename(temporary, path);
}

export function addWireSockAllowedApp(config: string, executable: string) {
  if (!executable || /[\r\n,]/.test(executable)) throw new Error('Invalid allowed application path');
  // WireSock extensions belong to [Peer], and ordinary apps keep their DNS.
  const withoutExisting = config.replace(/^(?:#@ws:)?AllowedApps\s*=.*(?:\r?\n|$)/gmi, '')
    .replace(/^DNS\s*=.*(?:\r?\n|$)/gmi, '');
  const next = withoutExisting.replace(/^(\[Peer\]\s*\r?\n)/m, `$1#@ws:AllowedApps = ${executable}\n`);
  if (next === withoutExisting) throw new Error('WireGuard config has no Peer section');
  return next;
}

function firstExisting(candidates: string[]) { return candidates.find(existsSync) ?? candidates[candidates.length - 1]!; }
function wireGuardExecutable() {
  if (process.platform !== 'win32') return firstExisting(['/opt/homebrew/bin/wg-quick', '/usr/local/bin/wg-quick', 'wg-quick']);
  return firstExisting([join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wireguard.exe'), 'wireguard.exe']);
}
function wireSockExecutable() {
  return firstExisting([
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireSock Secure Connect', 'sdk', 'wiresock-client.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireSock Secure Connect', 'wiresock-client.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireSock VPN Client', 'wiresock-client.exe'), 'wiresock-client.exe'
  ]);
}
function wgExecutable() {
  if (process.platform !== 'win32') return firstExisting(['/opt/homebrew/bin/wg', '/usr/local/bin/wg', 'wg']);
  return firstExisting([join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WireGuard', 'wg.exe'), 'wg.exe']);
}
async function runMacWireGuard(action: 'up' | 'down', configPath: string) {
  const script = 'on run argv\nset commandText to quoted form of item 1 of argv & " " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv\ndo shell script commandText with administrator privileges\nend run';
  await exec('/usr/bin/osascript', ['-e', script, wireGuardExecutable(), action, configPath]);
}
export async function readClientPublicKey(configPath: string) {
  const config = await fs.readFile(configPath, 'utf8');
  const privateKey = config.match(/^PrivateKey\s*=\s*([^\r\n]+)$/m)?.[1]?.trim();
  if (!privateKey) throw new Error('WireGuard config has no PrivateKey');
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(wgExecutable(), ['pubkey'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', value => { stdout += String(value); }); child.stderr.on('data', value => { stderr += String(value); });
    child.once('error', reject); child.once('close', code => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`wg pubkey failed: ${stderr}`)));
    child.stdin.end(`${privateKey}\n`);
  });
}

export class WireGuardController {
  private stagedMacConfig?: string;
  private stagedWindowsConfig?: string;
  async connect(configPath: string) {
    const startedAt = Math.floor(Date.now() / 1000);
    if (process.platform === 'win32') {
      const service = 'WireGuardTunnel$' + basename(configPath, '.conf');
      let exists = false;
      try { await exec('sc.exe', ['query', service], { windowsHide: true }); exists = true; }
      catch (error) { if ((error as { code?: number }).code !== 1060) throw error; }
      if (exists) await exec(wireGuardExecutable(), ['/uninstalltunnelservice', basename(configPath, '.conf')], { windowsHide: true });
      this.stagedWindowsConfig = await stageWindowsConfig(configPath);
      await exec(wireGuardExecutable(), ['/installtunnelservice', this.stagedWindowsConfig], { windowsHide: true });
    }
    else if (process.platform === 'darwin') {
      this.stagedMacConfig = join(tmpdir(), `ptcgl${process.pid}.conf`);
      await fs.copyFile(configPath, this.stagedMacConfig); await fs.chmod(this.stagedMacConfig, 0o600);
      try { await runMacWireGuard('up', this.stagedMacConfig); } catch (error) { await fs.rm(this.stagedMacConfig, { force: true }); this.stagedMacConfig = undefined; throw error; }
    }
    else await exec(wireGuardExecutable(), ['up', configPath]);
    // macOS uses an elevated wg-quick helper; unprivileged polling cannot read its socket.
    if (process.platform !== 'win32') return undefined;
    try { return await waitForWireGuardHandshake(() => this.diagnostics(configPath), startedAt); }
    catch (error) {
      // Restore the original routes if a full-tunnel connection never becomes usable.
      await this.disconnect(configPath).catch(() => undefined);
      throw error;
    }
  }
  async diagnostics(configPath: string) {
    const config = await fs.readFile(configPath, 'utf8');
    const peer = config.match(/^PublicKey\s*=\s*([^\r\n]+)$/m)?.[1]?.trim();
    if (!peer) throw new Error('WireGuard config has no server PublicKey');
    const name = basename(this.stagedMacConfig ?? configPath, '.conf');
    const [handshake, transfer] = await Promise.all([
      exec(wgExecutable(), ['show', name, 'latest-handshakes'], { windowsHide: true, timeout: 5000 }),
      exec(wgExecutable(), ['show', name, 'transfer'], { windowsHide: true, timeout: 5000 })
    ]);
    return parseWireGuardHealth(handshake.stdout, transfer.stdout, peer);
  }
  async disconnect(configPath: string) {
    if (process.platform === 'win32') {
      let exists = false;
      try { await exec('sc.exe', ['query', 'WireGuardTunnel$' + basename(configPath, '.conf')], { windowsHide: true }); exists = true; }
      catch (error) { if ((error as { code?: number }).code !== 1060) throw error; }
      if (exists) await exec(wireGuardExecutable(), ['/uninstalltunnelservice', basename(configPath, '.conf')], { windowsHide: true });
      if (this.stagedWindowsConfig) await fs.rm(this.stagedWindowsConfig, { force: true });
      this.stagedWindowsConfig = undefined;
    }
    else if (process.platform === 'darwin') {
      const staged = this.stagedMacConfig ?? configPath;
      try { await runMacWireGuard('down', staged); } finally { if (this.stagedMacConfig) await fs.rm(this.stagedMacConfig, { force: true }); this.stagedMacConfig = undefined; }
    }
    else await exec(wireGuardExecutable(), ['down', configPath]);
  }
  async status(configPath: string) {
    try { return (await this.diagnostics(configPath)).connected ? 'CONNECTED' as const : 'DISCONNECTED' as const; }
    catch { return 'DISCONNECTED' as const; }
  }
}

export class WireSockController {
  private child?: ChildProcess;
  private temporaryConfig?: string;
  lastHandshakeAt?: string;
  constructor(private readonly onExit?: (message: string) => void, private readonly onHandshake?: (at: string) => void) {}
  get isRunning() { return this.child?.exitCode === null && this.child.pid !== undefined; }
  get hasRecentHandshake() { return !!this.lastHandshakeAt && Date.now() - Date.parse(this.lastHandshakeAt) <= 180000; }
  async connect(configPath: string, allowedApp: string) {
    if (process.platform !== 'win32') throw new Error('WireSock is supported on Windows only');
    if (this.isRunning && this.hasRecentHandshake) return { lastHandshakeAt: this.lastHandshakeAt! };
    await this.disconnect();
    const original = await fs.readFile(configPath, 'utf8');
    this.temporaryConfig = await stageWindowsConfig(configPath);
    await fs.writeFile(this.temporaryConfig, addWireSockAllowedApp(original, allowedApp));
    const child = spawn(wireSockExecutable(), ['run', '-config', this.temporaryConfig, '-log-level', 'info'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: dirname(configPath) });
    this.child = child;
    try {
      const at = await new Promise<string>((resolve, reject) => {
        let settled = false;
        let ready = false;
        const fail = (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } };
        const timer = setTimeout(() => fail(new Error('WireSockのハンドシェイクを確認できませんでした。サーバーと接続設定を確認してください。')), 30000);
        child.once('error', fail);
        child.once('close', code => {
          fail(new Error('WireSockが接続前に終了しました（終了コード ' + String(code) + '）'));
          if (this.child === child) {
            this.child = undefined;
            this.lastHandshakeAt = undefined;
            if (ready) this.onExit?.('WireSockが終了したため、PTCGL専用VPNは切断されました');
          }
        });
        const handleLine = (line: string) => {
          if (this.child !== child) return;
          const event = parseWireSockEvent(line);
          if (event?.type === 'error' && !ready) fail(new Error(event.message));
          if (event?.type === 'handshake') {
            this.lastHandshakeAt = new Date().toISOString();
            this.onHandshake?.(this.lastHandshakeAt);
            if (!settled) { settled = true; ready = true; clearTimeout(timer); resolve(this.lastHandshakeAt); }
          }
        };
        for (const stream of [child.stdout, child.stderr]) {
          let buffer = '';
          stream?.on('data', value => {
            const lines = (buffer + String(value)).split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) handleLine(line);
          });
          stream?.once('end', () => { if (buffer) handleLine(buffer); });
        }
      });
      return { lastHandshakeAt: at };
    } catch (error) { await this.disconnect(); throw error; }
  }
  async disconnect() {
    const child = this.child;
    this.child = undefined;
    this.lastHandshakeAt = undefined;
    if (child?.pid && child.exitCode === null) {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 5000);
        child.once('close', () => { clearTimeout(timeout); resolve(); });
        child.kill();
      });
    }
    if (this.temporaryConfig) await fs.rm(this.temporaryConfig, { force: true });
    this.temporaryConfig = undefined;
  }
}
