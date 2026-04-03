/**
 * Intent classification and casual chat generation for the multi-agent runtime.
 *
 * Extracted from multiAgentService.ts to isolate intent routing
 * and conversational response logic into a focused module.
 */
import { generateText } from '../llmClient';

export const buildPolicyBlockMessage = (reasons: string[]): string => {
  const joined = reasons.slice(0, 4).join(', ') || 'privacy_policy';
  return [
    '개인정보 보호 정책상 이 요청은 자동 실행할 수 없습니다.',
    '민감정보를 제거한 최소 목적 질문으로 다시 요청해주세요.',
    `정책 사유: ${joined}`,
  ].join(' ');
};

export const buildIntentClarificationFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (!text) {
    return '요청을 정확히 처리하려면 원하는 결과를 한 줄로 알려주세요. 예: "공지 채널 하나 만들어줘" 또는 "그냥 오늘 힘들었어"';
  }
  return '요청을 안전하게 처리하려고 확인이 필요해요. 지금 원하는 게 작업 실행인지, 그냥 대화/상담인지 한 줄로 알려주세요.';
};

export const generateIntentClarificationResult = async (goal: string, hints: string[]): Promise<string> => {
  const hintLines = hints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 3)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const output = await generateText({
      system: [
        '너는 디스코드 운영 봇의 안전 라우팅 어시스턴트다.',
        '목표가 모호할 때는 자동 실행을 시작하지 말고 확인 질문 1개만 한다.',
        '출력은 짧은 한국어 1~2문장으로 작성한다.',
      ].join('\n'),
      user: [
        '아래 사용자 발화는 의도가 모호하다.',
        `사용자 발화: ${String(goal || '').trim()}`,
        '참고 메모리 힌트:',
        hintBlock,
        '작업 실행 vs 일반 대화 중 무엇을 원하는지 확인하는 질문을 작성해라.',
      ].join('\n'),
      actionName: 'intent.clarify',
      temperature: 0.2,
      maxTokens: 120,
    });

    const text = String(output || '').trim();
    return text || buildIntentClarificationFallback(goal);
  } catch {
    return buildIntentClarificationFallback(goal);
  }
};

export const buildCasualChatFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (/우울|슬퍼|힘들|불안/.test(text)) {
    return '많이 지쳤던 것 같아요. 괜찮다면 오늘 특히 힘들었던 순간이 뭐였는지 한 가지만 말해줄래요?';
  }
  return '들려줘서 고마워요. 지금 마음이나 상황을 한두 문장만 더 말해주면, 거기에 맞춰 같이 이야기해볼게요.';
};

export const generateCasualChatResult = async (
  goal: string,
  recentTurns?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> => {
  try {
    const conversationContext = (recentTurns && recentTurns.length > 0)
      ? recentTurns.map((t) => `${t.role === 'user' ? '사용자' : '뮤엘'}: ${t.content}`).join('\n')
      : '';

    const userLines = [
      '사용자 발화에 대해 자연스럽게 답해라.',
      '출력은 일반 대화 문장만 작성한다.',
      '근거/검증/confidence 같은 섹션 제목을 쓰지 않는다.',
    ];
    if (conversationContext) {
      userLines.push('이전 대화 맥락:', conversationContext, '');
    }
    userLines.push(`사용자: ${String(goal || '').trim()}`);

    const output = await generateText({
      system: [
        '너는 공감형 한국어 대화 파트너다.',
        '도구 호출을 유도하거나 작업 실행으로 전환하지 않는다.',
        '과거 데이터베이스/장기기억(메모리, Obsidian)을 먼저 뒤지지 않는다.',
        '감정적 호소나 짧은 일상어에는 현재 맥락에 공감한 뒤 가벼운 질문 1개로 핑퐁을 유도한다.',
        '이전 대화가 주어지면 그 흐름을 이어받아 답한다.',
        '질문 예시 톤: 무슨 일 있었어?, 어떤 빵 먹었어?',
        '짧고 자연스럽게 공감하고, 필요하면 한 가지 되묻기만 한다.',
        '진단, 단정, 과도한 조언은 피한다.',
      ].join('\n'),
      user: userLines.join('\n'),
      actionName: 'chat.casual',
      temperature: 0.5,
      maxTokens: 220,
    });

    const text = String(output || '').trim();
    return text || buildCasualChatFallback(goal);
  } catch {
    return buildCasualChatFallback(goal);
  }
};
