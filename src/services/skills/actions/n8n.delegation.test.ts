import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunExternalAction = vi.fn();
const mockGetExternalAdaptersStatus = vi.fn();
const mockGetDelegationStatus = vi.fn();

const mockDelegateNewsRss = vi.fn();
const mockDelegateNewsSummarize = vi.fn();
const mockDelegateNewsMonitor = vi.fn();
const mockDelegateYoutubeFeed = vi.fn();
const mockDelegateYoutubeScrape = vi.fn();
const mockDelegateAlert = vi.fn();
const mockDelegateArticleContext = vi.fn();

vi.mock('../../tools/toolRouter', () => ({
  runExternalAction: (...args: unknown[]) => mockRunExternalAction(...args),
  getExternalAdaptersStatus: () => mockGetExternalAdaptersStatus(),
}));

vi.mock('../../automation/n8nDelegationService', () => ({
  getDelegationStatus: () => mockGetDelegationStatus(),
  delegateNewsRssFetch: (...args: unknown[]) => mockDelegateNewsRss(...args),
  delegateNewsSummarize: (...args: unknown[]) => mockDelegateNewsSummarize(...args),
  delegateNewsMonitorCandidates: (...args: unknown[]) => mockDelegateNewsMonitor(...args),
  delegateYoutubeFeedFetch: (...args: unknown[]) => mockDelegateYoutubeFeed(...args),
  delegateYoutubeCommunityScrape: (...args: unknown[]) => mockDelegateYoutubeScrape(...args),
  delegateAlertDispatch: (...args: unknown[]) => mockDelegateAlert(...args),
  delegateArticleContextFetch: (...args: unknown[]) => mockDelegateArticleContext(...args),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const delegationOk = (data: unknown = {}) => ({
  delegated: true,
  ok: true,
  data,
  durationMs: 50,
});

const delegationFail = (error = 'SOMETHING_BROKE') => ({
  delegated: true,
  ok: false,
  data: null,
  error,
  durationMs: 20,
});

const delegationUnavailable = () => ({
  delegated: false,
  ok: false,
  data: null,
  durationMs: 0,
});

const noopArgs = (args: Record<string, unknown> = {}) => ({
  goal: 'test',
  args,
  pipelineId: 'test-pipe',
  phase: 'implement',
});

describe('n8n delegation actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Category ─────────────────────────────────────────────────────────

  describe('metadata', () => {
    it('all delegation actions have category automation', async () => {
      const m = await import('./n8n');
      const delegates = [
        m.n8nDelegateNewsRssAction,
        m.n8nDelegateNewsSummarizeAction,
        m.n8nDelegateNewsMonitorAction,
        m.n8nDelegateYoutubeFeedAction,
        m.n8nDelegateYoutubeScrapAction,
        m.n8nDelegateAlertAction,
        m.n8nDelegateArticleContextAction,
      ];
      for (const action of delegates) {
        expect(action.category).toBe('automation');
      }
    });

    it('all delegation actions have n8n.delegate prefix', async () => {
      const m = await import('./n8n');
      const names = [
        m.n8nDelegateNewsRssAction.name,
        m.n8nDelegateNewsSummarizeAction.name,
        m.n8nDelegateNewsMonitorAction.name,
        m.n8nDelegateYoutubeFeedAction.name,
        m.n8nDelegateYoutubeScrapAction.name,
        m.n8nDelegateAlertAction.name,
        m.n8nDelegateArticleContextAction.name,
      ];
      for (const name of names) {
        expect(name).toMatch(/^n8n\.delegate\./);
      }
    });
  });

  // ─── news-rss ─────────────────────────────────────────────────────────

  describe('n8n.delegate.news-rss', () => {
    it('returns success when delegation succeeds', async () => {
      mockDelegateNewsRss.mockResolvedValue(delegationOk({ items: [{ title: 'A', link: 'http://a' }] }));
      const { n8nDelegateNewsRssAction } = await import('./n8n');

      const result = await n8nDelegateNewsRssAction.execute(noopArgs({ query: 'AI' }));
      expect(result.ok).toBe(true);
      expect(mockDelegateNewsRss).toHaveBeenCalledWith('AI', 10);
    });

    it('fails when query is missing', async () => {
      const { n8nDelegateNewsRssAction } = await import('./n8n');
      const result = await n8nDelegateNewsRssAction.execute(noopArgs({}));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_QUERY');
    });

    it('returns error when delegation is unavailable', async () => {
      mockDelegateNewsRss.mockResolvedValue(delegationUnavailable());
      const { n8nDelegateNewsRssAction } = await import('./n8n');
      const result = await n8nDelegateNewsRssAction.execute(noopArgs({ query: 'AI' }));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('DELEGATION_UNAVAILABLE');
    });

    it('clamps limit', async () => {
      mockDelegateNewsRss.mockResolvedValue(delegationOk({ items: [] }));
      const { n8nDelegateNewsRssAction } = await import('./n8n');
      await n8nDelegateNewsRssAction.execute(noopArgs({ query: 'AI', limit: 999 }));
      expect(mockDelegateNewsRss).toHaveBeenCalledWith('AI', 50);
    });
  });

  // ─── news-summarize ───────────────────────────────────────────────────

  describe('n8n.delegate.news-summarize', () => {
    it('delegates with title and link', async () => {
      mockDelegateNewsSummarize.mockResolvedValue(delegationOk({ summary: 'test' }));
      const { n8nDelegateNewsSummarizeAction } = await import('./n8n');
      const result = await n8nDelegateNewsSummarizeAction.execute(noopArgs({ title: 'T', link: 'http://x' }));
      expect(result.ok).toBe(true);
      expect(mockDelegateNewsSummarize).toHaveBeenCalledWith('T', 'http://x', '');
    });

    it('fails when title or link missing', async () => {
      const { n8nDelegateNewsSummarizeAction } = await import('./n8n');
      const result = await n8nDelegateNewsSummarizeAction.execute(noopArgs({ title: 'T' }));
      expect(result.ok).toBe(false);
    });
  });

  // ─── news-monitor ─────────────────────────────────────────────────────

  describe('n8n.delegate.news-monitor', () => {
    it('delegates with limit', async () => {
      mockDelegateNewsMonitor.mockResolvedValue(delegationOk({ items: [] }));
      const { n8nDelegateNewsMonitorAction } = await import('./n8n');
      const result = await n8nDelegateNewsMonitorAction.execute(noopArgs({ limit: 5 }));
      expect(result.ok).toBe(true);
      expect(mockDelegateNewsMonitor).toHaveBeenCalledWith(5);
    });
  });

  // ─── youtube-feed ─────────────────────────────────────────────────────

  describe('n8n.delegate.youtube-feed', () => {
    it('delegates with channelUrl', async () => {
      mockDelegateYoutubeFeed.mockResolvedValue(delegationOk({ entries: [] }));
      const { n8nDelegateYoutubeFeedAction } = await import('./n8n');
      const result = await n8nDelegateYoutubeFeedAction.execute(noopArgs({ channelUrl: 'https://youtube.com/@ch' }));
      expect(result.ok).toBe(true);
    });

    it('fails when channelUrl missing', async () => {
      const { n8nDelegateYoutubeFeedAction } = await import('./n8n');
      const result = await n8nDelegateYoutubeFeedAction.execute(noopArgs({}));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_CHANNEL_URL');
    });
  });

  // ─── youtube-community ────────────────────────────────────────────────

  describe('n8n.delegate.youtube-community', () => {
    it('delegates with communityUrl', async () => {
      mockDelegateYoutubeScrape.mockResolvedValue(delegationOk({ id: '1', link: 'http://x' }));
      const { n8nDelegateYoutubeScrapAction } = await import('./n8n');
      const result = await n8nDelegateYoutubeScrapAction.execute(noopArgs({ communityUrl: 'https://youtube.com/@ch/community' }));
      expect(result.ok).toBe(true);
    });
  });

  // ─── alert ────────────────────────────────────────────────────────────

  describe('n8n.delegate.alert', () => {
    it('delegates alert with title and message', async () => {
      mockDelegateAlert.mockResolvedValue(delegationOk());
      const { n8nDelegateAlertAction } = await import('./n8n');
      const result = await n8nDelegateAlertAction.execute(noopArgs({ title: 'Alert', message: 'Price up' }));
      expect(result.ok).toBe(true);
      expect(mockDelegateAlert).toHaveBeenCalledWith('Alert', 'Price up', {});
    });

    it('passes tags object', async () => {
      mockDelegateAlert.mockResolvedValue(delegationOk());
      const { n8nDelegateAlertAction } = await import('./n8n');
      await n8nDelegateAlertAction.execute(noopArgs({ title: 'A', message: 'B', tags: { severity: 'high' } }));
      expect(mockDelegateAlert).toHaveBeenCalledWith('A', 'B', { severity: 'high' });
    });

    it('fails when title or message missing', async () => {
      const { n8nDelegateAlertAction } = await import('./n8n');
      const result = await n8nDelegateAlertAction.execute(noopArgs({ title: 'A' }));
      expect(result.ok).toBe(false);
    });
  });

  // ─── article-context ──────────────────────────────────────────────────

  describe('n8n.delegate.article-context', () => {
    it('delegates with url', async () => {
      mockDelegateArticleContext.mockResolvedValue(delegationOk({ title: 'T', description: 'D' }));
      const { n8nDelegateArticleContextAction } = await import('./n8n');
      const result = await n8nDelegateArticleContextAction.execute(noopArgs({ url: 'https://example.com' }));
      expect(result.ok).toBe(true);
    });

    it('fails when url missing', async () => {
      const { n8nDelegateArticleContextAction } = await import('./n8n');
      const result = await n8nDelegateArticleContextAction.execute(noopArgs({}));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('MISSING_URL');
    });
  });

  // ─── delegation failure propagation ───────────────────────────────────

  describe('delegation failure', () => {
    it('propagates delegation error message', async () => {
      mockDelegateNewsRss.mockResolvedValue(delegationFail('TIMEOUT'));
      const { n8nDelegateNewsRssAction } = await import('./n8n');
      const result = await n8nDelegateNewsRssAction.execute(noopArgs({ query: 'AI' }));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('TIMEOUT');
      expect(result.summary).toContain('TIMEOUT');
    });
  });

  // ─── Registry integration ────────────────────────────────────────────

  describe('registry', () => {
    it('all delegation actions are discoverable', async () => {
      const { listActions } = await import('./registry');
      const actions = listActions();
      const delegateNames = actions
        .filter((a) => a.name.startsWith('n8n.delegate.'))
        .map((a) => a.name);

      expect(delegateNames).toContain('n8n.delegate.news-rss');
      expect(delegateNames).toContain('n8n.delegate.news-summarize');
      expect(delegateNames).toContain('n8n.delegate.news-monitor');
      expect(delegateNames).toContain('n8n.delegate.youtube-feed');
      expect(delegateNames).toContain('n8n.delegate.youtube-community');
      expect(delegateNames).toContain('n8n.delegate.alert');
      expect(delegateNames).toContain('n8n.delegate.article-context');
    });
  });
});
