import { Router, type RequestHandler } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noop: RequestHandler = (_req, _res, next) => next();

const {
  mockBuildAgentRuntimeReadinessReport,
  mockGetAgentRoleWorkersHealthSnapshot,
  mockGetAgentTelemetryQueueSnapshot,
  mockGetLlmRuntimeSnapshot,
  mockGetObsidianAdapterRuntimeStatus,
  mockGetObsidianVaultLiveHealthStatus,
  mockGetObsidianRetrievalBoundarySnapshot,
  mockGetLatestObsidianGraphAuditSnapshot,
  mockGetObsidianKnowledgeCompilationStats,
  mockGetObsidianKnowledgeControlSurface,
  mockResolveObsidianKnowledgeArtifactPath,
  mockReadObsidianFileWithAdapter,
  mockGetObsidianVaultRoot,
  mockBuildGoNoGoReport,
  mockGetMemoryQueueHealthSnapshot,
  mockBuildToolLearningWeeklyReport,
  mockGetMemoryJobRunnerStats,
  mockGetObsidianInboxChatLoopStats,
  mockGetObsidianLoreSyncLoopStats,
  mockGetRetrievalEvalLoopStats,
  mockListAgentRoleWorkerSpecs,
  mockProbeHttpWorkerHealth,
  mockSummarizeOpencodeQueueReadiness,
} = vi.hoisted(() => ({
  mockBuildAgentRuntimeReadinessReport: vi.fn(),
  mockGetAgentRoleWorkersHealthSnapshot: vi.fn(),
  mockGetAgentTelemetryQueueSnapshot: vi.fn(),
  mockGetLlmRuntimeSnapshot: vi.fn(),
  mockGetObsidianAdapterRuntimeStatus: vi.fn(),
  mockGetObsidianVaultLiveHealthStatus: vi.fn(),
  mockGetObsidianRetrievalBoundarySnapshot: vi.fn(),
  mockGetLatestObsidianGraphAuditSnapshot: vi.fn(),
  mockGetObsidianKnowledgeCompilationStats: vi.fn(),
  mockGetObsidianKnowledgeControlSurface: vi.fn(),
  mockResolveObsidianKnowledgeArtifactPath: vi.fn(),
  mockReadObsidianFileWithAdapter: vi.fn(),
  mockGetObsidianVaultRoot: vi.fn(),
  mockBuildGoNoGoReport: vi.fn(),
  mockGetMemoryQueueHealthSnapshot: vi.fn(),
  mockBuildToolLearningWeeklyReport: vi.fn(),
  mockGetMemoryJobRunnerStats: vi.fn(),
  mockGetObsidianInboxChatLoopStats: vi.fn(),
  mockGetObsidianLoreSyncLoopStats: vi.fn(),
  mockGetRetrievalEvalLoopStats: vi.fn(),
  mockListAgentRoleWorkerSpecs: vi.fn(),
  mockProbeHttpWorkerHealth: vi.fn(),
  mockSummarizeOpencodeQueueReadiness: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireAdmin: noop,
  requireAuth: noop,
}));

vi.mock('../services/obsidian/router', () => ({
  getObsidianAdapterRuntimeStatus: mockGetObsidianAdapterRuntimeStatus,
  getObsidianVaultLiveHealthStatus: mockGetObsidianVaultLiveHealthStatus,
  readObsidianFileWithAdapter: mockReadObsidianFileWithAdapter,
}));

vi.mock('../services/obsidian/obsidianRagService', () => ({
  getObsidianRetrievalBoundarySnapshot: mockGetObsidianRetrievalBoundarySnapshot,
}));

vi.mock('../services/obsidian/obsidianQualityService', () => ({
  getLatestObsidianGraphAuditSnapshot: mockGetLatestObsidianGraphAuditSnapshot,
}));

vi.mock('../services/obsidian/knowledgeCompilerService', () => ({
  getObsidianKnowledgeCompilationStats: mockGetObsidianKnowledgeCompilationStats,
  getObsidianKnowledgeControlSurface: mockGetObsidianKnowledgeControlSurface,
  resolveObsidianKnowledgeArtifactPath: mockResolveObsidianKnowledgeArtifactPath,
}));

vi.mock('../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: mockGetObsidianVaultRoot,
}));

vi.mock('../services/goNoGoService', () => ({
  buildGoNoGoReport: mockBuildGoNoGoReport,
}));

vi.mock('../services/memory/memoryJobRunner', () => ({
  getMemoryQueueHealthSnapshot: mockGetMemoryQueueHealthSnapshot,
  getMemoryJobRunnerStats: mockGetMemoryJobRunnerStats,
}));

vi.mock('../services/agent/agentRuntimeReadinessService', () => ({
  buildAgentRuntimeReadinessReport: mockBuildAgentRuntimeReadinessReport,
}));

vi.mock('../services/agent/agentRoleWorkerService', () => ({
  getAgentRoleWorkersHealthSnapshot: mockGetAgentRoleWorkersHealthSnapshot,
  listAgentRoleWorkerSpecs: mockListAgentRoleWorkerSpecs,
  probeHttpWorkerHealth: mockProbeHttpWorkerHealth,
}));

vi.mock('../services/agent/agentTelemetryQueue', async () => {
  const actual = await vi.importActual('../services/agent/agentTelemetryQueue');
  return {
    ...actual,
    getAgentTelemetryQueueSnapshot: mockGetAgentTelemetryQueueSnapshot,
  };
});

vi.mock('../services/opencode/opencodeGitHubQueueService', () => ({
  summarizeOpencodeQueueReadiness: mockSummarizeOpencodeQueueReadiness,
}));

vi.mock('../services/llmClient', () => ({
  getLlmRuntimeSnapshot: mockGetLlmRuntimeSnapshot,
}));

vi.mock('../services/toolLearningService', () => ({
  buildToolLearningWeeklyReport: mockBuildToolLearningWeeklyReport,
}));

vi.mock('../services/obsidian/obsidianInboxChatLoopService', () => ({
  getObsidianInboxChatLoopStats: mockGetObsidianInboxChatLoopStats,
}));

vi.mock('../services/obsidian/obsidianLoreSyncService', () => ({
  getObsidianLoreSyncLoopStats: mockGetObsidianLoreSyncLoopStats,
}));

vi.mock('../services/eval/retrievalEvalLoopService', () => ({
  getRetrievalEvalLoopStats: mockGetRetrievalEvalLoopStats,
}));

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

describe('bot agent Obsidian runtime routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MCP_IMPLEMENT_WORKER_URL', 'http://worker');
    vi.stubEnv('MCP_OPENCODE_WORKER_URL', '');
    vi.stubEnv('OPENJARVIS_REQUIRE_OPENCODE_WORKER', 'true');

    mockGetObsidianVaultRoot.mockReturnValue('/vault');
    mockGetObsidianAdapterRuntimeStatus.mockReturnValue({
      selectedByCapability: { search_vault: 'remote-mcp', write_note: 'remote-mcp' },
      routingState: { remoteMcpCircuitOpen: false, remoteMcpCircuitReason: null },
    });
    mockGetObsidianVaultLiveHealthStatus.mockResolvedValue({
      healthy: true,
      issues: [],
      remoteMcp: { enabled: true, configured: true },
    });
    mockGetObsidianRetrievalBoundarySnapshot.mockResolvedValue({
      metadataOnly: {
        available: true,
        requiresVault: true,
        signals: ['status', 'valid_at'],
        responsibilities: ['graph traversal'],
      },
      supabaseBacked: {
        configured: true,
        cacheAvailable: true,
        cacheStats: {
          enabled: true,
          supabaseConfigured: true,
          ttlMs: 3600000,
          pendingHitEntries: 1,
          totalDocs: 10,
          activeDocs: 8,
          staleDocs: 2,
          totalHits: 25,
          averageHitsPerDoc: 2.5,
        },
        responsibilities: ['cache health'],
      },
    });
    mockGetLatestObsidianGraphAuditSnapshot.mockResolvedValue({ pass: true, totals: { files: 12 } });
    mockGetObsidianKnowledgeCompilationStats.mockReturnValue({
      enabled: true,
      runs: 3,
      skipped: 1,
      failures: 0,
      lastTriggeredAt: '2026-04-09T00:00:00.000Z',
      lastCompiledAt: '2026-04-09T00:00:01.000Z',
      lastNotePath: 'chat/answers/2026-04-09/test.md',
      lastReason: null,
      lastArtifacts: ['ops/knowledge-control/INDEX.md'],
      lastTopics: ['development'],
      lastEntityKey: 'chat/answers/2026-04-09/test',
      lastIndexedNotes: 10,
      lastLintSummary: {
        generatedAt: '2026-04-09T00:00:01.000Z',
        issueCount: 1,
        missingSourceRefs: 1,
        staleActiveNotes: 0,
        invalidLifecycleNotes: 0,
        canonicalCollisions: 0,
        issues: [{
          kind: 'missing_source_refs',
          severity: 'warning',
          message: 'missing source refs',
          entityKey: 'chat/thread-1',
          filePaths: ['chat/answers/2026-04-09/test.md'],
        }],
      },
    });
    mockGetObsidianKnowledgeControlSurface.mockReturnValue({
      compiler: mockGetObsidianKnowledgeCompilationStats(),
      artifactPaths: ['ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LINT.md'],
    });
    mockResolveObsidianKnowledgeArtifactPath.mockImplementation((artifact: string) => artifact === 'lint' ? 'ops/knowledge-control/LINT.md' : null);
    mockReadObsidianFileWithAdapter.mockResolvedValue('# Knowledge Control Lint\n\nTest Note');
    mockBuildGoNoGoReport.mockResolvedValue({
      decision: 'GO',
      failedChecks: [],
      checks: [{ name: 'vault', ok: true }],
      scope: { guildId: 'guild-1' },
      metrics: { score: 0.9 },
      queue: { pending: 0 },
      telemetryQueue: { pending: 0 },
    });
    mockGetMemoryQueueHealthSnapshot.mockResolvedValue({ pending: 0, delayed: 0 });
    mockBuildToolLearningWeeklyReport.mockResolvedValue({ summary: { approved: 3 } });
    mockGetMemoryJobRunnerStats.mockReturnValue({ running: true });
    mockGetObsidianInboxChatLoopStats.mockReturnValue({ enabled: true, started: true, running: false, intervalSec: 30, runOnStart: true, processedTotal: 4, lastFinishedAt: '2026-04-09T00:00:30.000Z', lastCandidateCount: 1, lastProcessedPaths: ['chat/inbox/2026-04-09/test-note.md'], lastSummary: 'candidates=1 processed=1' });
    mockGetObsidianLoreSyncLoopStats.mockReturnValue({ enabled: true, running: true });
    mockGetRetrievalEvalLoopStats.mockReturnValue({ enabled: true, running: false });
    mockBuildAgentRuntimeReadinessReport.mockResolvedValue({ decision: 'pass', checks: [] });
    mockGetAgentRoleWorkersHealthSnapshot.mockResolvedValue([{ worker: 'implement', ok: true }]);
    mockListAgentRoleWorkerSpecs.mockReturnValue([{ kind: 'implement', label: 'implement' }]);
    mockProbeHttpWorkerHealth.mockResolvedValue({ ok: true, status: 200, latencyMs: 12, endpoint: 'http://worker/health' });
    mockGetAgentTelemetryQueueSnapshot.mockReturnValue({ pending: 0, processed: 3, dropped: 0 });
    mockSummarizeOpencodeQueueReadiness.mockResolvedValue({ ready: true, queueDepth: 0 });
    mockGetLlmRuntimeSnapshot.mockResolvedValue({
      selectedProvider: 'ollama',
      actionName: null,
      routingCapability: 'general',
      actionPolicyProviders: ['openjarvis', 'ollama'],
      workflowBinding: { provider: 'openjarvis', model: 'qwen2.5:7b-instruct' },
      workflowProfile: 'quality-optimized',
      effectiveProviderProfile: 'quality-optimized',
      configuredProviders: ['ollama', 'litellm'],
      resolvedChain: ['ollama', 'litellm'],
      readyChain: ['ollama'],
      providers: [
        { provider: 'ollama', configured: true, status: 'ready', checkedAt: Date.now(), reason: null, cooldownUntil: null, consecutiveFailures: 0 },
        { provider: 'litellm', configured: true, status: 'unreachable', checkedAt: Date.now(), reason: 'connect ECONNREFUSED', cooldownUntil: Date.now() + 1000, consecutiveFailures: 1 },
      ],
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns obsidian runtime with cache stats derived from retrieval boundary', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/runtime');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      vaultPathConfigured: true,
      vaultHealth: { healthy: true },
      cacheStats: { activeDocs: 8, staleDocs: 2 },
      compiler: { runs: 3, lastIndexedNotes: 10 },
      inboxChatLoop: { enabled: true, intervalSec: 30, processedTotal: 4 },
      retrievalBoundary: { metadataOnly: { available: true } },
    });
  });

  it('returns runtime loops including the obsidian inbox chat processor', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/loops');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      memoryJobRunner: { running: true },
      obsidianInboxChatLoop: { enabled: true, intervalSec: 30, processedTotal: 4 },
      obsidianLoreSyncLoop: { enabled: true, running: true },
      retrievalEvalLoop: { enabled: true, running: false },
    });
  });

  it('returns knowledge control plane with nested obsidian cache and retrieval state', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/knowledge-control-plane', {
      query: { guildId: 'guild-1', days: '14' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      snapshot: {
        guildId: 'guild-1',
        obsidian: {
          vaultPathConfigured: true,
          vaultHealth: { healthy: true },
          cacheStats: { totalDocs: 10, activeDocs: 8 },
          compiler: { runs: 3, lastEntityKey: 'chat/answers/2026-04-09/test' },
          retrievalBoundary: { supabaseBacked: { cacheAvailable: true } },
        },
        loops: {
          memoryJobRunner: { running: true },
          obsidianInboxChatLoop: { enabled: true, intervalSec: 30, processedTotal: 4 },
          obsidianLoreSyncLoop: { enabled: true, running: true },
          retrievalEvalLoop: { enabled: true, running: false },
        },
      },
    });
  });

  it('returns unattended health with llm runtime readiness snapshot', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/unattended-health', {
      query: { guildId: 'guild-1', actionName: 'action.code.write' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetLlmRuntimeSnapshot).toHaveBeenCalledWith({ guildId: 'guild-1', actionName: 'action.code.write' });
    expect(res.body).toMatchObject({
      ok: true,
      executorReadiness: { ready: true, queueDepth: 0 },
      opencodeReadiness: { ready: true, queueDepth: 0 },
      workerHealth: {
        reachable: true,
        status: 200,
        label: 'implement',
        contract: {
          canonicalActionName: 'implement.execute',
          persistedActionName: 'opencode.execute',
          legacyActionName: 'opencode.execute',
        },
      },
      llmRuntime: {
        selectedProvider: 'ollama',
        workflowBinding: { provider: 'openjarvis', model: 'qwen2.5:7b-instruct' },
        effectiveProviderProfile: 'quality-optimized',
        readyChain: ['ollama'],
        providers: [
          { provider: 'ollama', status: 'ready' },
          { provider: 'litellm', status: 'unreachable' },
        ],
      },
      notes: {
        guildScoped: true,
        actionName: 'action.code.write',
        executorContract: {
          canonicalActionName: 'implement.execute',
          persistedActionName: 'opencode.execute',
          legacyActionName: 'opencode.execute',
        },
      },
    });
  });

  it('returns worker-url-missing health contract with persisted executor alias fields', async () => {
    vi.resetModules();
    vi.stubEnv('MCP_IMPLEMENT_WORKER_URL', '');
    vi.stubEnv('MCP_OPENCODE_WORKER_URL', '');
    vi.stubEnv('OPENJARVIS_REQUIRE_OPENCODE_WORKER', 'true');

    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/unattended-health', {
      query: { guildId: 'guild-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockProbeHttpWorkerHealth).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      workerHealth: {
        configured: false,
        reachable: false,
        reason: 'worker_url_missing',
        contract: {
          canonicalActionName: 'implement.execute',
          persistedActionName: 'opencode.execute',
          legacyActionName: 'opencode.execute',
          canonicalWorkerEnvKey: 'MCP_IMPLEMENT_WORKER_URL',
          legacyWorkerEnvKey: 'MCP_OPENCODE_WORKER_URL',
        },
      },
    });
  });

  it('returns knowledge control surface and requested artifact content', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/knowledge-control', {
      query: { artifact: 'lint' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      vaultPathConfigured: true,
      compiler: { runs: 3, lastLintSummary: { issueCount: 1 } },
      artifactPaths: ['ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LINT.md'],
      artifact: {
        request: 'lint',
        path: 'ops/knowledge-control/LINT.md',
      },
    });
    const body = res.body as { artifact?: { content?: string | null } };
    expect(body.artifact?.content).toContain('Test Note');
  });
});