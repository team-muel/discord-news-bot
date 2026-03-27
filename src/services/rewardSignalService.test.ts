import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabaseClient before importing the module under test
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => mockClient,
}));

const mockFrom = vi.fn();
const mockClient = {
  from: mockFrom,
};

// Helper to build a chainable query mock (thenable like Supabase PostgREST)
const chainableQuery = (data: any[] | null, error: any = null) => {
  const resolved = { data, error };
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolved),
    insert: vi.fn().mockResolvedValue(resolved),
    single: vi.fn().mockResolvedValue({ data: data?.[0] || null, error }),
    then: vi.fn((resolve: any) => Promise.resolve(resolved).then(resolve)),
  };
  return chain;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rewardSignalService', () => {
  it('computeRewardSnapshot returns null when no data', async () => {
    // Return empty data for all tables
    mockFrom.mockReturnValue(chainableQuery([]));

    const { computeRewardSnapshot } = await import('./rewardSignalService');
    const result = await computeRewardSnapshot('guild-123');
    expect(result).not.toBeNull();
    expect(result!.guildId).toBe('guild-123');
    // With no data, scores default to neutral (0.5)
    expect(result!.reactionScore).toBe(0.5);
    expect(result!.sessionSuccessRate).toBe(0.5);
    expect(result!.rewardScalar).toBeGreaterThanOrEqual(0);
    expect(result!.rewardScalar).toBeLessThanOrEqual(1);
  });

  it('computeRewardSnapshot blends signals correctly', async () => {
    // Session outcomes: 8 completed, 2 failed
    const sessionData = [
      ...Array.from({ length: 8 }, () => ({ status: 'completed' })),
      ...Array.from({ length: 2 }, () => ({ status: 'failed' })),
    ];

    // Retrieval: avg_score 0.7
    const retrievalData = [
      { avg_score: 0.6 },
      { avg_score: 0.8 },
    ];

    // Latency: 5000ms avg
    const latencyData = [
      { latency_ms: 4000 },
      { latency_ms: 6000 },
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'agent_sessions') return chainableQuery(sessionData);
      if (table === 'memory_retrieval_logs') return chainableQuery(retrievalData);
      if (table === 'agent_llm_call_logs') return chainableQuery(latencyData);
      return chainableQuery([]);
    });

    const { computeRewardSnapshot } = await import('./rewardSignalService');
    const result = await computeRewardSnapshot('guild-456');
    expect(result).not.toBeNull();
    expect(result!.raw.sessionTotal).toBe(10);
    expect(result!.raw.sessionSucceeded).toBe(8);
    expect(result!.sessionSuccessRate).toBeCloseTo(0.8, 1);
  });

  it('computeRewardTrend returns null with insufficient snapshots', async () => {
    mockFrom.mockReturnValue(chainableQuery([]));

    const { computeRewardTrend } = await import('./rewardSignalService');
    const result = await computeRewardTrend('guild-789');
    expect(result).toBeNull();
  });
});
