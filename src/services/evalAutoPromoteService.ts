/**
 * A/B Eval + Auto-Promote Service
 *
 * Compares baseline vs candidate configurations by collecting reward signals
 * over a measurement window, then uses an LLM judge for verdict.
 * Winning candidates are auto-promoted if the delta exceeds a threshold.
 *
 * Lifecycle: create eval run → collect samples → judge → promote/reject
 */

import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { generateText } from './llmClient';
import {
  computeRewardSnapshot,
  persistRewardSnapshot,
  type RewardSnapshot,
} from './rewardSignalService';

const ENABLED = parseBooleanEnv(process.env.EVAL_AUTO_PROMOTE_ENABLED, true);
const MIN_SAMPLES = Math.max(3, parseIntegerEnv(process.env.EVAL_MIN_SAMPLES, 10));
const PROMOTE_DELTA_THRESHOLD = Math.max(0.01, Math.min(0.5, Number(process.env.EVAL_PROMOTE_DELTA || 0.05) || 0.05));
const REJECT_DELTA_THRESHOLD = Math.max(-0.5, Math.min(-0.01, Number(process.env.EVAL_REJECT_DELTA || -0.05) || -0.05));

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
  if (!ENABLED || !isSupabaseConfigured()) return null;

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.from('eval_ab_runs').insert({
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
  } catch {
    return null;
  }
};

export const getPendingEvalRuns = async (guildId: string): Promise<EvalAbRun[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('eval_ab_runs')
      .select('*')
      .eq('guild_id', guildId)
      .eq('verdict', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !data) return [];

    return (data as any[]).map(rowToEvalRun);
  } catch {
    return [];
  }
};

const rowToEvalRun = (row: any): EvalAbRun => ({
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
export const collectEvalSample = async (evalRun: EvalAbRun): Promise<{
  baselineReward: number;
  candidateReward: number;
} | null> => {
  if (!evalRun.id || !isSupabaseConfigured()) return null;

  // Compute current reward for the guild (represents the active config)
  const snapshot = await computeRewardSnapshot(evalRun.guildId);
  if (!snapshot) return null;

  await persistRewardSnapshot(snapshot);

  // For now, baseline = current reward, candidate = simulated with delta
  // In production, this would route % of traffic to candidate config
  const baselineReward = snapshot.rewardScalar;
  const candidateReward = snapshot.rewardScalar; // placeholder until traffic splitting

  try {
    const client = getSupabaseClient();
    const newSampleCount = evalRun.sampleCount + 1;
    // Running average update
    const prevBaseline = evalRun.baselineReward ?? 0;
    const prevCandidate = evalRun.candidateReward ?? 0;
    const avgBaseline = prevBaseline + (baselineReward - prevBaseline) / newSampleCount;
    const avgCandidate = prevCandidate + (candidateReward - prevCandidate) / newSampleCount;

    await client.from('eval_ab_runs').update({
      baseline_reward: avgBaseline,
      candidate_reward: avgCandidate,
      delta_reward: avgCandidate - avgBaseline,
      sample_count: newSampleCount,
      updated_at: new Date().toISOString(),
    }).eq('id', evalRun.id);

    return { baselineReward: avgBaseline, candidateReward: avgCandidate };
  } catch {
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
      `Baseline Config: ${JSON.stringify(evalRun.baselineConfig)}`,
      `Candidate Config: ${JSON.stringify(evalRun.candidateConfig)}`,
      '',
      'Respond with exactly one word on the first line: PROMOTE, REJECT, or INCONCLUSIVE',
      'Then explain your reasoning on the next lines.',
    ].join('\n');

    const response = await generateText({
      system: 'You are a precise A/B test evaluation judge.',
      user: judgePrompt,
      maxTokens: 200,
      temperature: 0,
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
      reasoning: `LLM judge failed: ${err instanceof Error ? err.message : String(err)}`,
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
  if (!ENABLED || !isSupabaseConfigured()) return result;

  const pendingRuns = await getPendingEvalRuns(guildId);
  if (pendingRuns.length === 0) return result;

  // Phase 1: Collect samples
  for (const run of pendingRuns) {
    const sample = await collectEvalSample(run);
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
      const client = getSupabaseClient();
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

      await client.from('eval_ab_runs').update(updates).eq('id', run.id);
    } catch {
      // Best-effort verdict persistence
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
  if (!isSupabaseConfigured()) return [];

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('eval_ab_runs')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 100));

    if (error || !data) return [];
    return (data as any[]).map(rowToEvalRun);
  } catch {
    return [];
  }
};
