import { describe, expect, it } from 'vitest';
import { addWireSockAllowedApp, updateClientAddress, updateEndpoint } from './index';
describe('updateEndpoint', () => {
  it('changes only Endpoint', () => {
    const input = '[Interface]\nPrivateKey = secret\n[Peer]\nEndpoint = 1.1.1.1:51820\n';
    expect(updateEndpoint(input, '2.2.2.2')).toContain('PrivateKey = secret\n[Peer]\nEndpoint = 2.2.2.2:51820');
  });
  it('rejects command-like input', () => expect(() => updateEndpoint('Endpoint = old', '1.2.3.4;rm')).toThrow());
  it('rejects out-of-range IPv4', () => expect(() => updateEndpoint('Endpoint = old', '999.2.3.4')).toThrow());
});
describe('updateClientAddress', () => {
  it('updates only the interface address', () => expect(updateClientAddress('[Interface]\nAddress = 10.66.0.2/32\n', '10.66.0.3/32')).toContain('Address = 10.66.0.3/32'));
  it('rejects the server address', () => expect(() => updateClientAddress('[Interface]\nAddress = old\n', '10.66.0.1/32')).toThrow());
});
describe('addWireSockAllowedApp', () => {
  it('adds one application without changing the private key', () => {
    const output = addWireSockAllowedApp('[Interface]\nPrivateKey = secret\n[Peer]\nPublicKey = pub\n', 'C:\\Games\\PTCGL.exe');
    expect(output).toContain('AllowedApps = C:\\Games\\PTCGL.exe'); expect(output).toContain('PrivateKey = secret');
  });
  it('rejects config injection', () => expect(() => addWireSockAllowedApp('[Interface]\n', 'game.exe\nDisallowedApps=*')).toThrow());
});

describe('reconnection with unchanged settings', () => {
  it('accepts an already current endpoint', () => {
    const config = '[Peer]\nEndpoint = 192.0.2.1:51820\n';
    expect(updateEndpoint(config, '192.0.2.1')).toBe(config);
  });
  it('accepts an already current client address', () => {
    const config = '[Interface]\nAddress = 10.66.0.3/32\n';
    expect(updateClientAddress(config, '10.66.0.3/32')).toBe(config);
  });
  it('still rejects an actually missing endpoint', () => {
    expect(() => updateEndpoint('[Peer]\n', '192.0.2.1')).toThrow('no Endpoint');
  });
  it('places the exact allowed executable under Peer and preserves system DNS', () => {
    const config = '[Interface]\nPrivateKey = secret\nDNS = 1.1.1.1\nAllowedApps = chrome.exe\n[Peer]\nPublicKey = server\n';
    const output = addWireSockAllowedApp(config, 'D:\\Games\\Pokemon TCG Live.exe');
    expect(output.split('[Peer]')[0]).not.toContain('AllowedApps');
    expect(output.split('[Peer]')[1]).toContain('#@ws:AllowedApps = D:\\Games\\Pokemon TCG Live.exe');
    expect(output).not.toContain('DNS =');
    expect(output).not.toContain('chrome.exe');
    expect(output).toContain('PrivateKey = secret');
  });
});
