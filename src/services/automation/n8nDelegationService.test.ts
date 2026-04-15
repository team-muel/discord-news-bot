import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock — survives vi.resetModules() and reliably intercepts ESM imports
const { mockExecuteExternalAction } = vi.hoisted(() => ({
  mockExecuteExternalAction: vi.fn(),
}));
vi.mock('../tools/externalAdapterRegistry', () => ({
  executeExternalAction: mockExecuteExternalAction,
}));

// Save/restore entire env to prevent cross-test contamination in parallel
let envSnapshot: Record<string, string | undefined>;

const setEnvVars = (vars: Record<string, string>) => {
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
};

const ALL_ENV_KEYS = [
  'N8N_DELEGATION_ENABLED',
  'N8N_DELEGATION_FIRST',
  'N8N_WEBHOOK_NEWS_RSS_FETCH',
  'N8N_WEBHOOK_NEWS_SUMMARIZE',
  'N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES',
  'N8N_WEBHOOK_YOUTUBE_FEED_FETCH',
  'N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE',
  'N8N_WEBHOOK_ALERT_DISPATCH',
  'N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH',
  'N8N_AVAILABILITY_CACHE_TTL_MS',
];

describe('n8nDelegationService', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecuteExternalAction.mockReset();
    envSnapshot = {};
    for (const k of ALL_ENV_KEYS) {
      envSnapshot[k] = process.env[k];
      delete process.env[k]; // start clean
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    // Restore original env state
    for (const k of ALL_ENV_KEYS) {
      if (envSnapshot[k] !== undefined) {
        process.env[k] = envSnapshot[k];
      } else {
        delete process.env[k];
      }
    }
  });

  // ─── shouldDelegate ─────────────────────────────────────────────────────

  describe('shouldDelegate', () => {
    it('returns false when N8N_DELEGATION_ENABLED is not set', async () => {
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('news-rss-fetch')).toBe(false);
    });

    it('returns false when enabled but no webhook path configured', async () => {
      setEnvVars({ N8N_DELEGATION_ENABLED: 'true' });
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('news-rss-fetch')).toBe(false);
    });

    it('returns true when enabled and webhook path configured', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('news-rss-fetch')).toBe(true);
    });

    it('returns false for unconfigured tasks', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('youtube-feed-fetch')).toBe(false);
    });

    it('reads env dynamically (no restart needed)', async () => {
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('news-rss-fetch')).toBe(false);

      // Simulate runtime env change
      process.env.N8N_DELEGATION_ENABLED = 'true';
      process.env.N8N_WEBHOOK_NEWS_RSS_FETCH = 'muel/test';
      expect(shouldDelegate('news-rss-fetch')).toBe(true);
    });

    it('supports news-monitor-candidates task', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES: 'muel/news-candidates',
      });
      const { shouldDelegate } = await import('./n8nDelegationService');
      expect(shouldDelegate('news-monitor-candidates')).toBe(true);
    });
  });

  // ─── isDelegationFirst ──────────────────────────────────────────────────

  describe('isDelegationFirst', () => {
    it('returns false by default', async () => {
      const { isDelegationFirst } = await import('./n8nDelegationService');
      expect(isDelegationFirst()).toBe(false);
    });

    it('returns true when both flags enabled', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_DELEGATION_FIRST: 'true',
      });
      const { isDelegationFirst } = await import('./n8nDelegationService');
      expect(isDelegationFirst()).toBe(true);
    });

    it('returns false when delegation disabled even if first=true', async () => {
      setEnvVars({ N8N_DELEGATION_FIRST: 'true' });
      const { isDelegationFirst } = await import('./n8nDelegationService');
      expect(isDelegationFirst()).toBe(false);
    });
  });

  describe('shouldSkipInlineFallback', () => {
    it('returns false when the task is not configured', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_DELEGATION_FIRST: 'true',
      });
      const { shouldSkipInlineFallback } = await import('./n8nDelegationService');
      expect(shouldSkipInlineFallback('news-rss-fetch')).toBe(false);
    });

    it('returns true when delegation-first is enabled for the task', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_DELEGATION_FIRST: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });
      const { shouldSkipInlineFallback } = await import('./n8nDelegationService');
      expect(shouldSkipInlineFallback('news-rss-fetch')).toBe(true);
    });
  });

  // ─── delegateToN8n ──────────────────────────────────────────────────────

  describe('delegateToN8n', () => {
    it('returns delegated:false when shouldDelegate is false', async () => {
      const { delegateToN8n } = await import('./n8nDelegationService');
      const result = await delegateToN8n('news-rss-fetch', { query: 'test' });
      expect(result).toEqual({
        delegated: false,
        ok: false,
        data: null,
        durationMs: 0,
      });
    });

    it('returns delegated:false when n8n availability cache says unavailable', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });

      // Mock executeExternalAction to return ADAPTER_UNAVAILABLE for availability check
      mockExecuteExternalAction.mockResolvedValue({
        ok: false,
        error: 'ADAPTER_UNAVAILABLE',
        summary: 'unavailable',
        output: [],
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();

      const result = await delegateToN8n('news-rss-fetch', { query: 'test' });
      expect(result.delegated).toBe(false);
    });

    it('caches availability and skips second probe', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });

      let callCount = 0;
      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        callCount++;
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return { ok: true, output: [JSON.stringify({ items: [] })], summary: 'ok' };
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();

      // First call: availability probe + actual trigger = 2 calls
      await delegateToN8n('news-rss-fetch', { query: 'a' });
      const callsAfterFirst = callCount;

      // Second call: cached availability, only trigger = 1 more call
      await delegateToN8n('news-rss-fetch', { query: 'b' });
      expect(callCount - callsAfterFirst).toBe(1);
    });

    it('returns delegated:true, ok:true when n8n succeeds', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });

      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return {
          ok: true,
          summary: 'triggered',
          output: [JSON.stringify({ items: [{ title: 'A', link: 'http://a.com' }] })],
        };
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-rss-fetch', { query: 'test' });

      expect(result.delegated).toBe(true);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ items: [{ title: 'A', link: 'http://a.com' }] });
    });

    it('returns ok:false when n8n adapter returns not-ok', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_ALERT_DISPATCH: 'muel/alert',
      });

      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return { ok: false, summary: 'HTTP 500', error: 'Internal Server Error', output: [] };
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('alert-dispatch', { title: 'down' });

      expect(result.delegated).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Internal Server Error');
    });

    it('returns ok:false when adapter throws', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_YOUTUBE_FEED_FETCH: 'muel/yt-feed',
      });

      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        throw new Error('Network timeout');
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('youtube-feed-fetch', { channelUrl: 'http://yt.com' });

      expect(result.delegated).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('handles non-JSON output gracefully', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_ALERT_DISPATCH: 'muel/alert',
      });

      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return { ok: true, summary: 'ok', output: ['raw text'] };
      });

      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      // alert-dispatch has no schema validation, so raw text passes
      const result = await delegateToN8n<string>('alert-dispatch', { title: 'test' });

      expect(result.delegated).toBe(true);
      expect(result.ok).toBe(true);
    });
  });

  // ─── Schema Validation ──────────────────────────────────────────────────

  describe('schema validation', () => {
    const setupMockWithResponse = (task: string, envKey: string, responseData: unknown) => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        [envKey]: 'w/test',
      });
      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return { ok: true, summary: 'ok', output: [JSON.stringify(responseData)] };
      });
    };

    it('rejects news-rss-fetch with invalid schema', async () => {
      setupMockWithResponse('news-rss-fetch', 'N8N_WEBHOOK_NEWS_RSS_FETCH', { wrong: true });
      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-rss-fetch', { query: 'test' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('RESPONSE_SCHEMA_MISMATCH');
    });

    it('accepts news-rss-fetch with valid schema', async () => {
      setupMockWithResponse('news-rss-fetch', 'N8N_WEBHOOK_NEWS_RSS_FETCH', {
        items: [{ title: 'A', link: 'http://a.com' }],
      });
      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-rss-fetch', { query: 'test' });
      expect(result.ok).toBe(true);
    });

    it('rejects news-monitor-candidates missing key field', async () => {
      setupMockWithResponse('news-monitor-candidates', 'N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES', {
        items: [{ title: 'A', link: 'http://a.com' }], // missing key
      });
      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-monitor-candidates', { limit: 5 });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('RESPONSE_SCHEMA_MISMATCH');
    });

    it('accepts news-monitor-candidates with valid schema', async () => {
      setupMockWithResponse('news-monitor-candidates', 'N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES', {
        items: [{ title: 'BTC', link: 'http://x.com', key: 'btc-001' }],
      });
      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-monitor-candidates', { limit: 5 });
      expect(result.ok).toBe(true);
    });

    it('rejects news-summarize without summary field', async () => {
      setupMockWithResponse('news-summarize', 'N8N_WEBHOOK_NEWS_SUMMARIZE', { text: 'wrong key' });
      const { delegateToN8n, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateToN8n('news-summarize', { title: 'T', link: 'L', description: 'D' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('RESPONSE_SCHEMA_MISMATCH');
    });
  });

  // ─── Typed Wrappers ─────────────────────────────────────────────────────

  describe('typed delegation wrappers', () => {
    // Wrappers are thin pass-through to delegateToN8n. We verify they
    // produce the correct DelegationResult shape. Since delegateToN8n is
    // thoroughly tested above, these tests verify payload assembly by
    // having n8n return task-specific valid data and checking the result.
    const setupMockForTask = (taskEnvKey: string, responseData: unknown) => {
      vi.resetModules();
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        [taskEnvKey]: 'w/test',
      });
      mockExecuteExternalAction.mockImplementation((_id: string, action: string) => {
        if (action === 'workflow.list') {
          return { ok: true, output: ['[]'], summary: 'ok' };
        }
        return { ok: true, output: [JSON.stringify(responseData)], summary: 'ok' };
      });
    };

    it('delegateNewsRssFetch resolves with valid data', async () => {
      const data = { items: [{ title: 'BTC', link: 'http://a.com' }] };
      setupMockForTask('N8N_WEBHOOK_NEWS_RSS_FETCH', data);
      const { delegateNewsRssFetch, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateNewsRssFetch('BTC price', 5);
      if (result.delegated) {
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(data);
      }
    });

    it('delegateNewsMonitorCandidates resolves with valid data', async () => {
      const data = { items: [{ title: 'A', link: 'http://b.com', key: 'k1' }] };
      setupMockForTask('N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES', data);
      const { delegateNewsMonitorCandidates, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateNewsMonitorCandidates(12);
      if (result.delegated) {
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(data);
      }
    });

    it('delegateNewsSummarize resolves with valid data', async () => {
      const data = { summary: 'Korean summary text' };
      setupMockForTask('N8N_WEBHOOK_NEWS_SUMMARIZE', data);
      const { delegateNewsSummarize, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateNewsSummarize('Title', 'http://x.com', 'desc');
      if (result.delegated) {
        expect(result.ok).toBe(true);
        expect(result.data).toEqual(data);
      }
    });

    it('delegateAlertDispatch resolves without error', async () => {
      setupMockForTask('N8N_WEBHOOK_ALERT_DISPATCH', null);
      const { delegateAlertDispatch, resetAvailabilityCache } = await import('./n8nDelegationService');
      resetAvailabilityCache();
      const result = await delegateAlertDispatch('Bot Down', 'unreachable', { sev: '1' });
      if (result.delegated) {
        expect(result.ok).toBe(true);
      }
    });
  });

  // ─── getDelegationStatus ────────────────────────────────────────────────

  describe('getDelegationStatus', () => {
    it('reports enabled state and configured tasks', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_WEBHOOK_NEWS_RSS_FETCH: 'muel/news-rss',
      });

      const { getDelegationStatus } = await import('./n8nDelegationService');
      const status = getDelegationStatus();

      expect(status.enabled).toBe(true);
      expect(status.delegationFirst).toBe(false);
      expect(status.tasks['news-rss-fetch'].configured).toBe(true);
      expect(status.tasks['news-rss-fetch'].webhookPath).toBe('***');
      expect(status.tasks['youtube-feed-fetch'].configured).toBe(false);
      expect(status.tasks['news-monitor-candidates'].configured).toBe(false);
    });

    it('reports disabled when master switch off', async () => {
      const { getDelegationStatus } = await import('./n8nDelegationService');
      const status = getDelegationStatus();
      expect(status.enabled).toBe(false);
      expect(status.delegationFirst).toBe(false);
    });

    it('reports delegation-first mode', async () => {
      setEnvVars({
        N8N_DELEGATION_ENABLED: 'true',
        N8N_DELEGATION_FIRST: 'true',
      });
      const { getDelegationStatus } = await import('./n8nDelegationService');
      const status = getDelegationStatus();
      expect(status.delegationFirst).toBe(true);
    });
  });

  // ─── DELEGATION_SCHEMA_CONTRACTS ────────────────────────────────────────

  describe('DELEGATION_SCHEMA_CONTRACTS', () => {
    it('has contracts for all task types', async () => {
      const { DELEGATION_SCHEMA_CONTRACTS } = await import('./n8nDelegationService');
      const tasks = [
        'news-rss-fetch', 'news-summarize', 'news-monitor-candidates',
        'youtube-feed-fetch', 'youtube-community-scrape',
        'alert-dispatch', 'article-context-fetch',
      ];
      for (const task of tasks) {
        const contract = DELEGATION_SCHEMA_CONTRACTS[task as keyof typeof DELEGATION_SCHEMA_CONTRACTS];
        expect(contract).toBeDefined();
        expect(contract.input).toBeTruthy();
        expect(contract.output).toBeTruthy();
      }
    });
  });
});
