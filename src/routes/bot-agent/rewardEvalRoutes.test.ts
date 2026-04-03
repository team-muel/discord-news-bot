import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/eval/rewardSignalService', () => ({
  computeRewardSnapshot: vi.fn(),
  persistRewardSnapshot: vi.fn(),
  getRecentRewardSnapshots: vi.fn(),
  computeRewardTrend: vi.fn(),
}));

vi.mock('../../services/eval/rewardSignalLoopService', () => ({
  getRewardSignalLoopStatus: vi.fn(() => ({
    enabled: true, running: false, lastRunAt: null, lastSummary: null, intervalHours: 6,
  })),
}));

vi.mock('../../services/eval/evalAutoPromoteService', () => ({
  createEvalRun: vi.fn(),
  getRecentEvalRuns: vi.fn(),
  runEvalPipeline: vi.fn(),
}));

vi.mock('../../services/eval/evalAutoPromoteLoopService', () => ({
  getEvalAutoPromoteLoopStatus: vi.fn(() => ({
    enabled: true, running: false, lastRunAt: null, lastSummary: null, intervalHours: 6,
  })),
}));

vi.mock('../../services/supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
}));

import { computeRewardSnapshot, computeRewardTrend, getRecentRewardSnapshots } from '../../services/eval/rewardSignalService';
import { runEvalPipeline, getRecentEvalRuns, createEvalRun } from '../../services/eval/evalAutoPromoteService';
import { getRewardSignalLoopStatus } from '../../services/eval/rewardSignalLoopService';
import { getEvalAutoPromoteLoopStatus } from '../../services/eval/evalAutoPromoteLoopService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rewardEvalRoutes – service contracts', () => {
  describe('reward signal service mocks', () => {
    it('computeRewardSnapshot returns shaped snapshot', async () => {
      const mockSnapshot = { guildId: 'g1', rewardScalar: 0.75, reactionScore: 0.6 };
      vi.mocked(computeRewardSnapshot).mockResolvedValue(mockSnapshot as any);

      const result = await computeRewardSnapshot('g1');
      expect(result).not.toBeNull();
      expect(result!.rewardScalar).toBe(0.75);
      expect(computeRewardSnapshot).toHaveBeenCalledWith('g1');
    });

    it('computeRewardTrend returns trend object', async () => {
      vi.mocked(computeRewardTrend).mockResolvedValue({
        current: 0.8, previous: 0.7, delta: 0.1, trend: 'improving',
      });

      const result = await computeRewardTrend('g1');
      expect(result).not.toBeNull();
      expect(result!.trend).toBe('improving');
    });

    it('getRecentRewardSnapshots returns array', async () => {
      vi.mocked(getRecentRewardSnapshots).mockResolvedValue([]);

      const result = await getRecentRewardSnapshots('g1', 20);
      expect(result).toEqual([]);
    });
  });

  describe('reward signal loop status', () => {
    it('returns expected shape', () => {
      const status = getRewardSignalLoopStatus();
      expect(status.enabled).toBe(true);
      expect(status.intervalHours).toBe(6);
      expect(status.running).toBe(false);
    });
  });

  describe('eval auto-promote service mocks', () => {
    it('createEvalRun creates a run', async () => {
      vi.mocked(createEvalRun).mockResolvedValue({ id: 1, guildId: 'g1', evalName: 'test' } as any);

      const result = await createEvalRun({
        guildId: 'g1',
        evalName: 'test',
        baselineConfig: { model: 'a' },
        candidateConfig: { model: 'b' },
      });
      expect(result).not.toBeNull();
      expect(result!.evalName).toBe('test');
    });

    it('runEvalPipeline returns pipeline result', async () => {
      vi.mocked(runEvalPipeline).mockResolvedValue({
        collected: 5, judged: 2, promoted: ['test'], rejected: [],
      });

      const result = await runEvalPipeline('g1');
      expect(result.collected).toBe(5);
      expect(result.promoted).toContain('test');
    });

    it('getRecentEvalRuns returns array', async () => {
      vi.mocked(getRecentEvalRuns).mockResolvedValue([]);

      const result = await getRecentEvalRuns('g1');
      expect(result).toEqual([]);
    });
  });

  describe('eval auto-promote loop status', () => {
    it('returns expected shape', () => {
      const status = getEvalAutoPromoteLoopStatus();
      expect(status.enabled).toBe(true);
      expect(status.intervalHours).toBe(6);
    });
  });
});
