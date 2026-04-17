import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireDistributedLease: vi.fn(),
  seedFeedbackReactions: vi.fn(),
}));

vi.mock('../../services/infra/distributedLockService', () => ({
  acquireDistributedLease: mocks.acquireDistributedLease,
}));

vi.mock('../session', () => ({
  seedFeedbackReactions: mocks.seedFeedbackReactions,
  getSharedSessionStore: vi.fn(),
  incrementActiveSessions: vi.fn(),
  decrementActiveSessions: vi.fn(),
  getActiveSessionCount: vi.fn().mockReturnValue(0),
}));

const createMessage = (content: string, id: string) => {
  const replyMessage = {
    id: `reply-${id}`,
    edit: vi.fn().mockResolvedValue(undefined),
  };
  return {
    id,
    content,
    guildId: 'guild-1',
    author: { id: 'user-1', bot: false },
    client: { user: { id: 'bot-1' } },
    channel: {
      id: 'channel-1',
      name: 'general',
      type: 0,
      parent: null,
      send: vi.fn(),
    },
    mentions: {
      has: vi.fn().mockReturnValue(false),
      repliedUser: null,
    },
    reference: null,
    reply: vi.fn().mockResolvedValue(replyMessage),
  };
};

const createDeps = (overrides: Record<string, unknown> = {}) => ({
  getReplyVisibility: vi.fn().mockReturnValue('private'),
  startVibeSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
  streamSessionProgress: vi.fn().mockResolvedValue(undefined),
  tryPostCodeThread: vi.fn().mockResolvedValue(undefined),
  codeThreadEnabled: false,
  codingIntentPattern: /코드|구현|만들/i,
  automationIntentPattern: /자동화|연동|상태|실행/i,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  ...overrides,
});

describe('vibe message ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireDistributedLease.mockResolvedValue({
      acquired: true,
      release: vi.fn().mockResolvedValue(undefined),
    });
    mocks.seedFeedbackReactions.mockResolvedValue(undefined);
  });

  it('prefers the injected Chat SDK ingress for prefixed vibe messages', async () => {
    const executePrefixedMessageIngress = vi.fn(async () => ({
      result: {
        answer: 'Chat SDK handled this vibe request',
        adapterId: 'chat-sdk',
        continuityQueued: true,
      },
      telemetry: {
        correlationId: 'message-openclaw',
        surface: 'muel-message',
        guildId: 'guild-1',
        replyMode: 'channel',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'adapter_accept',
        fallbackReason: null,
        shadowMode: false,
      },
    }));
    const message = createMessage('뮤엘 오늘 작업 이어서 진행해줘', 'message-openclaw');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({ executePrefixedMessageIngress });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(executePrefixedMessageIngress).toHaveBeenCalledWith(expect.objectContaining({
      request: '오늘 작업 이어서 진행해줘',
      guildId: 'guild-1',
      userId: 'user-1',
      messageId: 'message-openclaw',
      correlationId: 'message-openclaw',
      entryLabel: '뮤엘 메시지',
      surface: 'muel-message',
      replyMode: 'channel',
      tenantLane: 'operator-personal',
    }));
    expect(deps.startVibeSession).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('Chat SDK handled this vibe request');
    expect(mocks.seedFeedbackReactions).toHaveBeenCalledWith(expect.objectContaining({ id: 'reply-message-openclaw' }));
  });

  it('falls back to the existing vibe session flow when Chat SDK ingress does not handle the message', async () => {
    const executePrefixedMessageIngress = vi.fn(async () => ({
      result: null,
      telemetry: {
        correlationId: 'message-fallback',
        surface: 'muel-message',
        guildId: 'guild-1',
        replyMode: 'channel',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'legacy_fallback',
        fallbackReason: 'adapter_declined',
        shadowMode: false,
      },
    }));
    const message = createMessage('뮤엘 계획 이어서 실행해줘', 'message-fallback');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({
      executePrefixedMessageIngress,
      startVibeSession: vi.fn().mockResolvedValue({ id: 'session-2' }),
    });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).toHaveBeenCalledWith('guild-1', 'user-1', '계획 이어서 실행해줘');
  });

  it('falls back deterministically when prefixed ingress runs in shadow mode', async () => {
    const executePrefixedMessageIngress = vi.fn(async () => ({
      result: null,
      telemetry: {
        correlationId: 'message-shadow',
        surface: 'muel-message',
        guildId: 'guild-1',
        replyMode: 'channel',
        selectedAdapterId: 'chat-sdk',
        adapterId: 'chat-sdk',
        routeDecision: 'shadow_only',
        fallbackReason: 'shadow_mode',
        shadowMode: true,
      },
    }));
    const message = createMessage('뮤엘 자동화 상태 이어서 알려줘', 'message-shadow');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({
      executePrefixedMessageIngress,
      startVibeSession: vi.fn().mockResolvedValue({ id: 'session-shadow' }),
    });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).toHaveBeenCalledWith('guild-1', 'user-1', '자동화 상태 이어서 알려줘');
    expect(mocks.seedFeedbackReactions).not.toHaveBeenCalled();
  });
});
