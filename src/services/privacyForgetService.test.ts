import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- mocks ----------
const mockSelectHead = vi.fn().mockReturnValue({ count: 0, error: null });
const mockSelectEq2 = vi.fn().mockReturnValue(mockSelectHead);
const mockSelectEq = vi.fn().mockReturnValue({ eq: mockSelectEq2, or: vi.fn().mockReturnValue(mockSelectHead) });
const mockSelect = vi.fn().mockReturnValue({ eq: mockSelectEq, or: vi.fn().mockReturnValue(mockSelectHead) });

const mockDeleteEq2 = vi.fn().mockReturnValue({ count: 0, error: null });
const mockDeleteEq = vi.fn().mockReturnValue({ eq: mockDeleteEq2, or: vi.fn().mockReturnValue({ count: 0, error: null }) });
const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });

const mockFrom = vi.fn().mockReturnValue({
  select: mockSelect,
  delete: mockDelete,
});

const mockClient = { from: mockFrom };
const mockIsSupabaseConfigured = vi.fn().mockReturnValue(true);
const mockGetSupabaseClient = vi.fn().mockReturnValue(mockClient);

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsSupabaseConfigured(),
  getSupabaseClient: () => mockGetSupabaseClient(),
}));

vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

vi.mock('../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: () => '',
}));

vi.mock('../utils/obsidianFileLock', () => ({
  withObsidianFileLock: vi.fn(async ({ task }: { task: () => Promise<unknown> }) => task()),
}));

vi.mock('../utils/supabaseErrors', () => ({
  isMissingTableError: (error: unknown) => {
    const msg = String((error as Record<string, unknown>)?.message || '');
    return msg.includes('does not exist');
  },
}));

// ---------- import under test ----------
const {
  previewForgetGuildRagData,
  previewForgetUserRagData,
  forgetGuildRagData,
  forgetUserRagData,
} = await import('./privacyForgetService');

describe('privacyForgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsSupabaseConfigured.mockReturnValue(true);

    // Reset chain mocks
    mockSelectHead.mockReturnValue({ count: 0, error: null });
    mockSelectEq2.mockReturnValue(mockSelectHead);
    mockSelectEq.mockReturnValue({ eq: mockSelectEq2, or: vi.fn().mockReturnValue(mockSelectHead) });
    mockSelect.mockReturnValue({ eq: mockSelectEq, or: vi.fn().mockReturnValue(mockSelectHead) });

    mockDeleteEq2.mockReturnValue({ count: 0, error: null });
    mockDeleteEq.mockReturnValue({ eq: mockDeleteEq2, or: vi.fn().mockReturnValue({ count: 0, error: null }) });
    mockDelete.mockReturnValue({ eq: mockDeleteEq });

    mockFrom.mockReturnValue({
      select: mockSelect,
      delete: mockDelete,
    });
  });

  describe('input validation', () => {
    it('previewForgetGuildRagData rejects empty guildId', async () => {
      await expect(previewForgetGuildRagData('')).rejects.toThrow('GUILD_ID_REQUIRED');
    });

    it('previewForgetUserRagData rejects empty userId', async () => {
      await expect(previewForgetUserRagData({ userId: '' })).rejects.toThrow('USER_ID_REQUIRED');
    });

    it('forgetGuildRagData rejects empty guildId', async () => {
      await expect(forgetGuildRagData({ guildId: '' })).rejects.toThrow('GUILD_ID_REQUIRED');
    });

    it('forgetUserRagData rejects empty userId', async () => {
      await expect(forgetUserRagData({ userId: '' })).rejects.toThrow('USER_ID_REQUIRED');
    });
  });

  describe('Supabase not configured', () => {
    it('previewForgetGuildRagData throws when Supabase not configured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      await expect(previewForgetGuildRagData('123456789012345678')).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
    });

    it('forgetGuildRagData throws when Supabase not configured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      await expect(forgetGuildRagData({ guildId: '123456789012345678' })).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
    });

    it('forgetUserRagData throws when Supabase not configured', async () => {
      mockIsSupabaseConfigured.mockReturnValue(false);
      await expect(forgetUserRagData({ userId: '123456789012345678' })).rejects.toThrow('SUPABASE_NOT_CONFIGURED');
    });
  });

  describe('previewForgetGuildRagData', () => {
    it('returns preview with zero counts when tables are empty', async () => {
      const result = await previewForgetGuildRagData('123456789012345678');
      expect(result.scope).toBe('guild');
      expect(result.guildId).toBe('123456789012345678');
      expect(result.supabase.totalCandidates).toBe(0);
      expect(result.obsidian.attempted).toBe(true);
      expect(result.obsidian.candidatePaths).toEqual([]);
    });

    it('queries all FORGET_GUILD_TABLES', async () => {
      await previewForgetGuildRagData('123456789012345678');
      const tables = mockFrom.mock.calls.map((c: unknown[]) => c[0]);
      // Should include memory_items, community_interaction_events, etc.
      expect(tables).toContain('memory_items');
      expect(tables).toContain('community_interaction_events');
      expect(tables).toContain('agent_sessions');
    });
  });

  describe('forgetGuildRagData', () => {
    it('returns result with zero deletions when tables are empty', async () => {
      const result = await forgetGuildRagData({
        guildId: '123456789012345678',
        reason: 'test-cleanup',
        requestedBy: 'unit-test',
      });
      expect(result.scope).toBe('guild');
      expect(result.guildId).toBe('123456789012345678');
      expect(result.supabase.totalDeleted).toBe(0);
      expect(result.obsidian.attempted).toBe(true);
    });

    it('skips Obsidian deletion when deleteObsidian=false', async () => {
      const result = await forgetGuildRagData({
        guildId: '123456789012345678',
        deleteObsidian: false,
      });
      expect(result.obsidian.attempted).toBe(false);
      expect(result.obsidian.removedPaths).toEqual([]);
    });

    it('calls delete on all tables', async () => {
      await forgetGuildRagData({ guildId: '123456789012345678' });
      const deleteCalls = mockFrom.mock.calls;
      expect(deleteCalls.length).toBeGreaterThanOrEqual(16); // 16 FORGET_GUILD_TABLES
    });
  });

  describe('previewForgetUserRagData', () => {
    it('returns user-scoped preview', async () => {
      // Need full chain mocking for user preview
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ count: 0, error: null }),
            count: 0,
            error: null,
          }),
          count: 0,
          error: null,
        }),
      }));

      const result = await previewForgetUserRagData({
        userId: '123456789012345678',
      });
      expect(result.scope).toBe('user');
      expect(result.userId).toBe('123456789012345678');
      expect(result.supabase.totalCandidates).toBe(0);
    });

    it('includes guildId scoping when provided', async () => {
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ count: 0, error: null }),
            count: 0,
            error: null,
          }),
          count: 0,
          error: null,
        }),
      }));

      const result = await previewForgetUserRagData({
        userId: '123456789012345678',
        guildId: '987654321098765432',
      });
      expect(result.guildId).toBe('987654321098765432');
    });
  });

  describe('forgetUserRagData', () => {
    it('returns user-scoped deletion result', async () => {
      // Build a flexible mock that handles the complex user purge chains
      const buildChainable = (terminal: Record<string, unknown> = { count: 0, error: null }) => {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.eq = vi.fn().mockImplementation(self);
        chain.or = vi.fn().mockImplementation(self);
        chain.in = vi.fn().mockImplementation(self);
        chain.limit = vi.fn().mockReturnValue({ data: [], error: null });
        // Terminal values for head counts and deletes
        chain.count = terminal.count;
        chain.error = terminal.error;
        chain.data = terminal.data ?? [];
        return chain;
      };

      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue(buildChainable()),
        delete: vi.fn().mockReturnValue(buildChainable()),
      }));

      const result = await forgetUserRagData({
        userId: '123456789012345678',
        reason: 'gdpr-request',
        requestedBy: 'admin',
      });
      expect(result.scope).toBe('user');
      expect(result.userId).toBe('123456789012345678');
      expect(typeof result.supabase.totalDeleted).toBe('number');
    });
  });

  describe('missing table graceful degradation', () => {
    it('previewForgetGuildRagData returns 0 for missing tables', async () => {
      mockSelectHead.mockReturnValue({
        count: null,
        error: { message: 'relation "memory_feedback" does not exist', code: '42P01' },
      });

      const result = await previewForgetGuildRagData('123456789012345678');
      expect(result.supabase.totalCandidates).toBe(0);
    });

    it('forgetGuildRagData handles missing table gracefully', async () => {
      mockDeleteEq2.mockReturnValue({
        count: null,
        error: { message: 'relation "memory_feedback" does not exist', code: '42P01' },
      });

      const result = await forgetGuildRagData({ guildId: '123456789012345678' });
      expect(result.supabase.totalDeleted).toBe(0);
    });
  });
});
