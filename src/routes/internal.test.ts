import { Router, type RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEvaluateGuildSloAndPersistAlerts,
  mockRunAgentSloAlertLoopOnce,
  mockExecuteEvalAutoPromoteLoop,
  mockExecuteRetrievalEvalLoop,
  mockExecuteRewardSignalLoop,
  mockExecuteDiscordIngress,
  mockFindDiscordIngressRolloutKey,
  mockGetDiscordIngressCutoverSnapshot,
  mockGetSupabaseClient,
  mockIsSupabaseConfigured,
  mockPrimeDiscordIngressCutoverPolicy,
  mockEvaluateIntents,
  mockResolveDiscordIngressEffectivePolicy,
  mockRunConsolidationCycle,
  mockRequeueDeadletterJob,
  mockExecuteObsidianLoreSync,
  mockExecuteObsidianGraphAudit,
  mockSetDiscordIngressRuntimePolicyOverride,
} = vi.hoisted(() => ({
  mockEvaluateGuildSloAndPersistAlerts: vi.fn(),
  mockRunAgentSloAlertLoopOnce: vi.fn(),
  mockExecuteEvalAutoPromoteLoop: vi.fn(),
  mockExecuteRetrievalEvalLoop: vi.fn(),
  mockExecuteRewardSignalLoop: vi.fn(),
  mockExecuteDiscordIngress: vi.fn(),
  mockFindDiscordIngressRolloutKey: vi.fn(),
  mockGetDiscordIngressCutoverSnapshot: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
  mockIsSupabaseConfigured: vi.fn(() => true),
  mockPrimeDiscordIngressCutoverPolicy: vi.fn(),
  mockEvaluateIntents: vi.fn(),
  mockResolveDiscordIngressEffectivePolicy: vi.fn(),
  mockRunConsolidationCycle: vi.fn(),
  mockRequeueDeadletterJob: vi.fn(),
  mockExecuteObsidianLoreSync: vi.fn(),
  mockExecuteObsidianGraphAudit: vi.fn(),
  mockSetDiscordIngressRuntimePolicyOverride: vi.fn(),
}));

vi.mock('../config', () => ({
  DISCORD_DOCS_INGRESS_ADAPTER: 'openclaw',
  DISCORD_DOCS_INGRESS_HARD_DISABLE: false,
  DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT: 100,
  DISCORD_DOCS_INGRESS_SHADOW_MODE: false,
  DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER: 'openclaw',
  DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE: false,
  DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT: 100,
  DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE: false,
  NODE_ENV: 'production',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
}));

vi.mock('../discord/runtime/discordIngressAdapter', () => ({
  executeDiscordIngress: mockExecuteDiscordIngress,
  findDiscordIngressRolloutKey: mockFindDiscordIngressRolloutKey,
  getDiscordIngressCutoverSnapshot: mockGetDiscordIngressCutoverSnapshot,
  primeDiscordIngressCutoverPolicy: mockPrimeDiscordIngressCutoverPolicy,
  resolveDiscordIngressEffectivePolicy: mockResolveDiscordIngressEffectivePolicy,
  setDiscordIngressRuntimePolicyOverride: mockSetDiscordIngressRuntimePolicyOverride,
}));

vi.mock('../services/agent/agentSloService', () => ({
  evaluateGuildSloAndPersistAlerts: mockEvaluateGuildSloAndPersistAlerts,
  runAgentSloAlertLoopOnce: mockRunAgentSloAlertLoopOnce,
}));

vi.mock('../services/eval/evalMaintenanceControlService', () => ({
  executeEvalAutoPromoteLoop: mockExecuteEvalAutoPromoteLoop,
  executeRetrievalEvalLoop: mockExecuteRetrievalEvalLoop,
  executeRewardSignalLoop: mockExecuteRewardSignalLoop,
}));

vi.mock('../services/intent/intentFormationEngine', () => ({
  evaluateIntents: mockEvaluateIntents,
}));

vi.mock('../services/memory/memoryConsolidationService', () => ({
  runConsolidationCycle: mockRunConsolidationCycle,
}));

vi.mock('../services/memory/memoryJobRunner', () => ({
  requeueDeadletterJob: mockRequeueDeadletterJob,
}));

vi.mock('../services/obsidian/obsidianMaintenanceControlService', () => ({
  executeObsidianLoreSync: mockExecuteObsidianLoreSync,
  executeObsidianGraphAudit: mockExecuteObsidianGraphAudit,
}));

vi.mock('../services/supabaseClient', () => ({
  getSupabaseClient: mockGetSupabaseClient,
  isSupabaseConfigured: mockIsSupabaseConfigured,
}));

import { createInternalRouter } from './internal';

type RouteLayer = {
  route?: {
    path?: string;
    methods?: Record<string, boolean>;
    stack?: Array<{ handle: RequestHandler }>;
  };
};

const createJsonResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };

  return response;
};

const invokeRoute = async (router: Router, method: string, path: string, reqOverrides: Record<string, unknown> = {}) => {
  const stack = (router as unknown as { stack?: RouteLayer[] }).stack || [];
  const routeLayer = stack.find((layer) => layer.route?.path === path && layer.route.methods?.[method.toLowerCase()]);
  if (!routeLayer?.route?.stack) {
    throw new Error(`Route not found: ${method} ${path}`);
  }

  const req = {
    method,
    query: {},
    body: {},
    params: {},
    headers: {},
    ...reqOverrides,
  } as any;
  const res = createJsonResponse();

  for (const layer of routeLayer.route.stack) {
    let nextCalled = false;
    const next = (error?: unknown) => {
      if (error) {
        throw error;
      }
      nextCalled = true;
    };

    const result = (layer.handle as unknown as (...args: unknown[]) => unknown)(req, res as any, next);
    if (typeof result === 'object' && result !== null && 'then' in result && typeof (result as Promise<unknown>).then === 'function') {
      await (result as Promise<unknown>);
    }
    if (!nextCalled) {
      break;
    }
  }

  return res;
};

describe('internal routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);
    mockRunConsolidationCycle.mockResolvedValue({ processed: 1 });
    mockRunAgentSloAlertLoopOnce.mockResolvedValue({ processedGuilds: 2 });
    mockEvaluateGuildSloAndPersistAlerts.mockResolvedValue({ alerts: [] });
    mockExecuteObsidianLoreSync.mockResolvedValue({ lastStatus: 'success' });
    mockExecuteObsidianGraphAudit.mockResolvedValue({ result: { lastStatus: 'success' }, snapshot: null });
    mockExecuteRetrievalEvalLoop.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0, appliedTunings: 0 });
    mockExecuteRewardSignalLoop.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0 });
    mockExecuteEvalAutoPromoteLoop.mockResolvedValue({ attemptedGuilds: 1, completedGuilds: 1, failedGuilds: 0, totalCollected: 0, totalJudged: 0, totalPromoted: 0, totalRejected: 0 });
    mockEvaluateIntents.mockResolvedValue([]);
    mockFindDiscordIngressRolloutKey.mockReturnValue('selected-key');
    mockResolveDiscordIngressEffectivePolicy.mockReturnValue({
      preferredAdapterId: 'chat-sdk',
      hardDisable: false,
      shadowMode: false,
      rolloutPercentage: 25,
      mode: 'canary',
      lastUpdatedAt: '2026-04-17T00:00:00.000Z',
    });
    mockGetDiscordIngressCutoverSnapshot.mockReturnValue({
      policyBySurface: {
        'docs-command': {
          preferredAdapterId: 'chat-sdk',
          hardDisable: false,
          shadowMode: false,
          rolloutPercentage: 25,
          mode: 'canary',
          lastUpdatedAt: '2026-04-17T00:00:00.000Z',
        },
        'muel-message': {
          preferredAdapterId: 'chat-sdk',
          hardDisable: false,
          shadowMode: false,
          rolloutPercentage: 25,
          mode: 'canary',
          lastUpdatedAt: '2026-04-17T00:00:00.000Z',
        },
      },
      totals: {
        total: 3,
      },
      totalsBySource: {
        live: { total: 3 },
        lab: { total: 0 },
      },
      rollback: {
        active: false,
        forcedFallbackCount: 1,
        forcedFallbackCountBySource: {
          live: 1,
          lab: 0,
        },
        lastForcedFallbackAt: '2026-04-17T00:00:01.000Z',
        lastForcedFallbackSurface: 'docs-command',
        lastForcedFallbackSource: 'live',
      },
      surfaces: {
        'docs-command': {
          total: 2,
          selectedByRolloutCount: 2,
          adapterAcceptCount: 1,
          shadowOnlyCount: 0,
          legacyFallbackCount: 1,
          holdoutCount: 0,
          lastDecisionAt: '2026-04-17T00:00:01.000Z',
          lastTelemetry: null,
          bySource: {
            live: {
              total: 2,
              selectedByRolloutCount: 2,
              adapterAcceptCount: 1,
              shadowOnlyCount: 0,
              legacyFallbackCount: 1,
              holdoutCount: 0,
            },
            lab: {
              total: 0,
              selectedByRolloutCount: 0,
              adapterAcceptCount: 0,
              shadowOnlyCount: 0,
              legacyFallbackCount: 0,
              holdoutCount: 0,
            },
          },
        },
        'muel-message': {
          total: 1,
          selectedByRolloutCount: 1,
          adapterAcceptCount: 1,
          shadowOnlyCount: 0,
          legacyFallbackCount: 0,
          holdoutCount: 0,
          lastDecisionAt: '2026-04-17T00:00:01.000Z',
          lastTelemetry: null,
          bySource: {
            live: {
              total: 1,
              selectedByRolloutCount: 1,
              adapterAcceptCount: 1,
              shadowOnlyCount: 0,
              legacyFallbackCount: 0,
              holdoutCount: 0,
            },
            lab: {
              total: 0,
              selectedByRolloutCount: 0,
              adapterAcceptCount: 0,
              shadowOnlyCount: 0,
              legacyFallbackCount: 0,
              holdoutCount: 0,
            },
          },
        },
      },
      recentEvents: [],
      eligibleSurfaces: ['docs-command', 'muel-message'],
      generatedAt: '2026-04-17T00:00:01.000Z',
    });
    mockExecuteDiscordIngress
      .mockResolvedValueOnce({
        telemetry: {
          routeDecision: 'adapter_accept',
          fallbackReason: null,
          selectedByRollout: true,
          selectedAdapterId: 'chat-sdk',
          adapterId: 'chat-sdk',
        },
      })
      .mockResolvedValueOnce({
        telemetry: {
          routeDecision: 'adapter_accept',
          fallbackReason: null,
          selectedByRollout: true,
          selectedAdapterId: 'chat-sdk',
          adapterId: 'chat-sdk',
        },
      })
      .mockResolvedValueOnce({
        telemetry: {
          routeDecision: 'legacy_fallback',
          fallbackReason: 'hard_disabled',
          selectedByRollout: true,
          selectedAdapterId: 'chat-sdk',
          adapterId: null,
        },
      });
    mockRequeueDeadletterJob.mockResolvedValue({ ok: true });
    mockGetSupabaseClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      })),
    });
  });

  it('registers all pg_cron internal endpoints', () => {
    const router = createInternalRouter();
    const stack = (router as unknown as { stack?: RouteLayer[] }).stack || [];
    const routeKeys = new Set(
      stack
        .filter((layer) => layer.route?.path && layer.route.methods)
        .flatMap((layer) =>
          Object.keys(layer.route?.methods || {})
            .filter((method) => layer.route?.methods?.[method])
            .map((method) => `${method.toUpperCase()} ${String(layer.route?.path)}`),
        ),
    );

    expect(routeKeys.has('POST /memory/consolidate')).toBe(true);
    expect(routeKeys.has('POST /memory/deadletter-recover')).toBe(true);
    expect(routeKeys.has('GET /discord/ingress/cutover/snapshot')).toBe(true);
    expect(routeKeys.has('POST /discord/ingress/cutover/policy')).toBe(true);
    expect(routeKeys.has('POST /discord/ingress/cutover/exercise')).toBe(true);
    expect(routeKeys.has('POST /slo/check')).toBe(true);
    expect(routeKeys.has('POST /obsidian/sync')).toBe(true);
    expect(routeKeys.has('POST /obsidian/audit')).toBe(true);
    expect(routeKeys.has('POST /eval/retrieval')).toBe(true);
    expect(routeKeys.has('POST /eval/reward-signal')).toBe(true);
    expect(routeKeys.has('POST /eval/auto-promote')).toBe(true);
    expect(routeKeys.has('POST /intent/evaluate')).toBe(true);
  });

  it('rejects requests without the internal bearer token', async () => {
    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/eval/retrieval');

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    expect(mockExecuteRetrievalEvalLoop).not.toHaveBeenCalled();
  });

  it('dispatches retrieval eval for an explicitly requested guild without querying sources', async () => {
    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/eval/retrieval', {
      headers: { authorization: 'Bearer service-role' },
      body: { guildId: 'guild-1' },
    });

    expect(res.statusCode).toBe(202);
    expect(mockExecuteRetrievalEvalLoop).toHaveBeenCalledWith(['guild-1']);
    expect(res.body).toMatchObject({ ok: true, processedGuilds: 1, guildIds: ['guild-1'] });
    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  it('requeues only pending memory deadletters through the internal recovery route', async () => {
    const from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 11 }, { id: 12 }],
        error: null,
      }),
    }));
    mockGetSupabaseClient.mockReturnValue({ from });

    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/memory/deadletter-recover', {
      headers: { authorization: 'Bearer service-role' },
    });

    expect(res.statusCode).toBe(202);
    expect(mockRequeueDeadletterJob).toHaveBeenCalledTimes(2);
    expect(mockRequeueDeadletterJob).toHaveBeenNthCalledWith(1, { deadletterId: 11, actorId: 'system:pg-cron' });
    expect(mockRequeueDeadletterJob).toHaveBeenNthCalledWith(2, { deadletterId: 12, actorId: 'system:pg-cron' });
    expect(res.body).toMatchObject({ ok: true, result: { requeued: 2, processedDeadletters: 2 } });
  });

  it('dispatches obsidian graph audit through the internal route', async () => {
    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/obsidian/audit', {
      headers: { authorization: 'Bearer service-role' },
    });

    expect(res.statusCode).toBe(202);
    expect(mockExecuteObsidianGraphAudit).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ ok: true, result: { lastStatus: 'success' } });
  });

  it('applies discord ingress cutover policy through the internal route', async () => {
    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/discord/ingress/cutover/policy', {
      headers: { authorization: 'Bearer service-role' },
      body: {
        policies: {
          'docs-command': {
            preferredAdapterId: 'chat-sdk',
            rolloutPercentage: 25,
            hardDisable: false,
            shadowMode: false,
          },
          'muel-message': {
            preferredAdapterId: 'chat-sdk',
            rolloutPercentage: 25,
            hardDisable: false,
            shadowMode: false,
          },
        },
      },
    });

    expect(res.statusCode).toBe(202);
    expect(mockSetDiscordIngressRuntimePolicyOverride).toHaveBeenNthCalledWith(1, 'docs-command', {
      preferredAdapterId: 'chat-sdk',
      rolloutPercentage: 25,
      hardDisable: false,
      shadowMode: false,
    });
    expect(mockSetDiscordIngressRuntimePolicyOverride).toHaveBeenNthCalledWith(2, 'muel-message', {
      preferredAdapterId: 'chat-sdk',
      rolloutPercentage: 25,
      hardDisable: false,
      shadowMode: false,
    });
    expect(mockPrimeDiscordIngressCutoverPolicy).toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: true, appliedSurfaces: ['docs-command', 'muel-message'] });
  });

  it('exercises discord ingress cutover on the live runtime through the internal route', async () => {
    const router = createInternalRouter();
    const res = await invokeRoute(router, 'POST', '/discord/ingress/cutover/exercise', {
      headers: { authorization: 'Bearer service-role' },
      body: {
        evidenceSource: 'live',
        includeRollback: true,
      },
    });

    expect(res.statusCode).toBe(202);
    expect(mockExecuteDiscordIngress).toHaveBeenCalledTimes(3);
    expect(mockExecuteDiscordIngress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        surface: 'docs-command',
        correlationId: 'internal-live-docs-command-rollback',
      }),
      expect.objectContaining({
        hardDisable: true,
        preferCallOverrides: true,
        evidenceSource: 'live',
      }),
    );
    expect(res.body).toMatchObject({
      ok: true,
      summary: {
        exercised: true,
        surfaces: {
          'docs-command': {
            verdict: 'pass',
            selectedAdapterId: 'chat-sdk',
          },
          'muel-message': {
            verdict: 'pass',
            selectedAdapterId: 'chat-sdk',
          },
        },
        rollback: {
          verdict: 'pass',
          observedFallbacks: 1,
          selectedAdapterId: 'chat-sdk',
        },
      },
    });
  });
});