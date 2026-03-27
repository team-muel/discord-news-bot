import logger from '../logger';
import { parseBooleanEnv, parseIntegerEnv } from '../utils/env';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from './obsidian/authoring';
import { logOutcomeSignal, type OutcomeSignal } from './observability/outcomeSignal';

type MessageReward = {
  channelId: string;
  up: number;
  down: number;
};

type RewardBucket = {
  hourKey: string;
  totalEvents: number;
  upEvents: number;
  downEvents: number;
  messageScores: Map<string, MessageReward>;
  userFeedback: Map<string, { up: number; down: number }>;
};

const ENABLED = parseBooleanEnv(process.env.DISCORD_REACTION_REWARD_ENABLED, true);
const FLUSH_EVERY_EVENTS = Math.max(2, parseIntegerEnv(process.env.DISCORD_REACTION_REWARD_FLUSH_EVERY_EVENTS, 10));
const MAX_MESSAGE_LINES = Math.max(5, parseIntegerEnv(process.env.DISCORD_REACTION_REWARD_MAX_MESSAGES, 40));
const MAX_USER_LINES = Math.max(5, parseIntegerEnv(process.env.DISCORD_REACTION_REWARD_MAX_USERS, 40));

const MAX_REWARD_BUCKETS = 200;
const buckets = new Map<string, RewardBucket>();
const flushingGuilds = new Set<string>();
let shutdownHooksInstalled = false;

const logSignal = (guildId: string, outcome: OutcomeSignal, detail: string) => {
  logOutcomeSignal({
    scope: 'discord-event',
    component: 'reaction-reward',
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

const normalizeEmoji = (value: string): 'up' | 'down' | null => {
  const trimmed = String(value || '').trim();
  if (trimmed === '👍' || trimmed.toLowerCase() === 'thumbsup') {
    return 'up';
  }
  if (trimmed === '😡' || trimmed.toLowerCase() === 'rage') {
    return 'down';
  }
  return null;
};

const score = (reward: MessageReward): number => reward.up - reward.down;

const renderBucketMarkdown = (guildId: string, bucket: RewardBucket): string => {
  const sortedMessages = [...bucket.messageScores.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, MAX_MESSAGE_LINES)
    .map(([messageId, reward]) => {
      return `- message=${messageId} channel=<#${reward.channelId}> score=${score(reward)} (👍${reward.up}/😡${reward.down})`;
    });

  const sortedUsers = [...bucket.userFeedback.entries()]
    .sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))
    .slice(0, MAX_USER_LINES)
    .map(([userId, value]) => `- <@${userId}>: 👍${value.up} / 😡${value.down}`);

  const rewardScore = [...bucket.messageScores.values()].reduce((sum, item) => sum + score(item), 0);

  return [
    '# Discord Reaction Reward Snapshot',
    '',
    `- guild_id: ${guildId}`,
    `- hour_bucket_utc: ${bucket.hourKey}`,
    `- captured_at: ${new Date().toISOString()}`,
    `- total_events: ${bucket.totalEvents}`,
    `- up_events: ${bucket.upEvents}`,
    `- down_events: ${bucket.downEvents}`,
    `- reward_score: ${rewardScore}`,
    '',
    '## Top Message Scores',
    ...(sortedMessages.length > 0 ? sortedMessages : ['- none']),
    '',
    '## Top Feedback Users',
    ...(sortedUsers.length > 0 ? sortedUsers : ['- none']),
  ].join('\n');
};

const flushBucket = async (guildId: string): Promise<void> => {
  const bucket = buckets.get(guildId);
  if (!bucket || bucket.totalEvents <= 0) {
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
      fileName: `events/reward/reaction_reward_${bucket.hourKey}`,
      content,
      tags: ['reward-signal', 'reaction', 'thumbs-feedback'],
      properties: {
        schema: 'muel-note/v1',
        source: 'discord-reaction-reward',
        category: 'operations',
        updated_at: new Date().toISOString(),
      },
    });

    if (!result.ok) {
      logger.debug('[REACTION-REWARD] flush failed guild=%s reason=%s', guildId, result.reason || 'WRITE_FAILED');
      logSignal(guildId, 'failure', `flush_failed:${result.reason || 'WRITE_FAILED'}`);
      return;
    }

    logSignal(guildId, 'success', `flush_ok:events=${bucket.totalEvents}`);
    bucket.totalEvents = 0;
    bucket.upEvents = 0;
    bucket.downEvents = 0;
    bucket.messageScores.clear();
    bucket.userFeedback.clear();
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

export const recordReactionRewardSignal = (params: {
  guildId: string;
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
  direction: 'add' | 'remove';
}): void => {
  if (!ENABLED) {
    return;
  }

  ensureShutdownHooks();

  const guildId = String(params.guildId || '').trim();
  const channelId = String(params.channelId || '').trim();
  const messageId = String(params.messageId || '').trim();
  const userId = String(params.userId || '').trim();
  const kind = normalizeEmoji(params.emoji);
  if (!guildId || !channelId || !messageId || !userId || !kind) {
    return;
  }

  const delta = params.direction === 'add' ? 1 : -1;
  const currentHourKey = hourKeyNow();
  let bucket = buckets.get(guildId);
  if (bucket && bucket.hourKey !== currentHourKey) {
    void flushBucket(guildId);
  }
  if (!bucket || bucket.hourKey !== currentHourKey) {
    bucket = {
      hourKey: currentHourKey,
      totalEvents: 0,
      upEvents: 0,
      downEvents: 0,
      messageScores: new Map(),
      userFeedback: new Map(),
    };
    buckets.set(guildId, bucket);
  }
  // Evict oldest buckets when exceeding cap
  if (buckets.size > MAX_REWARD_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined && oldest !== guildId) buckets.delete(oldest);
  }

  bucket.totalEvents += 1;
  if (kind === 'up') {
    bucket.upEvents = Math.max(0, bucket.upEvents + delta);
  } else {
    bucket.downEvents = Math.max(0, bucket.downEvents + delta);
  }

  const reward = bucket.messageScores.get(messageId) || { channelId, up: 0, down: 0 };
  if (kind === 'up') {
    reward.up = Math.max(0, reward.up + delta);
  } else {
    reward.down = Math.max(0, reward.down + delta);
  }
  reward.channelId = channelId;
  bucket.messageScores.set(messageId, reward);

  const user = bucket.userFeedback.get(userId) || { up: 0, down: 0 };
  if (kind === 'up') {
    user.up = Math.max(0, user.up + delta);
  } else {
    user.down = Math.max(0, user.down + delta);
  }
  bucket.userFeedback.set(userId, user);

  if (bucket.totalEvents % FLUSH_EVERY_EVENTS === 0) {
    void flushBucket(guildId);
  }
};
