/**
 * Shared type definitions for the multi-agent runtime.
 *
 * Extracted from multiAgentService.ts to reduce coupling and allow
 * consumers to import types without pulling in the full runtime.
 */
import type { LangGraphState } from './langgraph/stateContract';
import type { SkillId } from './skills/types';

export type {
  AgentRole,
  AgentPriority,
  AgentIntent,
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
  memoryHints: string[];
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
