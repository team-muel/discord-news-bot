import { getAgentPrivacyPolicySnapshot } from '../../agentPrivacyPolicyService';
import type { AgentDeliberationMode, AgentIntent, AgentPolicyGateDecision } from '../../agentRuntimeTypes';
import { generateText } from '../../llmClient';
import { parseLlmStructuredRecord } from '../../llmStructuredParseService';
import { compilePromptGoal, type PromptCompileResult } from '../../promptCompiler';

export type PolicyGateResult = {
  mode: AgentDeliberationMode;
  score: number;
  decision: AgentPolicyGateDecision;
  reasons: string[];
};

export const runCompilePromptNode = (goal: string): PromptCompileResult => {
  return compilePromptGoal(goal);
};

const parseIntentFromLlm = (raw: string): AgentIntent | null => {
  const parsed = parseLlmStructuredRecord(raw);
  if (!parsed) {
    return null;
  }

  const intent = String(parsed.intent || '').trim().toLowerCase();
  if (intent === 'task') {
    return 'task';
  }
  if (intent === 'casual_chat') {
    return 'casual_chat';
  }
  if (intent === 'uncertain') {
    return 'uncertain';
  }

  return null;
};

export const runRouteIntentNode = async (params: {
  goal: string;
  requestedSkillId: string | null;
  intentHints: string[];
}): Promise<AgentIntent> => {
  const { goal, requestedSkillId, intentHints } = params;
  if (requestedSkillId) {
    return 'task';
  }

  const text = String(goal || '').trim();
  if (!text) {
    return 'task';
  }

  const hintLines = intentHints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 4)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const raw = await generateText({
      system: [
        '너는 대화 의도 분류기다.',
        'task: 정보/방법 요청, 기술 설정·연동·구성, 작업 실행, 검색·분석·생성, "~하고 싶어(목적·기능)", "알려줘야", "어떻게", "방법" 등 무언가를 얻거나 이루려는 모든 발화.',
        'casual_chat: 순수 감정 토로(우울해, 힘들어), 단순 인사, 목적 없는 잡담. 기술/작업 맥락이 조금이라도 있으면 task.',
        'uncertain: 문장이 짧거나 모호해서 task/casual_chat 판별 신뢰가 낮은 경우. 정책/권한/관리 이슈가 섞였지만 목표가 불명확한 경우도 uncertain.',
        '출력은 반드시 JSON 한 줄만 사용한다.',
      ].join('\n'),
      user: [
        '참고 메모리 힌트(길드 정책/맥락):',
        hintBlock,
        `문장: ${text}`,
        '출력 형식: {"intent":"task|casual_chat|uncertain"}',
      ].join('\n'),
      actionName: 'intent.route',
      temperature: 0,
      maxTokens: 40,
    });

    return parseIntentFromLlm(raw) || 'uncertain';
  } catch {
    return 'uncertain';
  }
};

export const runPolicyGateNode = (params: {
  goal: string;
  guildId: string;
}): PolicyGateResult => {
  const text = String(params.goal || '').trim();
  const policy = getAgentPrivacyPolicySnapshot(params.guildId);
  let score = policy.modeDefault === 'guarded' ? 55 : 10;
  const reasons: string[] = policy.modeDefault === 'guarded' ? ['privacy_guarded_default'] : [];

  for (const rule of policy.reviewRules) {
    if (rule.re.test(text)) {
      score += rule.score;
      reasons.push(rule.reason);
    }
  }

  for (const rule of policy.blockRules) {
    if (rule.re.test(text)) {
      score += rule.score;
      reasons.push(rule.reason);
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (score >= policy.blockScore) {
    return { mode: 'guarded', score, decision: 'block', reasons: reasons.length > 0 ? reasons : ['privacy_block_threshold'] };
  }
  if (score >= policy.reviewScore) {
    return { mode: 'guarded', score, decision: 'review', reasons: reasons.length > 0 ? reasons : ['privacy_review_threshold'] };
  }
  if (score >= 45) {
    return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'deliberate', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_moderate'] };
  }
  if (score >= 25) {
    return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'plan_act', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_low'] };
  }
  return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'direct', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_minimal'] };
};
