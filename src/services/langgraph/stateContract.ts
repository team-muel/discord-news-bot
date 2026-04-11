import type { AgentIntent, AgentPolicyGateDecision, AgentPriority } from '../agent/agentRuntimeTypes';
import type { PromptCompileResult } from '../infra/promptCompiler';
import type { AgentOutcome } from '../agent/agentOutcomeContract';
import type { ExecutionStrategy } from './nodes/strategyNodes';

export type LangGraphNodeId =
  | 'ingest'
  | 'compile_prompt'
  | 'route_intent'
  | 'select_execution_strategy'
  | 'hydrate_memory'
  | 'plan_actions'
  | 'execute_actions'
  | 'critic_review'
  | 'requested_skill_run'
  | 'requested_skill_refine'
  | 'fast_path_run'
  | 'fast_path_refine'
  | 'full_review_plan'
  | 'full_review_execute'
  | 'full_review_critique'
  | 'full_review_tot'
  | 'hitl_review'
  | 'full_review_compose'
  | 'full_review_promote'
  | 'policy_gate'
  | 'compose_response'
  | 'persist_and_emit';

export type LangGraphEdgeLabel =
  | 'task'
  | 'casual_chat'
  | 'uncertain'
  | 'policy_block'
  | 'success'
  | 'degraded'
  | 'failure'
  | 'cancelled';

export type LangGraphPlanItem = {
  actionName: string;
  args: Record<string, unknown>;
  reason?: string;
};

export type LangGraphTotShadowBest = {
  rawResult: string;
  score: number;
  beamProbability: number;
  beamCorrectness: number;
  beamScore: number;
  beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
  evidenceBundleId: string;
};

export type LangGraphState = {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  priority: AgentPriority;
  originalGoal: string;
  executionGoal: string;
  compiledPrompt: PromptCompileResult | null;
  intent: AgentIntent | null;
  memoryHints: string[];
  plans: LangGraphPlanItem[];
  outcomes: AgentOutcome[];
  executionStrategy?: ExecutionStrategy | null;
  policyDecision?: AgentPolicyGateDecision | null;
  planText?: string | null;
  subgoals: string[];
  executionDraft?: string | null;
  critiqueText?: string | null;
  finalCandidate?: string | null;
  selectedFinalRaw?: string | null;
  totShadowBest?: LangGraphTotShadowBest | null;
  policyBlocked: boolean;
  finalText: string | null;
  errorCode: string | null;
  trace: Array<{
    node: LangGraphNodeId;
    at: string;
    note?: string;
  }>;
};

export const createInitialLangGraphState = (params: {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  priority: AgentPriority;
  goal: string;
}): LangGraphState => {
  const goal = String(params.goal || '').trim();
  return {
    sessionId: params.sessionId,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    priority: params.priority,
    originalGoal: goal,
    executionGoal: goal,
    compiledPrompt: null,
    intent: null,
    memoryHints: [],
    plans: [],
    outcomes: [],
    executionStrategy: null,
    policyDecision: null,
    planText: null,
    subgoals: [],
    executionDraft: null,
    critiqueText: null,
    finalCandidate: null,
    selectedFinalRaw: null,
    totShadowBest: null,
    policyBlocked: false,
    finalText: null,
    errorCode: null,
    trace: [],
  };
};

export const appendTrace = (
  state: LangGraphState,
  node: LangGraphNodeId,
  note?: string,
): LangGraphState => {
  return {
    ...state,
    trace: [...state.trace, { node, at: new Date().toISOString(), note }],
  };
};

export const deriveEdgeLabelFromOutcome = (outcome: AgentOutcome): LangGraphEdgeLabel => {
  if (outcome.state === 'success') {
    return 'success';
  }
  if (outcome.state === 'degraded') {
    return 'degraded';
  }
  return 'failure';
};
