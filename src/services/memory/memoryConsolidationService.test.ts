import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseChain } from '../../test/supabaseMock';

// Mock Supabase
const mockFrom = vi.fn();
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// Mock LLM
vi.mock('../llmClient', () => ({
  isAnyLlmConfigured: () => true,
  generateText: vi.fn().mockResolvedValue('Consolidated summary of server deployment procedures'),
}));

// Override consolidation config at module level (before import)
vi.stubEnv('MEMORY_CONSOLIDATION_ENABLED', 'true');
vi.stubEnv('MEMORY_CONSOLIDATION_MIN_GROUP_SIZE', '2');
vi.stubEnv('MEMORY_CONSOLIDATION_RAW_AGE_HOURS', '0'); // no age gate in tests

import { runConsolidationCycle } from './memoryConsolidationService';

describe('memoryConsolidationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when no raw items found', async () => {
    mockFrom.mockImplementation(() => createSupabaseChain({ data: [], error: null }));

    const result = await runConsolidationCycle('g1');
    expect(result.groupsProcessed).toBe(0);
    expect(result.memoriesCreated).toBe(0);
  });

  it('groups raw memories with shared tags and produces consolidation result', async () => {
    const rawItems = [
      { id: 'mem_1', guild_id: 'g1', title: 'Deploy step 1', summary: 'First step', content: 'content1', tags: ['deploy', 'ops'], confidence: 0.6, tier: 'raw' },
      { id: 'mem_2', guild_id: 'g1', title: 'Deploy step 2', summary: 'Second step', content: 'content2', tags: ['deploy'], confidence: 0.7, tier: 'raw' },
      { id: 'mem_3', guild_id: 'g1', title: 'Deploy rollback', summary: 'Rollback procedure', content: 'content3', tags: ['deploy', 'rollback'], confidence: 0.65, tier: 'raw' },
      { id: 'mem_4', guild_id: 'g1', title: 'Unrelated', summary: 'Other topic', content: 'content4', tags: ['other'], confidence: 0.5, tier: 'raw' },
    ];

    // Build a fully chainable + thenable mock
    mockFrom.mockImplementation(() => {
      return createSupabaseChain({ data: rawItems, error: null });
    });

    const result = await runConsolidationCycle('g1');
    // mem_1, mem_2, mem_3 share 'deploy' tag => 1 group (min size 3)
    // mem_4 is alone => not grouped
    expect(result.groupsProcessed).toBe(1);
    expect(result.memoriesCreated).toBe(1);
    expect(result.memoriesArchived).toBe(3);
  });
});
