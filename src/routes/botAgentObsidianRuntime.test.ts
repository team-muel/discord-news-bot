import { Router, type RequestHandler } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const noop: RequestHandler = (_req, _res, next) => next();

const {
  mockBuildAgentRuntimeReadinessReport,
  mockGetAgentRoleWorkersHealthSnapshot,
  mockGetAgentTelemetryQueueSnapshot,
  mockGetLlmRuntimeSnapshot,
  mockGetHermesVsCodeBridgeStatus,
  mockGetOpenJarvisAutopilotStatus,
  mockGetOpenJarvisSessionOpenBundle,
  mockGetOpenJarvisMemorySyncStatus,
  mockCreateOpenJarvisHermesRuntimeChatNote,
  mockEnqueueOpenJarvisHermesRuntimeObjectives,
  mockLaunchOpenJarvisHermesChatSession,
  mockPrepareOpenJarvisHermesSessionStart,
  mockRunOpenJarvisHermesRuntimeRemediation,
  mockRunHermesVsCodeBridge,
  mockRunOpenJarvisMemorySync,
  mockGetObsidianAdapterRuntimeStatus,
  mockGetObsidianVaultLiveHealthStatus,
  mockGetObsidianRetrievalBoundarySnapshot,
  mockGetLatestObsidianGraphAuditSnapshot,
  mockGetObsidianGraphAuditLoopStats,
  mockGetObsidianMaintenanceControlSurface,
  mockExecuteObsidianGraphAudit,
  mockGetObsidianKnowledgeCompilationStats,
  mockGetObsidianKnowledgeControlSurface,
  mockBuildObsidianKnowledgeReflectionBundle,
  mockCompileObsidianKnowledgeBundle,
  mockCompileObsidianRequirement,
  mockCaptureObsidianWikiChange,
  mockPromoteKnowledgeToObsidian,
  mockResolveObsidianIncidentGraph,
  mockResolveInternalKnowledge,
  mockResolveObsidianKnowledgeArtifactPath,
  mockRunObsidianSemanticLintAudit,
  mockTraceObsidianDecision,
  mockReadObsidianFileWithAdapter,
  mockGetObsidianVaultRoot,
  mockGetObsidianVaultRuntimeInfo,
  mockBuildGoNoGoReport,
  mockGetMemoryQueueHealthSnapshot,
  mockBuildToolLearningWeeklyReport,
  mockGetMemoryJobRunnerStats,
  mockGetObsidianInboxChatLoopStats,
  mockGetObsidianLoreSyncLoopStats,
  mockGetRetrievalEvalLoopStats,
  mockGetRewardSignalLoopStatus,
  mockGetEvalAutoPromoteLoopStatus,
  mockGetEvalMaintenanceControlSurface,
  mockGetRuntimeSchedulerPolicySnapshot,
  mockGetPendingIntentCount,
  mockListAgentRoleWorkerSpecs,
  mockProbeHttpWorkerHealth,
  mockResolveAgentPersonalizationSnapshot,
  mockSummarizeOpencodeQueueReadiness,
  mockLoadOperatingBaseline,
} = vi.hoisted(() => ({
  mockBuildAgentRuntimeReadinessReport: vi.fn(),
  mockGetAgentRoleWorkersHealthSnapshot: vi.fn(),
  mockGetAgentTelemetryQueueSnapshot: vi.fn(),
  mockGetLlmRuntimeSnapshot: vi.fn(),
  mockGetHermesVsCodeBridgeStatus: vi.fn(),
  mockGetOpenJarvisAutopilotStatus: vi.fn(),
  mockGetOpenJarvisSessionOpenBundle: vi.fn(),
  mockGetOpenJarvisMemorySyncStatus: vi.fn(),
  mockCreateOpenJarvisHermesRuntimeChatNote: vi.fn(),
  mockEnqueueOpenJarvisHermesRuntimeObjectives: vi.fn(),
  mockLaunchOpenJarvisHermesChatSession: vi.fn(),
  mockPrepareOpenJarvisHermesSessionStart: vi.fn(),
  mockRunOpenJarvisHermesRuntimeRemediation: vi.fn(),
  mockRunHermesVsCodeBridge: vi.fn(),
  mockRunOpenJarvisMemorySync: vi.fn(),
  mockGetObsidianAdapterRuntimeStatus: vi.fn(),
  mockGetObsidianVaultLiveHealthStatus: vi.fn(),
  mockGetObsidianRetrievalBoundarySnapshot: vi.fn(),
  mockGetLatestObsidianGraphAuditSnapshot: vi.fn(),
  mockGetObsidianGraphAuditLoopStats: vi.fn(),
  mockGetObsidianMaintenanceControlSurface: vi.fn(),
  mockExecuteObsidianGraphAudit: vi.fn(),
  mockGetObsidianKnowledgeCompilationStats: vi.fn(),
  mockGetObsidianKnowledgeControlSurface: vi.fn(),
  mockBuildObsidianKnowledgeReflectionBundle: vi.fn(),
  mockCompileObsidianKnowledgeBundle: vi.fn(),
  mockCompileObsidianRequirement: vi.fn(),
  mockCaptureObsidianWikiChange: vi.fn(),
  mockPromoteKnowledgeToObsidian: vi.fn(),
  mockResolveObsidianIncidentGraph: vi.fn(),
  mockResolveInternalKnowledge: vi.fn(),
  mockResolveObsidianKnowledgeArtifactPath: vi.fn(),
  mockRunObsidianSemanticLintAudit: vi.fn(),
  mockTraceObsidianDecision: vi.fn(),
  mockReadObsidianFileWithAdapter: vi.fn(),
  mockGetObsidianVaultRoot: vi.fn(),
  mockGetObsidianVaultRuntimeInfo: vi.fn(),
  mockBuildGoNoGoReport: vi.fn(),
  mockGetMemoryQueueHealthSnapshot: vi.fn(),
  mockBuildToolLearningWeeklyReport: vi.fn(),
  mockGetMemoryJobRunnerStats: vi.fn(),
  mockGetObsidianInboxChatLoopStats: vi.fn(),
  mockGetObsidianLoreSyncLoopStats: vi.fn(),
  mockGetRetrievalEvalLoopStats: vi.fn(),
  mockGetRewardSignalLoopStatus: vi.fn(),
  mockGetEvalAutoPromoteLoopStatus: vi.fn(),
  mockGetEvalMaintenanceControlSurface: vi.fn(),
  mockGetRuntimeSchedulerPolicySnapshot: vi.fn(),
  mockGetPendingIntentCount: vi.fn(),
  mockListAgentRoleWorkerSpecs: vi.fn(),
  mockProbeHttpWorkerHealth: vi.fn(),
  mockResolveAgentPersonalizationSnapshot: vi.fn(),
  mockSummarizeOpencodeQueueReadiness: vi.fn(),
  mockLoadOperatingBaseline: vi.fn(),
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
  getObsidianGraphAuditLoopStats: mockGetObsidianGraphAuditLoopStats,
}));

vi.mock('../services/obsidian/obsidianMaintenanceControlService', () => ({
  getObsidianMaintenanceControlSurface: mockGetObsidianMaintenanceControlSurface,
  executeObsidianGraphAudit: mockExecuteObsidianGraphAudit,
}));

vi.mock('../services/obsidian/knowledgeCompilerService', () => ({
  buildObsidianKnowledgeReflectionBundle: mockBuildObsidianKnowledgeReflectionBundle,
  compileObsidianKnowledgeBundle: mockCompileObsidianKnowledgeBundle,
  compileObsidianRequirement: mockCompileObsidianRequirement,
  captureObsidianWikiChange: mockCaptureObsidianWikiChange,
  promoteKnowledgeToObsidian: mockPromoteKnowledgeToObsidian,
  resolveObsidianIncidentGraph: mockResolveObsidianIncidentGraph,
  getObsidianKnowledgeCompilationStats: mockGetObsidianKnowledgeCompilationStats,
  getObsidianKnowledgeControlSurface: mockGetObsidianKnowledgeControlSurface,
  resolveInternalKnowledge: mockResolveInternalKnowledge,
  resolveObsidianKnowledgeArtifactPath: mockResolveObsidianKnowledgeArtifactPath,
  runObsidianSemanticLintAudit: mockRunObsidianSemanticLintAudit,
  traceObsidianDecision: mockTraceObsidianDecision,
}));

vi.mock('../services/intent', () => ({
  getPendingIntentCount: mockGetPendingIntentCount,
}));

vi.mock('../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: mockGetObsidianVaultRoot,
  getObsidianVaultRuntimeInfo: mockGetObsidianVaultRuntimeInfo,
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

vi.mock('../services/agent/agentPersonalizationService', () => ({
  resolveAgentPersonalizationSnapshot: mockResolveAgentPersonalizationSnapshot,
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

vi.mock('../services/runtime/operatingBaseline', () => ({
  loadOperatingBaseline: mockLoadOperatingBaseline,
}));

vi.mock('../services/runtime/runtimeSchedulerPolicyService', () => ({
  getRuntimeSchedulerPolicySnapshot: mockGetRuntimeSchedulerPolicySnapshot,
}));

vi.mock('../services/openjarvis/openjarvisMemorySyncStatusService', () => ({
  getOpenJarvisMemorySyncStatus: mockGetOpenJarvisMemorySyncStatus,
  runOpenJarvisMemorySync: mockRunOpenJarvisMemorySync,
}));

vi.mock('../services/openjarvis/openjarvisHermesRuntimeControlService', () => ({
  createOpenJarvisHermesRuntimeChatNote: mockCreateOpenJarvisHermesRuntimeChatNote,
  enqueueOpenJarvisHermesRuntimeObjectives: mockEnqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession: mockLaunchOpenJarvisHermesChatSession,
  prepareOpenJarvisHermesSessionStart: mockPrepareOpenJarvisHermesSessionStart,
  runOpenJarvisHermesRuntimeRemediation: mockRunOpenJarvisHermesRuntimeRemediation,
}));

vi.mock('../services/openjarvis/openjarvisAutopilotStatusService', () => ({
  getOpenJarvisAutopilotStatus: mockGetOpenJarvisAutopilotStatus,
  getOpenJarvisSessionOpenBundle: mockGetOpenJarvisSessionOpenBundle,
}));

vi.mock('../services/runtime/hermesVsCodeBridgeService', () => ({
  getHermesVsCodeBridgeStatus: mockGetHermesVsCodeBridgeStatus,
  runHermesVsCodeBridge: mockRunHermesVsCodeBridge,
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

vi.mock('../services/eval/rewardSignalLoopService', () => ({
  getRewardSignalLoopStatus: mockGetRewardSignalLoopStatus,
}));

vi.mock('../services/eval/evalAutoPromoteLoopService', () => ({
  getEvalAutoPromoteLoopStatus: mockGetEvalAutoPromoteLoopStatus,
}));

vi.mock('../services/eval/evalMaintenanceControlService', () => ({
  getEvalMaintenanceControlSurface: mockGetEvalMaintenanceControlSurface,
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
    mockGetObsidianVaultRuntimeInfo.mockReturnValue({
      configured: true,
      root: '/vault',
      configuredName: 'Obsidian Vault',
      resolvedName: 'Obsidian Vault',
      exists: true,
      topLevelDirectories: ['chat', 'guilds', 'ops'],
      topLevelFiles: [],
      looksLikeDesktopVault: true,
      looksLikeRepoDocs: false,
    });
    mockGetObsidianAdapterRuntimeStatus.mockReturnValue({
      selectedByCapability: { search_vault: 'remote-mcp', write_note: 'remote-mcp' },
      routingState: { remoteMcpCircuitOpen: false, remoteMcpCircuitReason: null },
      accessPosture: {
        mode: 'shared-remote-ingress',
        summary: 'Remote MCP over the canonical shared ingress is the primary Obsidian path',
        primaryWriteAdapter: 'remote-mcp',
        primaryReadAdapter: 'remote-mcp',
        primarySearchAdapter: 'remote-mcp',
        remoteHttpIngressActive: true,
        directVaultPathActive: false,
        canonicalSharedIngressConfigured: true,
      },
      remoteMcp: {
        remoteAdapterRuntime: {
          vaultRuntime: {
            configured: true,
            root: '/remote-vault',
            configuredName: 'Obsidian Vault',
            resolvedName: 'Obsidian Vault',
            exists: true,
            topLevelDirectories: ['chat', 'guilds', 'ops'],
            topLevelFiles: [],
            looksLikeDesktopVault: true,
            looksLikeRepoDocs: false,
          },
        },
      },
    });
    mockGetObsidianVaultLiveHealthStatus.mockResolvedValue({
      healthy: true,
      issues: [],
      remoteMcp: { enabled: true, configured: true },
    });
    mockResolveAgentPersonalizationSnapshot.mockResolvedValue({
      guildId: 'guild-1',
      userId: 'user-1',
      requestedPriority: 'balanced',
      requestedSkillId: null,
      consent: {
        memoryEnabled: true,
        socialGraphEnabled: true,
        profilingEnabled: true,
        actionAuditDisclosureEnabled: true,
        source: 'stored',
        updatedAt: null,
      },
      learning: { enabled: true },
      persona: {
        available: true,
        summary: 'prefers concise delivery',
        communicationStyle: 'concise',
        roleTags: ['analyst'],
        preferredTopics: ['ops'],
        visibleNoteCount: 1,
        hiddenNoteCount: 0,
        relationCount: 0,
        notes: [{ title: 'persona', summary: 'use concise delivery', visibility: 'guild' }],
      },
      workflow: {
        priority: 'balanced',
        stepTitles: ['plan', 'research', 'critique'],
        stepCount: 3,
      },
      promptHints: ['[personalization:profile] style=concise'],
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
      controlPaths: ['ops/control-tower/BLUEPRINT.md'],
      blueprint: {
        model: '4-plane-control-tower',
        controlPaths: ['ops/control-tower/BLUEPRINT.md'],
        reflectionChecklist: ['search visibility verified in the user-visible vault'],
        planes: [{
          id: 'control',
          label: 'Control Plane',
          description: 'Canonical policy and gate standards.',
          pathPatterns: ['ops/control-tower/**'],
          primaryQuestions: ['What is canonical?'],
        }],
      },
      bundleSupport: {
        enabled: true,
        queryParam: 'bundleFor',
        acceptedAliases: ['blueprint'],
      },
      pathIndex: [{ path: 'ops/control-tower/BLUEPRINT.md', plane: 'control', concern: 'control-tower', generated: false }],
    });
    mockBuildObsidianKnowledgeReflectionBundle.mockImplementation((value: string) => ({
      targetPath: value,
      plane: 'runtime',
      concern: 'service-memory',
      requiredPaths: ['ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LOG.md'],
      suggestedPaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
      suggestedPatterns: ['ops/services/unified-mcp/RECOVERY.md'],
      verificationChecklist: ['search visibility verified in the user-visible vault'],
      gatePaths: ['ops/quality/gates/2026-04-10_visible-reflection-gate.md'],
      customerImpact: false,
      notes: ['test bundle'],
    }));
    mockCompileObsidianKnowledgeBundle.mockResolvedValue({
      summary: 'Compiled 2 artifacts for operator routing.',
      facts: [{ id: 'fact-1', statement: 'shared mcp first', confidence: 0.94, sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'], freshness: 'current', factType: 'decision' }],
      artifacts: [{ id: 'artifact-1', artifactType: 'repo-doc', title: 'Knowledge Bundle Compile Spec', locator: 'docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md', whyIncluded: 'matched to goal', confidence: 0.72, preview: '# Knowledge Bundle Compile Spec', sourceRole: 'supporting' }],
      gaps: [],
      recommendedPromotions: [{ artifactKind: 'service_profile', title: 'Knowledge Bundle Compile Spec', reason: 'resolved from repo source fallback instead of shared vault content', sourceRefs: ['repo:docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md'] }],
      resolutionTrace: ['repo-docs'],
      confidence: 0.91,
      inputs: { goal: 'operator routing', domains: ['architecture'], sourceHints: ['obsidian'], explicitSources: [], includeLocalOverlay: false, audience: 'engineering' },
    });
    mockResolveInternalKnowledge.mockResolvedValue({
      summary: 'Resolved 2 internal knowledge artifacts for "operator routing" via shared-mcp-internal.',
      facts: [{ id: 'fact-1', statement: 'shared mcp first', confidence: 0.94, sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'], freshness: 'current', factType: 'decision' }],
      artifacts: [{ id: 'artifact-1', artifactType: 'repo-doc', title: 'Knowledge Bundle Compile Spec', locator: 'docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md', whyIncluded: 'matched to goal', confidence: 0.72, preview: '# Knowledge Bundle Compile Spec' }],
      redactions: [],
      accessNotes: ['Prefer the shared MCP internal knowledge surface before assuming repo-local context is complete.'],
      gaps: [{ id: 'gap-access-internal-knowledge', gapType: 'access', description: 'Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.', severity: 'medium', suggestedNextStep: 'Route this query through the shared MCP internal knowledge surface before assuming the repository is complete.' }],
      preferredPath: 'shared-mcp-internal',
      confidence: 0.88,
    });
    mockCompileObsidianRequirement.mockResolvedValue({
      problem: 'Compile a requirement for shared MCP routing.',
      constraints: ['Preserve existing runtime behavior'],
      entities: ['Shared Knowledge Routing', 'Unified MCP'],
      workflows: ['shared MCP routing and internal knowledge resolution', 'shared Obsidian wikiization and backfill'],
      capabilityGaps: ['Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.'],
      openQuestions: ['Which shared MCP or internal surface should answer this access gap: Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.'],
      recommendedNextArtifacts: ['requirement: Shared Knowledge Routing'],
      sourceArtifacts: [{ id: 'artifact-trigger-1', artifactType: 'internal-doc', title: 'anthropic.com/engineering/managed-agents', locator: 'https://www.anthropic.com/engineering/managed-agents', whyIncluded: 'explicit trigger source supplied by the caller', confidence: 0.68, preview: 'Explicit trigger source preserved for human-visible provenance.', sourceRole: 'trigger' }],
      confidence: 0.87,
      bundleSummary: 'Compiled 2 artifacts for operator routing.',
    });
    mockTraceObsidianDecision.mockResolvedValue({
      subject: 'shared MCP routing policy',
      summary: 'Traced "shared MCP routing policy" through 2 artifacts, 1 contradiction signals, and 1 explicit gaps.',
      facts: [{ id: 'fact-1', statement: 'shared mcp first', confidence: 0.94, sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'], freshness: 'current', factType: 'decision' }],
      artifacts: [{ id: 'artifact-1', artifactType: 'repo-doc', title: 'Knowledge Bundle Compile Spec', locator: 'docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md', whyIncluded: 'matched to goal', confidence: 0.72, preview: '# Knowledge Bundle Compile Spec', sourceRole: 'supporting' }],
      gaps: [{ id: 'gap-1', gapType: 'promotion-needed', description: 'Repo mirror still needs shared promotion.', severity: 'medium', suggestedNextStep: 'Promote the repo mirror to shared vault.' }],
      trace: [{ id: 'trace-1', stepKind: 'artifact', title: 'Knowledge Bundle Compile Spec', locator: 'docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md', reason: 'matched to goal', sourceRole: 'supporting' }],
      contradictions: [{ id: 'issue-1', kind: 'runtime-doc-mismatch', severity: 'medium', message: 'Runtime routing still exposes a stale fallback.', evidenceRefs: ['docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md'], suggestedNextStep: 'Align runtime fallback behavior with the control-tower policy.' }],
      supersedes: ['docs/archive/legacy-routing.md'],
      confidence: 0.88,
    });
    mockResolveObsidianIncidentGraph.mockResolvedValue({
      incident: 'unified mcp routing outage',
      summary: 'Resolved incident graph for "unified mcp routing outage" from 3 artifacts across 1 services with 1 blockers and 2 next actions.',
      facts: [{ id: 'fact-1', statement: 'shared mcp first', confidence: 0.94, sourceRefs: ['vault:ops/incidents/2026-04-11_unified-mcp-routing.md'], freshness: 'shared-vault', factType: 'runtime' }],
      artifacts: [{ id: 'artifact-1', artifactType: 'obsidian-note', title: 'Unified MCP Routing Incident', locator: 'ops/incidents/2026-04-11_unified-mcp-routing.md', whyIncluded: 'incident evidence', confidence: 0.91, preview: '# Unified MCP Routing Incident', sourceRole: 'supporting' }],
      gaps: [],
      contradictions: [{ id: 'issue-1', kind: 'runtime-doc-mismatch', severity: 'medium', message: 'Recovery playbook has not been updated for the latest worker alias.', evidenceRefs: ['ops/playbooks/unified-mcp-recovery.md'], suggestedNextStep: 'Refresh the playbook mirror and promote the corrected object.' }],
      affectedServices: ['unified-mcp'],
      relatedIncidents: ['ops/incidents/2026-04-11_unified-mcp-routing.md'],
      relatedPlaybooks: ['ops/playbooks/unified-mcp-recovery.md'],
      relatedImprovements: ['ops/improvement/unified-mcp-routing-hardening.md'],
      blockers: ['Recovery playbook has not been updated for the latest worker alias.'],
      nextActions: ['Refresh the playbook mirror and promote the corrected object.', 'Promote the post-incident hardening improvement.'],
      customerImpactLikely: true,
      confidence: 0.86,
    });
    mockCaptureObsidianWikiChange.mockResolvedValue({
      classification: ['development_slice'],
      wikiTargets: ['plans/development/2026-04-11_operator-routing.md'],
      writtenArtifacts: ['plans/development/2026-04-11_operator-routing.md'],
      mirrorUpdates: ['CHANGELOG-ARCH'],
      followUps: [],
      gaps: [],
      matchedCatalogEntries: ['service-mcp-tool-first-contracts'],
    });
    mockPromoteKnowledgeToObsidian.mockResolvedValue({
      status: 'written',
      writtenArtifacts: ['ops/contexts/repos/shared-routing.md'],
      skippedReasons: [],
      targetPath: 'ops/contexts/repos/shared-routing.md',
      canonicalKey: 'repo/shared-routing',
    });
    mockRunObsidianSemanticLintAudit.mockResolvedValue({
      summary: 'Detected 2 semantic lint issues across compiler lint, graph quality, shared coverage, or runtime-vs-doc alignment.',
      healthy: false,
      issueCount: 2,
      issues: [{
        id: 'coverage-missing-shared-targets',
        kind: 'coverage-gap',
        severity: 'high',
        message: '2 shared wiki targets are still missing from the configured vault mirror.',
        evidenceRefs: ['ops/control-tower/BLUEPRINT.md'],
        suggestedNextStep: 'Backfill missing shared wiki targets before treating repo mirrors as canonical.',
      }],
      followUps: ['Backfill missing shared wiki targets before treating repo mirrors as canonical.'],
      coverage: { totalEntries: 10, presentEntries: 8, missingEntries: 2 },
      persistence: {
        attempted: true,
        summaryPath: 'ops/improvement/negative-knowledge/semantic-lint/CURRENT.md',
        issuePaths: ['ops/improvement/negative-knowledge/semantic-lint/issues/coverage-gap-coverage-missing-shared-targets-2-shared-wiki-targets-are-still-missing-from-the-configured-vault-mirror.md'],
        writtenArtifacts: ['ops/improvement/negative-knowledge/semantic-lint/CURRENT.md'],
        skippedReasons: [],
      },
    });
    mockResolveObsidianKnowledgeArtifactPath.mockImplementation((artifact: string) => artifact === 'lint'
      ? 'ops/knowledge-control/LINT.md'
      : artifact === 'blueprint'
        ? 'ops/control-tower/BLUEPRINT.md'
        : null);
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
    mockGetObsidianGraphAuditLoopStats.mockReturnValue({
      enabled: true,
      owner: 'app',
      running: false,
      intervalMin: 360,
      runOnStart: true,
      timeoutMs: 600000,
      lastRunAt: '2026-04-10T00:00:00.000Z',
      lastFinishedAt: '2026-04-10T00:02:00.000Z',
      lastStatus: 'success',
      lastExitCode: 0,
      lastSummary: 'durationMs=120000 exitCode=0 tail=[obsidian-audit] pass=true',
      snapshotPath: '/repo/.runtime/obsidian-graph-audit.json',
    });
    mockGetObsidianMaintenanceControlSurface.mockReturnValue({
      executor: 'repo-runtime',
      tasks: ['lore-sync', 'graph-audit'],
      delegation: {
        preferredExecutor: 'repo-runtime',
        fallbackExecutor: 'repo-runtime',
        workerKind: 'operate',
        workerConfigured: false,
        strict: false,
      },
    });
    mockExecuteObsidianGraphAudit.mockResolvedValue({
      result: {
        enabled: true,
        owner: 'app',
        running: false,
        intervalMin: 360,
        runOnStart: true,
        timeoutMs: 600000,
        lastRunAt: '2026-04-11T00:00:00.000Z',
        lastFinishedAt: '2026-04-11T00:02:00.000Z',
        lastStatus: 'success',
        lastExitCode: 0,
        lastSummary: 'durationMs=120000 exitCode=0 tail=[obsidian-audit] pass=true',
        snapshotPath: '/repo/.runtime/obsidian-graph-audit.json',
      },
      snapshot: { pass: true, totals: { files: 12 } },
    });
    mockGetRetrievalEvalLoopStats.mockReturnValue({ enabled: true, running: false });
    mockGetRewardSignalLoopStatus.mockReturnValue({
      enabled: true,
      running: false,
      lastRunAt: '2026-04-10T00:00:00.000Z',
      lastSummary: 'attempted=2 completed=2 failed=0',
      intervalHours: 6,
    });
    mockGetEvalAutoPromoteLoopStatus.mockReturnValue({
      enabled: true,
      running: false,
      lastRunAt: '2026-04-10T00:10:00.000Z',
      lastSummary: 'guilds=2/2 collected=4 judged=4 promoted=1 rejected=0',
      intervalHours: 6,
    });
    mockGetEvalMaintenanceControlSurface.mockReturnValue({
      executor: 'repo-runtime',
      tasks: ['retrieval-eval', 'reward-signal', 'auto-promote'],
    });
    mockGetRuntimeSchedulerPolicySnapshot.mockResolvedValue({
      generatedAt: '2026-04-11T00:00:00.000Z',
      summary: { total: 4, appOwned: 4, dbOwned: 0, enabled: 4, running: 3 },
      supabase: { configured: true, cronJobCount: 0 },
      items: [{ id: 'obsidian-sync-loop', title: 'Obsidian lore sync loop', owner: 'app', startup: 'discord-ready', enabled: true, running: true, schedule: 'every 60m', source: ['src/services/obsidianLoreSyncService.ts'] }],
    });
    mockGetPendingIntentCount.mockResolvedValue(2);
    mockLoadOperatingBaseline.mockReturnValue({
      schemaVersion: 1,
      updatedAt: '2026-04-10',
      environment: 'production-current',
      description: 'Canonical operating runtime contract for the current always-on deployment.',
      gcpWorker: {
        machineType: 'e2-medium',
        memoryGb: 4,
        publicBaseUrl: 'https://34.56.232.61.sslip.io',
      },
      lanes: {
        alwaysOnRequired: ['implementWorker', 'unifiedMcp'],
        localAccelerationOnly: ['localOllama'],
      },
    });
    mockBuildAgentRuntimeReadinessReport.mockResolvedValue({ decision: 'pass', checks: [] });
    mockGetAgentRoleWorkersHealthSnapshot.mockResolvedValue([{ worker: 'implement', ok: true }]);
    mockListAgentRoleWorkerSpecs.mockReturnValue([{ kind: 'implement', label: 'implement' }]);
    mockProbeHttpWorkerHealth.mockResolvedValue({ ok: true, status: 200, latencyMs: 12, endpoint: 'http://worker/health' });
    mockGetAgentTelemetryQueueSnapshot.mockReturnValue({ pending: 0, processed: 3, dropped: 0 });
    mockSummarizeOpencodeQueueReadiness.mockResolvedValue({ ready: true, queueDepth: 0 });
    mockGetOpenJarvisMemorySyncStatus.mockReturnValue({
      configured: true,
      summaryPath: 'C:/repo/tmp/openjarvis-memory-feed/summary.json',
      exists: true,
      status: 'fresh',
      healthy: true,
      generatedAt: '2026-04-11T00:10:00.000Z',
      ageMinutes: 10,
      staleAfterMinutes: 1440,
      dryRun: false,
      forced: false,
      vaultPath: '/vault',
      obsidianAdapterSummary: 'Remote MCP over the canonical shared ingress is the primary Obsidian path',
      supabaseAvailability: 'ok',
      counts: {
        total: 5,
        obsidian: 2,
        repo: 2,
        supabase: 1,
      },
      docs: [
        {
          section: 'obsidian',
          fileName: 'runtime-name-and-surface-matrix.md',
          sourceRef: 'vault:ops/control-tower/CANONICAL_MAP.md',
        },
      ],
      memoryIndex: {
        attempted: true,
        status: 'completed',
        completedAt: '2026-04-11T00:10:05.000Z',
        outputSummary: 'indexed 5 docs',
        reason: null,
      },
      issues: [],
    });
    mockGetOpenJarvisAutopilotStatus.mockResolvedValue({
      ok: true,
      summary_path: 'tmp/autonomy/openjarvis-unattended-last-run.json',
      workflow: {
        session_id: 'openjarvis-1',
        session_path: null,
        source: 'supabase',
        runtime_lane: 'operator-personal',
        workflow_name: 'openjarvis.unattended',
        status: 'released',
        scope: 'interactive:goal',
        stage: 'interactive',
        objective: 'recover GCP native leverage',
        route_mode: 'operations',
        started_at: '2026-04-12T00:00:00.000Z',
        completed_at: '2026-04-12T00:01:00.000Z',
        execution_health: null,
        lastRecallRequest: {
          createdAt: '2026-04-12T00:00:30.000Z',
          decisionReason: 'need gpt re-entry',
          evidenceId: 'wf-evidence-1',
          blockedAction: 'planActions',
          nextAction: 'resume bounded GCP capacity recovery until capacity reaches 90',
          requestedBy: 'goal-pipeline',
          runtimeLane: 'operator-personal',
          failedStepNames: ['gate-check'],
        },
        lastDecisionDistillate: {
          createdAt: '2026-04-12T00:00:45.000Z',
          summary: 'Pipeline released after 1 bounded step.',
          evidenceId: 'wf-distillate-1',
          nextAction: 'promote durable operator-visible outcomes into Obsidian if the result should persist',
          runtimeLane: 'operator-personal',
          sourceEvent: 'session_complete',
          promoteAs: 'development_slice',
          tags: ['goal-pipeline', 'released'],
        },
        lastArtifactRefs: [
          {
            createdAt: '2026-04-12T00:00:20.000Z',
            locator: 'docs/CHANGELOG-ARCH.md',
            refKind: 'repo-file',
            title: 'Architecture changelog',
            runtimeLane: 'operator-personal',
            sourceStepName: 'gate-check',
            sourceEvent: 'step_passed',
          },
        ],
      },
      launch: null,
      supervisor: {
        status: 'running',
        supervisor_pid: 20960,
        supervisor_alive: true,
        auto_select_queued_objective: true,
        auto_launch_queued_chat: true,
        started_at: '2026-04-12T00:00:00.000Z',
        stopped_at: null,
        stop_reason: null,
        launches_completed: 2,
        idle_checks: 0,
        last_reason: 'launched',
        objective_seed: null,
        resume_from_packets: true,
        last_launch: null,
        vscode_bridge: null,
      },
      result: {
        final_status: 'released',
        step_count: 1,
        failed_steps: 0,
        latest_gate_decision: null,
        deploy_status: null,
        stale_execution_suspected: false,
      },
      capacity: {
        target: 90,
        score: 82,
        gap: 8,
        reached: false,
        state: 'recovering',
        loop_action: 'continue',
        primary_reason: 'gcp_openjarvis_serve_not_remote',
      },
      resume_state: {
        source: 'supabase-workstream',
        next_action: 'resume bounded GCP capacity recovery until capacity reaches 90',
      },
      continuity_packets: null,
      gcp_capacity_recovery_requested: true,
      gcp_native: {
        score: 64,
        wired_surfaces: 2,
        required_surfaces: 6,
        primary_reason: 'gcp_openjarvis_serve_not_remote',
      },
      hermes_runtime: {
        target_role: 'persistent-local-operator',
        current_role: 'continuity-sidecar',
        readiness: 'partial',
        can_continue_without_gpt_session: true,
        queue_enabled: false,
        supervisor_alive: false,
        has_hot_state: true,
        local_operator_surface: true,
        ide_handoff_observed: false,
        queued_objectives_available: false,
        strengths: ['Hermes can continue bounded work after the GPT session releases.'],
        blockers: ['No live supervisor is holding the local continuity loop open right now.'],
        next_actions: ['Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.'],
        remediation_actions: [
          {
            action_id: 'start-supervisor-loop',
            label: 'Start Hermes queue supervisor',
          },
        ],
      },
      vscode_cli: {
        last_auto_open: null,
      },
      steps: [
        {
          step_name: 'gate-check',
          status: 'passed',
        },
      ],
    });
    mockGetOpenJarvisSessionOpenBundle.mockResolvedValue({
      bundle_version: 1,
      generated_at: '2026-04-12T00:01:05.000Z',
      summary_path: 'tmp/autonomy/openjarvis-unattended-last-run.json',
      objective: 'recover GCP native leverage',
      route_mode: 'operations',
      runtime_lane: 'operator-personal',
      workflow: {
        session_id: 'openjarvis-1',
        source: 'supabase',
        status: 'released',
        scope: 'interactive:goal',
        stage: 'interactive',
        started_at: '2026-04-12T00:00:00.000Z',
        completed_at: '2026-04-12T00:01:00.000Z',
        execution_health: null,
      },
      continuity: {
        owner: 'hermes',
        mode: 'observing',
        next_action: 'restart the next bounded automation cycle from the active objective',
        resumable: true,
        reason: 'workstream_auto_restart_ready',
        escalation_status: 'none',
        auto_restart_on_release: true,
        safe_queue: ['keep workflow session, launch state, and summary aligned'],
        progress_packet: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md',
        handoff_packet: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      },
      routing: {
        recommended_mode: 'api-first-with-agent-fallback',
        primary_path_type: 'api-path',
        primary_surfaces: ['n8n-router', 'supabase-hot-state'],
        fallback_surfaces: ['hermes-local-operator'],
        candidate_apis: ['youtube-community-scrape'],
        matched_examples: ['youtube-community-post-handoff'],
        escalation_required: false,
        escalation_target: 'none',
      },
      hermes_runtime: {
        target_role: 'persistent-local-operator',
        current_role: 'continuity-sidecar',
        readiness: 'partial',
        can_continue_without_gpt_session: true,
        queue_enabled: false,
        supervisor_alive: false,
        has_hot_state: true,
        local_operator_surface: true,
        ide_handoff_observed: false,
        queued_objectives_available: false,
        strengths: ['Hermes can continue bounded work after the GPT session releases.'],
        blockers: ['No live supervisor is holding the local continuity loop open right now.'],
        next_actions: ['Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.'],
        remediation_actions: [
          {
            action_id: 'start-supervisor-loop',
            label: 'Start Hermes queue supervisor',
          },
        ],
      },
      orchestration: {
        current_priority: 'compact-bootstrap-first',
        advisor_strategy: {
          posture: 'conditional-escalation',
          reason: 'Use advisor-style escalation only if the cheaper executor reaches a hard reasoning checkpoint after starting from the compact session-open bundle and existing route guidance.',
          max_advisor_uses: 1,
        },
        context_economics: {
          current_bottleneck: 'startup-context-footprint',
          optimization_order: ['compact session-open bundle first'],
        },
      },
      decision: {
        summary: 'Pipeline released after 1 bounded step.',
        next_action: 'promote durable operator-visible outcomes into Obsidian if the result should persist',
        promote_as: 'development_slice',
        tags: ['goal-pipeline', 'released'],
      },
      recall: {
        decision_reason: null,
        blocked_action: null,
        next_action: null,
        failed_step_names: [],
      },
      evidence_refs: [
        {
          locator: 'docs/CHANGELOG-ARCH.md',
          refKind: 'repo-file',
          title: 'Architecture changelog',
          sourceStepName: 'gate-check',
        },
      ],
      capacity: {
        score: 82,
        target: 90,
        state: 'recovering',
        loop_action: 'continue',
        primary_reason: 'gcp_openjarvis_serve_not_remote',
        continue_recommended: true,
      },
      supervisor: {
        status: 'stopped',
        launches_completed: 2,
        stop_reason: 'max_cycles_reached',
        last_launch_source: 'packet-resume',
        last_launch_at: '2026-04-12T00:01:05.000Z',
      },
      result: {
        final_status: 'released',
        step_count: 1,
        failed_steps: 0,
        latest_gate_decision: null,
        deploy_status: null,
        stale_execution_suspected: false,
      },
      personalization: {
        priority: 'balanced',
        provider_profile: 'quality-optimized',
        retrieval_profile: 'graph_lore',
        communication_style: 'concise',
        preferred_topics: ['ops'],
        prompt_hints: ['[personalization:profile] style=concise'],
      },
      read_first: ['progress-packet:plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
      recall_triggers: [],
    });
    mockRunOpenJarvisHermesRuntimeRemediation.mockResolvedValue({
      ok: true,
      actionId: 'start-supervisor-loop',
      dryRun: false,
      completion: 'queued',
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
      pid: 54321,
      startedAt: '2026-04-11T00:00:00.000Z',
      finishedAt: '2026-04-11T00:00:01.000Z',
      durationMs: 1000,
      stdoutLines: [],
      stderrLines: [],
      errorCode: null,
      error: null,
    });
    mockCreateOpenJarvisHermesRuntimeChatNote.mockResolvedValue({
      ok: true,
      completion: 'created',
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      requestTitle: 'Hermes Runtime Handoff',
      requestMessage: 'Review the current Hermes runtime state below.',
      startedAt: '2026-04-11T00:00:00.000Z',
      finishedAt: '2026-04-11T00:00:00.100Z',
      durationMs: 100,
      errorCode: null,
      error: null,
    });
    mockEnqueueOpenJarvisHermesRuntimeObjectives.mockResolvedValue({
      ok: true,
      completion: 'updated',
      requestedObjectives: ['stabilize the next GPT relaunch objective'],
      queuedObjectives: ['stabilize the next GPT relaunch objective'],
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      startedAt: '2026-04-13T00:00:00.000Z',
      finishedAt: '2026-04-13T00:00:00.100Z',
      durationMs: 100,
      errorCode: null,
      error: null,
    });
    mockLaunchOpenJarvisHermesChatSession.mockResolvedValue({
      ok: true,
      completion: 'queued',
      objective: 'stabilize the next GPT relaunch objective',
      prompt: 'Continue the next bounded local autonomy task.',
      addFilePaths: ['/vault/plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md'],
      command: 'code chat Continue the next bounded local autonomy task.',
      pid: 4321,
      startedAt: '2026-04-13T00:00:00.000Z',
      finishedAt: '2026-04-13T00:00:00.100Z',
      durationMs: 100,
      errorCode: null,
      error: null,
    });
    mockPrepareOpenJarvisHermesSessionStart.mockResolvedValue({
      ok: true,
      completion: 'prepared',
      startedAt: '2026-04-13T00:00:00.000Z',
      finishedAt: '2026-04-13T00:00:00.100Z',
      durationMs: 100,
      sharedObsidianPreferred: true,
      statusSummary: {
        readiness: 'partial',
        currentRole: 'continuity-sidecar',
        supervisorAlive: false,
        queuedObjectivesAvailable: false,
      },
      bundle: {
        objective: 'recover GCP native leverage',
        continuity: {
          next_action: 'restart the next bounded automation cycle from the active objective',
        },
      },
      chatNote: {
        ok: true,
        completion: 'created',
        notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      },
      queueObjective: null,
      remediation: {
        ok: true,
        actionId: 'start-supervisor-loop',
        dryRun: false,
        completion: 'queued',
      },
      errorCode: null,
      error: null,
    });
    mockRunOpenJarvisMemorySync.mockResolvedValue({
      ok: true,
      dryRun: true,
      force: false,
      guildId: null,
      scriptName: 'openjarvis:memory:sync:dry',
      command: 'node --import tsx scripts/sync-openjarvis-memory.ts --dryRun=true',
      completion: 'queued',
      pid: 4321,
      startedAt: '2026-04-11T00:00:00.000Z',
      finishedAt: '2026-04-11T00:00:01.000Z',
      durationMs: 1000,
      stdoutLines: ['[OPENJARVIS-MEMORY-SYNC] dry-run only: tmp/openjarvis-memory-feed'],
      stderrLines: [],
      statusBefore: mockGetOpenJarvisMemorySyncStatus(),
      statusAfter: mockGetOpenJarvisMemorySyncStatus(),
      error: null,
    });
    mockGetHermesVsCodeBridgeStatus.mockReturnValue({
      configured: true,
      repoRoot: 'C:/Muel_S/discord-news-bot',
      codeCliPath: 'C:/Users/fancy/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd',
      codeCliExists: true,
      vaultPath: '/vault',
      packetPath: '/vault/plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
      packetRelativePath: 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
      packetExists: true,
      allowedActions: ['open-agents', 'goto', 'diff', 'open', 'wait', 'chat'],
      issues: [],
    });
    mockRunHermesVsCodeBridge.mockResolvedValue({
      ok: true,
      action: 'goto',
      dryRun: false,
      completion: 'completed',
      command: '"C:/Users/fancy/AppData/Local/Programs/Microsoft VS Code/bin/code.cmd" -r -g C:/Muel_S/discord-news-bot/docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md:56',
      pid: null,
      startedAt: '2026-04-12T00:00:00.000Z',
      finishedAt: '2026-04-12T00:00:00.050Z',
      durationMs: 50,
      stdoutLines: [],
      stderrLines: [],
      statusBefore: mockGetHermesVsCodeBridgeStatus(),
      statusAfter: mockGetHermesVsCodeBridgeStatus(),
      packetLog: {
        attempted: true,
        packetPath: '/vault/plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
        packetRelativePath: 'plans/execution/HERMES_LOCAL_BOOTSTRAP_NEXT_ACTIONS.md',
        logged: true,
        entry: '- hermes_vscode_bridge: 2026-04-12T00:00:00.000Z | action=goto',
        error: null,
      },
      errorCode: null,
      error: null,
    });
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
      accessPosture: {
        mode: 'shared-remote-ingress',
        remoteHttpIngressActive: true,
      },
      vault: {
        root: '/vault',
        looksLikeDesktopVault: true,
        looksLikeRepoDocs: false,
      },
      vaultHealth: { healthy: true },
      cacheStats: { activeDocs: 8, staleDocs: 2 },
      compiler: { runs: 3, lastIndexedNotes: 10 },
      openjarvisMemorySync: {
        status: 'fresh',
        healthy: true,
        counts: { total: 5, obsidian: 2, repo: 2, supabase: 1 },
        memoryIndex: { status: 'completed' },
      },
      inboxChatLoop: { enabled: true, intervalSec: 30, processedTotal: 4 },
      graphAuditLoop: { enabled: true, intervalMin: 360, lastStatus: 'success' },
      retrievalBoundary: { metadataOnly: { available: true } },
    });
  });

  it('triggers obsidian graph audit from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/obsidian/quality/audit');

    expect(res.statusCode).toBe(202);
    expect(mockExecuteObsidianGraphAudit).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      ok: true,
      result: { lastStatus: 'success', snapshotPath: '/repo/.runtime/obsidian-graph-audit.json' },
      snapshot: { pass: true, totals: { files: 12 } },
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
      obsidianGraphAuditLoop: { enabled: true, intervalMin: 360, lastStatus: 'success' },
      retrievalEvalLoop: { enabled: true, running: false },
      rewardSignalLoop: { enabled: true, intervalHours: 6, running: false },
      evalAutoPromoteLoop: { enabled: true, intervalHours: 6, running: false },
      obsidianMaintenanceControl: { executor: 'repo-runtime', tasks: ['lore-sync', 'graph-audit'] },
      evalMaintenanceControl: { executor: 'repo-runtime', tasks: ['retrieval-eval', 'reward-signal', 'auto-promote'] },
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
        openjarvis: {
          memorySync: {
            status: 'fresh',
            healthy: true,
            counts: { total: 5, obsidian: 2 },
          },
        },
        obsidian: {
          vaultPathConfigured: true,
          vault: {
            root: '/vault',
            looksLikeDesktopVault: true,
            looksLikeRepoDocs: false,
          },
          accessPosture: {
            mode: 'shared-remote-ingress',
            remoteHttpIngressActive: true,
          },
          vaultParity: {
            compared: true,
            remoteSelectedForWrite: true,
            ok: true,
            reason: 'desktop_vault_shape_aligned',
            sameResolvedName: true,
            sharedTopLevelDirectories: ['chat', 'guilds', 'ops'],
          },
          vaultHealth: { healthy: true },
          cacheStats: { totalDocs: 10, activeDocs: 8 },
          compiler: { runs: 3, lastEntityKey: 'chat/answers/2026-04-09/test' },
          knowledgeControl: {
            controlPaths: ['ops/control-tower/BLUEPRINT.md'],
            blueprint: { model: '4-plane-control-tower' },
          },
          internalKnowledge: {
            preferredPath: 'shared-mcp-internal',
            gapCount: 1,
          },
          retrievalBoundary: { supabaseBacked: { cacheAvailable: true } },
        },
        operatingBaseline: {
          gcpWorker: { machineType: 'e2-medium', memoryGb: 4 },
          lanes: { alwaysOnRequired: ['implementWorker', 'unifiedMcp'] },
        },
        loops: {
          memoryJobRunner: { running: true },
          obsidianInboxChatLoop: { enabled: true, intervalSec: 30, processedTotal: 4 },
          obsidianLoreSyncLoop: { enabled: true, running: true },
          obsidianGraphAuditLoop: { enabled: true, intervalMin: 360, lastStatus: 'success' },
          retrievalEvalLoop: { enabled: true, running: false },
          rewardSignalLoop: { enabled: true, intervalHours: 6, running: false },
          evalAutoPromoteLoop: { enabled: true, intervalHours: 6, running: false },
        },
        controlSurfaces: {
          obsidianMaintenance: { executor: 'repo-runtime', tasks: ['lore-sync', 'graph-audit'] },
          evalMaintenance: { executor: 'repo-runtime', tasks: ['retrieval-eval', 'reward-signal', 'auto-promote'] },
        },
      },
    });
  });

  it('returns operator snapshot without requiring guildId', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/operator-snapshot', {
      query: { includePendingIntents: 'true', includeInternalKnowledge: 'true' },
    });
    const body = res.body as Record<string, any>;

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      snapshot: {
        guildId: null,
        openjarvis: {
          memorySync: {
            status: 'fresh',
            memoryIndex: { status: 'completed' },
          },
        },
        runtime: {
          schedulerPolicy: { summary: { total: 4 } },
          loops: {
            memoryJobRunner: { running: true },
            obsidianGraphAuditLoop: { enabled: true, intervalMin: 360, lastStatus: 'success' },
          },
        },
        obsidian: {
          accessPosture: { mode: 'shared-remote-ingress' },
          knowledgeControl: { blueprint: { model: '4-plane-control-tower' } },
          internalKnowledge: { preferredPath: 'shared-mcp-internal' },
          decisionTrace: { subject: 'shared MCP routing policy' },
          incidentGraph: { incident: 'unified mcp routing outage' },
        },
      },
    });
    expect(body.snapshot.obsidian.promotionBacklinks[0]).toMatchObject({
      artifactKind: 'service_profile',
      targetPath: 'ops/services/knowledge-bundle-compile-spec/PROFILE.md',
    });
  });

  it('returns active workset from the runtime route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/workset', {
      query: { guildId: 'guild-1', objective: 'active operator workset' },
    });
    const body = res.body as Record<string, any>;

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      workset: {
        objective: 'active operator workset',
        lint: { issueCount: 2 },
        decisionTrace: { subject: 'shared MCP routing policy' },
        incidentGraph: { incident: 'unified mcp routing outage' },
      },
    });
    expect(body.workset.promotionBacklinks[0]).toMatchObject({
      artifactKind: 'service_profile',
      targetPath: 'ops/services/knowledge-bundle-compile-spec/PROFILE.md',
    });
    expect(body.workset.objectRefs).toContain('ops/improvement/negative-knowledge/semantic-lint/CURRENT.md');
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
      openjarvisMemorySync: {
        status: 'fresh',
        healthy: true,
        memoryIndex: { status: 'completed' },
      },
      openjarvisAutopilot: {
        workflow: {
          session_id: 'openjarvis-1',
          runtime_lane: 'operator-personal',
          lastRecallRequest: {
            blockedAction: 'planActions',
            runtimeLane: 'operator-personal',
          },
          lastDecisionDistillate: {
            summary: 'Pipeline released after 1 bounded step.',
            promoteAs: 'development_slice',
          },
          lastArtifactRefs: [
            {
              locator: 'docs/CHANGELOG-ARCH.md',
              refKind: 'repo-file',
            },
          ],
        },
        capacity: {
          score: 82,
          state: 'recovering',
          loop_action: 'continue',
        },
        gcp_native: {
          score: 64,
          primary_reason: 'gcp_openjarvis_serve_not_remote',
        },
        gcp_capacity_recovery_requested: true,
      },
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

  it('returns OpenJarvis autopilot status from the runtime admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/openjarvis/autopilot', {
      query: {
        capacityTarget: '95',
        gcpCapacityRecovery: 'true',
        runtimeLane: 'operator-personal',
      },
    });

    expect(mockGetOpenJarvisAutopilotStatus).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: 95,
      gcpCapacityRecoveryRequested: true,
      runtimeLane: 'operator-personal',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: {
        workflow: {
          session_id: 'openjarvis-1',
          lastRecallRequest: {
            nextAction: 'resume bounded GCP capacity recovery until capacity reaches 90',
          },
          lastDecisionDistillate: {
            summary: 'Pipeline released after 1 bounded step.',
            promoteAs: 'development_slice',
          },
          lastArtifactRefs: [
            {
              locator: 'docs/CHANGELOG-ARCH.md',
              refKind: 'repo-file',
            },
          ],
        },
        capacity: {
          score: 82,
        },
        supervisor: {
          auto_select_queued_objective: true,
          auto_launch_queued_chat: true,
        },
      },
    });
  });

  it('returns OpenJarvis session-open bundle from the runtime admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/openjarvis/session-open-bundle', {
      query: {
        capacityTarget: '95',
        gcpCapacityRecovery: 'false',
        runtimeLane: 'operator-personal',
        guildId: 'guild-1',
        userId: 'user-1',
        priority: 'precise',
        skillId: 'review',
      },
    });

    expect(mockResolveAgentPersonalizationSnapshot).toHaveBeenCalledWith({
      guildId: 'guild-1',
      userId: 'user-1',
      requestedPriority: 'precise',
      requestedSkillId: 'review',
    });
    expect(mockGetOpenJarvisSessionOpenBundle).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: 95,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      personalizationSnapshot: expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-1',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      bundle: {
        objective: 'recover GCP native leverage',
        continuity: {
          auto_restart_on_release: true,
          next_action: 'restart the next bounded automation cycle from the active objective',
        },
        hermes_runtime: {
          readiness: 'partial',
          current_role: 'continuity-sidecar',
          can_continue_without_gpt_session: true,
        },
        orchestration: {
          current_priority: 'compact-bootstrap-first',
          advisor_strategy: {
            posture: 'conditional-escalation',
          },
        },
        personalization: {
          communication_style: 'concise',
        },
      },
    });
  });

  it('returns the Hermes runtime readiness block directly', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/openjarvis/hermes-runtime', {
      query: {
        runtimeLane: 'operator-personal',
      },
    });

    expect(mockGetOpenJarvisAutopilotStatus).toHaveBeenCalledWith(expect.objectContaining({
      runtimeLane: 'operator-personal',
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      hermesRuntime: {
        readiness: 'partial',
        current_role: 'continuity-sidecar',
        remediation_actions: [
          {
            action_id: 'start-supervisor-loop',
          },
        ],
      },
    });
  });

  it('prepares the OpenJarvis session-start state through the admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/session-start', {
      body: {
        objective: 'stabilize the next GPT relaunch objective',
        runtimeLane: 'operator-personal',
        startSupervisor: true,
        createChatNote: true,
      },
      user: { id: 'admin-user' },
    });

    expect(mockPrepareOpenJarvisHermesSessionStart).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      objective: 'stabilize the next GPT relaunch objective',
      objectives: [],
      title: null,
      guildId: null,
      createChatNote: true,
      startSupervisor: true,
      dryRun: false,
      visibleTerminal: true,
      requesterId: 'admin-user',
      requesterKind: 'session',
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        completion: 'prepared',
        sharedObsidianPreferred: true,
        remediation: {
          actionId: 'start-supervisor-loop',
          completion: 'queued',
        },
      },
    });
  });

  it('creates an Obsidian chat note seeded with the Hermes runtime state', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/hermes-runtime/chat-note', {
      body: {
        title: 'Hermes Runtime Follow-up',
        runtimeLane: 'operator-personal',
      },
      user: { id: 'admin-user' },
    });

    expect(mockCreateOpenJarvisHermesRuntimeChatNote).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      title: 'Hermes Runtime Follow-up',
      guildId: null,
      requesterId: 'admin-user',
      requesterKind: 'session',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        completion: 'created',
        fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      },
    });
  });

  it('queues the next bounded objective into the Hermes continuity packet', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/hermes-runtime/queue-objective', {
      body: {
        objective: 'stabilize the next GPT relaunch objective',
        runtimeLane: 'operator-personal',
      },
    });

    expect(mockEnqueueOpenJarvisHermesRuntimeObjectives).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      objective: 'stabilize the next GPT relaunch objective',
      objectives: [],
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        completion: 'updated',
        queuedObjectives: ['stabilize the next GPT relaunch objective'],
      },
    });
  });

  it('launches the next bounded Hermes objective into VS Code chat', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/hermes-runtime/chat-launch', {
      body: {
        objective: 'stabilize the next GPT relaunch objective',
        runtimeLane: 'operator-personal',
        addFilePaths: ['docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md'],
      },
    });

    expect(mockLaunchOpenJarvisHermesChatSession).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      objective: 'stabilize the next GPT relaunch objective',
      prompt: null,
      chatMode: null,
      addFilePaths: ['docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md'],
      maximize: true,
      newWindow: false,
      reuseWindow: true,
      dryRun: false,
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        completion: 'queued',
        objective: 'stabilize the next GPT relaunch objective',
      },
    });
  });

  it('runs a Hermes runtime remediation action', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/hermes-runtime/remediate', {
      body: {
        actionId: 'start-supervisor-loop',
        runtimeLane: 'operator-personal',
        visibleTerminal: true,
      },
    });

    expect(mockRunOpenJarvisHermesRuntimeRemediation).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      actionId: 'start-supervisor-loop',
      dryRun: false,
      visibleTerminal: true,
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        actionId: 'start-supervisor-loop',
        completion: 'queued',
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

  it('runs OpenJarvis memory sync from the runtime admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    mockRunOpenJarvisMemorySync.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      force: true,
      guildId: 'guild-1',
      scriptName: 'openjarvis:memory:sync',
      command: 'node --import tsx scripts/sync-openjarvis-memory.ts --force=true --guildId=guild-1',
      completion: 'queued',
      pid: 9876,
      startedAt: '2026-04-11T00:00:00.000Z',
      finishedAt: '2026-04-11T00:00:00.100Z',
      durationMs: 100,
      stdoutLines: [],
      stderrLines: [],
      statusBefore: mockGetOpenJarvisMemorySyncStatus(),
      statusAfter: mockGetOpenJarvisMemorySyncStatus(),
      error: null,
    });

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/openjarvis/memory-sync', {
      body: {
        dryRun: false,
        force: true,
        guildId: 'guild-1',
      },
    });

    expect(mockRunOpenJarvisMemorySync).toHaveBeenCalledWith({
      dryRun: false,
      force: true,
      guildId: 'guild-1',
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        completion: 'queued',
        pid: 9876,
        command: 'node --import tsx scripts/sync-openjarvis-memory.ts --force=true --guildId=guild-1',
      },
    });
  });

  it('returns Hermes VS Code bridge status from the runtime admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/hermes/vscode-bridge');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      status: {
        configured: true,
        codeCliExists: true,
        packetExists: true,
        allowedActions: ['open-agents', 'goto', 'diff', 'open', 'wait', 'chat'],
      },
    });
  });

  it('runs Hermes VS Code bridge from the runtime admin route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/runtime/hermes/vscode-bridge', {
      body: {
        action: 'goto',
        filePath: 'docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md',
        line: 56,
        reason: 'inspect allowlist section',
      },
    });

    expect(mockRunHermesVsCodeBridge).toHaveBeenCalledWith({
      action: 'goto',
      filePath: 'docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md',
      targetPath: null,
      leftPath: null,
      rightPath: null,
      line: 56,
      column: null,
      reason: 'inspect allowlist section',
      packetPath: null,
      codeCliPath: null,
      vaultPath: null,
      prompt: null,
      chatMode: null,
      addFilePaths: [],
      maximize: false,
      newWindow: false,
      reuseWindow: true,
      dryRun: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        action: 'goto',
        completion: 'completed',
        packetLog: { logged: true },
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
      vault: {
        root: '/vault',
        looksLikeDesktopVault: true,
        looksLikeRepoDocs: false,
      },
      compiler: { runs: 3, lastLintSummary: { issueCount: 1 } },
      artifactPaths: ['ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LINT.md'],
      controlPaths: ['ops/control-tower/BLUEPRINT.md'],
      blueprint: { model: '4-plane-control-tower' },
      bundleSupport: { queryParam: 'bundleFor' },
      artifact: {
        request: 'lint',
        path: 'ops/knowledge-control/LINT.md',
      },
    });
    const body = res.body as { artifact?: { content?: string | null } };
    expect(body.artifact?.content).toContain('Test Note');
  });

  it('returns reflection bundle recommendations for bundleFor targets', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/knowledge-control', {
      query: { bundleFor: 'ops/services/unified-mcp/PROFILE.md' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      bundle: {
        targetPath: 'ops/services/unified-mcp/PROFILE.md',
        plane: 'runtime',
        concern: 'service-memory',
      },
    });
  });

  it('returns compiled knowledge bundle from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/knowledge-bundle', {
      query: {
        goal: 'operator routing',
        domains: 'architecture',
        sourceHints: 'obsidian',
        explicitSources: 'https://www.anthropic.com/engineering/managed-agents',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      bundle: {
        summary: 'Compiled 2 artifacts for operator routing.',
        resolutionTrace: ['repo-docs'],
      },
    });
    expect(mockCompileObsidianKnowledgeBundle).toHaveBeenCalledWith(expect.objectContaining({
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
    }));
  });

  it('returns internal knowledge resolution from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/internal-knowledge', {
      query: { goal: 'operator routing', targets: 'shared MCP,company-context' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        preferredPath: 'shared-mcp-internal',
        accessNotes: ['Prefer the shared MCP internal knowledge surface before assuming repo-local context is complete.'],
      },
    });
  });

  it('returns compiled requirement from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/requirement-compile', {
      query: {
        objective: 'Compile a requirement for shared MCP routing.',
        desiredArtifact: 'requirement',
        explicitSources: 'https://www.anthropic.com/engineering/managed-agents',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        problem: 'Compile a requirement for shared MCP routing.',
        workflows: ['shared MCP routing and internal knowledge resolution', 'shared Obsidian wikiization and backfill'],
      },
    });
    expect(mockCompileObsidianRequirement).toHaveBeenCalledWith(expect.objectContaining({
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
    }));
  });

  it('returns decision trace from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/decision-trace', {
      query: {
        subject: 'shared MCP routing policy',
        explicitSources: 'https://www.anthropic.com/engineering/managed-agents',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        subject: 'shared MCP routing policy',
        contradictions: [{ kind: 'runtime-doc-mismatch' }],
      },
    });
    expect(mockTraceObsidianDecision).toHaveBeenCalledWith(expect.objectContaining({
      explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
    }));
  });

  it('returns incident graph from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/incident-graph', {
      query: {
        incident: 'unified mcp routing outage',
        serviceHints: 'unified-mcp',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        incident: 'unified mcp routing outage',
        affectedServices: ['unified-mcp'],
        relatedPlaybooks: ['ops/playbooks/unified-mcp-recovery.md'],
      },
    });
    expect(mockResolveObsidianIncidentGraph).toHaveBeenCalledWith(expect.objectContaining({
      incident: 'unified mcp routing outage',
    }));
  });

  it('returns knowledge promotion result from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/obsidian/knowledge-promote', {
      body: {
        artifactKind: 'note',
        title: 'Shared Routing',
        content: 'Promoted shared routing knowledge with provenance and stable ownership.',
        sources: ['repo:docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
        confidence: 0.91,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        status: 'written',
        targetPath: 'ops/contexts/repos/shared-routing.md',
      },
    });
  });

  it('rejects unknown knowledge promotion artifact kinds from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/obsidian/knowledge-promote', {
      body: {
        artifactKind: 'service_profile',
        title: 'Shared Routing',
        content: 'Promoted shared routing knowledge with provenance and stable ownership.',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'VALIDATION',
    });
    expect((res.body as { message?: string }).message).toContain('artifactKind must be one of');
  });

  it('rejects unsafe privacy regex rules instead of silently persisting them', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'PUT', '/agent/privacy/policy', {
      body: {
        guildId: 'guild-1',
        modeDefault: 'guarded',
        reviewScore: 60,
        blockScore: 80,
        reviewPatterns: [{ pattern: '(a+)+', score: 25, reason: 'unsafe-test' }],
        blockPatterns: [],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'VALIDATION',
    });
    expect((res.body as { message?: string }).message).toContain('reviewPatterns[0].pattern looks unsafe');
  });

  it('rejects lossy channel routing keys instead of silently rewriting them', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'PUT', '/agent/runtime/channel-routing', {
      body: {
        guildId: 'guild-1',
        channels: {
          'discord/main': 'native',
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      ok: false,
      error: 'VALIDATION',
    });
    expect((res.body as { message?: string }).message).toContain('Invalid channel key');
  });

  it('returns semantic lint audit from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/obsidian/semantic-lint-audit');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        healthy: false,
        issueCount: 2,
      },
    });
  });

  it('returns personalization snapshot from the runtime route', async () => {
    const { registerBotAgentRuntimeRoutes } = await import('./bot-agent/runtimeRoutes');
    const router = Router();

    registerBotAgentRuntimeRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'GET', '/agent/runtime/personalization', {
      query: {
        guildId: 'guild-1',
        userId: 'user-1',
        priority: 'precise',
        skillId: 'incident-review',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockResolveAgentPersonalizationSnapshot).toHaveBeenCalledWith({
      guildId: 'guild-1',
      userId: 'user-1',
      requestedPriority: 'precise',
      requestedSkillId: 'incident-review',
    });
    expect(res.body).toMatchObject({
      ok: true,
      snapshot: {
        userId: 'user-1',
        promptHints: ['[personalization:profile] style=concise'],
      },
    });
  });

  it('returns wiki change capture result from the admin route', async () => {
    const { registerBotAgentQualityPrivacyRoutes } = await import('./bot-agent/qualityPrivacyRoutes');
    const router = Router();

    registerBotAgentQualityPrivacyRoutes({
      router,
      adminActionRateLimiter: noop,
      adminIdempotency: noop,
      opencodeIdempotency: noop,
    });

    const res = await invokeRoute(router, 'POST', '/agent/obsidian/wiki-change-capture', {
      body: {
        changeSummary: 'operator routing update',
        changeKind: 'development-slice',
        changedPaths: ['docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
        promoteImmediately: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      result: {
        classification: ['development_slice'],
        wikiTargets: ['plans/development/2026-04-11_operator-routing.md'],
      },
    });
  });
});