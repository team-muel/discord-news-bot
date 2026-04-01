import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseNumberEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

export type AgentTotPolicySnapshot = {
  shadowEnabled: boolean;
  strategy: 'bfs' | 'dfs';
  branchAngles: string[];
  adaptiveSamplingEnabled: boolean;
  samplingTempMin: number;
  samplingTempMax: number;
  samplingTopPMin: number;
  samplingTopPMax: number;
  localSearchEnabled: boolean;
  localSearchMutations: number;
  replayEnabled: boolean;
  replayTopK: number;
  maxBranches: number;
  keepTop: number;
  activeEnabled: boolean;
  activeAllowFast: boolean;
  activeMinGoalLength: number;
  activeMinScoreGain: number;
  activeMinBeamGain: number;
  activeRequireNonPass: boolean;
  autoTuneEnabled: boolean;
  autoTuneIntervalHours: number;
  autoTuneMinSamples: number;
};

const AGENT_TOT_POLICY_CACHE_TTL_MS = Math.max(5_000, parseIntegerEnv(process.env.AGENT_TOT_POLICY_CACHE_TTL_MS, 60_000));
const AGENT_TOT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS = Math.max(30_000, parseIntegerEnv(process.env.AGENT_TOT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS, 5 * 60_000));

const parseBranchAnglesEnv = (): string[] => {
  const jsonRaw = String(process.env.TOT_SHADOW_BRANCH_ANGLES_JSON || '').trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter((item) => item.length >= 2)
          .slice(0, 12);
      }
    } catch {
      // Fallback to CSV parsing.
    }
  }

  const csvRaw = String(process.env.TOT_SHADOW_BRANCH_ANGLES || '').trim();
  if (!csvRaw) {
    return [];
  }
  return csvRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
};

const DEFAULT_POLICY: AgentTotPolicySnapshot = {
  shadowEnabled: parseBooleanEnv(process.env.TOT_SHADOW_ENABLED, false),
  strategy: String(process.env.TOT_SHADOW_STRATEGY || 'bfs').trim().toLowerCase() === 'dfs' ? 'dfs' : 'bfs',
  branchAngles: parseBranchAnglesEnv(),
  adaptiveSamplingEnabled: parseBooleanEnv(process.env.TOT_ADAPTIVE_SAMPLING_ENABLED, true),
  samplingTempMin: Math.max(0, Math.min(1, parseNumberEnv(process.env.TOT_SAMPLING_TEMP_MIN, 0.12))),
  samplingTempMax: Math.max(0, Math.min(1, parseNumberEnv(process.env.TOT_SAMPLING_TEMP_MAX, 0.45))),
  samplingTopPMin: Math.max(0, Math.min(1, parseNumberEnv(process.env.TOT_SAMPLING_TOP_P_MIN, 0.82))),
  samplingTopPMax: Math.max(0, Math.min(1, parseNumberEnv(process.env.TOT_SAMPLING_TOP_P_MAX, 0.98))),
  localSearchEnabled: parseBooleanEnv(process.env.TOT_LOCAL_SEARCH_ENABLED, true),
  localSearchMutations: Math.max(0, Math.min(3, parseIntegerEnv(process.env.TOT_LOCAL_SEARCH_MUTATIONS, 1))),
  replayEnabled: parseBooleanEnv(process.env.TOT_REPLAY_ENABLED, true),
  replayTopK: Math.max(0, Math.min(5, parseIntegerEnv(process.env.TOT_REPLAY_TOP_K, 2))),
  maxBranches: Math.max(2, Math.min(6, parseIntegerEnv(process.env.TOT_SHADOW_MAX_BRANCHES, 3))),
  keepTop: Math.max(1, Math.min(3, parseIntegerEnv(process.env.TOT_SHADOW_KEEP_TOP, 1))),
  activeEnabled: parseBooleanEnv(process.env.TOT_ACTIVE_ENABLED, false),
  activeAllowFast: parseBooleanEnv(process.env.TOT_ACTIVE_ALLOW_FAST, false),
  activeMinGoalLength: Math.max(20, parseIntegerEnv(process.env.TOT_ACTIVE_MIN_GOAL_LENGTH, 60)),
  activeMinScoreGain: Math.max(0, Math.min(30, parseIntegerEnv(process.env.TOT_ACTIVE_MIN_SCORE_GAIN, 4))),
  activeMinBeamGain: Math.max(0, Math.min(1, parseNumberEnv(process.env.TOT_ACTIVE_MIN_BEAM_GAIN, 0.03))),
  activeRequireNonPass: parseBooleanEnv(process.env.TOT_ACTIVE_REQUIRE_NON_PASS, false),
  autoTuneEnabled: parseBooleanEnv(process.env.TOT_AUTO_TUNE_ENABLED, true),
  autoTuneIntervalHours: Math.max(1, Math.min(168, parseIntegerEnv(process.env.TOT_AUTO_TUNE_INTERVAL_HOURS, 24))),
  autoTuneMinSamples: Math.max(10, parseIntegerEnv(process.env.TOT_AUTO_TUNE_MIN_SAMPLES, 40)),
};

type TotPolicyCacheRow = AgentTotPolicySnapshot;

let policyCache = new Map<string, TotPolicyCacheRow>();
let cacheLoadedAt = 0;
let cacheLoading: Promise<void> | null = null;
let lastPolicyCacheErrorLogAt = 0;

const MAX_AUTO_TUNE_ENTRIES = 200;
const lastAutoTuneAtByGuild = new Map<string, number>();

const isCacheFresh = () => Date.now() - cacheLoadedAt < AGENT_TOT_POLICY_CACHE_TTL_MS;

const toBoundedInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

const toBoundedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, n));
};

const toBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return parseBooleanEnv(String(value), fallback);
};

const toStrategy = (value: unknown, fallback: 'bfs' | 'dfs'): 'bfs' | 'dfs' => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'dfs' ? 'dfs' : fallback;
};

const toBranchAngles = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const rows = value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length >= 2)
    .slice(0, 12);
  return rows.length > 0 ? rows : [...fallback];
};

const toSnapshot = (row: Record<string, unknown>): AgentTotPolicySnapshot => {
  const tempMin = toBoundedNumber(row.sampling_temp_min, DEFAULT_POLICY.samplingTempMin, 0, 1);
  const tempMax = toBoundedNumber(row.sampling_temp_max, DEFAULT_POLICY.samplingTempMax, 0, 1);
  const topPMin = toBoundedNumber(row.sampling_top_p_min, DEFAULT_POLICY.samplingTopPMin, 0, 1);
  const topPMax = toBoundedNumber(row.sampling_top_p_max, DEFAULT_POLICY.samplingTopPMax, 0, 1);
  return {
    shadowEnabled: toBool(row.shadow_enabled, DEFAULT_POLICY.shadowEnabled),
    strategy: toStrategy(row.strategy, DEFAULT_POLICY.strategy),
    branchAngles: toBranchAngles(row.branch_angles, DEFAULT_POLICY.branchAngles),
    adaptiveSamplingEnabled: toBool(row.adaptive_sampling_enabled, DEFAULT_POLICY.adaptiveSamplingEnabled),
    samplingTempMin: Math.min(tempMin, tempMax),
    samplingTempMax: Math.max(tempMin, tempMax),
    samplingTopPMin: Math.min(topPMin, topPMax),
    samplingTopPMax: Math.max(topPMin, topPMax),
    localSearchEnabled: toBool(row.local_search_enabled, DEFAULT_POLICY.localSearchEnabled),
    localSearchMutations: toBoundedInt(row.local_search_mutations, DEFAULT_POLICY.localSearchMutations, 0, 3),
    replayEnabled: toBool(row.replay_enabled, DEFAULT_POLICY.replayEnabled),
    replayTopK: toBoundedInt(row.replay_top_k, DEFAULT_POLICY.replayTopK, 0, 5),
    maxBranches: toBoundedInt(row.max_branches, DEFAULT_POLICY.maxBranches, 2, 6),
    keepTop: toBoundedInt(row.keep_top, DEFAULT_POLICY.keepTop, 1, 3),
    activeEnabled: toBool(row.active_enabled, DEFAULT_POLICY.activeEnabled),
    activeAllowFast: toBool(row.active_allow_fast, DEFAULT_POLICY.activeAllowFast),
    activeMinGoalLength: toBoundedInt(row.active_min_goal_length, DEFAULT_POLICY.activeMinGoalLength, 20, 4000),
    activeMinScoreGain: toBoundedInt(row.active_min_score_gain, DEFAULT_POLICY.activeMinScoreGain, 0, 30),
    activeMinBeamGain: toBoundedNumber(row.active_min_beam_gain, DEFAULT_POLICY.activeMinBeamGain, 0, 1),
    activeRequireNonPass: toBool(row.active_require_non_pass, DEFAULT_POLICY.activeRequireNonPass),
    autoTuneEnabled: toBool(row.auto_tune_enabled, DEFAULT_POLICY.autoTuneEnabled),
    autoTuneIntervalHours: toBoundedInt(row.auto_tune_interval_hours, DEFAULT_POLICY.autoTuneIntervalHours, 1, 168),
    autoTuneMinSamples: toBoundedInt(row.auto_tune_min_samples, DEFAULT_POLICY.autoTuneMinSamples, 10, 5000),
  };
};

export const refreshAgentTotPolicyCache = async (): Promise<void> => {
  if (!isSupabaseConfigured()) {
    policyCache = new Map();
    cacheLoadedAt = Date.now();
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('agent_tot_policies')
    .select('guild_id, shadow_enabled, strategy, branch_angles, adaptive_sampling_enabled, sampling_temp_min, sampling_temp_max, sampling_top_p_min, sampling_top_p_max, local_search_enabled, local_search_mutations, replay_enabled, replay_top_k, max_branches, keep_top, active_enabled, active_allow_fast, active_min_goal_length, active_min_score_gain, active_min_beam_gain, active_require_non_pass, auto_tune_enabled, auto_tune_interval_hours, auto_tune_min_samples, enabled')
    .eq('enabled', true)
    .limit(500);

  if (error) {
    return;
  }

  const nextCache = new Map<string, TotPolicyCacheRow>();
  for (const raw of data || []) {
    const row = raw as Record<string, unknown>;
    const guildId = String(row.guild_id || '').trim() || '*';
    nextCache.set(guildId, toSnapshot(row));
  }

  policyCache = nextCache;
  cacheLoadedAt = Date.now();
};

export const primeAgentTotPolicyCache = (): void => {
  if (cacheLoading || isCacheFresh()) {
    return;
  }

  cacheLoading = refreshAgentTotPolicyCache()
    .catch((error) => {
      const now = Date.now();
      if (now - lastPolicyCacheErrorLogAt >= AGENT_TOT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS) {
        lastPolicyCacheErrorLogAt = now;
        logger.warn('[AGENT-TOT-POLICY] cache refresh failed (throttled): %s', error instanceof Error ? error.message : String(error));
      }
    })
    .finally(() => {
      cacheLoading = null;
    });
};

export const getAgentTotPolicySnapshot = (guildId?: string): AgentTotPolicySnapshot => {
  primeAgentTotPolicyCache();

  const key = String(guildId || '').trim();
  const cached = (key && policyCache.get(key)) || policyCache.get('*');
  return cached ? { ...cached } : { ...DEFAULT_POLICY };
};

export const recordTotCandidatePair = async (params: {
  guildId: string;
  sessionId: string;
  strategy: 'bfs' | 'dfs';
  baselineScore: number;
  candidateScore: number;
  scoreGain: number;
  beamGain: number;
  promoted: boolean;
  baselineProbability: number;
  baselineProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
  baselineCorrectness: number;
  baselineBeamScore: number;
  candidateProbability: number;
  candidateProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
  candidateCorrectness: number;
  candidateBeamScore: number;
  baselineEvidenceBundleId: string;
  candidateEvidenceBundleId: string;
  baselineResult: string;
  candidateResult: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    await client.from('agent_tot_candidate_pairs').insert({
      guild_id: params.guildId,
      session_id: params.sessionId,
      strategy: params.strategy,
      baseline_score: params.baselineScore,
      candidate_score: params.candidateScore,
      score_gain: params.scoreGain,
      beam_gain: params.beamGain,
      promoted: params.promoted,
      baseline_probability: params.baselineProbability,
      baseline_probability_source: params.baselineProbabilitySource,
      baseline_correctness: params.baselineCorrectness,
      baseline_beam_score: params.baselineBeamScore,
      candidate_probability: params.candidateProbability,
      candidate_probability_source: params.candidateProbabilitySource,
      candidate_correctness: params.candidateCorrectness,
      candidate_beam_score: params.candidateBeamScore,
      baseline_evidence_bundle_id: params.baselineEvidenceBundleId,
      candidate_evidence_bundle_id: params.candidateEvidenceBundleId,
      baseline_result: String(params.baselineResult || '').slice(0, 2000),
      candidate_result: String(params.candidateResult || '').slice(0, 2000),
    });
  } catch {
    // Best-effort logging.
  }
};

export const getTotReplayCandidates = async (params: {
  guildId: string;
  topK: number;
}): Promise<string[]> => {
  const limit = Math.max(0, Math.min(20, Math.trunc(Number(params.topK) || 0)));
  if (limit <= 0 || !isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_tot_candidate_pairs')
      .select('candidate_result, promoted, score_gain, created_at')
      .eq('guild_id', params.guildId)
      .eq('promoted', true)
      .gt('score_gain', 0)
      .order('created_at', { ascending: false })
      .limit(limit * 4);

    if (error) {
      return [];
    }

    const unique: string[] = [];
    for (const row of (data || []) as Array<{ candidate_result?: unknown }>) {
      const text = String(row?.candidate_result || '').trim();
      if (!text) continue;
      if (unique.includes(text)) continue;
      unique.push(text);
      if (unique.length >= limit) {
        break;
      }
    }
    return unique;
  } catch {
    return [];
  }
};

export const maybeAutoTuneAgentTotPolicy = async (guildId: string): Promise<void> => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const policy = getAgentTotPolicySnapshot(guildId);
  if (!policy.autoTuneEnabled) {
    return;
  }

  const now = Date.now();
  const intervalMs = policy.autoTuneIntervalHours * 60 * 60 * 1000;
  const lastRunAt = lastAutoTuneAtByGuild.get(guildId) || 0;
  if (now - lastRunAt < intervalMs) {
    return;
  }

  lastAutoTuneAtByGuild.set(guildId, now);
  if (lastAutoTuneAtByGuild.size > MAX_AUTO_TUNE_ENTRIES) {
    const oldest = lastAutoTuneAtByGuild.keys().next().value;
    if (oldest !== undefined) lastAutoTuneAtByGuild.delete(oldest);
  }

  try {
    const client = getSupabaseClient();
    const sinceIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
      .from('agent_tot_candidate_pairs')
      .select('promoted, score_gain, beam_gain')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      return;
    }

    const rows = (data || []) as Array<{ promoted?: boolean; score_gain?: number; beam_gain?: number }>;
    if (rows.length < policy.autoTuneMinSamples) {
      return;
    }

    const promotedRows = rows.filter((row) => Boolean(row.promoted));
    const promotionRate = promotedRows.length / rows.length;
    const avgGain = promotedRows.length > 0
      ? promotedRows.reduce((acc, row) => acc + Number(row.score_gain || 0), 0) / promotedRows.length
      : 0;
    const avgBeamGain = promotedRows.length > 0
      ? promotedRows.reduce((acc, row) => acc + Number(row.beam_gain || 0), 0) / promotedRows.length
      : 0;

    let nextMaxBranches = policy.maxBranches;
    let nextMinScoreGain = policy.activeMinScoreGain;
    let nextMinBeamGain = policy.activeMinBeamGain;

    if (promotionRate < 0.25) {
      nextMaxBranches = Math.max(2, policy.maxBranches - 1);
      nextMinScoreGain = Math.min(20, policy.activeMinScoreGain + 1);
      nextMinBeamGain = Math.min(0.35, policy.activeMinBeamGain + 0.01);
    } else if (promotionRate > 0.55 && avgGain >= policy.activeMinScoreGain + 1) {
      nextMaxBranches = Math.min(6, policy.maxBranches + 1);
      nextMinScoreGain = Math.max(1, policy.activeMinScoreGain - 1);
      if (avgBeamGain >= policy.activeMinBeamGain) {
        nextMinBeamGain = Math.max(0.005, policy.activeMinBeamGain - 0.005);
      }
    }

    const tuned = nextMaxBranches !== policy.maxBranches
      || nextMinScoreGain !== policy.activeMinScoreGain
      || nextMinBeamGain !== policy.activeMinBeamGain;
    if (!tuned) {
      return;
    }

    await client.from('agent_tot_policies').upsert({
      guild_id: guildId,
      enabled: true,
      strategy: policy.strategy,
      shadow_enabled: policy.shadowEnabled,
      branch_angles: policy.branchAngles,
      adaptive_sampling_enabled: policy.adaptiveSamplingEnabled,
      sampling_temp_min: policy.samplingTempMin,
      sampling_temp_max: policy.samplingTempMax,
      sampling_top_p_min: policy.samplingTopPMin,
      sampling_top_p_max: policy.samplingTopPMax,
      local_search_enabled: policy.localSearchEnabled,
      local_search_mutations: policy.localSearchMutations,
      replay_enabled: policy.replayEnabled,
      replay_top_k: policy.replayTopK,
      max_branches: nextMaxBranches,
      keep_top: policy.keepTop,
      active_enabled: policy.activeEnabled,
      active_allow_fast: policy.activeAllowFast,
      active_min_goal_length: policy.activeMinGoalLength,
      active_min_score_gain: nextMinScoreGain,
      active_min_beam_gain: nextMinBeamGain,
      active_require_non_pass: policy.activeRequireNonPass,
      auto_tune_enabled: policy.autoTuneEnabled,
      auto_tune_interval_hours: policy.autoTuneIntervalHours,
      auto_tune_min_samples: policy.autoTuneMinSamples,
      updated_by: 'system:auto-tune',
      last_auto_tuned_at: new Date().toISOString(),
      last_auto_tune_summary: JSON.stringify({
        windowDays: 7,
        samples: rows.length,
        promotionRate,
        avgGain,
        avgBeamGain,
        old: {
          maxBranches: policy.maxBranches,
          minScoreGain: policy.activeMinScoreGain,
          minBeamGain: policy.activeMinBeamGain,
        },
        next: {
          maxBranches: nextMaxBranches,
          minScoreGain: nextMinScoreGain,
          minBeamGain: nextMinBeamGain,
        },
      }),
    }, { onConflict: 'guild_id' });

    void refreshAgentTotPolicyCache();
  } catch {
    // Best-effort auto-tuning.
  }
};
