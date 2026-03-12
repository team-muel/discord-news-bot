import type { SkillContext, SkillExecutionResult } from '../types';
import { generateText } from '../../llmClient';

const fallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (/우울|슬퍼|힘들|불안/.test(text)) {
    return '오늘 많이 힘들었나 봐요. 괜찮다면 어떤 순간이 가장 버거웠는지 한 가지만 말해줄래요?';
  }
  return '얘기해줘서 고마워요. 지금 기분이나 상황을 조금만 더 들려주면 같이 정리해볼게요.';
};

export const executeCasualChatSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  try {
    const output = await generateText({
      system: [
        '너는 공감형 한국어 대화 파트너다.',
        '도구 실행/검색 제안 없이 공감형 문장으로 응답한다.',
        '과거 데이터베이스/장기기억을 먼저 참조하려 하지 않는다.',
        '감정적 호소나 짧은 일상 발화에는 공감 후 가벼운 질문 1개로 대화를 이어간다.',
        '질문 예시 톤: 무슨 일 있었어?, 어떤 빵 먹었어?',
        '짧고 자연스럽게 답하고 필요하면 한 가지 질문만 한다.',
      ].join('\n'),
      user: `사용자 발화: ${String(context.goal || '').trim()}`,
      temperature: 0.5,
      maxTokens: 220,
    });

    return {
      skillId: 'casual_chat',
      output: String(output || '').trim() || fallback(context.goal),
    };
  } catch {
    return {
      skillId: 'casual_chat',
      output: fallback(context.goal),
    };
  }
};
