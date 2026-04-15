import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockCallMcpTool, mockParseMcpTextBlocks, mockShouldDelegate, mockShouldSkipInlineFallback, mockDelegateNewsMonitorCandidates } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockParseMcpTextBlocks: vi.fn(() => ['']),
  mockShouldDelegate: vi.fn(() => false),
  mockShouldSkipInlineFallback: vi.fn(() => false),
  mockDelegateNewsMonitorCandidates: vi.fn(),
}));

const { mockFetchWithTimeout } = vi.hoisted(() => ({
  mockFetchWithTimeout: vi.fn(),
}));

vi.mock('../mcpWorkerClient', () => ({
  callMcpTool: mockCallMcpTool,
  parseMcpTextBlocks: mockParseMcpTextBlocks,
}));

vi.mock('../automation/n8nDelegationService', () => ({
  shouldDelegate: mockShouldDelegate,
  shouldSkipInlineFallback: mockShouldSkipInlineFallback,
  delegateNewsMonitorCandidates: mockDelegateNewsMonitorCandidates,
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

describe('newsMonitorWorkerClient', () => {
  const ENV_KEYS = ['NEWS_MONITOR_MCP_WORKER_URL', 'MCP_NEWS_WORKER_URL', 'NEWS_MONITOR_MCP_STRICT', 'NEWS_MONITOR_LOCAL_FALLBACK_ENABLED', 'GOOGLE_FINANCE_NEWS_URL'];
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    mockCallMcpTool.mockReset();
    mockParseMcpTextBlocks.mockReset().mockReturnValue(['']);
    mockShouldDelegate.mockReset().mockReturnValue(false);
    mockShouldSkipInlineFallback.mockReset().mockReturnValue(false);
    mockDelegateNewsMonitorCandidates.mockReset();
    mockFetchWithTimeout.mockReset();

    envSnapshot = {};
    for (const k of ENV_KEYS) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }

    process.env.NEWS_MONITOR_LOCAL_FALLBACK_ENABLED = 'false';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  // ── n8n delegation path ──────────────────────────────────────────────

  describe('n8n delegation', () => {
    it('returns n8n data when delegation succeeds', async () => {
      mockShouldDelegate.mockReturnValue(true);
      mockDelegateNewsMonitorCandidates.mockResolvedValue({
        delegated: true,
        ok: true,
        data: {
          items: [
            { title: 'BTC up', link: 'http://a.com', key: 'k1', sourceName: 'CoinDesk', publisherName: null, publishedAtUnix: 1700000000, lexicalSignature: 'btc|up' },
          ],
        },
      });

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      const result = await fetchNewsMonitorCandidatesByWorker(10);

      expect(result).toHaveLength(1);
      expect(result![0].title).toBe('BTC up');
      expect(result![0].sourceName).toBe('CoinDesk');
      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });

    it('falls through to MCP when n8n delegation fails', async () => {
      mockShouldDelegate.mockReturnValue(true);
      mockDelegateNewsMonitorCandidates.mockResolvedValue({
        delegated: true, ok: false, data: null,
      });

      // No MCP worker configured, strict=false
      process.env.NEWS_MONITOR_MCP_STRICT = 'false';
      vi.resetModules();

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      const result = await fetchNewsMonitorCandidatesByWorker(5);
      expect(result).toBeNull();
    });

    it('skips local fallback when delegation-first is enabled', async () => {
      mockShouldDelegate.mockReturnValue(true);
      mockShouldSkipInlineFallback.mockReturnValue(true);
      mockDelegateNewsMonitorCandidates.mockResolvedValue({
        delegated: true,
        ok: false,
        data: null,
        error: 'HTTP_500',
      });

      process.env.NEWS_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      process.env.NEWS_MONITOR_MCP_STRICT = 'true';
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        text: async () => '<a href="https://example.com/news-1">Example</a>',
      });
      vi.resetModules();

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      await expect(fetchNewsMonitorCandidatesByWorker(5)).rejects.toThrow('NEWS_MONITOR_N8N_DELEGATION_REQUIRED');
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });
  });

  // ── MCP worker path ──────────────────────────────────────────────────

  describe('MCP worker path', () => {
    it('throws when worker not configured and strict=true', async () => {
      process.env.NEWS_MONITOR_MCP_STRICT = 'true';
      vi.resetModules();

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      await expect(fetchNewsMonitorCandidatesByWorker(5)).rejects.toThrow('NEWS_MONITOR_WORKER_NOT_CONFIGURED');
    });

    it('returns null when worker not configured and strict=false', async () => {
      process.env.NEWS_MONITOR_MCP_STRICT = 'false';
      vi.resetModules();

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      const result = await fetchNewsMonitorCandidatesByWorker(5);
      expect(result).toBeNull();
    });

    it('reports none when no candidate source is configured', async () => {
      process.env.NEWS_MONITOR_MCP_STRICT = 'false';
      vi.resetModules();

      const { getNewsMonitorCandidateSourceStatus } = await import('./newsMonitorWorkerClient');
      expect(getNewsMonitorCandidateSourceStatus()).toEqual({ configured: false, mode: 'none' });
    });

    it('reports MCP worker when worker URL is configured', async () => {
      process.env.NEWS_MONITOR_MCP_WORKER_URL = 'http://worker.test:3000';
      vi.resetModules();

      const { getNewsMonitorCandidateSourceStatus } = await import('./newsMonitorWorkerClient');
      expect(getNewsMonitorCandidateSourceStatus()).toEqual({ configured: true, mode: 'mcp-worker' });
    });

    it('reports n8n when delegation is configured', async () => {
      mockShouldDelegate.mockReturnValue(true);
      vi.resetModules();

      const { getNewsMonitorCandidateSourceStatus } = await import('./newsMonitorWorkerClient');
      expect(getNewsMonitorCandidateSourceStatus()).toEqual({ configured: true, mode: 'n8n' });
    });

    it('reports local fallback when external sources are absent but fallback is enabled', async () => {
      process.env.NEWS_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const { getNewsMonitorCandidateSourceStatus } = await import('./newsMonitorWorkerClient');
      expect(getNewsMonitorCandidateSourceStatus()).toEqual({ configured: true, mode: 'local-fallback' });
    });

    it('returns local fallback candidates when worker is not configured', async () => {
      process.env.NEWS_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      mockFetchWithTimeout.mockResolvedValue({
        ok: true,
        text: async () => '<a href="https://example.com/news-1">Reuters 2 hours ago Stocks rally on ceasefire hopes</a>',
      });
      vi.resetModules();

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      const result = await fetchNewsMonitorCandidatesByWorker(5);

      expect(result).toHaveLength(1);
      expect(result![0].link).toBe('https://example.com/news-1');
      expect(result![0].title).toContain('Stocks rally');
    });

    it('parses valid MCP worker response', async () => {
      process.env.NEWS_MONITOR_MCP_WORKER_URL = 'http://worker.test:3000';
      vi.resetModules();

      const items = [{ title: 'A', link: 'http://a.com', key: 'k1', sourceName: null, publisherName: null, publishedAtUnix: null, lexicalSignature: '' }];
      mockCallMcpTool.mockResolvedValue({ isError: false });
      mockParseMcpTextBlocks.mockReturnValue([JSON.stringify({ items })]);

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      const result = await fetchNewsMonitorCandidatesByWorker(5);
      expect(result).toHaveLength(1);
      expect(result![0].title).toBe('A');
    });

    it('throws on MCP worker error', async () => {
      process.env.NEWS_MONITOR_MCP_WORKER_URL = 'http://worker.test:3000';
      process.env.NEWS_MONITOR_MCP_STRICT = 'true';
      vi.resetModules();

      mockCallMcpTool.mockResolvedValue({ isError: true });
      mockParseMcpTextBlocks.mockReturnValue(['SERVICE_DOWN']);

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      await expect(fetchNewsMonitorCandidatesByWorker(5)).rejects.toThrow('SERVICE_DOWN');
    });

    it('throws on invalid JSON from worker', async () => {
      process.env.NEWS_MONITOR_MCP_WORKER_URL = 'http://worker.test:3000';
      process.env.NEWS_MONITOR_MCP_STRICT = 'true';
      vi.resetModules();

      mockCallMcpTool.mockResolvedValue({ isError: false });
      mockParseMcpTextBlocks.mockReturnValue(['not valid json {{']);

      const { fetchNewsMonitorCandidatesByWorker } = await import('./newsMonitorWorkerClient');
      await expect(fetchNewsMonitorCandidatesByWorker(5)).rejects.toThrow('NEWS_MONITOR_WORKER_INVALID_JSON');
    });
  });
});
