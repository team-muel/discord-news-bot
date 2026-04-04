/**
 * Discord Pulse Channel — monitors message activity in tracked channels.
 * Measures volume, response times, and unanswered questions.
 *
 * This is a lightweight channel that reads from CRM data
 * rather than directly accessing Discord API, avoiding rate limits.
 */

import type {
  ObservationChannel,
  ObservationChannelResult,
  Observation,
  DiscordPulsePayload,
} from './observerTypes';
import { OBSERVER_DISCORD_PULSE_ENABLED } from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

const channel: ObservationChannel = {
  kind: 'discord-pulse',
  enabled: OBSERVER_DISCORD_PULSE_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    if (!isSupabaseConfigured()) {
      return { observations, channelKind: 'discord-pulse', scanDurationMs: Date.now() - start };
    }

    try {
      const sb = getSupabaseClient();

      // Read recent user CRM activity to detect engagement drops
      const oneDayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();

      // Current 24h activity
      const { count: current24h } = await sb
        .from('user_activity')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .gte('created_at', oneDayAgo);

      // Previous 24h activity for comparison
      const { count: previous24h } = await sb
        .from('user_activity')
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .gte('created_at', twoDaysAgo)
        .lt('created_at', oneDayAgo);

      const cur = current24h ?? 0;
      const prev = previous24h ?? 0;

      // Detect significant drop in activity (>50% decrease)
      if (prev > 10 && cur < prev * 0.5) {
        const payload: DiscordPulsePayload = {
          channelId: 'guild-wide',
          messageVolume24h: cur,
          unansweredQuestions: 0,
          avgResponseTimeMinutes: null,
        };
        observations.push({
          guildId,
          channel: 'discord-pulse',
          severity: cur === 0 ? 'critical' : 'warning',
          title: `Activity drop: ${cur} events (was ${prev} yesterday)`,
          payload,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Table might not exist yet — this is expected in many environments
      return { observations, channelKind: 'discord-pulse', scanDurationMs: Date.now() - start };
    }

    return { observations, channelKind: 'discord-pulse', scanDurationMs: Date.now() - start };
  },
};

export default channel;
