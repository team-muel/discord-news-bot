import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- mocks ----------
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>();
  return { ...actual };
});

const buildChainable = (terminal: { data?: unknown[]; count?: number; error?: unknown } = {}) => {
  const result = { data: terminal.data ?? [], error: terminal.error ?? null, count: terminal.count ?? 0 };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = vi.fn().mockImplementation(self);
  chain.gte = vi.fn().mockImplementation(self);
  chain.lte = vi.fn().mockImplementation(self);
  chain.or = vi.fn().mockImplementation(self);
  chain.order = vi.fn().mockImplementation(self);
  chain.limit = vi.fn().mockImplementation(self);
  chain.data = result.data;
  chain.error = result.error;
  chain.count = result.count;
  // Supabase query builders are thenable — resolve with plain result object to avoid recursive thenable
  chain.then = (resolve: (v: unknown) => void, _reject?: (e: unknown) => void) => {
    return Promise.resolve().then(() => resolve(result));
  };
  return chain;
};

const mockFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue(buildChainable()),
});
const mockIsConfigured = vi.fn().mockReturnValue(true);

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsConfigured(),
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// ---------- import under test ----------
const {
  estimateActionExecutionCostUsd,
  getFinopsSummary,
  getFinopsBudgetStatus,
  decideFinopsAction,
} = await import('./finopsService');

describe('finopsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue(buildChainable()),
    });
  });

  describe('estimateActionExecutionCostUsd', () => {
    it('returns a positive cost for successful action', () => {
      const cost = estimateActionExecutionCostUsd({
        ok: true,
        retryCount: 0,
        durationMs: 1000,
      });
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });

    it('adds failure penalty for failed actions', () => {
      const okCost = estimateActionExecutionCostUsd({ ok: true, retryCount: 0, durationMs: 500 });
      const failCost = estimateActionExecutionCostUsd({ ok: false, retryCount: 0, durationMs: 500 });
      expect(failCost).toBeGreaterThan(okCost);
    });

    it('adds retry cost per retry', () => {
      const noRetry = estimateActionExecutionCostUsd({ ok: true, retryCount: 0, durationMs: 0 });
      const withRetry = estimateActionExecutionCostUsd({ ok: true, retryCount: 3, durationMs: 0 });
      expect(withRetry).toBeGreaterThan(noRetry);
    });

    it('handles zero/negative inputs safely', () => {
      const cost = estimateActionExecutionCostUsd({ ok: true, retryCount: -1, durationMs: -100 });
      expect(cost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getFinopsSummary', () => {
    it('returns empty summary when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      const result = await getFinopsSummary({ days: 7 });
      expect(result.enabled).toBe(true);
      expect(result.totals.estimatedTotalUsd).toBe(0);
      expect(result.assumptions).toContain('SUPABASE not configured; summary is empty.');
    });

    it('returns summary with zero totals when no data', async () => {
      const result = await getFinopsSummary({ days: 7 });
      expect(result.windowDays).toBe(7);
      expect(result.totals.actionCostUsd).toBe(0);
      expect(result.totals.retrievalCostUsd).toBe(0);
      expect(result.totals.memoryJobCostUsd).toBe(0);
      expect(result.topActions).toEqual([]);
    });

    it('scopes to guildId when provided', async () => {
      // getFinopsSummary calls from() 3 times (actions, retrieval, jobs) — each needs chainable
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockImplementation(() => buildChainable()),
      }));
      const result = await getFinopsSummary({ guildId: '123456789012345678', days: 1 });
      expect(result.scope).toBe('123456789012345678');
    });
  });

  describe('decideFinopsAction', () => {
    const normalBudget = {
      enabled: true,
      guildId: 'test',
      mode: 'normal' as const,
      daily: { spendUsd: 1, budgetUsd: 5, utilization: 0.2 },
      monthly: { spendUsd: 20, budgetUsd: 100, utilization: 0.2 },
      thresholds: { degrade: 0.9, block: 1.0 },
      generatedAt: new Date().toISOString(),
    };

    const degradedBudget = { ...normalBudget, mode: 'degraded' as const };
    const blockedBudget = { ...normalBudget, mode: 'blocked' as const };

    it('allows any action in normal mode', () => {
      const result = decideFinopsAction({ budget: normalBudget, actionName: 'some.action' });
      expect(result.allow).toBe(true);
      expect(result.mode).toBe('normal');
    });

    it('blocks non-exempt actions in degraded mode', () => {
      const result = decideFinopsAction({ budget: degradedBudget, actionName: 'sprint.implement' });
      expect(result.allow).toBe(false);
      expect(result.mode).toBe('degraded');
    });

    it('allows exempt actions in degraded mode', () => {
      const result = decideFinopsAction({ budget: degradedBudget, actionName: 'rag.retrieve' });
      expect(result.allow).toBe(true);
    });

    it('blocks non-exempt actions in blocked mode', () => {
      const result = decideFinopsAction({ budget: blockedBudget, actionName: 'sprint.implement' });
      expect(result.allow).toBe(false);
      expect(result.mode).toBe('blocked');
    });

    it('allows privacy.forget in blocked mode (exempt)', () => {
      const result = decideFinopsAction({ budget: blockedBudget, actionName: 'privacy.forget.user' });
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('FINOPS_BLOCK_BYPASS_EXEMPT');
    });

    it('allows everything when budget disabled', () => {
      const disabledBudget = { ...blockedBudget, enabled: false };
      const result = decideFinopsAction({ budget: disabledBudget, actionName: 'any.action' });
      expect(result.allow).toBe(true);
    });
  });
});
