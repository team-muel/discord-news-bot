import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsertFn = vi.fn().mockResolvedValue({ error: null });
const mockSelectChain = vi.fn();

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({
    from: () => ({
      insert: mockInsertFn,
      select: () => ({
        eq: () => ({
          gte: (col: string, val: string) => {
            // Distribution query ends at .gte(); stats query chains further
            return {
              then: (resolve: Function) => mockSelectChain().then(resolve),
              catch: (fn: Function) => mockSelectChain().catch(fn),
              order: () => ({
                limit: () => mockSelectChain(),
              }),
            };
          },
          order: () => ({
            limit: () => mockSelectChain(),
          }),
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mockInsertFn.mockClear().mockResolvedValue({ error: null });
  mockSelectChain.mockClear().mockResolvedValue({ data: [], error: null });
});

const loadModule = async (envOverrides: Record<string, string> = {}) => {
  for (const [key, value] of Object.entries(envOverrides)) {
    process.env[key] = value;
  }
  const mod = await import('./trafficRoutingService');
  for (const key of Object.keys(envOverrides)) {
    delete process.env[key];
  }
  return mod;
};

describe('trafficRoutingService', () => {
  it('resolveTrafficRoute returns main when disabled', async () => {
    const mod = await loadModule({ TRAFFIC_ROUTING_ENABLED: 'false' });
    const decision = await mod.resolveTrafficRoute({
      sessionId: 'test-session-1',
      guildId: 'guild-1',
      priority: 'balanced',
      gotCutoverDecision: {
        guildId: 'guild-1',
        allowed: true,
        readinessRecommended: true,
        rolloutPercentage: 100,
        selectedByRollout: true,
        reason: 'test',
        failedReasons: [],
        evaluatedAt: new Date().toISOString(),
        windowDays: 14,
      },
    });

    expect(decision.route).toBe('main');
    expect(decision.reason).toBe('traffic_routing_disabled');
  });

  it('resolveTrafficRoute returns shadow when dashboard not ready', async () => {
    const mod = await loadModule({ TRAFFIC_ROUTING_ENABLED: 'true', TRAFFIC_ROUTING_MODE: 'shadow' });
    const decision = await mod.resolveTrafficRoute({
      sessionId: 'test-session-2',
      guildId: 'guild-1',
      priority: 'balanced',
      gotCutoverDecision: {
        guildId: 'guild-1',
        allowed: false,
        readinessRecommended: false,
        rolloutPercentage: 100,
        selectedByRollout: true,
        reason: 'dashboard_not_ready',
        failedReasons: ['min_reward_not_met'],
        evaluatedAt: new Date().toISOString(),
        windowDays: 14,
      },
    });

    expect(decision.route).toBe('shadow');
    expect(decision.reason).toContain('got_dashboard_not_ready');
    expect(decision.readinessRecommended).toBe(false);
  });

  it('resolveTrafficRoute returns shadow on rollout holdout', async () => {
    const mod = await loadModule({ TRAFFIC_ROUTING_ENABLED: 'true' });
    const decision = await mod.resolveTrafficRoute({
      sessionId: 'test-session-3',
      guildId: 'guild-1',
      priority: 'fast',
      gotCutoverDecision: {
        guildId: 'guild-1',
        allowed: false,
        readinessRecommended: true,
        rolloutPercentage: 10,
        selectedByRollout: false,
        reason: 'rollout_holdout',
        failedReasons: ['rollout_holdout'],
        evaluatedAt: new Date().toISOString(),
        windowDays: 14,
      },
    });

    expect(decision.route).toBe('shadow');
    expect(decision.reason).toBe('rollout_holdout');
  });

  it('resolveTrafficRoute returns shadow on insufficient samples', async () => {
    const mod = await loadModule({
      TRAFFIC_ROUTING_ENABLED: 'true',
      TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES: '50',
    });

    mockSelectChain.mockResolvedValue({ data: [], error: null });

    const decision = await mod.resolveTrafficRoute({
      sessionId: 'test-session-4',
      guildId: 'guild-1',
      priority: 'balanced',
      gotCutoverDecision: {
        guildId: 'guild-1',
        allowed: true,
        readinessRecommended: true,
        rolloutPercentage: 100,
        selectedByRollout: true,
        reason: 'test',
        failedReasons: [],
        evaluatedAt: new Date().toISOString(),
        windowDays: 14,
      },
    });

    expect(decision.route).toBe('shadow');
    expect(decision.reason).toContain('insufficient_shadow_samples');
  });

  it('persistTrafficRoutingDecision calls supabase insert', async () => {
    const mod = await loadModule();
    await mod.persistTrafficRoutingDecision({
      sessionId: 'sess-1',
      guildId: 'guild-1',
      decision: {
        route: 'shadow',
        reason: 'test_decision',
        gotCutoverAllowed: true,
        rolloutPercentage: 50,
        stableBucket: 25,
        shadowDivergenceRate: 0.1,
        shadowQualityDelta: 0.05,
        readinessRecommended: true,
        policySnapshot: { mode: 'shadow' },
      },
    });

    expect(mockInsertFn).toHaveBeenCalledTimes(1);
    expect(mockInsertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'sess-1',
        guild_id: 'guild-1',
        route: 'shadow',
        reason: 'test_decision',
      }),
    );
  });

  it('getTrafficRouteDistribution returns breakdown', async () => {
    mockSelectChain.mockResolvedValue({
      data: [
        { route: 'main' },
        { route: 'main' },
        { route: 'shadow' },
      ],
      error: null,
    });

    const mod = await loadModule();
    const { distribution, total, error } = await mod.getTrafficRouteDistribution('guild-1', 24);

    expect(error).toBeNull();
    expect(total).toBe(3);
    expect(distribution.main).toBe(2);
    expect(distribution.shadow).toBe(1);
    expect(distribution.langgraph).toBe(0);
  });
});
