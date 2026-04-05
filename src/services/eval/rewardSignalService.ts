/**
 * Reward Signal Normalization Service
 *
 * Aggregates multiple reward signals (Discord reactions, session outcomes,
 * citation/retrieval quality, LLM latency) into a single normalized scalar
 * per guild per time window.
 *
 * The blended reward feeds the A/B eval pipeline and policy auto-tuning.
 */

import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseBoundedNumberEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_COMMUNITY_INTERACTION_EVENTS, T_AGENT_SESSIONS, T_MEMORY_RETRIEVAL_LOGS, T_AGENT_LLM_CALL_LOGS, T_REWARD_SIGNAL_SNAPSHOTS } from '../infra/tableRegistry';

const ENABLED = parseBooleanEnv(process.env.REWARD_SIGNAL_ENABLED, true);
const WINDOW_HOURS = Math.max(1, Math.min(168, parseIntegerEnv(process.env.REWARD_SIGNAL_WINDOW_HOURS, 6)));

// Blend weights (must sum to 1.0)
const W_REACTION   = parseBoundedNumberEnv(process.env.REWARD_W_REACTION, 0.20, 0, 1);
const W_SUCCESS    = parseBoundedNumberEnv(process.env.REWARD_W_SUCCESS, 0.35, 0, 1);
const W_CITATION   = parseBoundedNumberEnv(process.env.REWARD_W_CITATION, 0.25, 0, 1);
const W_LATENCY    = parseBoundedNumberEnv(process.env.REWARD_W_LATENCY, 0.20, 0, 1);

// Latency normalization: score = clamp(1 - latency/TARGET, 0, 1)
const LATENCY_TARGET_MS = Math.max(500, parseIntegerEnv(process.env.REWARD_LATENCY_TARGET_MS, 10_000));

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

export type RewardSnapshot = {
  guildId: string;
  windowStart: string;
  windowEnd: string;
  reactionScore: number;
  sessionSuccessRate: number;
  citationRate: number;
  latencyScore: number;
  rewardScalar: number;
  raw: {
    reactionUp: number;
    reactionDown: number;
    sessionTotal: number;
    sessionSucceeded: number;
    retrievalLogsCount: number;
    avgRetrievalScore: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };
};

// ─── Data Collection ────────────────────────────────────────────────
const fetchReactionSignals = async (
  guildId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ up: number; down: number }> => {
  try {
    const qb = fromTable(T_COMMUNITY_INTERACTION_EVENTS);
    if (!qb) return { up: 0, down: 0 };
    // Use real Discord reaction events from community_interaction_events
    // Emoji metadata: {"emoji":"thumbsup"} = up, {"emoji":"rage"} = down
    const { data, error } = await qb
      .select('metadata')
      .eq('guild_id', guildId)
      .eq('event_type', 'reaction')
      .gte('event_ts', windowStart)
      .lte('event_ts', windowEnd)
      .limit(1000);

    if (error || !data || data.length === 0) return { up: 0, down: 0 };

    const POSITIVE_EMOJI = new Set(['thumbsup', '👍', '+1', 'heart', '❤️', '❤', 'fire', '🔥', 'clap', '👏', 'tada', '🎉', 'white_check_mark', '✅']);
    const NEGATIVE_EMOJI = new Set(['thumbsdown', '👎', '-1', 'rage', '😡', 'x', '❌', 'disappointed', '😞', 'confused', '😕']);

    let up = 0;
    let down = 0;
    for (const row of data as Array<{ metadata: Record<string, unknown> }>) {
      const emoji = String(row.metadata?.emoji || '').toLowerCase();
      const isRemove = row.metadata?.direction === 'remove';
      const delta = isRemove ? -1 : 1;
      if (POSITIVE_EMOJI.has(emoji)) up += delta;
      else if (NEGATIVE_EMOJI.has(emoji)) down += delta;
    }
    return { up: Math.max(0, up), down: Math.max(0, down) };
  } catch (err) {
    logger.debug('[REWARD-SIGNAL] emoji-score compute failed: %s', err instanceof Error ? err.message : String(err));
    return { up: 0, down: 0 };
  }
};

const fetchSessionOutcomes = async (
  guildId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ total: number; succeeded: number }> => {
  try {
    const qb = fromTable(T_AGENT_SESSIONS);
    if (!qb) return { total: 0, succeeded: 0 };
    const { data, error } = await qb
      .select('status')
      .eq('guild_id', guildId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .in('status', ['completed', 'failed']);

    if (error || !data) return { total: 0, succeeded: 0 };

    const total = data.length;
    const succeeded = data.filter((r: any) => r.status === 'completed').length;
    return { total, succeeded };
  } catch (err) {
    logger.debug('[REWARD-SIGNAL] session-outcomes fetch failed: %s', err instanceof Error ? err.message : String(err));
    return { total: 0, succeeded: 0 };
  }
};

const fetchRetrievalQuality = async (
  guildId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ count: number; avgScore: number | null }> => {
  try {
    const qb = fromTable(T_MEMORY_RETRIEVAL_LOGS);
    if (!qb) return { count: 0, avgScore: null };
    const { data, error } = await qb
      .select('avg_score')
      .eq('guild_id', guildId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .limit(500);

    if (error || !data || data.length === 0) return { count: 0, avgScore: null };

    const scores = (data as Array<{ avg_score: number | null }>)
      .map((r) => Number(r.avg_score))
      .filter(Number.isFinite);

    if (scores.length === 0) return { count: data.length, avgScore: null };

    const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
    return { count: data.length, avgScore: avg };
  } catch (err) {
    logger.debug('[REWARD-SIGNAL] retrieval-quality metric failed: %s', err instanceof Error ? err.message : String(err));
    return { count: 0, avgScore: null };
  }
};

const fetchLatencyMetrics = async (
  guildId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ avgMs: number | null; p95Ms: number | null }> => {
  try {
    const qb = fromTable(T_AGENT_LLM_CALL_LOGS);
    if (!qb) return { avgMs: null, p95Ms: null };
    const { data, error } = await qb
      .select('latency_ms')
      .eq('guild_id', guildId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .not('latency_ms', 'is', null)
      .limit(1000);

    if (error || !data || data.length === 0) return { avgMs: null, p95Ms: null };

    const latencies = (data as Array<{ latency_ms: number }>)
      .map((r) => Number(r.latency_ms))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (latencies.length === 0) return { avgMs: null, p95Ms: null };

    const avgMs = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
    const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
    const p95Ms = latencies[p95Index];
    return { avgMs, p95Ms };
  } catch (err) {
    logger.debug('[REWARD-SIGNAL] latency-metrics fetch failed: %s', err instanceof Error ? err.message : String(err));
    return { avgMs: null, p95Ms: null };
  }
};

// ─── Reward Computation ─────────────────────────────────────────────
const computeReactionScore = (up: number, down: number): number => {
  const total = up + down;
  if (total === 0) return 0.5; // neutral baseline
  return clamp01(up / total);
};

const computeLatencyScore = (avgMs: number | null): number => {
  if (avgMs === null || !Number.isFinite(avgMs)) return 0.5;
  return clamp01(1 - avgMs / LATENCY_TARGET_MS);
};

const blendReward = (reaction: number, success: number, citation: number, latency: number): number => {
  const wSum = W_REACTION + W_SUCCESS + W_CITATION + W_LATENCY;
  if (wSum <= 0) return 0.5; // neutral when all weights are zero
  // Normalize weights in case they don't sum to 1
  return clamp01(
    (reaction * W_REACTION + success * W_SUCCESS + citation * W_CITATION + latency * W_LATENCY) / wSum,
  );
};

// ─── Public API ─────────────────────────────────────────────────────
export const computeRewardSnapshot = async (guildId: string): Promise<RewardSnapshot | null> => {
  if (!ENABLED || !isSupabaseConfigured()) return null;

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString();
  const windowEndIso = windowEnd.toISOString();

  try {
    const [reactions, sessions, retrieval, latency] = await Promise.all([
      fetchReactionSignals(guildId, windowStartIso, windowEndIso),
      fetchSessionOutcomes(guildId, windowStartIso, windowEndIso),
      fetchRetrievalQuality(guildId, windowStartIso, windowEndIso),
      fetchLatencyMetrics(guildId, windowStartIso, windowEndIso),
    ]);

    const reactionScore = computeReactionScore(reactions.up, reactions.down);
    const sessionSuccessRate = sessions.total > 0 ? clamp01(sessions.succeeded / sessions.total) : 0.5;
    const citationRate = retrieval.avgScore !== null ? clamp01(retrieval.avgScore) : 0.5;
    const latencyScore = computeLatencyScore(latency.avgMs);

    const rewardScalar = blendReward(reactionScore, sessionSuccessRate, citationRate, latencyScore);

    return {
      guildId,
      windowStart: windowStartIso,
      windowEnd: windowEndIso,
      reactionScore,
      sessionSuccessRate,
      citationRate,
      latencyScore,
      rewardScalar,
      raw: {
        reactionUp: reactions.up,
        reactionDown: reactions.down,
        sessionTotal: sessions.total,
        sessionSucceeded: sessions.succeeded,
        retrievalLogsCount: retrieval.count,
        avgRetrievalScore: retrieval.avgScore,
        avgLatencyMs: latency.avgMs,
        p95LatencyMs: latency.p95Ms,
      },
    };
  } catch (err) {
    logger.warn('[REWARD-SIGNAL] computeRewardSnapshot failed guild=%s err=%s', guildId, err instanceof Error ? err.message : String(err));
    return null;
  }
};

export const persistRewardSnapshot = async (snapshot: RewardSnapshot): Promise<boolean> => {
  const db = getClient();
  if (!db) return false;

  try {

    // Atomic upsert: UNIQUE index on (guild_id, window_start) prevents duplicates
    // ON CONFLICT DO NOTHING = safe when reward loop and eval loop overlap
    const { error } = await db.from(T_REWARD_SIGNAL_SNAPSHOTS).upsert({
      guild_id: snapshot.guildId,
      window_start: snapshot.windowStart,
      window_end: snapshot.windowEnd,
      reaction_score: snapshot.reactionScore,
      session_success_rate: snapshot.sessionSuccessRate,
      citation_rate: snapshot.citationRate,
      latency_score: snapshot.latencyScore,
      reward_scalar: snapshot.rewardScalar,
      reaction_up: snapshot.raw.reactionUp,
      reaction_down: snapshot.raw.reactionDown,
      session_total: snapshot.raw.sessionTotal,
      session_succeeded: snapshot.raw.sessionSucceeded,
      retrieval_logs_count: snapshot.raw.retrievalLogsCount,
      avg_retrieval_score: snapshot.raw.avgRetrievalScore,
      avg_latency_ms: snapshot.raw.avgLatencyMs,
      p95_latency_ms: snapshot.raw.p95LatencyMs,
    }, { onConflict: 'guild_id,window_start', ignoreDuplicates: true });

    if (error) {
      logger.warn('[REWARD-SIGNAL] persist failed guild=%s: %s', snapshot.guildId, error.message);
      return false;
    }

    // Circuit 2: After persisting reward, trigger behavior adjustment
    void import('../entityNervousSystem').then((m) => m.adjustBehaviorFromReward(snapshot.guildId)).catch(() => { /* best-effort */ });

    return true;
  } catch (err) {
    logger.warn('[REWARD-SIGNAL] reward-persist failed guild=%s: %s', snapshot.guildId, err instanceof Error ? err.message : String(err));
    return false;
  }
};

/**
 * Fetch recent reward snapshots for trend analysis.
 */
export const getRecentRewardSnapshots = async (
  guildId: string,
  limit = 20,
): Promise<RewardSnapshot[]> => {
  const qb = fromTable(T_REWARD_SIGNAL_SNAPSHOTS);
  if (!qb) return [];

  try {
    const { data, error } = await qb
      .select('*')
      .eq('guild_id', guildId)
      .order('window_end', { ascending: false })
      .limit(Math.min(limit, 100));

    if (error || !data) return [];

    return (data as Record<string, unknown>[]).map((row) => ({
      guildId: String(row.guild_id),
      windowStart: String(row.window_start),
      windowEnd: String(row.window_end),
      reactionScore: Number(row.reaction_score) || 0,
      sessionSuccessRate: Number(row.session_success_rate) || 0,
      citationRate: Number(row.citation_rate) || 0,
      latencyScore: Number(row.latency_score) || 0,
      rewardScalar: Number(row.reward_scalar) || 0,
      raw: {
        reactionUp: Number(row.reaction_up) || 0,
        reactionDown: Number(row.reaction_down) || 0,
        sessionTotal: Number(row.session_total) || 0,
        sessionSucceeded: Number(row.session_succeeded) || 0,
        retrievalLogsCount: Number(row.retrieval_logs_count) || 0,
        avgRetrievalScore: row.avg_retrieval_score != null ? Number(row.avg_retrieval_score) : null,
        avgLatencyMs: row.avg_latency_ms != null ? Number(row.avg_latency_ms) : null,
        p95LatencyMs: row.p95_latency_ms != null ? Number(row.p95_latency_ms) : null,
      },
    }));
  } catch (err) {
    logger.debug('[REWARD-SIGNAL] reward-snapshots fetch failed guild=%s: %s', guildId, err instanceof Error ? err.message : String(err));
    return [];
  }
};

/**
 * Compute the reward trend (positive = improving, negative = degrading).
 */
export const computeRewardTrend = async (
  guildId: string,
): Promise<{ current: number; previous: number; delta: number; trend: 'improving' | 'stable' | 'degrading' } | null> => {
  const snapshots = await getRecentRewardSnapshots(guildId, 10);
  if (snapshots.length < 3) return null;

  // Use recent 3 vs older to smooth out single-snapshot noise
  const recentCount = Math.min(3, Math.floor(snapshots.length / 2));
  const recentSlice = snapshots.slice(0, recentCount);
  const olderSlice = snapshots.slice(recentCount);

  const current = recentSlice.reduce((sum, s) => sum + s.rewardScalar, 0) / recentSlice.length;
  const previous = olderSlice.reduce((sum, s) => sum + s.rewardScalar, 0) / olderSlice.length;
  const delta = current - previous;

  const trend = delta > 0.03 ? 'improving' : delta < -0.03 ? 'degrading' : 'stable';
  return { current, previous, delta, trend };
};
