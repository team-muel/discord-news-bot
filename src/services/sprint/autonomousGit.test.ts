import { describe, it, expect } from 'vitest';
import { buildSprintPrBody, checkGitConfigHealth } from './autonomousGit';

describe('autonomousGit', () => {
  describe('buildSprintPrBody', () => {
    it('마크다운 PR 본문을 생성한다', () => {
      const body = buildSprintPrBody({
        sprintId: 'test-sprint-id',
        objective: 'Fix critical bug',
        phaseResults: {
          plan: { phase: 'plan', status: 'success', output: 'Plan complete' },
          implement: { phase: 'implement', status: 'success', output: 'Code written' },
        },
        changedFiles: ['src/a.ts', 'src/b.ts'],
      });

      expect(typeof body).toBe('string');
      expect(body).toContain('test-sprint-id');
      expect(body).toContain('Fix critical bug');
      expect(body).toContain('src/a.ts');
      expect(body).toContain('src/b.ts');
    });

    it('빈 phaseResults도 처리한다', () => {
      const body = buildSprintPrBody({
        sprintId: 'empty-results',
        objective: 'Empty test',
        phaseResults: {},
        changedFiles: [],
      });

      expect(typeof body).toBe('string');
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('checkGitConfigHealth', () => {
    it('SPRINT_GIT_ENABLED=false 이면 configured=false를 반환한다', () => {
      // In test env SPRINT_GIT_ENABLED defaults to false
      const result = checkGitConfigHealth();
      expect(result.configured).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
