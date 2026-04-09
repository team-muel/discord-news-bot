import { describe, it, expect } from 'vitest';
import {
  loadSkillPrompt,
  buildPhaseSystemPrompt,
  listAvailableSkills,
  getPhaseActionName,
  getPhaseLeadAgent,
  loadSkillReference,
  FAST_PATH_PHASE_INFO,
} from './skillPromptLoader';

describe('skillPromptLoader', () => {
  describe('getPhaseActionName', () => {
    it('plan → opendev.plan', () => {
      expect(getPhaseActionName('plan')).toBe('architect.plan');
    });

    it('implement → implement.execute', () => {
      expect(getPhaseActionName('implement')).toBe('implement.execute');
    });

    it('review → nemoclaw.review', () => {
      expect(getPhaseActionName('review')).toBe('review.review');
    });

    it('qa → qa.test', () => {
      expect(getPhaseActionName('qa')).toBe('qa.test');
    });

    it('ship → release.ship', () => {
      expect(getPhaseActionName('ship')).toBe('release.ship');
    });

    it('retro → retro.summarize', () => {
      expect(getPhaseActionName('retro')).toBe('retro.summarize');
    });

    it('알 수 없는 스킬은 빈 문자열을 반환한다', () => {
      expect(getPhaseActionName('nonexistent')).toBe('');
    });
  });

  describe('getPhaseLeadAgent', () => {
    it('plan → OpenDev', () => {
      expect(getPhaseLeadAgent('plan')).toBe('Architect');
    });

    it('implement → OpenCode', () => {
      expect(getPhaseLeadAgent('implement')).toBe('Implement');
    });

    it('review → NemoClaw', () => {
      expect(getPhaseLeadAgent('review')).toBe('Review');
    });

    it('ops-validate → OpenJarvis', () => {
      expect(getPhaseLeadAgent('ops-validate')).toBe('Operate');
    });
  });

  describe('FAST_PATH_PHASE_INFO', () => {
    it('qa, ops-validate, ship 정보를 포함한다', () => {
      expect(FAST_PATH_PHASE_INFO).toHaveProperty('qa');
      expect(FAST_PATH_PHASE_INFO).toHaveProperty('ops-validate');
      expect(FAST_PATH_PHASE_INFO).toHaveProperty('ship');
      expect(FAST_PATH_PHASE_INFO.qa.tool).toBeTruthy();
      expect(FAST_PATH_PHASE_INFO['ops-validate'].tool).toBeTruthy();
      expect(FAST_PATH_PHASE_INFO.ship.tool).toBeTruthy();
    });
  });

  describe('listAvailableSkills', () => {
    it('8개 스킬 디렉토리를 반환한다', () => {
      const skills = listAvailableSkills();
      expect(skills.length).toBeGreaterThanOrEqual(8);
      expect(skills).toContain('plan');
      expect(skills).toContain('implement');
      expect(skills).toContain('review');
      expect(skills).toContain('qa');
      expect(skills).toContain('ship');
      expect(skills).toContain('retro');
    });
  });

  describe('loadSkillPrompt', () => {
    it('plan SKILL.md를 파싱한다', () => {
      const def = loadSkillPrompt('plan');
      expect(def).not.toBeNull();
      if (def) {
        expect(def.skillName).toBe('plan');
        expect(def.rawContent.length).toBeGreaterThan(0);
      }
    });

    it('HITL Act/Ask 규칙을 파싱한다', () => {
      const def = loadSkillPrompt('implement');
      expect(def).not.toBeNull();
      if (def) {
        expect(def.hitlAct.length).toBeGreaterThan(0);
        expect(def.hitlAsk.length).toBeGreaterThan(0);
      }
    });

    it('references 파일 목록을 발견한다', () => {
      const def = loadSkillPrompt('implement');
      expect(def).not.toBeNull();
      if (def) {
        expect(def.referenceFiles.length).toBeGreaterThan(0);
        expect(def.referenceFiles).toContain('backward-compat-checklist.md');
      }
    });

    it('존재하지 않는 스킬은 null을 반환한다', () => {
      const def = loadSkillPrompt('nonexistent-skill');
      expect(def).toBeNull();
    });
  });

  describe('loadSkillReference', () => {
    it('implement의 reference 파일을 로드한다', () => {
      const content = loadSkillReference('implement', 'backward-compat-checklist.md');
      expect(content).not.toBeNull();
      expect(content).toContain('Backward Compatibility');
    });

    it('존재하지 않는 reference 파일은 null을 반환한다', () => {
      expect(loadSkillReference('implement', 'nonexistent.md')).toBeNull();
    });

    it('잘못된 파일명은 거부한다', () => {
      expect(loadSkillReference('implement', '../../../etc/passwd')).toBeNull();
    });
  });

  describe('buildPhaseSystemPrompt', () => {
    it('plan 시스템 프롬프트를 생성한다', () => {
      const prompt = buildPhaseSystemPrompt('plan');
      expect(prompt).not.toBeNull();
      if (prompt) {
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(0);
      }
    });

    it('HITL 규칙이 프롬프트에 포함된다', () => {
      const prompt = buildPhaseSystemPrompt('implement');
      expect(prompt).not.toBeNull();
      if (prompt) {
        expect(prompt).toContain('HITL Decision');
        expect(prompt).toContain('Proceed without asking');
        expect(prompt).toContain('MUST confirm before proceeding');
      }
    });

    it('존재하지 않는 스킬은 null을 반환한다', () => {
      expect(buildPhaseSystemPrompt('nonexistent')).toBeNull();
    });
  });
});
