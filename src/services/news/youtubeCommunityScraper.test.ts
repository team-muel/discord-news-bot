import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mock ───────────────────────────────────────────────────────────
const { mockFetchWithTimeout } = vi.hoisted(() => ({
  mockFetchWithTimeout: vi.fn(),
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}));

beforeEach(() => {
  mockFetchWithTimeout.mockClear();
});

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

  // ── scrapeLatestCommunityPostByInnerTube ─────────────────────────────

  describe('scrapeLatestCommunityPostByInnerTube', () => {
    it('returns null for invalid channel ID', async () => {
      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('', 5000);
      expect(result).toBeNull();
    });

    it('returns null for non-UC channel ID', async () => {
      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('notUCchannel', 5000);
      expect(result).toBeNull();
    });

    it('returns null when InnerTube step-1 returns non-ok', async () => {
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 403 });

      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('UCsXVk37bltHxD1rDPwtNM8Q', 5000);
      expect(result).toBeNull();
    });

    it('returns null when channel has no community/posts tab', async () => {
      // Step 1: no matching tab
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contents: { twoColumnBrowseResultsRenderer: { tabs: [] } } }),
      });

      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('UCsXVk37bltHxD1rDPwtNM8Q', 5000);
      expect(result).toBeNull();
    });

    it('returns null when step-2 returns non-ok', async () => {
      // Step 1: return tab with params
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [{
                tabRenderer: {
                  endpoint: {
                    commandMetadata: { webCommandMetadata: { url: '/@test/posts' } },
                    browseEndpoint: { browseId: 'UCtest', params: 'EgVwb3N0cw%3D%3D' },
                  },
                  content: undefined,
                },
              }],
            },
          },
        }),
      });
      // Step 2: failure
      mockFetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 500 });

      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('UCsXVk37bltHxD1rDPwtNM8Q', 5000);
      expect(result).toBeNull();
    });

    it('extracts post from InnerTube 2-step flow', async () => {
      // Step 1: discover community tab params
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [{
                tabRenderer: {
                  endpoint: {
                    commandMetadata: { webCommandMetadata: { url: '/@test/posts' } },
                    browseEndpoint: { browseId: 'UCsXVk37bltHxD1rDPwtNM8Q', params: 'EgVwb3N0cw%3D%3D' },
                  },
                  content: undefined,
                },
              }],
            },
          },
        }),
      });

      // Step 2: community tab content
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [{
                tabRenderer: {
                  selected: true,
                  content: {
                    sectionListRenderer: {
                      contents: [{
                        itemSectionRenderer: {
                          contents: [{
                            backstagePostThreadRenderer: {
                              post: {
                                backstagePostRenderer: {
                                  postId: 'UgkxInnerTube123',
                                  contentText: { runs: [{ text: 'InnerTube로 가져온 포스트입니다!' }] },
                                  publishedTimeText: { runs: [{ text: '2시간 전' }] },
                                  authorText: { runs: [{ text: '테스트채널' }] },
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
        }),
      });

      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      const result = await scrapeLatestCommunityPostByInnerTube('UCsXVk37bltHxD1rDPwtNM8Q', 10000);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('UgkxInnerTube123');
      expect(result!.content).toContain('InnerTube로 가져온 포스트입니다!');
      expect(result!.author).toBe('테스트채널');
      expect(result!.link).toBe('https://www.youtube.com/post/UgkxInnerTube123');
    });

    it('makes two InnerTube requests (step-1 + step-2)', async () => {
      // Step 1
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          contents: {
            twoColumnBrowseResultsRenderer: {
              tabs: [{
                tabRenderer: {
                  endpoint: {
                    commandMetadata: { webCommandMetadata: { url: '/@test/posts' } },
                    browseEndpoint: { browseId: 'UCsXVk37bltHxD1rDPwtNM8Q', params: 'EgVwb3N0cw%3D%3D' },
                  },
                },
              }],
            },
          },
        }),
      });
      // Step 2: empty but ok
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contents: {} }),
      });

      const { scrapeLatestCommunityPostByInnerTube } = await import('./youtubeCommunityScraper');
      await scrapeLatestCommunityPostByInnerTube('UCsXVk37bltHxD1rDPwtNM8Q', 8000);

      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);
      // Both calls should be to InnerTube browse
      for (const call of mockFetchWithTimeout.mock.calls) {
        expect(call[0]).toContain('youtubei/v1/browse');
        expect(call[1].body).toContain('UCsXVk37bltHxD1rDPwtNM8Q');
      }
    });
  });
});
