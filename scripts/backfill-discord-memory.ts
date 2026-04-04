/* eslint-disable no-console */
import 'dotenv/config';
import { once } from 'node:events';
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type Message,
  type TextChannel,
} from 'discord.js';
import { createMemoryItem } from '../src/services/agent/agentMemoryStore';
import { recordCommunityInteractionEvent } from '../src/services/communityGraphService';
import { getSupabaseClient, isSupabaseConfigured } from '../src/services/supabaseClient';
import { isThreadChannel } from '../src/utils/discordChannelMeta';

type CliOptions = {
  guildId: string;
  channelIds: string[];
  limitPerChannel: number;
  days: number;
  minLength: number;
  includeBots: boolean;
  dryRun: boolean;
};

type Counter = {
  scanned: number;
  eligible: number;
  existing: number;
  inserted: number;
  socialEvents: number;
  failed: number;
};

const DEFAULT_LIMIT_PER_CHANNEL = 200;
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MIN_LENGTH = 20;

const getDiscordToken = (): string => {
  return String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
};

const sanitizeGuildId = (value: unknown): string => {
  const text = String(value || '').trim();
  if (!/^\d{6,30}$/.test(text)) {
    return '';
  }
  return text;
};

const parsePositiveInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  let guildId = '';
  const channelIds = new Set<string>();
  let limitPerChannel = DEFAULT_LIMIT_PER_CHANNEL;
  let days = DEFAULT_LOOKBACK_DAYS;
  let minLength = DEFAULT_MIN_LENGTH;
  let includeBots = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();

    if (current === '--guild' || current === '--guild-id') {
      guildId = sanitizeGuildId(args[i + 1]);
      i += 1;
      continue;
    }

    if (current === '--channel' || current === '--channel-id') {
      const raw = String(args[i + 1] || '').trim();
      if (raw) {
        for (const token of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
          channelIds.add(token);
        }
      }
      i += 1;
      continue;
    }

    if (current === '--limit' || current === '--limit-per-channel') {
      limitPerChannel = parsePositiveInt(args[i + 1], DEFAULT_LIMIT_PER_CHANNEL, 10, 2000);
      i += 1;
      continue;
    }

    if (current === '--days') {
      days = parsePositiveInt(args[i + 1], DEFAULT_LOOKBACK_DAYS, 1, 180);
      i += 1;
      continue;
    }

    if (current === '--min-length') {
      minLength = parsePositiveInt(args[i + 1], DEFAULT_MIN_LENGTH, 1, 1000);
      i += 1;
      continue;
    }

    if (current === '--include-bots') {
      includeBots = true;
      continue;
    }

    if (current === '--dry-run') {
      dryRun = true;
    }
  }

  return {
    guildId,
    channelIds: [...channelIds],
    limitPerChannel,
    days,
    minLength,
    includeBots,
    dryRun,
  };
};

const isTargetChannelType = (type: ChannelType): boolean => {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.PublicThread,
    ChannelType.AnnouncementThread,
  ].includes(type);
};

const isPrivateThreadType = (type: ChannelType): boolean => type === ChannelType.PrivateThread;

type BackfillChannel = Pick<TextChannel, 'id' | 'messages'>;
type BackfillSocialEventType = 'reply' | 'mention';
type BackfillSocialSignal = { targetUserId: string; eventType: BackfillSocialEventType; weight: number };

const fetchRecentMessages = async (
  channel: BackfillChannel,
  cutoffMs: number,
  limit: number,
): Promise<Message[]> => {
  const out: Message[] = [];
  let before: string | undefined;

  while (out.length < limit) {
    const batchSize = Math.min(100, limit - out.length);
    const page = await channel.messages.fetch({ limit: batchSize, before });
    if (page.size === 0) {
      break;
    }

    const sorted = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    let reachedCutoff = false;

    for (const message of sorted) {
      if (message.createdTimestamp < cutoffMs) {
        reachedCutoff = true;
        continue;
      }
      out.push(message);
      if (out.length >= limit) {
        break;
      }
    }

    const oldest = sorted[sorted.length - 1];
    before = oldest?.id;
    if (!before || reachedCutoff) {
      break;
    }
  }

  return out;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const getExistingSourceMessageIds = async (guildId: string, messageIds: string[]): Promise<Set<string>> => {
  if (messageIds.length === 0 || !isSupabaseConfigured()) {
    return new Set<string>();
  }

  const client = getSupabaseClient();
  const out = new Set<string>();

  for (const part of chunk(messageIds, 200)) {
    const { data, error } = await client
      .from('memory_sources')
      .select('source_message_id')
      .eq('guild_id', guildId)
      .in('source_message_id', part);

    if (error) {
      throw new Error(error.message || 'MEMORY_SOURCE_LOOKUP_FAILED');
    }

    for (const row of (data || []) as Array<{ source_message_id: string | null }>) {
      const id = String(row.source_message_id || '').trim();
      if (id) {
        out.add(id);
      }
    }
  }

  return out;
};

const buildSocialEventKey = (
  messageId: string,
  actorUserId: string,
  targetUserId: string,
  eventType: BackfillSocialEventType,
): string => `${messageId}:${actorUserId}:${targetUserId}:${eventType}`;

const getExistingSocialEventKeys = async (guildId: string, messageIds: string[]): Promise<Set<string>> => {
  if (messageIds.length === 0 || !isSupabaseConfigured()) {
    return new Set<string>();
  }

  const client = getSupabaseClient();
  const out = new Set<string>();

  for (const part of chunk(messageIds, 200)) {
    const { data, error } = await client
      .from('community_interaction_events')
      .select('source_message_id, actor_user_id, target_user_id, event_type')
      .eq('guild_id', guildId)
      .in('source_message_id', part);

    if (error) {
      throw new Error(error.message || 'COMMUNITY_EVENT_LOOKUP_FAILED');
    }

    for (const row of (data || []) as Array<{
      source_message_id: string | null;
      actor_user_id: string | null;
      target_user_id: string | null;
      event_type: string | null;
    }>) {
      const messageId = String(row.source_message_id || '').trim();
      const actorUserId = String(row.actor_user_id || '').trim();
      const targetUserId = String(row.target_user_id || '').trim();
      const eventType = String(row.event_type || '').trim() as BackfillSocialEventType;
      if (!messageId || !actorUserId || !targetUserId || (eventType !== 'reply' && eventType !== 'mention')) {
        continue;
      }
      out.add(buildSocialEventKey(messageId, actorUserId, targetUserId, eventType));
    }
  }

  return out;
};

const shouldIngest = (message: Message, options: CliOptions): boolean => {
  if (!options.includeBots && message.author.bot) {
    return false;
  }

  const content = String(message.content || '').trim();
  if (content.length < options.minLength) {
    return false;
  }

  if (content.startsWith('/')) {
    return false;
  }

  return true;
};

const buildSocialSignals = (message: Message): BackfillSocialSignal[] => {
  const out: BackfillSocialSignal[] = [];
  const authorId = String(message.author?.id || '').trim();

  const repliedUser = message.mentions.repliedUser;
  if (repliedUser && !repliedUser.bot && repliedUser.id !== authorId) {
    out.push({
      targetUserId: repliedUser.id,
      eventType: 'reply',
      weight: 1,
    });
  }

  for (const user of message.mentions.users.values()) {
    if (user.bot || user.id === authorId) {
      continue;
    }
    out.push({
      targetUserId: user.id,
      eventType: 'mention',
      weight: 0.7,
    });
  }

  const deduped = new Map<string, BackfillSocialSignal>();
  for (const item of out) {
    const key = `${item.targetUserId}:${item.eventType}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()];
};

const filterMissingSocialSignals = (
  message: Message,
  socialSignals: BackfillSocialSignal[],
  existingKeys: Set<string>,
): BackfillSocialSignal[] => {
  const actorUserId = String(message.author?.id || '').trim();
  return socialSignals.filter((signal) => {
    const key = buildSocialEventKey(message.id, actorUserId, signal.targetUserId, signal.eventType);
    return !existingKeys.has(key);
  });
};

const ingestChannelMessages = async (
  guildId: string,
  channel: BackfillChannel,
  options: CliOptions,
  counter: Counter,
  cutoffMs: number,
): Promise<void> => {
  const fetched = await fetchRecentMessages(channel, cutoffMs, options.limitPerChannel);
  counter.scanned += fetched.length;

  const eligible = fetched.filter((message) => shouldIngest(message, options));
  counter.eligible += eligible.length;
  if (eligible.length === 0) {
    return;
  }

  const existingIds = await getExistingSourceMessageIds(guildId, eligible.map((message) => message.id));
  const existingSocialEventKeys = await getExistingSocialEventKeys(guildId, eligible.map((message) => message.id));

  for (const message of eligible) {
    const socialSignals = buildSocialSignals(message);
    const missingSocialSignals = filterMissingSocialSignals(message, socialSignals, existingSocialEventKeys);

    if (existingIds.has(message.id)) {
      counter.existing += 1;

      if (options.dryRun) {
        counter.socialEvents += missingSocialSignals.length;
        continue;
      }

      try {
        for (const signal of missingSocialSignals) {
          await recordCommunityInteractionEvent({
            guildId,
            actorUserId: message.author.id,
            targetUserId: signal.targetUserId,
            channelId: message.channelId,
            sourceMessageId: message.id,
            eventType: signal.eventType,
            eventTs: message.createdAt.toISOString(),
            weight: signal.weight,
            metadata: {
              source: 'discord_backfill',
            },
          });
          existingSocialEventKeys.add(buildSocialEventKey(message.id, message.author.id, signal.targetUserId, signal.eventType));
          counter.socialEvents += 1;
        }
      } catch {
        counter.failed += 1;
      }
      continue;
    }

    if (options.dryRun) {
      counter.inserted += 1;
      counter.socialEvents += missingSocialSignals.length;
      continue;
    }

    const content = String(message.content || '').trim();
    const msgChannel = message.channel;
    const msgIsThread = isThreadChannel(msgChannel.type);
    const msgParentId = (msgChannel as any).parentId || null;
    const channelTags = msgIsThread
      ? [`thread:${message.channelId}`, ...(msgParentId ? [`channel:${msgParentId}`] : [])]
      : [`channel:${message.channelId}`];
    const sourceRef = msgIsThread && msgParentId
      ? `discord://guild/${guildId}/channel/${msgParentId}/thread/${message.channelId}/message/${message.id}`
      : `discord://guild/${guildId}/channel/${message.channelId}/message/${message.id}`;

    try {
      await createMemoryItem({
        guildId,
        channelId: msgIsThread && msgParentId ? msgParentId : message.channelId,
        type: 'episode',
        title: `discord:${message.author.id}:${new Date(message.createdTimestamp).toISOString().slice(0, 10)}`,
        content: content.slice(0, 2000),
        tags: ['discord-chat', 'backfill', `user:${message.author.id}`, ...channelTags],
        confidence: 0.5,
        actorId: 'system',
        ownerUserId: message.author.id,
        source: {
          sourceKind: 'discord_message',
          sourceMessageId: message.id,
          sourceAuthorId: message.author.id,
          sourceRef,
          excerpt: content.slice(0, 300),
        },
      });

      for (const signal of missingSocialSignals) {
        await recordCommunityInteractionEvent({
          guildId,
          actorUserId: message.author.id,
          targetUserId: signal.targetUserId,
          channelId: message.channelId,
          sourceMessageId: message.id,
          eventType: signal.eventType,
          eventTs: message.createdAt.toISOString(),
          weight: signal.weight,
          metadata: {
            source: 'discord_backfill',
          },
        });
        existingSocialEventKeys.add(buildSocialEventKey(message.id, message.author.id, signal.targetUserId, signal.eventType));
        counter.socialEvents += 1;
      }

      counter.inserted += 1;
    } catch {
      counter.failed += 1;
    }
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs();
  const token = getDiscordToken();
  if (!token) {
    console.error('[discord-backfill] DISCORD_BOT_TOKEN (or DISCORD_TOKEN) is required');
    process.exit(2);
  }

  if (!options.guildId) {
    console.error('[discord-backfill] --guild <guildId> is required');
    process.exit(2);
  }

  if (!options.dryRun && !isSupabaseConfigured()) {
    console.error('[discord-backfill] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when not using --dry-run');
    process.exit(2);
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  const cutoffMs = Date.now() - (options.days * 24 * 60 * 60 * 1000);
  const counter: Counter = { scanned: 0, eligible: 0, existing: 0, inserted: 0, socialEvents: 0, failed: 0 };

  try {
    await client.login(token);
    await once(client, 'ready');

    const guild = await client.guilds.fetch(options.guildId);
    const channels = await guild.channels.fetch();

    const nonNullChannels = [...channels.values()]
      .filter((channel): channel is Exclude<typeof channel, null> => channel !== null);

    const targetChannels = nonNullChannels
      .filter((channel) => isTargetChannelType(channel.type) && !isPrivateThreadType(channel.type) && 'messages' in channel)
      .map((channel) => channel as unknown as BackfillChannel)
      .filter((channel) => options.channelIds.length === 0 || options.channelIds.includes(channel.id));

    console.log(
      `[discord-backfill] guild=${guild.id} channels=${targetChannels.length} dryRun=${String(options.dryRun)} lookbackDays=${options.days} limitPerChannel=${options.limitPerChannel}`,
    );

    for (const channel of targetChannels) {
      await ingestChannelMessages(guild.id, channel, options, counter, cutoffMs);
      console.log(
        `[discord-backfill] channel=${channel.id} scanned=${counter.scanned} eligible=${counter.eligible} inserted=${counter.inserted} socialEvents=${counter.socialEvents} existing=${counter.existing} failed=${counter.failed}`,
      );
    }

    console.log(
      `[discord-backfill] completed guild=${guild.id} scanned=${counter.scanned} eligible=${counter.eligible} inserted=${counter.inserted} socialEvents=${counter.socialEvents} existing=${counter.existing} failed=${counter.failed}`,
    );
  } finally {
    client.destroy();
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[discord-backfill] fatal:', message);
  process.exit(1);
});
