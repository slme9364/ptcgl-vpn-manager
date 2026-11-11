import { describe, expect, it } from 'vitest';
import { normalizeVmStatus } from './index';
describe('normalizeVmStatus', () => {
  it('accepts known Compute states', () => expect(normalizeVmStatus('RUNNING')).toBe('RUNNING'));
  it('maps the Compute stopped state', () => expect(normalizeVmStatus('TERMINATED')).toBe('STOPPED'));
  it('does not expose unexpected API values', () => expect(normalizeVmStatus('SUSPENDED')).toBe('UNKNOWN'));
});
