import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => mockClient,
}));

vi.mock('./llmClient', () => ({
  generateText: vi.fn().mockResolvedValue('INCONCLUSIVE\nNot enough data'),
}));

vi.mock('./rewardSignalService', () => ({
  computeRewardSnapshot: vi.fn().mockResolvedValue({
    guildId: 'guild-test',
    windowStart: '2026-03-27T00:00:00Z',
    windowEnd: '2026-03-27T06:00:00Z',
    reactionScore: 0.8,
    sessionSuccessRate: 0.75,
    citationRate: 0.6,
    latencyScore: 0.7,
    rewardScalar: 0.72,
    raw: {
      reactionUp: 10, reactionDown: 2,
      sessionTotal: 20, sessionSucceeded: 15,
      retrievalLogsCount: 5, avgRetrievalScore: 0.6,
      avgLatencyMs: 3000, p95LatencyMs: 8000,
    },
  }),
  persistRewardSnapshot: vi.fn().mockResolvedValue(true),
}));

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

const mockClient = {
  from: vi.fn().mockImplementation(() => ({
    insert: mockInsert.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: { id: 1 }, error: null }) }) }),
    update: mockUpdate.mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) }),
    select: mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }),
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evalAutoPromoteService', () => {
  it('createEvalRun returns a new pending eval run', async () => {
    const { createEvalRun } = await import('./evalAutoPromoteService');
    const run = await createEvalRun({
      guildId: 'guild-test',
      evalName: 'test-eval',
      baselineConfig: { model: 'gpt-4o-mini' },
      candidateConfig: { model: 'gpt-4o' },
    });

    expect(run).not.toBeNull();
    expect(run!.verdict).toBe('pending');
    expect(run!.evalName).toBe('test-eval');
    expect(run!.sampleCount).toBe(0);
  });

  it('getPendingEvalRuns returns empty array when none exist', async () => {
    const { getPendingEvalRuns } = await import('./evalAutoPromoteService');
    const runs = await getPendingEvalRuns('guild-test');
    expect(runs).toEqual([]);
  });

  it('runEvalPipeline returns default result when no pending runs', async () => {
    const { runEvalPipeline } = await import('./evalAutoPromoteService');
    const result = await runEvalPipeline('guild-test');
    expect(result.collected).toBe(0);
    expect(result.judged).toBe(0);
    expect(result.promoted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});
