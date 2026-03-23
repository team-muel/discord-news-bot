import { describe, it, expect } from 'vitest';
import { isCrossModelPhase, formatCrossModelAppendix } from './crossModelVoice';
import type { CrossModelResult } from './crossModelVoice';

describe('crossModelVoice', () => {
  describe('isCrossModelPhase', () => {
    // SPRINT_CROSS_MODEL_ENABLED defaults to false in test env
    it('비활성화 상태에서는 모든 phase가 false다', () => {
      expect(isCrossModelPhase('review')).toBe(false);
      expect(isCrossModelPhase('security-audit')).toBe(false);
      expect(isCrossModelPhase('plan')).toBe(false);
      expect(isCrossModelPhase('implement')).toBe(false);
    });
  });

  describe('formatCrossModelAppendix', () => {
    it('결과를 마크다운으로 포맷한다', () => {
      const result: CrossModelResult = {
        enabled: true,
        provider: 'gemini',
        review: 'Looks good overall',
        agreements: ['Code structure is clean'],
        disagreements: ['Missing error handling in line 42'],
        durationMs: 1500,
      };

      const output = formatCrossModelAppendix(result);
      expect(typeof output).toBe('string');
      expect(output).toContain('gemini');
      expect(output).toContain('Missing error handling');
    });

    it('빈 agreements/disagreements를 처리한다', () => {
      const result: CrossModelResult = {
        enabled: true,
        provider: 'anthropic',
        review: 'No issues found',
        agreements: [],
        disagreements: [],
        durationMs: 500,
      };

      const output = formatCrossModelAppendix(result);
      expect(typeof output).toBe('string');
    });
  });
});
