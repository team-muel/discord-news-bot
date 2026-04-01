/**
 * Shadow Graph Runner
 *
 * Runs the LangGraph state graph in parallel with the main session execution,
 * recording the shadow path for comparison. Unlike the existing replay-only
 * shadow, this runner executes real graph node handlers and compares the
 * shadow output against the main session result.
 *
 * Phase 1 (current): Shadow execution with divergence logging
 * Phase 2 (planned): Dual-run with traffic routing
 * Phase 3 (planned): Full cutover
 */

import logger from '../../logger';
import { parseBooleanEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import {
  createInitialLangGraphState,
  appendTrace,
  type LangGraphNodeId,
  type LangGraphState,
} from './stateContract';
import { executeLangGraph, type LangGraphNodeHandler } from './executor';
import { runCompilePromptNode, runRouteIntentNode, runPolicyGateNode } from './nodes/coreNodes';
import type { AgentPriority } from '../agent/agentRuntimeTypes';

const SHADOW_RUNNER_ENABLED = parseBooleanEnv(process.env.SHADOW_GRAPH_RUNNER_ENABLED, false);
const SHADOW_TIMEOUT_MS = Math.max(5_000, Math.min(120_000, Number(process.env.SHADOW_GRAPH_TIMEOUT_MS || 30_000) || 30_000));

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
  loadMemoryHints: (params: {
    guildId: string;
    goal: string;
    maxItems: number;
    requesterUserId: string;
  }) => Promise<string[]>;
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
    return appendTrace(state, 'select_execution_strategy', ctx.priority);
  },

  hydrate_memory: async ({ state }) => {
    const hints = await ctx.loadMemoryHints({
      guildId: ctx.guildId,
      goal: state.executionGoal,
      maxItems: ctx.priority === 'fast' ? 4 : ctx.priority === 'precise' ? 16 : 10,
      requesterUserId: ctx.requestedBy,
    });
    return appendTrace({ ...state, memoryHints: hints }, 'hydrate_memory', `count=${hints.length}`);
  },

  plan_actions: async ({ state }) => {
    // Shadow: record plan intent without executing real planning
    return appendTrace(state, 'plan_actions', `intent=${state.intent || 'unknown'}`);
  },

  execute_actions: async ({ state }) => {
    // Shadow: skip action execution but record the node
    return appendTrace(state, 'execute_actions', 'shadow_skip');
  },

  critic_review: async ({ state }) => {
    return appendTrace(state, 'critic_review', 'shadow_skip');
  },

  policy_gate: async ({ state }) => {
    const gate = runPolicyGateNode({
      guildId: ctx.guildId,
      goal: state.executionGoal,
    });
    return appendTrace({
      ...state,
      policyBlocked: gate.decision === 'block',
    }, 'policy_gate', `decision=${gate.decision} score=${gate.score}`);
  },

  compose_response: async ({ state }) => {
    // Shadow: compose a brief summary rather than full generation
    const summary = state.policyBlocked
      ? 'policy_blocked'
      : `intent=${state.intent} hints=${state.memoryHints.length}`;
    return appendTrace({
      ...state,
      finalText: `[shadow] ${summary}`,
    }, 'compose_response', summary);
  },

  persist_and_emit: async ({ state }) => {
    return appendTrace(state, 'persist_and_emit', 'shadow_complete');
  },
});

// ─── Edge Resolution ────────────────────────────────────────────────
const SHADOW_GRAPH_ORDER: LangGraphNodeId[] = [
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

const resolveShadowEdge = (params: { from: LangGraphNodeId; state: LangGraphState }): LangGraphNodeId | null => {
  const { from, state } = params;

  // Intent-based short-circuiting
  if (from === 'route_intent' && state.intent !== 'task') {
    return 'compose_response';
  }

  // Policy block short-circuit
  if (from === 'policy_gate' && state.policyBlocked) {
    return 'compose_response';
  }

  // Default: follow linear order
  const idx = SHADOW_GRAPH_ORDER.indexOf(from);
  if (idx < 0 || idx >= SHADOW_GRAPH_ORDER.length - 1) return null;
  return SHADOW_GRAPH_ORDER[idx + 1];
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
      executeLangGraph({
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
    const errorMsg = err instanceof Error ? err.message : String(err);
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

    const logs = data || [];
    const totalRuns = logs.length;
    const divergedRuns = logs.filter((l: any) => l.diverge_at_index != null).length;
    const errorRuns = logs.filter((l: any) => !!l.shadow_error).length;
    const avgElapsedMs = totalRuns > 0
      ? logs.reduce((sum: number, l: any) => sum + (Number(l.elapsed_ms) || 0), 0) / totalRuns
      : 0;

    return {
      stats: {
        totalRuns,
        divergedRuns,
        errorRuns,
        convergenceRate: totalRuns > 0 ? ((totalRuns - divergedRuns) / totalRuns) : null,
        avgElapsedMs: Math.round(avgElapsedMs),
      },
      error: null,
    };
  } catch {
    return { stats: null, error: 'query_failed' };
  }
};
