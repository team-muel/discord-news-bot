import type { Message } from 'discord.js';
import logger from '../../logger';
import { createMemoryItem } from '../../services/agent/agentMemoryStore';
import { recordCommunityInteractionEvent } from '../../services/communityGraphService';
import { recordDiscordChannelMessageSignal } from '../../services/discordChannelTelemetryService';
import { getGuildActionPolicy } from '../../services/skills/actionGovernanceStore';
import { isUserLearningEnabled } from '../../services/userLearningPrefsService';
import { TtlCache } from '../../utils/ttlCache';

const LEARNING_POLICY_ACTION = 'memory_learning';
const learningPolicyCache = new TtlCache<boolean>(200);
const LEARNING_POLICY_TTL_MS = 30_000;

const isGuildLearningEnabled = async (guildId: string): Promise<boolean> => {
  const cached = learningPolicyCache.get(guildId);
  if (cached !== null) {
    return cached;
  }

  const policy = await getGuildActionPolicy(guildId, LEARNING_POLICY_ACTION);
  learningPolicyCache.set(guildId, policy.enabled, LEARNING_POLICY_TTL_MS);
  return policy.enabled;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const CO_PRESENCE_WINDOW_MS = 30 * 60 * 1000;
const CO_PRESENCE_MAX_TARGETS = 2;

const collectCoPresenceSignals = async (
  message: Message,
  excludedTargetIds: Set<string>,
): Promise<Array<{ targetUserId: string; eventType: 'co_presence'; weight: number }>> => {
  if (!(message.channel && 'messages' in message.channel)) {
    return [];
  }

  try {
    const recent = await message.channel.messages.fetch({ limit: 8, before: message.id });
    const out: Array<{ targetUserId: string; eventType: 'co_presence'; weight: number }> = [];

    for (const candidate of recent.values()) {
      const authorId = String(candidate.author?.id || '').trim();
      if (!authorId || authorId === message.author.id) {
        continue;
      }
      if (candidate.author?.bot) {
        continue;
      }
      if (excludedTargetIds.has(authorId)) {
        continue;
      }
      if ((message.createdTimestamp - candidate.createdTimestamp) > CO_PRESENCE_WINDOW_MS) {
        continue;
      }

      excludedTargetIds.add(authorId);
      out.push({
        targetUserId: authorId,
        eventType: 'co_presence',
        weight: 0.2,
      });

      if (out.length >= CO_PRESENCE_MAX_TARGETS) {
        break;
      }
    }

    return out;
  } catch {
    return [];
  }
};

export const processPassiveMemoryCapture = async (message: Message): Promise<void> => {
  if (!message.guildId || message.author.bot) {
    return;
  }

  recordDiscordChannelMessageSignal({
    guildId: message.guildId,
    channelId: message.channelId,
    channelName: (message.channel as any)?.name || 'unknown',
    authorId: message.author.id,
  });

  const guildEnabled = await isGuildLearningEnabled(message.guildId);
  const userEnabled = guildEnabled
    ? await isUserLearningEnabled(message.author.id, message.guildId)
    : false;

  if (!guildEnabled || !userEnabled) {
    return;
  }

  const content = String(message.content || '').trim();
  if (content.length < 20 || content.startsWith('/')) {
    return;
  }

  const socialSignals: Array<{ targetUserId: string; eventType: 'reply' | 'mention' | 'co_presence'; weight: number }> = [];
  const repliedUser = message.mentions.repliedUser;
  if (repliedUser && !repliedUser.bot && repliedUser.id !== message.author.id) {
    socialSignals.push({
      targetUserId: repliedUser.id,
      eventType: 'reply',
      weight: 1,
    });
  }

  for (const user of message.mentions.users.values()) {
    if (user.bot || user.id === message.author.id) {
      continue;
    }
    socialSignals.push({
      targetUserId: user.id,
      eventType: 'mention',
      weight: 0.7,
    });
  }

  const excludedTargetIds = new Set<string>(socialSignals.map((signal) => signal.targetUserId));
  const coPresenceSignals = await collectCoPresenceSignals(message, excludedTargetIds);
  socialSignals.push(...coPresenceSignals);

  const dedupedSignals = new Map<string, { targetUserId: string; eventType: 'reply' | 'mention' | 'co_presence'; weight: number }>();
  for (const signal of socialSignals) {
    const key = `${signal.targetUserId}:${signal.eventType}`;
    if (!dedupedSignals.has(key)) {
      dedupedSignals.set(key, signal);
    }
  }

  for (const signal of dedupedSignals.values()) {
    void recordCommunityInteractionEvent({
      guildId: message.guildId,
      actorUserId: message.author.id,
      targetUserId: signal.targetUserId,
      channelId: message.channelId,
      sourceMessageId: message.id,
      eventType: signal.eventType,
      eventTs: message.createdAt.toISOString(),
      weight: signal.weight,
      metadata: {
        source: 'passive_memory_capture',
      },
    }).catch((error) => {
      logger.debug('[COMMUNITY-GRAPH] passive interaction capture skipped: %s', getErrorMessage(error));
    });
  }

  await createMemoryItem({
    guildId: message.guildId,
    channelId: message.channelId,
    type: 'episode',
    title: `discord:${message.author.id}:${new Date().toISOString().slice(0, 10)}`,
    content: content.slice(0, 2000),
    tags: ['discord-chat', 'auto-captured', `user:${message.author.id}`, `channel:${message.channelId}`],
    confidence: 0.55,
    actorId: 'system',
    ownerUserId: message.author.id,
    source: {
      sourceKind: 'discord_message',
      sourceMessageId: message.id,
      sourceAuthorId: message.author.id,
      sourceRef: `discord://guild/${message.guildId}/channel/${message.channelId}/message/${message.id}`,
      excerpt: content.slice(0, 300),
    },
  }).catch((error) => {
    logger.debug('[MEMORY] passive capture skipped: %s', getErrorMessage(error));
  });
};
