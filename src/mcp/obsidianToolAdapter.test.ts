import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  resolveObsidianKnowledgeArtifactPath: vi.fn((artifact: string) => {
    if (artifact === 'lint') return 'ops/knowledge-control/LINT.md';
    if (artifact === 'blueprint') return 'ops/control-tower/BLUEPRINT.md';
    return null;
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
  });

  describe('listObsidianMcpTools', () => {
    it('returns all obsidian tools with valid specs', () => {
      const tools = listObsidianMcpTools();
      expect(tools.length).toBe(21);

      const names = tools.map((t) => t.name);
      expect(names).toContain('obsidian.search');
      expect(names).toContain('obsidian.rag');
      expect(names).toContain('obsidian.read');
      expect(names).toContain('obsidian.graph');
      expect(names).toContain('obsidian.write');
      expect(names).toContain('obsidian.sync.status');
      expect(names).toContain('obsidian.cache.stats');
      expect(names).toContain('obsidian.quality.audit');
      expect(names).toContain('obsidian.adapter.status');
      expect(names).toContain('obsidian.knowledge.control');
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
      expect(OBSIDIAN_TOOL_NAMES.size).toBe(21);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.search')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.write')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.knowledge.control')).toBe(true);
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

    // ── obsidian.sync.status ─────────────────────────────────────────────
    it('obsidian.sync.status returns loop stats', async () => {
      const result = await callObsidianMcpTool({ name: 'obsidian.sync.status' });
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0]?.text || '{}');
      expect(data.enabled).toBe(true);
      expect(data.owner).toBe('app');
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
  });
});
