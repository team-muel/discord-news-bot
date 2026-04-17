import type { AgentOutcome } from '../../agent/agentOutcomeContract';
import type { AgentSession } from '../../multiAgentTypes';
import type { AgentSessionHitlDecision } from '../../multiAgentTypes';
import { appendTrace, createInitialLangGraphState, type LangGraphNodeId, type LangGraphState } from '../stateContract';
import { resolveSessionDeliberationDefaults } from './runtimeSessionBootstrap';

const cloneAgentOutcome = (outcome: AgentOutcome): AgentOutcome => ({
  ...outcome,
  reasons: outcome.reasons ? [...outcome.reasons] : undefined,
  reflection: outcome.reflection ? { ...outcome.reflection } : undefined,
});

const cloneCompiledPrompt = (compiledPrompt: LangGraphState['compiledPrompt']) => {
  if (!compiledPrompt) {
    return null;
  }

  return {
    ...compiledPrompt,
    directives: [...compiledPrompt.directives],
    intentTags: [...compiledPrompt.intentTags],
  };
};

export const cloneLangGraphState = (state: LangGraphState): LangGraphState => ({
  ...state,
  compiledPrompt: cloneCompiledPrompt(state.compiledPrompt),
  memoryHints: [...state.memoryHints],
  plans: state.plans.map((plan) => ({ ...plan, args: { ...plan.args } })),
  outcomes: state.outcomes.map(cloneAgentOutcome),
  subgoals: [...state.subgoals],
  totShadowBest: state.totShadowBest ? { ...state.totShadowBest } : null,
  trace: state.trace.map((entry) => ({ ...entry })),
});

export const cancelAllPendingSteps = (session: AgentSession, timestamp: string): void => {
  for (const step of session.steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = 'cancelled';
      step.startedAt = step.startedAt || timestamp;
      step.endedAt = timestamp;
    }
  }
};

export const touch = (session: AgentSession): void => {
  session.updatedAt = new Date().toISOString();
};

export const cloneSession = (session: AgentSession): AgentSession => ({
  ...session,
  steps: session.steps.map((step) => ({ ...step })),
  shadowGraph: session.shadowGraph ? cloneLangGraphState(session.shadowGraph) : null,
  graphCheckpoint: session.graphCheckpoint
    ? {
      ...session.graphCheckpoint,
      state: session.graphCheckpoint.state ? cloneLangGraphState(session.graphCheckpoint.state) : null,
    }
    : null,
  hitlState: session.hitlState
    ? { ...session.hitlState }
    : null,
});

export const ensureShadowGraph = (session: AgentSession): LangGraphState => {
  if (!session.shadowGraph) {
    session.shadowGraph = createInitialLangGraphState({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
      goal: session.goal,
    });
  }
  return session.shadowGraph;
};

export const traceShadowNode = (
  session: AgentSession,
  node: LangGraphNodeId,
  note?: string,
): void => {
  session.shadowGraph = appendTrace(ensureShadowGraph(session), node, note);
};

export const appendShadowOutcomes = (
  session: AgentSession,
  outcomes: AgentOutcome[] | null | undefined,
): void => {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return;
  }

  const shadowGraph = ensureShadowGraph(session);
  session.shadowGraph = {
    ...shadowGraph,
    outcomes: [...shadowGraph.outcomes, ...outcomes.map(cloneAgentOutcome)],
  };
};

export const persistSessionCheckpoint = (params: {
  session: AgentSession;
  currentNode: LangGraphNodeId | null;
  nextNode: LangGraphNodeId | null;
  state: LangGraphState;
  reason: 'transition' | 'hitl_pause' | 'resume_request';
  savedAt: string;
  persistSession?: (session: AgentSession) => void;
}): void => {
  const { session, currentNode, nextNode, state, reason, savedAt, persistSession } = params;
  session.graphCheckpoint = {
    currentNode,
    nextNode,
    savedAt,
    reason,
    resumable: nextNode !== null,
    state: cloneLangGraphState(state),
  };
  touch(session);
  persistSession?.(session);
};

export const clearSessionCheckpoint = (session: AgentSession): void => {
  session.graphCheckpoint = null;
};

export const resetSessionForRetry = (params: {
  session: AgentSession;
  deliberationMode: AgentSession['deliberationMode'];
  buildInitialSteps: (timestamp: string) => AgentSession['steps'];
  timestamp: string;
}): void => {
  const { session, deliberationMode, buildInitialSteps, timestamp } = params;
  const deliberationDefaults = resolveSessionDeliberationDefaults(deliberationMode);
  session.status = 'queued';
  session.startedAt = null;
  session.endedAt = null;
  session.result = null;
  session.cancelRequested = false;
  session.trafficRoute = 'main';
  session.trafficRoutingDecision = null;
  session.trafficRouteResolvedAt = null;
  session.executionEngine = 'main';
  clearSessionCheckpoint(session);
  session.hitlState = null;
  session.deliberationMode = deliberationMode;
  session.riskScore = deliberationDefaults.riskScore;
  session.policyGate = deliberationDefaults.policyGate;
  session.steps = buildInitialSteps(timestamp);
  session.shadowGraph = null;
};

export const prepareSessionForResume = (params: {
  session: AgentSession;
  decision?: AgentSessionHitlDecision | null;
  note?: string | null;
  resumedAt: string;
}): void => {
  const { session, decision, note, resumedAt } = params;
  if (session.hitlState?.awaitingInput) {
    session.hitlState = {
      ...session.hitlState,
      awaitingInput: false,
      decision: decision || 'approve',
      note: note ? String(note).trim() : null,
      resumedAt,
    };
  }

  session.status = 'queued';
  session.error = null;
  session.result = null;
};

export const isResumableLangGraphSession = (session: AgentSession): boolean => {
  return session.executionEngine === 'langgraphjs' && Boolean(session.graphCheckpoint?.resumable);
};

export const pauseSessionForHitl = (params: {
  session: AgentSession;
  gateNode: LangGraphNodeId;
  prompt: string;
  requestedAt: string;
  persistCheckpoint: (params: {
    session: AgentSession;
    currentNode: LangGraphNodeId | null;
    nextNode: LangGraphNodeId | null;
    state: LangGraphState;
    reason: 'transition' | 'hitl_pause' | 'resume_request';
  }) => void;
}): void => {
  const { session, gateNode, prompt, requestedAt, persistCheckpoint } = params;
  session.status = 'queued';
  session.result = null;
  session.error = null;
  session.hitlState = {
    awaitingInput: true,
    gateNode,
    prompt,
    requestedAt,
    resumedAt: null,
    decision: null,
    note: null,
  };
  persistCheckpoint({
    session,
    currentNode: gateNode,
    nextNode: gateNode,
    state: ensureShadowGraph(session),
    reason: 'hitl_pause',
  });
};
