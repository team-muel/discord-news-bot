import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('mcpDelegate role worker mapping', () => {
  it('role worker URL env를 반환한다', async () => {
    vi.stubEnv('MCP_OPENDEV_WORKER_URL', 'http://127.0.0.1:9001/');
    vi.stubEnv('MCP_NEMOCLAW_WORKER_URL', 'http://127.0.0.1:9002');
    vi.stubEnv('MCP_OPENJARVIS_WORKER_URL', 'http://127.0.0.1:9003');
    vi.stubEnv('MCP_LOCAL_ORCHESTRATOR_WORKER_URL', 'http://127.0.0.1:9004');

    const mod = await import('./mcpDelegate');

    expect(mod.getMcpWorkerUrl('opendev')).toBe('http://127.0.0.1:9001');
    expect(mod.getMcpWorkerUrl('nemoclaw')).toBe('http://127.0.0.1:9002');
    expect(mod.getMcpWorkerUrl('openjarvis')).toBe('http://127.0.0.1:9003');
    expect(mod.getMcpWorkerUrl('local-orchestrator')).toBe('http://127.0.0.1:9004');
  });

  it('neutral role worker env aliases도 반환한다', async () => {
    vi.stubEnv('MCP_ARCHITECT_WORKER_URL', 'http://127.0.0.1:9101/');
    vi.stubEnv('MCP_REVIEW_WORKER_URL', 'http://127.0.0.1:9102');
    vi.stubEnv('MCP_OPERATE_WORKER_URL', 'http://127.0.0.1:9103');
    vi.stubEnv('MCP_COORDINATE_WORKER_URL', 'http://127.0.0.1:9104');

    const mod = await import('./mcpDelegate');

    expect(mod.getMcpWorkerUrl('architect')).toBe('http://127.0.0.1:9101');
    expect(mod.getMcpWorkerUrl('review')).toBe('http://127.0.0.1:9102');
    expect(mod.getMcpWorkerUrl('operate')).toBe('http://127.0.0.1:9103');
    expect(mod.getMcpWorkerUrl('coordinate')).toBe('http://127.0.0.1:9104');
  });
});