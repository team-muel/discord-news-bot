import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseMockClientByTable } from '../../test/supabaseMock';

type SearchRow = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  assessMemoryPoisonRisk: vi.fn(() => ({ blocked: false })),
  batchCountMemoryLinks: vi.fn(async () => new Map<string, number>()),
  getUserEmbedding: vi.fn(async () => null),
  isUserEmbeddingEnabled: vi.fn(() => false),
  queryObsidianLoreHints: vi.fn(async () => []),
  readObsidianLoreWithAdapter: vi.fn(async () => []),
  buildSocialContextHints: vi.fn(async () => []),
  getRelationshipStrengths: vi.fn(async () => new Map<string, number>()),
  loadSelfNotes: vi.fn(async () => []),
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseClient: vi.fn(),
  searchMemoryHybrid: vi.fn(async () => []),
  searchMemoryTiered: vi.fn(async (): Promise<SearchRow[]> => []),
}));

vi.mock('../../logger', () => ({
  default: {
    warn: mocks.loggerWarn,
  },
}));

vi.mock('../memory', () => ({
  assessMemoryPoisonRisk: mocks.assessMemoryPoisonRisk,
  batchCountMemoryLinks: mocks.batchCountMemoryLinks,
  getUserEmbedding: mocks.getUserEmbedding,
  isUserEmbeddingEnabled: mocks.isUserEmbeddingEnabled,
}));

vi.mock('../obsidian', () => ({
  queryObsidianLoreHints: mocks.queryObsidianLoreHints,
  readObsidianLoreWithAdapter: mocks.readObsidianLoreWithAdapter,
}));

vi.mock('../communityGraphService', () => ({
  buildSocialContextHints: mocks.buildSocialContextHints,
  getRelationshipStrengths: mocks.getRelationshipStrengths,
}));

vi.mock('../entityNervousSystem', () => ({
  loadSelfNotes: mocks.loadSelfNotes,
}));

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: mocks.isSupabaseConfigured,
  getSupabaseClient: mocks.getSupabaseClient,
}));

vi.mock('./agentMemoryStore', () => ({
  searchMemoryHybrid: mocks.searchMemoryHybrid,
  searchMemoryTiered: mocks.searchMemoryTiered,
}));

describe('agentMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.assessMemoryPoisonRisk.mockReturnValue({ blocked: false });
    mocks.batchCountMemoryLinks.mockResolvedValue(new Map([
      ['mem-1', 2],
      ['mem-3', 1],
    ]));
    mocks.isUserEmbeddingEnabled.mockReturnValue(false);
    mocks.buildSocialContextHints.mockResolvedValue([]);
    mocks.getRelationshipStrengths.mockResolvedValue(new Map());
    mocks.loadSelfNotes.mockResolvedValue([]);
    mocks.queryObsidianLoreHints.mockResolvedValue([]);
    mocks.readObsidianLoreWithAdapter.mockResolvedValue([]);
    mocks.isSupabaseConfigured.mockReturnValue(true);
    mocks.getSupabaseClient.mockReturnValue(createSupabaseMockClientByTable({
      guild_lore_docs: {
        data: [{
          title: null,
          summary: null,
          content: 'Curated guild lore',
          updated_at: '2026-04-10T00:00:00.000Z',
        }],
        error: null,
      },
      memory_sources: {
        data: [
          { memory_item_id: 'mem-1' },
          { memory_item_id: 'mem-1' },
          { memory_item_id: 'mem-3' },
        ],
        error: null,
      },
    }));
    mocks.searchMemoryTiered.mockResolvedValue([
      {
        id: 'mem-1',
        type: 'policy',
        title: 'Greetings',
        summary: 'Use calm tone',
        content: 'Use calm tone',
        confidence: '0.72',
        pinned: false,
        owner_user_id: 'user-1',
        updated_at: '2026-04-10T00:00:00.000Z',
        tier: 'summary',
        tags: ['policy'],
      } satisfies SearchRow,
      {
        id: 'mem-2',
        type: 'policy',
        title: 'Filtered',
        summary: 'Should not survive confidence filter',
        content: 'Should not survive confidence filter',
        confidence: 0.1,
        pinned: false,
        owner_user_id: 'user-2',
        updated_at: '2026-04-10T00:00:00.000Z',
        tier: 'raw',
        tags: ['policy'],
      } satisfies SearchRow,
      {
        id: 'mem-3',
        type: 'preference',
        title: '',
        summary: 'Pinned override',
        content: 'Pinned override',
        confidence: 0.05,
        pinned: true,
        owner_user_id: 'user-3',
        updated_at: '2026-04-10T00:00:00.000Z',
        tier: 'raw',
        tags: ['preference'],
      } satisfies SearchRow,
    ]);
  });

  it('normalizes lore rows and keeps pinned memory hints even at low confidence', async () => {
    const { buildAgentMemoryHints } = await import('./agentMemoryService');

    const hints = await buildAgentMemoryHints({
      guildId: '12345678',
      goal: 'Keep replies concise',
      maxItems: 10,
    });

    expect(hints[0]).toBe('현재 목표: Keep replies concise');
    expect(hints.some((hint) => hint.includes('[memory:mem-1]') && hint.includes('Greetings: Use calm tone'))).toBe(true);
    expect(hints.some((hint) => hint.includes('[memory:mem-3 pinned]') && hint.includes('Pinned override'))).toBe(true);
    expect(hints.some((hint) => hint.includes('mem-2'))).toBe(false);
    expect(hints.some((hint) => hint.includes('[lore] lore: Curated guild lore'))).toBe(true);
  });

  it('boosts youtube community subscription memories for market-oriented goals', async () => {
    mocks.batchCountMemoryLinks.mockResolvedValue(new Map());
    mocks.getSupabaseClient.mockReturnValue(createSupabaseMockClientByTable({
      guild_lore_docs: { data: [], error: null },
      memory_sources: { data: [], error: null },
    }));
    mocks.searchMemoryTiered.mockResolvedValue([
      {
        id: 'mem-generic',
        type: 'semantic',
        title: '일반 정책',
        summary: '보편적 응답 규칙',
        content: '보편적 응답 규칙',
        confidence: 0.74,
        pinned: false,
        owner_user_id: 'user-1',
        updated_at: '2026-04-10T00:00:00.000Z',
        tier: 'summary',
        tags: ['policy'],
      } satisfies SearchRow,
      {
        id: 'mem-market',
        type: 'episode',
        title: '미국 증시 요약',
        summary: '유튜브 커뮤니티 장 마감 요약',
        content: '유튜브 커뮤니티 장 마감 요약',
        confidence: 0.70,
        pinned: false,
        owner_user_id: 'user-2',
        updated_at: '2026-04-10T00:00:00.000Z',
        tier: 'raw',
        tags: ['youtube', 'subscription', 'posts', 'community-post'],
      } satisfies SearchRow,
    ]);

    const { buildAgentMemoryHints } = await import('./agentMemoryService');

    const hints = await buildAgentMemoryHints({
      guildId: '12345678',
      goal: '오늘 미국 증시와 CPI 흐름을 요약해줘',
      maxItems: 10,
    });

    const memoryHints = hints.filter((hint) => hint.includes('[memory:'));
    expect(memoryHints[0]).toContain('mem-market');
    expect(memoryHints[1]).toContain('mem-generic');
  });
});