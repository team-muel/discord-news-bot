import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const chatInstance = {
    onSlashCommand: vi.fn(),
    onNewMessage: vi.fn(),
    onSubscribedMessage: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    processSlashCommand: vi.fn(),
    processMessage: vi.fn(),
  };
  const adapter = {
    encodeThreadId: vi.fn().mockReturnValue('thread-1'),
    parseMessage: vi.fn(),
  };

  return {
    chatInstance,
    adapter,
    createDiscordAdapter: vi.fn(() => adapter),
    createMemoryState: vi.fn(() => ({})),
    createRedisState: vi.fn(() => ({})),
    logger: {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('chat', () => {
  const ConsoleLogger = vi.fn(function FakeConsoleLogger() {
    return {
      child() {
        return this;
      },
    };
  });

  const Chat = vi.fn(function FakeChat() {
    return mocks.chatInstance;
  });

  return {
    Chat,
    ConsoleLogger,
    Message: class MockChatSdkMessage {},
  };
});

vi.mock('@chat-adapter/discord', () => ({
  createDiscordAdapter: mocks.createDiscordAdapter,
}));

vi.mock('@chat-adapter/state-memory', () => ({
  createMemoryState: mocks.createMemoryState,
}));

vi.mock('@chat-adapter/state-redis', () => ({
  createRedisState: mocks.createRedisState,
}));

vi.mock('../../config', () => ({
  DISCORD_APPLICATION_ID: 'app-id',
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_CHAT_SDK_ENABLED: true,
  DISCORD_PUBLIC_KEY: 'public-key',
}));

vi.mock('../../logger', () => ({
  default: mocks.logger,
}));

vi.mock('../../utils/errorMessage', () => ({
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('./discordIngressAdapter', () => ({
  executeDiscordIngress: vi.fn(),
  normalizeDiscordRequest: (value: unknown, maxLength = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength),
}));

const createPrefixedMessage = (content: string) => ({
  id: 'message-1',
  content,
  guildId: 'guild-1',
  channelId: 'channel-1',
  channel: {
    id: 'channel-1',
    parentId: null,
    isThread: () => false,
  },
  author: {
    id: 'user-1',
    username: 'tester',
    globalName: 'Tester',
    bot: false,
  },
  attachments: new Map(),
  createdAt: new Date('2026-04-18T00:00:00.000Z'),
  editedAt: null,
});

describe('chatSdkRuntime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
    mocks.adapter.encodeThreadId.mockReturnValue('thread-1');
  });

  it('dispatches prefixed messages through the Chat SDK runtime when available', async () => {
    mocks.chatInstance.processMessage.mockImplementation(() => undefined);

    const { tryHandleDiscordChatSdkPrefixedMessage } = await import('./chatSdkRuntime');
    const handled = await tryHandleDiscordChatSdkPrefixedMessage(createPrefixedMessage('뮤엘 진행 상황 알려줘') as any);

    expect(handled).toBe(true);
    expect(mocks.chatInstance.processMessage).toHaveBeenCalledWith(
      mocks.adapter,
      'thread-1',
      expect.any(Function),
      expect.objectContaining({
        waitUntil: expect.any(Function),
      }),
    );
  });

  it('returns false when prefixed message dispatch throws so the legacy handler can continue', async () => {
    mocks.chatInstance.processMessage.mockImplementation(() => {
      throw new Error('dispatch failed');
    });

    const { tryHandleDiscordChatSdkPrefixedMessage } = await import('./chatSdkRuntime');
    const handled = await tryHandleDiscordChatSdkPrefixedMessage(createPrefixedMessage('뮤엘 진행 상황 알려줘') as any);

    expect(handled).toBe(false);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      '[BOT] Chat SDK prefixed message dispatch failed, falling back to legacy handler: %s',
      'dispatch failed',
    );
  });
});