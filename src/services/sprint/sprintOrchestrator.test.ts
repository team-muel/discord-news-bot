import { describe, it, expect } from 'vitest';
import {
  createSprintPipeline,
  getSprintPipeline,
  listSprintPipelines,
  cancelSprintPipeline,
  getSprintRuntimeSnapshot,
  getSprintMetrics,
  recordPhaseMetric,
} from './sprintOrchestrator';

// Note: SPRINT_ENABLED=false in test env, so createSprintPipeline throws.
// We test that behavior + runtime snapshot (always available).

describe('sprintOrchestrator', () => {
  describe('createSprintPipeline', () => {
    it('SPRINT_ENABLED=false이면 에러를 던진다', () => {
      expect(() => createSprintPipeline({
        triggerId: 'test-trigger',
        triggerType: 'manual',
        guildId: 'test-guild-orchestrator',
        objective: 'Test objective',
      })).toThrow('Sprint pipeline is disabled');
    });
  });

  describe('getSprintPipeline', () => {
    it('존재하지 않는 ID는 null을 반환한다', () => {
      expect(getSprintPipeline('nonexistent-id')).toBeNull();
    });
  });

  describe('listSprintPipelines', () => {
    it('배열을 반환한다', () => {
      const list = listSprintPipelines();
      expect(Array.isArray(list)).toBe(true);
    });
  });

  describe('cancelSprintPipeline', () => {
    it('존재하지 않는 파이프라인은 실패한다', () => {
      const result = cancelSprintPipeline('nonexistent');
      expect(result.ok).toBe(false);
    });
  });

  describe('getSprintRuntimeSnapshot', () => {
    it('런타임 스냅샷 구조가 올바르다', () => {
      const snap = getSprintRuntimeSnapshot();
      expect(typeof snap.enabled).toBe('boolean');
      expect(typeof snap.defaultAutonomyLevel).toBe('string');
      expect(typeof snap.activePipelines).toBe('number');
      expect(typeof snap.completedPipelines).toBe('number');
      expect(typeof snap.blockedPipelines).toBe('number');
      expect(Array.isArray(snap.recentPipelines)).toBe(true);
    });
  });

  describe('getSprintMetrics', () => {
    it('메트릭 구조가 올바르다', () => {
      const m = getSprintMetrics();
      expect(typeof m.totalPipelinesCreated).toBe('number');
      expect(typeof m.totalPhasesExecuted).toBe('number');
      expect(typeof m.totalPhasesFailed).toBe('number');
      expect(typeof m.totalLoopBacks).toBe('number');
      expect(typeof m.avgPhaseDurationMs).toBe('number');
      expect(Array.isArray(m.recentTimings)).toBe(true);
    });

    it('recordPhaseMetric이 카운터를 증가시킨다', () => {
      const before = getSprintMetrics().totalPhasesExecuted;
      recordPhaseMetric('qa', 150, false);
      const after = getSprintMetrics().totalPhasesExecuted;
      expect(after).toBe(before + 1);
    });
  });
});
