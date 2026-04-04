import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Supabase mock ----------
const mockInsert = vi.fn().mockReturnValue({ error: null });
const mockSelectChain = (() => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = vi.fn().mockImplementation(self);
  chain.gte = vi.fn().mockImplementation(self);
  chain.lte = vi.fn().mockImplementation(self);
  chain.order = vi.fn().mockImplementation(self);
  chain.limit = vi.fn().mockReturnValue({ data: [], error: null });
  chain.single = vi.fn().mockReturnValue({ data: null, error: null });
  chain.data = [];
  chain.error = null;
  return chain;
})();
const mockUpdateChain = (() => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = vi.fn().mockImplementation(self);
  chain.error = null;
  chain.data = null;
  return chain;
})();

const mockFrom = vi.fn().mockReturnValue({
  insert: mockInsert,
  select: vi.fn().mockReturnValue(mockSelectChain),
  update: vi.fn().mockReturnValue(mockUpdateChain),
  upsert: vi.fn().mockReturnValue({ error: null }),
});
const mockIsConfigured = vi.fn().mockReturnValue(true);

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsConfigured(),
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// ---------- import under test ----------
const {
  recordToolLearningLog,
  generateTaskRoutingLearningCandidates,
  listToolLearningCandidates,
  listToolLearningRules,
} = await import('./toolLearningService');

describe('toolLearningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
  });

  describe('recordToolLearningLog', () => {
    it('skips when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      await recordToolLearningLog({
        guildId: '123456789012345678',
        requestedBy: 'user1',
        scope: 'task_routing',
        toolName: 'rag.retrieve',
        outcomeScore: 0.8,
      });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('skips when guildId is invalid', async () => {
      await recordToolLearningLog({
        guildId: 'bad',
        requestedBy: 'user1',
        scope: 'task_routing',
        toolName: 'rag.retrieve',
        outcomeScore: 0.8,
      });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('inserts log row with valid params', async () => {
      await recordToolLearningLog({
        guildId: '123456789012345678',
        requestedBy: 'user1',
        scope: 'task_routing',
        toolName: 'rag.retrieve',
        outcomeScore: 0.85,
        reason: 'User asked about docs',
      });
      expect(mockFrom).toHaveBeenCalledWith('agent_tool_learning_logs');
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.guild_id).toBe('123456789012345678');
      expect(insertArg.tool_name).toBe('rag.retrieve');
      expect(insertArg.outcome_score).toBeGreaterThanOrEqual(0);
      expect(insertArg.outcome_score).toBeLessThanOrEqual(1);
    });

    it('clamps outcome_score to [0,1]', async () => {
      await recordToolLearningLog({
        guildId: '123456789012345678',
        requestedBy: 'user1',
        scope: 'task_routing',
        toolName: 'test',
        outcomeScore: 5.0,
      });
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.outcome_score).toBe(1);
    });
  });

  describe('generateTaskRoutingLearningCandidates', () => {
    it('throws when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      await expect(
        generateTaskRoutingLearningCandidates({
          guildId: '123456789012345678',
          days: 14,
          minSamples: 4,
          minOutcomeScore: 0.6,
          actorId: 'admin',
        }),
      ).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
    });

    it('throws on invalid guildId', async () => {
      await expect(
        generateTaskRoutingLearningCandidates({
          guildId: '',
          days: 14,
          minSamples: 4,
          minOutcomeScore: 0.6,
          actorId: 'admin',
        }),
      ).rejects.toThrow('VALIDATION');
    });

    it('returns zero counts when no feedback data', async () => {
      // Mock the select chain to return empty data
      const selectWithData = (() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = vi.fn().mockImplementation(self);
        chain.gte = vi.fn().mockImplementation(self);
        chain.order = vi.fn().mockImplementation(self);
        chain.limit = vi.fn().mockReturnValue({ data: [], error: null });
        return chain;
      })();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue(selectWithData),
        insert: mockInsert,
        upsert: vi.fn().mockReturnValue({ error: null }),
      });

      const result = await generateTaskRoutingLearningCandidates({
        guildId: '123456789012345678',
        days: 14,
        minSamples: 4,
        minOutcomeScore: 0.6,
        actorId: 'admin',
      });
      expect(result.generated).toBe(0);
      expect(result.considered).toBe(0);
    });
  });

  describe('listToolLearningCandidates', () => {
    it('returns empty array when no candidates', async () => {
      const selectReturnChain = (() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = vi.fn().mockImplementation(self);
        chain.order = vi.fn().mockImplementation(self);
        chain.limit = vi.fn().mockReturnValue({ data: [], error: null });
        return chain;
      })();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue(selectReturnChain),
      });

      const result = await listToolLearningCandidates({
        guildId: '123456789012345678',
      });
      expect(result).toEqual([]);
    });
  });

  describe('listToolLearningRules', () => {
    it('returns empty array when no rules', async () => {
      const selectReturnChain = (() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = vi.fn().mockImplementation(self);
        chain.order = vi.fn().mockImplementation(self);
        chain.limit = vi.fn().mockReturnValue({ data: [], error: null });
        return chain;
      })();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue(selectReturnChain),
      });

      const result = await listToolLearningRules({
        guildId: '123456789012345678',
      });
      expect(result).toEqual([]);
    });
  });
});
