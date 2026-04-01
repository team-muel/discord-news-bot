import crypto from 'crypto';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { buildGotPerformanceDashboard } from './agentGotAnalyticsService';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { TtlCache } from '../../utils/ttlCache';

export type AgentGotCutoverDecision = {
  guildId: string;
  allowed: boolean;
  readinessRecommended: boolean;
  rolloutPercentage: number;
  selectedByRollout: boolean;
  reason: string;
  failedReasons: string[];
  evaluatedAt: string;
  windowDays: number;
};

const CUTOVER_WINDOW_DAYS = Math.max(1, Math.min(90, parseIntegerEnv(process.env.GOT_CUTOVER_DASHBOARD_WINDOW_DAYS, 14)));
const CUTOVER_CACHE_TTL_MS = Math.max(5_000, parseIntegerEnv(process.env.GOT_CUTOVER_CACHE_TTL_MS, 60_000));
const CUTOVER_FAIL_OPEN = parseBooleanEnv(process.env.GOT_CUTOVER_FAIL_OPEN, false);
const GOT_ACTIVE_ROLLOUT_PERCENT = Math.max(0, Math.min(100, parseIntegerEnv(process.env.GOT_ACTIVE_ROLLOUT_PERCENT, 100)));

const cache = new TtlCache<AgentGotCutoverDecision>(200);

const nowIso = () => new Date().toISOString();

const buildFallbackDecision = (guildId: string, reason: string, allowed: boolean): AgentGotCutoverDecision => {
  return {
    guildId,
    allowed,
    readinessRecommended: allowed,
    rolloutPercentage: GOT_ACTIVE_ROLLOUT_PERCENT,
    selectedByRollout: allowed,
    reason,
    failedReasons: allowed ? [] : [reason],
    evaluatedAt: nowIso(),
    windowDays: CUTOVER_WINDOW_DAYS,
  };
};

const toPercent = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.trunc(parsed)));
};

const getStableBucket = (key: string): number => {
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
  const n = Number.parseInt(digest, 16);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return n % 100;
};

const resolveCutoverRolloutPercent = async (guildId: string): Promise<number> => {
  if (!isSupabaseConfigured()) {
    return GOT_ACTIVE_ROLLOUT_PERCENT;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_got_cutover_profiles')
    .select('guild_id, enabled, rollout_percentage')
    .in('guild_id', [guildId, '*'])
    .order('guild_id', { ascending: false })
    .limit(2);

  if (error) {
    return GOT_ACTIVE_ROLLOUT_PERCENT;
  }

  const rows = (data || []) as Array<Record<string, unknown>>;
  const guildRow = rows.find((row) => String(row.guild_id || '') === guildId);
  const wildcardRow = rows.find((row) => String(row.guild_id || '') === '*');
  const selected = guildRow || wildcardRow;
  if (!selected) {
    return GOT_ACTIVE_ROLLOUT_PERCENT;
  }

  const enabled = selected.enabled !== false;
  if (!enabled) {
    return 0;
  }
  return toPercent(selected.rollout_percentage, GOT_ACTIVE_ROLLOUT_PERCENT);
};

export const getAgentGotCutoverDecision = async (params: {
  guildId: string;
  sessionId?: string;
  forceRefresh?: boolean;
}): Promise<AgentGotCutoverDecision> => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    return buildFallbackDecision('', 'missing_guild_id', false);
  }

  const cacheKey = `${guildId}`;

  if (!params.forceRefresh) {
    const hit = cache.get(cacheKey);
    if (hit) {
      if (!params.sessionId) {
        return hit;
      }
      const bucket = getStableBucket(`${guildId}:${params.sessionId}`);
      const selectedByRollout = bucket < hit.rolloutPercentage;
      return {
        ...hit,
        selectedByRollout,
        allowed: hit.readinessRecommended && selectedByRollout,
        reason: hit.readinessRecommended
          ? (selectedByRollout ? 'dashboard_recommended_and_rollout_selected' : 'dashboard_recommended_but_rollout_holdout')
          : hit.reason,
      };
    }
  }

  try {
    const dashboard = await buildGotPerformanceDashboard({ guildId, days: CUTOVER_WINDOW_DAYS });
    const readiness = (dashboard as Record<string, any>)?.metrics?.cutoverReadiness as
      | { recommended?: boolean; failedReasons?: string[] }
      | undefined;

    const failedReasons = Array.isArray(readiness?.failedReasons)
      ? readiness?.failedReasons.map((item) => String(item)).filter(Boolean)
      : [];

    const readinessRecommended = readiness?.recommended === true;
    const rolloutPercentage = await resolveCutoverRolloutPercent(guildId);
    const selectedByRollout = params.sessionId
      ? getStableBucket(`${guildId}:${params.sessionId}`) < rolloutPercentage
      : true;
    const allowed = readinessRecommended && selectedByRollout;
    const decision: AgentGotCutoverDecision = {
      guildId,
      readinessRecommended,
      rolloutPercentage,
      selectedByRollout,
      allowed,
      reason: !readinessRecommended
        ? 'dashboard_not_ready'
        : (selectedByRollout ? 'dashboard_recommended_and_rollout_selected' : 'dashboard_recommended_but_rollout_holdout'),
      failedReasons: !readinessRecommended
        ? failedReasons
        : (selectedByRollout ? [] : ['rollout_holdout']),
      evaluatedAt: nowIso(),
      windowDays: CUTOVER_WINDOW_DAYS,
    };

    cache.set(cacheKey, decision, CUTOVER_CACHE_TTL_MS);

    return decision;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const allowed = CUTOVER_FAIL_OPEN;
    const decision = buildFallbackDecision(guildId, `dashboard_error:${message}`, allowed);
    cache.set(cacheKey, decision, CUTOVER_CACHE_TTL_MS);
    return decision;
  }
};
