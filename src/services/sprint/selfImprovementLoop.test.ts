import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSprintPipeline = vi.fn();
const mockRunFullSprintPipeline = vi.fn();
const mockMarkPipelineBlocked = vi.fn();
const mockGetSupabaseClient = vi.fn();
const mockIsSupabaseConfigured = vi.fn();

vi.mock('./sprintOrchestrator', () => ({
  createSprintPipeline: (...args: unknown[]) => mockCreateSprintPipeline(...args),
  runFullSprintPipeline: (...args: unknown[]) => mockRunFullSprintPipeline(...args),
  markPipelineBlocked: (...args: unknown[]) => mockMarkPipelineBlocked(...args),
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getSupabaseClient: () => mockGetSupabaseClient(),
}));

vi.mock('../../config', () => ({
  SPRINT_ENABLED: true,
  SPRINT_AUTONOMY_LEVEL: 'approve-ship',
  SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED: true,
  SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE: 15,
  SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT: 3,
  SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED: true,
  SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED: true,
  SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS: 2,
  SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED: true,
  SELF_IMPROVEMENT_CONVERGENCE_ENABLED: true,
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  triggerLacunaSprintIfNeeded,
  checkWeeklyPatternsForBugfixTrigger,
  checkBenchRegressionAndTrigger,
  recordCrossLoopOrigin,
  getCrossLoopOriginsSnapshot,
  computeSystemGradient,
  computeConvergenceReport,
  type LacunaCandidate,
} from './selfImprovementLoop';

describe('selfImprovementLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunFullSprintPipeline.mockResolvedValue(undefined);
  });

  describe('triggerLacunaSprintIfNeeded', () => {
    it('skips when candidates below count threshold', async () => {
      const candidates: LacunaCandidate[] = [
        { guildId: 'g1', goal: 'test', normalizedGoal: 'test', count: 5, distinctRequestersSize: 3, score: 20, lacunaType: 'missing_action', missingActionNames: ['x'] },
      ];
      expect((await triggerLacunaSprintIfNeeded(candidates)).triggered).toBe(false);
      expect(mockCreateSprintPipeline).not.toHaveBeenCalled();
    });

    it('skips when total score below threshold', async () => {
      const candidates: LacunaCandidate[] = Array.from({ length: 3 }, (_, i) => ({
        guildId: 'g1', goal: `g${i}`, normalizedGoal: `g${i}`,
        count: 1, distinctRequestersSize: 1, score: 2,
        lacunaType: 'external_failure', missingActionNames: [],
      }));
      expect((await triggerLacunaSprintIfNeeded(candidates)).triggered).toBe(false);
    });

    it('triggers sprint when thresholds exceeded', async () => {
      mockCreateSprintPipeline.mockReturnValue({ sprintId: 'sprint-lac-1' });
      const candidates: LacunaCandidate[] = Array.from({ length: 4 }, (_, i) => ({
        guildId: 'g1', goal: `missing ${i}`, normalizedGoal: `missing-${i}`,
        count: 5, distinctRequestersSize: 3, score: 6,
        lacunaType: 'missing_action', missingActionNames: [`act${i}`],
      }));
      const result = await triggerLacunaSprintIfNeeded(candidates);
      expect(result.triggered).toBe(true);
      expect(result.sprintId).toBe('sprint-lac-1');
      expect(mockCreateSprintPipeline.mock.calls[0][0].triggerType).toBe('feature-request');
    });
  });

  describe('checkWeeklyPatternsForBugfixTrigger', () => {
    it('triggers on high-severity patterns', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockCreateSprintPipeline.mockReturnValue({ sprintId: 'sprint-bug-1' });

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{
                    baseline_summary: {
                      highSeverityCount: 2,
                      patterns: [{ id: 'p1', severity: 'high', signal: 'test signal' }],
                      regression: { worsened: [] },
                    },
                  }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      const result = await checkWeeklyPatternsForBugfixTrigger();
      expect(result.triggered).toBe(true);
      expect(mockCreateSprintPipeline.mock.calls[0][0].triggerType).toBe('self-improvement');
    });

    it('does not trigger when no high-severity', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);

      const mockFrom = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ baseline_summary: { highSeverityCount: 0, regression: { worsened: [] } } }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      expect((await checkWeeklyPatternsForBugfixTrigger()).triggered).toBe(false);
    });
  });

  describe('crossLoopTracking', () => {
    it('records and retrieves origins', () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({
        from: () => ({ upsert: vi.fn().mockResolvedValue({ error: null }) }),
      });

      recordCrossLoopOrigin({
        sprintId: 'sprint-x-1', originLoop: 'lacuna',
        triggeredAt: new Date().toISOString(), objective: 'test',
      });
      const found = getCrossLoopOriginsSnapshot().find((o) => o.sprintId === 'sprint-x-1');
      expect(found).toBeDefined();
      expect(found?.originLoop).toBe('lacuna');
    });
  });

  describe('computeSystemGradient', () => {
    it('returns empty when Supabase unconfigured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      const g = await computeSystemGradient();
      expect(g.signals).toEqual([]);
      expect(g.topPriority).toBeNull();
    });

    it('produces lacuna signal from action logs', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'agent_action_logs') {
          return { select: () => ({ in: () => ({ gte: () => ({ limit: () =>
            Promise.resolve({ data: Array.from({ length: 12 }, (_, i) => ({ error: 'ACTION_NOT_IMPLEMENTED', goal: `g${i}` })), error: null }) }) }) }) };
        }
        if (table === 'sprint_journal_entries') {
          return { select: () => ({ not: () => ({ gte: () => ({ order: () => ({ limit: () =>
            Promise.resolve({ data: [], error: null }) }) }) }) }) };
        }
        return { select: () => ({
          eq: () => ({ gte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
          in: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
        }) };
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      const g = await computeSystemGradient();
      expect(g.signals.length).toBeGreaterThan(0);
      expect(g.signals[0].source).toBe('lacuna-detector');
    });
  });

  describe('computeConvergenceReport', () => {
    it('returns insufficient-data when no reports', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({ from: () => ({
        select: () => ({
          in: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }),
      }) });
      const r = await computeConvergenceReport();
      expect(r.overallVerdict).toBe('insufficient-data');
    });
  });
});
