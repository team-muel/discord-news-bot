import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from './obsidian/authoring';
import { logOutcomeSignal, type OutcomeSignal } from './observability/outcomeSignal';

type GuildBucket = {
  hourKey: string;
  total: number;
  channels: Map<string, { name: string; count: number }>;
  users: Map<string, number>;
};

const ENABLED = parseBooleanEnv(process.env.DISCORD_CHANNEL_TELEMETRY_ENABLED, true);
const FLUSH_EVERY_EVENTS = Math.max(5, parseIntegerEnv(process.env.DISCORD_CHANNEL_TELEMETRY_FLUSH_EVERY_EVENTS, 40));
const MAX_CHANNEL_LINES = Math.max(5, parseIntegerEnv(process.env.DISCORD_CHANNEL_TELEMETRY_MAX_CHANNELS, 30));
const MAX_USER_LINES = Math.max(5, parseIntegerEnv(process.env.DISCORD_CHANNEL_TELEMETRY_MAX_USERS, 30));

const MAX_TELEMETRY_BUCKETS = 200;
const buckets = new Map<string, GuildBucket>();
const flushingGuilds = new Set<string>();
let shutdownHooksInstalled = false;

const logSignal = (guildId: string, outcome: OutcomeSignal, detail: string) => {
  logOutcomeSignal({
    scope: 'discord-event',
    component: 'channel-telemetry',
    guildId,
    outcome,
    detail,
  });
};

const hourKeyNow = (): string => {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
};

const toSortedEntries = <T>(map: Map<string, T>, toCount: (value: T) => number): Array<[string, T]> => {
  return [...map.entries()].sort((a, b) => toCount(b[1]) - toCount(a[1]));
};

const renderBucketMarkdown = (guildId: string, bucket: GuildBucket): string => {
  const topChannels = toSortedEntries(bucket.channels, (v) => v.count)
    .slice(0, MAX_CHANNEL_LINES)
    .map(([channelId, value]) => `- <#${channelId}> (${value.name || 'unknown'}): ${value.count}`);

  const topUsers = toSortedEntries(bucket.users, (v) => v)
    .slice(0, MAX_USER_LINES)
    .map(([userId, count]) => `- <@${userId}>: ${count}`);

  return [
    '# Discord Channel Activity Snapshot',
    '',
    `- guild_id: ${guildId}`,
    `- hour_bucket_utc: ${bucket.hourKey}`,
    `- captured_at: ${new Date().toISOString()}`,
    `- total_messages: ${bucket.total}`,
    '',
    '## Top Channels',
    ...(topChannels.length > 0 ? topChannels : ['- none']),
    '',
    '## Top Users',
    ...(topUsers.length > 0 ? topUsers : ['- none']),
  ].join('\n');
};

const flushBucket = async (guildId: string): Promise<void> => {
  const bucket = buckets.get(guildId);
  if (!bucket || bucket.total <= 0) {
    return;
  }

  if (flushingGuilds.has(guildId)) {
    return;
  }
  flushingGuilds.add(guildId);

  try {
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
  } finally {
    flushingGuilds.delete(guildId);
  }
};

const flushAllBuckets = async (): Promise<void> => {
  const guildIds = [...buckets.keys()];
  await Promise.allSettled(guildIds.map((guildId) => flushBucket(guildId)));
};

const ensureShutdownHooks = (): void => {
  if (shutdownHooksInstalled) {
    return;
  }
  shutdownHooksInstalled = true;

  process.on('beforeExit', () => {
    void flushAllBuckets();
  });

  process.on('SIGINT', () => {
    void flushAllBuckets();
  });

  process.on('SIGTERM', () => {
    void flushAllBuckets();
  });
};

export const recordDiscordChannelMessageSignal = (params: {
  guildId: string;
  channelId: string;
  channelName: string;
  authorId: string;
}): void => {
  if (!ENABLED) {
    return;
  }

  ensureShutdownHooks();

  const guildId = String(params.guildId || '').trim();
  const channelId = String(params.channelId || '').trim();
  const authorId = String(params.authorId || '').trim();
  if (!guildId || !channelId || !authorId) {
    return;
  }

  const currentHourKey = hourKeyNow();
  let bucket = buckets.get(guildId);
  if (bucket && bucket.hourKey !== currentHourKey) {
    void flushBucket(guildId);
  }
  if (!bucket || bucket.hourKey !== currentHourKey) {
    bucket = {
      hourKey: currentHourKey,
      total: 0,
      channels: new Map(),
      users: new Map(),
    };
    buckets.set(guildId, bucket);
  }
  // Evict oldest buckets when exceeding cap
  if (buckets.size > MAX_TELEMETRY_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined && oldest !== guildId) buckets.delete(oldest);
  }

  bucket.total += 1;

  const channel = bucket.channels.get(channelId) || { name: params.channelName || 'unknown', count: 0 };
  channel.count += 1;
  if (params.channelName) {
    channel.name = params.channelName;
  }
  bucket.channels.set(channelId, channel);

  bucket.users.set(authorId, (bucket.users.get(authorId) || 0) + 1);

  if (bucket.total % FLUSH_EVERY_EVENTS === 0) {
    void flushBucket(guildId);
  }
};
