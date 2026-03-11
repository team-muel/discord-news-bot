import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';

export const executeOpsPlanSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const output = await runSkillText({
    context,
    systemLines: [
      '너는 디스코드 서버 운영 계획가다.',
      '불필요한 설명 없이 실행 가능한 최종 계획안만 작성한다.',
    ],
    rules: [
      '결과물 형식: 목표/우선순위/실행계획(1~5)/리스크완화/완료기준',
      '각 항목은 짧고 실행 가능한 문장으로 작성',
    ],
    temperature: 0.2,
    maxTokens: 1000,
  });

  return { skillId: 'ops-plan', output };
};
