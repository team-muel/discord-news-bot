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

vi.mock('./trustScoreService', () => ({
  resolveTrustBasedAutonomy: vi.fn().mockResolvedValue('approve-impl'),
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
  evaluateCrossLoopOutcomes,
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

    it('returns empty gradient when DB throws', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({
        from: () => { throw new Error('connection refused'); },
      });

      const g = await computeSystemGradient();
      expect(g.signals).toEqual([]);
      expect(g.topPriority).toBeNull();
      expect(g.totalScore).toBe(0);
    });

    it('produces quality-gate signal when success rate below 95%', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'agent_action_logs') {
          return { select: () => ({ in: () => ({ gte: () => ({ limit: () =>
            Promise.resolve({ data: [], error: null }) }) }) }) };
        }
        if (table === 'agent_weekly_reports') {
          return { select: () => ({
            eq: (field: string, val: string) => {
              if (val === 'go_no_go_weekly') {
                return { gte: () => ({ order: () => ({ limit: () =>
                  Promise.resolve({ data: [{ baseline_summary: { candidate_summary: { successRatePct: 82 } } }], error: null }) }) }) };
              }
              if (val === 'self_improvement_patterns') {
                return { gte: () => ({ order: () => ({ limit: () =>
                  Promise.resolve({ data: [], error: null }) }) }) };
              }
              if (val === 'jarvis_optimize_result') {
                return { gte: () => ({ order: () => ({ limit: () =>
                  Promise.resolve({ data: [], error: null }) }) }) };
              }
              return { gte: () => ({ order: () => ({ limit: () =>
                Promise.resolve({ data: [], error: null }) }) }) };
            },
            in: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          }) };
        }
        if (table === 'sprint_journal_entries') {
          return { select: () => ({ not: () => ({ gte: () => ({ order: () => ({ limit: () =>
            Promise.resolve({ data: [], error: null }) }) }) }) }) };
        }
        return { select: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () =>
          Promise.resolve({ data: [], error: null }) }) }) }) }) };
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      const g = await computeSystemGradient();
      const qualitySignal = g.signals.find((s) => s.source === 'quality-gate');
      expect(qualitySignal).toBeDefined();
      expect(qualitySignal!.severity).toBe('high'); // 82 < 90
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

    it('returns empty when DB throws', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({
        from: () => { throw new Error('timeout'); },
      });

      const r = await computeConvergenceReport();
      expect(r.overallVerdict).toBe('insufficient-data');
      expect(r.dataPoints).toBe(0);
    });

    it('computes improving verdict from rising quality scores', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const weeklyData = [
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 80 } }, created_at: '2026-02-20' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 85 } }, created_at: '2026-02-27' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 90 } }, created_at: '2026-03-06' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 94 } }, created_at: '2026-03-13' },
      ];
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'agent_weekly_reports') {
          return {
            select: () => ({
              in: () => ({ gte: () => ({ order: () => Promise.resolve({ data: weeklyData, error: null }) }) }),
              eq: (field: string, val: string) => {
                if (val === 'jarvis_optimize_result') {
                  return { gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
                }
                if (val === 'cross_loop_origin') {
                  return { gte: () => Promise.resolve({ data: [], error: null }) };
                }
                return { gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
              },
            }),
            upsert: () => Promise.resolve({ error: null }),
          };
        }
        if (table === 'sprint_journal_entries') {
          return { select: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) }) };
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      const r = await computeConvergenceReport();
      expect(r.qualityScoreTrend).toBe('improving');
      expect(r.dataPoints).toBeGreaterThan(0);
    });

    it('computes degrading verdict from declining quality and rising severity', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const weeklyData = [
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 95 } }, created_at: '2026-02-20' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 88 } }, created_at: '2026-02-27' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 80 } }, created_at: '2026-03-06' },
        { report_kind: 'go_no_go_weekly', baseline_summary: { candidate_summary: { successRatePct: 72 } }, created_at: '2026-03-13' },
        { report_kind: 'self_improvement_patterns', baseline_summary: { highSeverityCount: 0 }, created_at: '2026-02-20' },
        { report_kind: 'self_improvement_patterns', baseline_summary: { highSeverityCount: 2 }, created_at: '2026-02-27' },
        { report_kind: 'self_improvement_patterns', baseline_summary: { highSeverityCount: 5 }, created_at: '2026-03-06' },
        { report_kind: 'self_improvement_patterns', baseline_summary: { highSeverityCount: 8 }, created_at: '2026-03-13' },
      ];
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'agent_weekly_reports') {
          return {
            select: () => ({
              in: () => ({ gte: () => ({ order: () => Promise.resolve({ data: weeklyData, error: null }) }) }),
              eq: (field: string, val: string) => {
                if (val === 'jarvis_optimize_result') {
                  return { gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
                }
                if (val === 'cross_loop_origin') {
                  return { gte: () => Promise.resolve({ data: [], error: null }) };
                }
                return { gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
              },
            }),
            upsert: () => Promise.resolve({ error: null }),
          };
        }
        if (table === 'sprint_journal_entries') {
          return { select: () => ({ gte: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        return { select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) }) };
      });
      mockGetSupabaseClient.mockReturnValue({ from: mockFrom });

      const r = await computeConvergenceReport();
      expect(r.qualityScoreTrend).toBe('degrading');
      expect(r.highSeverityPatternTrend).toBe('degrading'); // inverted: counts increasing = degrading
      expect(r.overallVerdict).toBe('degrading');
    });
  });

  describe('checkBenchRegressionAndTrigger', () => {
    it('returns not triggered with insufficient data', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({ from: () => ({
        select: () => ({ eq: () => ({ gte: () => ({ order: () =>
          Promise.resolve({ data: [{ baseline_summary: { candidate_summary: { successRatePct: 90 } } }], error: null }) }) }) }),
      }) });

      const r = await checkBenchRegressionAndTrigger();
      expect(r.triggered).toBe(false);
    });

    it('triggers sprint on consecutive quality declines', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockCreateSprintPipeline.mockReturnValue({ sprintId: 'sprint-reg-1' });

      // 3 weeks of data, 2 consecutive declines (matches BENCH_REGRESSION_WEEKS=2)
      const data = [
        { baseline_summary: { candidate_summary: { successRatePct: 92 } }, created_at: '2026-03-06' },
        { baseline_summary: { candidate_summary: { successRatePct: 87 } }, created_at: '2026-03-13' },
        { baseline_summary: { candidate_summary: { successRatePct: 80 } }, created_at: '2026-03-20' },
      ];
      mockGetSupabaseClient.mockReturnValue({ from: () => ({
        select: () => ({ eq: () => ({ gte: () => ({ order: () =>
          Promise.resolve({ data, error: null }) }) }) }),
        upsert: vi.fn().mockResolvedValue({ error: null }),
      }) });

      const r = await checkBenchRegressionAndTrigger();
      expect(r.triggered).toBe(true);
      expect(r.sprintId).toBe('sprint-reg-1');
      expect(r.trend).toBeDefined();
      expect(r.trend!.length).toBe(3);
    });

    it('does not trigger when scores are stable', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const data = [
        { baseline_summary: { candidate_summary: { successRatePct: 90 } }, created_at: '2026-03-06' },
        { baseline_summary: { candidate_summary: { successRatePct: 91 } }, created_at: '2026-03-13' },
        { baseline_summary: { candidate_summary: { successRatePct: 89 } }, created_at: '2026-03-20' },
      ];
      mockGetSupabaseClient.mockReturnValue({ from: () => ({
        select: () => ({ eq: () => ({ gte: () => ({ order: () =>
          Promise.resolve({ data, error: null }) }) }) }),
      }) });

      const r = await checkBenchRegressionAndTrigger();
      expect(r.triggered).toBe(false);
    });

    it('handles DB error gracefully', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      mockGetSupabaseClient.mockReturnValue({
        from: () => { throw new Error('db error'); },
      });

      const r = await checkBenchRegressionAndTrigger();
      expect(r.triggered).toBe(false);
    });
  });

  describe('evaluateCrossLoopOutcomes', () => {
    it('returns empty when Supabase unconfigured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      const result = await evaluateCrossLoopOutcomes();
      expect(result.total).toBe(0);
      expect(result.successRate).toBe(0);
    });

    it('computes success rate from pipeline outcomes', async () => {
      mockIsSupabaseConfigured.mockReturnValue(true);
      const origins = [
        { baseline_summary: { sprintId: 'sp-1', originLoop: 'lacuna' } },
        { baseline_summary: { sprintId: 'sp-2', originLoop: 'weekly-bugfix' } },
        { baseline_summary: { sprintId: 'sp-3', originLoop: 'lacuna' } },
      ];
      const pipelines = [
        { sprint_id: 'sp-1', current_phase: 'complete' },
        { sprint_id: 'sp-2', current_phase: 'blocked', error: 'test failed' },
        { sprint_id: 'sp-3', current_phase: 'complete' },
      ];
      mockGetSupabaseClient.mockReturnValue({ from: (table: string) => {
        if (table === 'agent_weekly_reports') {
          return { select: () => ({ eq: () => ({ gte: () =>
            Promise.resolve({ data: origins, error: null }) }) }) };
        }
        if (table === 'sprint_pipelines') {
          return { select: () => ({ in: () =>
            Promise.resolve({ data: pipelines, error: null }) }) };
        }
        return {};
      } });

      const result = await evaluateCrossLoopOutcomes();
      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.successRate).toBeCloseTo(2 / 3);
      expect(result.outcomesByOrigin.lacuna?.succeeded).toBe(2);
    });
  });
});
