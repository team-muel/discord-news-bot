export type TaskRoute = 'knowledge' | 'execution' | 'mixed' | 'casual';

export type TaskRouteDecision = {
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed?: boolean;
};

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const KNOWLEDGE_PATTERN = /(무엇|정의|설명|원인|비교|차이|왜|근거|문서|스키마|정책|알려줘|요약|정리|what|why|explain|summary|schema|policy|docs?)/i;
const EXECUTION_PATTERN = /(구현|만들|작성|수정|적용|배포|설정|연동|실행|자동화|고쳐|리팩터|코드|build|implement|create|fix|patch|deploy|configure|integrat|automate)/i;
const CASUAL_PATTERN = /(안녕|고마워|감사|힘들|우울|심심|잡담|hello|hi|thanks|thank you)/i;
const LEARNING_RULE_CACHE_TTL_MS = Math.max(5_000, Number(process.env.TASK_ROUTING_LEARNING_RULE_CACHE_TTL_MS || 60_000));
const LEARNING_RULE_MIN_CONFIDENCE = Math.max(0, Math.min(1, Number(process.env.TASK_ROUTING_LEARNING_RULE_MIN_CONFIDENCE || 0.65)));

type LearningRoutingRule = {
  guildId: string;
  signalKey: string;
  signalPattern: string;
  recommendedRoute: TaskRoute;
  confidence: number;
  supportCount: number;
};

const learningRuleCache = new Map<string, { expiresAt: number; rules: LearningRoutingRule[] }>();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const OVERRIDE_PATTERN = /^\s*\[(?:route|라우트)\s*:\s*(knowledge|execution|mixed|casual)\]\s*/i;

const parseRouteOverride = (input: string): { route: TaskRoute | null; strippedInput: string } => {
  const text = String(input || '');
  const match = text.match(OVERRIDE_PATTERN);
  if (!match) {
    return { route: null, strippedInput: text.trim() };
  }

  const route = String(match[1] || '').trim().toLowerCase() as TaskRoute;
  const strippedInput = text.replace(OVERRIDE_PATTERN, '').trim();
  return { route, strippedInput };
};

const toTaskRoute = (value: unknown): TaskRoute | null => {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'knowledge' || text === 'execution' || text === 'mixed' || text === 'casual') {
    return text;
  }
  return null;
};

const clampSupportCount = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.trunc(n));
};

const normalizeLearningRule = (row: Record<string, unknown>): LearningRoutingRule | null => {
  const recommendedRoute = toTaskRoute(row.recommended_route);
  const signalPattern = String(row.signal_pattern || '').trim();
  if (!recommendedRoute || !signalPattern) {
    return null;
  }
  return {
    guildId: String(row.guild_id || '').trim(),
    signalKey: String(row.signal_key || '').trim(),
    signalPattern,
    recommendedRoute,
    confidence: clamp01(Number(row.confidence || 0)),
    supportCount: clampSupportCount(row.support_count),
  };
};

const getLearningRulesForGuild = async (guildId: string): Promise<LearningRoutingRule[]> => {
  const normalizedGuildId = String(guildId || '').trim();
  if (!normalizedGuildId || !isSupabaseConfigured()) {
    return [];
  }

  const cached = learningRuleCache.get(normalizedGuildId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.rules;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_tool_learning_rules')
    .select('guild_id, signal_key, signal_pattern, recommended_route, confidence, support_count, status, updated_at')
    .or(`guild_id.eq.${normalizedGuildId},guild_id.eq.*`)
    .eq('scope', 'task_routing')
    .eq('status', 'active')
    .order('confidence', { ascending: false })
    .order('support_count', { ascending: false })
    .limit(300);

  if (error) {
    return [];
  }

  const rules = ((data || []) as Array<Record<string, unknown>>)
    .map((row) => normalizeLearningRule(row))
    .filter((row): row is LearningRoutingRule => Boolean(row));

  learningRuleCache.set(normalizedGuildId, {
    expiresAt: now + LEARNING_RULE_CACHE_TTL_MS,
    rules,
  });
  return rules;
};

const selectLearningRuleMatch = (text: string, rules: LearningRoutingRule[]): LearningRoutingRule | null => {
  const source = String(text || '').trim();
  if (!source || rules.length === 0) {
    return null;
  }

  let best: { rule: LearningRoutingRule; score: number } | null = null;
  for (const rule of rules) {
    if (rule.confidence < LEARNING_RULE_MIN_CONFIDENCE) {
      continue;
    }

    let matched = false;
    try {
      matched = new RegExp(rule.signalPattern, 'i').test(source);
    } catch {
      matched = false;
    }
    if (!matched) {
      continue;
    }

    const supportBoost = Math.min(0.15, rule.supportCount / 200);
    const score = rule.confidence + supportBoost;
    if (!best || score > best.score) {
      best = { rule, score };
    }
  }

  return best?.rule || null;
};

const detectTaskRouteBase = (input: string): TaskRouteDecision => {
  const { route: overrideRoute, strippedInput } = parseRouteOverride(input);
  const text = strippedInput;
  if (overrideRoute) {
    return {
      route: overrideRoute,
      confidence: 1,
      reasons: ['explicit_route_override'],
      overrideUsed: true,
    };
  }
  if (!text) {
    return {
      route: 'knowledge',
      confidence: 0.45,
      reasons: ['empty_input_fallback'],
    };
  }

  if (CASUAL_PATTERN.test(text) && !EXECUTION_PATTERN.test(text) && !KNOWLEDGE_PATTERN.test(text)) {
    return {
      route: 'casual',
      confidence: 0.78,
      reasons: ['casual_signal'],
    };
  }

  const hasKnowledge = KNOWLEDGE_PATTERN.test(text);
  const hasExecution = EXECUTION_PATTERN.test(text);

  if (hasKnowledge && hasExecution) {
    return {
      route: 'mixed',
      confidence: 0.8,
      reasons: ['knowledge_and_execution_signals'],
    };
  }

  if (hasExecution) {
    return {
      route: 'execution',
      confidence: 0.82,
      reasons: ['execution_signal'],
    };
  }

  if (hasKnowledge) {
    return {
      route: 'knowledge',
      confidence: 0.8,
      reasons: ['knowledge_signal'],
    };
  }

  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const fallbackConfidence = clamp01(0.52 + Math.min(0.18, tokenCount * 0.01));
  return {
    route: 'mixed',
    confidence: fallbackConfidence,
    reasons: ['default_mixed_fallback'],
  };
};

export const detectTaskRoute = (input: string): TaskRouteDecision => {
  return detectTaskRouteBase(input);
};

export const detectTaskRouteForGuild = async (input: string, guildId?: string): Promise<TaskRouteDecision> => {
  const base = detectTaskRouteBase(input);
  if (base.overrideUsed || !guildId) {
    return base;
  }

  const { strippedInput } = parseRouteOverride(input);
  const rules = await getLearningRulesForGuild(guildId);
  const matchedRule = selectLearningRuleMatch(strippedInput, rules);
  if (!matchedRule) {
    return base;
  }

  return {
    route: matchedRule.recommendedRoute,
    confidence: Math.max(base.confidence, matchedRule.confidence),
    reasons: [...base.reasons, `learning_rule_match:${matchedRule.signalKey || matchedRule.signalPattern}`],
    overrideUsed: Boolean(base.overrideUsed),
  };
};

export const buildRagQueryPlan = (input: string): {
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed: boolean;
  maxDocs: number;
  contextMode: 'full' | 'metadata_first';
} => {
  const decision = detectTaskRoute(input);
  if (decision.route === 'execution') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      maxDocs: 6,
      contextMode: 'metadata_first',
    };
  }

  if (decision.route === 'mixed') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      maxDocs: 8,
      contextMode: 'full',
    };
  }

  return {
    route: decision.route,
    confidence: decision.confidence,
    reasons: [...decision.reasons],
    overrideUsed: Boolean(decision.overrideUsed),
    maxDocs: 10,
    contextMode: 'metadata_first',
  };
};

export const buildRagQueryPlanForGuild = async (input: string, guildId?: string): Promise<{
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed: boolean;
  maxDocs: number;
  contextMode: 'full' | 'metadata_first';
}> => {
  const decision = await detectTaskRouteForGuild(input, guildId);
  if (decision.route === 'execution') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      maxDocs: 6,
      contextMode: 'metadata_first',
    };
  }

  if (decision.route === 'mixed') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      maxDocs: 8,
      contextMode: 'full',
    };
  }

  return {
    route: decision.route,
    confidence: decision.confidence,
    reasons: [...decision.reasons],
    overrideUsed: Boolean(decision.overrideUsed),
    maxDocs: 10,
    contextMode: 'metadata_first',
  };
};

export const buildReasoningGoal = (input: string): {
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed: boolean;
  goal: string;
} => {
  const decision = detectTaskRoute(input);
  const { strippedInput } = parseRouteOverride(input);
  const base = strippedInput;

  if (decision.route === 'knowledge') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      goal: [
        '[ROUTE:knowledge]',
        '문서/근거 우선으로 답변하고, 근거가 없으면 없다고 명시하세요.',
        base,
      ].join('\n'),
    };
  }

  if (decision.route === 'mixed') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      goal: [
        '[ROUTE:mixed]',
        '1) 근거 요약 2) 실행안(체크리스트) 순서로 응답하세요.',
        base,
      ].join('\n'),
    };
  }

  return {
    route: decision.route,
    confidence: decision.confidence,
    reasons: [...decision.reasons],
    overrideUsed: Boolean(decision.overrideUsed),
    goal: [
      '[ROUTE:execution]',
      '실행 가능한 단계와 검증 기준 중심으로 응답하세요.',
      base,
    ].join('\n'),
  };
};

export const buildReasoningGoalForGuild = async (input: string, guildId?: string): Promise<{
  route: TaskRoute;
  confidence: number;
  reasons: string[];
  overrideUsed: boolean;
  goal: string;
}> => {
  const decision = await detectTaskRouteForGuild(input, guildId);
  const { strippedInput } = parseRouteOverride(input);
  const base = strippedInput;

  if (decision.route === 'knowledge') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      goal: [
        '[ROUTE:knowledge]',
        '문서/근거 우선으로 답변하고, 근거가 없으면 없다고 명시하세요.',
        base,
      ].join('\n'),
    };
  }

  if (decision.route === 'mixed') {
    return {
      route: decision.route,
      confidence: decision.confidence,
      reasons: [...decision.reasons],
      overrideUsed: Boolean(decision.overrideUsed),
      goal: [
        '[ROUTE:mixed]',
        '1) 근거 요약 2) 실행안(체크리스트) 순서로 응답하세요.',
        base,
      ].join('\n'),
    };
  }

  return {
    route: decision.route,
    confidence: decision.confidence,
    reasons: [...decision.reasons],
    overrideUsed: Boolean(decision.overrideUsed),
    goal: [
      '[ROUTE:execution]',
      '실행 가능한 단계와 검증 기준 중심으로 응답하세요.',
      base,
    ].join('\n'),
  };
};
