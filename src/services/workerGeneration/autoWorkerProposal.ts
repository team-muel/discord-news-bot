import {
  VIBE_AUTO_WORKER_PROMOTION_ENABLED,
  VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY,
  VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS,
  VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS,
  VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE,
  VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE,
  VIBE_AUTO_WORKER_PROPOSAL_DAILY_CAP_PER_GUILD,
  VIBE_AUTO_WORKER_PROPOSAL_DUPLICATE_WINDOW_MS,
  VIBE_AUTO_WORKER_PROPOSAL_MIN_SUCCESS_RATE,
  VIBE_AUTO_WORKER_PROPOSAL_MIN_SAMPLES,
} from '../../config';
import { listApprovals } from './workerApprovalStore';
import { evaluateAutoProposalPromotionGate } from './backgroundProposalSweep';
import { getWorkerProposalMetricsSnapshot, recordWorkerGenerationResult } from './workerProposalMetrics';
import { runWorkerGenerationPipeline } from './workerGenerationPipeline';

export type AutoProposeWorkerInput = {
  guildId: string;
  requestedBy: string;
  request: string;
};

export type AutoProposeWorkerResult =
  | { ok: true; approvalId: string }
  | { ok: false; error: string };

export async function autoProposeWorker({
  guildId,
  requestedBy,
  request,
}: AutoProposeWorkerInput): Promise<AutoProposeWorkerResult> {
  const AUTO_PROPOSAL_PROMOTION_ENABLED = VIBE_AUTO_WORKER_PROMOTION_ENABLED;
  const AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY = VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY;
  const AUTO_PROPOSAL_PROMOTION_WINDOW_DAYS = VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS;
  const AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS = VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS;
  const AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE = VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE;
  const AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE = VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE;
  const AUTO_PROPOSAL_DAILY_CAP_PER_GUILD = VIBE_AUTO_WORKER_PROPOSAL_DAILY_CAP_PER_GUILD;
  const AUTO_PROPOSAL_DUPLICATE_WINDOW_MS = VIBE_AUTO_WORKER_PROPOSAL_DUPLICATE_WINDOW_MS;
  const AUTO_PROPOSAL_MIN_SUCCESS_RATE = VIBE_AUTO_WORKER_PROPOSAL_MIN_SUCCESS_RATE;
  const AUTO_PROPOSAL_MIN_SAMPLES = VIBE_AUTO_WORKER_PROPOSAL_MIN_SAMPLES;

  const nowMs = Date.now();
  const dayAgoIso = new Date(nowMs - 24 * 60 * 60_000).toISOString();
  const dedupSinceMs = nowMs - AUTO_PROPOSAL_DUPLICATE_WINDOW_MS;
  const normalizeGoal = (input: string): string => String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const allApprovals = await listApprovals({ status: 'all' });
  const guildRecentApprovals = allApprovals.filter((entry) => entry.guildId === guildId && entry.createdAt >= dayAgoIso);
  if (guildRecentApprovals.length >= AUTO_PROPOSAL_DAILY_CAP_PER_GUILD) {
    return {
      ok: false,
      error: `AUTO_PROPOSAL_DAILY_CAP_REACHED:${AUTO_PROPOSAL_DAILY_CAP_PER_GUILD}`,
    };
  }

  const normalizedRequest = normalizeGoal(request);
  const hasRecentDuplicate = allApprovals.some((entry) => {
    if (entry.guildId !== guildId) {
      return false;
    }
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs < dedupSinceMs) {
      return false;
    }
    return normalizeGoal(entry.goal) === normalizedRequest;
  });
  if (hasRecentDuplicate) {
    return {
      ok: false,
      error: 'AUTO_PROPOSAL_DUPLICATE_RECENT',
    };
  }

  if (AUTO_PROPOSAL_PROMOTION_ENABLED) {
    const promotion = await evaluateAutoProposalPromotionGate({
      guildId,
      request,
      windowDays: AUTO_PROPOSAL_PROMOTION_WINDOW_DAYS,
      minFrequency: AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY,
      minDistinctRequesters: AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS,
      minOutcomeScore: AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE,
      maxPolicyBlockRate: AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE,
    });

    if (!promotion.ok) {
      return {
        ok: false,
        error: [
          'AUTO_PROPOSAL_PROMOTION_THRESHOLD',
          `freq=${promotion.frequency}/${AUTO_PROPOSAL_PROMOTION_MIN_FREQUENCY}`,
          `distinct=${promotion.distinctRequesters}/${AUTO_PROPOSAL_PROMOTION_MIN_DISTINCT_REQUESTERS}`,
          `outcome=${promotion.avgOutcomeScore.toFixed(3)}/${AUTO_PROPOSAL_PROMOTION_MIN_OUTCOME_SCORE.toFixed(3)}`,
          `policy_block=${promotion.policyBlockRate.toFixed(3)}/${AUTO_PROPOSAL_PROMOTION_MAX_POLICY_BLOCK_RATE.toFixed(3)}`,
        ].join(':'),
      };
    }
  }

  const metrics = getWorkerProposalMetricsSnapshot();
  if (metrics.generationRequested >= AUTO_PROPOSAL_MIN_SAMPLES && metrics.generationSuccessRate < AUTO_PROPOSAL_MIN_SUCCESS_RATE) {
    return {
      ok: false,
      error: `AUTO_PROPOSAL_QUALITY_GUARD:${metrics.generationSuccessRate.toFixed(3)}<${AUTO_PROPOSAL_MIN_SUCCESS_RATE.toFixed(3)}`,
    };
  }

  const pipeResult = await runWorkerGenerationPipeline({
    goal: request,
    guildId,
    requestedBy,
  });
  recordWorkerGenerationResult(pipeResult.ok, pipeResult.ok ? undefined : pipeResult.error);
  if (!pipeResult.ok) {
    return {
      ok: false,
      error: pipeResult.error,
    };
  }

  return {
    ok: true,
    approvalId: pipeResult.approval.id,
  };
}
