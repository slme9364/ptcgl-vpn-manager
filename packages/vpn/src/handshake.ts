export interface WireGuardHealth {
  lastHandshakeAt?: string;
  receivedBytes: number;
  sentBytes: number;
  connected: boolean;
}

export function parseWireGuardHealth(handshakes: string, transfers: string, peer: string, nowSeconds = Math.floor(Date.now() / 1000)): WireGuardHealth {
  const handshake = handshakes.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(columns => columns[0] === peer);
  const transfer = transfers.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(columns => columns[0] === peer);
  const timestamp = Number(handshake?.[1] ?? 0);
  const validTimestamp = Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= nowSeconds + 5;
  const counter = (value?: string) => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
  return {
    lastHandshakeAt: validTimestamp ? new Date(timestamp * 1000).toISOString() : undefined,
    receivedBytes: counter(transfer?.[1]),
    sentBytes: counter(transfer?.[2]),
    connected: validTimestamp && nowSeconds - timestamp <= 180
  };
}

export async function waitForWireGuardHandshake(read: () => Promise<WireGuardHealth>, startedAtSeconds: number, timeoutMs = 30000): Promise<WireGuardHealth> {
  const deadline = Date.now() + timeoutMs;
  do {
    const health = await read().catch(() => undefined);
    if (health?.connected && health.lastHandshakeAt && Date.parse(health.lastHandshakeAt) / 1000 >= startedAtSeconds - 1) return health;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() <= deadline);
  throw new Error('WireGuardのハンドシェイクを確認できませんでした。VM・UDP 51820・サーバーのPeer登録を確認してください。');
}
