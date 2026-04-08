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
import { OBSERVER_DISCORD_PULSE_ENABLED, COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES } from '../../config';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';
import { getClient } from '../infra/baseRepository';
import { T_USER_ACTIVITY, T_COMMUNITY_INTERACTION_EVENTS } from '../infra/tableRegistry';

const channel: ObservationChannel = {
  kind: 'discord-pulse',
  enabled: OBSERVER_DISCORD_PULSE_ENABLED,

  async scan(guildId: string): Promise<ObservationChannelResult> {
    const start = Date.now();
    const observations: Observation[] = [];

    const sb = getClient();
    if (!sb) {
      return { observations, channelKind: 'discord-pulse', scanDurationMs: Date.now() - start };
    }

    try {

      // Read recent user CRM activity to detect engagement drops
      const oneDayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();

      // Current 24h activity
      const { count: current24h } = await sb
        .from(T_USER_ACTIVITY)
        .select('id', { count: 'exact', head: true })
        .eq('guild_id', guildId)
        .gte('created_at', oneDayAgo);

      // Previous 24h activity for comparison
      const { count: previous24h } = await sb
        .from(T_USER_ACTIVITY)
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

      // Detect unanswered questions — member messages received no 'reply' event
      // within the threshold window.
      const thresholdMinutes = COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES;
      const windowStart = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();

      // Count unique source_message_ids that have NO reply event
      const { data: replyData } = await sb
        .from(T_COMMUNITY_INTERACTION_EVENTS)
        .select('source_message_id', { count: 'exact' })
        .eq('guild_id', guildId)
        .eq('event_type', 'reply')
        .gte('event_ts', windowStart);

      const repliedMessageIds = new Set(
        (replyData ?? []).map((r: { source_message_id: string | null }) => r.source_message_id).filter(Boolean),
      );

      // Count co_presence or mention events in the same window (proxy for messages sent)
      const { data: sentData } = await sb
        .from(T_COMMUNITY_INTERACTION_EVENTS)
        .select('source_message_id', { count: 'exact' })
        .eq('guild_id', guildId)
        .in('event_type', ['mention', 'co_presence'])
        .gte('event_ts', windowStart);

      const sentMessageIds = new Set(
        (sentData ?? []).map((r: { source_message_id: string | null }) => r.source_message_id).filter(Boolean),
      );

      const unansweredCount = [...sentMessageIds].filter((id) => id && !repliedMessageIds.has(id)).length;

      if (unansweredCount >= 3) {
        const unansweredPayload: DiscordPulsePayload = {
          channelId: 'guild-wide',
          messageVolume24h: cur,
          unansweredQuestions: unansweredCount,
          avgResponseTimeMinutes: null,
        };
        observations.push({
          guildId,
          channel: 'discord-pulse',
          severity: unansweredCount >= 10 ? 'warning' : 'info',
          title: `${unansweredCount}개의 메시지가 ${thresholdMinutes}분 동안 답변 없이 대기 중입니다`,
          payload: unansweredPayload,
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
