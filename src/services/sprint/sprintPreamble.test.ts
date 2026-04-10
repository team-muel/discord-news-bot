import { describe, it, expect, beforeEach } from 'vitest';
import {
  trackSprintSession,
  getActiveSessionCount,
  buildSprintPreamble,
  buildKnowledgeControlPromptSection,
  isActionBlockedInPhase,
  accumulateActionContext,
  getAccumulatedContextSection,
  clearSprintContext,
} from './sprintPreamble';

describe('sprintPreamble', () => {
  describe('trackSprintSession / getActiveSessionCount', () => {
    it('세션을 추적하고 카운트를 반환한다', () => {
      trackSprintSession('test-sprint-1');
      trackSprintSession('test-sprint-2');
      const count = getActiveSessionCount();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('같은 sprintId는 중복 카운트하지 않는다', () => {
      trackSprintSession('dedup-sprint');
      trackSprintSession('dedup-sprint');
      const before = getActiveSessionCount();
      trackSprintSession('dedup-sprint');
      const after = getActiveSessionCount();
      expect(after).toBe(before);
    });
  });

  describe('buildSprintPreamble', () => {
    it('문자열을 반환한다', () => {
      const preamble = buildSprintPreamble('sprint-preamble-test', 'plan');
      expect(typeof preamble).toBe('string');
      expect(preamble.length).toBeGreaterThan(0);
    });

    it('plan/implement 단계에서 Search Before Building을 포함한다', () => {
      const planPreamble = buildSprintPreamble('sprint-plan', 'plan');
      expect(planPreamble).toContain('Search Before Building');
      expect(planPreamble).toContain('Reuse First');
      expect(planPreamble).toContain('New File Creation Rules');
    });

    it('implement 단계에서 Completeness 섹션을 포함한다', () => {
      const implPreamble = buildSprintPreamble('sprint-impl', 'implement');
      expect(implPreamble).toContain('Completeness');
    });

    it('qa 단계에서 Completeness 섹션을 포함한다', () => {
      const qaPreamble = buildSprintPreamble('sprint-qa', 'qa');
      expect(qaPreamble).toContain('Completeness');
    });

    it('모든 단계에서 Question Format을 포함한다', () => {
      const preamble = buildSprintPreamble('sprint-any', 'retro');
      expect(preamble).toContain('Question Format');
    });

    it('plan 단계에서 Restricted Tool Categories를 포함한다', () => {
      const preamble = buildSprintPreamble('sprint-restrict', 'plan');
      expect(preamble).toContain('Restricted Tool Categories');
      expect(preamble).toContain('code');
    });

    it('implement 단계에서 Restricted Tool Categories를 포함하지 않는다', () => {
      const preamble = buildSprintPreamble('sprint-impl-noblock', 'implement');
      expect(preamble).not.toContain('Restricted Tool Categories');
    });

    it('plan/review/qa용 knowledge control prompt section을 만든다', () => {
      const section = buildKnowledgeControlPromptSection('plan', ['docs/planning/PLATFORM_CONTROL_TOWER.md']);
      expect(section).toContain('Knowledge Control Context');
      expect(section).toContain('blueprint_model: 4-plane-control-tower');
      expect(section).toContain('start_here_paths:');
      expect(section).toContain('Operating Baseline');
      expect(section).toContain('worker_machine: e2-medium');
      expect(section).toContain('Human-First Reference Policy');
      expect(section).toContain('human_first: true');
      expect(section).toContain('catalog_coverage:');
      expect(section).toContain('docs/planning/PLATFORM_CONTROL_TOWER.md');
    });

    it('implement 단계에는 knowledge control prompt section을 만들지 않는다', () => {
      expect(buildKnowledgeControlPromptSection('implement', [])).toBe('');
    });
  });

  describe('isActionBlockedInPhase', () => {
    it('plan 단계에서 code 카테고리를 차단한다', () => {
      const reason = isActionBlockedInPhase('plan', 'code');
      expect(reason).toContain('restricted');
    });

    it('plan 단계에서 data 카테고리를 허용한다', () => {
      expect(isActionBlockedInPhase('plan', 'data')).toBeNull();
    });

    it('retro 단계에서 tool 카테고리를 차단한다', () => {
      const reason = isActionBlockedInPhase('retro', 'tool');
      expect(reason).toContain('restricted');
    });

    it('implement 단계에서 agent 카테고리를 허용한다', () => {
      expect(isActionBlockedInPhase('implement', 'agent')).toBeNull();
    });
  });

  describe('accumulateActionContext', () => {
    const testSprintId = 'ctx-test-sprint';

    it('컨텍스트가 없으면 빈 문자열을 반환한다', () => {
      expect(getAccumulatedContextSection('nonexistent')).toBe('');
    });

    it('액션 결과를 축적하고 조회할 수 있다', () => {
      clearSprintContext(testSprintId);
      accumulateActionContext(testSprintId, 'plan', {
        ok: true,
        name: 'architect.plan',
        summary: 'Plan completed',
        artifacts: [],
        verification: [],
      });
      const section = getAccumulatedContextSection(testSprintId);
      expect(section).toContain('architect.plan');
      expect(section).toContain('OK');
      clearSprintContext(testSprintId);
    });

    it('clearSprintContext가 데이터를 제거한다', () => {
      accumulateActionContext(testSprintId, 'plan', {
        ok: true,
        name: 'test.action',
        summary: 'test',
        artifacts: [],
        verification: [],
      });
      clearSprintContext(testSprintId);
      expect(getAccumulatedContextSection(testSprintId)).toBe('');
    });
  });
});
