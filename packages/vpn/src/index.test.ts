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
