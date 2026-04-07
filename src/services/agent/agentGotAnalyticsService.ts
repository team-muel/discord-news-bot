import { parseBoundedNumberEnv, parseMinIntEnv, parseNumberEnv } from '../../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

type DashboardParams = {
  guildId: string;
  days?: number;
};

const ORM_REVIEW_THRESHOLD = parseBoundedNumberEnv(process.env.ORM_RULE_REVIEW_THRESHOLD, 55, 0, 100);
const GOT_CUTOVER_MIN_RUNS = parseMinIntEnv(process.env.GOT_CUTOVER_MIN_RUNS, 30, 1);
const GOT_CUTOVER_MIN_SCORE_DELTA = parseNumberEnv(process.env.GOT_CUTOVER_MIN_SCORE_DELTA, 0);
const GOT_CUTOVER_MIN_LATENCY_GAIN_MS = parseNumberEnv(process.env.GOT_CUTOVER_MIN_LATENCY_GAIN_MS, 0);
const GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT = parseNumberEnv(process.env.GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT, 0);
const GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES = parseMinIntEnv(process.env.GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES, 20, 0);

const avg = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  return Number((values.reduce((acc, v) => acc + v, 0) / values.length).toFixed(4));
};

const avgFromSum = (sum: number, count: number): number | null => {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) {
    return null;
  }
  return Number((sum / count).toFixed(4));
};

const pct = (n: number, d: number): number | null => {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return null;
  }
  return Number(((n / d) * 100).toFixed(2));
};

const toMs = (startedAt: unknown, endedAt: unknown): number | null => {
  const s = Date.parse(String(startedAt || ''));
  const e = Date.parse(String(endedAt || ''));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) {
    return null;
  }
  return Math.max(0, Math.trunc(e - s));
};

const normalizeDays = (days: number | undefined): number => {
  const d = Number(days);
  if (!Number.isFinite(d)) {
    return 14;
  }
  return Math.max(1, Math.min(90, Math.trunc(d)));
};

export const buildGotPerformanceDashboard = async (params: DashboardParams) => {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = normalizeDays(params.days);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const client = getSupabaseClient();

  const [totRes, gotRes, semanticCacheRes, retrievalEvalRes, qualityReviewRes] = await Promise.all([
    client
      .from('agent_tot_candidate_pairs')
      .select('session_id, baseline_score, candidate_score, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(5000),
    client
      .from('agent_got_runs')
      .select('session_id, selected_score, status, started_at, ended_at, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(5000),
    client
      .from('agent_semantic_answer_cache')
      .select('id, hit_count, created_at, last_hit_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(5000),
    client
      .from('retrieval_eval_results')
      .select('variant, ndcg, hit_at_k, latency_ms, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(5000),
    client
      .from('agent_answer_quality_reviews')
      .select('strategy, is_hallucination, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(5000),
  ]);

  if (totRes.error) {
    throw new Error(totRes.error.message || 'AGENT_GOT_DASHBOARD_TOT_QUERY_FAILED');
  }
  if (gotRes.error) {
    throw new Error(gotRes.error.message || 'AGENT_GOT_DASHBOARD_GOT_QUERY_FAILED');
  }
  if (semanticCacheRes.error) {
    throw new Error(semanticCacheRes.error.message || 'AGENT_GOT_DASHBOARD_SEMANTIC_CACHE_QUERY_FAILED');
  }
  if (retrievalEvalRes.error) {
    throw new Error(retrievalEvalRes.error.message || 'AGENT_GOT_DASHBOARD_RETRIEVAL_EVAL_QUERY_FAILED');
  }
  if (qualityReviewRes.error) {
    throw new Error(qualityReviewRes.error.message || 'AGENT_GOT_DASHBOARD_QUALITY_REVIEW_QUERY_FAILED');
  }

  const totRows = (totRes.data || []) as Array<Record<string, unknown>>;
  const gotRows = (gotRes.data || []) as Array<Record<string, unknown>>;
  const semanticCacheRows = (semanticCacheRes.data || []) as Array<Record<string, unknown>>;
  const retrievalEvalRows = (retrievalEvalRes.data || []) as Array<Record<string, unknown>>;
  const qualityReviewRows = (qualityReviewRes.data || []) as Array<Record<string, unknown>>;

  const totCandidateScores: number[] = [];
  const totBaselineScores: number[] = [];
  const gotSelectedScores: number[] = [];
  const gotLatencySamplesMs: number[] = [];

  let gotCompletedRuns = 0;
  let totHallucinationCount = 0;
  let gotHallucinationCount = 0;

  // ToT latency proxy: intra-session candidate-pair window (max(created_at)-min(created_at)).
  const totBySession = new Map<string, { min: number; max: number }>();

  for (const row of totRows) {
    const candidateScore = Number(row.candidate_score || 0);
    if (Number.isFinite(candidateScore)) {
      totCandidateScores.push(candidateScore);
      if (candidateScore < ORM_REVIEW_THRESHOLD) {
        totHallucinationCount += 1;
      }
    }

    const baselineScore = Number(row.baseline_score || 0);
    if (Number.isFinite(baselineScore)) {
      totBaselineScores.push(baselineScore);
    }

    const sessionId = String(row.session_id || '').trim();
    const ts = Date.parse(String(row.created_at || ''));
    if (!sessionId || !Number.isFinite(ts)) {
      continue;
    }
    const current = totBySession.get(sessionId);
    if (!current) {
      totBySession.set(sessionId, { min: ts, max: ts });
      continue;
    }
    if (ts < current.min) current.min = ts;
    if (ts > current.max) current.max = ts;
  }

  for (const row of gotRows) {
    const selectedScore = Number(row.selected_score);
    if (Number.isFinite(selectedScore) && selectedScore >= 0) {
      const normalizedScore = Number((selectedScore * 100).toFixed(4));
      gotSelectedScores.push(normalizedScore);
      if (normalizedScore < ORM_REVIEW_THRESHOLD) {
        gotHallucinationCount += 1;
      }
    }

    const latencyMs = toMs(row.started_at, row.ended_at);
    if (latencyMs !== null && Number.isFinite(latencyMs)) {
      gotLatencySamplesMs.push(latencyMs);
    }

    if (String(row.status || '') === 'completed') {
      gotCompletedRuns += 1;
    }
  }

  const totScoreAvg = avg(totCandidateScores);
  const gotScoreAvg = avg(gotSelectedScores);
  const totBaselineAvg = avg(totBaselineScores);

  const totLatencySamplesMs = [...totBySession.values()]
    .map((row) => Math.max(0, row.max - row.min));

  const totAvgLatencyMs = avg(totLatencySamplesMs);
  const gotAvgLatencyMs = avg(gotLatencySamplesMs);
  const avgLatencyGainMs = Number.isFinite(Number(totAvgLatencyMs)) && Number.isFinite(Number(gotAvgLatencyMs))
    ? Number(((Number(totAvgLatencyMs) - Number(gotAvgLatencyMs))).toFixed(2))
    : null;

  const totHallucinationRate = pct(totHallucinationCount, totCandidateScores.length);
  const gotHallucinationRate = pct(gotHallucinationCount, gotSelectedScores.length);

  const semanticCacheEntries = semanticCacheRows.length;
  const semanticCacheHitCounts: number[] = [];
  let semanticCacheTotalHits = 0;
  let semanticCacheReusedEntries = 0;
  for (const row of semanticCacheRows) {
    const hitCount = Math.max(0, Math.trunc(Number(row.hit_count || 0)));
    if (!Number.isFinite(hitCount)) {
      continue;
    }
    semanticCacheHitCounts.push(hitCount);
    semanticCacheTotalHits += hitCount;
    if (hitCount > 0) {
      semanticCacheReusedEntries += 1;
    }
  }
  const semanticCacheReuseRatePct = pct(semanticCacheReusedEntries, semanticCacheEntries);
  const semanticCacheAvgHitsPerEntry = avg(semanticCacheHitCounts);
  const estimatedLlmCallsSaved = semanticCacheTotalHits;

  let retrievalBaselineSamples = 0;
  let retrievalBaselineHitPositiveCount = 0;
  let retrievalNdcgSum = 0;
  let retrievalNdcgCount = 0;
  let retrievalLatencySum = 0;
  let retrievalLatencyCount = 0;

  for (const row of retrievalEvalRows) {
    if (String(row.variant || '').trim() !== 'baseline') {
      continue;
    }

    retrievalBaselineSamples += 1;

    const ndcg = Number(row.ndcg || 0);
    if (Number.isFinite(ndcg) && ndcg >= 0) {
      retrievalNdcgSum += ndcg;
      retrievalNdcgCount += 1;
    }

    const hitAtK = Number(row.hit_at_k || 0);
    if (Number.isFinite(hitAtK) && hitAtK > 0) {
      retrievalBaselineHitPositiveCount += 1;
    }

    const latencyMs = Number(row.latency_ms || 0);
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      retrievalLatencySum += latencyMs;
      retrievalLatencyCount += 1;
    }
  }

  const retrievalNdcgAvg = avgFromSum(retrievalNdcgSum, retrievalNdcgCount);
  const retrievalHitRatePct = pct(retrievalBaselineHitPositiveCount, retrievalBaselineSamples);
  const retrievalLatencyMsAvg = avgFromSum(retrievalLatencySum, retrievalLatencyCount);

  const gotVsTotScoreDelta = Number.isFinite(Number(gotScoreAvg)) && Number.isFinite(Number(totScoreAvg))
    ? Number((Number(gotScoreAvg) - Number(totScoreAvg)).toFixed(2))
    : null;
  const hallucinationDeltaPct = Number.isFinite(Number(totHallucinationRate)) && Number.isFinite(Number(gotHallucinationRate))
    ? Number((Number(gotHallucinationRate) - Number(totHallucinationRate)).toFixed(2))
    : null;

  let labeledBaselineSamples = 0;
  let labeledGotSamples = 0;
  let labeledBaselineHallucinations = 0;
  let labeledGotHallucinations = 0;

  for (const row of qualityReviewRows) {
    const strategy = String(row.strategy || '').trim();
    if (strategy === 'baseline') {
      labeledBaselineSamples += 1;
      if (row.is_hallucination === true) {
        labeledBaselineHallucinations += 1;
      }
      continue;
    }

    if (strategy === 'got') {
      labeledGotSamples += 1;
      if (row.is_hallucination === true) {
        labeledGotHallucinations += 1;
      }
    }
  }

  const labeledBaselineRatePct = pct(labeledBaselineHallucinations, labeledBaselineSamples);
  const labeledGotRatePct = pct(labeledGotHallucinations, labeledGotSamples);
  const labeledDeltaPct = Number.isFinite(Number(labeledBaselineRatePct)) && Number.isFinite(Number(labeledGotRatePct))
    ? Number((Number(labeledGotRatePct) - Number(labeledBaselineRatePct)).toFixed(2))
    : null;
  const hasEnoughLabeledSamples = labeledBaselineSamples >= GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES
    && labeledGotSamples >= GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES;

  const effectiveHallucinationDeltaPct = hasEnoughLabeledSamples
    ? labeledDeltaPct
    : hallucinationDeltaPct;

  const cutoverChecks = {
    minRuns: gotRows.length >= GOT_CUTOVER_MIN_RUNS,
    scoreDelta: gotVsTotScoreDelta !== null && gotVsTotScoreDelta >= GOT_CUTOVER_MIN_SCORE_DELTA,
    latencyGain: avgLatencyGainMs !== null && avgLatencyGainMs >= GOT_CUTOVER_MIN_LATENCY_GAIN_MS,
    hallucinationDelta: effectiveHallucinationDeltaPct !== null && effectiveHallucinationDeltaPct <= GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT,
  };

  const cutoverFailedReasons: string[] = [];
  if (!cutoverChecks.minRuns) {
    cutoverFailedReasons.push(`insufficient_got_runs(min=${GOT_CUTOVER_MIN_RUNS},actual=${gotRows.length})`);
  }
  if (!cutoverChecks.scoreDelta) {
    cutoverFailedReasons.push(`score_delta_below_threshold(min=${GOT_CUTOVER_MIN_SCORE_DELTA},actual=${gotVsTotScoreDelta ?? 'n/a'})`);
  }
  if (!cutoverChecks.latencyGain) {
    cutoverFailedReasons.push(`latency_gain_below_threshold(min_ms=${GOT_CUTOVER_MIN_LATENCY_GAIN_MS},actual=${avgLatencyGainMs ?? 'n/a'})`);
  }
  if (!cutoverChecks.hallucinationDelta) {
    cutoverFailedReasons.push(`hallucination_delta_above_threshold(max_pct=${GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT},actual=${effectiveHallucinationDeltaPct ?? 'n/a'})`);
  }

  return {
    guildId,
    windowDays: days,
    generatedAt: new Date().toISOString(),
    metrics: {
      score: {
        totCandidateAvg: totScoreAvg,
        totBaselineAvg,
        gotSelectedAvg: gotScoreAvg,
        gotVsTotDelta: gotVsTotScoreDelta,
      },
      latency: {
        totAvgMs: totAvgLatencyMs,
        gotAvgMs: gotAvgLatencyMs,
        avgGainMs: avgLatencyGainMs,
        gainInterpretation: avgLatencyGainMs === null
          ? 'insufficient_data'
          : avgLatencyGainMs >= 0
            ? 'got_faster_or_equal'
            : 'got_slower',
      },
      hallucination: {
        thresholdScore: ORM_REVIEW_THRESHOLD,
        totRatePct: totHallucinationRate,
        gotRatePct: gotHallucinationRate,
        deltaPct: hallucinationDeltaPct,
        proxy: 'score_below_review_threshold',
      },
      semanticCache: {
        entries: semanticCacheEntries,
        reusedEntries: semanticCacheReusedEntries,
        reuseRatePct: semanticCacheReuseRatePct,
        totalHits: semanticCacheTotalHits,
        avgHitsPerEntry: semanticCacheAvgHitsPerEntry,
        estimatedLlmCallsSaved,
      },
      qualityEvidence: {
        retrievalBaselineSamples,
        retrievalBaselineNdcgAvg: retrievalNdcgAvg,
        retrievalBaselineHitRatePct: retrievalHitRatePct,
        retrievalBaselineLatencyMsAvg: retrievalLatencyMsAvg,
        labeledHallucination: {
          baselineSamples: labeledBaselineSamples,
          gotSamples: labeledGotSamples,
          baselineRatePct: labeledBaselineRatePct,
          gotRatePct: labeledGotRatePct,
          deltaPct: labeledDeltaPct,
          sufficientSamples: hasEnoughLabeledSamples,
          minSamplesPerArm: GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES,
        },
      },
      cutoverReadiness: {
        recommended: cutoverFailedReasons.length === 0,
        checks: cutoverChecks,
        thresholds: {
          minRuns: GOT_CUTOVER_MIN_RUNS,
          minScoreDelta: GOT_CUTOVER_MIN_SCORE_DELTA,
          minLatencyGainMs: GOT_CUTOVER_MIN_LATENCY_GAIN_MS,
          maxHallucinationDeltaPct: GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT,
          minLabeledHallucinationSamplesPerArm: GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES,
        },
        hallucinationSource: hasEnoughLabeledSamples ? 'human_labeled' : 'score_proxy',
        failedReasons: cutoverFailedReasons,
      },
    },
    samples: {
      totPairs: totRows.length,
      totSessionsForLatency: totLatencySamplesMs.length,
      gotRuns: gotRows.length,
      gotRunsWithLatency: gotLatencySamplesMs.length,
      gotCompletedRuns,
      semanticCacheEntries,
      retrievalEvalRows: retrievalEvalRows.length,
      qualityReviewRows: qualityReviewRows.length,
    },
    notes: [
      'tot latency is proxy based on candidate-pair timestamps per session',
      'hallucination rate is proxy based on score threshold, not human-labeled truth',
      'semantic cache metrics are derived from cache row hit_count accumulation',
      'retrieval baseline quality evidence is from retrieval_eval_results (variant=baseline)',
      'cutover readiness is recommendation-only and should be combined with operational readiness checks',
    ],
  };
};
