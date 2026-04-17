import { Router, type RequestHandler } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const noop: RequestHandler = (_req, _res, next) => next();

const {
  mockGetAction,
  mockListActions,
  mockListAgentRoleWorkerSpecs,
  mockNormalizeActionInput,
  mockNormalizeActionResult,
  mockActionExecute,
} = vi.hoisted(() => ({
  mockGetAction: vi.fn(),
  mockListActions: vi.fn(),
  mockListAgentRoleWorkerSpecs: vi.fn(),
  mockNormalizeActionInput: vi.fn(),
  mockNormalizeActionResult: vi.fn(),
  mockActionExecute: vi.fn(),
}));

const {
  mockGetSuperAgentCapabilities,
  mockGetSuperAgentServiceBundle,
  mockListSuperAgentServiceBundles,
  mockRecommendSuperAgent,
  mockRecommendSuperAgentService,
  mockStartSuperAgentServiceSession,
  mockStartSuperAgentSessionFromTask,
} = vi.hoisted(() => ({
  mockGetSuperAgentCapabilities: vi.fn(),
  mockGetSuperAgentServiceBundle: vi.fn(),
  mockListSuperAgentServiceBundles: vi.fn(),
  mockRecommendSuperAgent: vi.fn(),
  mockRecommendSuperAgentService: vi.fn(),
  mockStartSuperAgentServiceSession: vi.fn(),
  mockStartSuperAgentSessionFromTask: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
  requireAuth: (_req: unknown, _res: unknown, next: (error?: unknown) => void) => next(),
}));

vi.mock('../logger', () => ({
  default: {
    warn: vi.fn(),
  },
}));

vi.mock('../services/agent/agentRoleWorkerService', () => ({
  listAgentRoleWorkerSpecs: mockListAgentRoleWorkerSpecs,
}));

vi.mock('../services/skills/actions/registry', () => ({
  getAction: mockGetAction,
  listActions: mockListActions,
}));

vi.mock('../services/skills/actionGovernanceStore', () => ({
  decideActionApprovalRequest: vi.fn(),
  isActionRunMode: vi.fn().mockReturnValue(true),
  listActionApprovalRequests: vi.fn().mockResolvedValue([]),
  listGuildActionPolicies: vi.fn().mockResolvedValue([]),
  upsertGuildActionPolicy: vi.fn(),
}));

vi.mock('../services/opencode/opencodeOpsService', () => ({
  getOpencodeExecutionSummary: vi.fn(),
}));

vi.mock('../services/workerExecution', () => ({
  normalizeActionInput: mockNormalizeActionInput,
  normalizeActionResult: mockNormalizeActionResult,
  toWorkerExecutionError: vi.fn((error: unknown) => ({
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    meta: null,
  })),
}));

vi.mock('../services/opencode/opencodeGitHubQueueService', () => ({
  createOpencodeChangeRequest: vi.fn(),
  decideOpencodeChangeRequest: vi.fn(),
  enqueueOpencodePublishJob: vi.fn(),
  isOpencodeChangeRequestStatus: vi.fn().mockReturnValue(true),
  isOpencodePublishJobStatus: vi.fn().mockReturnValue(true),
  listOpencodeChangeRequests: vi.fn().mockResolvedValue([]),
  listOpencodePublishJobs: vi.fn().mockResolvedValue([]),
  summarizeOpencodeQueueReadiness: vi.fn().mockResolvedValue({ ready: true }),
}));

vi.mock('../services/superAgentService', () => ({
  getSuperAgentCapabilities: mockGetSuperAgentCapabilities,
  getSuperAgentServiceBundle: mockGetSuperAgentServiceBundle,
  listSuperAgentServiceBundles: mockListSuperAgentServiceBundles,
  recommendSuperAgent: mockRecommendSuperAgent,
  recommendSuperAgentService: mockRecommendSuperAgentService,
  startSuperAgentServiceSession: mockStartSuperAgentServiceSession,
  startSuperAgentSessionFromTask: mockStartSuperAgentSessionFromTask,
}));

import {
  SUPER_AGENT_SERVICE_BUNDLE_IDS,
  getSuperAgentServiceBundle as getCatalogSuperAgentServiceBundle,
  listSuperAgentServiceBundles as listCatalogSuperAgentServiceBundles,
} from '../services/superAgentServiceCatalog';
import { registerBotAgentGovernanceRoutes } from './bot-agent/governanceRoutes';

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
    cookies: {},
    user: { id: 'admin-user' },
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

describe('bot agent governance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSuperAgentCapabilities.mockReturnValue({
      modes: ['local-collab'],
      serviceBundles: listCatalogSuperAgentServiceBundles(),
    });
    mockListSuperAgentServiceBundles.mockImplementation(() => listCatalogSuperAgentServiceBundles());
    mockGetSuperAgentServiceBundle.mockImplementation((serviceId: string) => getCatalogSuperAgentServiceBundle(serviceId));
    mockRecommendSuperAgent.mockReturnValue({ route: { mode: 'local-collab' } });
    mockRecommendSuperAgentService.mockImplementation((serviceId: string, input: Record<string, unknown>) => {
      const service = getCatalogSuperAgentServiceBundle(serviceId);
      return {
        service,
        recommendation: {
          route: {
            mode: service?.defaultMode || 'local-collab',
            lead_agent: { name: service?.defaultLeadAgent || 'Architect' },
          },
          task: {
            guild_id: input.guild_id,
            objective: input.objective || service?.defaultObjective || 'default objective',
          },
        },
      };
    });
    mockStartSuperAgentSessionFromTask.mockResolvedValue({
      recommendation: { route: { mode: 'local-collab' } },
      session_goal: 'goal',
      session: { id: 'session-super' },
    });
    mockStartSuperAgentServiceSession.mockImplementation(async (serviceId: string, input: Record<string, unknown>) => {
      const service = getCatalogSuperAgentServiceBundle(serviceId);
      return {
        service,
        recommendation: { route: { mode: service?.defaultMode || 'local-collab' } },
        session_goal: `${serviceId} goal`,
        session: { id: `session-${serviceId}`, requestedBy: input.requestedBy },
      };
    });
    mockListAgentRoleWorkerSpecs.mockReturnValue([]);
    mockNormalizeActionInput.mockImplementation(({ input }: { input: Record<string, unknown> }) => input);
    mockNormalizeActionResult.mockImplementation(({ result }: { result: Record<string, unknown> }) => result);
    mockActionExecute.mockResolvedValue({
      ok: true,
      name: 'implement.execute',
      summary: 'executed',
      artifacts: [],
      verification: [],
    });
    mockGetAction.mockImplementation((name: string) => {
      if (name !== 'implement.execute') {
        return null;
      }
      return {
        name: 'implement.execute',
        description: 'Execute implement action',
        execute: mockActionExecute,
      };
    });
    mockListActions.mockReturnValue([
      {
        name: 'implement.execute',
        description: 'Execute implement action',
        execute: mockActionExecute,
      },
    ]);
  });

  it('passes sanitized plain-object args to the action executor', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/actions/execute', {
      body: {
        actionName: 'implement.execute',
        goal: 'Ship it',
        args: {
          dryRun: true,
          targets: ['alpha', 'beta'],
          options: { retries: 2 },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockActionExecute).toHaveBeenCalledWith(expect.objectContaining({
      goal: 'Ship it',
      args: {
        dryRun: true,
        targets: ['alpha', 'beta'],
        options: { retries: 2 },
      },
    }));
  });

  it('rejects non-object args payloads', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/actions/execute', {
      body: {
        actionName: 'implement.execute',
        goal: 'Ship it',
        args: ['not', 'allowed'],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'INVALID_PAYLOAD',
    });
    expect(mockActionExecute).not.toHaveBeenCalled();
  });

  it('rejects oversized args payloads before execution', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/actions/execute', {
      body: {
        actionName: 'implement.execute',
        goal: 'Ship it',
        args: {
          payload: 'x'.repeat(16_100),
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'INVALID_PAYLOAD',
    });
    expect(mockActionExecute).not.toHaveBeenCalled();
  });

  it('returns the personal service bundle catalog under the super-agent surface', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/super/services');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      services: expect.arrayContaining(
        SUPER_AGENT_SERVICE_BUNDLE_IDS.map((serviceId) => expect.objectContaining({ id: serviceId })),
      ),
    });
    expect((res.body as { services: unknown[] }).services).toHaveLength(SUPER_AGENT_SERVICE_BUNDLE_IDS.length);
    expect(mockListSuperAgentServiceBundles).toHaveBeenCalledTimes(1);
  });

  it('runs one smoke operator call per personal OS service bundle', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    for (const serviceId of SUPER_AGENT_SERVICE_BUNDLE_IDS) {
      const describeRes = await invokeRoute(router, 'GET', '/agent/super/services/:serviceId', {
        params: { serviceId },
      });
      expect(describeRes.statusCode).toBe(200);
      expect(describeRes.body).toMatchObject({
        ok: true,
        service: expect.objectContaining({
          id: serviceId,
          operatorDocPath: 'docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md',
        }),
      });

      const recommendRes = await invokeRoute(router, 'POST', '/agent/super/services/:serviceId/recommend', {
        params: { serviceId },
        body: {
          guild_id: `guild-${serviceId}`,
        },
      });
      expect(recommendRes.statusCode).toBe(200);
      expect(recommendRes.body).toMatchObject({
        ok: true,
        service: expect.objectContaining({ id: serviceId }),
        recommendation: expect.objectContaining({
          task: expect.objectContaining({ guild_id: `guild-${serviceId}` }),
        }),
      });

      const sessionRes = await invokeRoute(router, 'POST', '/agent/super/services/:serviceId/sessions', {
        params: { serviceId },
        body: {
          guild_id: `guild-${serviceId}`,
        },
        user: { id: `operator-${serviceId}` },
      });
      expect(sessionRes.statusCode).toBe(202);
      expect(sessionRes.body).toMatchObject({
        ok: true,
        service: expect.objectContaining({ id: serviceId }),
        approvalPending: false,
        session: expect.objectContaining({
          id: `session-${serviceId}`,
          requestedBy: `operator-${serviceId}`,
        }),
      });
    }

    expect(mockGetSuperAgentServiceBundle.mock.calls.map(([serviceId]) => serviceId)).toEqual([...SUPER_AGENT_SERVICE_BUNDLE_IDS]);
    expect(mockRecommendSuperAgentService.mock.calls.map(([serviceId]) => serviceId)).toEqual([...SUPER_AGENT_SERVICE_BUNDLE_IDS]);
    expect(mockStartSuperAgentServiceSession.mock.calls.map(([serviceId]) => serviceId)).toEqual([...SUPER_AGENT_SERVICE_BUNDLE_IDS]);
  });

  it('recommends a personal service bundle session with the bundle-scoped wrapper', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/super/services/:serviceId/recommend', {
      params: { serviceId: 'personal-workflow-copilot' },
      body: {
        guild_id: 'guild-1',
        objective: 'Plan the next bounded work block',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockRecommendSuperAgentService).toHaveBeenCalledWith('personal-workflow-copilot', expect.objectContaining({
      guild_id: 'guild-1',
      objective: 'Plan the next bounded work block',
    }));
    expect(res.body).toMatchObject({
      ok: true,
      service: expect.objectContaining({ id: 'personal-workflow-copilot' }),
      recommendation: expect.objectContaining({ route: expect.objectContaining({ mode: 'local-collab' }) }),
    });
  });

  it('starts a personal service bundle session with the authenticated requester context', async () => {
    const router = Router();
    registerBotAgentGovernanceRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/super/services/:serviceId/sessions', {
      params: { serviceId: 'personal-workflow-copilot' },
      body: {
        guild_id: 'guild-1',
      },
      user: { id: 'operator-7' },
    });

    expect(res.statusCode).toBe(202);
    expect(mockStartSuperAgentServiceSession).toHaveBeenCalledWith('personal-workflow-copilot', expect.objectContaining({
      guild_id: 'guild-1',
      requestedBy: 'operator-7',
      isAdmin: true,
    }));
    expect(res.body).toMatchObject({
      ok: true,
      service: expect.objectContaining({ id: 'personal-workflow-copilot' }),
      approvalPending: false,
    });
  });
});