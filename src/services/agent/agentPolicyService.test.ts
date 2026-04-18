import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getSupabaseClientMock,
  isSupabaseConfiguredMock,
  listSkillsMock,
} = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  listSkillsMock: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

vi.mock('../skills/registry', () => ({
  listSkills: listSkillsMock,
}));

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('agentPolicyService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    listSkillsMock.mockReset();
    listSkillsMock.mockReturnValue([]);
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
                  max_concurrent_sessions: 2,
                  max_goal_length: 200,
                  restricted_skills: [],
                  enabled: true,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
  });

  it('cold start에서는 guild policy가 준비될 때까지 요청을 fail-closed 한다', async () => {
    const mod = await import('./agentPolicyService');

    expect(mod.canResolveAgentPolicyForGuild('guild-a')).toBe(false);
    expect(mod.validateAgentSessionRequest({
      guildId: 'guild-a',
      runningSessions: 0,
      goal: 'run a task',
      requestedSkillId: null,
      isAdmin: false,
    })).toEqual({
      ok: false,
      message: mod.getAgentPolicyLoadingMessage(),
    });

    await flushMicrotasks();

    expect(mod.canResolveAgentPolicyForGuild('guild-a')).toBe(true);
    expect(mod.validateAgentSessionRequest({
      guildId: 'guild-a',
      runningSessions: 1,
      goal: 'run a task',
      requestedSkillId: null,
      isAdmin: false,
    })).toEqual({
      ok: true,
      message: 'OK',
    });
  });

  it('stale guild-scoped cache row가 있으면 refresh 중에도 해당 guild는 계속 검증할 수 있다', async () => {
    vi.stubEnv('AGENT_POLICY_CACHE_TTL_MS', '5000');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));
    getSupabaseClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({
              data: [
                {
                  guild_id: '*',
                  max_concurrent_sessions: 3,
                  max_goal_length: 200,
                  restricted_skills: [],
                  enabled: true,
                },
                {
                  guild_id: 'guild-a',
                  max_concurrent_sessions: 1,
                  max_goal_length: 80,
                  restricted_skills: [],
                  enabled: true,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });

    const mod = await import('./agentPolicyService');
    mod.primeAgentPolicyCache();
    await flushMicrotasks();

    vi.setSystemTime(new Date('2026-04-18T00:00:06.000Z'));

    expect(mod.canResolveAgentPolicyForGuild('guild-a')).toBe(true);
    expect(mod.canResolveAgentPolicyForGuild('guild-b')).toBe(false);

    vi.useRealTimers();
  });
});