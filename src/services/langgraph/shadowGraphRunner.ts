/**
 * Shadow Graph Runner
 *
 * Runs the LangGraph state graph in parallel with the main session execution,
 * recording the shadow path for comparison. Unlike the existing replay-only
 * shadow, this runner executes real graph node handlers and compares the
 * shadow output against the main session result.
 *
 * Phase 1 (active):  Shadow execution with divergence logging
 * Phase 2 (active):  Dual-run with traffic routing — trafficRoutingService
 *                     decides per-session whether shadow result can be promoted
 *                     as the primary output (gated by divergence quality + rollout %)
 * Phase 3 (planned): Full cutover — LangGraph executor as sole primary path
 */

import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { buildCasualChatFallback, buildIntentClarificationFallback, buildPolicyBlockMessage } from '../agent/agentIntentClassifier';
import {
  createInitialLangGraphState,
  appendTrace,
  type LangGraphNodeId,
  type LangGraphState,
} from './stateContract';
import { type LangGraphNodeHandler } from './executor';
import { executeLangGraphWithLangGraphJs } from './langgraphjsAdapter';
import { runCompilePromptNode, runRouteIntentNode, runPolicyGateNode } from './nodes/coreNodes';
import {
  runHydrateMemoryNode,
  runNonTaskIntentNode,
  runPersistAndEmitNode,
  runTaskPolicyGateTransitionNode,
} from './nodes/runtimeNodes';
import { runSelectExecutionStrategyNode, type ExecutionStrategy } from './nodes/strategyNodes';
import type { AgentPriority } from '../agent/agentRuntimeTypes';
import type { SkillId } from '../skills/types';
import { getErrorMessage } from '../../utils/errorMessage';

const SHADOW_RUNNER_ENABLED = parseBooleanEnv(process.env.SHADOW_GRAPH_RUNNER_ENABLED, false);
const SHADOW_TIMEOUT_MS = parseBoundedNumberEnv(process.env.SHADOW_GRAPH_TIMEOUT_MS, 30_000, 5_000, 120_000);

export type ShadowRunResult = {
  shadowState: LangGraphState;
  visitedNodes: LangGraphNodeId[];
  divergeAtIndex: number | null;
  mainPathNodes: LangGraphNodeId[];
  elapsedMs: number;
  error: string | null;
};

type ShadowContext = {
  guildId: string;
  goal: string;
  requestedBy: string;
  priority: AgentPriority;
  requestedSkillId: SkillId | null;
  loadMemoryHints: (params: {
    guildId: string;
    goal: string;
    maxItems: number;
    requesterUserId: string;
  }) => Promise<string[]>;
};

const getShadowExecutionStrategy = (state: LangGraphState, ctx: ShadowContext): ExecutionStrategy => {
  return runSelectExecutionStrategyNode({
    requestedSkillId: ctx.requestedSkillId,
    priority: ctx.priority,
    forceFullReview: state.policyDecision === 'review',
  }).strategy;
};

const buildShadowTaskPreview = (state: LangGraphState): string => {
  const summary = [
    `[shadow-preview] ${state.executionGoal || state.originalGoal || 'task'}`,
    `intent=${state.intent || 'task'}`,
    `strategy=${state.executionStrategy || 'unknown'}`,
    `memoryHints=${state.memoryHints.length}`,
    `plans=${state.plans.length}`,
  ];
  return summary.join(' | ');
};

const hasPreviewOnlyShadowOutput = (state: LangGraphState): boolean => {
  if (String(state.finalText || '').startsWith('[shadow-preview]')) {
    return true;
  }

  return state.trace.some((entry) => String(entry.note || '').includes('shadow_preview'));
};

// ─── Node Handlers (real execution) ─────────────────────────────────
const createShadowNodeHandlers = (ctx: ShadowContext): Record<LangGraphNodeId, LangGraphNodeHandler<ShadowContext>> => ({
  ingest: async ({ state }) => {
    return appendTrace(state, 'ingest', `priority=${ctx.priority}`);
  },

  compile_prompt: async ({ state }) => {
    const compiled = runCompilePromptNode(state.originalGoal);
    return appendTrace({
      ...state,
      compiledPrompt: compiled,
      executionGoal: compiled.executionGoal || compiled.normalizedGoal || state.originalGoal,
    }, 'compile_prompt', compiled.directives.length > 0 ? 'structured' : 'plain');
  },

  route_intent: async ({ state }) => {
    const intent = await runRouteIntentNode({
      goal: state.executionGoal,
      requestedSkillId: null,
      intentHints: state.memoryHints.slice(0, 4),
    });
    return appendTrace({ ...state, intent }, 'route_intent', intent);
  },

  select_execution_strategy: async ({ state }) => {
    const selection = runSelectExecutionStrategyNode({
      requestedSkillId: ctx.requestedSkillId,
      priority: ctx.priority,
      forceFullReview: state.policyDecision === 'review',
    });

    return appendTrace({
      ...state,
      executionStrategy: selection.strategy,
    }, 'select_execution_strategy', selection.traceNote);
  },

  hydrate_memory: async ({ state }) => {
    const hydrateMemory = await runHydrateMemoryNode({
      guildId: ctx.guildId,
      goal: state.executionGoal,
      priority: ctx.priority,
      requestedBy: ctx.requestedBy,
      loadHints: ctx.loadMemoryHints,
    });

    return appendTrace({
      ...state,
      memoryHints: hydrateMemory.memoryHints,
    }, 'hydrate_memory', `count=${hydrateMemory.memoryHints.length}`);
  },

  plan_actions: async ({ state }) => {
    return appendTrace({
      ...state,
      plans: [
        ...state.plans,
        {
          actionName: 'shadow-plan',
          args: {
            strategy: state.executionStrategy || 'unknown',
            intent: state.intent || 'unknown',
          },
          reason: String(state.executionGoal || state.originalGoal || '').slice(0, 240),
        },
      ],
    }, 'plan_actions', `planner_preview:intent=${state.intent || 'unknown'}`);
  },

  requested_skill_run: async ({ state }) => {
    return appendTrace({
      ...state,
      executionDraft: buildShadowTaskPreview(state),
    }, 'requested_skill_run', `requested_skill_preview:${ctx.requestedSkillId || 'none'}`);
  },

  requested_skill_refine: async ({ state }) => {
    return appendTrace({
      ...state,
      finalCandidate: buildShadowTaskPreview(state),
      selectedFinalRaw: buildShadowTaskPreview(state),
    }, 'requested_skill_refine', 'requested_skill_refine_preview');
  },

  fast_path_run: async ({ state }) => {
    return appendTrace({
      ...state,
      executionDraft: buildShadowTaskPreview(state),
    }, 'fast_path_run', 'fast_path_preview');
  },

  fast_path_refine: async ({ state }) => {
    return appendTrace({
      ...state,
      finalCandidate: buildShadowTaskPreview(state),
      selectedFinalRaw: buildShadowTaskPreview(state),
    }, 'fast_path_refine', 'fast_path_refine_preview');
  },

  full_review_plan: async ({ state }) => {
    return appendTrace({
      ...state,
      planText: buildShadowTaskPreview(state),
      subgoals: state.subgoals.length > 0 ? state.subgoals : ['shadow-subgoal'],
    }, 'full_review_plan', 'full_review_plan_preview');
  },

  full_review_execute: async ({ state }) => {
    return appendTrace({
      ...state,
      executionDraft: buildShadowTaskPreview(state),
    }, 'full_review_execute', 'full_review_execute_preview');
  },

  full_review_critique: async ({ state }) => {
    return appendTrace({
      ...state,
      critiqueText: 'shadow critique preview',
    }, 'full_review_critique', 'full_review_critique_preview');
  },

  full_review_tot: async ({ state }) => {
    return appendTrace({
      ...state,
      totShadowBest: {
        rawResult: buildShadowTaskPreview(state),
        score: 0,
        beamProbability: 0,
        beamCorrectness: 0,
        beamScore: 0,
        beamProbabilitySource: 'fallback',
        evidenceBundleId: 'shadow-preview',
      },
    }, 'full_review_tot', 'full_review_tot_preview');
  },

  hitl_review: async ({ state }) => {
    return appendTrace(state, 'hitl_review', 'hitl_preview');
  },

  full_review_compose: async ({ state }) => {
    return appendTrace({
      ...state,
      finalCandidate: buildShadowTaskPreview(state),
    }, 'full_review_compose', 'full_review_compose_preview');
  },

  full_review_promote: async ({ state }) => {
    return appendTrace({
      ...state,
      selectedFinalRaw: buildShadowTaskPreview(state),
    }, 'full_review_promote', 'full_review_promote_preview');
  },

  execute_actions: async ({ state }) => {
    return appendTrace(state, 'execute_actions', `execution_preview:${state.executionStrategy || 'unknown'}`);
  },

  critic_review: async ({ state }) => {
    return appendTrace(state, 'critic_review', `critic_preview:plans=${state.plans.length}`);
  },

  policy_gate: async ({ state }) => {
    const transition = runTaskPolicyGateTransitionNode({
      routedIntent: state.intent ?? 'uncertain',
      guildId: ctx.guildId,
      taskGoal: state.executionGoal,
      evaluateGate: runPolicyGateNode,
      buildPolicyBlockMessage,
    });

    return appendTrace({
      ...state,
      policyBlocked: transition.shouldBlock,
      policyDecision: transition.policyGate.decision,
      finalText: transition.blockResult ?? state.finalText,
    }, 'policy_gate', transition.traceNote);
  },

  compose_response: async ({ state }) => {
    if (state.policyBlocked) {
      return appendTrace({
        ...state,
        finalText: state.finalText || buildPolicyBlockMessage(['shadow_policy_blocked']),
      }, 'compose_response', 'policy_blocked');
    }

    const nonTaskOutcome = await runNonTaskIntentNode({
      routedIntent: state.intent === 'casual_chat' || state.intent === 'uncertain'
        ? state.intent
        : 'task',
      goal: state.originalGoal,
      intentHints: state.memoryHints,
      generateCasualReply: async (goal) => buildCasualChatFallback(goal),
      generateClarification: async (goal) => buildIntentClarificationFallback(goal),
    });

    if (nonTaskOutcome) {
      return appendTrace({
        ...state,
        finalText: nonTaskOutcome.result,
      }, 'compose_response', nonTaskOutcome.traceNote);
    }

    return appendTrace({
      ...state,
      finalText: buildShadowTaskPreview(state),
    }, 'compose_response', `shadow_preview:${state.executionStrategy || 'unknown'}`);
  },

  persist_and_emit: async ({ state }) => {
    return runPersistAndEmitNode({
      shadowGraph: state,
      status: state.errorCode ? 'failed' : 'completed',
      currentResult: state.finalText,
      currentError: state.errorCode,
    }).shadowGraph;
  },
});

// ─── Edge Resolution ────────────────────────────────────────────────
const SHADOW_GRAPH_ORDER: LangGraphNodeId[] = [
  'ingest',
  'compile_prompt',
  'route_intent',
  'policy_gate',
  'hydrate_memory',
  'select_execution_strategy',
  'plan_actions',
  'execute_actions',
  'critic_review',
  'compose_response',
  'persist_and_emit',
];

const resolveShadowEdge = (params: { from: LangGraphNodeId; state: LangGraphState; context: ShadowContext }): LangGraphNodeId | null => {
  const { from, state, context } = params;

  switch (from) {
    case 'ingest':
      return 'compile_prompt';
    case 'compile_prompt':
      return 'route_intent';
    case 'route_intent':
      return 'policy_gate';
    case 'policy_gate':
      if (state.policyBlocked || state.intent !== 'task') {
        return 'compose_response';
      }
      return 'hydrate_memory';
    case 'hydrate_memory':
      return 'select_execution_strategy';
    case 'select_execution_strategy': {
      const strategy = state.executionStrategy || getShadowExecutionStrategy(state, context);
      return strategy === 'full_review' ? 'plan_actions' : 'execute_actions';
    }
    case 'plan_actions':
      return 'execute_actions';
    case 'execute_actions': {
      const strategy = state.executionStrategy || getShadowExecutionStrategy(state, context);
      return strategy === 'full_review' ? 'critic_review' : 'compose_response';
    }
    case 'critic_review':
      return 'compose_response';
    case 'compose_response':
      return 'persist_and_emit';
    default:
      return null;
  }
};

// ─── Public API ─────────────────────────────────────────────────────
export const isShadowRunnerEnabled = (): boolean => SHADOW_RUNNER_ENABLED;

/**
 * Execute the shadow graph in parallel with the main session.
 * Returns the shadow result without affecting the main execution path.
 */
export const runShadowGraph = async (params: {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  priority: AgentPriority;
  requestedSkillId?: SkillId | null;
  goal: string;
  mainPathNodes: LangGraphNodeId[];
  loadMemoryHints: ShadowContext['loadMemoryHints'];
}): Promise<ShadowRunResult> => {
  const startedAt = Date.now();

  const ctx: ShadowContext = {
    guildId: params.guildId,
    goal: params.goal,
    requestedBy: params.requestedBy,
    priority: params.priority,
    requestedSkillId: params.requestedSkillId ?? null,
    loadMemoryHints: params.loadMemoryHints,
  };

  const initialState = createInitialLangGraphState({
    sessionId: params.sessionId,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    priority: params.priority,
    goal: params.goal,
  });

  try {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('SHADOW_GRAPH_TIMEOUT')), SHADOW_TIMEOUT_MS);
    });
    const result = await Promise.race([
      executeLangGraphWithLangGraphJs({
        initialNode: 'ingest',
        initialState,
        handlers: createShadowNodeHandlers(ctx),
        resolveNext: resolveShadowEdge,
        options: {
          context: ctx,
          maxSteps: SHADOW_GRAPH_ORDER.length,
        },
      }),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId));

    const visited = result.visitedNodes;
    const main = params.mainPathNodes;
    let divergeAt: number | null = null;

    for (let i = 0; i < Math.max(visited.length, main.length); i++) {
      if (visited[i] !== main[i]) {
        divergeAt = i;
        break;
      }
    }

    const elapsedMs = Date.now() - startedAt;

    if (divergeAt !== null) {
      logger.info(
        '[SHADOW-GRAPH] divergence session=%s divergeAt=%d shadow=%s main=%s shadowNodes=%d mainNodes=%d elapsedMs=%d',
        params.sessionId,
        divergeAt,
        visited[divergeAt] || 'end',
        main[divergeAt] || 'end',
        visited.length,
        main.length,
        elapsedMs,
      );
    } else {
      logger.debug('[SHADOW-GRAPH] match session=%s nodes=%d elapsedMs=%d', params.sessionId, visited.length, elapsedMs);
    }

    return {
      shadowState: result.finalState,
      visitedNodes: visited,
      divergeAtIndex: divergeAt,
      mainPathNodes: main,
      elapsedMs,
      error: null,
    };
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const errorMsg = getErrorMessage(err);
    logger.warn('[SHADOW-GRAPH] failed session=%s error=%s elapsedMs=%d', params.sessionId, errorMsg, elapsedMs);

    return {
      shadowState: initialState,
      visitedNodes: [],
      divergeAtIndex: 0,
      mainPathNodes: params.mainPathNodes,
      elapsedMs,
      error: errorMsg,
    };
  }
};

// ─── Divergence Persistence ─────────────────────────────────────────

/** Compute quality delta: 0 = perfect match, negative = shadow diverged or errored */
const computeQualityDelta = (result: ShadowRunResult, mainFinalStatus: string): number | null => {
  // Error means quality penalty
  if (result.error) return -1.0;

  // No divergence = perfect match
  if (result.divergeAtIndex === null) return 0.0;

  // Partial divergence: scale by how early the divergence happened
  const mainLen = result.mainPathNodes.length || 1;
  const shadowLen = result.visitedNodes.length || 0;
  const convergenceRatio = result.divergeAtIndex / mainLen;

  // Length penalty: shadow completed fewer nodes = lower quality (capped at 1.0)
  const lengthRatio = mainLen > 0 ? Math.min(1, shadowLen / mainLen) : 0;

  // Status penalty: if main succeeded but shadow produced blocking state
  const statusPenalty = mainFinalStatus === 'completed' && result.shadowState.policyBlocked ? -0.3 : 0;

  // Blend: convergence ratio (how far they matched) + length ratio + status penalty
  return Math.max(-1, Math.min(1, (convergenceRatio * 0.5 + lengthRatio * 0.3 + statusPenalty) - 0.5));
};

export const persistShadowDivergence = async (params: {
  sessionId: string;
  guildId: string;
  result: ShadowRunResult;
  mainFinalStatus: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) return;

  try {
    const qualityDelta = computeQualityDelta(params.result, params.mainFinalStatus);
    const client = getSupabaseClient();
    await client.from('shadow_graph_divergence_logs').insert({
      session_id: params.sessionId,
      guild_id: params.guildId,
      main_path_nodes: params.result.mainPathNodes,
      shadow_path_nodes: params.result.visitedNodes,
      diverge_at_index: params.result.divergeAtIndex,
      main_final_status: params.mainFinalStatus,
      shadow_final_text: params.result.shadowState.finalText?.slice(0, 2000) || null,
      shadow_error: params.result.error?.slice(0, 500) || null,
      quality_delta: qualityDelta,
      elapsed_ms: params.result.elapsedMs,
    });
  } catch {
    // Best-effort persistence
  }
};

// ─── Shadow Divergence Queries (used by API routes) ─────────────────

export const getRecentShadowDivergence = async (
  guildId: string,
  limit: number,
): Promise<{ data: unknown[] | null; error: string | null }> => {
  if (!isSupabaseConfigured()) return { data: null, error: 'SUPABASE_NOT_CONFIGURED' };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('shadow_graph_divergence_logs')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch {
    return { data: null, error: 'query_failed' };
  }
};

export const getShadowDivergenceBySession = async (
  sessionId: string,
): Promise<{ data: unknown | null; error: string | null }> => {
  if (!isSupabaseConfigured()) return { data: null, error: 'SUPABASE_NOT_CONFIGURED' };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('shadow_graph_divergence_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch {
    return { data: null, error: 'query_failed' };
  }
};

export type ShadowDivergenceStats = {
  totalRuns: number;
  divergedRuns: number;
  errorRuns: number;
  convergenceRate: number | null;
  avgElapsedMs: number;
};

type ShadowDivergenceStatsRow = {
  diverge_at_index: number | null;
  elapsed_ms: number | null;
  shadow_error: string | null;
  created_at?: string | null;
};

export const summarizeShadowDivergenceRows = (rows: ShadowDivergenceStatsRow[]): ShadowDivergenceStats => {
  const totalRuns = rows.length;
  const divergedRuns = rows.filter((row) => row.diverge_at_index != null).length;
  const errorRuns = rows.filter((row) => Boolean(String(row.shadow_error || '').trim())).length;
  const nonConvergedRuns = rows.filter((row) => {
    const hasError = Boolean(String(row.shadow_error || '').trim());
    return row.diverge_at_index != null || hasError;
  }).length;
  const avgElapsedMs = totalRuns > 0
    ? rows.reduce((sum, row) => sum + Math.max(0, Number(row.elapsed_ms) || 0), 0) / totalRuns
    : 0;

  return {
    totalRuns,
    divergedRuns,
    errorRuns,
    convergenceRate: totalRuns > 0 ? ((totalRuns - nonConvergedRuns) / totalRuns) : null,
    avgElapsedMs: Math.round(avgElapsedMs),
  };
};

export const getShadowDivergenceStats = async (
  guildId: string,
): Promise<{ stats: ShadowDivergenceStats | null; error: string | null }> => {
  if (!isSupabaseConfigured()) return { stats: null, error: 'SUPABASE_NOT_CONFIGURED' };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('shadow_graph_divergence_logs')
      .select('diverge_at_index, elapsed_ms, shadow_error, created_at')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return { stats: null, error: error.message };

    return {
      stats: summarizeShadowDivergenceRows((data || []) as ShadowDivergenceStatsRow[]),
      error: null,
    };
  } catch {
    return { stats: null, error: 'query_failed' };
  }
};

// ──── Phase 2: Shadow Promotion Eligibility ─────────────────────────

/**
 * Determines whether a shadow run result is eligible to be promoted
 * as the primary session output. Used by the traffic router when
 * the route is 'shadow' and the shadow completed successfully.
 *
 * Criteria:
 *   - No error in shadow run
 *   - No divergence (or divergence only in terminal nodes)
 *   - Shadow produced non-empty finalText
 *   - Quality delta >= 0 (shadow not worse than main)
 */
export const isShadowResultPromotable = (
  result: ShadowRunResult,
  mainFinalStatus: string,
): { promotable: boolean; reason: string } => {
  if (result.error) {
    return { promotable: false, reason: `shadow_error:${result.error}` };
  }

  if (!result.shadowState.finalText || result.shadowState.finalText.trim().length === 0) {
    return { promotable: false, reason: 'shadow_empty_output' };
  }

  if (result.shadowState.policyBlocked) {
    return { promotable: false, reason: 'shadow_policy_blocked' };
  }

  if (hasPreviewOnlyShadowOutput(result.shadowState)) {
    return { promotable: false, reason: 'shadow_preview_only' };
  }

  const qualityDelta = computeQualityDelta(result, mainFinalStatus);
  if (qualityDelta !== null && qualityDelta < 0) {
    return { promotable: false, reason: `shadow_quality_negative:${qualityDelta.toFixed(3)}` };
  }

  // Divergence in terminal nodes (compose_response, persist_and_emit) is acceptable
  if (result.divergeAtIndex !== null) {
    const divergeNode = result.visitedNodes[result.divergeAtIndex];
    const terminalNodes = new Set(['compose_response', 'persist_and_emit']);
    if (!terminalNodes.has(divergeNode)) {
      return { promotable: false, reason: `shadow_diverged_at:${divergeNode}` };
    }
  }

  return { promotable: true, reason: 'shadow_quality_acceptable' };
};

