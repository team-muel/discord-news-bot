/**
 * Observation Store — persists and queries observations in Supabase.
 *
 * Uses the `observations` table (created by migration 008).
 * Falls back to in-memory buffer when Supabase is unavailable.
 */

import logger from '../../logger';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import type { Observation, ObservationSeverity, ObservationChannelKind } from './observerTypes';

// In-memory fallback buffer (capped)
const FALLBACK_MAX = 500;
const fallbackBuffer: Observation[] = [];

export const persistObservations = async (observations: Observation[]): Promise<number> => {
  if (observations.length === 0) return 0;

  if (!isSupabaseConfigured()) {
    for (const obs of observations) {
      fallbackBuffer.push(obs);
      if (fallbackBuffer.length > FALLBACK_MAX) fallbackBuffer.shift();
    }
    return observations.length;
  }

  try {
    const sb = getSupabaseClient();
    const rows = observations.map((obs) => ({
      guild_id: obs.guildId,
      channel: obs.channel,
      severity: obs.severity,
      title: obs.title,
      payload: obs.payload,
      detected_at: obs.detectedAt,
    }));

    const { error } = await sb.from('observations').insert(rows);
    if (error) {
      logger.debug('[OBSERVER-STORE] persist failed: %s', error.message);
      // Fallback to memory
      for (const obs of observations) {
        fallbackBuffer.push(obs);
        if (fallbackBuffer.length > FALLBACK_MAX) fallbackBuffer.shift();
      }
      return observations.length;
    }

    return observations.length;
  } catch (err) {
    logger.debug('[OBSERVER-STORE] persist error: %s', err instanceof Error ? err.message : String(err));
    for (const obs of observations) {
      fallbackBuffer.push(obs);
      if (fallbackBuffer.length > FALLBACK_MAX) fallbackBuffer.shift();
    }
    return observations.length;
  }
};

export const getRecentObservations = async (opts: {
  guildId?: string;
  channel?: ObservationChannelKind;
  severity?: ObservationSeverity;
  limit?: number;
  unconsumedOnly?: boolean;
}): Promise<Observation[]> => {
  const limit = opts.limit ?? 50;

  if (!isSupabaseConfigured()) {
    let results = [...fallbackBuffer];
    if (opts.guildId) results = results.filter((o) => o.guildId === opts.guildId);
    if (opts.channel) results = results.filter((o) => o.channel === opts.channel);
    if (opts.severity) results = results.filter((o) => o.severity === opts.severity);
    if (opts.unconsumedOnly) results = results.filter((o) => !o.consumedAt);
    return results.slice(-limit).reverse();
  }

  try {
    const sb = getSupabaseClient();
    let query = sb
      .from('observations')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(limit);

    if (opts.guildId) query = query.eq('guild_id', opts.guildId);
    if (opts.channel) query = query.eq('channel', opts.channel);
    if (opts.severity) query = query.eq('severity', opts.severity);
    if (opts.unconsumedOnly) query = query.is('consumed_at', null);

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      guildId: row.guild_id as string,
      channel: row.channel as ObservationChannelKind,
      severity: row.severity as ObservationSeverity,
      title: row.title as string,
      payload: row.payload as Record<string, unknown>,
      detectedAt: row.detected_at as string,
      consumedAt: row.consumed_at as string | null,
      sprintId: row.sprint_id as string | null,
    }));
  } catch {
    return [];
  }
};

export const markObservationsConsumed = async (ids: string[], sprintId?: string): Promise<void> => {
  if (ids.length === 0 || !isSupabaseConfigured()) return;

  try {
    const sb = getSupabaseClient();
    const update: Record<string, unknown> = { consumed_at: new Date().toISOString() };
    if (sprintId) update.sprint_id = sprintId;

    await sb.from('observations').update(update).in('id', ids);
  } catch (err) {
    logger.debug('[OBSERVER-STORE] mark consumed failed: %s', err instanceof Error ? err.message : String(err));
  }
};

/** For diagnostics / testing */
export const getFallbackBufferSnapshot = (): readonly Observation[] => [...fallbackBuffer];

/** Test-only reset */
export const __resetObservationStoreForTests = (): void => {
  fallbackBuffer.length = 0;
};
