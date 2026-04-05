/**
 * Metric Review Service — aggregates data sources for intent rule evaluation.
 *
 * Collects metrics from observations, sprint pipelines, memory, and other
 * services to build a MetricSnapshot for rule evaluation. No LLM calls.
 */

import logger from '../../logger';
import type { MetricSnapshot, ObservationSnapshot } from './intentTypes';
import type { ObservationChannelKind } from '../observer/observerTypes';

/**
 * Build a MetricSnapshot from recent observations.
 * Extracts structured data from observation payloads grouped by channel.
 */
export function buildMetricSnapshot(observations: ObservationSnapshot[]): MetricSnapshot {
  const errorClusters = new Map<string, number>();
  let brokenLinkCount = 0;
  let p95DeltaPercent = 0;
  let codeHealthErrors = 0;
  let convergenceDegradingStreak = 0;
  let discordActivityDeltaPercent = 0;

  const byChannel = groupByChannel(observations);

  // ── Error pattern metrics ───────────────────────────────────────────────
  const errorObs = byChannel.get('error-pattern') ?? [];
  for (const obs of errorObs) {
    const cluster = (obs.payload.cluster as string) ?? 'unknown';
    const freq = (obs.payload.frequency as number) ?? 1;
    errorClusters.set(cluster, (errorClusters.get(cluster) ?? 0) + freq);
  }

  // ── Memory gap metrics ──────────────────────────────────────────────────
  const memoryObs = byChannel.get('memory-gap') ?? [];
  for (const obs of memoryObs) {
    if (obs.payload.gapKind === 'broken-link') {
      brokenLinkCount += (obs.payload.affectedCount as number) ?? 0;
    }
  }

  // ── Performance drift metrics ───────────────────────────────────────────
  const perfObs = byChannel.get('perf-drift') ?? [];
  for (const obs of perfObs) {
    if (obs.payload.metric === 'p95_latency_ms') {
      const delta = (obs.payload.deltaPercent as number) ?? 0;
      if (Math.abs(delta) > Math.abs(p95DeltaPercent)) {
        p95DeltaPercent = delta;
      }
    }
  }

  // ── Code health metrics ─────────────────────────────────────────────────
  const codeObs = byChannel.get('code-health') ?? [];
  for (const obs of codeObs) {
    codeHealthErrors += (obs.payload.errorCount as number) ?? 0;
  }

  // ── Convergence digest metrics ──────────────────────────────────────────
  const convObs = byChannel.get('convergence-digest') ?? [];
  // Count consecutive degrading observations (already sorted by time)
  let streak = 0;
  for (const obs of convObs) {
    if (obs.payload.trend === 'degrading') {
      streak++;
    } else {
      break;
    }
  }
  convergenceDegradingStreak = streak;

  // ── Discord pulse metrics ───────────────────────────────────────────────
  const pulseObs = byChannel.get('discord-pulse') ?? [];
  for (const obs of pulseObs) {
    const delta = (obs.payload.activityDeltaPercent as number) ?? 0;
    if (Math.abs(delta) > Math.abs(discordActivityDeltaPercent)) {
      discordActivityDeltaPercent = delta;
    }
  }

  return {
    errorClusters,
    brokenLinkCount,
    p95DeltaPercent,
    codeHealthErrors,
    convergenceDegradingStreak,
    discordActivityDeltaPercent,
  };
}

function groupByChannel(
  observations: ObservationSnapshot[],
): Map<ObservationChannelKind, ObservationSnapshot[]> {
  const map = new Map<ObservationChannelKind, ObservationSnapshot[]>();
  for (const obs of observations) {
    const list = map.get(obs.channel) ?? [];
    list.push(obs);
    map.set(obs.channel, list);
  }
  return map;
}
