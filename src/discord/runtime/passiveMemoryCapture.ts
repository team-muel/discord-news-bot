import type { Message } from 'discord.js';
import logger from '../../logger';
import { createMemoryItem } from '../../services/agentMemoryStore';
import { recordDiscordChannelMessageSignal } from '../../services/discordChannelTelemetryService';
import { getGuildActionPolicy } from '../../services/skills/actionGovernanceStore';
import { isUserLearningEnabled } from '../../services/userLearningPrefsService';

const LEARNING_POLICY_ACTION = 'memory_learning';
const learningPolicyCache = new Map<string, { enabled: boolean; fetchedAt: number }>();

const isGuildLearningEnabled = async (guildId: string): Promise<boolean> => {
  const cached = learningPolicyCache.get(guildId);
  if (cached && (Date.now() - cached.fetchedAt) < 30_000) {
    return cached.enabled;
  }

  const policy = await getGuildActionPolicy(guildId, LEARNING_POLICY_ACTION);
  const enabled = policy.enabled;
  learningPolicyCache.set(guildId, { enabled, fetchedAt: Date.now() });
  return enabled;
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
