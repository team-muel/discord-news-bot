import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockExecuteObsidianLoreSync,
  mockExecuteObsidianGraphAudit,
} = vi.hoisted(() => ({
  mockExecuteObsidianLoreSync: vi.fn(),
  mockExecuteObsidianGraphAudit: vi.fn(),
}));

// Mock Obsidian service dependencies before import
vi.mock('../services/obsidian/router', () => ({
  searchObsidianVaultWithAdapter: vi.fn().mockResolvedValue([
    { filePath: 'docs/architecture.md', title: 'Architecture', score: 0.9, snippet: 'system overview' },
  ]),
  readObsidianFileWithAdapter: vi.fn().mockResolvedValue('# Test Note\nContent here'),
  getObsidianGraphMetadataWithAdapter: vi.fn().mockResolvedValue({
    'docs/architecture.md': { filePath: 'docs/architecture.md', title: 'Architecture', tags: ['arch'], backlinks: [], links: [] },
  }),
  writeObsidianNoteWithAdapter: vi.fn().mockResolvedValue({ path: 'docs/new-note.md' }),
  getObsidianAdapterRuntimeStatus: vi.fn().mockReturnValue({
    strictMode: false,
    configuredOrder: ['local-fs'],
    configuredOrderByCapability: {},
    adapters: [{ id: 'local-fs', available: true, capabilities: ['read_lore', 'search_vault'] }],
    selectedByCapability: { read_lore: 'local-fs', search_vault: 'local-fs' },
  }),
  getObsidianVaultLiveHealthStatus: vi.fn().mockResolvedValue({
    healthy: true,
    issues: [],
    vaultPathConfigured: true,
    writeCapable: true,
    readCapable: true,
    searchCapable: true,
    remoteMcp: {
      lastProbe: { reachable: true },
    },
  }),
}));

import { writeObsidianNoteWithAdapter } from '../services/obsidian/router';

vi.mock('../services/obsidian/obsidianRagService', () => ({
  queryObsidianRAG: vi.fn().mockResolvedValue({
    answer: 'The architecture uses graph-first retrieval.',
    documents: [{ filePath: 'docs/architecture.md', score: 0.9 }],
    intent: 'architecture',
    metadataSignals: {
      activeDocs: 1,
      invalidDocs: 0,
      supersededDocs: 0,
      sourcedDocs: 1,
    },
  }),
  getObsidianRetrievalBoundarySnapshot: vi.fn().mockResolvedValue({
    metadataOnly: {
      available: true,
      requiresVault: true,
      signals: ['status', 'valid_at'],
      responsibilities: ['semantic truth'],
    },
    supabaseBacked: {
      configured: true,
      cacheAvailable: true,
      cacheStats: {
        enabled: true,
        supabaseConfigured: true,
        ttlMs: 3600000,
        pendingHitEntries: 0,
        totalDocs: 42,
        activeDocs: 40,
        staleDocs: 2,
        totalHits: 150,
        averageHitsPerDoc: 3.57,
      },
      responsibilities: ['cache'],
    },
  }),
}));

vi.mock('../services/obsidian/obsidianCacheService', () => ({
  getCacheStats: vi.fn().mockResolvedValue({
    enabled: true,
    supabaseConfigured: true,
    ttlMs: 3600000,
    pendingHitEntries: 0,
    totalDocs: 42,
    activeDocs: 40,
    staleDocs: 2,
    totalHits: 150,
    averageHitsPerDoc: 3.57,
  }),
}));

vi.mock('../services/obsidian/obsidianLoreSyncService', () => ({
  getObsidianLoreSyncLoopStats: vi.fn().mockReturnValue({
    enabled: true,
    owner: 'app',
    running: false,
    intervalMin: 60,
    lastStatus: 'success',
  }),
}));

vi.mock('../services/obsidian/obsidianQualityService', () => ({
  getLatestObsidianGraphAuditSnapshot: vi.fn().mockResolvedValue({
    generatedAt: '2026-04-04T00:00:00Z',
    vaultPath: '/vault',
    totals: { files: 100, unresolvedLinks: 2, ambiguousLinks: 0, orphanFiles: 5, deadendFiles: 3, missingRequiredPropertyFiles: 1 },
    topTags: [{ tag: 'architecture', count: 20 }],
    thresholds: { unresolvedLinks: 10, ambiguousLinks: 5, orphanFiles: 20, deadendFiles: 10, missingRequiredPropertyFiles: 5 },
    pass: true,
  }),
}));

vi.mock('../services/obsidian/obsidianMaintenanceControlService', () => ({
  executeObsidianLoreSync: mockExecuteObsidianLoreSync,
  executeObsidianGraphAudit: mockExecuteObsidianGraphAudit,
}));

vi.mock('../services/obsidian/knowledgeCompilerService', () => ({
  buildObsidianKnowledgeReflectionBundle: vi.fn((value: string) => ({
    targetPath: value === 'blueprint' ? 'ops/control-tower/BLUEPRINT.md' : value,
    plane: value === 'blueprint' ? 'control' : 'runtime',
    concern: value === 'blueprint' ? 'control-tower' : 'service-memory',
    requiredPaths: ['ops/knowledge-control/INDEX.md', 'ops/knowledge-control/LOG.md'],
    suggestedPaths: ['ops/control-tower/GATE_ENTRYPOINTS.md'],
    suggestedPatterns: ['ops/services/unified-mcp/RECOVERY.md'],
    verificationChecklist: ['search visibility verified in the user-visible vault'],
    gatePaths: ['ops/quality/gates/2026-04-10_visible-reflection-gate.md'],
    customerImpact: false,
    notes: ['test bundle'],
  })),
  getObsidianKnowledgeControlSurface: vi.fn().mockReturnValue({
    compiler: {
      enabled: true,
      runs: 3,
      skipped: 1,
      failures: 0,
      lastTriggeredAt: '2026-04-09T00:00:00.000Z',
      lastCompiledAt: '2026-04-09T00:00:01.000Z',
      lastNotePath: 'chat/answers/2026-04-09/current.md',
      lastReason: null,
      lastArtifacts: ['ops/knowledge-control/INDEX.md'],
      lastTopics: ['development'],
      lastEntityKey: 'chat/thread-1',
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
          filePaths: ['chat/answers/2026-04-09/current.md'],
        }],
      },
    },
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
    pathIndex: [{
      path: 'ops/control-tower/BLUEPRINT.md',
      plane: 'control',
      concern: 'control-tower',
      generated: false,
    }],
  }),
  compileObsidianKnowledgeBundle: vi.fn().mockResolvedValue({
    summary: 'Compiled 2 artifacts for operator routing.',
    facts: [{
      id: 'fact-1',
      statement: 'Shared knowledge questions should try shared MCP first.',
      confidence: 0.94,
      sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'],
      freshness: 'current',
      factType: 'decision',
    }],
    artifacts: [{
      id: 'artifact-1',
      artifactType: 'obsidian-note',
      title: 'Shared Knowledge Routing',
      locator: 'ops/control-tower/BLUEPRINT.md',
      whyIncluded: 'start-here canonical artifact',
      confidence: 0.95,
      preview: '# Shared Knowledge Routing',
      sourceRole: 'supporting',
    }],
    gaps: [],
    recommendedPromotions: [],
    resolutionTrace: ['shared-obsidian'],
    confidence: 0.91,
    inputs: {
      goal: 'operator routing',
      domains: ['architecture'],
      sourceHints: ['obsidian'],
      explicitSources: [],
      includeLocalOverlay: false,
      audience: 'engineering',
    },
  }),
  resolveInternalKnowledge: vi.fn().mockResolvedValue({
    summary: 'Resolved 2 internal knowledge artifacts via shared-mcp-internal.',
    facts: [{
      id: 'fact-1',
      statement: 'Shared MCP internal surfaces should be preferred before repo-local archaeology.',
      confidence: 0.93,
      sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'],
      freshness: 'current',
      factType: 'decision',
    }],
    artifacts: [{
      id: 'artifact-1',
      artifactType: 'obsidian-note',
      title: 'Shared Knowledge Routing',
      locator: 'ops/control-tower/BLUEPRINT.md',
      whyIncluded: 'start-here canonical artifact',
      confidence: 0.95,
      preview: '# Shared Knowledge Routing',
    }],
    redactions: [],
    accessNotes: ['Prefer the shared MCP internal knowledge surface before assuming repo-local context is complete.'],
    gaps: [{
      id: 'gap-access-internal-knowledge',
      gapType: 'access',
      description: 'Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.',
      severity: 'medium',
      suggestedNextStep: 'Route this query through the shared MCP internal knowledge surface before assuming the repository is complete.',
    }],
    preferredPath: 'shared-mcp-internal',
    confidence: 0.88,
  }),
  promoteKnowledgeToObsidian: vi.fn().mockResolvedValue({
    status: 'written',
    writtenArtifacts: ['ops/contexts/repos/shared-routing.md'],
    skippedReasons: [],
    targetPath: 'ops/contexts/repos/shared-routing.md',
    canonicalKey: 'repo/shared-routing',
  }),
  runObsidianSemanticLintAudit: vi.fn().mockResolvedValue({
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
  }),
  compileObsidianRequirement: vi.fn().mockResolvedValue({
    problem: 'Compile a requirement for shared MCP routing.',
    constraints: ['Preserve existing runtime behavior'],
    entities: ['Shared Knowledge Routing', 'Unified MCP'],
    workflows: ['shared MCP routing and internal knowledge resolution', 'shared Obsidian wikiization and backfill'],
    capabilityGaps: ['Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.'],
    openQuestions: ['Which shared MCP or internal surface should answer this access gap: Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.'],
    recommendedNextArtifacts: ['requirement: Shared Knowledge Routing'],
    sourceArtifacts: [{
      id: 'artifact-trigger-1',
      artifactType: 'internal-doc',
      title: 'anthropic.com/engineering/managed-agents',
      locator: 'https://www.anthropic.com/engineering/managed-agents',
      whyIncluded: 'explicit trigger source supplied by the caller',
      confidence: 0.68,
      preview: 'Explicit trigger source preserved for human-visible provenance.',
      sourceRole: 'trigger',
    }],
    confidence: 0.87,
    bundleSummary: 'Compiled 2 artifacts for operator routing.',
  }),
  traceObsidianDecision: vi.fn().mockResolvedValue({
    subject: 'shared MCP routing policy',
    summary: 'Traced "shared MCP routing policy" through 2 artifacts, 1 contradiction signals, and 1 explicit gaps.',
    facts: [{ id: 'fact-1', statement: 'Shared MCP should be preferred first.', confidence: 0.91, sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'], freshness: 'current', factType: 'decision' }],
    artifacts: [{ id: 'artifact-1', artifactType: 'obsidian-note', title: 'Shared Knowledge Routing', locator: 'ops/control-tower/BLUEPRINT.md', whyIncluded: 'start-here canonical artifact', confidence: 0.95, preview: '# Shared Knowledge Routing', sourceRole: 'supporting' }],
    gaps: [{ id: 'gap-1', gapType: 'promotion-needed', description: 'Repo mirror still needs shared promotion.', severity: 'medium', suggestedNextStep: 'Promote the repo mirror to shared vault.' }],
    trace: [{ id: 'trace-1', stepKind: 'artifact', title: 'Shared Knowledge Routing', locator: 'ops/control-tower/BLUEPRINT.md', reason: 'start-here canonical artifact', sourceRole: 'supporting' }],
    contradictions: [{ id: 'issue-1', kind: 'runtime-doc-mismatch', severity: 'medium', message: 'Runtime routing still exposes a stale fallback.', evidenceRefs: ['ops/control-tower/BLUEPRINT.md'], suggestedNextStep: 'Align runtime fallback behavior with the control-tower policy.' }],
    supersedes: ['docs/archive/legacy-routing.md'],
    confidence: 0.88,
  }),
  resolveObsidianIncidentGraph: vi.fn().mockResolvedValue({
    incident: 'unified mcp routing outage',
    summary: 'Resolved incident graph for "unified mcp routing outage" from 3 artifacts across 1 services with 1 blockers and 2 next actions.',
    facts: [{ id: 'fact-1', statement: 'Unified MCP routing degraded before fallback engaged.', confidence: 0.9, sourceRefs: ['vault:ops/incidents/2026-04-11_unified-mcp-routing.md'], freshness: 'shared-vault', factType: 'runtime' }],
    artifacts: [{ id: 'artifact-1', artifactType: 'obsidian-note', title: 'Unified MCP Routing Incident', locator: 'ops/incidents/2026-04-11_unified-mcp-routing.md', whyIncluded: 'direct shared retrieval matched incident graph', confidence: 0.94, preview: '# Unified MCP Routing Incident', sourceRole: 'supporting' }],
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
  }),
  captureObsidianWikiChange: vi.fn().mockResolvedValue({
    classification: ['development_slice'],
    wikiTargets: ['plans/development/2026-04-11_operator-routing.md'],
    writtenArtifacts: ['plans/development/2026-04-11_operator-routing.md'],
    mirrorUpdates: ['CHANGELOG-ARCH'],
    followUps: [],
    gaps: [],
    matchedCatalogEntries: ['service-mcp-tool-first-contracts'],
  }),
  resolveObsidianKnowledgeArtifactPath: vi.fn((artifact: string) => {
    if (artifact === 'lint') return 'ops/knowledge-control/LINT.md';
    if (artifact === 'blueprint') return 'ops/control-tower/BLUEPRINT.md';
    return null;
  }),
}));

vi.mock('../routes/bot-agent/runtimeRoutes', () => ({
  buildOperatorSnapshot: vi.fn().mockResolvedValue({
    generatedAt: '2026-04-11T00:00:00.000Z',
    guildId: 'guild-1',
    windowDays: 14,
    operatingBaseline: {
      gcpWorker: { machineType: 'e2-medium', memoryGb: 4 },
    },
    runtime: {
      schedulerPolicy: { summary: { total: 4 } },
      workers: { specs: [{ label: 'implement' }], health: [{ label: 'implement', healthy: true }] },
      loops: { memoryJobRunner: { running: true } },
    },
    obsidian: {
      knowledgeControl: { blueprint: { model: '4-plane-control-tower' } },
      internalKnowledge: {
        preferredPath: 'shared-mcp-internal',
        confidence: 0.88,
      },
      decisionTrace: {
        subject: 'active operator workset',
        summary: 'Traced active operator workset through canonical artifacts.',
      },
      incidentGraph: {
        incident: 'active operator workset incident',
        summary: 'Resolved incident graph for active operator workset incident.',
      },
      promotionBacklinks: [{
        artifactKind: 'service_profile',
        title: 'Knowledge Bundle Compile Spec',
        reason: 'resolved from repo source fallback instead of shared vault content',
        targetPath: 'ops/services/knowledge-bundle-compile-spec/PROFILE.md',
        sourceRefs: ['repo:docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md'],
      }],
    },
  }),
  buildActiveWorkset: vi.fn().mockResolvedValue({
    generatedAt: '2026-04-11T00:00:00.000Z',
    guildId: 'guild-1',
    objective: 'active operator workset',
    summary: 'Resolved active workset from 2 compiled artifacts with 1 blockers and 2 next actions.',
    currentFocus: ['Shared Knowledge Routing'],
    blockers: ['2 shared wiki targets are still missing from the configured vault mirror.'],
    nextActions: ['Backfill missing shared wiki targets before treating repo mirrors as canonical.'],
    affectedServices: ['unified-mcp'],
    evidence: [{ title: 'Shared Knowledge Routing', locator: 'ops/control-tower/BLUEPRINT.md', whyIncluded: 'start-here canonical artifact' }],
    objectRefs: ['ops/control-tower/BLUEPRINT.md'],
    decisionTrace: { subject: 'active operator workset' },
    incidentGraph: { incident: 'active operator workset incident' },
    promotionBacklinks: [{ targetPath: 'ops/services/knowledge-bundle-compile-spec/PROFILE.md' }],
    lint: { healthy: false, issueCount: 2 },
    releaseGate: { decision: 'GO', failedChecks: [] },
    pendingIntentCount: 2,
  }),
}));

vi.mock('../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn().mockReturnValue('/test-vault'),
  getObsidianVaultRuntimeInfo: vi.fn().mockReturnValue({
    configured: true,
    root: '/test-vault',
    configuredName: 'Obsidian Vault',
    resolvedName: 'Obsidian Vault',
    exists: true,
    topLevelDirectories: ['chat', 'guilds', 'ops'],
    topLevelFiles: [],
    looksLikeDesktopVault: true,
    looksLikeRepoDocs: false,
  }),
}));

import { listObsidianMcpTools, callObsidianMcpTool, OBSIDIAN_TOOL_NAMES } from './obsidianToolAdapter';

describe('obsidianToolAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteObsidianLoreSync.mockResolvedValue({
      lastStatus: 'success',
      lastSummary: 'sync ok',
    });
    mockExecuteObsidianGraphAudit.mockResolvedValue({
      result: { lastStatus: 'success', lastSummary: 'audit ok' },
      snapshot: { pass: true, totals: { files: 100 } },
    });
  });

  describe('listObsidianMcpTools', () => {
    it('returns all obsidian tools with valid specs', () => {
      const tools = listObsidianMcpTools();
      expect(tools.length).toBe(33);

      const names = tools.map((t) => t.name);
      expect(names).toContain('obsidian.search');
      expect(names).toContain('obsidian.rag');
      expect(names).toContain('obsidian.read');
      expect(names).toContain('obsidian.graph');
      expect(names).toContain('obsidian.write');
      expect(names).toContain('obsidian.sync.status');
      expect(names).toContain('obsidian.sync.run');
      expect(names).toContain('obsidian.cache.stats');
      expect(names).toContain('obsidian.quality.audit');
      expect(names).toContain('obsidian.quality.audit.run');
      expect(names).toContain('obsidian.adapter.status');
      expect(names).toContain('obsidian.knowledge.control');
      expect(names).toContain('knowledge.bundle.compile');
      expect(names).toContain('internal.knowledge.resolve');
      expect(names).toContain('requirement.compile');
      expect(names).toContain('operator.snapshot');
      expect(names).toContain('workset.resolve');
      expect(names).toContain('decision.trace');
      expect(names).toContain('incident.graph.resolve');
      expect(names).toContain('wiki.change.capture');
      expect(names).toContain('knowledge.promote');
      expect(names).toContain('semantic.lint.audit');
      expect(names).toContain('obsidian.outline');
      expect(names).toContain('obsidian.search.context');
      expect(names).toContain('obsidian.property.read');
      expect(names).toContain('obsidian.property.set');
      expect(names).toContain('obsidian.files');
      expect(names).toContain('obsidian.daily.read');
      expect(names).toContain('obsidian.daily.append');
      expect(names).toContain('obsidian.tasks');
      expect(names).toContain('obsidian.task.toggle');
      expect(names).toContain('obsidian.append');
    });

    it('each tool has a valid inputSchema', () => {
      const tools = listObsidianMcpTools();
      for (const tool of tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.description).toBeTruthy();
      }
    });

    it('returns copies to prevent mutation', () => {
      const a = listObsidianMcpTools();
      const b = listObsidianMcpTools();
      expect(a).not.toBe(b);
      expect(a[0]).not.toBe(b[0]);
    });
  });

  describe('OBSIDIAN_TOOL_NAMES', () => {
    it('contains all tool names', () => {
      expect(OBSIDIAN_TOOL_NAMES.size).toBe(33);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.search')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.write')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.sync.run')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.knowledge.control')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('knowledge.bundle.compile')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('internal.knowledge.resolve')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('requirement.compile')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('operator.snapshot')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('workset.resolve')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('decision.trace')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('incident.graph.resolve')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('wiki.change.capture')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('knowledge.promote')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('semantic.lint.audit')).toBe(true);
    });
  });

  describe('callObsidianMcpTool', () => {
    it('returns error for empty name', async () => {
      const result = await callObsidianMcpTool({ name: '' });
      expect(result.isError).toBe(true);
    });

    it('returns error for unknown tool', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.nonexistent' });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Unknown obsidian tool');
    });

    // ── obsidian.search ──────────────────────────────────────────────────
    it('obsidian.search requires keyword', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.search', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('keyword is required');
    });

    it('obsidian.search returns results', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.search',
        arguments: { keyword: 'architecture' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '[]');
      expect(data).toHaveLength(1);
      expect(data[0].filePath).toBe('docs/architecture.md');
    });

    // ── obsidian.rag ─────────────────────────────────────────────────────
    it('obsidian.rag requires question', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.rag', arguments: {} });
      expect(result.isError).toBe(true);
    });

    it('obsidian.rag returns RAG result', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.rag',
        arguments: { question: 'What is the architecture?' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.intent).toBe('architecture');
    });

    // ── obsidian.read ────────────────────────────────────────────────────
    it('obsidian.read requires filePath', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.read', arguments: {} });
      expect(result.isError).toBe(true);
    });

    it('obsidian.read blocks path traversal', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.read',
        arguments: { filePath: '../../../etc/passwd' },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('path traversal');
    });

    it('obsidian.read blocks absolute paths', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.read',
        arguments: { filePath: 'C:\\vault\\secret.md' },
      });
      expect(result.isError).toBe(true);
    });

    it('obsidian.read returns file content', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.read',
        arguments: { filePath: 'docs/architecture.md' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toContain('Test Note');
    });

    // ── obsidian.graph ───────────────────────────────────────────────────
    it('obsidian.graph returns metadata', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.graph' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.nodeCount).toBe(1);
    });

    // ── obsidian.write ───────────────────────────────────────────────────
    it('obsidian.write requires fileName', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.write',
        arguments: { content: 'test content' },
      });
      expect(result.isError).toBe(true);
    });

    it('obsidian.write requires content', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.write',
        arguments: { fileName: 'test.md' },
      });
      expect(result.isError).toBe(true);
    });

    it('obsidian.write blocks unsafe filenames', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.write',
        arguments: { fileName: 'test<script>.md', content: '# Safe content here with enough chars' },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('unsafe characters');
    });

    it('obsidian.write returns path on success', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.write',
        arguments: { fileName: 'new-note.md', content: '---\ntitle: Test\n---\n# Note content goes here' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.ok).toBe(true);
      expect(data.path).toBe('docs/new-note.md');
    });

    it('obsidian.write forwards allowHighLinkDensity to the router', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.write',
        arguments: {
          fileName: 'ops/services/gcp-worker/PROFILE.md',
          content: '# Link-heavy content',
          allowHighLinkDensity: true,
        },
      });

      expect(result.isError).toBeFalsy();
      expect(writeObsidianNoteWithAdapter).toHaveBeenLastCalledWith({
        fileName: 'ops/services/gcp-worker/PROFILE.md',
        content: '# Link-heavy content',
        guildId: 'MCP',
        vaultPath: '/test-vault',
        allowHighLinkDensity: true,
      });
    });

    // ── obsidian.sync.status ─────────────────────────────────────────────
    it('obsidian.sync.status returns loop stats', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.sync.status' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.enabled).toBe(true);
      expect(data.owner).toBe('app');
    });

    it('obsidian.sync.run forces local execution through the maintenance facade', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.sync.run' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.lastStatus).toBe('success');
      expect(mockExecuteObsidianLoreSync).toHaveBeenCalledWith({ forceLocal: true });
    });

    // ── obsidian.cache.stats ─────────────────────────────────────────────
    it('obsidian.cache.stats returns statistics', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.cache.stats' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.totalDocs).toBe(42);
      expect(data.staleDocs).toBe(2);
      expect(data.ttlMs).toBe(3600000);
    });

    // ── obsidian.quality.audit ───────────────────────────────────────────
    it('obsidian.quality.audit returns snapshot', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.quality.audit' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.pass).toBe(true);
      expect(data.totals.files).toBe(100);
    });

    it('obsidian.quality.audit.run forces local execution through the maintenance facade', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.quality.audit.run' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.result.lastStatus).toBe('success');
      expect(mockExecuteObsidianGraphAudit).toHaveBeenCalledWith({ forceLocal: true });
    });

    // ── obsidian.adapter.status ──────────────────────────────────────────
    it('obsidian.adapter.status returns routing info', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.adapter.status' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.strictMode).toBe(false);
      expect(data.adapters).toHaveLength(1);
      expect(data.vaultRuntime.root).toBe('/test-vault');
      expect(data.vaultRuntime.looksLikeDesktopVault).toBe(true);
      expect(data.vaultHealth.healthy).toBe(true);
      expect(data.retrievalBoundary.metadataOnly.available).toBe(true);
      expect(data.cacheStats.activeDocs).toBe(40);
    });

    it('obsidian.knowledge.control returns compiler summary', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.knowledge.control' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.compiler.runs).toBe(3);
      expect(data.compiler.lastLintSummary.issueCount).toBe(1);
      expect(data.artifactPaths).toContain('ops/knowledge-control/LINT.md');
      expect(data.controlPaths).toContain('ops/control-tower/BLUEPRINT.md');
      expect(data.blueprint.model).toBe('4-plane-control-tower');
      expect(data.bundleSupport.queryParam).toBe('bundleFor');
    });

    it('obsidian.knowledge.control returns requested artifact content', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.knowledge.control',
        arguments: { artifact: 'lint' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.artifact.path).toBe('ops/knowledge-control/LINT.md');
      expect(data.artifact.content).toContain('Test Note');
    });

    it('obsidian.knowledge.control resolves control-tower blueprint artifacts', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.knowledge.control',
        arguments: { artifact: 'blueprint' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.artifact.path).toBe('ops/control-tower/BLUEPRINT.md');
      expect(data.artifact.content).toContain('Test Note');
    });

    it('obsidian.knowledge.control returns reflection bundle recommendations', async () => {
      const result = await callObsidianMcpTool({
        name: 'obsidian.knowledge.control',
        arguments: { bundleFor: 'ops/services/unified-mcp/PROFILE.md' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.bundle).toMatchObject({
        targetPath: 'ops/services/unified-mcp/PROFILE.md',
        plane: 'runtime',
        concern: 'service-memory',
      });
    });

    it('knowledge.bundle.compile returns compiled bundle output', async () => {
      const knowledgeCompilerService = await import('../services/obsidian/knowledgeCompilerService');
      const result = await callObsidianMcpTool({
        name: 'knowledge.bundle.compile',
        arguments: {
          goal: 'operator routing',
          domains: ['architecture'],
          sourceHints: ['obsidian'],
          explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.summary).toContain('Compiled 2 artifacts');
      expect(data.artifacts[0].title).toBe('Shared Knowledge Routing');
      expect(data.resolutionTrace).toContain('shared-obsidian');
      expect(vi.mocked(knowledgeCompilerService.compileObsidianKnowledgeBundle)).toHaveBeenCalledWith(expect.objectContaining({
        explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
      }));
    });

    it('internal.knowledge.resolve returns internal knowledge guidance', async () => {
      const result = await callObsidianMcpTool({
        name: 'internal.knowledge.resolve',
        arguments: {
          goal: 'resolve internal routing policy',
          targets: ['shared MCP', 'company-context'],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.preferredPath).toBe('shared-mcp-internal');
      expect(data.accessNotes[0]).toContain('shared MCP internal knowledge surface');
    });

    it('requirement.compile returns structured requirement output', async () => {
      const knowledgeCompilerService = await import('../services/obsidian/knowledgeCompilerService');
      const result = await callObsidianMcpTool({
        name: 'requirement.compile',
        arguments: {
          objective: 'Compile a requirement for shared MCP routing.',
          desiredArtifact: 'requirement',
          explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.problem).toContain('shared MCP routing');
      expect(data.workflows).toContain('shared MCP routing and internal knowledge resolution');
      expect(data.recommendedNextArtifacts[0]).toContain('requirement');
      expect(data.sourceArtifacts[0].sourceRole).toBe('trigger');
      expect(vi.mocked(knowledgeCompilerService.compileObsidianRequirement)).toHaveBeenCalledWith(expect.objectContaining({
        explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
      }));
    });

    it('operator.snapshot returns runtime snapshot output', async () => {
      const result = await callObsidianMcpTool({
        name: 'operator.snapshot',
        arguments: { guildId: 'guild-1', days: 14 },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.guildId).toBe('guild-1');
      expect(data.runtime.schedulerPolicy.summary.total).toBe(4);
      expect(data.obsidian.knowledgeControl.blueprint.model).toBe('4-plane-control-tower');
      expect(data.obsidian.internalKnowledge.preferredPath).toBe('shared-mcp-internal');
      expect(data.obsidian.decisionTrace.subject).toBe('active operator workset');
      expect(data.obsidian.promotionBacklinks[0].targetPath).toBe('ops/services/knowledge-bundle-compile-spec/PROFILE.md');
    });

    it('workset.resolve returns active workset output', async () => {
      const result = await callObsidianMcpTool({
        name: 'workset.resolve',
        arguments: { guildId: 'guild-1', objective: 'active operator workset' },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.objective).toBe('active operator workset');
      expect(data.lint.issueCount).toBe(2);
      expect(data.objectRefs).toContain('ops/control-tower/BLUEPRINT.md');
      expect(data.incidentGraph.incident).toBe('active operator workset incident');
      expect(data.promotionBacklinks[0].targetPath).toBe('ops/services/knowledge-bundle-compile-spec/PROFILE.md');
    });

    it('decision.trace returns traced decision output', async () => {
      const knowledgeCompilerService = await import('../services/obsidian/knowledgeCompilerService');
      const result = await callObsidianMcpTool({
        name: 'decision.trace',
        arguments: {
          subject: 'shared MCP routing policy',
          explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.subject).toBe('shared MCP routing policy');
      expect(data.trace[0].stepKind).toBe('artifact');
      expect(data.contradictions[0].kind).toBe('runtime-doc-mismatch');
      expect(vi.mocked(knowledgeCompilerService.traceObsidianDecision)).toHaveBeenCalledWith(expect.objectContaining({
        explicitSources: ['https://www.anthropic.com/engineering/managed-agents'],
      }));
    });

    it('incident.graph.resolve returns compiled incident graph output', async () => {
      const knowledgeCompilerService = await import('../services/obsidian/knowledgeCompilerService');
      const result = await callObsidianMcpTool({
        name: 'incident.graph.resolve',
        arguments: {
          incident: 'unified mcp routing outage',
          serviceHints: ['unified-mcp'],
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.affectedServices).toContain('unified-mcp');
      expect(data.relatedPlaybooks).toContain('ops/playbooks/unified-mcp-recovery.md');
      expect(data.customerImpactLikely).toBe(true);
      expect(vi.mocked(knowledgeCompilerService.resolveObsidianIncidentGraph)).toHaveBeenCalledWith(expect.objectContaining({
        incident: 'unified mcp routing outage',
      }));
    });

    it('wiki.change.capture returns classified wiki targets', async () => {
      const result = await callObsidianMcpTool({
        name: 'wiki.change.capture',
        arguments: {
          changeSummary: 'operator routing policy update',
          changeKind: 'development-slice',
          changedPaths: ['docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
          promoteImmediately: true,
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.classification).toContain('development_slice');
      expect(data.wikiTargets).toContain('plans/development/2026-04-11_operator-routing.md');
      expect(data.writtenArtifacts).toHaveLength(1);
    });

    it('knowledge.promote writes a durable shared object', async () => {
      const result = await callObsidianMcpTool({
        name: 'knowledge.promote',
        arguments: {
          artifactKind: 'note',
          title: 'Shared Routing',
          content: 'Promoted shared routing knowledge with provenance and stable ownership.',
          sources: ['repo:docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
          confidence: 0.91,
        },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.status).toBe('written');
      expect(data.writtenArtifacts[0]).toContain('ops/contexts/repos/shared-routing.md');
    });

    it('knowledge.promote rejects unknown artifact kinds', async () => {
      const result = await callObsidianMcpTool({
        name: 'knowledge.promote',
        arguments: {
          artifactKind: 'service_profile',
          title: 'Shared Routing',
          content: 'Promoted shared routing knowledge with provenance and stable ownership.',
          sources: ['repo:docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md'],
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('artifactKind must be one of');
    });

    it('wiki.change.capture rejects unknown change kinds', async () => {
      const result = await callObsidianMcpTool({
        name: 'wiki.change.capture',
        arguments: {
          changeSummary: 'operator routing policy update',
          changeKind: 'service_profile',
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('changeKind must be one of');
    });

    it('semantic.lint.audit returns semantic lint findings', async () => {
      const result = await callObsidianMcpTool({
        name: 'semantic.lint.audit',
        arguments: { maxIssues: 5 },
      });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.healthy).toBe(false);
      expect(data.issueCount).toBe(2);
      expect(data.followUps[0]).toContain('Backfill missing shared wiki targets');
    });
  });
});
