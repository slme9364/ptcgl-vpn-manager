import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWireGuardHealth, waitForWireGuardHandshake } from './handshake';

describe('WireGuard connection verification', () => {
  afterEach(() => vi.useRealTimers());
  it('does not call an existing interface connected without a handshake', () => {
    expect(parseWireGuardHealth('server 0', 'server 0 148', 'server', 2000).connected).toBe(false);
  });
  it('requires the configured server peer and rejects stale/future handshakes', () => {
    expect(parseWireGuardHealth('other 2000', '', 'server', 2000).connected).toBe(false);
    expect(parseWireGuardHealth('server 1800', '', 'server', 2000).connected).toBe(false);
    expect(parseWireGuardHealth('server 999999999999', '', 'server', 2000).connected).toBe(false);
  });
  it('reports the matching peer timestamp and byte counts', () => {
    expect(parseWireGuardHealth('other 1\r\nserver 1990\r\n', 'other 99 99\nserver 1024 2048', 'server', 2000)).toEqual({
      connected: true, lastHandshakeAt: new Date(1990000).toISOString(), receivedBytes: 1024, sentBytes: 2048
    });
  });
  it('waits for a handshake after this connection instead of reusing an old one', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2000000));
    const read = vi.fn().mockResolvedValueOnce(parseWireGuardHealth('server 1900', '', 'server', 2000))
      .mockResolvedValue(parseWireGuardHealth('server 2001', 'server 100 200', 'server', 2001));
    const pending = waitForWireGuardHandshake(read, 2000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toMatchObject({ connected: true, receivedBytes: 100 });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('times out when service startup succeeds but no handshake arrives', async () => {
    vi.useFakeTimers();
    const pending = waitForWireGuardHandshake(async () => parseWireGuardHealth('server 0', '', 'server'), Math.floor(Date.now() / 1000), 2000);
    const assertion = expect(pending).rejects.toThrow('ハンドシェイク');
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});
