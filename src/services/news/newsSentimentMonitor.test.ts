import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted mock for newsSentimentMonitor ──────────────────────────────────
vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('./sourceMonitorStore', () => ({
  claimSourceLock: vi.fn(),
  releaseSourceLock: vi.fn(),
  updateSourceState: vi.fn(),
}));

vi.mock('./newsMonitorWorkerClient', () => ({
  fetchNewsMonitorCandidatesByWorker: vi.fn(),
}));

vi.mock('../automation/n8nDelegationService', () => ({
  shouldDelegate: vi.fn(() => false),
  shouldSkipInlineFallback: vi.fn(() => false),
  delegateArticleContextFetch: vi.fn(),
  delegateNewsSummarize: vi.fn(),
}));

describe('newsSentimentMonitor', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('isNewsSentimentMonitorEnabled', () => {
    it('returns false by default', async () => {
      delete process.env.AUTOMATION_NEWS_ENABLED;
      const mod = await import('./newsSentimentMonitor');
      expect(mod.isNewsSentimentMonitorEnabled()).toBe(false);
    });

    it('returns true when AUTOMATION_NEWS_ENABLED=true', async () => {
      process.env.AUTOMATION_NEWS_ENABLED = 'true';
      const mod = await import('./newsSentimentMonitor');
      expect(mod.isNewsSentimentMonitorEnabled()).toBe(true);
      delete process.env.AUTOMATION_NEWS_ENABLED;
    });

    it('returns false when AUTOMATION_NEWS_ENABLED=false', async () => {
      process.env.AUTOMATION_NEWS_ENABLED = 'false';
      const mod = await import('./newsSentimentMonitor');
      expect(mod.isNewsSentimentMonitorEnabled()).toBe(false);
      delete process.env.AUTOMATION_NEWS_ENABLED;
    });
  });

  describe('getNewsSentimentMonitorSnapshot', () => {
    it('returns initial snapshot state', async () => {
      const mod = await import('./newsSentimentMonitor');
      const snap = mod.getNewsSentimentMonitorSnapshot();
      expect(snap).toHaveProperty('started');
      expect(snap).toHaveProperty('running');
      expect(snap).toHaveProperty('runCount');
      expect(snap).toHaveProperty('intervalMs');
      expect(typeof snap.intervalMs).toBe('number');
      expect(snap.intervalMs).toBeGreaterThanOrEqual(60_000);
    });
  });

  describe('stopNewsSentimentMonitor', () => {
    it('can be called safely when not started', async () => {
      const mod = await import('./newsSentimentMonitor');
      expect(() => mod.stopNewsSentimentMonitor()).not.toThrow();
    });
  });

  describe('normalizeNewsHistoryRow', () => {
    it('falls back to a lexical signature when legacy rows are missing event_signature', async () => {
      const mod = await import('./newsSentimentMonitor');

      const row = mod.normalizeNewsHistoryRow({
        guild_id: 'g1',
        title: 'Apple shares rise after earnings beat',
        link: 'https://example.com/apple',
        event_signature: null,
        created_at: '2026-04-11T00:00:00.000Z',
      });

      expect(row).toEqual({
        guild_id: 'g1',
        title: 'Apple shares rise after earnings beat',
        link: 'https://example.com/apple',
        event_signature: 'after|apple|beat|earnings|rise|shares',
        created_at: '2026-04-11T00:00:00.000Z',
      });
    });

    it('preserves explicit event_signature values', async () => {
      const mod = await import('./newsSentimentMonitor');

      const row = mod.normalizeNewsHistoryRow({
        guild_id: null,
        title: 'NVIDIA unveils new model',
        link: 'https://example.com/nvidia',
        event_signature: 'custom|signature',
        created_at: null,
      });

      expect(row).toEqual({
        guild_id: null,
        title: 'NVIDIA unveils new model',
        link: 'https://example.com/nvidia',
        event_signature: 'custom|signature',
        created_at: null,
      });
    });
  });
});
