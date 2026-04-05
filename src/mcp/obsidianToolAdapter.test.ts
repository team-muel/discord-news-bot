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
}));

vi.mock('../services/obsidian/obsidianRagService', () => ({
  queryObsidianRAG: vi.fn().mockResolvedValue({
    answer: 'The architecture uses graph-first retrieval.',
    documents: [{ filePath: 'docs/architecture.md', score: 0.9 }],
    intent: 'architecture',
  }),
}));

vi.mock('../services/obsidian/obsidianCacheService', () => ({
  getCacheStats: vi.fn().mockResolvedValue({
    totalDocs: 42,
    activeDocs: 42,
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

vi.mock('../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn().mockReturnValue('/test-vault'),
}));

import { listObsidianMcpTools, callObsidianMcpTool, OBSIDIAN_TOOL_NAMES } from './obsidianToolAdapter';

describe('obsidianToolAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listObsidianMcpTools', () => {
    it('returns all obsidian tools with valid specs', () => {
      const tools = listObsidianMcpTools();
      expect(tools.length).toBe(20);

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
      expect(OBSIDIAN_TOOL_NAMES.size).toBe(20);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.search')).toBe(true);
      expect(OBSIDIAN_TOOL_NAMES.has('obsidian.write')).toBe(true);
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
    });
  });
});
