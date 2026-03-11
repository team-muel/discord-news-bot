import type { SkillContext, SkillExecutionResult } from '../types';
import { runSkillText } from './common';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeGoal = (goal: string): string => {
  const text = compact(goal);
  return text.length > 0 ? text : '웹훅 수신/처리 자동화 기본 설계를 제안해주세요.';
};

const inferWebhookProvider = (goal: string): string => {
  const lower = goal.toLowerCase();
  if (/(github|깃허브)/.test(lower)) return 'github';
  if (/(stripe|스트라이프)/.test(lower)) return 'stripe';
  if (/(slack|슬랙)/.test(lower)) return 'slack';
  if (/(discord|디스코드)/.test(lower)) return 'discord';
  return 'generic';
};

const buildWebhookPrompt = (context: SkillContext): string => {
  const goal = normalizeGoal(context.goal);
  const provider = inferWebhookProvider(goal);
  const memoryHints = (context.memoryHints || []).slice(0, 8);
  const memoryBlock = memoryHints.length > 0
    ? memoryHints.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
    : '없음';

  return [
    `길드: ${context.guildId}`,
    `요청자: ${context.requestedBy}`,
    `목표: ${goal}`,
    `추정 공급자: ${provider}`,
    context.priorOutput ? `이전 출력:\n${context.priorOutput}` : '이전 출력: 없음',
    `기억 힌트:\n${memoryBlock}`,
    '출력 규칙:',
    '1) Webhook Contract: endpoint, method, 이벤트 타입, 샘플 payload',
    '2) Security: 서명 검증(HMAC), timestamp replay 방지, IP/키 관리',
    '3) Reliability: 멱등성 키, 재시도/백오프, deadletter 처리',
    '4) Operations: 로그/메트릭/알람, 장애 대응 절차',
    '5) Implementation Snippet: 최소한의 서버 코드 예시(타입스크립트)',
  ].join('\n\n');
};

export const executeWebhookSkill = async (context: SkillContext): Promise<SkillExecutionResult> => {
  const output = await runSkillText({
    context: {
      ...context,
      goal: buildWebhookPrompt(context),
    },
    systemLines: [
      '너는 웹훅 통합 운영 전문가다.',
      '보안과 운영 안정성을 최우선으로 두고, 바로 적용 가능한 결과만 제공한다.',
      '모든 답변은 한국어로 작성한다.',
    ],
    rules: [
      '결과물 형식: 계약/보안/신뢰성/운영/구현스니펫',
      '중간 과정 설명 금지',
    ],
    temperature: 0.2,
    maxTokens: 1300,
  });

  return {
    skillId: 'webhook',
    output,
  };
};
