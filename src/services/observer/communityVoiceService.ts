/**
 * Community Voice Service — bot proactively speaks to Discord channels.
 *
 * Observations from the observer layer are translated into natural-language
 * messages and sent to a designated community channel. Uses the central LLM
 * (Gemini / OpenAI / Claude / etc.) to craft the message, then delivers via
 * the platform-agnostic ChannelSink.
 *
 * Design: no direct discord.js import; all channel writes go through ChannelSink
 * (automationBot.getActiveSink). Lazy import of LLM to avoid circular refs.
 */

import logger from '../../logger';
import type { Observation } from './observerTypes';

// Per-guild cooldown map — prevents spam if many observations arrive quickly.
const lastSpokenAt = new Map<string, number>();

/**
 * Returns true if the cooldown for this guild has expired.
 */
const acquireCooldownSlot = (guildId: string, cooldownMs: number): boolean => {
  const now = Date.now();
  const last = lastSpokenAt.get(guildId) ?? 0;
  if (now - last < cooldownMs) return false;
  lastSpokenAt.set(guildId, now);
  return true;
};

/**
 * Ask the LLM to turn an observation title into a brief, friendly Discord message.
 * Falls back to the raw title if LLM unavailable.
 */
const craftMessage = async (observation: Observation): Promise<string> => {
  try {
    const { generateText, isAnyLlmConfigured } = await import('../llm/client');
    if (!isAnyLlmConfigured()) {
      return observation.title;
    }
    const text = await generateText({
      system: '당신은 디스코드 커뮤니티의 Muel 봇입니다. 관찰 내용을 간결한 한국어 메시지(2-3문장, 이모지 1개 포함)로 변환합니다. 친근하고 자연스럽게, 봇이 직접 커뮤니티에 말을 거는 형식으로.',
      user: `관찰: ${observation.title}`,
      maxTokens: 200,
      temperature: 0.7,
    });
    return String(text || observation.title).trim();
  } catch {
    return observation.title;
  }
};

/**
 * Send a proactive message to the community channel based on an observation.
 * Respects COMMUNITY_VOICE_ENABLED and cooldown settings.
 */
export const speakObservation = async (observation: Observation): Promise<void> => {
  try {
    const { COMMUNITY_VOICE_ENABLED, COMMUNITY_VOICE_CHANNEL_ID, COMMUNITY_VOICE_COOLDOWN_MS } =
      await import('../../config');

    if (!COMMUNITY_VOICE_ENABLED) return;
    if (!COMMUNITY_VOICE_CHANNEL_ID) return;

    const guildId = observation.guildId || 'default';
    if (!acquireCooldownSlot(guildId, COMMUNITY_VOICE_COOLDOWN_MS)) {
      logger.debug('[COMMUNITY-VOICE] cooldown active for guild %s, skipping', guildId);
      return;
    }

    const { getActiveSink } = await import('../automationBot');
    const sink = getActiveSink();
    if (!sink) {
      logger.debug('[COMMUNITY-VOICE] no active sink, skipping');
      return;
    }

    const message = await craftMessage(observation);

    const severityEmoji = observation.severity === 'critical' ? '🚨' : observation.severity === 'warning' ? '⚠️' : 'ℹ️';

    await sink.sendToChannel(COMMUNITY_VOICE_CHANNEL_ID, {
      embeds: [
        {
          description: message,
          footer: { text: `${severityEmoji} ${observation.channel} · ${new Date(observation.detectedAt).toLocaleTimeString('ko-KR')}` },
          color: observation.severity === 'critical' ? 0xe74c3c : observation.severity === 'warning' ? 0xf39c12 : 0x3498db,
        },
      ],
    });

    logger.info('[COMMUNITY-VOICE] sent observation to channel %s (guild %s)', COMMUNITY_VOICE_CHANNEL_ID, guildId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug('[COMMUNITY-VOICE] speakObservation failed: %s', msg);
  }
};

/** Reset cooldown state (for tests). */
export const __resetCooldownForTests = (): void => {
  lastSpokenAt.clear();
};
