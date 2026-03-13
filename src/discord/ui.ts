/**
 * Discord UI helpers — embed builders, colour constants, common reply utilities.
 * No service imports. No side-effects on load.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_MESSAGES } from './messages';

// ─── Colour palette ───────────────────────────────────────────────────────────
export const EMBED_INFO    = 0x2f80ed;
export const EMBED_SUCCESS = 0x2ecc71;
export const EMBED_WARN    = 0xf39c12;
export const EMBED_ERROR   = 0xe74c3c;

// ─── Embed builders ───────────────────────────────────────────────────────────
export const buildSimpleEmbed = (title: string, description: string, color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      description: String(description || '').slice(0, 3900),
      color,
    },
  ],
});

export const buildUserCard = (title: string, description: string, color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      description: String(description || '').slice(0, 3900),
      color,
      footer: { text: DISCORD_MESSAGES.ui.footerUser },
    },
  ],
});

export const buildAdminCard = (
  title: string,
  summary: string,
  details: string[] = [],
  color = EMBED_INFO,
) => ({
  embeds: [
    {
      title,
      color,
      description: String(summary || '').slice(0, 2000),
      fields:
        details.length > 0
          ? [{ name: DISCORD_MESSAGES.ui.detailsFieldTitle, value: details.join('\n').slice(0, 1000) }]
          : undefined,
      footer: { text: DISCORD_MESSAGES.ui.footerAdmin },
    },
  ],
});

// ─── Error helpers ────────────────────────────────────────────────────────────
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

// ─── Interaction helpers ──────────────────────────────────────────────────────
export type ReplyVisibility = 'private' | 'public';

export const getReplyVisibility = (
  interaction: ChatInputCommandInteraction,
): ReplyVisibility => {
  const value =
    interaction.options.getString('응답방식') ||
    interaction.options.getString('공개범위');
  return value === 'public' ? 'public' : 'private';
};
