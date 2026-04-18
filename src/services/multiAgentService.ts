import {
  AGENT_MEMORY_HINT_TIMEOUT_MS,
  AGENT_QUEUE_POLL_MS,
  AGENT_MAX_QUEUE_SIZE,
  AGENT_SESSION_MAX_ATTEMPTS,
  AGENT_DEADLETTER_MAX,
} from '../config';
import logger from '../logger';
import { buildAgentMemoryHints } from './agent/agentMemoryService';
import { resolveAgentPersonalizationSnapshot } from './agent/agentPersonalizationService';
import {
  canResolveAgentPolicyForGuild,
  getAgentPolicyLoadingMessage,
  getAgentPolicySnapshot,
  validateAgentSessionRequest,
} from './agent/agentPolicyService';
import {
  canResolveWorkflowStepTemplates,
  getWorkflowProfileLoadingMessage,
} from './agent/agentWorkflowService';
import { persistAgentSession } from './agent/agentSessionStore';
import { bindSessionAssistantTurn, bindSessionUserTurn } from './conversationTurnService';
import { getGateProviderProfileOverride, isAnyLlmConfigured } from './llmClient';
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
  clearSessionCheckpoint,
  cloneLangGraphState,
  cloneSession,
  ensureShadowGraph,
  isResumableLangGraphSession,
  pauseSessionForHitl,
  prepareSessionForResume,
  persistSessionCheckpoint,
  resetSessionForRetry,
  touch,
  traceShadowNode,
} from './langgraph/runtimeSupport/runtimeSessionState';
import {
  applyLangGraphPrimaryFallback,
  isTerminalStatus,
  markSessionTerminal as finalizeTerminalSession,
  resolveTerminalSessionFailure,
} from './langgraph/runtimeSupport/runtimeTerminal';
import {
  applyTrafficRoutingDecisionToSession,
  getSessionExecutionEngine,
  resolveSessionTrafficRoute,
} from './langgraph/runtimeSupport/runtimeRouting';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillId } from './skills/types';
import type { LangGraphNodeId } from './langgraph/stateContract';
import type { LangGraphNodeHandler } from './langgraph/executor';
import { executeLangGraphWithLangGraphJs } from './langgraph/langgraphjsAdapter';
import {
  buildInitialSessionSteps,
  createQueuedSession,
  normalizeAgentPriority,
} from './langgraph/runtimeSupport/runtimeSessionBootstrap';
import { LANGGRAPH_NODE_IDS, runLangGraphExecutorShadowReplay } from './sessionShadowExecution';
import { runCompilePromptNode } from './langgraph/nodes/coreNodes';
import {
  runPersistAndEmitNode,
} from './langgraph/nodes/runtimeNodes';
import { runSelectExecutionStrategyNode } from './langgraph/nodes/strategyNodes';
import { attributeAndPersistIntentOutcome } from './langgraph/nodes/intentOutcomeAttributor';
import {
  executeSessionBranchRuntime,
  runFastPathExecutionStateNode,
  runFastPathRefineStateNode,
  runRequestedSkillExecutionStateNode,
  runRequestedSkillRefineStateNode,
} from './langgraph/sessionRuntime/branchRuntime';
import {
  applySessionCompiledPrompt,
  applySessionExecutionStrategy,
  applySessionPolicyGateState,
  hydrateSessionMemory,
  maybeCompleteNonTaskSession,
  resolveComposeResponseState,
  runSessionIntentClassification,
} from './langgraph/sessionRuntime/sessionPrelude';
import {
  runFullReviewCritiqueStateNode,
  runFullReviewExecutionStateNode,
  runFullReviewPlanStateNode,
} from './langgraph/sessionRuntime/fullReviewNodes';
import {
  runFullReviewComposeStateNode,
  runHitlReviewStateNode,
  runFullReviewPromoteStateNode,
  runFullReviewTotStateNode,
} from './langgraph/sessionRuntime/fullReviewDeliberationNodes';
import { getAgentPrivacyPolicySnapshot } from './agent/agentPrivacyPolicyService';
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
import { MULTI_AGENT_MAX_SESSION_HISTORY } from './multiAgentConfig';
import { buildMultiAgentRuntimeSnapshot, createRecentSessionOutcomeStore } from './multiAgentSnapshot';

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

const MAX_SESSION_HISTORY = MULTI_AGENT_MAX_SESSION_HISTORY;
const sessions = new Map<string, AgentSession>();
const queueRuntime = new MultiAgentRuntimeQueue<AgentSession>();

// Cross-session outcome hints: recent terminal session summaries per guild
const recentSessionOutcomeStore = createRecentSessionOutcomeStore();

export const getRecentSessionOutcomes = (guildId: string): SessionOutcomeEntry[] => {
  return recentSessionOutcomeStore.getRecentSessionOutcomes(guildId);
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

const nowIso = () => new Date().toISOString();

const resolveEffectiveSessionProviderProfile = (session: AgentSession) => {
  return getGateProviderProfileOverride(session.guildId) || session.personalization?.effective.providerProfile || undefined;
};

const applySessionPersonalization = async (session: AgentSession): Promise<void> => {
  if (session.personalization !== undefined) {
    return;
  }

  const snapshot = await resolveAgentPersonalizationSnapshot({
    guildId: session.guildId,
    userId: session.requestedBy,
    requestedPriority: session.priority,
    requestedSkillId: session.requestedSkillId,
  }).catch(() => null);

  session.personalization = snapshot;
  if (!snapshot) {
    return;
  }

  if (session.priority === 'balanced' && snapshot.effective.priority !== session.priority) {
    session.priority = snapshot.effective.priority;
    session.steps = buildInitialSessionSteps({
      guildId: session.guildId,
      requestedSkillId: session.requestedSkillId,
      priority: session.priority,
      timestamp: nowIso(),
    });
  }
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

const markSessionTerminal = (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => {
  finalizeTerminalSession({
    session,
    status,
    patch,
    deps: {
      langGraphNodeIds: LANGGRAPH_NODE_IDS,
      ensureShadowGraph,
      runPersistAndEmitNode,
      nowIso,
      clearSessionCheckpoint,
      touch,
      persistSession: (target) => {
        void persistAgentSession(cloneSession(target));
      },
      persistTrafficRoutingDecision: (params) => {
        void persistTrafficRoutingDecision(params);
      },
      recordComplexityMetric,
      recordSessionOutcome: (target, terminalStatus) => {
        recentSessionOutcomeStore.recordSessionOutcome(target, terminalStatus);
      },
      precipitateSessionToMemory,
      attributeAndPersistIntentOutcome,
      logIntentAttributionFailure: (sessionId, error) => {
        logger.warn('[SESSION-CLEANUP] Intent attribution failed session=%s: %s', sessionId, getErrorMessage(error));
      },
      bindSessionAssistantTurn,
      getSession: (sessionId) => sessions.get(sessionId),
      getSessionExecutionEngine,
      runLangGraphExecutorShadowReplay,
      isShadowRunnerEnabled,
      runShadowGraph,
      loadMemoryHints: (input) => withTimeout(buildAgentMemoryHints(input), AGENT_MEMORY_HINT_TIMEOUT_MS, 'SHADOW_MEMORY_HINT_TIMEOUT').catch(() => []),
      persistShadowDivergence: (params) => {
        void persistShadowDivergence(params);
      },
      isShadowResultPromotable: (result, terminalStatus) => {
        return isShadowResultPromotable(result, terminalStatus);
      },
      logShadowPromotable: (sessionId, route, reason) => {
        logger.info('[TRAFFIC-ROUTING] shadow promotable session=%s route=%s reason=%s', sessionId, route, reason);
      },
      logShadowNotPromotable: (sessionId, route, reason) => {
        logger.warn('[TRAFFIC-ROUTING] shadow not promotable session=%s route=%s reason=%s', sessionId, route, reason);
      },
    },
  });
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
      sessionId: session.id,
      providerProfile: resolveEffectiveSessionProviderProfile(session),
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

const getSessionPreludeDeps = () => ({
  agentMemoryHintTimeoutMs: AGENT_MEMORY_HINT_TIMEOUT_MS,
  agentSessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
  getRecentSessionOutcomes,
  resolveEffectiveSessionProviderProfile,
  ensureShadowGraph,
  traceShadowNode,
  nowIso,
  cancelAllPendingSteps,
  markSessionTerminal,
  touch,
});

const executeSessionWithMainPipeline = async (
  session: AgentSession,
  sessionStartedAtMs: number,
): Promise<AgentSessionStatus> => {
  const sessionPreludeDeps = getSessionPreludeDeps();
  traceShadowNode(
    session,
    'ingest',
    `priority=${session.priority}|provider=${resolveEffectiveSessionProviderProfile(session) || 'default'}`,
  );

  const { compiledPrompt, taskGoal } = applySessionCompiledPrompt({
    session,
    deps: sessionPreludeDeps,
  });

  const { intentHints } = await runSessionIntentClassification({
    session,
    taskGoal,
    compiledPrompt,
    sessionStartedAtMs,
    deps: sessionPreludeDeps,
  });

  const policyGateState = applySessionPolicyGateState({
    session,
    taskGoal,
    deps: sessionPreludeDeps,
  });
  if (policyGateState.status) {
    return policyGateState.status;
  }

  ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
  const nonTaskStatus = await maybeCompleteNonTaskSession({ session, intentHints, deps: sessionPreludeDeps });
  if (nonTaskStatus) {
    return nonTaskStatus;
  }

  ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
  await hydrateSessionMemory({
    session,
    taskGoal,
    deps: sessionPreludeDeps,
  });

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
    deps: sessionPreludeDeps,
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
  const sessionPreludeDeps = getSessionPreludeDeps();

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
      traceShadowNode(
        session,
        'ingest',
        `priority=${session.priority}|provider=${resolveEffectiveSessionProviderProfile(session) || 'default'}`,
      );
      return ensureShadowGraph(session);
    },
    compile_prompt: async () => {
      const { taskGoal } = applySessionCompiledPrompt({
        session,
        deps: sessionPreludeDeps,
      });
      context.taskGoal = taskGoal;
      return ensureShadowGraph(session);
    },
    route_intent: async ({ state }) => {
      const compiledPrompt = state.compiledPrompt || runCompilePromptNode(session.goal);
      const { intentHints } = await runSessionIntentClassification({
        session,
        taskGoal: context.taskGoal,
        compiledPrompt,
        sessionStartedAtMs,
        deps: sessionPreludeDeps,
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
        deps: sessionPreludeDeps,
      });
      return ensureShadowGraph(session);
    },
    hydrate_memory: async () => {
      await hydrateSessionMemory({
        session,
        taskGoal: context.taskGoal,
        deps: sessionPreludeDeps,
      });
      return ensureShadowGraph(session);
    },
    plan_actions: async ({ state }) => state,
    execute_actions: async ({ state }) => state,
    critic_review: async ({ state }) => state,
    requested_skill_run: async () => {
      return runRequestedSkillExecutionStateNode({
        session,
        taskGoal: context.taskGoal,
        sessionStartedAtMs,
        planner: context.planner,
        dependencies: branchDependencies,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        ensureShadowGraph,
        traceNode: 'requested_skill_run',
      });
    },
    requested_skill_refine: async ({ state }) => {
      return runRequestedSkillRefineStateNode({
        session,
        taskGoal: context.taskGoal,
        currentDraft: state.executionDraft || '',
        sessionStartedAtMs,
        dependencies: branchDependencies,
        ensureShadowGraph,
        traceNode: 'requested_skill_refine',
      });
    },
    fast_path_run: async () => {
      return runFastPathExecutionStateNode({
        session,
        taskGoal: context.taskGoal,
        sessionStartedAtMs,
        researcher: context.researcher,
        dependencies: branchDependencies,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        ensureShadowGraph,
        traceNode: 'fast_path_run',
      });
    },
    fast_path_refine: async ({ state }) => {
      return runFastPathRefineStateNode({
        session,
        taskGoal: context.taskGoal,
        currentDraft: state.executionDraft || '',
        sessionStartedAtMs,
        dependencies: branchDependencies,
        ensureShadowGraph,
        traceNode: 'fast_path_refine',
      });
    },
    full_review_plan: async ({ state }) => {
      await runFullReviewPlanStateNode({
        session,
        planner: context.planner,
        taskGoal: context.taskGoal,
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_plan', note),
      });
      return ensureShadowGraph(session);
    },
    full_review_execute: async ({ state }) => {
      await runFullReviewExecutionStateNode({
        session,
        researcher: context.researcher,
        taskGoal: context.taskGoal,
        plan: state.planText || '',
        subgoals: state.subgoals || [],
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_execute', note),
      });
      return ensureShadowGraph(session);
    },
    full_review_critique: async ({ state }) => {
      await runFullReviewCritiqueStateNode({
        session,
        critic: context.critic,
        taskGoal: context.taskGoal,
        executionDraft: state.executionDraft || '',
        sessionStartedAtMs,
        sessionTimeoutMs: AGENT_SESSION_TIMEOUT_MS,
        dependencies: branchDependencies,
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_critique', note),
      });
      return ensureShadowGraph(session);
    },
    full_review_tot: async ({ state }) => {
      const totState = await runFullReviewTotStateNode({
        session,
        taskGoal: context.taskGoal,
        plan: state.planText || '',
        executionDraft: state.executionDraft || '',
        critique: state.critiqueText || '',
        sessionStartedAtMs,
        dependencies: {
          getAgentTotPolicySnapshot,
          getAgentGotPolicySnapshot,
          getAgentGotCutoverDecision,
          runToTShadowExploration,
        },
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_tot', note),
      });

      context.totPolicy = totState.totPolicy as AgentTotPolicySnapshot;
      context.gotPolicy = totState.gotPolicy as AgentGotPolicySnapshot;
      context.gotCutoverAllowed = totState.gotCutoverAllowed;
      return ensureShadowGraph(session);
    },
    policy_gate: async ({ state }) => {
      const policyGateState = applySessionPolicyGateState({
        session,
        taskGoal: context.taskGoal,
        deps: sessionPreludeDeps,
      });
      if (policyGateState.status && policyGateState.finalText) {
        return {
          ...state,
          finalText: policyGateState.finalText,
        };
      }
      return ensureShadowGraph(session);
    },
    hitl_review: async ({ state }) => {
      return runHitlReviewStateNode({
        session,
        taskGoal: context.taskGoal,
        critiqueText: state.critiqueText || '',
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'hitl_review', note),
        pauseForHitl: (prompt) => {
          pauseSessionForHitl({
            session,
            gateNode: 'hitl_review',
            prompt,
            requestedAt: nowIso(),
            persistCheckpoint: ({ session: targetSession, currentNode, nextNode, state, reason }) => {
              persistSessionCheckpoint({
                session: targetSession,
                currentNode,
                nextNode,
                state,
                reason,
                savedAt: nowIso(),
                persistSession: (sessionToPersist) => {
                  void persistAgentSession(cloneSession(sessionToPersist));
                },
              });
            },
          });
        },
      });
    },
    full_review_compose: async ({ state }) => {
      await runFullReviewComposeStateNode({
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
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_compose', note),
      });
      return ensureShadowGraph(session);
    },
    full_review_promote: async ({ state }) => {
      await runFullReviewPromoteStateNode({
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
        ensureShadowGraph,
        traceNodeState: (note) => traceShadowNode(session, 'full_review_promote', note),
      });
      return ensureShadowGraph(session);
    },
    compose_response: async ({ state }) => {
      const composeState = await resolveComposeResponseState({
        session,
        intentHints: context.intentHints,
        executionStrategy: state.executionStrategy,
        finalCandidate: state.finalCandidate || null,
        selectedFinalRaw: state.selectedFinalRaw || null,
        finalText: state.finalText || null,
        errorCode: state.errorCode || null,
        deps: sessionPreludeDeps,
        completeTaskSession: completeGraphTaskSession,
      });

      return {
        ...state,
        finalText: composeState.finalText,
        errorCode: composeState.errorCode,
        selectedFinalRaw: composeState.selectedFinalRaw || state.selectedFinalRaw,
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
          savedAt: nowIso(),
          persistSession: (sessionToPersist) => {
            void persistAgentSession(cloneSession(sessionToPersist));
          },
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
    await applySessionPersonalization(session);
    const routeDecision = isResumableLangGraphSession(session)
      ? session.trafficRoutingDecision || null
      : await resolveSessionTrafficRoute({
        session,
        trafficRoutingEnabled: TRAFFIC_ROUTING_ENABLED,
        isShadowRunnerEnabled,
        getAgentGotCutoverDecision,
        resolveTrafficRoute,
        touch,
        persistSession: (sessionToPersist) => {
          void persistAgentSession(cloneSession(sessionToPersist));
        },
        getErrorMessage,
        nowIso,
        logInfo: (...args) => logger.info(...args),
        logWarn: (...args) => logger.warn(...args),
      });
    const requestedRoute = routeDecision?.route || (session.trafficRoute || 'main');
    if (requestedRoute === 'langgraph') {
      try {
        return await executeSessionWithLangGraphPrimary(session, sessionStartedAtMs);
      } catch (error) {
        if (!canFallbackToMainPipeline(session) || session.cancelRequested) {
          throw error;
        }

        const fallbackErrorMessage = getErrorMessage(error);

        logger.warn(
          '[AGENT] langgraph primary failed session=%s, falling back to main: %s',
          session.id,
          fallbackErrorMessage,
        );
        applyLangGraphPrimaryFallback({
          session,
          errorMessage: fallbackErrorMessage,
          applyTrafficRoutingDecisionToSession: (targetSession, decision) => {
            applyTrafficRoutingDecisionToSession(targetSession, decision, nowIso());
          },
          touch,
          persistSession: (target) => {
            void persistAgentSession(cloneSession(target));
          },
        });
      }
    }

    return await executeSessionWithMainPipeline(session, sessionStartedAtMs);
  } catch (error) {
    const terminalFailure = resolveTerminalSessionFailure({
      rawErrorMessage: getErrorMessage(error),
      cancelRequested: session.cancelRequested,
    });
    markSessionTerminal(session, terminalFailure.status, { error: terminalFailure.error });
    return terminalFailure.status;
  }
};

const requeueForRetry = (session: AgentSession) => {
  const privacyPolicy = getAgentPrivacyPolicySnapshot(session.guildId);
  resetSessionForRetry({
    session,
    deliberationMode: privacyPolicy.modeDefault,
    buildInitialSteps: (timestamp) => buildInitialSessionSteps({
      guildId: session.guildId,
      requestedSkillId: session.requestedSkillId,
      priority: session.priority,
      timestamp,
    }),
    timestamp: nowIso(),
  });
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
    getMaxConcurrent: (session) => {
      if (!canResolveAgentPolicyForGuild(session.guildId)) {
        return null;
      }
      return Math.max(1, getAgentPolicySnapshot(session.guildId).maxConcurrentSessions);
    },
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
  const priority = normalizeAgentPriority(params.priority);
  primeAgentTotPolicyCache();

  if (queueRuntime.getQueuedCount() >= AGENT_MAX_QUEUE_SIZE) {
    throw new Error(`대기열이 가득 찼습니다. 잠시 후 다시 시도해주세요. (max=${AGENT_MAX_QUEUE_SIZE})`);
  }

  if (!canResolveAgentPolicyForGuild(params.guildId)) {
    throw new Error(getAgentPolicyLoadingMessage());
  }

  if (!canResolveWorkflowStepTemplates({ guildId: params.guildId, priority })) {
    throw new Error(getWorkflowProfileLoadingMessage());
  }

  const policy = validateAgentSessionRequest({
    guildId: params.guildId,
    runningSessions: queueRuntime.getRunningCount(params.guildId),
    goal: params.goal,
    requestedSkillId,
    isAdmin: params.isAdmin === true,
  });

  if (!policy.ok) {
    throw new Error(policy.message);
  }

  const timestamp = nowIso();
  const session = createQueuedSession({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal,
    requestedSkillId,
    priority,
    timestamp,
    deliberationMode: privacyPolicy.modeDefault,
  });

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

  prepareSessionForResume({
    session,
    decision: params.decision,
    note: params.note,
    resumedAt: nowIso(),
  });
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
  return buildMultiAgentRuntimeSnapshot({
    sessions: sessions.values(),
    queueRuntime,
  });
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
        personalization: undefined,
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
  recentSessionOutcomeStore.reset();
};
