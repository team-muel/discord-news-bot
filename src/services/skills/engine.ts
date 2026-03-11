import { generateText } from '../llmClient';
import { getSkill } from './registry';
import type { SkillContext, SkillExecutionResult, SkillId } from './types';

const buildUserPrompt = (skillId: SkillId, context: SkillContext): string => {
  const memoryBlock = (context.memoryHints || []).filter(Boolean).slice(0, 8);
  const memoryText = memoryBlock.length > 0
    ? `참고 메모:\n${memoryBlock.map((line, i) => `${i + 1}. ${line}`).join('\n')}`
    : '참고 메모: 없음';

  return [
    `스킬: ${skillId}`,
    `길드: ${context.guildId}`,
    `요청자: ${context.requestedBy}`,
    `목표: ${context.goal}`,
    context.priorOutput ? `이전 단계 출력:\n${context.priorOutput}` : '이전 단계 출력: 없음',
    memoryText,
    '출력은 한국어로 작성하고, 과장 없이 실행 가능한 내용으로 제한하세요.',
  ].join('\n\n');
};

export const executeSkill = async (
  skillId: SkillId,
  context: SkillContext,
): Promise<SkillExecutionResult> => {
  const skill = getSkill(skillId);
  const output = await generateText({
    system: [
      skill.systemPrompt,
      `입력 가이드: ${skill.inputGuide}`,
      `출력 가이드: ${skill.outputGuide}`,
    ].join('\n'),
    user: buildUserPrompt(skillId, context),
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
  });

  return {
    skillId,
    output,
  };
};
