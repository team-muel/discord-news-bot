import { describe, it, expect } from 'vitest';
import { isJudgePhase, formatJudgeAppendix } from './llmJudge';
import type { JudgeResult } from './llmJudge';

describe('llmJudge', () => {
  describe('isJudgePhase', () => {
    // SPRINT_LLM_JUDGE_ENABLED defaults to false in test env
    it('비활성화 상태에서는 모든 phase가 false다', () => {
      expect(isJudgePhase('review')).toBe(false);
      expect(isJudgePhase('retro')).toBe(false);
      expect(isJudgePhase('plan')).toBe(false);
      expect(isJudgePhase('implement')).toBe(false);
    });
  });

  describe('formatJudgeAppendix', () => {
    it('judge 결과를 마크다운 테이블로 포맷한다', () => {
      const result: JudgeResult = {
        phase: 'review',
        score: {
          correctness: 8,
          completeness: 7,
          actionability: 9,
          overall: 8,
          explanation: 'Good quality review with minor gaps',
          suggestions: ['Add test for edge case', 'Document API changes'],
        },
        durationMs: 2000,
        judgedAt: new Date().toISOString(),
      };

      const output = formatJudgeAppendix(result);
      expect(typeof output).toBe('string');
      expect(output).toContain('8');
      expect(output).toContain('Good quality');
    });

    it('빈 suggestions를 처리한다', () => {
      const result: JudgeResult = {
        phase: 'retro',
        score: {
          correctness: 10,
          completeness: 10,
          actionability: 10,
          overall: 10,
          explanation: 'Perfect',
          suggestions: [],
        },
        durationMs: 500,
        judgedAt: new Date().toISOString(),
      };

      const output = formatJudgeAppendix(result);
      expect(typeof output).toBe('string');
    });
  });
});
