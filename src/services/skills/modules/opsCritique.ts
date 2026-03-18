import type { SkillExecutionResult, SkillContext } from '../types';
import { runSkillText } from './common';

export const executeOpsCritiqueSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const output = await runSkillText({
    context,
    actionName: 'skill.ops-critique',
    systemLines: [
      '너는 운영 품질/보안 검토 에이전트다.',
      '최종 리스크 평가 결과만 제공한다.',
    ],
    rules: [
      '결과물 형식: 위험등급/핵심리스크(최대3)/즉시보완안',
      '추론 과정 설명 금지',
    ],
    temperature: 0.15,
    maxTokens: 900,
  });

  return { skillId: 'ops-critique', output };
};
