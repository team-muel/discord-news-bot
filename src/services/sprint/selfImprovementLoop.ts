/**
 * Self-Improvement Loop — connects the 5 existing independent loops
 * into a unified recursive self-improvement cycle.
 *
 * All data flows through Supabase. The weekly `.mjs` scripts write patterns
 * to `agent_weekly_reports`; this service reads them and decides whether to
 * trigger corrective sprints. No HTTP coupling to external scripts.
 *
 * Connected loops:
 *   1. Lacuna → sprint auto-trigger (capability gap → self-development)
 *   2. Weekly patterns → bugfix sprint (recurring high-severity → auto-fix)
 *   3. Bench regression → root-cause sprint (sustained quality decline → recovery)
 *   4. Cross-loop feedback (meta-quality tracking of self-triggered sprints)
 *
 * Structural layers:
 *   5. Gradient service — aggregate all signals into prioritized improvement targets
 *   6. Convergence monitor — track whether the system is improving over time
 */

import logger from '../../logger';
import {
  SPRINT_ENABLED,
  SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED,
  SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE,
  SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT,
  SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED,
  SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED,
  SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS,
  SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED,
  SELF_IMPROVEMENT_CONVERGENCE_ENABLED,
} from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import {
  createSprintPipeline,
  runFullSprintPipeline,
  markPipelineBlocked,
} from './sprintOrchestrator';

// ──── Types ───────────────────────────────────────────────────────────────────

export type LacunaCandidate = {
  guildId: string;
  goal: string;
  normalizedGoal: string;
  count: number;
  distinctRequestersSize: number;
  score: number;
  lacunaType: string;
  missingActionNames: string[];
};

export type CrossLoopOrigin = {
  sprintId: string;
  originLoop: 'lacuna' | 'weekly-bugfix' | 'bench-regression' | 'manual' | 'scheduled';
  triggeredAt: string;
  objective: string;
};

type GradientSignal = {
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  suggestedAction: string;
};

export type SystemGradient = {
  signals: GradientSignal[];
  topPriority: GradientSignal | null;
  totalScore: number;
  computedAt: string;
};

type ConvergenceTrend = 'improving' | 'stable' | 'degrading' | 'insufficient-data';

export type ConvergenceReport = {
  benchScoreTrend: ConvergenceTrend;
  lacunaCountTrend: ConvergenceTrend;
  qualityScoreTrend: ConvergenceTrend;
  highSeverityPatternTrend: ConvergenceTrend;
  crossLoopSuccessRate: number | null;
  overallVerdict: ConvergenceTrend;
  computedAt: string;
  dataPoints: number;
};

// ──── Step 1: Lacuna → Sprint Auto-Trigger ────────────────────────────────────

let lastLacunaSprintTriggeredAt = 0;
const LACUNA_SPRINT_COOLDOWN_MS = 4 * 60 * 60_000; // 4h

export const triggerLacunaSprintIfNeeded = async (
  candidates: LacunaCandidate[],
): Promise<{ triggered: boolean; sprintId?: string }> => {
  if (!SPRINT_ENABLED || !SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED) {
    return { triggered: false };
  }
  const now = Date.now();
  if (now - lastLacunaSprintTriggeredAt < LACUNA_SPRINT_COOLDOWN_MS) {
    return { triggered: false };
  }
  if (candidates.length < SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT) {
    return { triggered: false };
  }
  const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
  if (totalScore < SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE) {
    return { triggered: false };
  }

  const top = candidates.slice(0, 5);
  const gapSummary = top
    .map((c) => `- [${c.lacunaType}] ${c.goal.slice(0, 100)} (score=${c.score.toFixed(1)}, count=${c.count}, actions=${c.missingActionNames.slice(0, 3).join(',')})`)
    .join('\n');
  const objective = `Auto-triggered capability development: ${candidates.length} gaps (total score ${totalScore.toFixed(1)}).\n\nTop gaps:\n${gapSummary}\n\n[origin:lacuna-sprint]`;

  try {
    const pipeline = createSprintPipeline({
      triggerId: `lacuna-sprint-${now}`,
      triggerType: 'feature-request',
      guildId: top[0].guildId || 'system',
      objective,
      autonomyLevel: 'approve-impl',
    });
    lastLacunaSprintTriggeredAt = now;

    recordCrossLoopOrigin({
      sprintId: pipeline.sprintId, originLoop: 'lacuna',
      triggeredAt: new Date().toISOString(), objective,
    });
    runFullSprintPipeline(pipeline.sprintId).catch((err) => {
      logger.error('[SELF-IMPROVE] lacuna sprint failed sprint=%s: %s', pipeline.sprintId, err);
      markPipelineBlocked(pipeline.sprintId, `Lacuna sprint crashed: ${err instanceof Error ? err.message : String(err)}`);
    });

    logger.info('[SELF-IMPROVE] lacuna sprint triggered sprint=%s candidates=%d score=%.1f', pipeline.sprintId, candidates.length, totalScore);
    return { triggered: true, sprintId: pipeline.sprintId };
  } catch (error) {
    logger.warn('[SELF-IMPROVE] lacuna sprint trigger failed: %s', error instanceof Error ? error.message : String(error));
    return { triggered: false };
  }
};

// ──── Step 2: Weekly Patterns → Bugfix Sprint ─────────────────────────────────

let lastBugfixTriggeredAt = 0;
const BUGFIX_COOLDOWN_MS = 24 * 60 * 60_000; // 24h

export const checkWeeklyPatternsForBugfixTrigger = async (): Promise<{ triggered: boolean; sprintId?: string }> => {
  if (!SPRINT_ENABLED || !SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED || !isSupabaseConfigured()) {
    return { triggered: false };
  }
  const now = Date.now();
  if (now - lastBugfixTriggeredAt < BUGFIX_COOLDOWN_MS) {
    return { triggered: false };
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('agent_weekly_reports')
      .select('baseline_summary')
      .eq('report_kind', 'self_improvement_patterns')
      .gte('created_at', new Date(now - 7 * 24 * 60 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return { triggered: false };
    const summary = data[0].baseline_summary;
    if (!summary) return { triggered: false };

    const highCount: number = summary.highSeverityCount ?? 0;
    const worsened: unknown[] = Array.isArray(summary.regression?.worsened) ? summary.regression.worsened : [];
    if (highCount === 0 && worsened.length === 0) return { triggered: false };

    const patterns = Array.isArray(summary.patterns) ? summary.patterns : [];
    const lines = [
      ...patterns.filter((p: { severity?: string }) => p.severity === 'high').slice(0, 5)
        .map((p: { id?: string; signal?: string }) => `- [HIGH] ${p.id}: ${String(p.signal || '').slice(0, 100)}`),
      ...worsened.slice(0, 5).map((p: unknown) => {
        const w = p as { id?: string; previousSeverity?: string; currentSeverity?: string };
        return `- [WORSENED ${w.previousSeverity}→${w.currentSeverity}] ${w.id}`;
      }),
    ].join('\n');

    const objective = `Auto-triggered bugfix: ${highCount} high-severity, ${worsened.length} worsening.\n\n${lines}\n\n[origin:weekly-bugfix]`;
    const pipeline = createSprintPipeline({
      triggerId: `weekly-bugfix-${now}`,
      triggerType: 'self-improvement',
      guildId: 'system',
      objective,
      autonomyLevel: 'approve-impl',
    });
    lastBugfixTriggeredAt = now;

    recordCrossLoopOrigin({
      sprintId: pipeline.sprintId, originLoop: 'weekly-bugfix',
      triggeredAt: new Date().toISOString(), objective,
    });
    runFullSprintPipeline(pipeline.sprintId).catch((err) => {
      logger.error('[SELF-IMPROVE] bugfix sprint failed sprint=%s: %s', pipeline.sprintId, err);
      markPipelineBlocked(pipeline.sprintId, `Bugfix sprint crashed: ${err instanceof Error ? err.message : String(err)}`);
    });

    logger.info('[SELF-IMPROVE] bugfix sprint triggered sprint=%s high=%d worsened=%d', pipeline.sprintId, highCount, worsened.length);
    return { triggered: true, sprintId: pipeline.sprintId };
  } catch (error) {
    logger.warn('[SELF-IMPROVE] weekly bugfix check failed: %s', error instanceof Error ? error.message : String(error));
    return { triggered: false };
  }
};

// ──── Step 3: Bench Regression → Root-Cause Sprint ────────────────────────────

let lastRegressionTriggeredAt = 0;
const REGRESSION_COOLDOWN_MS = 7 * 24 * 60 * 60_000; // 7 days

export const checkBenchRegressionAndTrigger = async (): Promise<{ triggered: boolean; sprintId?: string; trend?: number[] }> => {
  if (!SPRINT_ENABLED || !SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED || !isSupabaseConfigured()) {
    return { triggered: false };
  }
  const now = Date.now();
  if (now - lastRegressionTriggeredAt < REGRESSION_COOLDOWN_MS) {
    return { triggered: false };
  }

  try {
    const client = getSupabaseClient();
    const windowWeeks = SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS + 1;
    const since = new Date(now - windowWeeks * 7 * 24 * 60 * 60_000).toISOString();

    const { data, error } = await client
      .from('agent_weekly_reports')
      .select('baseline_summary, created_at')
      .eq('report_kind', 'go_no_go_weekly')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error || !data || data.length < windowWeeks) return { triggered: false };

    const scores = data
      .map((row: { baseline_summary?: { candidate_summary?: { successRatePct?: number } } }) =>
        row.baseline_summary?.candidate_summary?.successRatePct)
      .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));

    if (scores.length < windowWeeks) return { triggered: false };

    const recent = scores.slice(-windowWeeks);
    let consecutiveDeclines = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] < recent[i - 1]) consecutiveDeclines++;
      else consecutiveDeclines = 0;
    }
    if (consecutiveDeclines < SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS) {
      return { triggered: false, trend: recent };
    }

    const decline = recent[0] - recent[recent.length - 1];
    const objective = `Auto-triggered regression analysis: quality declined ${consecutiveDeclines} consecutive weeks (${recent.map((s) => s.toFixed(1)).join(' → ')}, Δ${decline.toFixed(1)}%).\n\nActions: identify root cause, revert if needed, add regression guard.\n\n[origin:bench-regression]`;

    const pipeline = createSprintPipeline({
      triggerId: `bench-regression-${now}`,
      triggerType: 'error-detection',
      guildId: 'system',
      objective,
      autonomyLevel: 'approve-impl',
    });
    lastRegressionTriggeredAt = now;

    recordCrossLoopOrigin({
      sprintId: pipeline.sprintId, originLoop: 'bench-regression',
      triggeredAt: new Date().toISOString(), objective,
    });
    runFullSprintPipeline(pipeline.sprintId).catch((err) => {
      logger.error('[SELF-IMPROVE] regression sprint failed sprint=%s: %s', pipeline.sprintId, err);
      markPipelineBlocked(pipeline.sprintId, `Regression sprint crashed: ${err instanceof Error ? err.message : String(err)}`);
    });

    logger.info('[SELF-IMPROVE] regression sprint triggered sprint=%s decline=%.1f%% weeks=%d', pipeline.sprintId, decline, consecutiveDeclines);
    return { triggered: true, sprintId: pipeline.sprintId, trend: recent };
  } catch (error) {
    logger.warn('[SELF-IMPROVE] bench regression check failed: %s', error instanceof Error ? error.message : String(error));
    return { triggered: false };
  }
};

// ──── Step 4: Cross-Loop Feedback Tracking ────────────────────────────────────

const crossLoopOrigins = new Map<string, CrossLoopOrigin>();
const MAX_CROSS_LOOP_ENTRIES = 200;

export const recordCrossLoopOrigin = (origin: CrossLoopOrigin): void => {
  if (!SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED) return;
  crossLoopOrigins.set(origin.sprintId, origin);

  if (crossLoopOrigins.size > MAX_CROSS_LOOP_ENTRIES) {
    const oldest = [...crossLoopOrigins.keys()].slice(0, crossLoopOrigins.size - MAX_CROSS_LOOP_ENTRIES);
    for (const key of oldest) crossLoopOrigins.delete(key);
  }

  // Best-effort persist
  if (isSupabaseConfigured()) {
    getSupabaseClient().from('agent_weekly_reports').upsert({
      report_key: `cross_loop_origin:${origin.sprintId}`,
      report_kind: 'cross_loop_origin',
      guild_id: null,
      baseline_summary: {
        sprintId: origin.sprintId,
        originLoop: origin.originLoop,
        objective: origin.objective.slice(0, 500),
      },
      created_at: origin.triggeredAt,
    }, { onConflict: 'report_key' }).then(() => {}, () => {});
  }
};

export const evaluateCrossLoopOutcomes = async (): Promise<{
  total: number; succeeded: number; failed: number; successRate: number;
  outcomesByOrigin: Record<string, { total: number; succeeded: number }>;
}> => {
  const empty = { total: 0, succeeded: 0, failed: 0, successRate: 0, outcomesByOrigin: {} };
  if (!SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED || !isSupabaseConfigured()) return empty;

  try {
    const client = getSupabaseClient();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

    const { data: origins, error: origErr } = await client
      .from('agent_weekly_reports')
      .select('baseline_summary')
      .eq('report_kind', 'cross_loop_origin')
      .gte('created_at', since);

    if (origErr || !origins || origins.length === 0) return empty;

    const sprintIds = origins
      .map((o: { baseline_summary?: { sprintId?: string } }) => o.baseline_summary?.sprintId)
      .filter((id): id is string => typeof id === 'string');
    if (sprintIds.length === 0) return empty;

    const { data: pipelines } = await client
      .from('sprint_pipelines')
      .select('sprint_id, current_phase, error')
      .in('sprint_id', sprintIds);

    const pipeMap = new Map(
      (pipelines || []).map((p: { sprint_id: string; current_phase?: string }) => [p.sprint_id, p]),
    );

    let succeeded = 0;
    let failed = 0;
    const byOrigin: Record<string, { total: number; succeeded: number }> = {};

    for (const o of origins) {
      const s = o.baseline_summary as { sprintId?: string; originLoop?: string } | undefined;
      if (!s?.sprintId) continue;
      const loop = s.originLoop || 'unknown';
      if (!byOrigin[loop]) byOrigin[loop] = { total: 0, succeeded: 0 };
      byOrigin[loop].total++;
      const pipe = pipeMap.get(s.sprintId) as { current_phase?: string; error?: string } | undefined;
      if (pipe?.current_phase === 'complete') { succeeded++; byOrigin[loop].succeeded++; }
      else if (pipe?.current_phase === 'blocked' || pipe?.current_phase === 'cancelled' || pipe?.error) { failed++; }
    }

    const total = origins.length;
    return { total, succeeded, failed, successRate: total > 0 ? succeeded / total : 0, outcomesByOrigin: byOrigin };
  } catch (error) {
    logger.warn('[SELF-IMPROVE] cross-loop eval failed: %s', error instanceof Error ? error.message : String(error));
    return empty;
  }
};

export const getCrossLoopOriginsSnapshot = (): CrossLoopOrigin[] => [...crossLoopOrigins.values()];

// ──── Step 5: Gradient Service ────────────────────────────────────────────────

export const computeSystemGradient = async (): Promise<SystemGradient> => {
  const emptyGradient: SystemGradient = { signals: [], topPriority: null, totalScore: 0, computedAt: new Date().toISOString() };
  if (!isSupabaseConfigured()) return emptyGradient;

  try {
    const client = getSupabaseClient();
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
    const signals: GradientSignal[] = [];

    // Signal: Lacuna gaps
    const { data: lacunaData } = await client
      .from('agent_action_logs')
      .select('error, goal')
      .in('error', ['ACTION_NOT_IMPLEMENTED', 'DYNAMIC_WORKER_NOT_FOUND'])
      .gte('created_at', twoWeeksAgo)
      .limit(100);
    if (lacunaData && lacunaData.length > 0) {
      const uniqueGoals = new Set(lacunaData.map((r: { goal?: string }) => String(r.goal || '').slice(0, 50)));
      signals.push({
        source: 'lacuna-detector',
        severity: lacunaData.length >= 20 ? 'high' : lacunaData.length >= 10 ? 'medium' : 'low',
        score: Math.min(10, lacunaData.length / 5),
        description: `${lacunaData.length} capability gaps across ${uniqueGoals.size} goals`,
        suggestedAction: 'Trigger capability development sprint',
      });
    }

    // Signal: Quality deficit
    const { data: qualityData } = await client
      .from('agent_weekly_reports')
      .select('baseline_summary')
      .eq('report_kind', 'go_no_go_weekly')
      .gte('created_at', twoWeeksAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (qualityData && qualityData.length > 0) {
      const rate = (qualityData[0].baseline_summary as { candidate_summary?: { successRatePct?: number } })
        ?.candidate_summary?.successRatePct ?? 100;
      if (rate < 95) {
        signals.push({
          source: 'quality-gate',
          severity: rate < 80 ? 'critical' : rate < 90 ? 'high' : 'medium',
          score: Math.min(10, (100 - rate) / 5),
          description: `Success rate ${rate.toFixed(1)}% (target 95%+)`,
          suggestedAction: 'Review provider config and fallback chain',
        });
      }
    }

    // Signal: Recurring patterns
    const { data: patternData } = await client
      .from('agent_weekly_reports')
      .select('baseline_summary')
      .eq('report_kind', 'self_improvement_patterns')
      .gte('created_at', twoWeeksAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (patternData && patternData.length > 0) {
      const ps = patternData[0].baseline_summary as { highSeverityCount?: number; regression?: { worsened?: unknown[] } } | undefined;
      const high = ps?.highSeverityCount ?? 0;
      const worsenedLen = Array.isArray(ps?.regression?.worsened) ? ps.regression.worsened.length : 0;
      if (high > 0 || worsenedLen > 0) {
        signals.push({
          source: 'weekly-patterns',
          severity: worsenedLen > 0 ? 'high' : high >= 3 ? 'high' : 'medium',
          score: Math.min(10, (high * 2 + worsenedLen * 3) / 3),
          description: `${high} high-severity patterns, ${worsenedLen} worsening`,
          suggestedAction: 'Trigger bugfix sprint targeting worsened first',
        });
      }
    }

    // Signal: Cross-loop meta-quality
    if (SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED) {
      const outcomes = await evaluateCrossLoopOutcomes();
      if (outcomes.total >= 3 && outcomes.successRate < 0.5) {
        signals.push({
          source: 'cross-loop-feedback',
          severity: 'high',
          score: Math.min(10, (1 - outcomes.successRate) * 8),
          description: `Self-triggered sprint success rate ${(outcomes.successRate * 100).toFixed(0)}% (${outcomes.succeeded}/${outcomes.total})`,
          suggestedAction: 'Review sprint triggering thresholds',
        });
      }
    }

    signals.sort((a, b) => b.score - a.score);
    const totalScore = signals.reduce((s, g) => s + g.score, 0);

    if (signals.length > 0) {
      logger.info('[SELF-IMPROVE] gradient: %d signals, score=%.1f, top=%s', signals.length, totalScore, signals[0].source);
    }
    return { signals, topPriority: signals[0] || null, totalScore, computedAt: new Date().toISOString() };
  } catch (error) {
    logger.warn('[SELF-IMPROVE] gradient failed: %s', error instanceof Error ? error.message : String(error));
    return emptyGradient;
  }
};

// ──── Step 6: Convergence Monitor ─────────────────────────────────────────────

const computeTrend = (values: number[]): ConvergenceTrend => {
  if (values.length < 3) return 'insufficient-data';
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  if (den === 0) return 'stable';
  const normalizedSlope = yMean !== 0 ? (num / den) / Math.abs(yMean) : num / den;
  if (normalizedSlope > 0.02) return 'improving';
  if (normalizedSlope < -0.02) return 'degrading';
  return 'stable';
};

export const computeConvergenceReport = async (): Promise<ConvergenceReport> => {
  const empty: ConvergenceReport = {
    benchScoreTrend: 'insufficient-data', lacunaCountTrend: 'insufficient-data',
    qualityScoreTrend: 'insufficient-data', highSeverityPatternTrend: 'insufficient-data',
    crossLoopSuccessRate: null, overallVerdict: 'insufficient-data',
    computedAt: new Date().toISOString(), dataPoints: 0,
  };
  if (!SELF_IMPROVEMENT_CONVERGENCE_ENABLED || !isSupabaseConfigured()) return empty;

  try {
    const client = getSupabaseClient();
    const sixWeeksAgo = new Date(Date.now() - 42 * 24 * 60 * 60_000).toISOString();

    const { data: weekly, error } = await client
      .from('agent_weekly_reports')
      .select('report_kind, baseline_summary, created_at')
      .in('report_kind', ['go_no_go_weekly', 'self_improvement_patterns'])
      .gte('created_at', sixWeeksAgo)
      .order('created_at', { ascending: true });
    if (error || !weekly || weekly.length === 0) return empty;

    const qualityScores: number[] = [];
    const highCounts: number[] = [];
    for (const r of weekly) {
      const s = r.baseline_summary as Record<string, unknown> | undefined;
      if (!s) continue;
      if (r.report_kind === 'go_no_go_weekly') {
        const pct = (s.candidate_summary as { successRatePct?: number } | undefined)?.successRatePct;
        if (typeof pct === 'number' && Number.isFinite(pct)) qualityScores.push(pct);
      }
      if (r.report_kind === 'self_improvement_patterns') {
        const c = s.highSeverityCount;
        if (typeof c === 'number') highCounts.push(c);
      }
    }

    const qualityScoreTrend = computeTrend(qualityScores);
    // For counts, increasing is worse → invert
    const rawPatternTrend = computeTrend(highCounts);
    const highSeverityPatternTrend: ConvergenceTrend =
      rawPatternTrend === 'improving' ? 'degrading' :
      rawPatternTrend === 'degrading' ? 'improving' : rawPatternTrend;

    // Bench scores from journal
    const { data: journal } = await client
      .from('sprint_journal_entries')
      .select('bench_results, completed_at')
      .gte('completed_at', sixWeeksAgo)
      .order('completed_at', { ascending: true });
    const benchScores: number[] = [];
    if (journal) {
      for (const e of journal) {
        const results = e.bench_results as string[] | undefined;
        if (results) {
          for (const r of results) {
            const m = String(r).match(/score[:\s=]+(\d+(?:\.\d+)?)/i);
            if (m) { benchScores.push(Number(m[1])); break; }
          }
        }
      }
    }
    const benchScoreTrend = computeTrend(benchScores);

    let crossLoopSuccessRate: number | null = null;
    if (SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED) {
      const outcomes = await evaluateCrossLoopOutcomes();
      if (outcomes.total > 0) crossLoopSuccessRate = outcomes.successRate;
    }

    // Majority vote
    const trends = [benchScoreTrend, qualityScoreTrend, highSeverityPatternTrend].filter((t) => t !== 'insufficient-data');
    let overallVerdict: ConvergenceTrend;
    if (trends.length === 0) overallVerdict = 'insufficient-data';
    else {
      const imp = trends.filter((t) => t === 'improving').length;
      const deg = trends.filter((t) => t === 'degrading').length;
      overallVerdict = imp > deg ? 'improving' : deg > imp ? 'degrading' : 'stable';
    }

    const dataPoints = qualityScores.length + highCounts.length + benchScores.length;
    const report: ConvergenceReport = {
      benchScoreTrend, lacunaCountTrend: 'insufficient-data',
      qualityScoreTrend, highSeverityPatternTrend,
      crossLoopSuccessRate, overallVerdict,
      computedAt: new Date().toISOString(), dataPoints,
    };

    logger.info('[SELF-IMPROVE] convergence: verdict=%s quality=%s patterns=%s bench=%s points=%d',
      overallVerdict, qualityScoreTrend, highSeverityPatternTrend, benchScoreTrend, dataPoints);

    // Persist
    client.from('agent_weekly_reports').upsert({
      report_key: `convergence_report:${report.computedAt.slice(0, 10)}`,
      report_kind: 'convergence_report',
      guild_id: null,
      baseline_summary: report,
      created_at: report.computedAt,
    }, { onConflict: 'report_key' }).then(() => {}, () => {});

    return report;
  } catch (error) {
    logger.warn('[SELF-IMPROVE] convergence failed: %s', error instanceof Error ? error.message : String(error));
    return empty;
  }
};

// ──── Unified Scheduled Check ─────────────────────────────────────────────────

export const runSelfImprovementChecks = async (): Promise<void> => {
  if (!SPRINT_ENABLED) return;
  try {
    if (SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED) await checkWeeklyPatternsForBugfixTrigger();
    if (SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED) await checkBenchRegressionAndTrigger();
    await computeSystemGradient();
    if (SELF_IMPROVEMENT_CONVERGENCE_ENABLED) await computeConvergenceReport();
  } catch (error) {
    logger.warn('[SELF-IMPROVE] scheduled checks failed: %s', error instanceof Error ? error.message : String(error));
  }
};
