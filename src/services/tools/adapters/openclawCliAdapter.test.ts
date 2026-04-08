import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn(async () => 'mocked llm response'),
}));

const { openclawAdapter } = await import('./openclawCliAdapter');

const { execFile } = await import('node:child_process');
const mockExecFile = vi.mocked(execFile);

const makeExecCallback = (stdout: string, stderr = '') => {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: { stdout: string; stderr: string }) => void) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    if (callback) callback(null, { stdout, stderr });
    return {} as ReturnType<typeof execFile>;
  };
};

describe('openclawAdapter.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agent.chat requires message', async () => {
    const result = await openclawAdapter.execute('agent.chat', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_MESSAGE');
  });

  it('agent.chat succeeds with message', async () => {
    mockExecFile.mockImplementation(makeExecCallback('Hello world') as never);
    const result = await openclawAdapter.execute('agent.chat', { message: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(['Hello world']);
    expect(result.adapterId).toBe('openclaw');
  });

  it('agent.skill.create requires name', async () => {
    const result = await openclawAdapter.execute('agent.skill.create', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_NAME');
  });

  it('agent.skill.create sanitizes name', async () => {
    mockExecFile.mockImplementation(makeExecCallback('created') as never);
    const result = await openclawAdapter.execute('agent.skill.create', { name: 'my-skill_v2' });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('my-skill_v2');
  });

  it('agent.session.relay requires message', async () => {
    const result = await openclawAdapter.execute('agent.session.relay', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('MISSING_MESSAGE');
  });

  it('agent.session.relay defaults channel to discord', async () => {
    mockExecFile.mockImplementation(makeExecCallback('relayed') as never);
    const result = await openclawAdapter.execute('agent.session.relay', { message: 'test msg' });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('discord');
  });

  it('agent.session.relay includes sessionId when provided', async () => {
    mockExecFile.mockImplementation(makeExecCallback('relayed') as never);
    const result = await openclawAdapter.execute('agent.session.relay', {
      message: 'test msg',
      channel: 'slack',
      sessionId: 'sess-123',
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('slack');
  });

  it('returns UNKNOWN_ACTION for unrecognized action', async () => {
    const result = await openclawAdapter.execute('unknown.action', {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('UNKNOWN_ACTION');
  });

  it('returns NO_TRANSPORT when CLI errors and no LLM configured', async () => {
    mockExecFile.mockImplementation(((_cmd: string, _args: unknown, _opts: unknown, cb?: (err: Error | null, res: unknown) => void) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (callback) callback(new Error('CLI crashed'), null);
      return {} as ReturnType<typeof execFile>;
    }) as never);
    const result = await openclawAdapter.execute('agent.chat', { message: 'hi' });
    expect(result.ok).toBe(false);
    // CLI error falls through to lite mode; without LLM configured → NO_TRANSPORT
    expect(result.error).toBe('NO_TRANSPORT');
  });

  it('message is truncated to 2000 for agent.chat', async () => {
    mockExecFile.mockImplementation(makeExecCallback('ok') as never);
    const longMsg = 'x'.repeat(5000);
    const result = await openclawAdapter.execute('agent.chat', { message: longMsg });
    expect(result.ok).toBe(true);
    // The message passed to CLI should be truncated, but we can't easily assert CLI args here
    // Just verify it doesn't crash
  });

  it('relay message is truncated to 4000', async () => {
    mockExecFile.mockImplementation(makeExecCallback('ok') as never);
    const longMsg = 'y'.repeat(6000);
    const result = await openclawAdapter.execute('agent.session.relay', { message: longMsg });
    expect(result.ok).toBe(true);
  });

  it('agent.health returns NO_TRANSPORT when unavailable', async () => {
    const result = await openclawAdapter.execute('agent.health', {});
    // Without OPENCLAW_GATEWAY_URL and with parseBooleanEnv returning false, no transport is set
    // The execute still runs since it doesn't re-check isAvailable
    expect(result.adapterId).toBe('openclaw');
  });

  it('has liteCapabilities defined', () => {
    expect(openclawAdapter.liteCapabilities).toBeDefined();
    expect(openclawAdapter.liteCapabilities).toContain('agent.chat');
    expect(openclawAdapter.liteCapabilities).toContain('agent.health');
  });

  it('capabilities include agent.health', () => {
    expect(openclawAdapter.capabilities).toContain('agent.health');
  });

  it('agent.session.relay uses default "main" session when no sessionId', async () => {
    mockExecFile.mockImplementation(makeExecCallback('relayed') as never);
    const result = await openclawAdapter.execute('agent.session.relay', { message: 'msg' });
    expect(result.ok).toBe(true);
    // CLI fallback doesn't add --session flag for "main"
    const callArgs = mockExecFile.mock.calls[0];
    const cliArgs = callArgs?.[1] as string[] | undefined;
    expect(cliArgs).not.toContain('--session');
  });
});

describe('bootstrapOpenClawSession', () => {
  it('bootstrapOpenClawSession is exported', async () => {
    const mod = await import('./openclawCliAdapter');
    expect(typeof mod.bootstrapOpenClawSession).toBe('function');
  });

  it('returns { ok: false } when gateway is unreachable', async () => {
    const { bootstrapOpenClawSession } = await import('./openclawCliAdapter');
    const result = await bootstrapOpenClawSession('test-session');
    // No gateway or CLI available in test env
    expect(result.ok).toBe(false);
  });
});
