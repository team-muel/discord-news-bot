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

vi.mock('../middleware/auth', () => ({
  requireAdmin: noop,
  requireAuth: noop,
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
  getSuperAgentCapabilities: vi.fn().mockReturnValue([]),
  recommendSuperAgent: vi.fn(),
  startSuperAgentSessionFromTask: vi.fn(),
}));

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
});