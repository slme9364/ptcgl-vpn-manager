export interface DiagnosticCheck { id: string; title: string; status: 'ok' | 'warning' | 'error'; detail: string }
export interface DiagnosticReport { checkedAt: string; checks: DiagnosticCheck[] }
export interface ActivityEntry { id: number; at: string; level: 'info' | 'error'; title: string; detail?: string }
export type LaunchMode = 'normal' | 'vpn';

export function inspectClientConfig(text: string): DiagnosticCheck[] {
  const field = (name: string) => new RegExp('^\\s*' + name + '\\s*=\\s*([^\\r\\n]+)', 'mi').exec(text)?.[1]?.trim();
  const validKey = (value?: string) => /^[A-Za-z0-9+/]{43}=$/.test(value ?? '');
  const address = field('Address');
  const endpoint = field('Endpoint');
  const endpointPort = endpoint?.match(/^(\S+):(\d+)$/)?.[2];
  const interfaceOk = /\[Interface\]/i.test(text) && validKey(field('PrivateKey')) && !!address;
  const peerOk = /\[Peer\]/i.test(text) && validKey(field('PublicKey')) && !!endpointPort && Number(endpointPort) >= 1 && Number(endpointPort) <= 65535;
  return [
    { id: 'interface', title: '端末の接続設定', status: interfaceOk ? 'ok' : 'error', detail: interfaceOk ? '鍵とアドレスの形式を確認しました。鍵の内容は表示しません。' : 'Interfaceの鍵またはAddressを確認してください。' },
    { id: 'peer', title: 'サーバーの接続設定', status: peerOk ? 'ok' : 'error', detail: peerOk ? '公開鍵とEndpointの形式を確認しました。実通信の確認は接続時に行います。' : 'PeerのPublicKeyまたはEndpointを確認してください。' }
  ];
}

export function redactDiagnosticText(input: string, sensitive: string[] = []): string {
  let result = input.slice(0, 16000)
    .replace(/(?:Authorization|Cookie)\s*[:=][^\r\n]*/gi, '[認証情報を除外]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [除外]')
    .replace(/(["']?(?:PrivateKey|PresharedKey|access_token|refresh_token|id_token|client_secret|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[除外]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWTを除外]')
    .replace(/[A-Za-z0-9+/]{43}=/g, '[鍵を除外]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[URL]'; } })
    .replace(/-EncodedCommand\s+[A-Za-z0-9+/=]+/gi, '-EncodedCommand [除外]')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '%USERPROFILE%')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '$HOME')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[メールを除外]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]');
  for (const value of sensitive.filter(Boolean)) result = result.split(value).join('[除外]');
  return result.slice(0, 600);
}

export async function launchGame(mode: LaunchMode, actions: {
  connect(): Promise<void>; disconnect(): Promise<void>; isRunning(): Promise<boolean>; start(): Promise<void>
}): Promise<{ alreadyRunning: boolean }> {
  if (mode === 'vpn') await actions.connect(); else await actions.disconnect();
  if (await actions.isRunning()) return { alreadyRunning: true };
  await actions.start();
  return { alreadyRunning: false };
}

export class SessionExitGuard {
  private armed = false;
  private lastSeen = 0;
  constructor(private readonly graceMs = 15000) {}
  arm(now = Date.now()) { this.armed = true; this.lastSeen = now; }
  disarm() { this.armed = false; }
  observe(running: boolean, now = Date.now()): boolean {
    if (!this.armed) return false;
    if (running) this.lastSeen = now;
    if (!running && now - this.lastSeen >= this.graceMs) { this.armed = false; return true; }
    return false;
  }
}
