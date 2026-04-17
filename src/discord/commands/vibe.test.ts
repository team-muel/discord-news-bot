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

describe('vibe message OpenClaw ingress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireDistributedLease.mockResolvedValue({
      acquired: true,
      release: vi.fn().mockResolvedValue(undefined),
    });
    mocks.seedFeedbackReactions.mockResolvedValue(undefined);
  });

  it('prefers the injected OpenClaw ingress for prefixed vibe messages', async () => {
    const routeOpenClawDiscordIngress = vi.fn(async () => ({
      answer: 'OpenClaw handled this vibe request',
    }));
    const message = createMessage('뮤엘 오늘 작업 이어서 진행해줘', 'message-openclaw');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({ routeOpenClawDiscordIngress });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(routeOpenClawDiscordIngress).toHaveBeenCalledWith(expect.objectContaining({
      request: '오늘 작업 이어서 진행해줘',
      guildId: 'guild-1',
      userId: 'user-1',
      entryLabel: '뮤엘 메시지',
      surface: 'muel-message',
    }));
    expect(deps.startVibeSession).not.toHaveBeenCalled();
    expect(message.reply).toHaveBeenCalledWith('OpenClaw handled this vibe request');
    expect(mocks.seedFeedbackReactions).toHaveBeenCalledWith(expect.objectContaining({ id: 'reply-message-openclaw' }));
  });

  it('falls back to the existing vibe session flow when OpenClaw ingress does not handle the message', async () => {
    const routeOpenClawDiscordIngress = vi.fn(async () => null);
    const message = createMessage('뮤엘 계획 이어서 실행해줘', 'message-fallback');

    const { createVibeHandlers } = await import('./vibe');
    const deps = createDeps({
      routeOpenClawDiscordIngress,
      startVibeSession: vi.fn().mockResolvedValue({ id: 'session-2' }),
    });
    const handlers = createVibeHandlers(deps as any);

    await handlers.handleVibeMessage(message as any);

    expect(deps.startVibeSession).toHaveBeenCalledWith('guild-1', 'user-1', '계획 이어서 실행해줘');
  });
});
