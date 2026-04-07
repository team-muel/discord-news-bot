import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from '../services/supabaseClient';
import { isMissingTableError } from './supabaseErrors';
import { getErrorMessage } from './errorMessage';

/**
 * Known migration files in docs/ that should be applied to Supabase.
 * Order matters — apply in sequence.
 *
 * Each entry corresponds to a `docs/<name>.sql` file.
 * The tracking table (`schema_migrations`) records which have been applied.
 */
export const KNOWN_MIGRATIONS = [
  'MIGRATION_SCHEMA_TRACKING',
  'OBSIDIAN_HEADLESS_MIGRATION',
  'MIGRATION_THREAD_CONTEXT_COLUMNS',
  'MIGRATION_OBSIDIAN_CACHE_HIT_INCREMENT',
  'MIGRATION_DEDUPE_LEARNING',
  'MIGRATION_DISTRIBUTED_LOCK_RPC',
] as const;

export type MigrationName = (typeof KNOWN_MIGRATIONS)[number];

export type MigrationStatus = {
  name: MigrationName;
  applied: boolean;
  appliedAt: string | null;
  appliedBy: string | null;
};

export type MigrationRegistryStatus = {
  trackingTableExists: boolean;
  migrations: MigrationStatus[];
  pendingCount: number;
  appliedCount: number;
};

/**
 * Check which migrations have been applied.
 * Returns status for all known migrations.
 * Gracefully handles missing tracking table.
 */
export const getMigrationStatus = async (): Promise<MigrationRegistryStatus> => {
  if (!isSupabaseConfigured()) {
    return {
      trackingTableExists: false,
      migrations: KNOWN_MIGRATIONS.map((name) => ({
        name,
        applied: false,
        appliedAt: null,
        appliedBy: null,
      })),
      pendingCount: KNOWN_MIGRATIONS.length,
      appliedCount: 0,
    };
  }

  const client = getSupabaseClient();

  // Try to read from schema_migrations table
  const { data, error } = await client
    .from('schema_migrations')
    .select('name, applied_at, applied_by')
    .in('name', [...KNOWN_MIGRATIONS]);

  if (error) {
    if (isMissingTableError(error)) {
      return {
        trackingTableExists: false,
        migrations: KNOWN_MIGRATIONS.map((name) => ({
          name,
          applied: false,
          appliedAt: null,
          appliedBy: null,
        })),
        pendingCount: KNOWN_MIGRATIONS.length,
        appliedCount: 0,
      };
    }
    throw new Error(`MIGRATION_STATUS_QUERY_FAILED: ${error.message}`);
  }

  const appliedMap = new Map(
    ((data || []) as Array<{ name: string; applied_at: string; applied_by: string }>).map((row) => [
      row.name,
      { appliedAt: row.applied_at, appliedBy: row.applied_by },
    ]),
  );

  const migrations: MigrationStatus[] = KNOWN_MIGRATIONS.map((name) => {
    const applied = appliedMap.get(name);
    return {
      name,
      applied: Boolean(applied),
      appliedAt: applied?.appliedAt ?? null,
      appliedBy: applied?.appliedBy ?? null,
    };
  });

  const appliedCount = migrations.filter((m) => m.applied).length;

  return {
    trackingTableExists: true,
    migrations,
    pendingCount: migrations.length - appliedCount,
    appliedCount,
  };
};

/**
 * Record that a migration was applied.
 */
export const recordMigrationApplied = async (params: {
  name: MigrationName;
  checksum?: string;
  appliedBy?: string;
}): Promise<void> => {
  if (!isSupabaseConfigured()) return;
  const client = getSupabaseClient();
  await client.from('schema_migrations').upsert(
    {
      name: params.name,
      checksum: params.checksum || null,
      applied_by: params.appliedBy || 'manual',
      applied_at: new Date().toISOString(),
    },
    { onConflict: 'name' },
  );
};

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

export type MigrationValidationResult = {
  ok: boolean;
  trackingTableExists: boolean;
  appliedCount: number;
  pendingCount: number;
  pendingNames: string[];
};

/**
 * Check migration status at startup and log warnings for pending migrations.
 * Never throws — degraded DB should not block server boot.
 */
export const validateMigrationsAtStartup = async (): Promise<MigrationValidationResult> => {
  const noopResult: MigrationValidationResult = {
    ok: true,
    trackingTableExists: false,
    appliedCount: 0,
    pendingCount: 0,
    pendingNames: [],
  };

  if (!isSupabaseConfigured()) {
    logger.debug('[MIGRATIONS] Supabase not configured — skipping migration check');
    return noopResult;
  }

  try {
    const status = await getMigrationStatus();
    const pendingNames = status.migrations
      .filter((m) => !m.applied)
      .map((m) => m.name);

    const result: MigrationValidationResult = {
      ok: pendingNames.length === 0,
      trackingTableExists: status.trackingTableExists,
      appliedCount: status.appliedCount,
      pendingCount: status.pendingCount,
      pendingNames,
    };

    if (!status.trackingTableExists) {
      logger.warn(
        '[MIGRATIONS] schema_migrations table not found — apply MIGRATION_SCHEMA_TRACKING.sql first. %d migration(s) untracked.',
        KNOWN_MIGRATIONS.length,
      );
    } else if (pendingNames.length > 0) {
      logger.warn(
        '[MIGRATIONS] %d pending migration(s): %s — apply via Supabase SQL Editor (see docs/SUPABASE_MIGRATION_CHECKLIST.md)',
        pendingNames.length,
        pendingNames.join(', '),
      );
    } else {
      logger.info('[MIGRATIONS] All %d migration(s) applied', status.appliedCount);
    }

    return result;
  } catch (err) {
    logger.warn('[MIGRATIONS] Failed to check migration status: %s', getErrorMessage(err));
    return noopResult;
  }
};

// Cache the last validation result for the health endpoint
let lastValidation: MigrationValidationResult | null = null;

export const getLastMigrationValidation = (): MigrationValidationResult | null => lastValidation;

export const runAndCacheMigrationValidation = async (): Promise<MigrationValidationResult> => {
  lastValidation = await validateMigrationsAtStartup();
  return lastValidation;
};
