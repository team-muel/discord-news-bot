import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireDistributedLease: vi.fn(),
  seedFeedbackReactions: vi.fn(),
  ensureFeatureAccess: vi.fn(),
  getAgentSession: vi.fn(),
}));

vi.mock('../../services/multiAgentService', () => ({
  getAgentSession: mocks.getAgentSession,
}));

vi.mock('../auth', () => ({
  ensureFeatureAccess: mocks.ensureFeatureAccess,
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

const createInteraction = (request: string, optionName: '질문' | '요청' = '질문') => ({
  guildId: 'guild-1',
  user: { id: 'user-1' },
  options: {
    getString: vi.fn((name: string) => {
      if (name === optionName) return request;
      if (name === '공개범위') return 'private';
      return null;
    }),
  },
  deferReply: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
  followUp: vi.fn().mockResolvedValue(undefined),
  fetchReply: vi.fn().mockResolvedValue({ id: 'reply-interaction' }),
  reply: vi.fn().mockResolvedValue(undefined),
});

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

  it('normalizes coding requests in prefixed message flow the same way as slash /뮤엘', async () => {
    const executePrefixedMessageIngress = vi.fn(async () => ({
      result: null,
      telemetry: {
        correlationId: 'message-coding-fallback',
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
    const message = createMessage('뮤엘 Express 라우터 만들어줘', 'message-coding-fallback');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({
      executePrefixedMessageIngress,
      startVibeSession: vi.fn().mockResolvedValue({ id: 'session-code-msg' }),
    });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).toHaveBeenCalledWith('guild-1', 'user-1', '코드로 구현해줘: Express 라우터 만들어줘');
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

  it('asks for clarification instead of starting a full session for low-signal mentions', async () => {
    const message = createMessage('<@bot-1> asdf', 'message-low-signal');
    message.mentions.has.mockReturnValue(true);

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps();
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('원하는 작업을 함께 적어주세요. 예: `뮤엘 오늘 뉴스 요약해줘` 또는 `@봇이름 오늘 뉴스 요약해줘`');
  });

  it('asks for clarification for symbol-only or repeated-noise mentions', async () => {
    const message = createMessage('<@bot-1> ㅋㅋㅋㅋㅋㅋㅋ', 'message-noise');
    message.mentions.has.mockReturnValue(true);

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps();
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('원하는 작업을 함께 적어주세요. 예: `뮤엘 오늘 뉴스 요약해줘` 또는 `@봇이름 오늘 뉴스 요약해줘`');
  });

  it('asks for clarification for short multi-token ASCII noise mentions', async () => {
    const message = createMessage('<@bot-1> asdf qwer', 'message-ascii-noise');
    message.mentions.has.mockReturnValue(true);

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps();
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('원하는 작업을 함께 적어주세요. 예: `뮤엘 오늘 뉴스 요약해줘` 또는 `@봇이름 오늘 뉴스 요약해줘`');
  });
});

describe('vibe slash command absorption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureFeatureAccess.mockResolvedValue({ ok: true, autoLoggedIn: false });
    mocks.getAgentSession.mockReturnValue(null);
  });

  it('routes /뮤엘 coding requests through the existing vibe session flow', async () => {
    const interaction = createInteraction('Express 라우터 만들어줘');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({
      startVibeSession: vi.fn().mockResolvedValue({ id: 'session-ask' }),
    });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeCommand(interaction as any);

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(deps.startVibeSession).toHaveBeenCalledWith('guild-1', 'user-1', '코드로 구현해줘: Express 라우터 만들어줘');
    expect(deps.streamSessionProgress).toHaveBeenCalledWith(
      expect.any(Object),
      'session-ask',
      '코드로 구현해줘: Express 라우터 만들어줘',
      expect.objectContaining({ showDebugBlocks: false, maxLinks: 2 }),
    );
  });
});
