export type AgentRole = 'planner' | 'researcher' | 'critic';

export type AgentPriority = 'fast' | 'balanced' | 'precise';

// ──── Intent Intelligence Layer ─────────────────────────────────────────────

/** Expanded intent taxonomy (ADR-006). */
export type IntentTaxonomy =
  | 'info_seek'         // 정보 탐색
  | 'action_execute'    // 작업 실행 요청
  | 'creative_generate' // 생성/작성 요청
  | 'opinion_consult'   // 의견/추천 요청
  | 'context_provide'   // 추가 맥락 제공 (대화 내)
  | 'confirm_deny'      // 이전 제안에 대한 승인/거절
  | 'emotional'         // 감정 표현 / 공감 필요
  | 'meta_control';     // 시스템 제어 ("멈춰", "취소")

/** Classification source: which pipeline stage made the decision. */
export type IntentClassificationSource = 'rule' | 'exemplar' | 'llm';

/** Structured intent classification result (ADR-006). */
export type IntentClassification = {
  primary: IntentTaxonomy;
  confidence: number;                    // 0-1
  secondary: IntentTaxonomy | null;
  legacyIntent: AgentIntent;             // backward-compat facade
  latentNeeds: string[];                 // inferred hidden requirements
  reasoning: string;                     // trace-friendly classification rationale
  source: IntentClassificationSource;
};

/** Legacy 3-label intent type. Preserved for backward compatibility. */
export type AgentIntent = 'task' | 'casual_chat' | 'uncertain';

/** Map expanded taxonomy to legacy 3-label intent. */
export const toLegacyIntent = (taxonomy: IntentTaxonomy): AgentIntent => {
  if (taxonomy === 'emotional') return 'casual_chat';
  if (taxonomy === 'meta_control') return 'task';
  if (taxonomy === 'confirm_deny') return 'task';
  if (taxonomy === 'context_provide') return 'task';
  return 'task';
};

/** Create a minimal IntentClassification from a legacy AgentIntent value. */
export const fromLegacyIntent = (intent: AgentIntent): IntentClassification => {
  const taxonomyMap: Record<AgentIntent, IntentTaxonomy> = {
    task: 'info_seek',
    casual_chat: 'emotional',
    uncertain: 'info_seek',
  };
  return {
    primary: taxonomyMap[intent],
    confidence: intent === 'uncertain' ? 0.3 : 0.5,
    secondary: null,
    legacyIntent: intent,
    latentNeeds: [],
    reasoning: 'legacy_upgrade',
    source: 'rule',
  };
};

// ──── Other Runtime Types ───────────────────────────────────────────────────

export type AgentDeliberationMode = 'direct' | 'plan_act' | 'deliberate' | 'guarded';

export type AgentPolicyGateDecision = 'allow' | 'review' | 'block';
