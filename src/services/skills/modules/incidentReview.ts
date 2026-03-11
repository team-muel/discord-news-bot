import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';

export const executeIncidentReviewSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const output = await runSkillText({
    context,
    systemLines: [
      '너는 운영 장애/오답 회고 담당자다.',
      '재발 방지에 필요한 최종 회고 결과물만 작성한다.',
    ],
    rules: [
      '결과물 형식: 사건요약/원인가설/재발방지 규칙/내일 액션',
      '장황한 배경 설명 금지',
    ],
    temperature: 0.15,
    maxTokens: 1000,
  });

  return { skillId: 'incident-review', output };
};
