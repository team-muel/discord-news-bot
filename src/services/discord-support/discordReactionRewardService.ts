import logger from '../../logger';
import { parseBooleanEnv, parseIntegerEnv, parseMinIntEnv } from '../../utils/env';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';
import { doc } from '../obsidian/obsidianDocBuilder';
import { logOutcomeSignal, type OutcomeSignal } from '../observability/outcomeSignal';
import { createBucketManager } from './bucketFlushUtils';

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
const FLUSH_EVERY_EVENTS = parseMinIntEnv(process.env.DISCORD_REACTION_REWARD_FLUSH_EVERY_EVENTS, 10, 2);
const MAX_MESSAGE_LINES = parseMinIntEnv(process.env.DISCORD_REACTION_REWARD_MAX_MESSAGES, 40, 5);
const MAX_USER_LINES = parseMinIntEnv(process.env.DISCORD_REACTION_REWARD_MAX_USERS, 40, 5);

const logSignal = (guildId: string, outcome: OutcomeSignal, detail: string) => {
  logOutcomeSignal({
    scope: 'discord-event',
    component: 'reaction-reward',
    guildId,
    outcome,
    detail,
  });
};

const POSITIVE_EMOJI_SET = new Set(['thumbsup', '👍', '+1', 'heart', '❤️', '❤', 'fire', '🔥', 'clap', '👏', 'tada', '🎉', 'white_check_mark', '✅']);
const NEGATIVE_EMOJI_SET = new Set(['thumbsdown', '👎', '-1', 'rage', '😡', 'x', '❌', 'disappointed', '😞', 'confused', '😕']);

const normalizeEmoji = (value: string): 'up' | 'down' | null => {
  const lower = String(value || '').trim().toLowerCase();
  if (POSITIVE_EMOJI_SET.has(lower)) return 'up';
  if (NEGATIVE_EMOJI_SET.has(lower)) return 'down';
  return null;
};

const score = (reward: MessageReward): number => reward.up - reward.down;

const renderBucketMarkdown = (guildId: string, bucket: RewardBucket): string => {
  const sortedMessages = [...bucket.messageScores.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]))
    .slice(0, MAX_MESSAGE_LINES)
    .map(([messageId, reward]) => {
      return `message=${messageId} channel=<#${reward.channelId}> score=${score(reward)} (👍${reward.up}/😡${reward.down})`;
    });

  const sortedUsers = [...bucket.userFeedback.entries()]
    .sort((a, b) => (b[1].up + b[1].down) - (a[1].up + a[1].down))
    .slice(0, MAX_USER_LINES)
    .map(([userId, value]) => `<@${userId}>: 👍${value.up} / 😡${value.down}`);

  const rewardScore = [...bucket.messageScores.values()].reduce((sum, item) => sum + score(item), 0);

  const builder = doc()
    .title('Discord Reaction Reward Snapshot')
    .tag('reward-signal', 'reaction', 'thumbs-feedback')
    .property('schema', 'muel-note/v1')
    .property('source', 'discord-reaction-reward')
    .property('category', 'operations')
    .property('updated_at', new Date().toISOString())
    .section('Metadata')
    .bullet(`guild_id: ${guildId}`)
    .bullet(`hour_bucket_utc: ${bucket.hourKey}`)
    .bullet(`captured_at: ${new Date().toISOString()}`)
    .bullet(`total_events: ${bucket.totalEvents}`)
    .bullet(`up_events: ${bucket.upEvents}`)
    .bullet(`down_events: ${bucket.downEvents}`)
    .bullet(`reward_score: ${rewardScore}`);

  builder.section('Top Message Scores').bullets(sortedMessages.length > 0 ? sortedMessages : ['none']);
  builder.section('Top Feedback Users').bullets(sortedUsers.length > 0 ? sortedUsers : ['none']);

  return builder.build().markdown;
};

const flushBucketImpl = async (guildId: string, bucket: RewardBucket): Promise<void> => {
  if (bucket.totalEvents <= 0) return;

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
};

const mgr = createBucketManager<RewardBucket>({
  createBucket: (hourKey) => ({
    hourKey, totalEvents: 0, upEvents: 0, downEvents: 0,
    messageScores: new Map(), userFeedback: new Map(),
  }),
  flushFn: flushBucketImpl,
  maxBuckets: 200,
});

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

  mgr.ensureShutdownHooks();

  const guildId = String(params.guildId || '').trim();
  const channelId = String(params.channelId || '').trim();
  const messageId = String(params.messageId || '').trim();
  const userId = String(params.userId || '').trim();
  const kind = normalizeEmoji(params.emoji);
  if (!guildId || !channelId || !messageId || !userId || !kind) {
    return;
  }

  const delta = params.direction === 'add' ? 1 : -1;
  const bucket = mgr.getOrCreate(guildId);

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
    void mgr.flush(guildId);
  }
};
