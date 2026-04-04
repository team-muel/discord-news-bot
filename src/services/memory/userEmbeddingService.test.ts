import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockFrom = vi.fn();
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// Mock memoryEmbeddingService
vi.mock('./memoryEmbeddingService', () => ({
  isEmbeddingEnabled: () => true,
}));

import {
  computeUserEmbedding,
  storeUserEmbedding,
  getUserEmbedding,
  refreshUserEmbeddings,
  cosineSimilarity,
  isUserEmbeddingEnabled,
} from './userEmbeddingService';

// ─── Chainable query builder ─────────────────────────────────────────────────
const chainableQuery = (result: { data?: unknown; error?: unknown } = {}) => {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'not', 'or', 'order', 'limit', 'insert', 'upsert', 'maybeSingle', 'in'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
};

describe('userEmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cosineSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
    });

    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
    });

    it('returns 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for mismatched dimensions', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('returns 0 for zero-norm vector', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe('isUserEmbeddingEnabled', () => {
    it('returns true when prerequisites are met', () => {
      expect(isUserEmbeddingEnabled()).toBe(true);
    });
  });

  describe('computeUserEmbedding', () => {
    it('returns null when user has fewer items than minimum', async () => {
      const chain = chainableQuery({ data: [{ embedding: '[0.1,0.2,0.3]' }], error: null });
      mockFrom.mockReturnValue(chain);

      // USER_EMBEDDING_MIN_ITEMS defaults to 3, so 1 item is not enough
      const result = await computeUserEmbedding('user1', 'guild1');
      expect(result).toBeNull();
    });

    it('computes average embedding from multiple memory items', async () => {
      const chain = chainableQuery({
        data: [
          { embedding: '[1.0,0.0,0.0]' },
          { embedding: '[0.0,1.0,0.0]' },
          { embedding: '[0.0,0.0,1.0]' },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await computeUserEmbedding('user1', 'guild1');
      expect(result).not.toBeNull();
      expect(result!.itemCount).toBe(3);
      // Average of [1,0,0], [0,1,0], [0,0,1] = [0.333, 0.333, 0.333]
      expect(result!.embedding[0]).toBeCloseTo(1 / 3, 3);
      expect(result!.embedding[1]).toBeCloseTo(1 / 3, 3);
      expect(result!.embedding[2]).toBeCloseTo(1 / 3, 3);
    });

    it('handles array-format embeddings', async () => {
      const chain = chainableQuery({
        data: [
          { embedding: [1.0, 0.0, 0.0] },
          { embedding: [0.0, 1.0, 0.0] },
          { embedding: [0.0, 0.0, 1.0] },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await computeUserEmbedding('user1', 'guild1');
      expect(result).not.toBeNull();
      expect(result!.itemCount).toBe(3);
    });

    it('returns null on database error', async () => {
      const chain = chainableQuery({ data: null, error: { message: 'db error' } });
      mockFrom.mockReturnValue(chain);

      const result = await computeUserEmbedding('user1', 'guild1');
      expect(result).toBeNull();
    });
  });

  describe('storeUserEmbedding', () => {
    it('upserts embedding into user_embeddings table', async () => {
      const upsertMock = vi.fn().mockReturnValue({ error: null });
      mockFrom.mockReturnValue({ upsert: upsertMock });

      const stored = await storeUserEmbedding('user1', 'guild1', [0.1, 0.2, 0.3], 5);
      expect(stored).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('user_embeddings');
      expect(upsertMock).toHaveBeenCalled();
    });

    it('returns false on error', async () => {
      const upsertMock = vi.fn().mockReturnValue({ error: { message: 'conflict' } });
      mockFrom.mockReturnValue({ upsert: upsertMock });

      const stored = await storeUserEmbedding('user1', 'guild1', [0.1], 1);
      expect(stored).toBe(false);
    });
  });

  describe('getUserEmbedding', () => {
    it('returns user embedding from database', async () => {
      const chain = chainableQuery({
        data: {
          user_id: 'user1',
          guild_id: 'guild1',
          embedding: '[0.5,0.6,0.7]',
          computed_at: '2026-04-04T00:00:00Z',
          item_count: 10,
        },
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await getUserEmbedding('user1', 'guild1');
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user1');
      expect(result!.embedding).toEqual([0.5, 0.6, 0.7]);
      expect(result!.itemCount).toBe(10);
    });

    it('returns null when not found', async () => {
      const chain = chainableQuery({ data: null, error: null });
      mockFrom.mockReturnValue(chain);

      const result = await getUserEmbedding('user1', 'guild1');
      expect(result).toBeNull();
    });
  });

  describe('refreshUserEmbeddings', () => {
    it('processes users with owned memory items', async () => {
      const ownerData = [
        { owner_user_id: 'u1', guild_id: 'g1' },
        { owner_user_id: 'u1', guild_id: 'g1' }, // duplicate — should dedup
        { owner_user_id: 'u2', guild_id: 'g1' },
      ];

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: find owner rows
          return chainableQuery({ data: ownerData, error: null });
        }
        // Subsequent calls: compute + store
        return chainableQuery({
          data: [
            { embedding: '[0.1,0.2]' },
            { embedding: '[0.3,0.4]' },
            { embedding: '[0.5,0.6]' },
          ],
          error: null,
        });
      });

      const result = await refreshUserEmbeddings('g1');
      expect(result.usersProcessed).toBe(2); // deduplicated
    });

    it('returns empty result when no users found', async () => {
      mockFrom.mockReturnValue(chainableQuery({ data: [], error: null }));

      const result = await refreshUserEmbeddings();
      expect(result.usersProcessed).toBe(0);
      expect(result.usersUpdated).toBe(0);
    });
  });
});
