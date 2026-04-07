/**
 * Traffic Routing Service — Phase 2 of LangGraph cutover
 *
 * Decides which execution path a session should take:
 *   - 'main'      → Current multiAgentService pipeline (default)
 *   - 'shadow'    → Main pipeline + parallel shadow graph (Phase 1, existing)
 *   - 'langgraph' → Full LangGraph executor as primary (Phase 3, future)
 *
 * Decision factors:
 *   1. GOT cutover readiness (performance dashboard metrics)
 *   2. Stable bucket rollout (SHA1-based, per guild:session)
 *   3. Shadow divergence rate (rolling quality signal)
 *   4. Guild-level traffic policy overrides
 *
 * All routing decisions are persisted to traffic_routing_decisions for
 * audit trail and rollback analysis.
 */

import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseNumberEnv } from '../../utils/env';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import { TtlCache } from '../../utils/ttlCache';
import type { AgentPriority } from '../agent/agentRuntimeTypes';
import type { AgentGotCutoverDecision } from '../agent/agentGotCutoverService';
import { getErrorMessage } from '../../utils/errorMessage';

// ──── Configuration ──────────────────────────────────────────────────────────

export const TRAFFIC_ROUTING_ENABLED = parseBooleanEnv(process.env.TRAFFIC_ROUTING_ENABLED, false);
const TRAFFIC_ROUTING_MODE = (process.env.TRAFFIC_ROUTING_MODE || 'shadow') as TrafficRoute;
const TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD = Math.max(0, Math.min(1, parseNumberEnv(process.env.TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD, 0.3)));
const TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD = Math.max(-1, Math.min(0, parseNumberEnv(process.env.TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD, -0.2)));
const TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES = Math.max(10, parseIntegerEnv(process.env.TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES, 50));
const TRAFFIC_ROUTING_STATS_WINDOW_HOURS = Math.max(1, parseIntegerEnv(process.env.TRAFFIC_ROUTING_STATS_WINDOW_HOURS, 72));
const TRAFFIC_ROUTING_STATS_CACHE_TTL_MS = Math.max(5_000, parseIntegerEnv(process.env.TRAFFIC_ROUTING_STATS_CACHE_TTL_MS, 60_000));

// ──── Types ──────────────────────────────────────────────────────────────────

export type TrafficRoute = 'main' | 'shadow' | 'langgraph';

export type TrafficRoutingDecision = {
  route: TrafficRoute;
  reason: string;
  gotCutoverAllowed: boolean;
  rolloutPercentage: number;
  stableBucket: number;
  shadowDivergenceRate: number | null;
  shadowQualityDelta: number | null;
  readinessRecommended: boolean;
  policySnapshot: Record<string, unknown>;
};

export type TrafficRoutingInput = {
  sessionId: string;
  guildId: string;
  priority: AgentPriority;
  gotCutoverDecision: AgentGotCutoverDecision;
};

export type ShadowDivergenceStats = {
  totalSamples: number;
  divergenceRate: number;
  avgQualityDelta: number;
  windowHours: number;
};

// ──── Rolling Shadow Stats Cache ─────────────────────────────────────────────

const statsCache = new TtlCache<ShadowDivergenceStats>(100);

export const getShadowDivergenceStatsForRouting = async (
  guildId: string,
): Promise<ShadowDivergenceStats> => {
  const cacheKey = `shadow-stats:${guildId}`;
  const cached = statsCache.get(cacheKey);
  if (cached) return cached;

  const fallback: ShadowDivergenceStats = {
    totalSamples: 0,
    divergenceRate: 1, // Conservative: assume full divergence when no data
    avgQualityDelta: -1,
    windowHours: TRAFFIC_ROUTING_STATS_WINDOW_HOURS,
  };

  if (!isSupabaseConfigured()) return fallback;

  try {
    const client = getSupabaseClient();
    const windowStart = new Date(
      Date.now() - TRAFFIC_ROUTING_STATS_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await client
      .from('shadow_graph_divergence_logs')
      .select('diverge_at_index, quality_delta')
      .eq('guild_id', guildId)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !data || data.length === 0) {
      statsCache.set(cacheKey, fallback, TRAFFIC_ROUTING_STATS_CACHE_TTL_MS);
      return fallback;
    }

    const total = data.length;
    const diverged = data.filter((row) => row.diverge_at_index !== null).length;
    const deltas = data
      .map((row) => row.quality_delta as number | null)
      .filter((d): d is number => d !== null && Number.isFinite(d));

    const stats: ShadowDivergenceStats = {
      totalSamples: total,
      divergenceRate: total > 0 ? diverged / total : 1,
      avgQualityDelta: deltas.length > 0
        ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length
        : -1,
      windowHours: TRAFFIC_ROUTING_STATS_WINDOW_HOURS,
    };

    statsCache.set(cacheKey, stats, TRAFFIC_ROUTING_STATS_CACHE_TTL_MS);
    return stats;
  } catch {
    statsCache.set(cacheKey, fallback, TRAFFIC_ROUTING_STATS_CACHE_TTL_MS);
    return fallback;
  }
};

// ──── Core Decision Engine ───────────────────────────────────────────────────

export const resolveTrafficRoute = async (
  input: TrafficRoutingInput,
): Promise<TrafficRoutingDecision> => {
  const { sessionId, guildId, gotCutoverDecision } = input;

  // Gate 0: Feature flag
  if (!TRAFFIC_ROUTING_ENABLED) {
    return buildDecision({
      route: 'main',
      reason: 'traffic_routing_disabled',
      gotCutoverDecision,
      stats: null,
    });
  }

  // Gate 1: GOT cutover readiness
  if (!gotCutoverDecision.readinessRecommended) {
    return buildDecision({
      route: TRAFFIC_ROUTING_MODE === 'shadow' ? 'shadow' : 'main',
      reason: `got_dashboard_not_ready:${gotCutoverDecision.failedReasons.join(',')}`,
      gotCutoverDecision,
      stats: null,
    });
  }

  // Gate 2: Rollout bucket
  if (!gotCutoverDecision.selectedByRollout) {
    return buildDecision({
      route: 'shadow',
      reason: 'rollout_holdout',
      gotCutoverDecision,
      stats: null,
    });
  }

  // Gate 3: Shadow divergence quality
  const stats = await getShadowDivergenceStatsForRouting(guildId);

  if (stats.totalSamples < TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES) {
    return buildDecision({
      route: 'shadow',
      reason: `insufficient_shadow_samples:${stats.totalSamples}/${TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES}`,
      gotCutoverDecision,
      stats,
    });
  }

  if (stats.divergenceRate > TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD) {
    return buildDecision({
      route: 'shadow',
      reason: `high_divergence_rate:${stats.divergenceRate.toFixed(3)}>${TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD}`,
      gotCutoverDecision,
      stats,
    });
  }

  if (stats.avgQualityDelta < TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD) {
    return buildDecision({
      route: 'shadow',
      reason: `low_quality_delta:${stats.avgQualityDelta.toFixed(3)}<${TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD}`,
      gotCutoverDecision,
      stats,
    });
  }

  // All gates passed → route to configured target
  const targetRoute: TrafficRoute = TRAFFIC_ROUTING_MODE === 'langgraph' ? 'langgraph' : 'shadow';
  return buildDecision({
    route: targetRoute,
    reason: `all_gates_passed:mode=${TRAFFIC_ROUTING_MODE}`,
    gotCutoverDecision,
    stats,
  });
};

// ──── Decision Builder ───────────────────────────────────────────────────────

const buildDecision = (params: {
  route: TrafficRoute;
  reason: string;
  gotCutoverDecision: AgentGotCutoverDecision;
  stats: ShadowDivergenceStats | null;
}): TrafficRoutingDecision => {
  const { route, reason, gotCutoverDecision, stats } = params;

  return {
    route,
    reason,
    gotCutoverAllowed: gotCutoverDecision.allowed,
    rolloutPercentage: gotCutoverDecision.rolloutPercentage,
    stableBucket: 0, // Populated by caller from cutover service
    shadowDivergenceRate: stats?.divergenceRate ?? null,
    shadowQualityDelta: stats?.avgQualityDelta ?? null,
    readinessRecommended: gotCutoverDecision.readinessRecommended,
    policySnapshot: {
      trafficRoutingEnabled: TRAFFIC_ROUTING_ENABLED,
      trafficRoutingMode: TRAFFIC_ROUTING_MODE,
      shadowDivergeThreshold: TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD,
      qualityDeltaThreshold: TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD,
      minShadowSamples: TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES,
      statsWindowHours: TRAFFIC_ROUTING_STATS_WINDOW_HOURS,
    },
  };
};

// ──── Persistence ────────────────────────────────────────────────────────────

export const persistTrafficRoutingDecision = async (params: {
  sessionId: string;
  guildId: string;
  decision: TrafficRoutingDecision;
  workflowSessionId?: string;
  sprintPipelineId?: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) return;

  try {
    const client = getSupabaseClient();
    await client.from('traffic_routing_decisions').insert({
      session_id: params.sessionId,
      guild_id: params.guildId,
      route: params.decision.route,
      reason: params.decision.reason,
      got_cutover_allowed: params.decision.gotCutoverAllowed,
      rollout_percentage: params.decision.rolloutPercentage,
      stable_bucket: params.decision.stableBucket,
      shadow_divergence_rate: params.decision.shadowDivergenceRate,
      shadow_quality_delta: params.decision.shadowQualityDelta,
      readiness_recommended: params.decision.readinessRecommended,
      policy_snapshot: params.decision.policySnapshot,
      workflow_session_id: params.workflowSessionId || null,
      sprint_pipeline_id: params.sprintPipelineId || null,
    });
  } catch (err) {
    logger.warn(
      '[TRAFFIC-ROUTING] persist failed session=%s: %s',
      params.sessionId,
      getErrorMessage(err),
    );
  }
};

// ──── Query API ──────────────────────────────────────────────────────────────

export const getRecentTrafficRoutingDecisions = async (
  guildId: string,
  limit = 20,
): Promise<{ data: unknown[] | null; error: string | null }> => {
  if (!isSupabaseConfigured()) return { data: null, error: 'SUPABASE_NOT_CONFIGURED' };

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('traffic_routing_decisions')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));

    if (error) return { data: null, error: error.message };
    return { data: data || [], error: null };
  } catch {
    return { data: null, error: 'query_failed' };
  }
};

export const getTrafficRouteDistribution = async (
  guildId: string,
  windowHours = 24,
): Promise<{ distribution: Record<TrafficRoute, number>; total: number; error: string | null }> => {
  const empty: Record<TrafficRoute, number> = { main: 0, shadow: 0, langgraph: 0 };

  if (!isSupabaseConfigured()) return { distribution: empty, total: 0, error: 'SUPABASE_NOT_CONFIGURED' };

  try {
    const client = getSupabaseClient();
    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await client
      .from('traffic_routing_decisions')
      .select('route')
      .eq('guild_id', guildId)
      .gte('created_at', windowStart);

    if (error) return { distribution: empty, total: 0, error: error.message };

    const rows = (data || []) as Array<{ route: string }>;
    const dist: Record<TrafficRoute, number> = { main: 0, shadow: 0, langgraph: 0 };
    for (const row of rows) {
      const route = row.route as TrafficRoute;
      if (route in dist) dist[route] += 1;
    }

    return { distribution: dist, total: rows.length, error: null };
  } catch {
    return { distribution: empty, total: 0, error: 'query_failed' };
  }
};
