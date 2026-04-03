import crypto from 'crypto';
import logger from '../logger';
import { buildAgentMemoryHints } from './agent/agentMemoryService';
import { TtlCache } from '../utils/ttlCache';
import { getAgentPolicySnapshot, primeAgentPolicyCache, validateAgentSessionRequest } from './agent/agentPolicyService';
import { persistAgentSession } from './agent/agentSessionStore';
import { bindSessionAssistantTurn, bindSessionUserTurn, fetchRecentTurnsForUser } from './conversationTurnService';
import { isAnyLlmConfigured } from './llmClient';
import { ensureSessionBudget, getErrorMessage, withTimeout } from './langgraph/runtimeSupport/runtimeBudget';
import {
  formatCitationFirstResult,
} from './langgraph/runtimeSupport/runtimeFormatting';
import {
  assessRuleBasedOrm,
  clamp01,
  evaluateTaskResultCandidate,
  extractActionableFeedbackPoints,
  parseSelfEvaluationJson,
} from './langgraph/runtimeSupport/runtimeEvaluation';
import {
  cancelAllPendingSteps,
  cloneSession,
  ensureShadowGraph,
  touch,
  traceShadowNode,
} from './langgraph/runtimeSupport/runtimeSessionState';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillId } from './skills/types';
import { getWorkflowStepTemplates, primeWorkflowProfileCache } from './agent/agentWorkflowService';
import { appendTrace, type LangGraphNodeId, type LangGraphState } from './langgraph/stateContract';
import { executeLangGraph } from './langgraph/executor';
import { runCompilePromptNode, runPolicyGateNode, runRouteIntentNode, runClassifyIntentNode } from './langgraph/nodes/coreNodes';
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
import { isShadowRunnerEnabled, runShadowGraph, persistShadowDivergence, type ShadowRunResult } from './langgraph/shadowGraphRunner';
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

const MAX_SESSION_HISTORY = Math.max(50, Number(process.env.AGENT_MAX_SESSION_HISTORY || 300));
const AGENT_MEMORY_HINT_TIMEOUT_MS = Math.max(500, Number(process.env.AGENT_MEMORY_HINT_TIMEOUT_MS || 5_000));
const AGENT_QUEUE_POLL_MS = Math.max(100, Number(process.env.AGENT_QUEUE_POLL_MS || 250));
const AGENT_MAX_QUEUE_SIZE = Math.max(10, Number(process.env.AGENT_MAX_QUEUE_SIZE || 300));
const AGENT_SESSION_MAX_ATTEMPTS = Math.max(1, Number(process.env.AGENT_SESSION_MAX_ATTEMPTS || 1));
const AGENT_DEADLETTER_MAX = Math.max(10, Number(process.env.AGENT_DEADLETTER_MAX || 300));
const LANGGRAPH_EXECUTOR_SHADOW_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LANGGRAPH_EXECUTOR_SHADOW_ENABLED || 'false').trim());
const LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE = Math.max(0, Math.min(1, Number(process.env.LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE || 0.2) || 0.2));
const LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS = Math.max(5, Math.min(200, Number(process.env.LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS || 60) || 60));
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

const getSession = (sessionId: string): AgentSession => sessions.get(sessionId) as AgentSession;
const LANGGRAPH_NODE_IDS: LangGraphNodeId[] = [
  'ingest',
  'compile_prompt',
  'route_intent',
  'select_execution_strategy',
  'hydrate_memory',
  'plan_actions',
  'execute_actions',
  'critic_review',
  'policy_gate',
  'compose_response',
  'persist_and_emit',
];

const isLangGraphNodeId = (value: string): value is LangGraphNodeId => {
  return (LANGGRAPH_NODE_IDS as string[]).includes(value);
};

const shouldRunLangGraphExecutorShadow = (sessionId: string): boolean => {
  if (!LANGGRAPH_EXECUTOR_SHADOW_ENABLED) {
    return false;
  }
  if (LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE >= 1) {
    return true;
  }
  if (LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE <= 0) {
    return false;
  }

  const digest = crypto.createHash('sha1').update(sessionId).digest('hex').slice(0, 8);
  const bucket = Number.parseInt(digest, 16) / 0xffffffff;
  return bucket < LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE;
};

const runLangGraphExecutorShadowReplay = async (session: AgentSession, terminalStatus: AgentSessionStatus): Promise<void> => {
  if (!shouldRunLangGraphExecutorShadow(session.id)) {
    return;
  }

  const shadowGraph = session.shadowGraph;
  if (!shadowGraph || shadowGraph.trace.length === 0) {
    return;
  }

  const traceNodes = shadowGraph.trace
    .map((entry) => String(entry.node || '').trim())
    .filter(isLangGraphNodeId);
  if (traceNodes.length === 0) {
    return;
  }

  const replayNodes = traceNodes.slice(0, LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS);
  const handlers = LANGGRAPH_NODE_IDS.reduce((acc, node) => {
    acc[node] = async ({ state }) => appendTrace(state, node, 'executor_shadow_replay');
    return acc;
  }, {} as Record<LangGraphNodeId, (params: { state: LangGraphState; context: {} }) => Promise<LangGraphState>>);

  const initialState: LangGraphState = {
    ...shadowGraph,
    trace: [],
  };

  let cursor = 0;
  const startedAt = Date.now();
  try {
    const replayResult = await executeLangGraph({
      initialNode: replayNodes[0],
      initialState,
      handlers,
      resolveNext: () => {
        cursor += 1;
        return replayNodes[cursor] || null;
      },
      options: {
        context: {},
        maxSteps: replayNodes.length,
      },
    });

    const visited = replayResult.visitedNodes;
    const firstMismatch = visited.findIndex((node, index) => node !== replayNodes[index]);
    const matched = firstMismatch < 0 && visited.length === replayNodes.length;
    const elapsedMs = Date.now() - startedAt;

    if (matched) {
      logger.info(
        '[AGENT] langgraph executor shadow match session=%s status=%s nodes=%d elapsedMs=%d traceTruncated=%s',
        session.id,
        terminalStatus,
        visited.length,
        elapsedMs,
        traceNodes.length > replayNodes.length,
      );
      return;
    }

    logger.warn(
      '[AGENT] langgraph executor shadow mismatch session=%s status=%s mismatchAt=%d expected=%s actual=%s expectedNodes=%d visitedNodes=%d elapsedMs=%d',
      session.id,
      terminalStatus,
      firstMismatch,
      firstMismatch >= 0 ? replayNodes[firstMismatch] : 'n/a',
      firstMismatch >= 0 ? visited[firstMismatch] : 'n/a',
      replayNodes.length,
      visited.length,
      elapsedMs,
    );
  } catch (error) {
    logger.warn('[AGENT] langgraph executor shadow replay failed session=%s error=%s', session.id, getErrorMessage(error));
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
  touch(session);
  void persistAgentSession(cloneSession(session));

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
    logger.warn('[SESSION-CLEANUP] Intent attribution failed session=%s: %s', session.id, err instanceof Error ? err.message : String(err));
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

  void runLangGraphExecutorShadowReplay(session, status);

  // Phase-1 shadow graph: run real node handlers in parallel and log divergence
  if (isShadowRunnerEnabled()) {
    void runShadowGraph({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
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

const executeSession = async (sessionId: string): Promise<AgentSessionStatus> => {
  const session = getSession(sessionId);
  if (!session) {
    return 'failed';
  }

  traceShadowNode(session, 'ingest', `priority=${session.priority}`);
  session.status = 'running';
  session.startedAt = nowIso();
  touch(session);
  void persistAgentSession(cloneSession(session));
  const sessionStartedAtMs = Date.now();

  try {
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

    ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
    const intentHints = await withTimeout(buildAgentMemoryHints({
      guildId: session.guildId,
      goal: taskGoal,
      maxItems: 4,
      requesterUserId: session.requestedBy,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_HINT_TIMEOUT').catch((): string[] => []);

    // Inject cross-session outcome hints (recent failures in this guild)
    const outcomes = getRecentSessionOutcomes(session.guildId);
    const recentFailures = outcomes.filter((o) => o.status === 'failed' && o.error);
    if (recentFailures.length > 0) {
      intentHints.push(
        ...recentFailures.slice(0, 2).map((f) => `[최근 실패] "${f.goalSnippet}" → ${String(f.error).slice(0, 80)}`),
      );
    }

    // ── Intent Intelligence Layer (ADR-006) ──────────────────────────────
    // Enrich signals before classification (timeout-guarded to prevent session hang)
    const intentSignals = await withTimeout(enrichIntentSignals({
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      goal: taskGoal,
      compiledPrompt,
      memoryHints: intentHints,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_ENRICHMENT_TIMEOUT').catch(() => null);

    // Full 3-stage classification
    const intentClassification = await runClassifyIntentNode({
      goal: compiledPrompt.normalizedGoal || taskGoal,
      requestedSkillId: session.requestedSkillId,
      intentHints,
      signals: intentSignals,
      guildId: session.guildId,
    });

    // Backward-compat: set legacy routedIntent
    session.routedIntent = intentClassification.legacyIntent;

    // Store full classification for outcome attribution at session end
    session.intentClassification = intentClassification;

    // Persist exemplar for future few-shot learning (best-effort, fire-and-forget)
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

    // Fetch recent conversation turns for casual chat continuity (best-effort)
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
    if (nonTaskOutcome) {
      const timestamp = nowIso();
      cancelAllPendingSteps(session, timestamp);
      traceShadowNode(session, 'compose_response', nonTaskOutcome.traceNote);
      markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
        result: nonTaskOutcome.result,
        error: null,
      });
      return session.cancelRequested ? 'cancelled' : 'completed';
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
    traceShadowNode(session, 'select_execution_strategy', strategySelection.traceNote);

    return await executeSessionBranchRuntime({
      strategy: strategySelection.strategy,
      session,
      sessionStartedAtMs,
      taskGoal,
      planner,
      researcher,
      critic,
      dependencies: {
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
      },
      constants: {
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        stepTimeoutMs: AGENT_STEP_TIMEOUT_MS,
        ormPassThreshold: ORM_RULE_PASS_THRESHOLD,
        ormReviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
        totCandidatePairRecordTask: TOT_CANDIDATE_PAIR_RECORD_TASK,
      },
    });
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

    markSessionTerminal(session, 'failed', { error: getErrorMessage(error) });
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

const toElapsedMs = (session: AgentSession): number | null => {
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

const toTraceTailLimit = (raw?: number): number => {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(0, Math.min(20, Math.trunc(value)));
};

const buildShadowSummary = (
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

const buildProgressSummary = (session: AgentSession): AgentSessionProgressSummary => {
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
  };
};

const buildPrivacySummary = (session: AgentSession) => {
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

export const __resetAgentRuntimeForTests = (): void => {
  queueRuntime.reset();
  sessions.clear();
};
