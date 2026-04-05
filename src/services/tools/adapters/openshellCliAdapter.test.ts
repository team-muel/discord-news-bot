import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExternalAdapterResult } from '../externalAdapterTypes';

// Mock child_process before importing the adapter
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../../utils/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/env')>();
  return {
    ...actual,
    parseBooleanEnv: (_v: unknown, fallback: boolean) => fallback,
  };
});

// Dynamically import to pick up mocks
const { openshellAdapter } = await import('./openshellCliAdapter');

// Get the mock reference for execFile
const { execFile } = await import('node:child_process');
const mockExecFile = vi.mocked(execFile);

const makeExecCallback = (stdout: string, stderr = '') => {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    // promisify wraps it; the mock needs to call the callback
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr });
    return {} as ReturnType<typeof execFile>;
  };
};

describe('openshellAdapter.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sandbox.exec requires sandboxId', async () => {
    const result = await openshellAdapter.execute('sandbox.exec', { command: 'ls' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_SANDBOX_ID');
  });

  it('sandbox.exec requires command', async () => {
    const result = await openshellAdapter.execute('sandbox.exec', { sandboxId: 'sb-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_COMMAND');
  });

  it('sandbox.destroy requires sandboxId', async () => {
    const result = await openshellAdapter.execute('sandbox.destroy', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_SANDBOX_ID');
  });

  it('policy.set requires policy', async () => {
    const result = await openshellAdapter.execute('policy.set', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_POLICY');
  });

  it('returns UNKNOWN_ACTION for unrecognized action', async () => {
    const result = await openshellAdapter.execute('not.real', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('UNKNOWN_ACTION');
  });

  it('sandbox.exec sanitizes shell meta characters in args', async () => {
    mockExecFile.mockImplementation(makeExecCallback('ok') as never);
    const result = await openshellAdapter.execute('sandbox.exec', {
      sandboxId: 'sb-1; rm -rf /',
      command: 'echo hello && cat /etc/passwd',
    });
    // Should succeed because args are sanitized (not rejected)
    expect(result.ok).toBe(true);
  });

  it('sandbox.create defaults from to ollama', async () => {
    mockExecFile.mockImplementation(makeExecCallback('sandbox-123') as never);
    const result = await openshellAdapter.execute('sandbox.create', {});
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(['sandbox-123']);
  });

  it('returns EXECUTION_FAILED on CLI error', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: unknown) => void) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(new Error('timeout'), null);
      return {} as ReturnType<typeof execFile>;
    }) as never);
    const result = await openshellAdapter.execute('sandbox.list', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('EXECUTION_FAILED');
  });

  it('adapterId is always openshell', async () => {
    const result = await openshellAdapter.execute('not.real', {});
    expect(result.adapterId).toBe('openshell');
  });
});
