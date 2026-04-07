import { getAgentPrivacyPolicySnapshot } from '../../agent/agentPrivacyPolicyService';
import { toLegacyIntent, type AgentDeliberationMode, type AgentIntent, type AgentPolicyGateDecision, type IntentClassification, type IntentTaxonomy } from '../../agent/agentRuntimeTypes';
import { generateText } from '../../llmClient';
import { parseLlmStructuredRecord } from '../../llmStructuredParseService';
import { compilePromptGoal, type PromptCompileResult } from '../../infra/promptCompiler';
import type { IntentSignalBundle } from './intentSignalEnricher';
import { loadTopExemplars, type IntentExemplar } from './intentExemplarStore';

export type PolicyGateResult = {
  mode: AgentDeliberationMode;
  score: number;
  decision: AgentPolicyGateDecision;
  reasons: string[];
};

export const runCompilePromptNode = (goal: string): PromptCompileResult => {
  return compilePromptGoal(goal);
};

// ──── Taxonomy Constants ────────────────────────────────────────────────────

const VALID_TAXONOMIES = new Set<IntentTaxonomy>([
  'info_seek', 'action_execute', 'creative_generate', 'opinion_consult',
  'context_provide', 'confirm_deny', 'emotional', 'meta_control',
]);

const parseIntentTaxonomy = (raw: string): IntentTaxonomy | null => {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (VALID_TAXONOMIES.has(cleaned as IntentTaxonomy)) return cleaned as IntentTaxonomy;
  return null;
};

// ──── Legacy parser (kept for fallback) ─────────────────────────────────────

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

// ──── Stage 1: Rule-Based Fast-Path ─────────────────────────────────────────

const KOREAN_QUESTION_TASK_PATTERN =
  /(뭐야\??|뭘까\??|뭐지\??|뭐가|어때\??|어떨까\??|어떻게|알려줘|알려 줘|찾아줘|찾아 줘|검색해|추천해|설명해|분석해|요약해|정리해|비교해|차이가|무슨|언제|어디|누가|왜|얼마|몇|인가요|인가\??|인지|줄래\??|줄 수|해줘|해 줘|할 수|하나요|합니까|일까|일까요|건가요|인데|뭔데|할까|볼까|인건가|있어\??|있나\??|있나요|있을까|없어\??|없나\??|될까|되나요|됩니까)/;

const EMOTIONAL_PATTERN = /^(우울|슬퍼|힘들|불안|외로|지쳤|무서|답답|화나|짜증|그냥\s*힘들|오늘\s*힘들)/;
const META_CONTROL_PATTERN = /^(멈춰|취소|중지|stop|cancel|다시|리셋|reset|처음부터)/i;
const CONFIRM_DENY_PATTERN = /^(네|응|맞아|좋아|ㅇㅇ|ㅇㅋ|괜찮아|고마워|아니|싫어|ㄴㄴ|안 해|안해|말아|하지 ?마|그만)/;
const CREATIVE_GENERATE_PATTERN = /(만들어|작성해|생성해|써 ?줘|그려|디자인|초안|draft|generate|create|write)/i;
const ACTION_EXECUTE_PATTERN = /(실행해|배포해|deploy|삭제해|설정해|연결해|연동해|시작해|run|execute|trigger|설치해|업데이트해)/i;
const OPINION_CONSULT_PATTERN = /(어떻게\s*생각|의견|추천해|뭐가\s*나을|뭐가\s*좋|고르|선택|판단|조언|suggest|recommend|better)/i;

const classifyByRules = (text: string, signals: IntentSignalBundle | null): IntentClassification | null => {
  if (META_CONTROL_PATTERN.test(text)) {
    return {
      primary: 'meta_control',
      confidence: 0.95,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'rule:meta_control_pattern',
      source: 'rule',
    };
  }

  if (EMOTIONAL_PATTERN.test(text) && text.length < 30) {
    return {
      primary: 'emotional',
      confidence: 0.9,
      secondary: null,
      legacyIntent: 'casual_chat',
      latentNeeds: [],
      reasoning: 'rule:emotional_short_pattern',
      source: 'rule',
    };
  }

  if (CONFIRM_DENY_PATTERN.test(text) && text.length < 20) {
    // If there's conversation context, this is likely confirm/deny of prior turn
    const hasPriorTurn = signals && signals.turnPosition > 0;
    return {
      primary: 'confirm_deny',
      confidence: hasPriorTurn ? 0.85 : 0.6,
      secondary: hasPriorTurn ? null : 'emotional',
      legacyIntent: hasPriorTurn ? 'task' : 'casual_chat',
      latentNeeds: hasPriorTurn ? ['previous_turn_context_needed'] : [],
      reasoning: hasPriorTurn ? 'rule:confirm_deny_with_prior_turn' : 'rule:confirm_deny_ambiguous',
      source: 'rule',
    };
  }

  if (ACTION_EXECUTE_PATTERN.test(text)) {
    return {
      primary: 'action_execute',
      confidence: 0.85,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'rule:action_execute_pattern',
      source: 'rule',
    };
  }

  if (CREATIVE_GENERATE_PATTERN.test(text)) {
    return {
      primary: 'creative_generate',
      confidence: 0.8,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'rule:creative_generate_pattern',
      source: 'rule',
    };
  }

  if (OPINION_CONSULT_PATTERN.test(text)) {
    return {
      primary: 'opinion_consult',
      confidence: 0.75,
      secondary: 'info_seek',
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'rule:opinion_consult_pattern',
      source: 'rule',
    };
  }

  if (KOREAN_QUESTION_TASK_PATTERN.test(text)) {
    return {
      primary: 'info_seek',
      confidence: 0.8,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'rule:korean_question_task_pattern',
      source: 'rule',
    };
  }

  return null; // Pass to next stage
};

// ──── Stage 2: LLM Structured Classification ────────────────────────────────

const parseLlmClassification = (raw: string): Partial<IntentClassification> | null => {
  const parsed = parseLlmStructuredRecord(raw);
  if (!parsed) return null;

  const primary = parseIntentTaxonomy(String(parsed.primary || parsed.intent || ''));
  if (!primary) return null;

  const confidence = Number(parsed.confidence);
  const secondary = parseIntentTaxonomy(String(parsed.secondary || ''));
  const latentNeeds = Array.isArray(parsed.latentNeeds)
    ? parsed.latentNeeds.map((n: unknown) => String(n || '').trim()).filter(Boolean).slice(0, 5)
    : [];
  const reasoning = String(parsed.reasoning || '').slice(0, 200);

  return {
    primary,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    secondary: secondary !== primary ? secondary : null,
    latentNeeds,
    reasoning,
  };
};

const INTENT_TAXONOMY_LABELS = [
  'info_seek(정보 탐색)', 'action_execute(작업 실행)', 'creative_generate(생성/작성)',
  'opinion_consult(의견/추천)', 'context_provide(맥락 제공)', 'confirm_deny(승인/거절)',
  'emotional(감정 표현)', 'meta_control(시스템 제어)',
].join(', ');

const classifyByLlm = async (
  text: string,
  signals: IntentSignalBundle | null,
  intentHints: string[],
): Promise<IntentClassification> => {
  const hintLines = intentHints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 4)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0 ? hintLines.join('\n') : '- 없음';

  // Build enriched context from signals
  const contextParts: string[] = [];
  if (signals) {
    if (signals.compiledPrompt.intentTags.length > 0) {
      contextParts.push(`prompt_tags: ${signals.compiledPrompt.intentTags.join(', ')}`);
    }
    if (signals.graphClusterHint) {
      contextParts.push(`graph_cluster: ${signals.graphClusterHint}`);
    }
    if (signals.graphNeighborTags.length > 0) {
      contextParts.push(`graph_tags: ${signals.graphNeighborTags.slice(0, 5).join(', ')}`);
    }
    if (signals.turnPosition > 0) {
      contextParts.push(`turn_position: ${signals.turnPosition}`);
      const lastAssistant = signals.recentTurns.filter((t) => t.role === 'assistant').pop();
      if (lastAssistant) {
        contextParts.push(`prev_assistant: ${lastAssistant.content.slice(0, 100)}`);
      }
    }
    if (signals.guildDominantIntent) {
      contextParts.push(`guild_dominant: ${signals.guildDominantIntent}`);
    }
  }
  const contextBlock = contextParts.length > 0 ? contextParts.join('\n') : '없음';

  try {
    const raw = await generateText({
      system: [
        '너는 대화 의도 분류기다. 8개 택소노미 중 하나를 선택한다.',
        `택소노미: ${INTENT_TAXONOMY_LABELS}`,
        'info_seek: 정보/방법 질문, 기술 설정/연동/구성 질문.',
        'action_execute: 실행/배포/삭제/설정 등 부수효과가 있는 작업 요청.',
        'creative_generate: 코드/문서/디자인 등 새로운 산출물 생성 요청.',
        'opinion_consult: 의견/추천/비교 등 판단을 구하는 요청.',
        'context_provide: 이전 질문에 대한 추가 설명/맥락 제공.',
        'confirm_deny: 이전 제안에 대한 동의/거절.',
        'emotional: 순수 감정 토로, 목적 없는 잡담. 기술 맥락이 조금이라도 있으면 다른 분류.',
        'meta_control: 대화/시스템 제어(멈춰, 취소, 다시).',
        'confidence: 0-1 사이의 분류 확신도.',
        'latentNeeds: 표면에 드러나지 않았지만 추론되는 숨은 요구사항(최대 3개).',
        '출력은 반드시 JSON 한 줄만 사용한다.',
      ].join('\n'),
      user: [
        '메모리 힌트:',
        hintBlock,
        '신호 컨텍스트:',
        contextBlock,
        `발화: ${text}`,
        '출력: {"primary":"...","confidence":0.0,"secondary":"..."|null,"latentNeeds":["..."],"reasoning":"..."}',
      ].join('\n'),
      actionName: 'intent.route',
      temperature: 0,
      maxTokens: 150,
    });

    const llmResult = parseLlmClassification(raw);
    if (llmResult && llmResult.primary) {
      return {
        primary: llmResult.primary,
        confidence: llmResult.confidence ?? 0.5,
        secondary: llmResult.secondary ?? null,
        legacyIntent: toLegacyIntent(llmResult.primary),
        latentNeeds: llmResult.latentNeeds ?? [],
        reasoning: llmResult.reasoning || 'llm_classification',
        source: 'llm',
      };
    }

    // Fallback: try legacy parser for LLMs that output old format
    const legacyResult = parseIntentFromLlm(raw);
    if (legacyResult) {
      const taxonomyMap: Record<AgentIntent, IntentTaxonomy> = {
        task: 'info_seek',
        casual_chat: 'emotional',
        uncertain: 'info_seek',
      };
      return {
        primary: taxonomyMap[legacyResult],
        confidence: legacyResult === 'uncertain' ? 0.3 : 0.5,
        secondary: null,
        legacyIntent: legacyResult,
        latentNeeds: [],
        reasoning: 'llm_legacy_format_fallback',
        source: 'llm',
      };
    }

    return {
      primary: 'info_seek',
      confidence: 0.3,
      secondary: null,
      legacyIntent: 'uncertain',
      latentNeeds: [],
      reasoning: 'llm_parse_failed',
      source: 'llm',
    };
  } catch {
    return {
      primary: 'info_seek',
      confidence: 0.2,
      secondary: null,
      legacyIntent: 'uncertain',
      latentNeeds: [],
      reasoning: 'llm_call_failed',
      source: 'llm',
    };
  }
};

// ──── Stage 2: Exemplar Matching ────────────────────────────────────────────

const EXEMPLAR_MIN_COUNT = 5;
const EXEMPLAR_CONFIDENCE_THRESHOLD = 0.7;
const EXEMPLAR_FETCH_LIMIT = 20;

const computeTokenOverlap = (a: string, b: string): number => {
  const tokenize = (s: string): Set<string> =>
    new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2));
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
};

const classifyByExemplars = async (
  text: string,
  guildId: string | null,
): Promise<IntentClassification | null> => {
  if (!guildId) return null;

  try {
    const exemplars = await loadTopExemplars({ guildId, limit: EXEMPLAR_FETCH_LIMIT });
    if (exemplars.length < EXEMPLAR_MIN_COUNT) return null;

    // Score each exemplar by token overlap
    const scored = exemplars
      .map((ex) => ({ ex, sim: computeTokenOverlap(text, ex.message) }))
      .filter((e) => e.sim > 0.2)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 5);

    if (scored.length === 0) return null;

    // Vote: count intents weighted by similarity
    const votes = new Map<string, number>();
    for (const { ex, sim } of scored) {
      const intent = ex.classifiedIntent;
      votes.set(intent, (votes.get(intent) || 0) + sim);
    }

    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const topIntent = parseIntentTaxonomy(sorted[0][0]);
    if (!topIntent) return null;

    const totalWeight = sorted.reduce((s, [, w]) => s + w, 0);
    const confidence = totalWeight > 0 ? sorted[0][1] / totalWeight : 0;

    if (confidence < EXEMPLAR_CONFIDENCE_THRESHOLD) return null;

    return {
      primary: topIntent,
      confidence: Math.min(0.85, confidence),
      secondary: sorted.length > 1 ? (parseIntentTaxonomy(sorted[1][0]) ?? null) : null,
      legacyIntent: toLegacyIntent(topIntent),
      latentNeeds: [],
      reasoning: `exemplar_match:top=${scored.length},vote_conf=${confidence.toFixed(2)}`,
      source: 'exemplar',
    };
  } catch {
    return null;
  }
};

// ──── 3-Stage Pipeline ──────────────────────────────────────────────────────

/**
 * Full 3-stage intent classification pipeline (ADR-006).
 *
 * Stage 1: Rule-based fast-path → high-confidence only
 * Stage 2: Exemplar matching from intent_exemplars
 * Stage 3: LLM structured classification with enriched signals
 */
export const classifyIntent = async (params: {
  goal: string;
  requestedSkillId: string | null;
  intentHints: string[];
  signals: IntentSignalBundle | null;
  guildId?: string | null;
}): Promise<IntentClassification> => {
  const { goal, requestedSkillId, intentHints, signals, guildId } = params;

  // Pre-check: explicit skill request always means task
  if (requestedSkillId) {
    return {
      primary: 'action_execute',
      confidence: 1.0,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'requested_skill_id_present',
      source: 'rule',
    };
  }

  const text = String(goal || '').trim();
  if (!text) {
    return {
      primary: 'info_seek',
      confidence: 0.5,
      secondary: null,
      legacyIntent: 'task',
      latentNeeds: [],
      reasoning: 'empty_goal_default',
      source: 'rule',
    };
  }

  // Stage 1: Rule-based
  const ruleResult = classifyByRules(text, signals);
  if (ruleResult && ruleResult.confidence >= 0.7) {
    return ruleResult;
  }

  // Stage 2: Exemplar matching from guild-calibrated intent_exemplars
  const exemplarResult = await classifyByExemplars(text, guildId ?? null);
  if (exemplarResult && exemplarResult.confidence >= EXEMPLAR_CONFIDENCE_THRESHOLD) {
    return exemplarResult;
  }

  // Stage 3: LLM classification with enriched signals
  const llmResult = await classifyByLlm(text, signals, intentHints);

  // If rule had a low-confidence result, merge with LLM for better decision
  if (ruleResult && ruleResult.confidence >= 0.5) {
    if (ruleResult.primary === llmResult.primary) {
      // Agreement: boost confidence
      return {
        ...llmResult,
        confidence: Math.min(1, (ruleResult.confidence + llmResult.confidence) / 2 + 0.1),
        reasoning: `rule_llm_agreement:${ruleResult.reasoning}+${llmResult.reasoning}`,
        source: 'llm',
      };
    }
    // Disagreement: prefer LLM but note the conflict
    return {
      ...llmResult,
      secondary: llmResult.secondary || ruleResult.primary,
      reasoning: `rule_llm_conflict:rule=${ruleResult.primary},llm=${llmResult.primary}`,
    };
  }

  return llmResult;
};

/**
 * Legacy-compatible wrapper. Returns AgentIntent for existing consumers.
 * Internally uses the full 3-stage pipeline.
 */
export const runRouteIntentNode = async (params: {
  goal: string;
  requestedSkillId: string | null;
  intentHints: string[];
  signals?: IntentSignalBundle | null;
}): Promise<AgentIntent> => {
  const result = await classifyIntent({
    goal: params.goal,
    requestedSkillId: params.requestedSkillId,
    intentHints: params.intentHints,
    signals: params.signals ?? null,
  });
  return result.legacyIntent;
};

/**
 * Full classification entry point. Returns IntentClassification.
 */
export const runClassifyIntentNode = async (params: {
  goal: string;
  requestedSkillId: string | null;
  intentHints: string[];
  signals: IntentSignalBundle | null;
  guildId?: string | null;
}): Promise<IntentClassification> => {
  return classifyIntent(params);
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
