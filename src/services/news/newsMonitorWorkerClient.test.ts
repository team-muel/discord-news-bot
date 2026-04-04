import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockCallMcpTool, mockParseMcpTextBlocks, mockShouldDelegate, mockDelegateNewsMonitorCandidates } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockParseMcpTextBlocks: vi.fn(() => ['']),
  mockShouldDelegate: vi.fn(() => false),
  mockDelegateNewsMonitorCandidates: vi.fn(),
}));

vi.mock('../mcpWorkerClient', () => ({
  callMcpTool: mockCallMcpTool,
  parseMcpTextBlocks: mockParseMcpTextBlocks,
}));

vi.mock('../automation/n8nDelegationService', () => ({
  shouldDelegate: mockShouldDelegate,
  delegateNewsMonitorCandidates: mockDelegateNewsMonitorCandidates,
}));

describe('newsMonitorWorkerClient', () => {
  const ENV_KEYS = ['NEWS_MONITOR_MCP_WORKER_URL', 'MCP_NEWS_WORKER_URL', 'NEWS_MONITOR_MCP_STRICT'];
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    mockCallMcpTool.mockReset();
    mockParseMcpTextBlocks.mockReset().mockReturnValue(['']);
    mockShouldDelegate.mockReset().mockReturnValue(false);
    mockDelegateNewsMonitorCandidates.mockReset();

    envSnapshot = {};
    for (const k of ENV_KEYS) {
      envSnapshot[k] = process.env[k];
      delete process.env[k];
    }
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
