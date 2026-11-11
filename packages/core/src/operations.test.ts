import { describe, expect, it, vi } from 'vitest';
import { inspectClientConfig, launchGame, redactDiagnosticText, SessionExitGuard } from './operations';
describe('safe diagnostics', () => {
  it('reports missing fields without returning supplied secret text', () => {
    const checks = inspectClientConfig('[Interface]\nPrivateKey = secret-do-not-return\n[Peer]\n');
    expect(checks.every(check => check.status === 'error')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain('secret-do-not-return');
  });
  it('accepts an existing endpoint without claiming network connectivity', () => {
    const key = 'A'.repeat(43) + '=';
    const checks = inspectClientConfig('[Interface]\nPrivateKey = '+key+'\nAddress = 10.66.0.3/32\n[Peer]\nPublicKey = '+key+'\nEndpoint = 192.0.2.1:51820\n');
    expect(checks.every(check => check.status === 'ok')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(key);
  });
  it('removes credentials, OAuth parameters and personal paths from copied diagnostics', () => {
    const source = 'PrivateKey = private-secret\nrefresh_token=refresh-secret\nAuthorization: Bearer bearer-secret\nhttps://accounts.example.test/callback?code=oauth-secret&state=state-secret\nC:\\Users\\example\\private.conf\nuser@example.test project-secret 192.0.2.1';
    const output = redactDiagnosticText(source, ['project-secret']);
    for (const value of ['private-secret','refresh-secret','bearer-secret','oauth-secret','state-secret','example\\private','user@example.test','project-secret','192.0.2.1']) expect(output).not.toContain(value);
    expect(output).toContain('https://accounts.example.test/callback');
  });
});
describe('explicit launch modes', () => {
  it('normal launch disconnects locally and never requests a VPN connection', async () => {
    const calls: string[] = [];
    const connect = vi.fn();
    await launchGame('normal', { connect, disconnect: async () => { calls.push('disconnect'); }, isRunning: async () => false, start: async () => { calls.push('start'); } });
    expect(connect).not.toHaveBeenCalled();
    expect(calls).toEqual(['disconnect','start']);
  });
  it('does not spawn a duplicate game process', async () => {
    const start = vi.fn();
    const result = await launchGame('vpn', { connect: async () => undefined, disconnect: async () => undefined, isRunning: async () => true, start });
    expect(result.alreadyRunning).toBe(true); expect(start).not.toHaveBeenCalled();
  });
  it('does not start the game when connecting fails', async () => {
    const start = vi.fn();
    await expect(launchGame('vpn', { connect: async () => { throw new Error('handshake failed'); }, disconnect: async () => undefined, isRunning: async () => false, start })).rejects.toThrow('handshake failed');
    expect(start).not.toHaveBeenCalled();
  });
});
describe('game and updater handover', () => {
  it('does not disconnect while a replacement process appears during the grace period', () => {
    const guard = new SessionExitGuard(15000); guard.arm(0);
    expect(guard.observe(true,1000)).toBe(false);
    expect(guard.observe(false,10000)).toBe(false);
    expect(guard.observe(true,14000)).toBe(false);
    expect(guard.observe(false,20000)).toBe(false);
  });
  it('reports a confirmed exit once and ignores externally started sessions', () => {
    const guard = new SessionExitGuard(15000);
    expect(guard.observe(false,90000)).toBe(false);
    guard.arm(100000); expect(guard.observe(false,115000)).toBe(true);
    expect(guard.observe(false,120000)).toBe(false);
  });
  it('respects opting out of automatic disconnect', () => {
    const guard = new SessionExitGuard(); guard.arm(0); guard.disarm();
    expect(guard.observe(false,90000)).toBe(false);
  });
});
