import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tryHandleDiscordChatSdkSlashCommand: vi.fn(),
}));

vi.mock('./chatSdkRuntime', () => ({
  tryHandleDiscordChatSdkSlashCommand: mocks.tryHandleDiscordChatSdkSlashCommand,
}));

const createInteraction = (commandName: string, request = '') => ({
  commandName,
  options: {
    getString: vi.fn((name: string) => {
      if (name === '질문' || name === '요청') {
        return request;
      }

      return null;
    }),
  },
});

describe('eligibleChatSurfaceRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tryHandleDiscordChatSdkSlashCommand.mockResolvedValue(false);
  });

  it('routes legacy /만들어줘 grace requests into the vibe handler', async () => {
    const { tryHandleEligibleChatSurfaceSlashCommand } = await import('./eligibleChatSurfaceRouter');
    const vibe = { handleVibeCommand: vi.fn().mockResolvedValue(undefined) };
    const docs = { handleAskCommand: vi.fn().mockResolvedValue(undefined) };

    const handled = await tryHandleEligibleChatSurfaceSlashCommand(createInteraction('만들어줘', 'Express 라우터 만들어줘') as any, {
      docs,
      vibe,
    }, {
      codingIntentPattern: /코드|구현|만들/i,
      automationIntentPattern: /자동화|연동|상태|실행/i,
    });

    expect(handled).toBe(true);
    expect(vibe.handleVibeCommand).toHaveBeenCalledTimes(1);
    expect(docs.handleAskCommand).not.toHaveBeenCalled();
  });

  it('routes /해줘 through Chat SDK first and falls back to docs handler when declined', async () => {
    const { tryHandleEligibleChatSurfaceSlashCommand } = await import('./eligibleChatSurfaceRouter');
    const vibe = { handleVibeCommand: vi.fn().mockResolvedValue(undefined) };
    const docs = { handleAskCommand: vi.fn().mockResolvedValue(undefined) };

    const handled = await tryHandleEligibleChatSurfaceSlashCommand(createInteraction('해줘', '현재 구조 설명해줘') as any, {
      docs,
      vibe,
    }, {
      codingIntentPattern: /코드|구현|만들/i,
      automationIntentPattern: /자동화|연동|상태|실행/i,
    });

    expect(handled).toBe(true);
    expect(mocks.tryHandleDiscordChatSdkSlashCommand).toHaveBeenCalledTimes(1);
    expect(docs.handleAskCommand).toHaveBeenCalledTimes(1);
    expect(vibe.handleVibeCommand).not.toHaveBeenCalled();
  });

  it('routes coding /뮤엘 requests into the vibe handler', async () => {
    const { tryHandleEligibleChatSurfaceSlashCommand } = await import('./eligibleChatSurfaceRouter');
    const vibe = { handleVibeCommand: vi.fn().mockResolvedValue(undefined) };
    const docs = { handleAskCommand: vi.fn().mockResolvedValue(undefined) };

    const handled = await tryHandleEligibleChatSurfaceSlashCommand(createInteraction('뮤엘', 'Express 라우터 만들어줘') as any, {
      docs,
      vibe,
    }, {
      codingIntentPattern: /코드|구현|만들/i,
      automationIntentPattern: /자동화|연동|상태|실행/i,
    });

    expect(handled).toBe(true);
    expect(vibe.handleVibeCommand).toHaveBeenCalledTimes(1);
    expect(docs.handleAskCommand).not.toHaveBeenCalled();
    expect(mocks.tryHandleDiscordChatSdkSlashCommand).not.toHaveBeenCalled();
  });

  it('routes docs-style /뮤엘 requests through Chat SDK first and then docs fallback', async () => {
    const { tryHandleEligibleChatSurfaceSlashCommand } = await import('./eligibleChatSurfaceRouter');
    const vibe = { handleVibeCommand: vi.fn().mockResolvedValue(undefined) };
    const docs = { handleAskCommand: vi.fn().mockResolvedValue(undefined) };

    const handled = await tryHandleEligibleChatSurfaceSlashCommand(createInteraction('뮤엘', '현재 구조 설명해줘') as any, {
      docs,
      vibe,
    }, {
      codingIntentPattern: /코드|구현|만들/i,
      automationIntentPattern: /자동화|연동|상태|실행/i,
    });

    expect(handled).toBe(true);
    expect(mocks.tryHandleDiscordChatSdkSlashCommand).toHaveBeenCalledTimes(1);
    expect(docs.handleAskCommand).toHaveBeenCalledTimes(1);
    expect(vibe.handleVibeCommand).not.toHaveBeenCalled();
  });
});