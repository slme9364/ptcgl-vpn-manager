import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  exec: vi.fn(), mkdir: vi.fn(), open: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), order: [] as string[]
}));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => undefined, { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec })
}));
vi.mock('node:fs', () => ({ promises: {
  mkdir: mocks.mkdir, open: mocks.open, readFile: mocks.readFile, writeFile: mocks.writeFile
} }));
import { stageWindowsConfig } from './windows-config';

describe('Windows LocalSystem configuration staging', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.order.length = 0;
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.open.mockResolvedValue({ close: async () => undefined });
    mocks.exec.mockImplementation(async () => { mocks.order.push('acl'); return { stdout: '', stderr: '' }; });
    mocks.readFile.mockImplementation(async () => { mocks.order.push('read'); return Buffer.from('fictional-private-config'); });
    mocks.writeFile.mockImplementation(async () => { mocks.order.push('write'); });
  });
  it('restricts the service file to its owner, SYSTEM and Administrators before copying a key', async () => {
    const target = await stageWindowsConfig('client.conf');
    expect(target).toContain('PTCGL-VPN-Manager');
    expect(mocks.order).toEqual(['acl', 'read', 'write']);
    const [program, args] = mocks.exec.mock.calls[0]!;
    expect(program).toBe('powershell.exe');
    const command = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    expect(command).toContain('S-1-5-18');
    expect(command).toContain('S-1-5-32-544');
    expect(command).toContain('SetAccessRuleProtection($true,$false)');
    expect(command).not.toContain('fictional-private-config');
  });
  it('does not read or copy a private key when ACL setup fails', async () => {
    mocks.exec.mockRejectedValueOnce(new Error('Access denied'));
    await expect(stageWindowsConfig('client.conf')).rejects.toThrow('Access denied');
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
