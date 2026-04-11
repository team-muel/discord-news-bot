import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

const {
  mockCreateMemoryItem,
  mockGetSupabaseClient,
  mockIsSupabaseConfigured,
  mockSupabaseFrom,
} = vi.hoisted(() => ({
  mockCreateMemoryItem: vi.fn(async () => ({ id: 'mem_test' })),
  mockGetSupabaseClient: vi.fn(),
  mockIsSupabaseConfigured: vi.fn(() => true),
  mockSupabaseFrom: vi.fn(),
}));

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: vi.fn(() => '/mock/vault'),
}));

vi.mock('../obsidian/authoring', () => ({
  upsertObsidianGuildDocument: vi.fn(async () => ({ ok: true, path: '/mock/vault/guilds/123456789/events/subscriptions/test.md' })),
  summarizeReflectionBundle: vi.fn((bundle?: { concern?: string; suggestedPaths?: string[]; gatePaths?: string[]; plane?: string; customerImpact?: boolean }) => ({
    plane: bundle?.plane || 'none',
    concern: bundle?.concern || 'none',
    nextPath: bundle?.suggestedPaths?.[0] || bundle?.gatePaths?.[0] || 'none',
    customerImpact: Boolean(bundle?.customerImpact),
  })),
}));

vi.mock('../agent/agentMemoryStore', () => ({
  createMemoryItem: mockCreateMemoryItem,
}));

vi.mock('../supabaseClient', () => ({
  getSupabaseClient: mockGetSupabaseClient,
  isSupabaseConfigured: mockIsSupabaseConfigured,
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { writeSubscriptionNote } from './subscriptionNoteWriter';
import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { createMemoryItem } from '../agent/agentMemoryStore';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';

const mockUpsert = vi.mocked(upsertObsidianGuildDocument);
const mockVaultRoot = vi.mocked(getObsidianVaultRoot);
const mockLogger = vi.mocked(logger);
const mockCreateMemory = vi.mocked(createMemoryItem);
const mockSupabaseClient = vi.mocked(getSupabaseClient);
const mockSupabaseEnabled = vi.mocked(isSupabaseConfigured);

const makeInput = (overrides?: Partial<Parameters<typeof writeSubscriptionNote>[0]>) => ({
  row: {
    id: 42,
    guild_id: '123456789012345678',
    url: 'https://youtube.com/@LinusTechTips#videos',
    name: 'youtube-ltt',
  },
  mode: 'videos' as const,
  latest: {
    id: 'dQw4w9WgXcQ',
    title: 'New GPU Review',
    content: 'Detailed review of the latest GPU',
    link: 'https://youtube.com/watch?v=dQw4w9WgXcQ',
    published: '2026-04-09T12:00:00Z',
    author: 'Linus Tech Tips',
  },
  ...overrides,
});

describe('writeSubscriptionNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVaultRoot.mockReturnValue('/mock/vault');
    mockUpsert.mockResolvedValue({ ok: true, path: '/mock/path.md' });
    mockSupabaseEnabled.mockReturnValue(true);
    mockSupabaseFrom.mockReturnValue(createSupabaseChain({ data: [], error: null }));
    mockSupabaseClient.mockReturnValue({ from: mockSupabaseFrom } as never);
    mockCreateMemory.mockResolvedValue({ id: 'mem_test' } as never);
  });

  it('writes a note with correct metadata for videos', async () => {
    mockUpsert.mockResolvedValue({
      ok: true,
      path: '/mock/path.md',
      reflectionBundle: {
        targetPath: 'guilds/123456789012345678/events/subscriptions/2026-04-09_videos_New-GPU-Review.md',
        plane: 'record',
        concern: 'guild-memory',
        requiredPaths: [],
        suggestedPaths: ['guilds/123456789012345678/Guild_Lore.md'],
        suggestedPatterns: [],
        verificationChecklist: [],
        gatePaths: [],
        customerImpact: false,
        notes: [],
      },
    });

    await writeSubscriptionNote(makeInput());

    expect(mockUpsert).toHaveBeenCalledOnce();
    const call = mockUpsert.mock.calls[0][0];
    expect(call.guildId).toBe('123456789012345678');
    expect(call.vaultPath).toBe('/mock/vault');
    expect(call.fileName).toContain('events/subscriptions/');
    expect(call.fileName).toContain('videos');
    expect(call.fileName).toContain('New-GPU-Review');
    expect(call.content).toContain('# New GPU Review');
    expect(call.content).toContain('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(call.tags).toContain('youtube');
    expect(call.tags).toContain('subscription');
    expect(call.tags).toContain('videos');
    expect(mockLogger.info).toHaveBeenCalledWith(
      '[SUBSCRIPTION-NOTE] wrote %s for guild=%s source=%d concern=%s next=%s',
      expect.any(String),
      '123456789012345678',
      42,
      'guild-memory',
      'guilds/123456789012345678/Guild_Lore.md',
    );
  });

  it('writes a note with correct metadata for posts', async () => {
    await writeSubscriptionNote(makeInput({ mode: 'posts' }));

    const call = mockUpsert.mock.calls[0][0];
    expect(call.fileName).toContain('posts');
    expect(call.tags).toContain('posts');
  });

  it('persists community posts into long-term memory with source metadata', async () => {
    const input = makeInput({
      mode: 'posts',
      latest: {
        id: 'Ugkx123',
        title: '【미국 증시 요약】',
        content: '금일 미국 증시는 혼조세였습니다.',
        link: 'https://www.youtube.com/post/Ugkx123',
        published: '2026-04-10T22:00:00Z',
        author: '옵션의 미국 증시 라이브',
      },
    });

    await writeSubscriptionNote(input);

    expect(mockCreateMemory).toHaveBeenCalledTimes(1);
    const call = mockCreateMemory.mock.calls[0][0];
    expect(call.guildId).toBe('123456789012345678');
    expect(call.channelId).toBeUndefined();
    expect(call.type).toBe('episode');
    expect(call.tags).toEqual(expect.arrayContaining(['youtube', 'subscription', 'posts', 'community-post']));
    expect(call.content).toContain('https://www.youtube.com/post/Ugkx123');
    expect(call.source).toEqual(expect.objectContaining({
      sourceKind: 'system',
      sourceRef: 'https://www.youtube.com/post/Ugkx123',
    }));
  });

  it('skips memory persistence for duplicate source refs', async () => {
    mockSupabaseFrom.mockReturnValue(createSupabaseChain({ data: [{ memory_item_id: 'mem_existing' }], error: null }));

    await writeSubscriptionNote(makeInput({ mode: 'posts' }));

    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('still persists memory when vault path is empty', async () => {
    mockVaultRoot.mockReturnValue('');

    await writeSubscriptionNote(makeInput({ mode: 'posts' }));

    expect(mockCreateMemory).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips memory persistence when supabase is disabled', async () => {
    mockSupabaseEnabled.mockReturnValue(false);

    await writeSubscriptionNote(makeInput({ mode: 'posts' }));

    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('does not persist memory for video notifications', async () => {
    await writeSubscriptionNote(makeInput({ mode: 'videos' }));

    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('includes content snippet in note body', async () => {
    await writeSubscriptionNote(makeInput());

    const call = mockUpsert.mock.calls[0][0];
    expect(call.content).toContain('Detailed review of the latest GPU');
  });

  it('skips write when guild_id is missing', async () => {
    await writeSubscriptionNote(makeInput({ row: { id: 1, guild_id: null, url: '', name: null } }));
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips write when guild_id is invalid', async () => {
    await writeSubscriptionNote(makeInput({ row: { id: 1, guild_id: 'abc', url: '', name: null } }));
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips write when vault path is empty', async () => {
    mockVaultRoot.mockReturnValue('');
    await writeSubscriptionNote(makeInput());
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('handles missing content gracefully', async () => {
    const input = makeInput();
    input.latest.content = undefined;
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.content).toContain('URL: https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(call.content).not.toContain('undefined');
  });

  it('truncates extremely long content', async () => {
    const input = makeInput();
    input.latest.content = 'x'.repeat(5000);
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    // Content should be truncated at 2000 chars
    expect(call.content.length).toBeLessThan(2500);
  });

  it('sanitizes special characters in filename', async () => {
    const input = makeInput();
    input.latest.title = 'Best GPU? $500 vs $1000! (2026)';
    await writeSubscriptionNote(input);

    const call = mockUpsert.mock.calls[0][0];
    expect(call.fileName).not.toContain('?');
    expect(call.fileName).not.toContain('$');
  });
});
