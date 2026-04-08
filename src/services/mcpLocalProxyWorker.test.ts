import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock mcpSkillRouter to avoid side effects
vi.mock('./mcpSkillRouter', () => ({
  registerWorkerDirect: vi.fn(),
}));

describe('mcpLocalProxyWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('registers local proxy when /api/mcp/tools responds', async () => {
    const mockTools = [{ name: 'tool-a' }, { name: 'tool-b' }, { name: 'tool-c' }];

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => mockTools,
    })));

    const { registerLocalMcpProxy } = await import('./mcpLocalProxyWorker');
    const { registerWorkerDirect } = await import('./mcpSkillRouter');

    await registerLocalMcpProxy(3000);

    expect(registerWorkerDirect).toHaveBeenCalledWith(
      'local-proxy',
      'http://127.0.0.1:3000/api/mcp/rpc',
      ['tool-a', 'tool-b', 'tool-c'],
    );

    vi.unstubAllGlobals();
  });

  it('skips registration when /api/mcp/tools returns non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
    })));

    const { registerLocalMcpProxy } = await import('./mcpLocalProxyWorker');
    const { registerWorkerDirect } = await import('./mcpSkillRouter');

    await registerLocalMcpProxy(3000);

    expect(registerWorkerDirect).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('skips registration when fetch throws (server not started)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));

    const { registerLocalMcpProxy } = await import('./mcpLocalProxyWorker');
    const { registerWorkerDirect } = await import('./mcpSkillRouter');

    // Should not throw
    await registerLocalMcpProxy(3000);

    expect(registerWorkerDirect).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
