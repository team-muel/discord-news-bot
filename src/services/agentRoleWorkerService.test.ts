import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('agentRoleWorkerService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('configured worker URLs are surfaced in specs', async () => {
    vi.stubEnv('MCP_OPENDEV_WORKER_URL', 'http://127.0.0.1:8791');
    vi.stubEnv('MCP_NEMOCLAW_WORKER_URL', 'http://127.0.0.1:8792');

    const mod = await import('./agentRoleWorkerService');
    const specs = mod.listAgentRoleWorkerSpecs();

    expect(specs.find((item) => item.id === 'opendev')?.url).toBe('http://127.0.0.1:8791');
    expect(specs.find((item) => item.id === 'nemoclaw')?.url).toBe('http://127.0.0.1:8792');
  });

  it('neutral worker env aliases are also accepted', async () => {
    vi.stubEnv('MCP_ARCHITECT_WORKER_URL', 'http://127.0.0.1:9791');
    vi.stubEnv('MCP_OPERATE_WORKER_URL', 'http://127.0.0.1:9793');

    const mod = await import('./agentRoleWorkerService');
    const specs = mod.listAgentRoleWorkerSpecs();

    expect(specs.find((item) => item.id === 'opendev')?.url).toBe('http://127.0.0.1:9791');
    expect(specs.find((item) => item.id === 'openjarvis')?.url).toBe('http://127.0.0.1:9793');
  });
});