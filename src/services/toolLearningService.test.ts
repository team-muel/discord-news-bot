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
  decideToolLearningCandidate,
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

    it('surfaces invalid signal patterns in rule diagnostics', async () => {
      const selectReturnChain = (() => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = vi.fn().mockImplementation(self);
        chain.order = vi.fn().mockImplementation(self);
        chain.limit = vi.fn().mockReturnValue({
          data: [{
            id: 1,
            guild_id: '123456789012345678',
            signal_key: 'broken',
            signal_pattern: '(',
            recommended_route: 'execution',
            recommended_channel: 'docs',
            confidence: 0.8,
            support_count: 5,
            status: 'active',
            source_candidate_id: 10,
            updated_by: 'admin',
            created_at: '2026-04-11T00:00:00.000Z',
            updated_at: '2026-04-11T00:00:00.000Z',
          }],
          error: null,
        });
        return chain;
      })();
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue(selectReturnChain),
      });

      const result = await listToolLearningRules({
        guildId: '123456789012345678',
      });

      expect(result[0].signalPatternStatus).toBe('invalid');
      expect(result[0].signalPatternIssue).toBe('invalid-regex');
    });
  });

  describe('decideToolLearningCandidate', () => {
    it('rejects approving candidates with invalid signal patterns', async () => {
      const maybeSingle = vi.fn().mockReturnValue({
        data: {
          id: 7,
          guild_id: '123456789012345678',
          scope: 'task_routing',
          signal_key: 'broken',
          signal_pattern: '(',
          recommended_route: 'execution',
          recommended_channel: 'docs',
          support_count: 3,
          avg_outcome_score: 0.82,
          status: 'pending',
          evidence: {},
          proposed_by: 'system',
          decided_by: null,
          decided_at: null,
          created_at: '2026-04-11T00:00:00.000Z',
          updated_at: '2026-04-11T00:00:00.000Z',
        },
        error: null,
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'agent_tool_learning_candidates') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle,
                }),
              }),
            }),
            update: vi.fn(),
          };
        }
        return {
          select: vi.fn().mockReturnValue(mockSelectChain),
          update: vi.fn().mockReturnValue(mockUpdateChain),
          upsert: vi.fn().mockReturnValue({ error: null }),
          insert: mockInsert,
        };
      });

      await expect(
        decideToolLearningCandidate({
          guildId: '123456789012345678',
          candidateId: 7,
          decision: 'approved',
          actorId: 'admin',
        }),
      ).rejects.toThrow('TOOL_LEARNING_INVALID_SIGNAL_PATTERN');
    });
  });
});
