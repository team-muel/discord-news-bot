import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Hoisted Supabase mock ──────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('sourceMonitorStore', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  const chainable = (finalResult: { data: any; error: any }) => {
    const chain: any = {};
    for (const m of ['update', 'select', 'eq', 'is', 'lt', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    // Terminal calls resolve with the final result
    chain.limit.mockResolvedValue(finalResult);
    // For chains ending with .eq() (e.g. releaseSourceLock), make the last
    // .eq() call also resolve the promise when awaited while still returning
    // chain for further chaining.
    const eqOriginal = chain.eq;
    chain.eq = vi.fn((...args: any[]) => {
      const result = eqOriginal(...args);
      // Support `await chain.eq(...)` — make it thenable
      result.then = (resolve: any, reject: any) => Promise.resolve(finalResult).then(resolve, reject);
      return result;
    });
    return chain;
  };

  // ── updateSourceState ─────────────────────────────────────────────

  describe('updateSourceState', () => {
    it('updates source with patch and last_check_at', async () => {
      const chain = chainable({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const { updateSourceState } = await import('./sourceMonitorStore');
      await updateSourceState({ id: 42, patch: { last_post_id: 'abc' }, logPrefix: '[TEST]' });

      expect(mockFrom).toHaveBeenCalledWith('sources');
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({ last_post_id: 'abc', last_check_at: expect.any(String) }),
      );
    });

    it('logs warning on error but does not throw', async () => {
      const chain = chainable({ data: null, error: { message: 'db down' } });
      mockFrom.mockReturnValue(chain);

      const { updateSourceState } = await import('./sourceMonitorStore');
      await expect(updateSourceState({ id: 1, patch: {}, logPrefix: '[T]' })).resolves.not.toThrow();
    });
  });

  // ── claimSourceLock ──────────────────────────────────────────────

  describe('claimSourceLock', () => {
    it('returns true when first strategy (null lock_token) succeeds', async () => {
      const chain = chainable({ data: [{ id: 1 }], error: null });
      mockFrom.mockReturnValue(chain);

      const { claimSourceLock } = await import('./sourceMonitorStore');
      const result = await claimSourceLock({
        id: 1, instanceId: 'inst-1', lockLeaseMs: 60_000, logPrefix: '[TEST]',
      });

      expect(result).toBe(true);
    });

    it('returns false when all 4 strategies fail (empty data)', async () => {
      const chain = chainable({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      const { claimSourceLock } = await import('./sourceMonitorStore');
      const result = await claimSourceLock({
        id: 1, instanceId: 'inst-1', lockLeaseMs: 60_000, logPrefix: '[TEST]',
      });

      expect(result).toBe(false);
      // Should have tried 4 strategies
      expect(mockFrom).toHaveBeenCalledTimes(4);
    });

    it('returns false on database error', async () => {
      const chain = chainable({ data: null, error: { message: 'timeout' } });
      mockFrom.mockReturnValue(chain);

      const { claimSourceLock } = await import('./sourceMonitorStore');
      const result = await claimSourceLock({
        id: 1, instanceId: 'inst-1', lockLeaseMs: 30_000, logPrefix: '[TEST]',
      });

      expect(result).toBe(false);
    });
  });

  // ── releaseSourceLock ────────────────────────────────────────────

  describe('releaseSourceLock', () => {
    it('releases lock for matching instanceId', async () => {
      const chain = chainable({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const { releaseSourceLock } = await import('./sourceMonitorStore');
      await releaseSourceLock({ id: 1, instanceId: 'inst-1', logPrefix: '[TEST]' });

      expect(mockFrom).toHaveBeenCalledWith('sources');
      expect(chain.update).toHaveBeenCalledWith({ lock_token: null, lock_expires_at: null });
      expect(chain.eq).toHaveBeenCalledWith('lock_token', 'inst-1');
    });

    it('logs warning on error but does not throw', async () => {
      const chain = chainable({ data: null, error: { message: 'db down' } });
      mockFrom.mockReturnValue(chain);

      const { releaseSourceLock } = await import('./sourceMonitorStore');
      await expect(releaseSourceLock({ id: 1, instanceId: 'x', logPrefix: '[T]' })).resolves.not.toThrow();
    });
  });
});
