import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

// Mock supabaseClient before importing the module under test
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => mockClient,
}));

const mockFrom = vi.fn();
const mockClient = {
  from: mockFrom,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rewardSignalService', () => {
  it('computeRewardSnapshot returns null when no data', async () => {
    // Return empty data for all tables
    mockFrom.mockReturnValue(createSupabaseChain({ data: [], error: null }));

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
    // Reaction events from community_interaction_events
    // 3 adds + 1 negative + 1 remove of positive = net 2 up, 1 down
    const reactionData = [
      { metadata: { emoji: 'thumbsup', direction: 'add' } },
      { metadata: { emoji: 'thumbsup', direction: 'add' } },
      { metadata: { emoji: 'thumbsup', direction: 'add' } },
      { metadata: { emoji: 'rage', direction: 'add' } },
      { metadata: { emoji: 'thumbsup', direction: 'remove' } },
    ];

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
      if (table === 'community_interaction_events') return createSupabaseChain({ data: reactionData, error: null });
      if (table === 'agent_sessions') return createSupabaseChain({ data: sessionData, error: null });
      if (table === 'memory_retrieval_logs') return createSupabaseChain({ data: retrievalData, error: null });
      if (table === 'agent_llm_call_logs') return createSupabaseChain({ data: latencyData, error: null });
      return createSupabaseChain({ data: [], error: null });
    });

    const { computeRewardSnapshot } = await import('./rewardSignalService');
    const result = await computeRewardSnapshot('guild-456');
    expect(result).not.toBeNull();
    expect(result!.raw.sessionTotal).toBe(10);
    expect(result!.raw.sessionSucceeded).toBe(8);
    expect(result!.sessionSuccessRate).toBeCloseTo(0.8, 1);
    // Reaction: 3 add up - 1 remove up = 2 net up, 1 down = 2/3 ??0.667
    expect(result!.reactionScore).toBeCloseTo(0.667, 1);
  });

  it('computeRewardTrend returns null with insufficient snapshots', async () => {
    mockFrom.mockReturnValue(createSupabaseChain({ data: [], error: null }));

    const { computeRewardTrend } = await import('./rewardSignalService');
    const result = await computeRewardTrend('guild-789');
    expect(result).toBeNull();
  });

  it('computeRewardTrend returns null with exactly 2 snapshots', async () => {
    const snapshots = [
      { guild_id: 'g', window_start: '2025-01-01T06:00:00Z', window_end: '2025-01-01T12:00:00Z', reaction_score: 0.6, session_success_rate: 0.7, citation_rate: 0.5, latency_score: 0.5, reward_scalar: 0.6, reaction_up: 5, reaction_down: 2, session_total: 10, session_succeeded: 7 },
      { guild_id: 'g', window_start: '2025-01-01T00:00:00Z', window_end: '2025-01-01T06:00:00Z', reaction_score: 0.5, session_success_rate: 0.6, citation_rate: 0.5, latency_score: 0.5, reward_scalar: 0.5, reaction_up: 3, reaction_down: 3, session_total: 10, session_succeeded: 6 },
    ];
    mockFrom.mockReturnValue(createSupabaseChain({ data: snapshots, error: null }));

    const { computeRewardTrend } = await import('./rewardSignalService');
    const result = await computeRewardTrend('guild-boundary-2');
    expect(result).toBeNull();
  });

  it('computeRewardTrend returns trend with exactly 3 snapshots', async () => {
    const snapshots = [
      { guild_id: 'g', window_start: '2025-01-01T12:00:00Z', window_end: '2025-01-01T18:00:00Z', reward_scalar: 0.75 },
      { guild_id: 'g', window_start: '2025-01-01T06:00:00Z', window_end: '2025-01-01T12:00:00Z', reward_scalar: 0.70 },
      { guild_id: 'g', window_start: '2025-01-01T00:00:00Z', window_end: '2025-01-01T06:00:00Z', reward_scalar: 0.50 },
    ];
    mockFrom.mockReturnValue(createSupabaseChain({ data: snapshots, error: null }));

    const { computeRewardTrend } = await import('./rewardSignalService');
    const result = await computeRewardTrend('guild-boundary-3');
    expect(result).not.toBeNull();
    // recentCount = min(3, floor(3/2)) = 1; recent=[0.75], older=[0.70, 0.50]
    expect(result!.current).toBeCloseTo(0.75, 2);
    expect(result!.previous).toBeCloseTo(0.60, 2);
    expect(result!.delta).toBeCloseTo(0.15, 2);
    expect(result!.trend).toBe('improving');
  });
});
