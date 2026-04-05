import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- mocks ----------
const mockData: Array<Record<string, unknown>> = [];
const mockError: { message: string } | null = null;

const buildChainable = () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = vi.fn().mockImplementation(self);
  chain.in = vi.fn().mockImplementation(self);
  chain.select = vi.fn().mockImplementation(self);
  chain.data = mockData;
  chain.error = mockError;
  return chain;
};

const mockUpsert = vi.fn().mockReturnValue({ error: null });
const mockFrom = vi.fn().mockImplementation(() => ({
  select: vi.fn().mockReturnValue(buildChainable()),
  upsert: mockUpsert,
}));
const mockIsConfigured = vi.fn().mockReturnValue(true);

vi.mock('../services/supabaseClient', () => ({
  isSupabaseConfigured: () => mockIsConfigured(),
  getSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock('./supabaseErrors', () => ({
  isMissingTableError: (error: unknown) => {
    const msg = String((error as Record<string, unknown>)?.message || '');
    return msg.includes('does not exist');
  },
}));

// ---------- import under test ----------
const {
  getMigrationStatus,
  recordMigrationApplied,
  validateMigrationsAtStartup,
  KNOWN_MIGRATIONS,
} = await import('./migrationRegistry');

describe('migrationRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    // Restore default mock implementation after tests that override it
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue(buildChainable()),
      upsert: mockUpsert,
    }));
  });

  describe('KNOWN_MIGRATIONS', () => {
    it('contains expected migration names', () => {
      expect(KNOWN_MIGRATIONS).toContain('MIGRATION_SCHEMA_TRACKING');
      expect(KNOWN_MIGRATIONS).toContain('MIGRATION_THREAD_CONTEXT_COLUMNS');
      expect(KNOWN_MIGRATIONS).toContain('OBSIDIAN_HEADLESS_MIGRATION');
      expect(KNOWN_MIGRATIONS).toContain('MIGRATION_DISTRIBUTED_LOCK_RPC');
      expect(KNOWN_MIGRATIONS.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('getMigrationStatus', () => {
    it('returns all pending when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      const result = await getMigrationStatus();
      expect(result.trackingTableExists).toBe(false);
      expect(result.pendingCount).toBe(KNOWN_MIGRATIONS.length);
      expect(result.appliedCount).toBe(0);
    });

    it('returns all pending when tracking table missing', async () => {
      const missingChain: Record<string, unknown> = {};
      const self = () => missingChain;
      missingChain.select = vi.fn().mockImplementation(self);
      missingChain.in = vi.fn().mockReturnValue({
        data: null,
        error: { message: 'relation "schema_migrations" does not exist', code: '42P01' },
      });
      mockFrom.mockReturnValue(missingChain);

      const result = await getMigrationStatus();
      expect(result.trackingTableExists).toBe(false);
      expect(result.pendingCount).toBe(KNOWN_MIGRATIONS.length);
    });

    it('returns applied migrations when tracking table exists', async () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockReturnValue({
        data: [
          { name: 'MIGRATION_SCHEMA_TRACKING', applied_at: '2026-04-01T00:00:00Z', applied_by: 'cli' },
          { name: 'OBSIDIAN_HEADLESS_MIGRATION', applied_at: '2026-04-02T00:00:00Z', applied_by: 'manual' },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await getMigrationStatus();
      expect(result.trackingTableExists).toBe(true);
      expect(result.appliedCount).toBe(2);
      expect(result.pendingCount).toBe(KNOWN_MIGRATIONS.length - 2);

      const tracking = result.migrations.find((m) => m.name === 'MIGRATION_SCHEMA_TRACKING');
      expect(tracking?.applied).toBe(true);
      expect(tracking?.appliedBy).toBe('cli');

      const thread = result.migrations.find((m) => m.name === 'MIGRATION_THREAD_CONTEXT_COLUMNS');
      expect(thread?.applied).toBe(false);
    });
  });

  describe('recordMigrationApplied', () => {
    it('skips when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      await recordMigrationApplied({ name: 'MIGRATION_SCHEMA_TRACKING' });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('upserts migration record', async () => {
      await recordMigrationApplied({
        name: 'MIGRATION_THREAD_CONTEXT_COLUMNS',
        checksum: 'abc123',
        appliedBy: 'cli',
      });
      expect(mockFrom).toHaveBeenCalledWith('schema_migrations');
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      const upsertArg = mockUpsert.mock.calls[0][0];
      expect(upsertArg.name).toBe('MIGRATION_THREAD_CONTEXT_COLUMNS');
      expect(upsertArg.checksum).toBe('abc123');
      expect(upsertArg.applied_by).toBe('cli');
    });
  });

  describe('validateMigrationsAtStartup', () => {
    it('returns ok:true when Supabase not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      const result = await validateMigrationsAtStartup();
      expect(result.ok).toBe(true);
      expect(result.pendingCount).toBe(0);
    });

    it('returns pending names when migrations are missing', async () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockReturnValue({
        data: [
          { name: 'MIGRATION_SCHEMA_TRACKING', applied_at: '2026-04-01T00:00:00Z', applied_by: 'manual' },
        ],
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await validateMigrationsAtStartup();
      expect(result.ok).toBe(false);
      expect(result.trackingTableExists).toBe(true);
      expect(result.pendingCount).toBe(KNOWN_MIGRATIONS.length - 1);
      expect(result.pendingNames).toContain('MIGRATION_THREAD_CONTEXT_COLUMNS');
      expect(result.pendingNames).not.toContain('MIGRATION_SCHEMA_TRACKING');
    });

    it('returns ok:true when all migrations applied', async () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockReturnValue({
        data: KNOWN_MIGRATIONS.map((name) => ({
          name,
          applied_at: '2026-04-01T00:00:00Z',
          applied_by: 'manual',
        })),
        error: null,
      });
      mockFrom.mockReturnValue(chain);

      const result = await validateMigrationsAtStartup();
      expect(result.ok).toBe(true);
      expect(result.pendingCount).toBe(0);
      expect(result.pendingNames).toEqual([]);
      expect(result.appliedCount).toBe(KNOWN_MIGRATIONS.length);
    });

    it('does not throw on query failure', async () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = vi.fn().mockImplementation(self);
      chain.in = vi.fn().mockReturnValue({
        data: null,
        error: { message: 'connection refused' },
      });
      mockFrom.mockReturnValue(chain);

      const result = await validateMigrationsAtStartup();
      // Should gracefully return noop result, not throw
      expect(result.ok).toBe(true);
      expect(result.pendingCount).toBe(0);
    });
  });
});
