import { Chat, ConsoleLogger, Message as ChatSdkMessage, type Author, type Thread } from 'chat';
import { createDiscordAdapter, type DiscordAdapter } from '@chat-adapter/discord';
import { createMemoryState } from '@chat-adapter/state-memory';
import { createRedisState } from '@chat-adapter/state-redis';
import {
  type ChatInputCommandInteraction,
  type Message as DiscordMessage,
  type User,
} from 'discord.js';
import { DISCORD_CHAT_COMMAND_NAMES } from '../../../config/runtime/discordCommandCatalog.js';
import {
  DISCORD_APPLICATION_ID,
  DISCORD_BOT_TOKEN,
  DISCORD_CHAT_SDK_ENABLED,
  DISCORD_PUBLIC_KEY,
} from '../../config';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  executeDiscordIngress,
  normalizeDiscordRequest,
  type DiscordIngressRouteRequest,
} from './discordIngressAdapter';

const CHAT_SDK_MESSAGE_PREFIX_PATTERN = /^뮤엘(?:아)?(?:(?:\s*:\s*)|\s+|$)/i;
const CHAT_SDK_FAILURE_REPLY = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

type ChatSdkStateKind = 'memory' | 'redis';

type DiscordChatSdkRuntime = {
  bot: Chat<{ discord: DiscordAdapter }>;
  adapter: DiscordAdapter;
  stateKind: ChatSdkStateKind;
};

type SlashCommandRawContext = {
  interaction: ChatInputCommandInteraction;
  request: string;
  shared: boolean;
};

type MessageRawContext = {
  discordMessage: DiscordMessage;
  request: string;
};

let runtime: DiscordChatSdkRuntime | null = null;
let runtimePromise: Promise<DiscordChatSdkRuntime | null> | null = null;
let runtimeConfigLogKey: string | null = null;

const canHandleSlashCommandViaChatSdk = (interaction: ChatInputCommandInteraction): boolean => {
  return interaction.commandName === DISCORD_CHAT_COMMAND_NAMES.ASK_COMPAT
    || interaction.commandName === DISCORD_CHAT_COMMAND_NAMES.MUEL;
};

const buildChatSdkWaitUntil = (label: string) => ({
  waitUntil: (task: Promise<unknown>) => {
    void task.catch((error) => {
      logger.warn('[BOT] Chat SDK background task failed (%s): %s', label, getErrorMessage(error));
    });
  },
});

const buildChatSdkAuthor = (user: User, botUserId: string | null): Author => ({
  userId: user.id,
  userName: user.username,
  fullName: user.globalName || user.username,
  isBot: user.bot,
  isMe: Boolean(botUserId && user.id === botUserId),
});

const resolveChatSdkSlashRequest = (interaction: ChatInputCommandInteraction): string => {
  return normalizeDiscordRequest(interaction.options.getString('질문', false), 1_500);
};

const resolveChatSdkSlashShared = (interaction: ChatInputCommandInteraction): boolean => {
  return String(interaction.options.getString('공개범위', false) || '').trim().toLowerCase() === 'public';
};

const stripChatSdkMessagePrefix = (value: string): string => {
  return normalizeDiscordRequest(String(value || '').replace(CHAT_SDK_MESSAGE_PREFIX_PATTERN, ''), 1_500);
};

const resolveChatSdkThreadId = (adapter: DiscordAdapter, message: DiscordMessage): string => {
  const guildId = message.guildId || '@me';
  const isThread = typeof message.channel.isThread === 'function' && message.channel.isThread();
  const parentId = 'parentId' in message.channel ? message.channel.parentId : null;

  return adapter.encodeThreadId({
    guildId,
    channelId: isThread && parentId ? parentId : message.channelId,
    ...(isThread ? { threadId: message.channelId } : {}),
  });
};

const buildChatSdkMessage = (
  adapter: DiscordAdapter,
  message: DiscordMessage,
  threadId: string,
): ChatSdkMessage<MessageRawContext> => {
  const parsed = adapter.parseMessage({
    id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId || '@me',
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName || message.author.username,
      bot: message.author.bot,
    },
    timestamp: message.createdAt.toISOString(),
    edited_timestamp: message.editedAt ? message.editedAt.toISOString() : null,
    attachments: Array.from(message.attachments.values()).map((attachment) => ({
      filename: attachment.name,
      url: attachment.url,
      size: attachment.size,
      content_type: attachment.contentType || undefined,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    })),
  });

  return new ChatSdkMessage<MessageRawContext>({
    id: parsed.id,
    threadId,
    text: parsed.text,
    formatted: parsed.formatted,
    raw: {
      discordMessage: message,
      request: stripChatSdkMessagePrefix(message.content || ''),
    },
    author: parsed.author,
    metadata: parsed.metadata,
    attachments: parsed.attachments,
    isMention: false,
  });
};

const logRuntimeConfigIssueOnce = (message: string): void => {
  if (runtimeConfigLogKey === message) {
    return;
  }
  runtimeConfigLogKey = message;
  logger.warn('[BOT] Chat SDK runtime unavailable: %s', message);
};

const resolveRuntimeConfigIssue = (): string | null => {
  if (!DISCORD_CHAT_SDK_ENABLED) {
    return 'DISCORD_CHAT_SDK_ENABLED=false';
  }
  if (!DISCORD_BOT_TOKEN) {
    return 'DISCORD_BOT_TOKEN is missing';
  }
  if (!DISCORD_PUBLIC_KEY) {
    return 'DISCORD_PUBLIC_KEY is missing';
  }
  if (!DISCORD_APPLICATION_ID) {
    return 'DISCORD_APPLICATION_ID is missing';
  }
  return null;
};

const buildStateAdapter = (): { state: ReturnType<typeof createMemoryState> | ReturnType<typeof createRedisState>; stateKind: ChatSdkStateKind } => {
  if (String(process.env.REDIS_URL || '').trim()) {
    try {
      return {
        state: createRedisState(),
        stateKind: 'redis',
      };
    } catch (error) {
      logger.warn('[BOT] Chat SDK Redis state init failed, falling back to memory: %s', getErrorMessage(error));
    }
  }

  return {
    state: createMemoryState(),
    stateKind: 'memory',
  };
};

const resolveChatSdkIngressAnswer = async (
  request: DiscordIngressRouteRequest,
  scope: 'slash command' | 'prefixed message',
): Promise<{ answer: string | null; failed: boolean }> => {
  try {
    const execution = await executeDiscordIngress(request);
    return {
      answer: String(execution.result?.answer || '').trim() || null,
      failed: false,
    };
  } catch (error) {
    logger.warn('[BOT] Chat SDK %s failed: %s', scope, getErrorMessage(error));
    return {
      answer: null,
      failed: true,
    };
  }
};

const registerChatSdkHandlers = (runtimeState: DiscordChatSdkRuntime): void => {
  runtimeState.bot.onSlashCommand([
    `/${DISCORD_CHAT_COMMAND_NAMES.ASK_COMPAT}`,
    `/${DISCORD_CHAT_COMMAND_NAMES.MUEL}`,
  ], async (event) => {
    const raw = event.raw as SlashCommandRawContext | null;
    const interaction = raw?.interaction;
    if (!interaction) {
      return;
    }

    const { answer, failed } = await resolveChatSdkIngressAnswer({
      request: raw.request,
      guildId: interaction.guildId,
      userId: interaction.user.id,
      channel: interaction.channel,
      correlationId: interaction.id,
      entryLabel: `/${interaction.commandName}`,
      surface: 'docs-command',
      replyMode: raw.shared ? 'public' : 'private',
    }, 'slash command');

    if (failed) {
      await interaction.editReply(CHAT_SDK_FAILURE_REPLY).catch(() => {});
      return;
    }

    await event.channel.post(answer || CHAT_SDK_FAILURE_REPLY);
  });

  const handlePrefixedMessage = async (
    thread: Thread<Record<string, unknown>, unknown>,
    message: ChatSdkMessage<unknown>,
  ) => {
    const raw = message.raw as MessageRawContext | null;
    const discordMessage = raw?.discordMessage;
    if (!discordMessage) {
      return;
    }

    const { answer } = await resolveChatSdkIngressAnswer({
      request: raw.request,
      guildId: discordMessage.guildId,
      userId: discordMessage.author.id,
      channel: discordMessage.channel,
      messageId: discordMessage.id,
      correlationId: discordMessage.id,
      entryLabel: '뮤엘 메시지',
      surface: 'muel-message',
      replyMode: 'channel',
    }, 'prefixed message');

    await thread.post(answer || CHAT_SDK_FAILURE_REPLY);
  };

  runtimeState.bot.onNewMessage(CHAT_SDK_MESSAGE_PREFIX_PATTERN, handlePrefixedMessage);
  runtimeState.bot.onSubscribedMessage(async (thread, message) => {
    if (!CHAT_SDK_MESSAGE_PREFIX_PATTERN.test(message.text || '')) {
      return;
    }
    await handlePrefixedMessage(thread, message);
  });
};

const createRuntime = async (): Promise<DiscordChatSdkRuntime | null> => {
  const configIssue = resolveRuntimeConfigIssue();
  if (configIssue) {
    logRuntimeConfigIssueOnce(configIssue);
    return null;
  }

  const { state, stateKind } = buildStateAdapter();
  const adapter = createDiscordAdapter({
    botToken: DISCORD_BOT_TOKEN,
    publicKey: DISCORD_PUBLIC_KEY,
    applicationId: DISCORD_APPLICATION_ID,
    userName: 'Muel',
    logger: new ConsoleLogger('info').child('muel-chat-sdk'),
  });
  const bot = new Chat<{ discord: DiscordAdapter }>({
    userName: 'Muel',
    adapters: { discord: adapter },
    state,
    logger: new ConsoleLogger('info').child('muel-chat-sdk'),
  });

  runtime = {
    bot,
    adapter,
    stateKind,
  };
  registerChatSdkHandlers(runtime);
  await bot.initialize();
  runtimeConfigLogKey = null;
  logger.info('[BOT] Chat SDK runtime initialized via %s state', stateKind);
  return runtime;
};

const getRuntime = async (): Promise<DiscordChatSdkRuntime | null> => {
  if (runtime) {
    return runtime;
  }

  if (!runtimePromise) {
    runtimePromise = createRuntime().finally(() => {
      runtimePromise = null;
    });
  }

  return runtimePromise;
};

export const initDiscordChatSdkRuntime = async (): Promise<boolean> => {
  return Boolean(await getRuntime());
};

export const stopDiscordChatSdkRuntime = async (): Promise<void> => {
  const current = runtime || await runtimePromise;
  runtime = null;
  runtimePromise = null;
  if (!current) {
    return;
  }
  await current.bot.shutdown().catch((error) => {
    logger.warn('[BOT] Chat SDK runtime shutdown failed: %s', getErrorMessage(error));
  });
};

export const tryHandleDiscordChatSdkSlashCommand = async (
  interaction: ChatInputCommandInteraction,
): Promise<boolean> => {
  const request = resolveChatSdkSlashRequest(interaction);
  if (!request) {
    return false;
  }

  if (!canHandleSlashCommandViaChatSdk(interaction)) {
    return false;
  }

  const current = await getRuntime();
  if (!current) {
    return false;
  }

  const shared = resolveChatSdkSlashShared(interaction);
  try {
    await interaction.deferReply({ ephemeral: !shared });
  } catch (error) {
    logger.warn('[BOT] Chat SDK slash defer failed, falling back to legacy handler: %s', getErrorMessage(error));
    return false;
  }

  try {
    current.bot.processSlashCommand({
      adapter: current.adapter,
      channelId: interaction.channelId,
      command: `/${interaction.commandName}`,
      text: request,
      raw: {
        interaction,
        request,
        shared,
      } satisfies SlashCommandRawContext,
      user: buildChatSdkAuthor(interaction.user, interaction.client.user?.id || null),
    }, buildChatSdkWaitUntil(`slash:${interaction.id}`));
    return true;
  } catch (error) {
    logger.warn('[BOT] Chat SDK slash dispatch failed, falling back to deferred error reply: %s', getErrorMessage(error));
    await interaction.editReply(CHAT_SDK_FAILURE_REPLY).catch(() => {});
    return true;
  }
};

export const tryHandleDiscordChatSdkPrefixedMessage = async (
  message: DiscordMessage,
): Promise<boolean> => {
  const request = stripChatSdkMessagePrefix(message.content || '');
  if (!request) {
    return false;
  }

  const current = await getRuntime();
  if (!current) {
    return false;
  }

  const threadId = resolveChatSdkThreadId(current.adapter, message);
  try {
    current.bot.processMessage(
      current.adapter,
      threadId,
      () => Promise.resolve(buildChatSdkMessage(current.adapter, message, threadId)),
      buildChatSdkWaitUntil(`message:${message.id}`),
    );
    return true;
  } catch (error) {
    logger.warn('[BOT] Chat SDK prefixed message dispatch failed, falling back to legacy handler: %s', getErrorMessage(error));
    return false;
  }
};
