import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockCallMcpTool, mockParseMcpTextBlocks,
  mockFetchWithTimeout, mockScrape,
  mockShouldDelegate, mockShouldSkipInlineFallback, mockDelegateYoutubeFeedFetch, mockDelegateYoutubeCommunityScrape,
} = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockParseMcpTextBlocks: vi.fn(() => ['']),
  mockFetchWithTimeout: vi.fn(),
  mockScrape: vi.fn(),
  mockShouldDelegate: vi.fn(() => false),
  mockShouldSkipInlineFallback: vi.fn(() => false),
  mockDelegateYoutubeFeedFetch: vi.fn(),
  mockDelegateYoutubeCommunityScrape: vi.fn(),
}));

vi.mock('../mcpWorkerClient', () => ({
  callMcpTool: mockCallMcpTool,
  parseMcpTextBlocks: mockParseMcpTextBlocks,
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

vi.mock('./youtubeCommunityScraper', () => ({
  scrapeLatestCommunityPostByUrl: mockScrape,
}));

vi.mock('../automation/n8nDelegationService', () => ({
  shouldDelegate: mockShouldDelegate,
  shouldSkipInlineFallback: mockShouldSkipInlineFallback,
  delegateYoutubeFeedFetch: mockDelegateYoutubeFeedFetch,
  delegateYoutubeCommunityScrape: mockDelegateYoutubeCommunityScrape,
}));

describe('youtubeMonitorWorkerClient', () => {
  const ENV_KEYS = [
    'YOUTUBE_MONITOR_MCP_WORKER_URL', 'MCP_YOUTUBE_WORKER_URL',
    'YOUTUBE_MONITOR_MCP_STRICT', 'YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED',
  ];
  let envSnapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    for (const fn of [mockCallMcpTool, mockParseMcpTextBlocks, mockFetchWithTimeout, mockScrape,
      mockShouldDelegate, mockShouldSkipInlineFallback, mockDelegateYoutubeFeedFetch, mockDelegateYoutubeCommunityScrape]) {
      fn.mockReset();
    }
    mockParseMcpTextBlocks.mockReturnValue(['']);
    mockShouldDelegate.mockReturnValue(false);
    mockShouldSkipInlineFallback.mockReturnValue(false);

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

  const VIDEO_SOURCE_URL = 'https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q#videos';
  const POST_SOURCE_URL = 'https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q#posts';

  // ── n8n delegation — videos ──────────────────────────────────────────

  describe('n8n delegation — videos', () => {
    it('returns n8n feed data when delegation succeeds', async () => {
      mockShouldDelegate.mockImplementation(((task: string) => task === 'youtube-feed-fetch') as any);
      mockDelegateYoutubeFeedFetch.mockResolvedValue({
        delegated: true, ok: true,
        data: { entries: [{ id: 'vid1', title: 'Test Video', link: 'http://yt.com/v1', published: '2026-01-01', author: 'Chan' }] },
      });

      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' });

      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(result!.entry!.id).toBe('vid1');
      expect(mockCallMcpTool).not.toHaveBeenCalled();
    });

    it('skips local XML fallback when delegation-first is enabled', async () => {
      mockShouldDelegate.mockImplementation(((task: string) => task === 'youtube-feed-fetch') as any);
      mockShouldSkipInlineFallback.mockImplementation(((task: string) => task === 'youtube-feed-fetch') as any);
      mockDelegateYoutubeFeedFetch.mockResolvedValue({
        delegated: true,
        ok: false,
        data: null,
      });

      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' });

      expect(result).toEqual({ found: false, channelId: 'UCsXVk37bltHxD1rDPwtNM8Q' });
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });
  });

  // ── n8n delegation — posts ───────────────────────────────────────────

  describe('n8n delegation — posts', () => {
    it('returns n8n community scrape data when delegation succeeds', async () => {
      mockShouldDelegate.mockImplementation(((task: string) => task === 'youtube-community-scrape') as any);
      mockDelegateYoutubeCommunityScrape.mockResolvedValue({
        delegated: true, ok: true,
        data: { id: 'post1', title: 'Community', content: 'Hello!', link: 'http://yt.com/post1', published: '2026-01-01', author: 'Author' },
      });

      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: POST_SOURCE_URL, mode: 'posts' });

      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(result!.entry!.id).toBe('post1');
    });

    it('skips local post scraping when delegation-first is enabled', async () => {
      mockShouldDelegate.mockImplementation(((task: string) => task === 'youtube-community-scrape') as any);
      mockShouldSkipInlineFallback.mockImplementation(((task: string) => task === 'youtube-community-scrape') as any);
      mockDelegateYoutubeCommunityScrape.mockResolvedValue({
        delegated: true,
        ok: false,
        data: null,
      });

      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: POST_SOURCE_URL, mode: 'posts' });

      expect(result).toEqual({ found: false, channelId: 'UCsXVk37bltHxD1rDPwtNM8Q' });
      expect(mockScrape).not.toHaveBeenCalled();
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
    });
  });

  // ── local fallback — XML feed ────────────────────────────────────────

  describe('local fallback — XML feed', () => {
    it('parses YouTube video feed XML', async () => {
      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed>
<entry>
  <yt:videoId>dQw4w9WgXcQ</yt:videoId>
  <title>Test Video</title>
  <link href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
  <published>2026-01-01T00:00:00Z</published>
  <author><name>Rick</name></author>
</entry>
</feed>`;
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, text: async () => xml });

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' });

      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(result!.entry!.id).toBe('dQw4w9WgXcQ');
      expect(result!.entry!.title).toBe('Test Video');
      expect(result!.channelId).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('returns found:false when feed is empty', async () => {
      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'true';
      vi.resetModules();

      mockFetchWithTimeout.mockResolvedValueOnce({ ok: true, text: async () => '<feed></feed>' });

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' });

      expect(result).not.toBeNull();
      expect(result!.found).toBe(false);
    });
  });

  // ── strict mode ──────────────────────────────────────────────────────

  describe('strict mode', () => {
    it('throws when worker not configured and strict=true', async () => {
      process.env.YOUTUBE_MONITOR_MCP_STRICT = 'true';
      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'false';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      await expect(
        fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' }),
      ).rejects.toThrow('YOUTUBE_MONITOR_WORKER_NOT_CONFIGURED');
    });

    it('returns null when worker not configured and strict=false', async () => {
      process.env.YOUTUBE_MONITOR_MCP_STRICT = 'false';
      process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED = 'false';
      vi.resetModules();

      const { fetchYouTubeLatestByWorker } = await import('./youtubeMonitorWorkerClient');
      const result = await fetchYouTubeLatestByWorker({ sourceUrl: VIDEO_SOURCE_URL, mode: 'videos' });
      expect(result).toBeNull();
    });
  });

  // ── isYouTubeMonitorWorkerStrict ─────────────────────────────────────

  describe('isYouTubeMonitorWorkerStrict', () => {
    it('returns true by default', async () => {
      process.env.YOUTUBE_MONITOR_MCP_STRICT = 'true';
      vi.resetModules();
      const { isYouTubeMonitorWorkerStrict } = await import('./youtubeMonitorWorkerClient');
      expect(isYouTubeMonitorWorkerStrict()).toBe(true);
    });
  });
});
