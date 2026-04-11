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
  mockGetRuntimeSchedulerPolicySnapshot,
  mockGetPendingIntentCount,
  mockListAgentRoleWorkerSpecs,
  mockProbeHttpWorkerHealth,
  mockSummarizeOpencodeQueueReadiness,
  mockLoadOperatingBaseline,
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
  mockGetRuntimeSchedulerPolicySnapshot: vi.fn(),
  mockGetPendingIntentCount: vi.fn(),
  mockListAgentRoleWorkerSpecs: vi.fn(),
  mockProbeHttpWorkerHealth: vi.fn(),
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
    mockGetRetrievalEvalLoopStats.mockReturnValue({ enabled: true, running: false });
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
          retrievalEvalLoop: { enabled: true, running: false },
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
        runtime: {
          schedulerPolicy: { summary: { total: 4 } },
          loops: { memoryJobRunner: { running: true } },
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