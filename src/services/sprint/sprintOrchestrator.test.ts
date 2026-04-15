import { describe, it, expect, vi } from 'vitest';

// Explicitly set SPRINT_ENABLED=false so the "disabled" test path is exercised
// regardless of the production default (which is true).
vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, SPRINT_ENABLED: false };
});

import {
  createSprintPipeline,
  getSprintPipeline,
  listSprintPipelines,
  cancelSprintPipeline,
  getSprintRuntimeSnapshot,
  getSprintMetrics,
  recordPhaseMetric,
  getPhaseExternalAdapterMap,
  getAdapterCircuitBreakerSnapshot,
} from './sprintOrchestrator';
import { buildExternalAdapterArgs, buildSecondaryAdapterArgs } from './sprintWorkerRouter';

// SPRINT_ENABLED is mocked to false above — createSprintPipeline throws.
// Other runtime snapshot functions remain testable.

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
      expect(typeof m.scaffoldingRatio).toBe('number');
      expect(typeof m.scaffoldingTimeRatio).toBe('number');
      expect(typeof m.deterministicPhasesExecuted).toBe('number');
      expect(typeof m.llmPhasesExecuted).toBe('number');
      expect(Array.isArray(m.recentTimings)).toBe(true);
    });

    it('recordPhaseMetric이 카운터를 증가시킨다', () => {
      const before = getSprintMetrics().totalPhasesExecuted;
      recordPhaseMetric('qa', 150, false);
      const after = getSprintMetrics().totalPhasesExecuted;
      expect(after).toBe(before + 1);
    });

    it('recordPhaseMetric이 deterministic 플래그를 추적한다', () => {
      const before = getSprintMetrics();
      const prevDet = before.deterministicPhasesExecuted;
      const prevLlm = before.llmPhasesExecuted;
      recordPhaseMetric('qa', 100, false, true);
      recordPhaseMetric('plan', 200, false, false);
      const after = getSprintMetrics();
      expect(after.deterministicPhasesExecuted).toBe(prevDet + 1);
      expect(after.llmPhasesExecuted).toBe(prevLlm + 1);
      expect(after.scaffoldingRatio).toBeGreaterThan(0);
    });
  });

  describe('getPhaseExternalAdapterMap', () => {
    it('implement와 ship을 제외한 핵심 단계에 외부 어댑터가 매핑되어 있다', () => {
      const map = getPhaseExternalAdapterMap();
      const requiredPhases = ['plan', 'review', 'qa', 'security-audit', 'ops-validate', 'retro'] as const;
      for (const phase of requiredPhases) {
        expect(map[phase], `phase "${phase}" should have an adapter mapping`).toBeDefined();
        expect(map[phase]!.adapterId).toBeTruthy();
        expect(map[phase]!.action).toBeTruthy();
      }
    });

    it('implement 단계는 외부 어댑터 성공으로 끝내지 않고 canonical executor로 수렴한다', () => {
      const map = getPhaseExternalAdapterMap();
      expect(map['implement']).toBeUndefined();
    });

    it('qa 단계에 openjarvis가 매핑되어 있다', () => {
      const map = getPhaseExternalAdapterMap();
      expect(map['qa']!.adapterId).toBe('openjarvis');
      expect(map['qa']!.action).toBe('jarvis.ask');
    });

    it('composite phase에 secondary adapter가 있다', () => {
      const map = getPhaseExternalAdapterMap();
      // plan has deepwiki primary + openjarvis secondary
      expect(map['plan']!.secondary).toBeDefined();
      expect(map['plan']!.secondary!.adapterId).toBe('openjarvis');
      // review keeps canonical review primary + DeepWiki diagnostics secondary
      expect(map['review']!.secondary).toBeDefined();
      expect(map['review']!.secondary!.adapterId).toBe('deepwiki');
      expect(map['review']!.secondary!.action).toBe('wiki.diagnose');
      // qa has openjarvis primary + openshell secondary
      expect(map['qa']!.secondary).toBeDefined();
      expect(map['qa']!.secondary!.adapterId).toBe('openshell');
    });

    it('ship 단계는 외부 어댑터 없이 local fallback만 사용한다', () => {
      const map = getPhaseExternalAdapterMap();
      expect(map['ship']).toBeUndefined();
    });

    it('매핑의 복사본을 반환한다 (원본 불변)', () => {
      const map1 = getPhaseExternalAdapterMap();
      const map2 = getPhaseExternalAdapterMap();
      expect(map1).toEqual(map2);
      expect(map1).not.toBe(map2);
    });
  });

  describe('getAdapterCircuitBreakerSnapshot', () => {
    it('초기 상태에서 빈 객체를 반환한다', () => {
      const snap = getAdapterCircuitBreakerSnapshot();
      expect(typeof snap).toBe('object');
    });

    it('스냅샷의 각 항목은 failures, tripped, trippedAt 필드를 가진다', () => {
      const snap = getAdapterCircuitBreakerSnapshot();
      for (const entry of Object.values(snap)) {
        expect(typeof entry.failures).toBe('number');
        expect(typeof entry.tripped).toBe('boolean');
      }
    });
  });

  describe('PhaseResult type', () => {
    it('adapterMeta 필드가 선택적이다', () => {
      // Type-level check: PhaseResult without adapterMeta is valid
      const result = {
        phase: 'plan' as const,
        status: 'success' as const,
        output: 'test',
        artifacts: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        iterationCount: 1,
      };
      expect(result.phase).toBe('plan');
    });

    it('adapterMeta 필드가 올바른 구조를 가진다', () => {
      const result = {
        phase: 'qa' as const,
        status: 'success' as const,
        output: 'test',
        artifacts: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        iterationCount: 1,
        adapterMeta: {
          adapterId: 'openjarvis',
          action: 'jarvis.ask',
          durationMs: 1234,
          ok: true,
          secondary: { adapterId: 'openshell', action: 'sandbox.exec' },
        },
      };
      expect(result.adapterMeta.adapterId).toBe('openjarvis');
      expect(result.adapterMeta.durationMs).toBe(1234);
      expect(result.adapterMeta.ok).toBe(true);
      expect(result.adapterMeta.secondary!.adapterId).toBe('openshell');
    });
  });

  describe('buildExternalAdapterArgs', () => {
    const pipeline = { sprintId: 'sp-1', objective: 'Fix auth bug', changedFiles: ['src/auth.ts'] };

    it('implement phase는 generic fallback args만 유지한다', () => {
      const args = buildExternalAdapterArgs('implement', pipeline);
      expect(args.goal).toBe('Fix auth bug');
      expect(args.question).toContain('Fix auth bug');
      expect(args.code).toContain('src/auth.ts');
    });

    it('plan phase에 wiki.ask args를 생성한다', () => {
      const args = buildExternalAdapterArgs('plan', pipeline);
      expect(args.repo).toBe('team-muel/discord-news-bot');
      expect(args.question).toContain('Fix auth bug');
    });

    it('security-audit phase에 OWASP 키워드를 포함한다', () => {
      const args = buildExternalAdapterArgs('security-audit', pipeline);
      expect(args.goal).toContain('OWASP');
    });

    it('ops-validate phase에 telemetry window를 설정한다', () => {
      const args = buildExternalAdapterArgs('ops-validate', pipeline);
      expect(args.window).toBe('1h');
    });

    it('qa phase는 OpenJarvis orchestrator agent를 우선 사용한다', () => {
      const args = buildExternalAdapterArgs('qa', pipeline);
      expect(args.question).toContain('Analyze test coverage gaps');
      expect(args.agent).toBe('orchestrator');
    });
  });

  describe('buildSecondaryAdapterArgs', () => {
    const pipeline = { sprintId: 'sp-2', objective: 'Add caching', changedFiles: ['src/cache.ts'] };

    it('plan phase secondary에 primary output을 포함한다', () => {
      const args = buildSecondaryAdapterArgs('plan', pipeline, 'Architecture shows singleton pattern.');
      expect(args.query).toContain('Architecture shows singleton pattern');
    });

    it('qa phase secondary에 sandbox exec 명령을 생성한다', () => {
      const args = buildSecondaryAdapterArgs('qa', pipeline, 'test gaps found');
      expect(args.command).toContain('vitest');
      expect(args.mode).toBe('read_only');
    });

    it('review phase secondary에 DeepWiki 진단 args를 생성한다', () => {
      const args = buildSecondaryAdapterArgs('review', pipeline, 'Potential regression in cache invalidation path');
      expect(args.repo).toBe('team-muel/discord-news-bot');
      expect(args.phase).toBe('review');
      expect(args.objective).toBe('Add caching');
      expect(args.changedFiles).toEqual(['src/cache.ts']);
      expect(args.primaryOutput).toContain('Potential regression');
    });

    it('security-audit secondary는 memory search를 한다', () => {
      const args = buildSecondaryAdapterArgs('security-audit', pipeline, 'review output');
      expect(args.query).toContain('security');
      expect(args.limit).toBe(5);
    });

    it('ops-validate secondary는 OpenJarvis orchestrator로 metrics를 해석한다', () => {
      const args = buildSecondaryAdapterArgs('ops-validate', pipeline, 'latency=120ms');
      expect(args.question).toContain('Interpret these operational metrics');
      expect(args.agent).toBe('orchestrator');
    });
  });
});
