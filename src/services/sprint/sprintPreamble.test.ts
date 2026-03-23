import { describe, it, expect, beforeEach } from 'vitest';
import { trackSprintSession, getActiveSessionCount, buildSprintPreamble } from './sprintPreamble';

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
  });
});
