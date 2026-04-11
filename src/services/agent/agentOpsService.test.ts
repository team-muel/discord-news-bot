import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  queueMemoryJob: vi.fn(async () => undefined),
  getAgentGotCutoverDecision: vi.fn(),
  listGuildAgentSessions: vi.fn(() => []),
  startAgentSession: vi.fn(() => ({ id: 'session-1' })),
  autoBootstrapGuildKnowledgeOnJoin: vi.fn(async () => undefined),
  autoSyncGuildTopologyOnJoin: vi.fn(async () => undefined),
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
  createNewsChannelSubscription: vi.fn(async () => ({ created: true, row: { id: 1 } })),
  isAutomationEnabled: vi.fn(() => true),
  triggerAutomationJob: vi.fn(async () => ({ ok: true, message: 'ok' })),
  getNewsMonitorCandidateSourceStatus: vi.fn(() => ({ configured: true, mode: 'mcp-worker' })),
}));

vi.mock('../../logger', () => ({
  default: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
  },
}));

vi.mock('./agentMemoryStore', () => ({
  queueMemoryJob: mocks.queueMemoryJob,
}));

vi.mock('./agentGotCutoverService', () => ({
  getAgentGotCutoverDecision: mocks.getAgentGotCutoverDecision,
}));

vi.mock('../multiAgentService', () => ({
  listGuildAgentSessions: mocks.listGuildAgentSessions,
  startAgentSession: mocks.startAgentSession,
}));

vi.mock('../obsidian/obsidianBootstrapService', () => ({
  autoBootstrapGuildKnowledgeOnJoin: mocks.autoBootstrapGuildKnowledgeOnJoin,
}));

vi.mock('../discord-support/discordTopologySyncService', () => ({
  autoSyncGuildTopologyOnJoin: mocks.autoSyncGuildTopologyOnJoin,
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));

vi.mock('../news/newsChannelStore', () => ({
  createNewsChannelSubscription: mocks.createNewsChannelSubscription,
}));

vi.mock('../automationBot', () => ({
  isAutomationEnabled: mocks.isAutomationEnabled,
  triggerAutomationJob: mocks.triggerAutomationJob,
}));

vi.mock('../news/newsMonitorWorkerClient', () => ({
  getNewsMonitorCandidateSourceStatus: mocks.getNewsMonitorCandidateSourceStatus,
}));

const createSourcesLookupClient = (rows: Array<{ id: number }> = []) => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        limit: vi.fn(async () => ({ data: rows, error: null })),
      })),
    })),
  })),
});

const flushMicrotasks = async (count = 8) => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
};

const createGuild = () => {
  const send = vi.fn<(content: string) => Promise<{ id: string }>>(async () => ({ id: 'message-1' }));
  const channel = {
    id: 'channel-1',
    name: 'general',
    type: ChannelType.GuildText,
    rawPosition: 0,
    isSendable: () => true,
    send,
  };

  return {
    guild: {
      id: 'guild-1',
      name: 'Guild One',
      systemChannel: channel,
      channels: {
        cache: new Map([[channel.id, channel]]),
      },
    },
    channel,
    send,
  };
};

describe('agentOpsService onGuildJoined', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGuildAgentSessions.mockReturnValue([]);
    mocks.startAgentSession.mockReturnValue({ id: 'session-1' });
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseClient.mockReturnValue(createSourcesLookupClient([]) as never);
    mocks.createNewsChannelSubscription.mockResolvedValue({ created: true, row: { id: 1 } });
    mocks.isAutomationEnabled.mockReturnValue(true);
    mocks.triggerAutomationJob.mockResolvedValue({ ok: true, message: 'ok' });
    mocks.getNewsMonitorCandidateSourceStatus.mockReturnValue({ configured: true, mode: 'mcp-worker' });
  });

  it('bootstraps welcome and default news coverage for a new guild with no sources', async () => {
    const { guild, send } = createGuild();
    const mod = await import('./agentOpsService');

    const result = mod.onGuildJoined(guild as never);
    await flushMicrotasks();

    expect(result).toMatchObject({ ok: true, sessionId: 'session-1' });
    expect(mocks.autoSyncGuildTopologyOnJoin).toHaveBeenCalledWith(guild);
    expect(mocks.autoBootstrapGuildKnowledgeOnJoin).toHaveBeenCalledWith({
      guildId: 'guild-1',
      guildName: 'Guild One',
      reason: 'guildCreate',
    });
    expect(mocks.createNewsChannelSubscription).toHaveBeenCalledWith({
      userId: 'system-on-guild-join',
      guildId: 'guild-1',
      discordChannelId: 'channel-1',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0] || '')).toContain('자동 온보딩 세션 시작됨: session-1');
    expect(String(send.mock.calls[0]?.[0] || '')).toContain('기본 뉴스 브리핑을 <#channel-1> 채널에 연결했습니다.');
    expect(mocks.triggerAutomationJob).toHaveBeenCalledWith('news-monitor', { guildId: 'guild-1' });
  });

  it('does not auto-provision default news when guild sources already exist', async () => {
    const { guild, send } = createGuild();
    mocks.getSupabaseClient.mockReturnValue(createSourcesLookupClient([{ id: 99 }]) as never);
    const mod = await import('./agentOpsService');

    const result = mod.onGuildJoined(guild as never);
    await flushMicrotasks();

    expect(result).toMatchObject({ ok: true, sessionId: 'session-1' });
    expect(mocks.createNewsChannelSubscription).not.toHaveBeenCalled();
    expect(mocks.triggerAutomationJob).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0]?.[0] || '')).not.toContain('기본 뉴스 브리핑을 <#channel-1> 채널에 연결했습니다.');
  });
});