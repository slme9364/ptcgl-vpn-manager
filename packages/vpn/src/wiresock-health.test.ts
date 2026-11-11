import { describe, expect, it } from 'vitest';
import { parseWireSockEvent } from './wiresock-health';
describe('WireSock CLI readiness', () => {
  it('does not report a process launch or sent handshake as a connection', () => {
    expect(parseWireSockEvent('WireSock is running as a regular process')).toBeUndefined();
    expect(parseWireSockEvent('[TUN]: Handshake initiation sent to WireGuard server')).toBeUndefined();
    expect(parseWireSockEvent('[MGR]: Tunnel has started')).toBeUndefined();
  });
  it('accepts the actual SDK JSON handshake response', () => {
    expect(parseWireSockEvent('2026-11-11 12:00:00 {"log_level":"info","message":"[TUN]: Handshake response received from 192.0.2.1 : 51820"}')).toEqual({ type: 'handshake' });
  });
  it('surfaces driver failures and CLI argument errors even when exit code is zero', () => {
    expect(parseWireSockEvent('Failed to run WireSock service: Windows Packet Filter driver is not available!')).toMatchObject({ type: 'error' });
    expect(parseWireSockEvent('Unknown parameter: -bad')).toMatchObject({ type: 'error' });
  });
  it('redacts key material from errors', () => {
    expect(parseWireSockEvent('{"log_level":"error","message":"Invalid PrivateKey = fictional-secret"}')).toEqual({ type: 'error', message: 'Invalid [key omitted]' });
  });
});
