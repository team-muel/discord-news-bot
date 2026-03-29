/**
 * Discord UI helpers — embed builders, colour constants, common reply utilities.
 * No service imports. No side-effects on load.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { DISCORD_MESSAGES } from './messages';
import {
  DISCORD_ADMIN_DETAILS_LIMIT,
  DISCORD_ADMIN_SUMMARY_LIMIT,
  DISCORD_EMBED_DESCRIPTION_LIMIT,
} from './runtimePolicy';

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
      description: String(description || '').slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT),
      color,
    },
  ],
});

export const buildUserCard = (title: string, description: string, color = EMBED_INFO) => ({
  embeds: [
    {
      title,
      description: String(description || '').slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT),
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
      description: String(summary || '').slice(0, DISCORD_ADMIN_SUMMARY_LIMIT),
      fields:
        details.length > 0
          ? [{ name: DISCORD_MESSAGES.ui.detailsFieldTitle, value: details.join('\n').slice(0, DISCORD_ADMIN_DETAILS_LIMIT) }]
          : undefined,
      footer: { text: DISCORD_MESSAGES.ui.footerAdmin },
    },
  ],
});

// ─── Error helpers ────────────────────────────────────────────────────────────
const SENSITIVE_PATTERN = /supabase|postgres|token|secret|api.key|authorization|password|connection.string/i;

export const getErrorMessage = (error: unknown): string => {
  let raw: string;
  if (error instanceof Error && error.message) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) {
      raw = parts.join(' | ');
    } else {
      try {
        raw = JSON.stringify(error);
      } catch {
        raw = String(error);
      }
    }
  } else {
    raw = String(error);
  }
  return SENSITIVE_PATTERN.test(raw) ? 'internal error' : raw;
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
