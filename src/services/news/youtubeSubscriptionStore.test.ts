import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

// ?? Hoisted Supabase mock ??????????????????????????????????????????????????
const { mockFrom } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return { mockFrom };
});

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

// ?? URL Parsing (pure functions ??no DB needed) ?????????????????????????????

describe('youtubeSubscriptionStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFrom.mockReset();
  });

  describe('parseYouTubeChannelIdOrThrow', () => {
    it('extracts channel ID directly from UC... string', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      const id = await parseYouTubeChannelIdOrThrow('UCsXVk37bltHxD1rDPwtNM8Q');
      expect(id).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('extracts channel ID from /channel/ URL', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      const id = await parseYouTubeChannelIdOrThrow('https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q');
      expect(id).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('extracts channel ID from URL with query params', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      const id = await parseYouTubeChannelIdOrThrow('https://www.youtube.com/watch?v=abc&channel_id=UCsXVk37bltHxD1rDPwtNM8Q');
      expect(id).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('normalizes bare youtube.com/channel/ without protocol', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      const id = await parseYouTubeChannelIdOrThrow('www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q');
      expect(id).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('rejects non-YouTube URLs', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      await expect(parseYouTubeChannelIdOrThrow('https://evil.com/channel/UCsXVk37bltHxD1rDPwtNM8Q'))
        .rejects.toThrow();
    });

    it('rejects empty input', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      await expect(parseYouTubeChannelIdOrThrow('')).rejects.toThrow();
    });

    it('rejects random text', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      await expect(parseYouTubeChannelIdOrThrow('hello world')).rejects.toThrow();
    });

    it('extracts from m.youtube.com', async () => {
      const { parseYouTubeChannelIdOrThrow } = await import('./youtubeSubscriptionStore');
      const id = await parseYouTubeChannelIdOrThrow('https://m.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q');
      expect(id).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });
  });

  // ?? createYouTubeSubscription ???????????????????????????????????????????

  describe('createYouTubeSubscription', () => {

    it('returns created:false when subscription already exists', async () => {
      const existingRow = {
        id: 1, user_id: 'u1', guild_id: 'g1', channel_id: 'c1',
        url: 'test', name: 'youtube-videos', last_post_id: null,
        last_post_signature: null, created_at: null,
      };
      const chain = createSupabaseChain();
      chain.limit.mockResolvedValueOnce({ data: [existingRow], error: null });
      mockFrom.mockReturnValue(chain);

      const { createYouTubeSubscription } = await import('./youtubeSubscriptionStore');
      const result = await createYouTubeSubscription({
        userId: 'u1', guildId: 'g1', discordChannelId: 'c1',
        channelInput: 'UCsXVk37bltHxD1rDPwtNM8Q', kind: 'videos',
      });

      expect(result.created).toBe(false);
      expect(result.row).toEqual(existingRow);
    });

    it('inserts and returns created:true for new subscription', async () => {
      const insertedRow = {
        id: 2, user_id: 'u1', guild_id: 'g1', channel_id: 'c1',
        url: 'test', name: 'youtube-videos', last_post_id: null,
        last_post_signature: null, created_at: '2026-01-01',
      };
      const chain = createSupabaseChain();
      // First call: existingByScope query ??empty
      chain.limit.mockResolvedValueOnce({ data: [], error: null });
      // Second sequence: insert ??select ??limit
      chain.limit.mockResolvedValueOnce({ data: [insertedRow], error: null });
      mockFrom.mockReturnValue(chain);

      const { createYouTubeSubscription } = await import('./youtubeSubscriptionStore');
      const result = await createYouTubeSubscription({
        userId: 'u1', guildId: 'g1', discordChannelId: 'c1',
        channelInput: 'UCsXVk37bltHxD1rDPwtNM8Q', kind: 'videos',
      });

      expect(result.created).toBe(true);
      expect(result.channelId).toBe('UCsXVk37bltHxD1rDPwtNM8Q');
    });

    it('throws when Supabase is not configured', async () => {
      vi.doMock('../supabaseClient', () => ({
        isSupabaseConfigured: vi.fn(() => false),
        getSupabaseClient: vi.fn(),
      }));
      vi.resetModules();

      const { createYouTubeSubscription } = await import('./youtubeSubscriptionStore');
      await expect(
        createYouTubeSubscription({
          userId: 'u1', guildId: 'g1', discordChannelId: 'c1',
          channelInput: 'UCsXVk37bltHxD1rDPwtNM8Q', kind: 'videos',
        }),
      ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');

      vi.doUnmock('../supabaseClient');
    });
  });

  // ?? listYouTubeSubscriptions ????????????????????????????????????????????

  describe('listYouTubeSubscriptions', () => {
    it('returns empty array when Supabase is not configured', async () => {
      vi.doMock('../supabaseClient', () => ({
        isSupabaseConfigured: vi.fn(() => false),
        getSupabaseClient: vi.fn(),
      }));
      vi.resetModules();

      const { listYouTubeSubscriptions } = await import('./youtubeSubscriptionStore');
      const result = await listYouTubeSubscriptions({ guildId: 'g1' });
      expect(result).toEqual([]);

      vi.doUnmock('../supabaseClient');
    });
  });
});
