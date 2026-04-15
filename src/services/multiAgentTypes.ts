/**
 * Shared type definitions for the multi-agent runtime.
 *
 * Extracted from multiAgentService.ts to reduce coupling and allow
 * consumers to import types without pulling in the full runtime.
 */
import type { LangGraphNodeId, LangGraphState } from './langgraph/stateContract';
import type { AgentPersonalizationSnapshot } from './agent/agentPersonalizationService';
import type { SkillId } from './skills/types';
import type { TrafficRoute, TrafficRoutingDecision } from './workflow/trafficRoutingService';

export type {
  AgentRole,
  AgentPriority,
  AgentIntent,
  IntentTaxonomy,
  IntentClassification,
  IntentClassificationSource,
  AgentDeliberationMode,
  AgentPolicyGateDecision,
} from './agent/agentRuntimeTypes';

export type AgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AgentStep = {
  id: string;
  role: import('./agent/agentRuntimeTypes').AgentRole;
  title: string;
  status: AgentStepStatus;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  error: string | null;
};

export type AgentSessionHitlDecision = 'approve' | 'reject' | 'revise';

export type AgentSessionHitlState = {
  awaitingInput: boolean;
  gateNode: LangGraphNodeId | null;
  prompt: string | null;
  requestedAt: string | null;
  resumedAt: string | null;
  decision: AgentSessionHitlDecision | null;
  note: string | null;
};

export type AgentSessionGraphCheckpoint = {
  currentNode: LangGraphNodeId | null;
  nextNode: LangGraphNodeId | null;
  savedAt: string;
  reason: 'transition' | 'hitl_pause' | 'resume_request';
  resumable: boolean;
  state: LangGraphState | null;
};

export type AgentSession = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  conversationThreadId?: number | null;
  conversationTurnIndex?: number | null;
  priority: import('./agent/agentRuntimeTypes').AgentPriority;
  requestedSkillId: SkillId | null;
  routedIntent: import('./agent/agentRuntimeTypes').AgentIntent;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  result: string | null;
  error: string | null;
  cancelRequested: boolean;
  trafficRoute?: TrafficRoute;
  trafficRoutingDecision?: TrafficRoutingDecision | null;
  trafficRouteResolvedAt?: string | null;
  executionEngine?: 'main' | 'langgraphjs';
  graphCheckpoint?: AgentSessionGraphCheckpoint | null;
  hitlState?: AgentSessionHitlState | null;
  deliberationMode?: import('./agent/agentRuntimeTypes').AgentDeliberationMode;
  riskScore?: number;
  policyGate?: {
    decision: import('./agent/agentRuntimeTypes').AgentPolicyGateDecision;
    reasons: string[];
  };
  ormAssessment?: {
    score: number;
    verdict: 'pass' | 'review' | 'fail';
    reasons: string[];
    citationCount: number;
    evidenceBundleId: string;
  };
  totShadowAssessment?: {
    enabled: boolean;
    exploredBranches: number;
    keptCandidates: number;
    bestScore: number;
    bestEvidenceBundleId: string;
    strategy: 'bfs' | 'dfs';
    selectedByRouter?: boolean;
    scoreGainVsBaseline?: number;
  };
  personalization?: AgentPersonalizationSnapshot | null;
  memoryHints: string[];
  intentClassification?: import('./agent/agentRuntimeTypes').IntentClassification | null;
  steps: AgentStep[];
  shadowGraph: LangGraphState | null;
};

export type AgentRuntimeSnapshot = {
  totalSessions: number;
  runningSessions: number;
  queuedSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  deadletteredSessions: number;
  latestSessionAt: string | null;
};

export type AgentSessionShadowSummary = {
  traceLength: number;
  lastNode: string | null;
  intent: import('./agent/agentRuntimeTypes').AgentIntent | null;
  hasError: boolean;
  elapsedMs: number | null;
  uniqueNodeCount: number;
  traceTail: Array<{
    node: string;
    at: string;
    note?: string;
  }>;
};

export type AgentSessionProgressSummary = {
  totalSteps: number;
  doneSteps: number;
  completedSteps: number;
  failedSteps: number;
  cancelledSteps: number;
  runningSteps: number;
  pendingSteps: number;
  progressPercent: number;
  checkpointNode?: LangGraphNodeId | null;
  checkpointSavedAt?: string | null;
  checkpointResumable?: boolean;
  awaitingHumanInput?: boolean;
  hitlDecision?: AgentSessionHitlDecision | null;
};

export type AgentSessionApiView = Omit<AgentSession, 'shadowGraph'> & {
  shadowGraphSummary: AgentSessionShadowSummary | null;
  progressSummary: AgentSessionProgressSummary;
  privacySummary: {
    deliberationMode: import('./agent/agentRuntimeTypes').AgentDeliberationMode;
    riskScore: number;
    decision: import('./agent/agentRuntimeTypes').AgentPolicyGateDecision;
    reasons: string[];
  };
  shadowGraph?: LangGraphState | null;
};

export type BeamEvaluation = {
  probability: number;
  correctness: number;
  score: number;
  probabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
};

export type SessionOutcomeEntry = {
  status: string;
  error: string | null;
  goalSnippet: string;
  stepCount: number;
};
