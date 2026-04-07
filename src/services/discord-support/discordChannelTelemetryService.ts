import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv } from '../../utils/env';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';
import { doc } from '../obsidian/obsidianDocBuilder';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import { createBucketManager } from './bucketFlushUtils';

type ChannelEntry = { name: string; count: number; isThread: boolean; parentChannelId: string | null };

type GuildBucket = {
  hourKey: string;
  total: number;
  channels: Map<string, ChannelEntry>;
  users: Map<string, number>;
};

const ENABLED = parseBooleanEnv(process.env.DISCORD_CHANNEL_TELEMETRY_ENABLED, true);
const FLUSH_EVERY_EVENTS = parseMinIntEnv(process.env.DISCORD_CHANNEL_TELEMETRY_FLUSH_EVERY_EVENTS, 40, 5);
const MAX_CHANNEL_LINES = parseMinIntEnv(process.env.DISCORD_CHANNEL_TELEMETRY_MAX_CHANNELS, 30, 5);
const MAX_USER_LINES = parseMinIntEnv(process.env.DISCORD_CHANNEL_TELEMETRY_MAX_USERS, 30, 5);

const logSignal = (guildId: string, outcome: OutcomeSignal, detail: string) => {
  logOutcomeSignal({
    scope: 'discord-event',
    component: 'channel-telemetry',
    guildId,
    outcome,
    detail,
  });
};

const toSortedEntries = <T>(map: Map<string, T>, toCount: (value: T) => number): Array<[string, T]> => {
  return [...map.entries()].sort((a, b) => toCount(b[1]) - toCount(a[1]));
};

const renderBucketMarkdown = (guildId: string, bucket: GuildBucket): string => {
  const sorted = toSortedEntries(bucket.channels, (v) => v.count).slice(0, MAX_CHANNEL_LINES);
  const channelEntries = sorted.filter(([, v]) => !v.isThread);
  const threadEntries = sorted.filter(([, v]) => v.isThread);

  const topChannels = channelEntries
    .map(([channelId, value]) => `<#${channelId}> (${value.name || 'unknown'}): ${value.count}`);

  const topThreads = threadEntries
    .map(([threadId, value]) => {
      const parentRef = value.parentChannelId ? ` parent=<#${value.parentChannelId}>` : '';
      return `↳ ${value.name || 'unnamed'} (${threadId}${parentRef}): ${value.count}`;
    });

  const topUsers = toSortedEntries(bucket.users, (v) => v)
    .slice(0, MAX_USER_LINES)
    .map(([userId, count]) => `<@${userId}>: ${count}`);

  const builder = doc()
    .title('Discord Channel Activity Snapshot')
    .tag('discord-activity', 'telemetry', 'auto-snapshot')
    .property('schema', 'muel-note/v1')
    .property('source', 'discord-channel-telemetry')
    .property('category', 'operations')
    .property('updated_at', new Date().toISOString())
    .section('Metadata')
    .bullet(`guild_id: ${guildId}`)
    .bullet(`hour_bucket_utc: ${bucket.hourKey}`)
    .bullet(`captured_at: ${new Date().toISOString()}`)
    .bullet(`total_messages: ${bucket.total}`);

  builder.section('Top Channels').bullets(topChannels.length > 0 ? topChannels : ['none']);
  builder.section('Top Threads').bullets(topThreads.length > 0 ? topThreads : ['none']);
  builder.section('Top Users').bullets(topUsers.length > 0 ? topUsers : ['none']);

  return builder.build().markdown;
};

const flushBucketImpl = async (guildId: string, bucket: GuildBucket): Promise<void> => {
  if (bucket.total <= 0) return;

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    logSignal(guildId, 'degraded', 'vault_path_missing');
    return;
  }

  const content = renderBucketMarkdown(guildId, bucket);
  const result = await upsertObsidianGuildDocument({
    guildId,
    vaultPath,
    fileName: `events/ingest/channel_activity_${bucket.hourKey}`,
    content,
    tags: ['discord-activity', 'telemetry', 'auto-snapshot'],
    properties: {
      schema: 'muel-note/v1',
      source: 'discord-channel-telemetry',
      category: 'operations',
      updated_at: new Date().toISOString(),
    },
  });

  if (!result.ok) {
    logger.debug('[DISCORD-TELEMETRY] flush failed guild=%s reason=%s', guildId, result.reason || 'WRITE_FAILED');
    logSignal(guildId, 'failure', `flush_failed:${result.reason || 'WRITE_FAILED'}`);
    return;
  }

  logSignal(guildId, 'success', `flush_ok:count=${bucket.total}`);
  bucket.total = 0;
  bucket.channels.clear();
  bucket.users.clear();
};

const mgr = createBucketManager<GuildBucket>({
  createBucket: (hourKey) => ({ hourKey, total: 0, channels: new Map(), users: new Map() }),
  flushFn: flushBucketImpl,
  maxBuckets: 200,
});

export const recordDiscordChannelMessageSignal = (params: {
  guildId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  isThread?: boolean;
  parentChannelId?: string | null;
}): void => {
  if (!ENABLED) {
    return;
  }

  mgr.ensureShutdownHooks();

  const guildId = String(params.guildId || '').trim();
  const channelId = String(params.channelId || '').trim();
  const authorId = String(params.authorId || '').trim();
  if (!guildId || !channelId || !authorId) {
    return;
  }

  const bucket = mgr.getOrCreate(guildId);

  bucket.total += 1;

  const channel = bucket.channels.get(channelId) || {
    name: params.channelName || 'unknown',
    count: 0,
    isThread: params.isThread ?? false,
    parentChannelId: params.parentChannelId ?? null,
  };
  channel.count += 1;
  if (params.channelName) {
    channel.name = params.channelName;
  }
  bucket.channels.set(channelId, channel);

  // Also count thread messages under parent channel
  if (params.isThread && params.parentChannelId) {
    const parentEntry = bucket.channels.get(params.parentChannelId) || {
      name: 'unknown',
      count: 0,
      isThread: false,
      parentChannelId: null,
    };
    parentEntry.count += 1;
    bucket.channels.set(params.parentChannelId, parentEntry);
  }

  bucket.users.set(authorId, (bucket.users.get(authorId) || 0) + 1);

  if (bucket.total % FLUSH_EVERY_EVENTS === 0) {
    void mgr.flush(guildId);
  }
};
