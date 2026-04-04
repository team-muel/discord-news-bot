/**
 * Shared Discord channel/thread metadata utilities.
 *
 * Provides a single source of truth for resolving channel vs thread semantics
 * across all service layers. Every service that captures Discord channel data
 * should use these helpers instead of inline `(channel as any)` casts.
 */
import { ChannelType, type Channel } from 'discord.js';

// ─── Thread type set ──────────────────────────────────────────────────────────

const THREAD_TYPES = new Set<ChannelType>([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

const FORUM_TYPES = new Set<ChannelType>([
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

// ─── Exported type ────────────────────────────────────────────────────────────

export type DiscordChannelMeta = {
  channelId: string;
  channelName: string;
  channelType: string;
  isThread: boolean;
  isForumPost: boolean;
  isPrivateThread: boolean;
  parentChannelId: string | null;
  parentChannelName: string | null;
  parentChannelType: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeString = (value: unknown): string => String(value || '').trim();

const channelTypeLabel = (typeValue: number): string => {
  const mapped = ChannelType[typeValue];
  return typeof mapped === 'string' ? mapped : String(typeValue);
};

export const isThreadChannel = (type: ChannelType): boolean => THREAD_TYPES.has(type);

export const isForumChannel = (type: ChannelType): boolean => FORUM_TYPES.has(type);

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Extract structured metadata from a discord.js Channel object.
 * Safe to call with any channel type; uses a Record cast internally so callers don't need to.
 */
export const resolveChannelMeta = (channel: Channel): DiscordChannelMeta => {
  const typed = channel as unknown as Record<string, unknown>;
  const type: ChannelType = (typed.type as ChannelType) ?? ChannelType.GuildText;
  const isThread = isThreadChannel(type);
  const parent = typed.parent as Record<string, unknown> | null ?? null;
  const parentType: ChannelType | null = (parent?.type as ChannelType | null) ?? null;

  return {
    channelId: safeString(typed.id),
    channelName: safeString(typed.name),
    channelType: channelTypeLabel(type),
    isThread,
    isForumPost: isThread && parentType !== null && isForumChannel(parentType),
    isPrivateThread: type === ChannelType.PrivateThread,
    parentChannelId: parent ? safeString(parent.id) : null,
    parentChannelName: parent ? safeString(parent.name) : null,
    parentChannelType: parentType !== null ? channelTypeLabel(parentType) : null,
  };
};

/**
 * Build the display prefix for a channel entry.
 * Channels use `#`, threads use `↳`.
 */
export const channelDisplayPrefix = (meta: DiscordChannelMeta): string =>
  meta.isThread ? '↳' : '#';

/**
 * Build the parent label for structured metadata output.
 * Returns the correct semantic label based on parent type.
 */
export const parentLabel = (meta: DiscordChannelMeta): string | null => {
  if (!meta.parentChannelName) return null;
  if (meta.isForumPost) return `forum=${meta.parentChannelName}`;
  if (meta.isThread) return `parent_channel=${meta.parentChannelName}`;
  // For non-threads, parent is a category
  if (meta.parentChannelType === 'GuildCategory') return `category=${meta.parentChannelName}`;
  return `parent=${meta.parentChannelName}`;
};

// ─── Tag helpers ──────────────────────────────────────────────────────────────

/**
 * Build memory tags that correctly distinguish thread vs channel.
 */
export const buildChannelTags = (meta: DiscordChannelMeta): string[] => {
  const tags: string[] = [];
  if (meta.isThread) {
    tags.push(`thread:${meta.channelId}`);
    if (meta.parentChannelId) {
      tags.push(`channel:${meta.parentChannelId}`);
    }
  } else {
    tags.push(`channel:${meta.channelId}`);
  }
  if (meta.isForumPost) {
    tags.push('forum-post');
  }
  return tags;
};

/**
 * Build a proper source reference URI that preserves thread hierarchy.
 */
export const buildSourceRef = (guildId: string, meta: DiscordChannelMeta, messageId: string): string => {
  if (meta.isThread && meta.parentChannelId) {
    return `discord://guild/${guildId}/channel/${meta.parentChannelId}/thread/${meta.channelId}/message/${messageId}`;
  }
  return `discord://guild/${guildId}/channel/${meta.channelId}/message/${messageId}`;
};
