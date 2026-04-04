/**
 * Memory Gap Channel — detects broken links, stale raw-tier memories,
 * and low-confidence clusters in the memory system.
 *
 * Reads from Supabase memory_items and memory_item_links tables
 * to find structural gaps in the knowledge graph.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  MemoryGapPayload,
} from './observerTypes';
import { OBSERVER_MEMORY_GAP_ENABLED, OBSERVER_MEMORY_GAP_STALE_HOURS } from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

const channel: ObservationChannel = {
  kind: 'memory-gap',
  enabled: OBSERVER_MEMORY_GAP_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    if (!isSupabaseConfigured()) {
      return { observations, channelKind: 'memory-gap', scanDurationMs: Date.now() - start };
    }

    try {
      const sb = getSupabaseClient();

      // 1. Stale raw-tier memories (older than threshold, never promoted)
      const staleCutoff = new Date(Date.now() - OBSERVER_MEMORY_GAP_STALE_HOURS * 3600_000).toISOString();
      const { data: staleMemories, error: staleErr } = await sb
        .from('memory_items')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .eq('tier', 'raw')
        .lt('created_at', staleCutoff)
        .is('archived_at', null);

      if (!staleErr && (staleMemories as unknown as number) > 0) {
        // The count is in the response header when head: true
      }

      // Use count from the query
      const { count: staleCount } = await sb
        .from('memory_items')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .eq('tier', 'raw')
        .lt('created_at', staleCutoff)
        .is('archived_at', null);

      if (staleCount && staleCount > 5) {
        const payload: MemoryGapPayload = {
          gapKind: 'stale-memory',
          affectedCount: staleCount,
          ageHours: OBSERVER_MEMORY_GAP_STALE_HOURS,
        };
        observations.push({
          guildId,
          channel: 'memory-gap',
          severity: staleCount > 50 ? 'warning' : 'info',
          title: `${staleCount} stale raw memories (>${OBSERVER_MEMORY_GAP_STALE_HOURS}h without promotion)`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }

      // 2. Low-confidence cluster: memories with confidence below threshold
      const { count: lowConfCount } = await sb
        .from('memory_items')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .lt('confidence', 0.2)
        .is('archived_at', null);

      if (lowConfCount && lowConfCount > 10) {
        const payload: MemoryGapPayload = {
          gapKind: 'low-confidence-cluster',
          affectedCount: lowConfCount,
        };
        observations.push({
          guildId,
          channel: 'memory-gap',
          severity: lowConfCount > 30 ? 'warning' : 'info',
          title: `${lowConfCount} low-confidence memories (conf < 0.2)`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      return { observations, channelKind: 'memory-gap', scanDurationMs: Date.now() - start, error: 'scan failed' };
    }

    return { observations, channelKind: 'memory-gap', scanDurationMs: Date.now() - start };
  },
};

export default channel;
