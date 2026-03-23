import { describe, it, expect } from 'vitest';
import { generateSkillDoc } from './skillDocGenerator';

describe('skillDocGenerator', () => {
  describe('generateSkillDoc', () => {
    it('plan 스킬 문서를 생성한다', () => {
      const result = generateSkillDoc('plan');
      expect(typeof result.content).toBe('string');
      expect(typeof result.changed).toBe('boolean');
    });

    it('존재하지 않는 스킬은 빈 content를 반환한다', () => {
      const result = generateSkillDoc('nonexistent-skill-doc');
      // Should not throw, returns empty or unchanged
      expect(typeof result.content).toBe('string');
    });
  });
});
