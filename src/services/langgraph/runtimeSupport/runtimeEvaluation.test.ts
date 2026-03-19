import { describe, expect, it } from 'vitest';

import {
  assessRuleBasedOrm,
  clamp01,
  evaluateTaskResultCandidate,
  extractActionableFeedbackPoints,
  parseSelfEvaluationJson,
} from './runtimeEvaluation';

describe('runtimeEvaluation', () => {
  const session = {
    goal: '테스트 목표',
    priority: 'balanced' as const,
    memoryHints: ['근거 [memory:m1]'],
    steps: [{ status: 'completed' }],
  };

  it('clamp01은 fallback과 범위 제한을 적용한다', () => {
    expect(clamp01('not-a-number', 0.4)).toBe(0.4);
    expect(clamp01(2, 0.4)).toBe(1);
    expect(clamp01(-1, 0.4)).toBe(0);
  });

  it('parseSelfEvaluationJson은 structured record를 파싱한다', () => {
    expect(parseSelfEvaluationJson('{"probability":0.8,"correctness":0.7}')).toEqual({
      probability: 0.8,
      correctness: 0.7,
    });
  });

  it('extractActionableFeedbackPoints는 실행 가능한 피드백을 우선 선택한다', () => {
    const points = extractActionableFeedbackPoints('1. 근거를 추가하세요\n2. 리스크를 명확히 쓰세요\n3. 문장을 짧게');
    expect(points[0]).toContain('근거');
    expect(points[1]).toContain('리스크');
  });

  it('assessRuleBasedOrm는 짧고 근거 없는 결과를 감점한다', () => {
    const orm = assessRuleBasedOrm({
      session: { ...session, memoryHints: [] },
      taskGoal: '테스트 목표',
      rawResult: '짧음',
      formattedResult: '짧음',
      passThreshold: 75,
      reviewThreshold: 55,
    });

    expect(orm.score).toBeLessThan(90);
    expect(orm.reasons).toContain('missing_memory_citation');
  });

  it('evaluateTaskResultCandidate는 formatted 결과와 orm 평가를 함께 반환한다', () => {
    const result = evaluateTaskResultCandidate({
      session,
      taskGoal: '테스트 목표',
      rawResult: '사용자에게 전달할 충분히 긴 결과입니다. 운영자 체크리스트와 근거를 포함해 정리했습니다.',
      passThreshold: 75,
      reviewThreshold: 55,
    });

    expect(result.formatted).toContain('## Deliverable');
    expect(result.orm.evidenceBundleId).toBeTruthy();
  });
});