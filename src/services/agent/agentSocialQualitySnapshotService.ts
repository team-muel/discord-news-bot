import { parseBoundedNumberEnv } from '../../utils/env';
import { getAgentAnswerQualityReviewSummary } from './agentQualityReviewService';
import { buildAgentRuntimeReadinessReport } from './agentRuntimeReadinessService';
import { getCommunityGraphOperationalSummary } from '../communityGraphService';
import { buildGoNoGoReport } from '../goNoGoService';

const MAX_HALLUCINATION_FAIL_RATE = parseBoundedNumberEnv(
  process.env.AGENT_SOCIAL_QUALITY_MAX_HALLUCINATION_FAIL_RATE,
  0.10,
  0,
  1,
);
const MIN_TASK_SUCCESS_RATE = parseBoundedNumberEnv(
  process.env.AGENT_SOCIAL_QUALITY_MIN_TASK_SUCCESS_RATE,
  0.65,
  0,
  1,
);

const toRate = (value: number | null): number | null => {
  if (!Number.isFinite(Number(value))) {
    return null;
  }
  return Number(Number(value).toFixed(4));
};

const average = (values: Array<number | null>): number | null => {
  const numeric = values.filter((value): value is number => Number.isFinite(Number(value)));
  if (numeric.length === 0) {
    return null;
  }
  return Number((numeric.reduce((acc, value) => acc + value, 0) / numeric.length).toFixed(4));
};

export const buildSocialQualityOperationalSnapshot = async (params: {
  guildId: string;
  days?: number;
}) => {
  const guildId = String(params.guildId || '').trim();
  if (!guildId) {
    throw new Error('VALIDATION');
  }

  const days = Math.max(1, Math.min(90, Math.trunc(Number(params.days || 14))));
  const [social, qualitySummary, goNoGo, readiness] = await Promise.all([
    getCommunityGraphOperationalSummary({ guildId, days }),
    getAgentAnswerQualityReviewSummary({ guildId, days }),
    buildGoNoGoReport({ guildId, days }),
    buildAgentRuntimeReadinessReport({ guildId, windowDays: days }),
  ]);

  const baselineTotals = qualitySummary.byStrategy.baseline;
  const gotTotals = qualitySummary.byStrategy.got;
  const totTotals = qualitySummary.byStrategy.tot;
  const totalHallucinations = baselineTotals.hallucinations + gotTotals.hallucinations + totTotals.hallucinations;
  const totalReviewed = baselineTotals.total + gotTotals.total + totTotals.total;
  const hallucinationReviewFailRate = totalReviewed > 0
    ? Number((totalHallucinations / totalReviewed).toFixed(4))
    : null;

  const totalRuns = Math.max(0, Number(readiness.metrics.actionDiagnostics.totalRuns || 0));
  const successRuns = Math.max(0, Number(readiness.metrics.actionDiagnostics.successRuns || 0));
  const taskSuccessRate = totalRuns > 0
    ? Number((successRuns / totalRuns).toFixed(4))
    : null;

  const citationRate = toRate(goNoGo.metrics.memory.citationRate);
  const retrievalHitAt5 = toRate(goNoGo.metrics.retrieval.recallAt5);
  const hallucinationPassRate = hallucinationReviewFailRate === null
    ? null
    : Number((1 - hallucinationReviewFailRate).toFixed(4));

  const missingSources: string[] = [];
  if (social.socialEventsIngested <= 0) {
    missingSources.push('social_events');
  }
  if (social.activeEdges <= 0) {
    missingSources.push('social_edges');
  }
  if (goNoGo.metrics.retrieval.totalQueries <= 0) {
    missingSources.push('retrieval_logs');
  }
  if (qualitySummary.sampleCount <= 0) {
    missingSources.push('quality_reviews');
  }
  if (totalRuns <= 0) {
    missingSources.push('action_runs');
  }

  const thresholdChecks = [
    {
      key: 'citation_rate',
      actual: citationRate,
      threshold: 0.95,
      comparator: 'gte' as const,
      ok: citationRate !== null ? citationRate >= 0.95 : false,
    },
    {
      key: 'retrieval_hit_at_5',
      actual: retrievalHitAt5,
      threshold: 0.60,
      comparator: 'gte' as const,
      ok: retrievalHitAt5 !== null ? retrievalHitAt5 >= 0.60 : false,
    },
    {
      key: 'hallucination_review_fail_rate',
      actual: hallucinationReviewFailRate,
      threshold: MAX_HALLUCINATION_FAIL_RATE,
      comparator: 'lte' as const,
      ok: hallucinationReviewFailRate !== null ? hallucinationReviewFailRate <= MAX_HALLUCINATION_FAIL_RATE : false,
    },
    {
      key: 'task_success_rate',
      actual: taskSuccessRate,
      threshold: MIN_TASK_SUCCESS_RATE,
      comparator: 'gte' as const,
      ok: taskSuccessRate !== null ? taskSuccessRate >= MIN_TASK_SUCCESS_RATE : false,
    },
  ];

  const breachedThresholds = thresholdChecks
    .filter((check) => check.actual !== null && !check.ok)
    .map((check) => check.key);

  const status = breachedThresholds.length > 0
    ? 'blocked'
    : missingSources.length > 0
      ? 'degraded'
      : 'healthy';

  return {
    guildId,
    days,
    status,
    generatedAt: new Date().toISOString(),
    score: average([citationRate, retrievalHitAt5, hallucinationPassRate, taskSuccessRate]),
    social,
    quality: {
      citationRate,
      retrievalHitAt5,
      hallucinationReviewFailRate,
      hallucinationReviewSampleCount: qualitySummary.sampleCount,
      taskSuccessRate,
      actionRunCount: totalRuns,
      goNoGoDecision: goNoGo.decision,
      readinessDecision: readiness.decision,
      goNoGoFailedChecks: goNoGo.failedChecks,
      readinessFailedChecks: readiness.failedCheckIds,
      reviewSummary: qualitySummary,
    },
    interpretation: {
      missingSources,
      breachedThresholds,
      thresholdChecks,
      rules: [
        'Any breached threshold blocks the snapshot.',
        'Missing source metrics degrade the snapshot until telemetry is available.',
        'Social graph health is presence-based in this snapshot: zero recent events or edges is treated as degraded, not blocked.',
      ],
    },
  };
};