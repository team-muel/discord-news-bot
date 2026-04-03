import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// Mock shared search helper from agentMemoryStore
const mockSearchMemoryHybrid = vi.fn();
vi.mock('../agent/agentMemoryStore', () => ({
  searchMemoryHybrid: (...args: unknown[]) => mockSearchMemoryHybrid(...args),
}));

import { evolveMemoryLinks, batchCountMemoryLinks } from './memoryEvolutionService';

// ─── Chainable query builder mock ────────────────────────────────────────────
const chainableQuery = (result: { data?: unknown; error?: unknown; count?: number } = {}) => {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'or', 'order', 'limit', 'insert', 'update', 'in'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal — resolve to result
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  // Make it thenable
  (chain as any)[Symbol.for('jest.asymmetricMatch')] = undefined;
  return chain;
};

describe('memoryEvolutionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('evolveMemoryLinks', () => {
    it('returns empty result when query text is too short', async () => {
      const result = await evolveMemoryLinks({
        newMemoryId: 'mem_abc',
        guildId: 'g1',
        title: '',
        content: '',
        summary: 'ab',
      });
      expect(result.evolved).toBe(false);
      expect(result.linksCreated).toBe(0);
    });

    it('creates links for lexical matches when embedding is disabled', async () => {
      const existingMemories = [
        { id: 'mem_old1', title: 'server config', summary: 'server setup guide', confidence: 0.6 },
        { id: 'mem_old2', title: 'deployment notes', summary: 'deploy to production', confidence: 0.7 },
      ];

      mockSearchMemoryHybrid.mockResolvedValue(existingMemories);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'memory_items') {
          const c: Record<string, any> = {};
          const methods = ['select', 'eq', 'neq', 'or', 'order', 'limit', 'update'];
          for (const m of methods) {
            c[m] = vi.fn().mockReturnValue(c);
          }
          c.limit = vi.fn().mockReturnValue({ data: existingMemories, error: null });
          return c;
        }
        if (table === 'memory_item_links') {
          return { insert: vi.fn().mockReturnValue({ error: null }) };
        }
        return {};
      });

      const result = await evolveMemoryLinks({
        newMemoryId: 'mem_new',
        guildId: 'g1',
        title: 'server deployment',
        content: 'how to deploy the server',
        summary: 'deployment guide for server',
      });

      expect(result.evolved).toBe(true);
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].id).toBe('mem_old1');
    });
  });

  describe('batchCountMemoryLinks', () => {
    it('returns empty map for empty input', async () => {
      const result = await batchCountMemoryLinks([], 'g1');
      expect(result.size).toBe(0);
    });

    it('counts links correctly', async () => {
      const linkRows = [
        { source_id: 'mem_a', target_id: 'mem_b' },
        { source_id: 'mem_c', target_id: 'mem_a' },
      ];

      const chain: Record<string, any> = {};
      ['select', 'eq', 'or', 'limit'].forEach((m) => {
        chain[m] = vi.fn().mockReturnValue(chain);
      });
      chain.limit = vi.fn().mockReturnValue({ data: linkRows, error: null });

      mockFrom.mockReturnValue(chain);

      const result = await batchCountMemoryLinks(['mem_a', 'mem_b'], 'g1');
      // mem_a appears in source_id once and target_id once = 2
      expect(result.get('mem_a')).toBe(2);
      // mem_b appears in target_id once = 1
      expect(result.get('mem_b')).toBe(1);
    });
  });
});
