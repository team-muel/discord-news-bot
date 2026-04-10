import type { AgentSession } from '../../multiAgentService';
import type { AgentOutcome } from '../../agent/agentOutcomeContract';
import { appendTrace, createInitialLangGraphState, type LangGraphNodeId, type LangGraphState } from '../stateContract';

const cloneAgentOutcome = (outcome: AgentOutcome): AgentOutcome => ({
  ...outcome,
  reasons: outcome.reasons ? [...outcome.reasons] : undefined,
  reflection: outcome.reflection ? { ...outcome.reflection } : undefined,
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
  shadowGraph: session.shadowGraph
    ? {
      ...session.shadowGraph,
      memoryHints: [...session.shadowGraph.memoryHints],
      plans: session.shadowGraph.plans.map((plan) => ({ ...plan, args: { ...plan.args } })),
      outcomes: session.shadowGraph.outcomes.map(cloneAgentOutcome),
      trace: session.shadowGraph.trace.map((entry) => ({ ...entry })),
    }
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
