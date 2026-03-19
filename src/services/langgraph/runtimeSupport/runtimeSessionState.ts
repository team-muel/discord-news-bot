import type { AgentSession } from '../../multiAgentService';
import { appendTrace, createInitialLangGraphState, type LangGraphNodeId, type LangGraphState } from '../stateContract';

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
      outcomes: session.shadowGraph.outcomes.map((outcome) => ({ ...outcome })),
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
