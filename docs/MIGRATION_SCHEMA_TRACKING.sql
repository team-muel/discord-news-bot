-- Migration tracking table for Supabase schema migrations
-- Apply this FIRST before using the migration tracking system
-- Safe to re-run (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT,
  applied_by TEXT DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_name ON schema_migrations(name);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

COMMENT ON TABLE schema_migrations IS 'Tracks which SQL migrations have been applied to this database';
COMMENT ON COLUMN schema_migrations.name IS 'Migration file name (e.g. MIGRATION_THREAD_CONTEXT_COLUMNS)';
COMMENT ON COLUMN schema_migrations.checksum IS 'SHA256 of the migration file content at apply time';
COMMENT ON COLUMN schema_migrations.applied_by IS 'Who applied: manual, cli, or ci';
