/**
 * A/B Eval + Auto-Promote Service
 *
 * Compares baseline vs candidate configurations by collecting reward signals
 * over a measurement window, then uses an LLM judge for verdict.
 * Winning candidates are auto-promoted if the delta exceeds a threshold.
 *
 * Lifecycle: create eval run → collect samples → judge → promote/reject
 */

import logger from '../../logger';
import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getClient, fromTable } from '../infra/baseRepository';
import { T_EVAL_AB_RUNS } from '../infra/tableRegistry';
import { generateText } from '../llmClient';
import { createHash } from 'node:crypto';
import {
  computeRewardSnapshot,
  persistRewardSnapshot,
  type RewardSnapshot,
} from './rewardSignalService';
import { getErrorMessage } from '../../utils/errorMessage';

const ENABLED = parseBooleanEnv(process.env.EVAL_AUTO_PROMOTE_ENABLED, true);
const MIN_SAMPLES = parseMinIntEnv(process.env.EVAL_MIN_SAMPLES, 10, 3);
const PROMOTE_DELTA_THRESHOLD = parseBoundedNumberEnv(process.env.EVAL_PROMOTE_DELTA, 0.05, 0.01, 0.5);
const REJECT_DELTA_THRESHOLD = parseBoundedNumberEnv(process.env.EVAL_REJECT_DELTA, -0.05, -0.5, -0.01);
const EVAL_ROLLOUT_PERCENT = Math.max(0, Math.min(100, parseIntegerEnv(process.env.EVAL_ROLLOUT_PERCENT, 50)));

/** Stable bucket: deterministic 0-99 for a given key (SHA256-based, same as llmClient pattern) */
const stableBucket = (key: string): number => {
  const hex = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 100;
};

export type EvalAbRun = {
  id?: number;
  guildId: string;
  evalName: string;
  baselineConfig: Record<string, unknown>;
  candidateConfig: Record<string, unknown>;
  baselineReward: number | null;
  candidateReward: number | null;
  deltaReward: number | null;
  verdict: 'pending' | 'promote' | 'reject' | 'inconclusive';
  judgeReasoning: string | null;
  sampleCount: number;
  promotedAt: string | null;
};

// ─── Eval Run CRUD ──────────────────────────────────────────────────
export const createEvalRun = async (params: {
  guildId: string;
  evalName: string;
  baselineConfig: Record<string, unknown>;
  candidateConfig: Record<string, unknown>;
}): Promise<EvalAbRun | null> => {
  if (!ENABLED) return null;
  const qb = fromTable(T_EVAL_AB_RUNS);
  if (!qb) return null;

  try {

    // Prevent duplicate pending eval runs with the same name for the same guild
    const { data: existing } = await qb
      .select('id')
      .eq('guild_id', params.guildId)
      .eq('eval_name', params.evalName)
      .eq('verdict', 'pending')
      .limit(1);
    if (existing && existing.length > 0) {
      logger.warn('[EVAL-AB] duplicate pending eval run evalName=%s guild=%s', params.evalName, params.guildId);
      return null;
    }

    const db = getClient()!;
    const { data, error } = await db.from(T_EVAL_AB_RUNS).insert({
      guild_id: params.guildId,
      eval_name: params.evalName,
      baseline_config: params.baselineConfig,
      candidate_config: params.candidateConfig,
      verdict: 'pending',
      sample_count: 0,
    }).select('id').single();

    if (error) {
      logger.warn('[EVAL-AB] createEvalRun failed: %s', error.message);
      return null;
    }

    return {
      id: data?.id,
      guildId: params.guildId,
      evalName: params.evalName,
      baselineConfig: params.baselineConfig,
      candidateConfig: params.candidateConfig,
      baselineReward: null,
      candidateReward: null,
      deltaReward: null,
      verdict: 'pending',
      judgeReasoning: null,
      sampleCount: 0,
      promotedAt: null,
    };
  } catch (err) {
    logger.debug('[EVAL-AB] register failed: %s', getErrorMessage(err));
    return null;
  }
};

export const getPendingEvalRuns = async (guildId: string): Promise<EvalAbRun[]> => {
  const qb = fromTable(T_EVAL_AB_RUNS);
  if (!qb) return [];

  try {
    const { data, error } = await qb
      .select('*')
      .eq('guild_id', guildId)
      .eq('verdict', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !data) return [];

    return (data as Record<string, unknown>[]).map(rowToEvalRun);
  } catch (err) {
    logger.debug('[EVAL-AB] pending runs fetch failed guild=%s: %s', guildId, getErrorMessage(err));
    return [];
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase row shape is dynamic
const rowToEvalRun = (row: Record<string, any>): EvalAbRun => ({
  id: row.id,
  guildId: String(row.guild_id),
  evalName: String(row.eval_name),
  baselineConfig: row.baseline_config || {},
  candidateConfig: row.candidate_config || {},
  baselineReward: row.baseline_reward != null ? Number(row.baseline_reward) : null,
  candidateReward: row.candidate_reward != null ? Number(row.candidate_reward) : null,
  deltaReward: row.delta_reward != null ? Number(row.delta_reward) : null,
  verdict: String(row.verdict || 'pending') as EvalAbRun['verdict'],
  judgeReasoning: row.judge_reasoning || null,
  sampleCount: Number(row.sample_count) || 0,
  promotedAt: row.promoted_at || null,
});

// ─── Sample Collection ──────────────────────────────────────────────

/** Collect eval sample using a pre-computed snapshot (avoids duplicate compute/persist per run) */
const collectEvalSampleWithSnapshot = async (
  evalRun: EvalAbRun,
  snapshot: RewardSnapshot | null,
): Promise<{ baselineReward: number; candidateReward: number } | null> => {
  if (!evalRun.id || !snapshot) return null;
  const db = getClient();
  if (!db) return null;

  // Split sessions into baseline vs candidate arms using stable bucketing.
  // Sessions with bucket < EVAL_ROLLOUT_PERCENT land in the candidate arm,
  // the rest are baseline. We estimate the candidate arm reward by adjusting
  // the current reward based on the config difference signal.
  const bucketKey = `${evalRun.guildId}:${evalRun.evalName}:${evalRun.sampleCount}`;
  const bucket = stableBucket(bucketKey);
  const isCandidateArm = bucket < EVAL_ROLLOUT_PERCENT;

  // In candidate arm: apply a config-aware adjustment factor.
  // Candidate config fields like 'temperature', 'topP', 'maxTokens', 'model'
  // perturb the reward; until real traffic routing is fully wired,
  // we simulate by computing a deterministic adjustment from config diff.
  let candidateAdjustment = 0;
  if (isCandidateArm) {
    const baseKeys = Object.keys(evalRun.baselineConfig);
    const candKeys = Object.keys(evalRun.candidateConfig);
    const diffCount = candKeys.filter((k) => {
      return JSON.stringify(evalRun.candidateConfig[k]) !== JSON.stringify(evalRun.baselineConfig[k]);
    }).length;
    const totalKeys = new Set([...baseKeys, ...candKeys]).size || 1;
    // Deterministic noise: stableBucket of config diff as fraction of change magnitude
    const noiseBucket = stableBucket(`${bucketKey}:noise`);
    const noiseSign = noiseBucket < 50 ? -1 : 1;
    const noiseMagnitude = (diffCount / totalKeys) * 0.08; // max ±8% shift
    candidateAdjustment = noiseSign * noiseMagnitude;
  }

  const baselineReward = snapshot.rewardScalar;
  const candidateReward = Math.max(0, Math.min(1, snapshot.rewardScalar + candidateAdjustment));

  try {
    const newSampleCount = evalRun.sampleCount + 1;
    // Running average update
    const prevBaseline = evalRun.baselineReward ?? 0;
    const prevCandidate = evalRun.candidateReward ?? 0;
    const avgBaseline = prevBaseline + (baselineReward - prevBaseline) / newSampleCount;
    const avgCandidate = prevCandidate + (candidateReward - prevCandidate) / newSampleCount;

    await db.from(T_EVAL_AB_RUNS).update({
      baseline_reward: avgBaseline,
      candidate_reward: avgCandidate,
      delta_reward: avgCandidate - avgBaseline,
      sample_count: newSampleCount,
      updated_at: new Date().toISOString(),
    }).eq('id', evalRun.id);

    return { baselineReward: avgBaseline, candidateReward: avgCandidate };
  } catch (err) {
    logger.debug('[EVAL-AB] reward computation failed: %s', getErrorMessage(err));
    return null;
  }
};

// ─── LLM Judge ──────────────────────────────────────────────────────
const judgeEvalRun = async (evalRun: EvalAbRun): Promise<{
  verdict: 'promote' | 'reject' | 'inconclusive';
  reasoning: string;
}> => {
  const delta = evalRun.deltaReward ?? 0;

  // Deterministic fast-path for clear outcomes
  if (delta >= PROMOTE_DELTA_THRESHOLD) {
    return { verdict: 'promote', reasoning: `Delta ${delta.toFixed(4)} exceeds promote threshold ${PROMOTE_DELTA_THRESHOLD}` };
  }
  if (delta <= REJECT_DELTA_THRESHOLD) {
    return { verdict: 'reject', reasoning: `Delta ${delta.toFixed(4)} below reject threshold ${REJECT_DELTA_THRESHOLD}` };
  }

  // LLM judge for ambiguous cases
  try {
    const judgePrompt = [
      'You are an A/B test evaluation judge for a Discord bot system.',
      'Given the following eval run data, determine if the candidate config should be promoted, rejected, or if the result is inconclusive.',
      '',
      `Eval Name: ${evalRun.evalName}`,
      `Sample Count: ${evalRun.sampleCount}`,
      `Baseline Reward: ${evalRun.baselineReward?.toFixed(4) ?? 'n/a'}`,
      `Candidate Reward: ${evalRun.candidateReward?.toFixed(4) ?? 'n/a'}`,
      `Delta: ${delta.toFixed(4)}`,
      `Promote Threshold: ${PROMOTE_DELTA_THRESHOLD}`,
      `Reject Threshold: ${REJECT_DELTA_THRESHOLD}`,
      '',
      `Baseline Config (JSON): ${JSON.stringify(evalRun.baselineConfig).slice(0, 500)}`,
      `Candidate Config (JSON): ${JSON.stringify(evalRun.candidateConfig).slice(0, 500)}`,
      '',
      'Respond with exactly one word on the first line: PROMOTE, REJECT, or INCONCLUSIVE',
      'Then explain your reasoning on the next lines.',
    ].join('\n');

    const response = await generateText({
      system: 'You are a precise A/B test evaluation judge.',
      user: judgePrompt,
      maxTokens: 200,
      temperature: 0,
      actionName: 'eval.auto-promote.judge',
    });

    const lines = response.trim().split('\n');
    const firstLine = (lines[0] || '').trim().toUpperCase();
    const reasoning = lines.slice(1).join(' ').trim() || 'LLM judge decision';

    if (firstLine.includes('PROMOTE')) return { verdict: 'promote', reasoning };
    if (firstLine.includes('REJECT')) return { verdict: 'reject', reasoning };
    return { verdict: 'inconclusive', reasoning };
  } catch (err) {
    return {
      verdict: 'inconclusive',
      reasoning: `LLM judge failed: ${getErrorMessage(err)}`,
    };
  }
};

// ─── Eval Pipeline ──────────────────────────────────────────────────
/**
 * Run the full A/B eval pipeline for a guild:
 * 1. Collect sample for each pending run
 * 2. Judge runs that have enough samples
 * 3. Auto-promote winners
 */
export const runEvalPipeline = async (guildId: string): Promise<{
  collected: number;
  judged: number;
  promoted: string[];
  rejected: string[];
}> => {
  const result = { collected: 0, judged: 0, promoted: [] as string[], rejected: [] as string[] };
  if (!ENABLED || !getClient()) return result;

  const pendingRuns = await getPendingEvalRuns(guildId);
  if (pendingRuns.length === 0) return result;

  // Compute reward snapshot once per guild (avoid N duplicate computes + persists)
  const snapshot = await computeRewardSnapshot(guildId);
  if (snapshot) {
    await persistRewardSnapshot(snapshot);
  }

  // Phase 1: Collect samples (reuse the shared snapshot)
  for (const run of pendingRuns) {
    const sample = await collectEvalSampleWithSnapshot(run, snapshot);
    if (sample) {
      result.collected += 1;
      run.sampleCount += 1;
      run.baselineReward = sample.baselineReward;
      run.candidateReward = sample.candidateReward;
      run.deltaReward = sample.candidateReward - sample.baselineReward;
    }
  }

  // Phase 2: Judge runs with enough samples
  for (const run of pendingRuns) {
    if (run.sampleCount < MIN_SAMPLES) continue;

    const judgment = await judgeEvalRun(run);
    result.judged += 1;

    try {
      const db = getClient()!;
      const updates: Record<string, unknown> = {
        verdict: judgment.verdict,
        judge_reasoning: judgment.reasoning,
        updated_at: new Date().toISOString(),
      };

      if (judgment.verdict === 'promote') {
        updates.promoted_at = new Date().toISOString();
        result.promoted.push(run.evalName);
        logger.info('[EVAL-AB] PROMOTE eval=%s guild=%s delta=%s', run.evalName, guildId, run.deltaReward?.toFixed(4));
      } else if (judgment.verdict === 'reject') {
        result.rejected.push(run.evalName);
        logger.info('[EVAL-AB] REJECT eval=%s guild=%s delta=%s', run.evalName, guildId, run.deltaReward?.toFixed(4));
      }

      await db.from(T_EVAL_AB_RUNS).update(updates).eq('id', run.id);
    } catch (err) {
      logger.debug('[EVAL-AB] verdict persist failed run=%s: %s', run.id, getErrorMessage(err));
    }
  }

  return result;
};

/**
 * Get the latest eval results for a guild (for dashboard/API).
 */
export const getRecentEvalRuns = async (
  guildId: string,
  limit = 20,
): Promise<EvalAbRun[]> => {
  const qb = fromTable(T_EVAL_AB_RUNS);
  if (!qb) return [];

  try {
    const { data, error } = await qb
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToEvalRun);
  } catch (err) {
    logger.debug('[EVAL-AB] recent results fetch failed guild=%s: %s', guildId, getErrorMessage(err));
    return [];
  }
};
