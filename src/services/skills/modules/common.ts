import { generateText } from '../../llmClient';
import type { SkillContext } from '../types';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const buildMemoryBlock = (memoryHints?: string[]) => {
  const hints = (memoryHints || []).slice(0, 8);
  if (hints.length === 0) {
    return '기억 힌트: 없음';
  }
  return `기억 힌트:\n${hints.map((line, idx) => `${idx + 1}. ${compact(line)}`).join('\n')}`;
};

export const buildSkillPrompt = (context: SkillContext, rules: string[]) => {
  return [
    `길드: ${context.guildId}`,
    `요청자: ${context.requestedBy}`,
    `목표: ${compact(context.goal)}`,
    context.priorOutput ? `이전 출력:\n${context.priorOutput}` : '이전 출력: 없음',
    buildMemoryBlock(context.memoryHints),
    '출력 정책:',
    '중간 추론/체크리스트/작업과정 설명 금지',
    '최종 결과물만 한국어로 제시',
    ...rules,
  ].join('\n\n');
};

export const runSkillText = async (params: {
  context: SkillContext;
  systemLines: string[];
  rules: string[];
  actionName?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}) => {
  const contextOverrides = params.context.generationOptions || {};
  return generateText({
    system: params.systemLines.join('\n'),
    user: buildSkillPrompt(params.context, params.rules),
    actionName: params.actionName || params.context.actionName,
    temperature: contextOverrides.temperature ?? params.temperature ?? 0.2,
    maxTokens: contextOverrides.maxTokens ?? params.maxTokens ?? 1000,
    topP: contextOverrides.topP ?? params.topP,
  });
};
