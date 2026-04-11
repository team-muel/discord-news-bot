import crypto from 'crypto';
import {
  AGENT_MAX_SESSION_HISTORY,
  AGENT_MEMORY_HINT_TIMEOUT_MS,
  AGENT_QUEUE_POLL_MS,
  AGENT_MAX_QUEUE_SIZE,
  AGENT_SESSION_MAX_ATTEMPTS,
  AGENT_DEADLETTER_MAX,
} from '../config';
import logger from '../logger';
import { buildAgentMemoryHints } from './agent/agentMemoryService';
import { TtlCache } from '../utils/ttlCache';
import { getAgentPolicySnapshot, primeAgentPolicyCache, validateAgentSessionRequest } from './agent/agentPolicyService';
import { persistAgentSession } from './agent/agentSessionStore';
import { bindSessionAssistantTurn, bindSessionUserTurn, fetchRecentTurnsForUser } from './conversationTurnService';
import { isAnyLlmConfigured } from './llmClient';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { ensureSessionBudget, getErrorMessage, withTimeout } from './langgraph/runtimeSupport/runtimeBudget';
import {
  assessRuleBasedOrm,
  clamp01,
  evaluateTaskResultCandidate,
  extractActionableFeedbackPoints,
  parseSelfEvaluationJson,
} from './langgraph/runtimeSupport/runtimeEvaluation';
import {
  cancelAllPendingSteps,
  appendShadowOutcomes,
  cloneLangGraphState,
  cloneSession,
  ensureShadowGraph,
  touch,
  traceShadowNode,
} from './langgraph/runtimeSupport/runtimeSessionState';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillId } from './skills/types';
import { getWorkflowStepTemplates, primeWorkflowProfileCache } from './agent/agentWorkflowService';
import type { LangGraphNodeId } from './langgraph/stateContract';
import type { LangGraphNodeHandler } from './langgraph/executor';
import { executeLangGraphWithLangGraphJs } from './langgraph/langgraphjsAdapter';
import { LANGGRAPH_NODE_IDS, runLangGraphExecutorShadowReplay } from './sessionShadowExecution';
import { runCompilePromptNode, runPolicyGateNode, runClassifyIntentNode } from './langgraph/nodes/coreNodes';
import {
  runHydrateMemoryNode,
  runNonTaskIntentNode,
  runPersistAndEmitNode,
  runTaskPolicyGateTransitionNode,
} from './langgraph/nodes/runtimeNodes';
import { runSelectExecutionStrategyNode } from './langgraph/nodes/strategyNodes';
import { enrichIntentSignals } from './langgraph/nodes/intentSignalEnricher';
import { persistIntentExemplar } from './langgraph/nodes/intentExemplarStore';
import { attributeAndPersistIntentOutcome } from './langgraph/nodes/intentOutcomeAttributor';
import { executeSessionBranchRuntime } from './langgraph/sessionRuntime/branchRuntime';
import { runCriticReviewNode, runPlanTaskNode, runResearchTaskNode } from './langgraph/sessionRuntime/fullReviewNodes';
import { runComposeFinalNode, runPromoteBestCandidateNode, type TotShadowBest } from './langgraph/sessionRuntime/fullReviewDeliberationNodes';
import { getAgentPrivacyPolicySnapshot, primeAgentPrivacyPolicyCache } from './agent/agentPrivacyPolicyService';
import { recordPrivacyGateSample } from './agent/agentPrivacyTuningService';
import {
  getAgentTotPolicySnapshot,
  getTotReplayCandidates,
  maybeAutoTuneAgentTotPolicy,
  primeAgentTotPolicyCache,
  recordTotCandidatePair,
  type AgentTotPolicySnapshot,
} from './agent/agentTotPolicyService';
import {
  getAgentGotPolicySnapshot,
  primeAgentGotPolicyCache,
  resolveGotBudgetForPriority,
  type AgentGotPolicySnapshot,
} from './agent/agentGotPolicyService';
import { getAgentGotCutoverDecision } from './agent/agentGotCutoverService';
import { recordGotShadowRun } from './agent/agentGotStore';
import { enqueueTelemetryTask, registerTelemetryTaskHandler } from './agent/agentTelemetryQueue';
import { isShadowRunnerEnabled, runShadowGraph, persistShadowDivergence, isShadowResultPromotable, type ShadowRunResult } from './langgraph/shadowGraphRunner';
import {
  TRAFFIC_ROUTING_ENABLED,
  resolveTrafficRoute,
  persistTrafficRoutingDecision,
  type TrafficRoutingDecision,
} from './workflow/trafficRoutingService';
import { precipitateSessionToMemory } from './entityNervousSystem';
import { MultiAgentRuntimeQueue } from './multiAgentRuntimeQueue';
import type {
  AgentRole,
  AgentPriority,
  AgentIntent,
  AgentDeliberationMode,
  AgentPolicyGateDecision,
} from './agent/agentRuntimeTypes';
import type {
  AgentSessionHitlDecision,
  AgentSession,
  AgentSessionStatus,
  AgentStep,
  AgentStepStatus,
  AgentRuntimeSnapshot,
  AgentSessionShadowSummary,
  AgentSessionProgressSummary,
  AgentSessionApiView,
  BeamEvaluation,
  SessionOutcomeEntry,
} from './multiAgentTypes';
import {
  buildPolicyBlockMessage,
  generateCasualChatResult,
  generateIntentClarificationResult,
} from './agent/agentIntentClassifier';
import {
  AGENT_SESSION_TIMEOUT_MS,
  AGENT_STEP_TIMEOUT_MS,
  ORM_RULE_PASS_THRESHOLD,
  ORM_RULE_REVIEW_THRESHOLD,
  GOT_SHADOW_RECORD_TASK,
  TOT_CANDIDATE_PAIR_RECORD_TASK,
  recordComplexityMetric,
  enqueueBestEffortTelemetry,
  estimateReasoningComplexity,
  resolveFinalSelfConsistencySamples,
  resolveTotShadowBudget,
  evaluateSelfGuidedBeam,
  runSelfRefineLite,
  runToTShadowExploration,
  finalizeTaskResult,
  decomposeGoalLeastToMost,
  runLeastToMostExecutionDraft,
} from './multiAgentReasoningStrategies';

// Re-export all types for backward compatibility
export type {
  AgentRole,
  AgentPriority,
  AgentIntent,
  IntentTaxonomy,
  IntentClassification,
  IntentClassificationSource,
  AgentDeliberationMode,
  AgentPolicyGateDecision,
  AgentSession,
  AgentSessionStatus,
  AgentStep,
  AgentStepStatus,
  AgentRuntimeSnapshot,
  AgentSessionShadowSummary,
  AgentSessionProgressSummary,
  AgentSessionApiView,
  BeamEvaluation,
} from './multiAgentTypes';

const MAX_SESSION_HISTORY = AGENT_MAX_SESSION_HISTORY;
const sessions = new Map<string, AgentSession>();
const queueRuntime = new MultiAgentRuntimeQueue<AgentSession>();

// Cross-session outcome hints: recent terminal session summaries per guild
const recentSessionOutcomes = new TtlCache<SessionOutcomeEntry[]>(200);
const SESSION_OUTCOME_TTL_MS = 120_000;
const SESSION_OUTCOME_MAX_PER_GUILD = 5;

const recordSessionOutcome = (session: AgentSession, status: string): void => {
  const key = session.guildId;
  if (!key) return;
  const existing = recentSessionOutcomes.get(key) || [];
  existing.unshift({
    status,
    error: session.error,
    goalSnippet: String(session.goal || '').slice(0, 80),
    stepCount: session.steps.length,
  });
  recentSessionOutcomes.set(key, existing.slice(0, SESSION_OUTCOME_MAX_PER_GUILD), SESSION_OUTCOME_TTL_MS);
};

export const getRecentSessionOutcomes = (guildId: string): SessionOutcomeEntry[] => {
  return recentSessionOutcomes.get(guildId) || [];
};

registerTelemetryTaskHandler(GOT_SHADOW_RECORD_TASK, async (payload) => {
  await recordGotShadowRun(payload as Parameters<typeof recordGotShadowRun>[0]);
});

registerTelemetryTaskHandler(TOT_CANDIDATE_PAIR_RECORD_TASK, async (payload) => {
  await recordTotCandidatePair(payload as Parameters<typeof recordTotCandidatePair>[0]);
  const guildId = String(payload.guildId || '').trim();
  if (guildId) {
    await maybeAutoTuneAgentTotPolicy(guildId);
  }
});

const toPriority = (value?: string | null): AgentPriority => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fast' || normalized === '빠름') {
    return 'fast';
  }
  if (normalized === 'precise' || normalized === '정밀') {
    return 'precise';
  }
  return 'balanced';
};

const nowIso = () => new Date().toISOString();

const buildInitialSteps = (
  guildId: string,
  requestedSkillId: SkillId | null,
  priority: AgentPriority,
  timestamp: string,
): AgentStep[] => {
  primeWorkflowProfileCache();
  const templates = getWorkflowStepTemplates({
    guildId,
    priority,
    hasRequestedSkill: Boolean(requestedSkillId),
  });

  return templates.map((template) => {
    const cancelled = Boolean(
      (priority === 'fast' && template.skipWhenFast)
      || (requestedSkillId && template.skipWhenRequestedSkill),
    );
    return {
      id: crypto.randomUUID(),
      role: template.role,
      title: requestedSkillId && template.role === 'planner'
        ? `스킬 실행: ${requestedSkillId}`
        : template.title,
      status: cancelled ? 'cancelled' : 'pending',
      startedAt: null,
      endedAt: cancelled ? timestamp : null,
      output: null,
      error: null,
    };
  });
};

const getSession = (sessionId: string): AgentSession | undefined => sessions.get(sessionId);

const buildBranchRuntimeDependencies = () => ({
  traceShadowNode,
  runStep,
  runSelfRefineLite,
  finalizeTaskResult,
  markSessionTerminal,
  ensureShadowGraph,
  decomposeGoalLeastToMost,
  runLeastToMostExecutionDraft,
  getAgentTotPolicySnapshot,
  getAgentGotPolicySnapshot,
  getAgentGotCutoverDecision,
  runToTShadowExploration,
  resolveFinalSelfConsistencySamples,
  touch,
  evaluateSelfGuidedBeam,
  enqueueBestEffortTelemetry,
});

const buildBranchRuntimeConstants = () => ({
  sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
  stepTimeoutMs: AGENT_STEP_TIMEOUT_MS,
  ormPassThreshold: ORM_RULE_PASS_THRESHOLD,
  ormReviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
  totCandidatePairRecordTask: TOT_CANDIDATE_PAIR_RECORD_TASK,
});

const isTerminalStatus = (status: AgentSessionStatus): boolean => {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
};

const getSessionExecutionEngine = (session: AgentSession): 'main' | 'langgraphjs' => {
  return session.executionEngine === 'langgraphjs' ? 'langgraphjs' : 'main';
};

const applyTrafficRoutingDecisionToSession = (
  session: AgentSession,
  decision: TrafficRoutingDecision | null,
): void => {
  session.trafficRoutingDecision = decision;
  session.trafficRoute = decision?.route || 'main';
  session.trafficRouteResolvedAt = decision ? nowIso() : null;
  session.executionEngine = decision?.route === 'langgraph' ? 'langgraphjs' : 'main';
};

const persistSessionCheckpoint = (params: {
  session: AgentSession;
  currentNode: LangGraphNodeId | null;
  nextNode: LangGraphNodeId | null;
  state: NonNullable<AgentSession['shadowGraph']>;
  reason: 'transition' | 'hitl_pause' | 'resume_request';
}) => {
  const { session, currentNode, nextNode, state, reason } = params;
  session.graphCheckpoint = {
    currentNode,
    nextNode,
    savedAt: nowIso(),
    reason,
    resumable: nextNode !== null,
    state: cloneLangGraphState(state),
  };
  touch(session);
  void persistAgentSession(cloneSession(session));
};

const clearSessionCheckpoint = (session: AgentSession): void => {
  session.graphCheckpoint = null;
};

const isResumableLangGraphSession = (session: AgentSession): boolean => {
  return session.executionEngine === 'langgraphjs' && Boolean(session.graphCheckpoint?.resumable);
};

const shouldPauseForHitlReview = (session: AgentSession): boolean => {
  if (session.executionEngine !== 'langgraphjs') {
    return false;
  }

  const strategy = ensureShadowGraph(session).executionStrategy;
  if (strategy !== 'full_review') {
    return false;
  }

  return session.policyGate?.decision === 'review' || session.priority === 'precise';
};

const buildHitlReviewPrompt = (session: AgentSession, taskGoal: string): string => {
  const state = ensureShadowGraph(session);
  const lines = [
    'LangGraph human review is required before automatic completion.',
    `goal=${taskGoal}`,
    `strategy=${state.executionStrategy || 'unknown'}`,
    `policyDecision=${session.policyGate?.decision || 'allow'}`,
  ];

  if (state.planText) {
    lines.push(`plan=${state.planText.slice(0, 240)}`);
  }
  if (state.critiqueText) {
    lines.push(`critique=${state.critiqueText.slice(0, 240)}`);
  }
  if (state.totShadowBest?.rawResult) {
    lines.push(`totCandidate=${state.totShadowBest.rawResult.slice(0, 240)}`);
  }

  return lines.join('\n');
};

const pauseSessionForHitl = (params: {
  session: AgentSession;
  gateNode: LangGraphNodeId;
  prompt: string;
}) => {
  const { session, gateNode, prompt } = params;
  session.status = 'queued';
  session.result = null;
  session.error = null;
  session.hitlState = {
    awaitingInput: true,
    gateNode,
    prompt,
    requestedAt: nowIso(),
    resumedAt: null,
    decision: null,
    note: null,
  };
  persistSessionCheckpoint({
    session,
    currentNode: gateNode,
    nextNode: gateNode,
    state: ensureShadowGraph(session),
    reason: 'hitl_pause',
  });
};

const normalizeTrafficRoutingDecision = (
  decision: TrafficRoutingDecision,
): TrafficRoutingDecision => {
  const shadowRunnerEnabled = isShadowRunnerEnabled();
  if (decision.route === 'shadow' && !shadowRunnerEnabled) {
    return {
      ...decision,
      route: 'main',
      reason: `shadow_runner_disabled:${decision.reason}`,
      policySnapshot: {
        ...decision.policySnapshot,
        requestedRoute: decision.route,
        shadowRunnerEnabled,
      },
    };
  }

  return {
    ...decision,
    policySnapshot: {
      ...decision.policySnapshot,
      shadowRunnerEnabled,
    },
  };
};

const buildFallbackTrafficRoutingDecision = (
  error: unknown,
): TrafficRoutingDecision => {
  const resolutionError = getErrorMessage(error);
  return {
    route: 'main',
    reason: `traffic_routing_resolution_failed:${resolutionError}`,
    gotCutoverAllowed: false,
    rolloutPercentage: 0,
    stableBucket: 0,
    shadowDivergenceRate: null,
    shadowQualityDelta: null,
    readinessRecommended: false,
    policySnapshot: {
      trafficRoutingEnabled: TRAFFIC_ROUTING_ENABLED,
      shadowRunnerEnabled: isShadowRunnerEnabled(),
      resolutionError,
    },
  };
};

const resolveSessionTrafficRoute = async (
  session: AgentSession,
): Promise<TrafficRoutingDecision | null> => {
  if (!TRAFFIC_ROUTING_ENABLED) {
    applyTrafficRoutingDecisionToSession(session, null);
    return null;
  }

  try {
    const gotDecision = await getAgentGotCutoverDecision({
      guildId: session.guildId,
      sessionId: session.id,
    });
    const resolvedDecision = await resolveTrafficRoute({
      sessionId: session.id,
      guildId: session.guildId,
      priority: session.priority,
      gotCutoverDecision: gotDecision,
    });
    const normalizedDecision = normalizeTrafficRoutingDecision(resolvedDecision);
    applyTrafficRoutingDecisionToSession(session, normalizedDecision);
    touch(session);
    void persistAgentSession(cloneSession(session));
    logger.info(
      '[TRAFFIC-ROUTING] session=%s route=%s engine=%s reason=%s',
      session.id,
      normalizedDecision.route,
      getSessionExecutionEngine(session),
      normalizedDecision.reason,
    );
    return normalizedDecision;
  } catch (error) {
    const fallbackDecision = buildFallbackTrafficRoutingDecision(error);
    applyTrafficRoutingDecisionToSession(session, fallbackDecision);
    touch(session);
    void persistAgentSession(cloneSession(session));
    logger.warn(
      '[TRAFFIC-ROUTING] session=%s resolution fallback: %s',
      session.id,
      fallbackDecision.reason,
    );
    return fallbackDecision;
  }
};

const markSessionTerminal = (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => {
  const nodeResult = runPersistAndEmitNode({
    shadowGraph: ensureShadowGraph(session),
    status,
    currentResult: session.result,
    currentError: session.error,
    patch: {
      result: patch?.result,
      error: patch?.error,
    },
  });

  session.shadowGraph = nodeResult.shadowGraph;

  session.status = status;
  session.endedAt = nowIso();
  if (patch?.result !== undefined) {
    session.result = patch.result;
  }
  if (patch?.error !== undefined) {
    session.error = patch.error;
  }
  clearSessionCheckpoint(session);
  touch(session);
  void persistAgentSession(cloneSession(session));
  if (session.trafficRoutingDecision) {
    void persistTrafficRoutingDecision({
      sessionId: session.id,
      guildId: session.guildId,
      decision: session.trafficRoutingDecision,
    });
  }

  // Record cross-session metrics before releasing heavy structures
  recordComplexityMetric(session);
  recordSessionOutcome(session, status);

  // Circuit 1: Precipitate session outcome into long-term memory
  void precipitateSessionToMemory({
    sessionId: session.id,
    guildId: session.guildId,
    goal: session.goal,
    result: session.result,
    status,
    stepCount: session.steps.length,
    requestedBy: session.requestedBy,
  }).catch(() => { /* best-effort precipitation */ });

  // Intent Intelligence Layer: attribute classification correctness (ADR-006)
  const intentConfidence = session.intentClassification?.confidence ?? 0.5;
  const intentPrimary = session.intentClassification?.primary || session.shadowGraph?.intent || 'info_seek';
  const failedStepCount = session.steps.filter((s) => s.status === 'failed').length;
  const completedStepCount = session.steps.filter((s) => s.status === 'completed').length;
  const totalSteps = session.steps.length;

  // Compute lightweight session-level reward from outcome
  const sessionReward = totalSteps > 0
    ? Math.max(0, Math.min(1, completedStepCount / totalSteps - failedStepCount * 0.2))
    : (status === 'completed' ? 0.6 : status === 'failed' ? 0.2 : null);

  // Heuristic: early step failure with low classification confidence suggests misrouting
  const earlyStepFailureWithLowConfidence = (
    failedStepCount > 0 &&
    totalSteps >= 2 &&
    intentConfidence < 0.5
  );

  void attributeAndPersistIntentOutcome({
    sessionId: session.id,
    guildId: session.guildId,
    intentConfidence,
    intentPrimary,
    sessionStatus: status,
    sessionReward,
    userClarifiedWithinTurns: earlyStepFailureWithLowConfidence,
    stepFailureCount: failedStepCount,
  }).catch((err) => {
    logger.warn('[SESSION-CLEANUP] Intent attribution failed session=%s: %s', session.id, getErrorMessage(err));
  });

  // Capture shadow trace before releasing in-memory structures
  const shadowTraceNodes: LangGraphNodeId[] = session.shadowGraph
    ? session.shadowGraph.trace.map((t) => t.node).filter((n): n is LangGraphNodeId => (LANGGRAPH_NODE_IDS as string[]).includes(n))
    : [];

  // Release heavy in-memory structures after persistence
  session.shadowGraph = null;
  for (const step of session.steps) {
    step.output = null;
  }

  const assistantPayload = nodeResult.assistantPayload;
  if (assistantPayload) {
    void bindSessionAssistantTurn({
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      sessionId: session.id,
      threadId: session.conversationThreadId,
      content: assistantPayload,
      status,
      error: session.error,
    }).then((turn) => {
      if (!turn) {
        return;
      }
      const target = sessions.get(session.id);
      if (!target) {
        return;
      }
      target.conversationThreadId = turn.threadId;
      target.conversationTurnIndex = turn.turnIndex;
      touch(target);
      void persistAgentSession(cloneSession(target));
    }).catch(() => {
      // Best-effort turn logging.
    });
  }

  if (getSessionExecutionEngine(session) !== 'langgraphjs') {
    void runLangGraphExecutorShadowReplay(session, status);
  }

  // Phase 1+2 shadow graph: run real node handlers in parallel, log divergence,
  // and record promotability for non-main routes.
  if (getSessionExecutionEngine(session) !== 'langgraphjs' && isShadowRunnerEnabled()) {
    void runShadowGraph({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
      requestedSkillId: session.requestedSkillId,
      goal: session.goal,
      mainPathNodes: shadowTraceNodes,
      loadMemoryHints: (input) => withTimeout(buildAgentMemoryHints(input), AGENT_MEMORY_HINT_TIMEOUT_MS, 'SHADOW_MEMORY_HINT_TIMEOUT').catch(() => []),
    }).then((result: ShadowRunResult) => {
      void persistShadowDivergence({
        sessionId: session.id,
        guildId: session.guildId,
        result,
        mainFinalStatus: status,
      });

      const routeDecision = session.trafficRoutingDecision;
      if (routeDecision) {
        const promotability = isShadowResultPromotable(result, status);
        if (routeDecision.route !== 'main' && promotability.promotable) {
          logger.info(
            '[TRAFFIC-ROUTING] shadow promotable session=%s route=%s reason=%s',
            session.id,
            routeDecision.route,
            promotability.reason,
          );
        } else if (routeDecision.route !== 'main' && !promotability.promotable) {
          logger.warn(
            '[TRAFFIC-ROUTING] shadow not promotable session=%s route=%s reason=%s',
            session.id,
            routeDecision.route,
            promotability.reason,
          );
        }
      }
    }).catch(() => {
      // Best-effort shadow execution
    });
  }
};

const runStep = async (
  session: AgentSession,
  step: AgentStep,
  skillId: SkillId,
  buildInput: (priorOutput?: string) => string,
  priorOutput?: string,
): Promise<string> => {
  if (session.cancelRequested) {
    step.status = 'cancelled';
    step.startedAt = step.startedAt || nowIso();
    step.endedAt = nowIso();
    touch(session);
    throw new Error('SESSION_CANCELLED');
  }

  step.status = 'running';
  step.startedAt = nowIso();
  touch(session);

  try {
    const result = await withTimeout(executeSkill(skillId, {
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      actionName: `skill.${String(skillId || '').replace(/\s+/g, '_')}`,
      goal: buildInput(priorOutput),
      memoryHints: session.memoryHints,
      priorOutput,
    }), AGENT_STEP_TIMEOUT_MS, `STEP_TIMEOUT:${step.role}`);

    const output = result.output;
    if (session.cancelRequested) {
      step.status = 'cancelled';
      step.endedAt = nowIso();
      touch(session);
      throw new Error('SESSION_CANCELLED');
    }

    appendShadowOutcomes(session, result.outcomes);

    step.status = 'completed';
    step.endedAt = nowIso();
    step.output = String(output || '').trim();
    touch(session);
    return step.output;
  } catch (error) {
    step.status = 'failed';
    step.endedAt = nowIso();
    step.error = getErrorMessage(error);
    touch(session);
    throw error;
  }
};

type CompiledPrompt = ReturnType<typeof runCompilePromptNode>;

const runSessionIntentClassification = async (params: {
  session: AgentSession;
  taskGoal: string;
  compiledPrompt: CompiledPrompt;
  sessionStartedAtMs: number;
}): Promise<{ intentHints: string[] }> => {
  const { session, taskGoal, compiledPrompt, sessionStartedAtMs } = params;

  ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
  const intentHints = await withTimeout(buildAgentMemoryHints({
    guildId: session.guildId,
    goal: taskGoal,
    maxItems: 4,
    requesterUserId: session.requestedBy,
  }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_HINT_TIMEOUT').catch((): string[] => []);

  const outcomes = getRecentSessionOutcomes(session.guildId);
  const recentFailures = outcomes.filter((entry) => entry.status === 'failed' && entry.error);
  if (recentFailures.length > 0) {
    intentHints.push(
      ...recentFailures.slice(0, 2).map((entry) => `[최근 실패] "${entry.goalSnippet}" → ${String(entry.error).slice(0, 80)}`),
    );
  }

  const intentSignals = await withTimeout(enrichIntentSignals({
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    goal: taskGoal,
    compiledPrompt,
    memoryHints: intentHints,
  }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_ENRICHMENT_TIMEOUT').catch(() => null);

  const intentClassification = await runClassifyIntentNode({
    goal: compiledPrompt.normalizedGoal || taskGoal,
    requestedSkillId: session.requestedSkillId,
    intentHints,
    signals: intentSignals,
    guildId: session.guildId,
  });

  session.routedIntent = intentClassification.legacyIntent;
  session.intentClassification = intentClassification;

  void persistIntentExemplar({
    guildId: session.guildId,
    message: compiledPrompt.normalizedGoal || taskGoal,
    signalSnapshot: intentSignals ? {
      intentTags: intentSignals.compiledPrompt.intentTags,
      graphClusterHint: intentSignals.graphClusterHint,
      graphNeighborTags: intentSignals.graphNeighborTags.slice(0, 5),
      turnPosition: intentSignals.turnPosition,
    } : {},
    classification: intentClassification,
    sessionId: session.id,
  });

  session.shadowGraph = {
    ...ensureShadowGraph(session),
    intent: session.routedIntent,
  };
  traceShadowNode(
    session,
    'route_intent',
    `${intentClassification.primary}(${intentClassification.confidence.toFixed(2)})→${session.routedIntent}|src=${intentClassification.source}`,
  );

  return { intentHints };
};

const applySessionPolicyTransition = (params: {
  session: AgentSession;
  taskGoal: string;
}) => {
  const { session, taskGoal } = params;
  const policyTransition = runTaskPolicyGateTransitionNode({
    routedIntent: session.routedIntent,
    guildId: session.guildId,
    taskGoal,
    evaluateGate: runPolicyGateNode,
    buildPolicyBlockMessage,
  });

  session.deliberationMode = policyTransition.deliberationMode;
  session.riskScore = policyTransition.riskScore;
  session.policyGate = {
    decision: policyTransition.policyGate.decision,
    reasons: [...policyTransition.policyGate.reasons],
  };
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    policyDecision: policyTransition.policyGate.decision,
  };
  traceShadowNode(session, 'policy_gate', policyTransition.traceNote);
  if (policyTransition.privacySample) {
    void recordPrivacyGateSample({
      guildId: session.guildId,
      sessionId: session.id,
      mode: policyTransition.privacySample.mode,
      decision: policyTransition.privacySample.decision,
      riskScore: policyTransition.privacySample.riskScore,
      reasons: policyTransition.privacySample.reasons,
      goal: policyTransition.privacySample.goal,
    });
  }

  return policyTransition;
};

const applySessionExecutionStrategy = (params: {
  session: AgentSession;
  selection: ReturnType<typeof runSelectExecutionStrategyNode>;
}) => {
  const { session, selection } = params;
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    executionStrategy: selection.strategy,
    policyDecision: session.policyGate?.decision || null,
  };
  traceShadowNode(session, 'select_execution_strategy', selection.traceNote);
};

const maybeCompleteNonTaskSession = async (params: {
  session: AgentSession;
  intentHints: string[];
}): Promise<AgentSessionStatus | null> => {
  const { session, intentHints } = params;
  const recentTurns = session.routedIntent === 'casual_chat'
    ? await fetchRecentTurnsForUser({ guildId: session.guildId, requestedBy: session.requestedBy, limit: 4 }).catch(() => [])
    : [];

  const nonTaskOutcome = await runNonTaskIntentNode({
    routedIntent: session.routedIntent,
    goal: session.goal,
    intentHints,
    recentTurns,
    generateCasualReply: generateCasualChatResult,
    generateClarification: generateIntentClarificationResult,
  });
  if (!nonTaskOutcome) {
    return null;
  }

  const timestamp = nowIso();
  cancelAllPendingSteps(session, timestamp);
  traceShadowNode(session, 'compose_response', nonTaskOutcome.traceNote);
  markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: nonTaskOutcome.result,
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};

const executeSessionWithMainPipeline = async (
  session: AgentSession,
  sessionStartedAtMs: number,
): Promise<AgentSessionStatus> => {
  traceShadowNode(session, 'ingest', `priority=${session.priority}`);

  const compiledPrompt = runCompilePromptNode(session.goal);
  const taskGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || session.goal;
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    compiledPrompt,
    executionGoal: taskGoal,
  };
  traceShadowNode(
    session,
    'compile_prompt',
    compiledPrompt.directives.length > 0 || compiledPrompt.intentTags.length > 0 ? 'structured_directive' : 'plain_goal',
  );

  const { intentHints } = await runSessionIntentClassification({
    session,
    taskGoal,
    compiledPrompt,
    sessionStartedAtMs,
  });

  const policyTransition = applySessionPolicyTransition({
    session,
    taskGoal,
  });
  if (policyTransition.shouldBlock && policyTransition.blockResult) {
    const timestamp = nowIso();
    cancelAllPendingSteps(session, timestamp);
    markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: policyTransition.blockResult,
      error: null,
    });
    return session.cancelRequested ? 'cancelled' : 'completed';
  }

  touch(session);

  ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
  const nonTaskStatus = await maybeCompleteNonTaskSession({ session, intentHints });
  if (nonTaskStatus) {
    return nonTaskStatus;
  }

  ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
  const hydrateMemory = await runHydrateMemoryNode({
    guildId: session.guildId,
    goal: taskGoal,
    priority: session.priority,
    requestedBy: session.requestedBy,
    loadHints: (input) => withTimeout(buildAgentMemoryHints(input), AGENT_MEMORY_HINT_TIMEOUT_MS, 'MEMORY_HINT_TIMEOUT').catch(() => []),
  });
  session.memoryHints = hydrateMemory.memoryHints;
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    memoryHints: [...session.memoryHints],
  };
  traceShadowNode(session, 'hydrate_memory', `count=${session.memoryHints.length}`);
  touch(session);

  const planner = session.steps[0];
  const researcher = session.steps[1];
  const critic = session.steps[2];

  const strategySelection = runSelectExecutionStrategyNode({
    requestedSkillId: session.requestedSkillId,
    priority: session.priority,
    forceFullReview: session.policyGate?.decision === 'review',
  });
  applySessionExecutionStrategy({
    session,
    selection: strategySelection,
  });

  return executeSessionBranchRuntime({
    strategy: strategySelection.strategy,
    session,
    sessionStartedAtMs,
    taskGoal,
    planner,
    researcher,
    critic,
    dependencies: buildBranchRuntimeDependencies(),
    constants: buildBranchRuntimeConstants(),
  });
};

type PrimaryLangGraphRuntimeContext = {
  session: AgentSession;
  sessionStartedAtMs: number;
  taskGoal: string;
  intentHints: string[];
  planner: AgentStep;
  researcher: AgentStep;
  critic: AgentStep;
  totPolicy: AgentTotPolicySnapshot | null;
  gotPolicy: AgentGotPolicySnapshot | null;
  gotCutoverAllowed: boolean;
};

const PRIMARY_LANGGRAPH_MAX_STEPS = 20;

const executeSessionWithLangGraphPrimary = async (
  session: AgentSession,
  sessionStartedAtMs: number,
): Promise<AgentSessionStatus> => {
  const planner = session.steps[0];
  const researcher = session.steps[1];
  const critic = session.steps[2];
  const context: PrimaryLangGraphRuntimeContext = {
    session,
    sessionStartedAtMs,
    taskGoal: session.goal,
    intentHints: [],
    planner,
    researcher,
    critic,
    totPolicy: null,
    gotPolicy: null,
    gotCutoverAllowed: false,
  };

  const branchDependencies = buildBranchRuntimeDependencies();
  const branchConstants = buildBranchRuntimeConstants();

  const completeGraphTaskSession = (rawResult: string, traceLabel: string) => {
    markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: finalizeTaskResult({
        session,
        taskGoal: context.taskGoal,
        rawResult,
        traceLabel,
      }),
      error: null,
    });
    return session.cancelRequested ? 'cancelled' : 'completed';
  };

  const handlers: Record<LangGraphNodeId, LangGraphNodeHandler<PrimaryLangGraphRuntimeContext>> = {
    ingest: async () => {
      traceShadowNode(session, 'ingest', `priority=${session.priority}`);
      return ensureShadowGraph(session);
    },
    compile_prompt: async () => {
      const compiledPrompt = runCompilePromptNode(session.goal);
      context.taskGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || session.goal;
      session.shadowGraph = {
        ...ensureShadowGraph(session),
        compiledPrompt,
        executionGoal: context.taskGoal,
      };
      traceShadowNode(
        session,
        'compile_prompt',
        compiledPrompt.directives.length > 0 || compiledPrompt.intentTags.length > 0 ? 'structured_directive' : 'plain_goal',
      );
      return ensureShadowGraph(session);
    },
    route_intent: async ({ state }) => {
      const compiledPrompt = state.compiledPrompt || runCompilePromptNode(session.goal);
      const { intentHints } = await runSessionIntentClassification({
        session,
        taskGoal: context.taskGoal,
        compiledPrompt,
        sessionStartedAtMs,
      });
      context.intentHints = intentHints;
      return ensureShadowGraph(session);
    },
    select_execution_strategy: async () => {
      const selection = runSelectExecutionStrategyNode({
        requestedSkillId: session.requestedSkillId,
        priority: session.priority,
        forceFullReview: session.policyGate?.decision === 'review',
      });
      applySessionExecutionStrategy({
        session,
        selection,
      });
      return ensureShadowGraph(session);
    },
    hydrate_memory: async () => {
      const hydrateMemory = await runHydrateMemoryNode({
        guildId: session.guildId,
        goal: context.taskGoal,
        priority: session.priority,
        requestedBy: session.requestedBy,
        loadHints: (input) => withTimeout(buildAgentMemoryHints(input), AGENT_MEMORY_HINT_TIMEOUT_MS, 'MEMORY_HINT_TIMEOUT').catch(() => []),
      });
      session.memoryHints = hydrateMemory.memoryHints;
      session.shadowGraph = {
        ...ensureShadowGraph(session),
        memoryHints: [...session.memoryHints],
      };
      traceShadowNode(session, 'hydrate_memory', `count=${session.memoryHints.length}`);
      touch(session);
      return ensureShadowGraph(session);
    },
    plan_actions: async ({ state }) => state,
    execute_actions: async ({ state }) => state,
    critic_review: async ({ state }) => state,
    requested_skill_run: async ({ state }) => {
      if (!session.requestedSkillId) {
        throw new Error('REQUESTED_SKILL_BRANCH_UNAVAILABLE');
      }

      ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
      traceShadowNode(session, 'requested_skill_run', `requested_skill=${session.requestedSkillId}`);
      const singleResult = await runStep(
        session,
        context.planner,
        session.requestedSkillId,
        () => context.taskGoal,
        undefined,
      );

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        executionDraft: singleResult,
      };
      return ensureShadowGraph(session);
    },
    requested_skill_refine: async ({ state }) => {
      const refinedResult = await runSelfRefineLite({
        session,
        taskGoal: context.taskGoal,
        currentDraft: state.executionDraft || '',
        sessionStartedAtMs,
        traceLabel: 'single_skill',
      });

      traceShadowNode(session, 'requested_skill_refine', session.requestedSkillId || 'requested_skill');
      session.shadowGraph = {
        ...ensureShadowGraph(session),
        finalCandidate: refinedResult,
        selectedFinalRaw: refinedResult,
      };
      return ensureShadowGraph(session);
    },
    fast_path_run: async ({ state }) => {
      ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
      traceShadowNode(session, 'fast_path_run', 'fast_path');
      const fastDraft = await runStep(session, context.researcher, 'ops-execution', () => [
        '우선순위: 빠름',
        '요구사항: 중간 과정 없이 최종 결과물만 제시',
        `목표: ${context.taskGoal}`,
        '출력: 바로 사용할 수 있는 결과물 텍스트',
      ].join('\n'), undefined);

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        executionDraft: fastDraft,
      };
      return ensureShadowGraph(session);
    },
    fast_path_refine: async ({ state }) => {
      const fastRefined = await runSelfRefineLite({
        session,
        taskGoal: context.taskGoal,
        currentDraft: state.executionDraft || '',
        sessionStartedAtMs,
        traceLabel: 'fast_path',
      });

      traceShadowNode(session, 'fast_path_refine', 'fast_path');
      session.shadowGraph = {
        ...ensureShadowGraph(session),
        finalCandidate: fastRefined,
        selectedFinalRaw: fastRefined,
      };
      return ensureShadowGraph(session);
    },
    full_review_plan: async ({ state }) => {
      const planTask = await runPlanTaskNode({
        session,
        planner: context.planner,
        taskGoal: context.taskGoal,
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
      });

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        planText: planTask.plan,
        subgoals: [...planTask.subgoals],
        plans: [
          ...ensureShadowGraph(session).plans,
          {
            actionName: 'ops-plan',
            args: { goal: context.taskGoal },
            reason: String(planTask.plan || '').slice(0, 300),
          },
        ],
      };
      traceShadowNode(session, 'full_review_plan', `subgoals=${planTask.subgoals.length}`);
      return ensureShadowGraph(session);
    },
    full_review_execute: async ({ state }) => {
      const executionDraft = await runResearchTaskNode({
        session,
        researcher: context.researcher,
        taskGoal: context.taskGoal,
        plan: state.planText || '',
        subgoals: state.subgoals || [],
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
      });

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        executionDraft,
      };
      traceShadowNode(session, 'full_review_execute', 'researcher_execution');
      return ensureShadowGraph(session);
    },
    full_review_critique: async ({ state }) => {
      const critique = await runCriticReviewNode({
        session,
        critic: context.critic,
        taskGoal: context.taskGoal,
        executionDraft: state.executionDraft || '',
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
      });

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        critiqueText: critique,
      };
      traceShadowNode(session, 'full_review_critique', 'ops-critique');
      return ensureShadowGraph(session);
    },
    full_review_tot: async ({ state }) => {
      const totPolicy = getAgentTotPolicySnapshot(session.guildId) as AgentTotPolicySnapshot;
      const gotPolicy = getAgentGotPolicySnapshot(session.guildId) as AgentGotPolicySnapshot;
      const gotCutoverDecision = gotPolicy.activeEnabled
        ? await getAgentGotCutoverDecision({ guildId: session.guildId, sessionId: session.id })
        : {
          guildId: session.guildId,
          allowed: false,
          readinessRecommended: false,
          rolloutPercentage: 0,
          selectedByRollout: false,
          reason: 'got_active_disabled_by_policy',
          failedReasons: ['got_active_disabled_by_policy'],
          evaluatedAt: new Date().toISOString(),
          windowDays: 14,
        };

      context.totPolicy = totPolicy;
      context.gotPolicy = gotPolicy;
      context.gotCutoverAllowed = gotCutoverDecision.allowed;

      traceShadowNode(
        session,
        'full_review_tot',
        `got_cutover:allowed=${gotCutoverDecision.allowed},reason=${gotCutoverDecision.reason}`,
      );

      let totShadowBest: TotShadowBest | null = null;
      if (!session.cancelRequested) {
        totShadowBest = await runToTShadowExploration({
          session,
          policy: totPolicy,
          gotPolicy,
          taskGoal: context.taskGoal,
          plan: state.planText || '',
          executionDraft: state.executionDraft || '',
          critique: state.critiqueText || '',
          sessionStartedAtMs,
        });
      }

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        totShadowBest,
      };
      return ensureShadowGraph(session);
    },
    policy_gate: async ({ state }) => {
      const policyTransition = applySessionPolicyTransition({
        session,
        taskGoal: context.taskGoal,
      });
      if (policyTransition.shouldBlock && policyTransition.blockResult) {
        const timestamp = nowIso();
        cancelAllPendingSteps(session, timestamp);
        markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
          result: policyTransition.blockResult,
          error: null,
        });
        return {
          ...state,
          finalText: policyTransition.blockResult,
        };
      }

      touch(session);
      return ensureShadowGraph(session);
    },
    hitl_review: async ({ state }) => {
      if (!shouldPauseForHitlReview(session)) {
        traceShadowNode(session, 'hitl_review', 'skipped');
        return state;
      }

      if (session.hitlState?.awaitingInput || !session.hitlState?.decision) {
        const prompt = buildHitlReviewPrompt(session, context.taskGoal);
        traceShadowNode(session, 'hitl_review', 'awaiting_input');
        pauseSessionForHitl({
          session,
          gateNode: 'hitl_review',
          prompt,
        });
        return ensureShadowGraph(session);
      }

      const decision = session.hitlState.decision;
      traceShadowNode(session, 'hitl_review', `decision=${decision}`);

      if (decision === 'reject') {
        const note = String(session.hitlState.note || '').trim();
        const rejectionText = note
          ? `사람 검토 결과 자동 완료가 보류되었습니다.\n\n추가 지시: ${note}`
          : '사람 검토 결과 자동 완료가 보류되었습니다.';
        session.shadowGraph = {
          ...ensureShadowGraph(session),
          finalCandidate: rejectionText,
          selectedFinalRaw: rejectionText,
        };
        return ensureShadowGraph(session);
      }

      if (decision === 'revise' && session.hitlState.note) {
        session.shadowGraph = {
          ...ensureShadowGraph(session),
          critiqueText: [state.critiqueText || '', `추가 인간 검토 지시: ${session.hitlState.note}`]
            .filter(Boolean)
            .join('\n\n'),
        };
      }

      return ensureShadowGraph(session);
    },
    full_review_compose: async ({ state }) => {
      const composeNode = await runComposeFinalNode({
        session,
        taskGoal: context.taskGoal,
        plan: state.planText || '',
        critique: state.critiqueText || '',
        executionDraft: state.executionDraft || '',
        researcher: context.researcher,
        sessionStartedAtMs,
        sessionTimeoutMs: branchConstants.sessionTimeoutMs,
        stepTimeoutMs: branchConstants.stepTimeoutMs,
        dependencies: branchDependencies,
        ensureSessionBudget,
      });

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        finalCandidate: composeNode.finalRefined,
      };
      traceShadowNode(session, 'full_review_compose', 'final_output');
      return ensureShadowGraph(session);
    },
    full_review_promote: async ({ state }) => {
      const promotionNode = await runPromoteBestCandidateNode({
        session,
        taskGoal: context.taskGoal,
        finalRefined: state.finalCandidate || '',
        totShadowBest: state.totShadowBest || null,
        gotCutoverAllowed: context.gotCutoverAllowed,
        gotPolicy: context.gotPolicy || { minSelectedScore: 0 },
        totPolicy: context.totPolicy || {
          activeEnabled: false,
          activeAllowFast: false,
          activeMinGoalLength: 0,
          activeRequireNonPass: false,
          activeMinScoreGain: 0,
          activeMinBeamGain: 0,
          strategy: 'disabled',
        },
        ormPassThreshold: branchConstants.ormPassThreshold,
        ormReviewThreshold: branchConstants.ormReviewThreshold,
        totCandidatePairRecordTask: branchConstants.totCandidatePairRecordTask,
        dependencies: branchDependencies,
      });

      session.shadowGraph = {
        ...ensureShadowGraph(session),
        selectedFinalRaw: promotionNode.selectedFinalRaw,
      };
      traceShadowNode(session, 'full_review_promote', 'selected_candidate');
      return ensureShadowGraph(session);
    },
    compose_response: async ({ state }) => {
      if (session.routedIntent !== 'task') {
        const terminalStatus = await maybeCompleteNonTaskSession({
          session,
          intentHints: context.intentHints,
        });
        return {
          ...state,
          finalText: terminalStatus ? (session.result || state.finalText) : state.finalText,
          errorCode: terminalStatus && session.error ? session.error : state.errorCode,
        };
      }

      const finalRaw = state.selectedFinalRaw || state.finalCandidate || state.finalText;
      if (!String(finalRaw || '').trim()) {
        throw new Error('LANGGRAPH_PRIMARY_RESULT_MISSING');
      }

      const traceLabel = state.executionStrategy === 'requested_skill'
        ? 'single_skill'
        : state.executionStrategy === 'fast_path'
          ? 'fast_path'
          : 'final_output';
      completeGraphTaskSession(String(finalRaw), traceLabel);
      return {
        ...state,
        finalText: session.result,
        selectedFinalRaw: String(finalRaw),
      };
    },
    persist_and_emit: async ({ state }) => state,
  };

  const initialNode = session.graphCheckpoint?.resumable
    ? (session.graphCheckpoint.nextNode || session.graphCheckpoint.currentNode || 'ingest')
    : 'ingest';
  const initialState = session.graphCheckpoint?.state
    ? cloneLangGraphState(session.graphCheckpoint.state)
    : ensureShadowGraph(session);
  session.shadowGraph = cloneLangGraphState(initialState);

  await executeLangGraphWithLangGraphJs({
    initialNode,
    initialState,
    handlers,
    resolveNext: ({ from, context: graphContext }) => {
      if (isTerminalStatus(graphContext.session.status)) {
        return null;
      }

      switch (from) {
        case 'ingest':
          return 'compile_prompt';
        case 'compile_prompt':
          return 'route_intent';
        case 'route_intent':
          return 'policy_gate';
        case 'policy_gate':
          return graphContext.session.routedIntent === 'task' ? 'hydrate_memory' : 'compose_response';
        case 'hydrate_memory':
          return 'select_execution_strategy';
        case 'select_execution_strategy': {
          const strategy = ensureShadowGraph(graphContext.session).executionStrategy || 'full_review';
          if (strategy === 'requested_skill') {
            return 'requested_skill_run';
          }
          if (strategy === 'fast_path') {
            return 'fast_path_run';
          }
          return 'full_review_plan';
        }
        case 'requested_skill_run':
          return 'requested_skill_refine';
        case 'requested_skill_refine':
          return 'compose_response';
        case 'fast_path_run':
          return 'fast_path_refine';
        case 'fast_path_refine':
          return 'compose_response';
        case 'full_review_plan':
          return 'full_review_execute';
        case 'full_review_execute':
          return 'full_review_critique';
        case 'full_review_critique':
          return 'full_review_tot';
        case 'full_review_tot':
          return 'hitl_review';
        case 'hitl_review':
          if (graphContext.session.hitlState?.awaitingInput) {
            return null;
          }
          if (graphContext.session.hitlState?.decision === 'reject') {
            return 'compose_response';
          }
          return 'full_review_compose';
        case 'full_review_compose':
          return 'full_review_promote';
        case 'full_review_promote':
          return 'compose_response';
        default:
          return null;
      }
    },
    options: {
      context,
      maxSteps: PRIMARY_LANGGRAPH_MAX_STEPS,
      onTransition: ({ from, to, state }) => {
        if (isTerminalStatus(session.status)) {
          return;
        }

        const pausedForHitl = session.hitlState?.awaitingInput === true;
        const checkpointReason = pausedForHitl
          ? 'hitl_pause'
          : from === 'hitl_review' && session.hitlState?.decision
            ? 'resume_request'
            : 'transition';
        persistSessionCheckpoint({
          session,
          currentNode: from,
          nextNode: pausedForHitl ? from : to,
          state,
          reason: checkpointReason,
        });
      },
    },
  });

  if (session.hitlState?.awaitingInput) {
    return 'queued';
  }

  if (!isTerminalStatus(session.status)) {
    throw new Error('LANGGRAPH_PRIMARY_DID_NOT_TERMINATE');
  }

  return session.status;
};

const canFallbackToMainPipeline = (session: AgentSession): boolean => {
  return session.steps.every((step) => step.status === 'pending' || step.status === 'cancelled');
};

const applyLangGraphPrimaryFallback = (
  session: AgentSession,
  error: unknown,
): void => {
  const fallbackError = getErrorMessage(error);
  const priorDecision = session.trafficRoutingDecision;
  const fallbackDecision: TrafficRoutingDecision = priorDecision
    ? {
      ...priorDecision,
      route: 'main',
      reason: `langgraph_primary_fallback:${fallbackError}`,
      policySnapshot: {
        ...priorDecision.policySnapshot,
        requestedRoute: priorDecision.route,
        fallbackError,
      },
    }
    : {
      route: 'main',
      reason: `langgraph_primary_fallback:${fallbackError}`,
      gotCutoverAllowed: false,
      rolloutPercentage: 0,
      stableBucket: 0,
      shadowDivergenceRate: null,
      shadowQualityDelta: null,
      readinessRecommended: false,
      policySnapshot: {
        fallbackError,
      },
    };

  applyTrafficRoutingDecisionToSession(session, fallbackDecision);
  session.shadowGraph = null;
  session.memoryHints = [];
  touch(session);
  void persistAgentSession(cloneSession(session));
};

const executeSession = async (sessionId: string): Promise<AgentSessionStatus> => {
  const session = getSession(sessionId);
  if (!session) {
    return 'failed';
  }

  session.status = 'running';
  session.startedAt = nowIso();
  touch(session);
  void persistAgentSession(cloneSession(session));
  const sessionStartedAtMs = Date.now();

  try {
    const routeDecision = isResumableLangGraphSession(session)
      ? session.trafficRoutingDecision || null
      : await resolveSessionTrafficRoute(session);
    const requestedRoute = routeDecision?.route || (session.trafficRoute || 'main');
    if (requestedRoute === 'langgraph') {
      try {
        return await executeSessionWithLangGraphPrimary(session, sessionStartedAtMs);
      } catch (error) {
        if (!canFallbackToMainPipeline(session) || session.cancelRequested) {
          throw error;
        }

        logger.warn(
          '[AGENT] langgraph primary failed session=%s, falling back to main: %s',
          session.id,
          getErrorMessage(error),
        );
        applyLangGraphPrimaryFallback(session, error);
      }
    }

    return await executeSessionWithMainPipeline(session, sessionStartedAtMs);
  } catch (error) {
    if (session.cancelRequested || getErrorMessage(error) === 'SESSION_CANCELLED') {
      markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
      return 'cancelled';
    }

    if (getErrorMessage(error) === 'SESSION_TIMEOUT') {
      markSessionTerminal(session, 'failed', { error: '처리 시간이 길어져 세션을 종료했습니다. 요청 범위를 줄여 다시 시도해주세요.' });
      return 'failed';
    }

    if (getErrorMessage(error).startsWith('STEP_TIMEOUT:')) {
      const role = getErrorMessage(error).split(':')[1] || 'unknown';
      markSessionTerminal(session, 'failed', { error: `단계 처리 시간이 초과되었습니다(${role}). 잠시 후 다시 시도해주세요.` });
      return 'failed';
    }

    const rawMsg = getErrorMessage(error);
    const isNetworkError = /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|socket hang up/i.test(rawMsg)
      || rawMsg === 'LLM_REQUEST_FAILED'
      || rawMsg === 'LLM_PROVIDER_CHAIN_TIMEOUT'
      || rawMsg === 'LLM_PROVIDER_NOT_CONFIGURED';
    const userError = isNetworkError
      ? 'AI 서비스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.'
      : rawMsg;
    markSessionTerminal(session, 'failed', { error: userError });
    return 'failed';
  }
};

const requeueForRetry = (session: AgentSession) => {
  const privacyPolicy = getAgentPrivacyPolicySnapshot(session.guildId);
  session.status = 'queued';
  session.startedAt = null;
  session.endedAt = null;
  session.result = null;
  session.cancelRequested = false;
  session.trafficRoute = 'main';
  session.trafficRoutingDecision = null;
  session.trafficRouteResolvedAt = null;
  session.executionEngine = 'main';
  session.graphCheckpoint = null;
  session.hitlState = null;
  session.deliberationMode = privacyPolicy.modeDefault;
  session.riskScore = privacyPolicy.modeDefault === 'guarded' ? 55 : 0;
  session.policyGate = privacyPolicy.modeDefault === 'guarded'
    ? { decision: 'review', reasons: ['privacy_guarded_default'] }
    : { decision: 'allow', reasons: ['legacy_default'] };
  session.steps = buildInitialSteps(session.guildId, session.requestedSkillId, session.priority, nowIso());
  session.shadowGraph = null;
  touch(session);
  void persistAgentSession(cloneSession(session));
  queueRuntime.enqueueSession(session.id);
};

const scheduleQueueDrain = () => {
  queueRuntime.scheduleDrain({
    pollMs: AGENT_QUEUE_POLL_MS,
    maxAttempts: AGENT_SESSION_MAX_ATTEMPTS,
    maxDeadletters: AGENT_DEADLETTER_MAX,
    nowIso,
    getMaxConcurrent: () => Math.max(1, getAgentPolicySnapshot().maxConcurrentSessions),
    getSession: (sessionId) => sessions.get(sessionId),
    executeSession,
    markCancelled: (session) => {
      markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
    },
    requeueForRetry,
  });
};

const pruneSessions = () => {
  if (sessions.size <= MAX_SESSION_HISTORY) {
    return;
  }

  const ordered = [...sessions.values()]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  const removeCount = sessions.size - MAX_SESSION_HISTORY;
  for (let i = 0; i < removeCount; i += 1) {
    sessions.delete(ordered[i].id);
  }
};

export const startAgentSession = (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  skillId?: string | null;
  priority?: string | null;
  isAdmin?: boolean;
}) => {
  if (!isAnyLlmConfigured()) {
    throw new Error('LLM provider is not configured. Configure OPENAI/GEMINI/ANTHROPIC/HUGGINGFACE/OPENCLAW/OLLAMA provider.');
  }

  const requestedSkillId = params.skillId && isSkillId(params.skillId)
    ? params.skillId
    : null;
  const privacyPolicy = getAgentPrivacyPolicySnapshot(params.guildId);
  const priority = toPriority(params.priority);
  primeAgentPolicyCache();
  primeAgentPrivacyPolicyCache();
  primeWorkflowProfileCache();
  primeAgentTotPolicyCache();
  primeAgentGotPolicyCache();

  if (queueRuntime.getQueuedCount() >= AGENT_MAX_QUEUE_SIZE) {
    throw new Error(`대기열이 가득 찼습니다. 잠시 후 다시 시도해주세요. (max=${AGENT_MAX_QUEUE_SIZE})`);
  }

  const policy = validateAgentSessionRequest({
    guildId: params.guildId,
    runningSessions: queueRuntime.getRunningCount(),
    goal: params.goal,
    requestedSkillId,
    isAdmin: params.isAdmin === true,
  });

  if (!policy.ok) {
    throw new Error(policy.message);
  }

  const sessionId = crypto.randomUUID();
  const timestamp = nowIso();
  const session: AgentSession = {
    id: sessionId,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal.trim(),
    conversationThreadId: null,
    conversationTurnIndex: null,
    priority,
    requestedSkillId,
    routedIntent: 'task',
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    cancelRequested: false,
    trafficRoute: 'main',
    trafficRoutingDecision: null,
    trafficRouteResolvedAt: null,
    executionEngine: 'main',
    graphCheckpoint: null,
    hitlState: null,
    deliberationMode: privacyPolicy.modeDefault,
    riskScore: privacyPolicy.modeDefault === 'guarded' ? 55 : 0,
    policyGate: privacyPolicy.modeDefault === 'guarded'
      ? { decision: 'review', reasons: ['privacy_guarded_default'] }
      : { decision: 'allow', reasons: ['legacy_default'] },
    memoryHints: [],
    steps: buildInitialSteps(params.guildId, requestedSkillId, priority, timestamp),
    shadowGraph: null,
  };

  sessions.set(session.id, session);
  pruneSessions();
  void persistAgentSession(cloneSession(session));
  void bindSessionUserTurn({
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    sessionId: session.id,
    goal: session.goal,
    sourceChannel: requestedSkillId ? 'agent' : 'vibe',
  }).then((turn) => {
    if (!turn) {
      return;
    }
    const target = sessions.get(session.id);
    if (!target) {
      return;
    }
    target.conversationThreadId = turn.threadId;
    target.conversationTurnIndex = turn.turnIndex;
    touch(target);
    void persistAgentSession(cloneSession(target));
  }).catch(() => {
    // Best-effort turn logging.
  });
  queueRuntime.enqueueSession(session.id);
  scheduleQueueDrain();
  return cloneSession(session);
};

export const cancelAgentSession = (sessionId: string): { ok: boolean; message: string } => {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '세션을 찾을 수 없습니다.' };
  }

  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return { ok: false, message: `이미 종료된 세션입니다: ${session.status}` };
  }

  session.cancelRequested = true;
  if (session.status === 'queued') {
    queueRuntime.removeFromQueue(sessionId);
    markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
    return { ok: true, message: '대기열에서 중지했습니다.' };
  }

  touch(session);
  return { ok: true, message: '중지 요청을 수락했습니다.' };
};

export const resumeAgentSession = (params: {
  sessionId: string;
  decision?: AgentSessionHitlDecision | null;
  note?: string | null;
}): { ok: boolean; message: string } => {
  const session = sessions.get(params.sessionId);
  if (!session) {
    return { ok: false, message: '세션을 찾을 수 없습니다.' };
  }

  if (isTerminalStatus(session.status)) {
    return { ok: false, message: `이미 종료된 세션입니다: ${session.status}` };
  }

  if (!session.graphCheckpoint?.resumable) {
    return { ok: false, message: '재개 가능한 체크포인트가 없습니다.' };
  }

  if (session.status === 'running') {
    return { ok: false, message: '현재 실행 중인 세션은 재개할 수 없습니다.' };
  }

  if (session.hitlState?.awaitingInput) {
    const decision = params.decision || 'approve';
    session.hitlState = {
      ...session.hitlState,
      awaitingInput: false,
      decision,
      note: params.note ? String(params.note).trim() : null,
      resumedAt: nowIso(),
    };
  }

  session.status = 'queued';
  session.error = null;
  session.result = null;
  touch(session);
  void persistAgentSession(cloneSession(session));
  queueRuntime.enqueueSession(session.id);
  scheduleQueueDrain();
  return { ok: true, message: '세션 재개를 요청했습니다.' };
};

export const getAgentSession = (sessionId: string): AgentSession | null => {
  const session = sessions.get(sessionId);
  return session ? cloneSession(session) : null;
};

export const listGuildAgentSessions = (guildId: string, limit = 10): AgentSession[] => {
  const size = Math.max(1, Math.min(50, Math.trunc(limit)));
  return [...sessions.values()]
    .filter((session) => session.guildId === guildId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, size)
    .map((session) => cloneSession(session));
};

export const listAgentDeadletters = (params?: { guildId?: string; limit?: number }) => {
  return queueRuntime.listDeadletters(params);
};

// Session API serialization — extracted to sessionApiSerializer.ts
export { serializeAgentSessionForApi } from './sessionApiSerializer';

export const getMultiAgentRuntimeSnapshot = (): AgentRuntimeSnapshot => {
  const all = [...sessions.values()];
  const latest = all
    .map((session) => session.updatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    totalSessions: all.length,
    runningSessions: queueRuntime.getRunningCount(),
    queuedSessions: queueRuntime.getQueuedCount(),
    completedSessions: all.filter((session) => session.status === 'completed').length,
    failedSessions: all.filter((session) => session.status === 'failed').length,
    cancelledSessions: all.filter((session) => session.status === 'cancelled').length,
    deadletteredSessions: queueRuntime.getDeadletterCount(),
    latestSessionAt: latest,
  };
};

export const listAgentSkills = () => listSkills();

export const getAgentPolicy = () => getAgentPolicySnapshot();

// ──── Startup rehydration ──────────────────────────────────────────────────────

let sessionRehydrationInFlight: Promise<number> | null = null;

export const rehydrateActiveSessions = async (): Promise<number> => {
  if (sessionRehydrationInFlight) return sessionRehydrationInFlight;
  sessionRehydrationInFlight = rehydrateActiveSessionsInner().finally(() => { sessionRehydrationInFlight = null; });
  return sessionRehydrationInFlight;
};

const rehydrateActiveSessionsInner = async (): Promise<number> => {
  if (!isSupabaseConfigured()) return 0;
  try {
    const client = getSupabaseClient();
    const { data } = await client
      .from('agent_sessions')
      .select('*')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data || data.length === 0) return 0;

    // Load steps for the rehydrated sessions
    const sessionIds = (data as Array<Record<string, unknown>>).map((r) => String(r.id));
    const { data: stepRows } = await client
      .from('agent_steps')
      .select('*')
      .in('session_id', sessionIds)
      .order('updated_at', { ascending: true });
    const stepsBySession = new Map<string, AgentStep[]>();
    if (stepRows) {
      for (const row of stepRows as Array<Record<string, unknown>>) {
        const sid = String(row.session_id || '');
        const step: AgentStep = {
          id: String(row.id || ''),
          role: (row.role || 'coordinator') as AgentStep['role'],
          title: String(row.title || ''),
          status: (row.status || 'pending') as AgentStep['status'],
          startedAt: row.started_at ? String(row.started_at) : null,
          endedAt: row.ended_at ? String(row.ended_at) : null,
          output: row.output ? String(row.output) : null,
          error: row.error ? String(row.error) : null,
        };
        const arr = stepsBySession.get(sid) || [];
        arr.push(step);
        stepsBySession.set(sid, arr);
      }
    }

    let rehydrated = 0;
    for (const row of data as Array<Record<string, unknown>>) {
      const id = String(row.id || '');
      if (!id || sessions.has(id)) continue;

      const session: AgentSession = {
        id,
        guildId: String(row.guild_id || ''),
        requestedBy: String(row.requested_by || ''),
        goal: String(row.goal || ''),
        conversationThreadId: row.conversation_thread_id != null ? Number(row.conversation_thread_id) : null,
        conversationTurnIndex: row.conversation_turn_index != null ? Number(row.conversation_turn_index) : null,
        priority: (row.priority || 'balanced') as AgentSession['priority'],
        requestedSkillId: row.requested_skill_id ? String(row.requested_skill_id) as AgentSession['requestedSkillId'] : null,
        routedIntent: 'uncertain',
        status: (row.status || 'queued') as AgentSessionStatus,
        createdAt: String(row.created_at || new Date().toISOString()),
        updatedAt: String(row.updated_at || new Date().toISOString()),
        startedAt: row.started_at ? String(row.started_at) : null,
        endedAt: row.ended_at ? String(row.ended_at) : null,
        result: row.result ? String(row.result) : null,
        error: row.error ? String(row.error) : null,
        cancelRequested: false,
        trafficRoute: 'main',
        trafficRoutingDecision: null,
        trafficRouteResolvedAt: null,
        executionEngine: 'main',
        graphCheckpoint: null,
        hitlState: null,
        memoryHints: [],
        steps: stepsBySession.get(id) || [],
        shadowGraph: null,
      };

      const progressSummary = row.progress_summary && typeof row.progress_summary === 'object'
        ? row.progress_summary as Record<string, unknown>
        : null;
      const graphCheckpoint = progressSummary?.graphCheckpoint && typeof progressSummary.graphCheckpoint === 'object'
        ? progressSummary.graphCheckpoint as Record<string, unknown>
        : null;
      const hitlState = progressSummary?.hitlState && typeof progressSummary.hitlState === 'object'
        ? progressSummary.hitlState as Record<string, unknown>
        : null;

      if (progressSummary) {
        session.trafficRoute = typeof progressSummary.trafficRoute === 'string'
          ? progressSummary.trafficRoute as AgentSession['trafficRoute']
          : 'main';
        session.trafficRouteResolvedAt = typeof progressSummary.trafficRouteResolvedAt === 'string'
          ? progressSummary.trafficRouteResolvedAt
          : null;
        session.executionEngine = progressSummary.executionEngine === 'langgraphjs' ? 'langgraphjs' : 'main';
      }

      if (graphCheckpoint) {
        const checkpointState = graphCheckpoint.state && typeof graphCheckpoint.state === 'object'
          ? graphCheckpoint.state as NonNullable<AgentSession['graphCheckpoint']>['state']
          : null;
        session.graphCheckpoint = {
          currentNode: typeof graphCheckpoint.currentNode === 'string' ? graphCheckpoint.currentNode as LangGraphNodeId : null,
          nextNode: typeof graphCheckpoint.nextNode === 'string' ? graphCheckpoint.nextNode as LangGraphNodeId : null,
          savedAt: typeof graphCheckpoint.savedAt === 'string' ? graphCheckpoint.savedAt : session.updatedAt,
          reason: graphCheckpoint.reason === 'hitl_pause' || graphCheckpoint.reason === 'resume_request' ? graphCheckpoint.reason : 'transition',
          resumable: graphCheckpoint.resumable === true,
          state: checkpointState ? cloneLangGraphState(checkpointState) : null,
        };
        session.shadowGraph = session.graphCheckpoint.state ? cloneLangGraphState(session.graphCheckpoint.state) : null;
      }

      if (hitlState) {
        session.hitlState = {
          awaitingInput: hitlState.awaitingInput === true,
          gateNode: typeof hitlState.gateNode === 'string' ? hitlState.gateNode as LangGraphNodeId : null,
          prompt: typeof hitlState.prompt === 'string' ? hitlState.prompt : null,
          requestedAt: typeof hitlState.requestedAt === 'string' ? hitlState.requestedAt : null,
          resumedAt: typeof hitlState.resumedAt === 'string' ? hitlState.resumedAt : null,
          decision: hitlState.decision === 'approve' || hitlState.decision === 'reject' || hitlState.decision === 'revise'
            ? hitlState.decision
            : null,
          note: typeof hitlState.note === 'string' ? hitlState.note : null,
        };
      }

      sessions.set(id, session);
      rehydrated++;
    }

    if (rehydrated > 0) {
      logger.info('[AGENT] rehydrated %d active sessions from Supabase', rehydrated);
    }
    return rehydrated;
  } catch (error) {
    logger.warn('[AGENT] session rehydration failed: %s', getErrorMessage(error));
    return 0;
  }
};

export const __resetAgentRuntimeForTests = (): void => {
  queueRuntime.reset();
  sessions.clear();
};
