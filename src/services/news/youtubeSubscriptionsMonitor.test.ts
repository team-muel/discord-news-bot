import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

const {
  mockRunWithConcurrency,
  mockClaimSourceLock,
  mockReleaseSourceLock,
  mockUpdateSourceState,
  mockFetchFreshSourceRow,
  mockFromTable,
  mockFetchYouTubeLatestByWorker,
  mockWriteSubscriptionNote,
} = vi.hoisted(() => ({
  mockRunWithConcurrency: vi.fn(async (rows: unknown[], worker: (row: unknown) => Promise<void>) => {
    for (const row of rows) {
      await worker(row);
    }
  }),
  mockClaimSourceLock: vi.fn(async () => true),
  mockReleaseSourceLock: vi.fn(async () => undefined),
  mockUpdateSourceState: vi.fn(async () => undefined),
  mockFetchFreshSourceRow: vi.fn(async () => null),
  mockFromTable: vi.fn(),
  mockFetchYouTubeLatestByWorker: vi.fn(),
  mockWriteSubscriptionNote: vi.fn(async () => undefined),
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/async', () => ({
  runWithConcurrency: mockRunWithConcurrency,
}));

vi.mock('./sourceMonitorStore', () => ({
  claimSourceLock: mockClaimSourceLock,
  releaseSourceLock: mockReleaseSourceLock,
  updateSourceState: mockUpdateSourceState,
  fetchFreshSourceRow: mockFetchFreshSourceRow,
}));

vi.mock('../infra/baseRepository', () => ({
  fromTable: mockFromTable,
}));

vi.mock('./youtubeMonitorWorkerClient', () => ({
  fetchYouTubeLatestByWorker: mockFetchYouTubeLatestByWorker,
}));

vi.mock('./subscriptionNoteWriter', () => ({
  writeSubscriptionNote: mockWriteSubscriptionNote,
}));

describe('youtubeSubscriptionsMonitor', () => {
  const flushAsyncWork = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(() => {
    vi.resetModules();
    mockClaimSourceLock.mockResolvedValue(true);
    mockReleaseSourceLock.mockResolvedValue(undefined);
    mockUpdateSourceState.mockResolvedValue(undefined);
    mockFetchFreshSourceRow.mockResolvedValue(null);
    mockWriteSubscriptionNote.mockResolvedValue(undefined);
  });

  it('posts community subscriptions as an embed with full body and thread', async () => {
    const rows = [{
      id: 1,
      guild_id: 'guild-1',
      url: 'https://www.youtube.com/channel/UC123/posts#posts',
      name: 'youtube-posts',
      channel_id: 'channel-1',
      is_active: true,
      last_post_id: null,
      last_post_signature: null,
    }];

    mockFromTable.mockReturnValue(createSupabaseChain({ data: rows, error: null }));
    mockFetchYouTubeLatestByWorker.mockResolvedValue({
      found: true,
      channelId: 'UC123',
      entry: {
        id: 'post-1',
        title: '【미국 증시 요약 ｜2026년 04월 08일 (수)】',
        content: '【미국 증시 요약 ｜2026년 04월 08일 (수)】\n\n금일 미국 증시는 상승 마감했습니다.\n\n세부 본문입니다.',
        link: 'https://www.youtube.com/post/post-1',
        published: '1시간 전',
        author: '옵션의 미국 증시 라이브',
      },
    });

    const sendToChannel = vi.fn<(channelId: string, payload: any) => Promise<boolean>>(async () => true);
    const { startYouTubeSubscriptionsMonitor, stopYouTubeSubscriptionsMonitor } = await import('./youtubeSubscriptionsMonitor');

    startYouTubeSubscriptionsMonitor({ sendToChannel });
    await flushAsyncWork();
    stopYouTubeSubscriptionsMonitor();

    expect(sendToChannel).toHaveBeenCalledTimes(1);
    const firstCall = sendToChannel.mock.calls[0];
    expect(firstCall).toBeDefined();
    const payload = firstCall?.[1];
    expect(payload.content).toBeUndefined();
    expect(payload.thread.name).toBe('【미국 증시 요약 ｜2026년 04월 08일 (수)】');
    expect(payload.embeds[0].title).toBe('【미국 증시 요약 ｜2026년 04월 08일 (수)】');
    expect(payload.embeds[0].description).toContain('금일 미국 증시는 상승 마감했습니다.');
    expect(payload.embeds[0].description).toContain('https://www.youtube.com/post/post-1');
  });
});