import { cloneSession } from './langgraph/runtimeSupport/runtimeSessionState';
import type { LangGraphState } from './langgraph/stateContract';
import type {
  AgentSession,
  AgentSessionApiView,
  AgentSessionShadowSummary,
  AgentSessionProgressSummary,
} from './multiAgentTypes';

const nowIso = () => new Date().toISOString();

export const toElapsedMs = (session: AgentSession): number | null => {
  if (!session.startedAt) {
    return null;
  }

  const startedMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }

  const endBase = session.endedAt || session.updatedAt || nowIso();
  const endedMs = Date.parse(endBase);
  if (!Number.isFinite(endedMs)) {
    return null;
  }

  return Math.max(0, endedMs - startedMs);
};

export const toTraceTailLimit = (raw?: number): number => {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(0, Math.min(20, Math.trunc(value)));
};

export const buildShadowSummary = (
  shadowGraph: LangGraphState | null,
  session: AgentSession,
  traceTailLimit: number,
): AgentSessionShadowSummary | null => {
  if (!shadowGraph) {
    return null;
  }

  const uniqueNodeCount = new Set(shadowGraph.trace.map((entry) => entry.node)).size;
  const traceTail = traceTailLimit > 0
    ? shadowGraph.trace
      .slice(-traceTailLimit)
      .map((entry) => ({ node: entry.node, at: entry.at, note: entry.note }))
    : [];

  const lastNode = shadowGraph.trace.length > 0
    ? shadowGraph.trace[shadowGraph.trace.length - 1].node
    : null;

  return {
    traceLength: shadowGraph.trace.length,
    lastNode,
    intent: shadowGraph.intent,
    hasError: Boolean(shadowGraph.errorCode),
    elapsedMs: toElapsedMs(session),
    uniqueNodeCount,
    traceTail,
  };
};

export const buildProgressSummary = (session: AgentSession): AgentSessionProgressSummary => {
  const totalSteps = session.steps.length;
  const completedSteps = session.steps.filter((step) => step.status === 'completed').length;
  const failedSteps = session.steps.filter((step) => step.status === 'failed').length;
  const cancelledSteps = session.steps.filter((step) => step.status === 'cancelled').length;
  const runningSteps = session.steps.filter((step) => step.status === 'running').length;
  const pendingSteps = session.steps.filter((step) => step.status === 'pending').length;
  const doneSteps = completedSteps + failedSteps + cancelledSteps;
  const progressPercent = totalSteps > 0
    ? Math.round((doneSteps / totalSteps) * 100)
    : 100;

  return {
    totalSteps,
    doneSteps,
    completedSteps,
    failedSteps,
    cancelledSteps,
    runningSteps,
    pendingSteps,
    progressPercent,
    checkpointNode: session.graphCheckpoint?.nextNode || session.graphCheckpoint?.currentNode || null,
    checkpointSavedAt: session.graphCheckpoint?.savedAt || null,
    checkpointResumable: session.graphCheckpoint?.resumable || false,
    awaitingHumanInput: session.hitlState?.awaitingInput || false,
    hitlDecision: session.hitlState?.decision || null,
  };
};

export const buildPrivacySummary = (session: AgentSession) => {
  return {
    deliberationMode: session.deliberationMode || 'direct',
    riskScore: Number.isFinite(session.riskScore) ? Number(session.riskScore) : 0,
    decision: session.policyGate?.decision || 'allow',
    reasons: [...(session.policyGate?.reasons || [])],
  };
};

export const serializeAgentSessionForApi = (
  session: AgentSession,
  options?: { includeShadowGraph?: boolean; traceTailLimit?: number },
): AgentSessionApiView => {
  const includeShadowGraph = options?.includeShadowGraph === true;
  const traceTailLimit = toTraceTailLimit(options?.traceTailLimit);
  const cloned = cloneSession(session);
  const shadowGraph = cloned.shadowGraph;

  return {
    ...cloned,
    shadowGraphSummary: buildShadowSummary(shadowGraph, cloned, traceTailLimit),
    progressSummary: buildProgressSummary(cloned),
    privacySummary: buildPrivacySummary(cloned),
    ...(includeShadowGraph ? { shadowGraph } : {}),
    ...(includeShadowGraph ? {} : { shadowGraph: undefined }),
  };
};
