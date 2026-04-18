import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSupabaseClientMock,
  isSupabaseConfiguredMock,
} = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('agentWorkflowService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    isSupabaseConfiguredMock.mockReset();
    isSupabaseConfiguredMock.mockReturnValue(true);
    getSupabaseClientMock.mockReset();
    getSupabaseClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                {
                  guild_id: '*',
                  priority: 'balanced',
                  enabled: true,
                  steps: [
                    { role: 'planner', title: 'global planner' },
                    { role: 'researcher', title: 'global researcher' },
                  ],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
  });

  it('cold start에서는 workflow profile이 준비될 때까지 bootstrap fallback을 막는다', async () => {
    const mod = await import('./agentWorkflowService');

    expect(mod.canResolveWorkflowStepTemplates({ guildId: 'guild-a', priority: 'balanced' })).toBe(false);
    expect(mod.getWorkflowProfileLoadingMessage()).toContain('워크플로');

    await flushMicrotasks();

    expect(mod.canResolveWorkflowStepTemplates({ guildId: 'guild-a', priority: 'balanced' })).toBe(true);
    expect(mod.getWorkflowStepTemplates({
      guildId: 'guild-a',
      priority: 'balanced',
      hasRequestedSkill: false,
    })).toEqual([
      {
        role: 'planner',
        title: 'global planner',
        skipWhenFast: false,
        skipWhenRequestedSkill: false,
      },
      {
        role: 'researcher',
        title: 'global researcher',
        skipWhenFast: false,
        skipWhenRequestedSkill: false,
      },
    ]);
  });

  it('stale guild-specific workflow는 refresh 전에도 계속 사용할 수 있다', async () => {
    vi.stubEnv('AGENT_WORKFLOW_CACHE_TTL_MS', '5000');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));
    getSupabaseClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                {
                  guild_id: 'guild-a',
                  priority: 'balanced',
                  enabled: true,
                  steps: [{ role: 'critic', title: 'guild critic' }],
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const mod = await import('./agentWorkflowService');
    mod.primeWorkflowProfileCache();
    await flushMicrotasks();

    vi.setSystemTime(new Date('2026-04-18T00:00:06.000Z'));

    expect(mod.canResolveWorkflowStepTemplates({ guildId: 'guild-a', priority: 'balanced' })).toBe(true);
    expect(mod.canResolveWorkflowStepTemplates({ guildId: 'guild-b', priority: 'balanced' })).toBe(false);

    vi.useRealTimers();
  });
});