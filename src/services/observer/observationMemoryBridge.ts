/**
 * Observation → Memory Bridge
 *
 * Converts observer findings into structured memory items (semantic type)
 * so that observations feed back into the Obsidian-compatible knowledge graph.
 *
 * Each observation batch is grouped by channel, summarized, and stored as a
 * semantic memory with appropriate tags for graph-first retrieval.
 * Before bridging, queries the Obsidian vault for related prior knowledge
 * so each memory item carries graph context (related notes/backlinks).
 *
 * Called by the signal bus consumer on `observation.new`.
 */

import logger from '../../logger';
import type { Observation, ObservationChannelKind } from './observerTypes';
import { getErrorMessage } from '../../utils/errorMessage';

const ACTOR_ID = 'system:observer-bridge';

const CHANNEL_TAG_MAP: Record<ObservationChannelKind, string> = {
  'error-pattern': 'obs/error-pattern',
  'memory-gap': 'obs/memory-gap',
  'perf-drift': 'obs/perf-drift',
  'code-health': 'obs/code-health',
  'convergence-digest': 'obs/convergence',
  'discord-pulse': 'obs/discord-pulse',
  'harness-gate': 'obs/harness-gate',
};

const SEVERITY_TAG: Record<string, string> = {
  critical: 'severity/critical',
  warning: 'severity/warning',
  info: 'severity/info',
};

/**
 * Query Obsidian vault for related prior knowledge before bridging.
 * Returns formatted context lines to append to the memory item content.
 * Best-effort — returns empty array on failure.
 */
async function queryGraphContext(
  summaryText: string,
  guildId: string,
): Promise<string[]> {
  try {
    const { queryObsidianLoreHints } = await import('../obsidian/obsidianRagService');
    const hints = await queryObsidianLoreHints(summaryText, {
      maxDocs: 3,
      guildId,
    });
    if (hints.length === 0) return [];
    return [
      '',
      '### Related Vault Notes',
      ...hints.map(
        (h) => `- [${h.filePath}] (score ${h.score.toFixed(2)}, backlinks ${h.backlinks}): ${h.text.slice(0, 120)}`,
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * Bridge a batch of observations into memory items.
 * Groups by channel, creates one memory item per channel group.
 * Enriches each group with related Obsidian vault context (graph-first).
 * Returns the number of memory items created.
 */
export const bridgeObservationsToMemory = async (
  observations: Observation[],
): Promise<number> => {
  if (observations.length === 0) return 0;

  // Group by channel
  const groups = new Map<ObservationChannelKind, Observation[]>();
  for (const obs of observations) {
    const list = groups.get(obs.channel) ?? [];
    list.push(obs);
    groups.set(obs.channel, list);
  }

  let created = 0;
  const consumedIds: string[] = [];

  for (const [channel, channelObs] of groups) {
    try {
      const guildId = channelObs[0].guildId;
      const maxSeverity = channelObs.some((o) => o.severity === 'critical')
        ? 'critical'
        : channelObs.some((o) => o.severity === 'warning')
          ? 'warning'
          : 'info';

      const titles = channelObs.map((o) => `- ${o.title}`).join('\n');

      // Graph-first: query Obsidian for related prior knowledge
      const graphContext = await queryGraphContext(
        `${channel}: ${channelObs.map((o) => o.title).join('; ')}`,
        guildId,
      );

      const content = [
        `## Observer: ${channel} (${channelObs.length}건)`,
        `감지 시간: ${new Date().toISOString()}`,
        `심각도: ${maxSeverity}`,
        '',
        titles,
        ...graphContext,
      ].join('\n');

      const tags = [
        'observer',
        CHANNEL_TAG_MAP[channel] ?? `obs/${channel}`,
        SEVERITY_TAG[maxSeverity] ?? 'severity/info',
        `guild/${guildId}`,
      ];

      // Lazy import to avoid circular dependencies
      const { createMemoryItem } = await import('../agent/agentMemoryStore');

      await createMemoryItem({
        guildId,
        type: 'semantic',
        title: `[Observer] ${channel}: ${channelObs.length}건 감지 (${maxSeverity})`,
        content,
        tags,
        confidence: maxSeverity === 'critical' ? 0.9 : maxSeverity === 'warning' ? 0.7 : 0.5,
        actorId: ACTOR_ID,
        source: {
          sourceKind: 'system',
          sourceRef: `observer:${channel}:${Date.now()}`,
        },
      });

      created++;
      // Mark bridged observations consumed so they don't get re-bridged next signal
      for (const obs of channelObs) {
        if (obs.id) consumedIds.push(obs.id);
      }
    } catch (err) {
      logger.debug(
        '[OBS-MEMORY-BRIDGE] failed to bridge channel=%s: %s',
        channel,
        getErrorMessage(err),
      );
    }
  }

  if (created > 0) {
    logger.info('[OBS-MEMORY-BRIDGE] bridged %d channel groups → memory', created);

    // Mark consumed so observations are excluded from future unconsumedOnly queries
    if (consumedIds.length > 0) {
      const { markObservationsConsumed } = await import('./observationStore');
      await markObservationsConsumed(consumedIds).catch(() => { /* best-effort */ });
    }
  }
  return created;
};
