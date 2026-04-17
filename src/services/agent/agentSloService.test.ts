import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildAgentRuntimeReadinessReport: vi.fn(),
  buildGoNoGoReport: vi.fn(),
  summarizeOpencodeQueueReadiness: vi.fn(),
  getMemoryQueueHealthSnapshot: vi.fn(),
  getSupabaseClient: vi.fn(),
  isSupabaseConfigured: vi.fn(),
  setGateProviderProfileOverride: vi.fn(),
}));

vi.mock('./agentRuntimeReadinessService', () => ({
  buildAgentRuntimeReadinessReport: mocks.buildAgentRuntimeReadinessReport,
}));

vi.mock('../goNoGoService', () => ({
  buildGoNoGoReport: mocks.buildGoNoGoReport,
}));

vi.mock('../opencode/opencodeGitHubQueueService', () => ({
  summarizeOpencodeQueueReadiness: mocks.summarizeOpencodeQueueReadiness,
}));

vi.mock('../memory/memoryJobRunner', () => ({
  getMemoryQueueHealthSnapshot: mocks.getMemoryQueueHealthSnapshot,
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

vi.mock('../llmClient', () => ({
  setGateProviderProfileOverride: mocks.setGateProviderProfileOverride,
}));

import { evaluateGuildSloReport } from './agentSloService';

const createQueryBuilder = (table: string, rows: Array<Record<string, unknown>>) => {
  const query: {
    select: () => typeof query;
    in: () => typeof query;
    order: () => typeof query;
    limit: () => Promise<{ data: Array<Record<string, unknown>>; error: null }>;
    eq: () => typeof query;
    gte: () => typeof query;
  } = {
    select: () => query,
    in: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error: null }),
    eq: () => query,
    gte: () => query,
  };

  if (table === 'agent_slo_policies') {
    return query;
  }

  return query;
};

describe('agentSloService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseClient.mockImplementation(() => ({
      from: (table: string) => {
        if (table === 'agent_slo_policies') {
          return createQueryBuilder(table, []);
        }
        if (table === 'agent_llm_call_logs') {
          return createQueryBuilder(table, [
            { success: true, latency_ms: 1200, created_at: '2026-04-15T00:00:00.000Z' },
            { success: true, latency_ms: 1800, created_at: '2026-04-15T00:05:00.000Z' },
            { success: true, latency_ms: 7800, created_at: '2026-04-15T00:10:00.000Z' },
          ]);
        }
        if (table === 'agent_tool_learning_candidates') {
          return createQueryBuilder(table, []);
        }
        if (table === 'agent_tool_learning_rules') {
          return createQueryBuilder(table, []);
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    }));

    mocks.buildAgentRuntimeReadinessReport.mockResolvedValue({
      metrics: {
        telemetryQueue: { processed: 10, dropped: 0 },
        actionDiagnostics: { totalRuns: 10, failedRuns: 0 },
      },
    });
    mocks.buildGoNoGoReport.mockResolvedValue({
      checks: [
        { id: 'citation-rate', actual: 0.99 },
        { id: 'recall-at-5', actual: 0.9 },
        { id: 'job-failure-rate', actual: 0.01 },
      ],
    });
    mocks.summarizeOpencodeQueueReadiness.mockResolvedValue({
      changeRequests: {
        evidenceCoverage: {
          highRiskMissing: 0,
        },
      },
    });
    mocks.getMemoryQueueHealthSnapshot.mockResolvedValue({
      queueLagP95Sec: 1,
      retryRatePct: 0,
      deadletterPendingCount: 0,
      deadletterIgnoredCount: 0,
    });
  });

  it('sets a temporary cost-optimized provider override when llm p95 latency breaches SLO', async () => {
    const report = await evaluateGuildSloReport({ guildId: 'guild-1' });

    expect(report.summary.decision).toBe('critical');
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: 'intelligence',
        key: 'llm_p95_latency_ms',
        status: 'fail',
        metric: 7800,
        threshold: 6000,
      }),
    ]));
    expect(mocks.setGateProviderProfileOverride).toHaveBeenCalledWith('cost-optimized', 'guild-1');
  });
});
