import { describe, expect, it, vi } from 'vitest';

// ── Hoisted mock ───────────────────────────────────────────────────────────
const { mockFetchWithTimeout } = vi.hoisted(() => ({
  mockFetchWithTimeout: vi.fn(),
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

describe('youtubeCommunityScraper', () => {
  // ── scrapeLatestCommunityPostByChannelId ─────────────────────────────

  describe('scrapeLatestCommunityPostByChannelId', () => {
    it('returns null when fetch returns non-ok', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: false });

      const { scrapeLatestCommunityPostByChannelId } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByChannelId('UCsXVk37bltHxD1rDPwtNM8Q', 5000);
      expect(result).toBeNull();
    });

    it('returns null when HTML has no ytInitialData', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>No data</body></html>',
      });

      const { scrapeLatestCommunityPostByChannelId } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByChannelId('UCsXVk37bltHxD1rDPwtNM8Q', 5000);
      expect(result).toBeNull();
    });

    it('extracts post from ytInitialData with backstagePostRenderer', async () => {
      const ytData = {
        contents: {
          twoColumnBrowseResultsRenderer: {
            tabs: [{
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [{
                      itemSectionRenderer: {
                        contents: [{
                          backstagePostThreadRenderer: {
                            post: {
                              backstagePostRenderer: {
                                postId: 'UgkxABC123',
                                contentText: { runs: [{ text: 'Hello community!' }] },
                                publishedTimeText: { runs: [{ text: '1 hour ago' }] },
                                authorText: { runs: [{ text: 'TestChannel' }] },
                              },
                            },
                          },
                        }],
                      },
                    }],
                  },
                },
              },
            }],
          },
        },
      };

      const html = `<html><head></head><body><script>var ytInitialData = ${JSON.stringify(ytData)};</script></body></html>`;
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        text: async () => html,
      });

      const { scrapeLatestCommunityPostByChannelId } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByChannelId('UCsXVk37bltHxD1rDPwtNM8Q', 5000);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('UgkxABC123');
      expect(result!.content).toContain('Hello community!');
    });
  });

  // ── scrapeLatestCommunityPostByUrl ───────────────────────────────────

  describe('scrapeLatestCommunityPostByUrl', () => {
    it('returns null for invalid URL', async () => {
      const { scrapeLatestCommunityPostByUrl } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByUrl('not-a-url', 5000);
      expect(result).toBeNull();
    });

    it('returns null for non-YouTube URL', async () => {
      const { scrapeLatestCommunityPostByUrl } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByUrl('https://evil.com/community', 5000);
      expect(result).toBeNull();
    });
  });
});
