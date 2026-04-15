import { Router, type RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockEvaluateGuildSloAndPersistAlerts,
  mockRunAgentSloAlertLoopOnce,
  mockExecuteEvalAutoPromoteLoop,
  mockExecuteRetrievalEvalLoop,
  mockExecuteRewardSignalLoop,
  mockGetSupabaseClient,
  mockIsSupabaseConfigured,
  mockEvaluateIntents,
  mockRunConsolidationCycle,
  mockRequeueDeadletterJob,
  mockExecuteObsidianLoreSync,
  mockExecuteObsidianGraphAudit,
} = vi.hoisted(() => ({
  mockEvaluateGuildSloAndPersistAlerts: vi.fn(),
  mockRunAgentSloAlertLoopOnce: vi.fn(),
  mockExecuteEvalAutoPromoteLoop: vi.fn(),
  mockExecuteRetrievalEvalLoop: vi.fn(),
  mockExecuteRewardSignalLoop: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
  mockIsSupabaseConfigured: vi.fn(() => true),
  mockEvaluateIntents: vi.fn(),
  mockRunConsolidationCycle: vi.fn(),
  mockRequeueDeadletterJob: vi.fn(),
  mockExecuteObsidianLoreSync: vi.fn(),
  mockExecuteObsidianGraphAudit: vi.fn(),
}));

vi.mock('../config', () => ({
  NODE_ENV: 'production',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
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
});