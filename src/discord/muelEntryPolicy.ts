import type { AgentSession } from '../services/multiAgentService';
import type { TaskRoute } from '../services/taskRoutingService';

export type MuelEntryIntent = 'clarify' | 'docs' | 'session';

export type MuelEntryIntentPatterns = {
  codingIntentPattern: RegExp;
  automationIntentPattern: RegExp;
};

const QUICK_INTENT_PATTERN = /^(안녕|하이|ㅎㅇ|반가|뭐해|뭐하고|오늘.*날씨|날씨.*어때|지금.*몇시|몇 시|시간.*알려|오늘.*뭐|봇.*살아|살아.*있어|테스트|ping|hello|hi\b)/i;
const LOW_SIGNAL_PROMPT_PATTERN = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_-]{1,8}$/;
const LOW_SIGNAL_ASCII_TOKEN_PATTERN = /^[0-9A-Za-z_-]{1,4}$/;
const LOW_SIGNAL_SYMBOL_ONLY_PATTERN = /^[\p{P}\p{S}\s]+$/u;
const HIGH_DELIBERATION_VIBE_PATTERN = /(구현|만들|작성|수정|적용|배포|설정|연동|실행|자동화|고쳐|리팩터|코드|incident|장애|사고|회고|재발|검토|리스크|위험|plan|계획|로드맵|단계|webhook|api|build|implement|create|fix|patch|deploy|configure|integrat|automate|audit|security|보안)/i;

export const UTILITY_TASK_HINT_PATTERN = /(찾아|검색|분석|요약|정리|작성|만들|추천|조회|계획|실행|해줘|해 줘|please|search|find|analyze|summarize|build|create|plan|check)/i;

const isRepeatedNoisePrompt = (text: string): boolean => {
  const compact = String(text || '').replace(/\s+/g, '');
  if (compact.length < 3) {
    return false;
  }
  return new Set(Array.from(compact)).size === 1;
};

export const isQuickConversation = (text: string): boolean => {
  const normalized = String(text || '').trim();
  return QUICK_INTENT_PATTERN.test(normalized)
    || (normalized.length <= 30 && /[?!？！]$/.test(normalized) && !/스프린트|분석|구현|만들|작성|검색|정리|요약/.test(normalized));
};

export const shouldRouteMuelToSession = (
  request: string,
  patterns: MuelEntryIntentPatterns,
): boolean => {
  const normalized = String(request || '').trim();
  return patterns.codingIntentPattern.test(normalized) || patterns.automationIntentPattern.test(normalized);
};

export const isLowSignalPrompt = (
  text: string,
  patterns: MuelEntryIntentPatterns,
): boolean => {
  const normalized = String(text || '').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!normalized || normalized.length > 8 || /\s/.test(normalized)) {
    if (!normalized) {
      return false;
    }
  } else if (LOW_SIGNAL_PROMPT_PATTERN.test(normalized)) {
    return true;
  }

  if (
    QUICK_INTENT_PATTERN.test(normalized)
    || UTILITY_TASK_HINT_PATTERN.test(normalized)
    || patterns.codingIntentPattern.test(normalized)
    || patterns.automationIntentPattern.test(normalized)
  ) {
    return false;
  }

  if (LOW_SIGNAL_SYMBOL_ONLY_PATTERN.test(normalized) || isRepeatedNoisePrompt(normalized)) {
    return true;
  }

  return tokens.length > 0
    && tokens.length <= 3
    && tokens.every((token) => LOW_SIGNAL_ASCII_TOKEN_PATTERN.test(token))
    && tokens.join('').length <= 12;
};

export const resolveMuelEntryIntent = (
  request: string,
  patterns: MuelEntryIntentPatterns,
): MuelEntryIntent => {
  const normalized = String(request || '').trim();
  if (!normalized || isLowSignalPrompt(normalized, patterns)) {
    return 'clarify';
  }
  if (shouldRouteMuelToSession(normalized, patterns)) {
    return 'session';
  }
  return 'docs';
};

export const resolveVibeSessionPriority = (params: {
  request: string;
  route: TaskRoute;
  reasons: string[];
}): AgentSession['priority'] => {
  if (params.route === 'knowledge' || params.route === 'casual') {
    return 'fast';
  }

  if (params.route === 'mixed') {
    const highDeliberation = params.reasons.includes('knowledge_and_execution_signals')
      || HIGH_DELIBERATION_VIBE_PATTERN.test(String(params.request || ''));
    return highDeliberation ? 'balanced' : 'fast';
  }

  return 'balanced';
};