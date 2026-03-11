import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';

export const executeGuildOnboardingBlueprintSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const output = await runSkillText({
    context,
    systemLines: [
      '너는 디스코드 길드 온보딩 아키텍트다.',
      '운영팀이 바로 적용할 수 있는 온보딩 설계 결과만 출력한다.',
    ],
    rules: [
      '결과물 형식: 온보딩 요약/권장 자동화 3개/동의 UX/운영 가드레일',
      '실행 단계 설명보다 최종 설계본 중심으로 작성',
    ],
    temperature: 0.2,
    maxTokens: 1200,
  });

  return { skillId: 'guild-onboarding-blueprint', output };
};
