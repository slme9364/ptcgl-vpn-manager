import { describe, expect, it } from 'vitest';
import { validateDeployment } from './terraform';

const valid = { projectId: 'ptcgl-vpn-example1', region: 'us-west1', zone: 'us-west1-b', deploymentId: 'usw1', instanceName: 'ptcgl-vpn', maxRuntimeMinutes: 240, clientPublicKey: 'A'.repeat(43) + '=', clientAddress: '10.66.0.2/32' };
describe('validateDeployment', () => {
  it('accepts a constrained regional deployment', () => expect(() => validateDeployment(valid)).not.toThrow());
  it('rejects mismatched zones', () => expect(() => validateDeployment({ ...valid, zone: 'us-east1-b' })).toThrow());
  it('rejects injected identifiers', () => expect(() => validateDeployment({ ...valid, deploymentId: '../bad' })).toThrow());
});
