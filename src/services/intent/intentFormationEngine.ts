/**
 * Intent Formation Engine — rule-based intent generation from observations.
 *
 * Evaluates 6 rules against recent observations + aggregated metrics to
 * produce structured IntentProposals. No LLM calls — pure rule logic.
 *
 * Flow: observations → buildMetricSnapshot → evaluate rules → persist intents
 */

import logger from '../../logger';
import {
  INTENT_FORMATION_ENABLED,
  INTENT_MAX_PENDING,
  INTENT_COOLDOWN_MS,
  INTENT_DAILY_BUDGET_TOKENS,
} from '../../config';
import { getRecentObservations } from '../observer/observationStore';
import type { Observation } from '../observer/observerTypes';
import {
  persistIntent,
  getPendingIntentCount,
  isCooldownActive,
} from './intentStore';
import { buildMetricSnapshot } from './metricReviewService';
import type {
  IntentRecord,
  IntentRule,
  IntentProposal,
  RuleEvaluationContext,
  ObservationSnapshot,
} from './intentTypes';

// ── Intent Rules Registry ───────────────────────────────────────────────────

const RULES: IntentRule[] = [
  {
    id: 'recurring-error-cluster',
    channels: ['error-pattern'],
    autonomyLevel: 'approve-ship',
    basePriority: 0.8,
    cooldownPrefix: 'bugfix',
    autoExecute: false,
    evaluate: (ctx) => {
      // Trigger when 3+ error observations in the same cluster
      const errorObs = ctx.observations.filter((o) => o.channel === 'error-pattern');
      if (errorObs.length < 3) return null;

      const topCluster = [...ctx.metrics.errorClusters.entries()]
        .sort((a, b) => b[1] - a[1])[0];
      if (!topCluster || topCluster[1] < 3) return null;

      return {
        hypothesis: `Recurring error cluster "${topCluster[0]}" detected ${topCluster[1]} times`,
        objective: `Fix error cluster "${topCluster[0]}" to reduce error rate`,
        priorityScore: Math.min(0.5 + topCluster[1] * 0.05, 1),
        autonomyLevel: 'approve-ship',
        observationIds: errorObs.map((o) => o.id),
        cooldownKey: `bugfix:${topCluster[0]}`,
      };
    },
  },
  {
    id: 'memory-gap-stale',
    channels: ['memory-gap'],
    autonomyLevel: 'full-auto',
    basePriority: 0.5,
    cooldownPrefix: 'maintenance',
    autoExecute: true,
    evaluate: (ctx) => {
      if (ctx.metrics.brokenLinkCount <= 5) return null;

      const gapObs = ctx.observations.filter((o) => o.channel === 'memory-gap');
      return {
        hypothesis: `${ctx.metrics.brokenLinkCount} broken memory links detected`,
        objective: 'Repair broken memory links and stale references',
        priorityScore: Math.min(0.4 + ctx.metrics.brokenLinkCount * 0.02, 0.8),
        autonomyLevel: 'full-auto',
        observationIds: gapObs.map((o) => o.id),
        cooldownKey: `maintenance:memory-links`,
      };
    },
  },
  {
    id: 'perf-drift-latency',
    channels: ['perf-drift'],
    autonomyLevel: 'approve-impl',
    basePriority: 0.7,
    cooldownPrefix: 'optimize',
    autoExecute: false,
    evaluate: (ctx) => {
      if (ctx.metrics.p95DeltaPercent < 30) return null;

      const perfObs = ctx.observations.filter((o) => o.channel === 'perf-drift');
      return {
        hypothesis: `P95 latency increased by ${ctx.metrics.p95DeltaPercent.toFixed(0)}%`,
        objective: 'Optimize performance to bring latency back to baseline',
        priorityScore: Math.min(0.6 + ctx.metrics.p95DeltaPercent * 0.003, 1),
        autonomyLevel: 'approve-impl',
        observationIds: perfObs.map((o) => o.id),
        cooldownKey: `optimize:p95-latency`,
      };
    },
  },
  {
    id: 'code-health-regression',
    channels: ['code-health'],
    autonomyLevel: 'full-auto',
    basePriority: 0.6,
    cooldownPrefix: 'qa',
    autoExecute: true,
    evaluate: (ctx) => {
      if (ctx.metrics.codeHealthErrors <= 10) return null;

      const codeObs = ctx.observations.filter((o) => o.channel === 'code-health');
      return {
        hypothesis: `${ctx.metrics.codeHealthErrors} code health errors detected`,
        objective: 'Fix type errors and code health regressions',
        priorityScore: Math.min(0.5 + ctx.metrics.codeHealthErrors * 0.01, 0.9),
        autonomyLevel: 'full-auto',
        observationIds: codeObs.map((o) => o.id),
        cooldownKey: `qa:code-health`,
      };
    },
  },
  {
    id: 'convergence-degrading',
    channels: ['convergence-digest'],
    autonomyLevel: 'approve-impl',
    basePriority: 0.65,
    cooldownPrefix: 'investigate',
    autoExecute: false,
    evaluate: (ctx) => {
      if (ctx.metrics.convergenceDegradingStreak < 2) return null;

      const convObs = ctx.observations.filter((o) => o.channel === 'convergence-digest');
      return {
        hypothesis: `Answer convergence degrading for ${ctx.metrics.convergenceDegradingStreak} consecutive checks`,
        objective: 'Investigate convergence degradation and restore quality',
        priorityScore: Math.min(0.5 + ctx.metrics.convergenceDegradingStreak * 0.1, 0.9),
        autonomyLevel: 'approve-impl',
        observationIds: convObs.map((o) => o.id),
        cooldownKey: `investigate:convergence`,
      };
    },
  },
  {
    id: 'discord-pulse-drop',
    channels: ['discord-pulse'],
    autonomyLevel: 'approve-ship',
    basePriority: 0.4,
    cooldownPrefix: 'faq-gap',
    autoExecute: false,
    evaluate: (ctx) => {
      if (ctx.metrics.discordActivityDeltaPercent > -50) return null;

      const pulseObs = ctx.observations.filter((o) => o.channel === 'discord-pulse');
      return {
        hypothesis: `Discord activity dropped by ${Math.abs(ctx.metrics.discordActivityDeltaPercent).toFixed(0)}%`,
        objective: 'Identify FAQ gaps or engagement issues from activity drop',
        priorityScore: 0.4,
        autonomyLevel: 'approve-ship',
        observationIds: pulseObs.map((o) => o.id),
        cooldownKey: `faq-gap:activity-drop`,
      };
    },
  },
];

// ── Engine Core ─────────────────────────────────────────────────────────────

function toObservationSnapshot(obs: Observation): ObservationSnapshot {
  return {
    id: obs.id ?? '',
    channel: obs.channel,
    severity: obs.severity,
    title: obs.title,
    payload: obs.payload,
    detectedAt: obs.detectedAt,
  };
}

/**
 * Run intent formation for a guild: fetch recent observations, evaluate
 * all rules, and persist resulting intents.
 *
 * @returns Array of newly created intents
 */
export async function evaluateIntents(guildId: string): Promise<IntentRecord[]> {
  if (!INTENT_FORMATION_ENABLED) return [];

  const pendingCount = await getPendingIntentCount(guildId);
  if (pendingCount >= INTENT_MAX_PENDING) {
    logger.debug('[INTENT] max pending reached (%d/%d) for guild %s', pendingCount, INTENT_MAX_PENDING, guildId);
    return [];
  }

  // Fetch unconsumed observations from the last scan window
  const observations = await getRecentObservations({
    guildId,
    unconsumedOnly: true,
    limit: 100,
  });

  if (observations.length === 0) return [];

  const snapshots = observations.map(toObservationSnapshot);
  const metrics = buildMetricSnapshot(snapshots);

  const ctx: RuleEvaluationContext = { guildId, observations: snapshots, metrics };
  const created: IntentRecord[] = [];

  for (const rule of RULES) {
    try {
      // Check cooldown
      const cooldownActive = await isCooldownActive(rule.cooldownPrefix, INTENT_COOLDOWN_MS);
      if (cooldownActive) {
        logger.debug('[INTENT] rule %s skipped (cooldown active)', rule.id);
        continue;
      }

      const proposal = rule.evaluate(ctx);
      if (!proposal) continue;

      // Check pending cap again (could have grown during evaluation)
      const currentPending = await getPendingIntentCount(guildId);
      if (currentPending >= INTENT_MAX_PENDING) break;

      const intent: IntentRecord = {
        guildId,
        hypothesis: proposal.hypothesis,
        objective: proposal.objective,
        ruleId: rule.id,
        priorityScore: proposal.priorityScore,
        autonomyLevel: proposal.autonomyLevel,
        status: 'pending',
        observationIds: proposal.observationIds,
        cooldownKey: proposal.cooldownKey,
        tokenCost: 0,
      };

      const persisted = await persistIntent(intent);
      if (persisted) {
        created.push(persisted);
        logger.info('[INTENT] created intent %s (rule=%s, priority=%.2f)', persisted.id, rule.id, persisted.priorityScore);
      }
    } catch (err) {
      logger.debug('[INTENT] rule %s error: %s', rule.id, err instanceof Error ? err.message : String(err));
    }
  }

  return created;
}

/**
 * Execute an approved intent by creating a sprint pipeline.
 * Called from signal bus or API route after approval.
 */
export async function executeIntent(intent: IntentRecord): Promise<string | null> {
  try {
    const { updateIntentStatus } = await import('./intentStore');

    await updateIntentStatus(intent.id!, 'executing');

    const { createSprintPipeline, runFullSprintPipeline } = await import('../sprint/sprintOrchestrator');
    const pipeline = createSprintPipeline({
      triggerId: `intent-${intent.id}`,
      triggerType: 'observation',
      guildId: intent.guildId,
      objective: intent.objective,
      autonomyLevel: intent.autonomyLevel as import('../sprint/sprintOrchestrator').AutonomyLevel,
    });

    const sprintId = pipeline.sprintId;
    await updateIntentStatus(intent.id!, 'executing', { sprintId });
    logger.info('[INTENT] sprint created for intent %s → %s', intent.id, sprintId);

    void runFullSprintPipeline(sprintId).catch((err: unknown) => {
      logger.debug('[INTENT] sprint execution failed for %s: %s', sprintId, err instanceof Error ? err.message : String(err));
    });

    return sprintId;
  } catch (err) {
    logger.debug('[INTENT] execute error for %s: %s', intent.id, err instanceof Error ? err.message : String(err));
    const { updateIntentStatus } = await import('./intentStore');
    await updateIntentStatus(intent.id!, 'pending');
    return null;
  }
}

/** Get the rules registry (for diagnostics) */
export function getIntentRules(): readonly IntentRule[] {
  return RULES;
}
