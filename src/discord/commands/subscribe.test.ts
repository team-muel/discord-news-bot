import { ChannelType } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildSimpleEmbed,
  mockEnsureFeatureAccess,
  mockCreateNewsChannelSubscription,
  mockCreateYouTubeSubscription,
  mockDeleteNewsChannelSubscription,
  mockDeleteYouTubeSubscription,
  mockListNewsChannelSubscriptions,
  mockListYouTubeSubscriptions,
  mockIsAutomationEnabled,
  mockTriggerAutomationJob,
  mockIsNewsSentimentMonitorEnabled,
  mockGetNewsMonitorCandidateSourceStatus,
} = vi.hoisted(() => ({
  mockBuildSimpleEmbed: vi.fn((title: string, description: string, color: number) => ({ title, description, color })),
  mockEnsureFeatureAccess: vi.fn(),
  mockCreateNewsChannelSubscription: vi.fn(),
  mockCreateYouTubeSubscription: vi.fn(),
  mockDeleteNewsChannelSubscription: vi.fn(),
  mockDeleteYouTubeSubscription: vi.fn(),
  mockListNewsChannelSubscriptions: vi.fn(),
  mockListYouTubeSubscriptions: vi.fn(),
  mockIsAutomationEnabled: vi.fn(),
  mockTriggerAutomationJob: vi.fn(),
  mockIsNewsSentimentMonitorEnabled: vi.fn(),
  mockGetNewsMonitorCandidateSourceStatus: vi.fn(),
}));

vi.mock('../ui', () => ({
  buildSimpleEmbed: mockBuildSimpleEmbed,
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  EMBED_INFO: 1,
  EMBED_WARN: 2,
  EMBED_ERROR: 3,
  EMBED_SUCCESS: 4,
}));

vi.mock('../auth', () => ({
  ensureFeatureAccess: mockEnsureFeatureAccess,
}));

vi.mock('../../services/news/youtubeSubscriptionStore', () => ({
  createYouTubeSubscription: mockCreateYouTubeSubscription,
  deleteYouTubeSubscription: mockDeleteYouTubeSubscription,
  listYouTubeSubscriptions: mockListYouTubeSubscriptions,
}));

vi.mock('../../services/news/newsChannelStore', () => ({
  createNewsChannelSubscription: mockCreateNewsChannelSubscription,
  deleteNewsChannelSubscription: mockDeleteNewsChannelSubscription,
  listNewsChannelSubscriptions: mockListNewsChannelSubscriptions,
}));

vi.mock('../../services/automationBot', () => ({
  isAutomationEnabled: mockIsAutomationEnabled,
  triggerAutomationJob: mockTriggerAutomationJob,
}));

vi.mock('../../services/news/newsSentimentMonitor', () => ({
  isNewsSentimentMonitorEnabled: mockIsNewsSentimentMonitorEnabled,
}));

vi.mock('../../services/news/newsMonitorWorkerClient', () => ({
  getNewsMonitorCandidateSourceStatus: mockGetNewsMonitorCandidateSourceStatus,
}));

const createInteraction = (overrides?: { action?: string; kind?: string }) => {
  const values = new Map<string, string | null>([
    ['동작', overrides?.action ?? 'add'],
    ['종류', overrides?.kind ?? 'news'],
    ['링크', null],
    ['유튜브채널', null],
  ]);

  return {
    user: { id: 'user-1' },
    guildId: 'guild-1',
    guild: null,
    channel: { id: 'channel-1', type: ChannelType.GuildText },
    options: {
      getString: (name: string) => values.get(name) ?? null,
    },
    reply: vi.fn(),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  };
};

describe('handleGroupedSubscribeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockEnsureFeatureAccess.mockResolvedValue({ ok: true, autoLoggedIn: false });
    mockCreateNewsChannelSubscription.mockResolvedValue({ created: true, row: { id: 1 } });
    mockCreateYouTubeSubscription.mockResolvedValue({ created: true, channelId: 'UC123' });
    mockDeleteNewsChannelSubscription.mockResolvedValue({ deleted: true });
    mockDeleteYouTubeSubscription.mockResolvedValue({ deleted: true, channelId: 'UC123' });
    mockListNewsChannelSubscriptions.mockResolvedValue([]);
    mockListYouTubeSubscriptions.mockResolvedValue([]);
    mockIsAutomationEnabled.mockReturnValue(false);
    mockTriggerAutomationJob.mockResolvedValue({ ok: true, message: 'News tick completed: processed=1 sent=1 failed=0 duplicate=0 locked=0 noCandidate=0' });
    mockIsNewsSentimentMonitorEnabled.mockReturnValue(false);
    mockGetNewsMonitorCandidateSourceStatus.mockReturnValue({ configured: false, mode: 'none' });
  });

  it('shows an operational warning when news automation is disabled', async () => {
    const interaction = createInteraction();
    const { handleGroupedSubscribeCommand } = await import('./subscribe');

    await handleGroupedSubscribeCommand(interaction as any);

    expect(mockTriggerAutomationJob).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.description).toContain('등록 완료: news -> <#channel-1> (GuildText)');
    expect(payload.description).toContain('자동화 런타임이 꺼져 있어 뉴스가 자동 게시되지 않습니다.');
    expect(payload.description).toContain('후보 공급원: 미설정');
    expect(payload.color).toBe(2);
  });

  it('triggers the news monitor immediately when automation is ready', async () => {
    mockIsAutomationEnabled.mockReturnValue(true);
    mockIsNewsSentimentMonitorEnabled.mockReturnValue(true);
    mockGetNewsMonitorCandidateSourceStatus.mockReturnValue({ configured: true, mode: 'mcp-worker' });

    const interaction = createInteraction();
    const { handleGroupedSubscribeCommand } = await import('./subscribe');

    await handleGroupedSubscribeCommand(interaction as any);

    expect(mockTriggerAutomationJob).toHaveBeenCalledWith('news-monitor', { guildId: 'guild-1' });
    const payload = interaction.editReply.mock.calls[0][0];
    expect(payload.description).toContain('후보 공급원: MCP 뉴스 워커');
    expect(payload.description).toContain('즉시 점검 완료: 새 뉴스를 전송했습니다.');
    expect(payload.color).toBe(4);
  });
});