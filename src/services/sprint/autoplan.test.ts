import { describe, it, expect } from 'vitest';
import { formatAutoplanAppendix } from './autoplan';
import type { AutoplanResult } from './autoplan';

describe('autoplan', () => {
  describe('formatAutoplanAppendix', () => {
    it('autoplan 결과를 마크다운으로 포맷한다', () => {
      const result: AutoplanResult = {
        reviews: [
          {
            lens: 'ceo',
            verdict: 'approve',
            feedback: 'Good scope and alignment',
            tasteDecisions: [],
            durationMs: 1000,
          },
          {
            lens: 'engineering',
            verdict: 'refine',
            feedback: 'Need more test coverage',
            tasteDecisions: ['Use integration tests over unit tests'],
            durationMs: 1200,
          },
          {
            lens: 'security',
            verdict: 'approve',
            feedback: 'No OWASP concerns',
            tasteDecisions: [],
            durationMs: 800,
          },
        ],
        synthesizedFeedback: 'Overall approved with engineering refinements needed.',
        requiresHumanDecision: true,
        tasteDecisions: ['Use integration tests over unit tests'],
        totalDurationMs: 3000,
      };

      const output = formatAutoplanAppendix(result);
      expect(typeof output).toBe('string');
      expect(output).toContain('ceo');
      expect(output).toContain('engineering');
      expect(output).toContain('security');
      expect(output).toContain('approve');
      expect(output).toContain('refine');
    });

    it('빈 reviews를 처리한다', () => {
      const result: AutoplanResult = {
        reviews: [],
        synthesizedFeedback: 'No reviews available',
        requiresHumanDecision: false,
        tasteDecisions: [],
        totalDurationMs: 0,
      };

      const output = formatAutoplanAppendix(result);
      expect(typeof output).toBe('string');
    });

    it('인간 결정 필요 플래그를 포함한다', () => {
      const result: AutoplanResult = {
        reviews: [{
          lens: 'design',
          verdict: 'reject',
          feedback: 'UX unclear',
          tasteDecisions: ['Simplify navigation'],
          durationMs: 500,
        }],
        synthesizedFeedback: 'Design rejection requires human decision.',
        requiresHumanDecision: true,
        tasteDecisions: ['Simplify navigation'],
        totalDurationMs: 500,
      };

      const output = formatAutoplanAppendix(result);
      expect(output).toContain('reject');
    });
  });
});
