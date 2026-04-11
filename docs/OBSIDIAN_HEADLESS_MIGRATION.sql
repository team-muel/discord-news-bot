-- Obsidian RAG Cache Tables
-- Created: 2026-03-14

-- Obsidian document cache
-- Stores frequently accessed vault files with TTL-based eviction
CREATE TABLE IF NOT EXISTS obsidian_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  frontmatter JSONB DEFAULT '{}',
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_accessed_at TIMESTAMP WITH TIME ZONE,
  hit_count INTEGER DEFAULT 0,
  CONSTRAINT valid_cache_ttl CHECK (cached_at > now() - interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_obsidian_cache_file_path ON obsidian_cache(file_path);
CREATE INDEX IF NOT EXISTS idx_obsidian_cache_cached_at ON obsidian_cache(cached_at DESC);
CREATE INDEX IF NOT EXISTS idx_obsidian_cache_hit_count ON obsidian_cache(hit_count DESC);

-- Obsidian graph metadata
-- Stores vault structure: titles, tags, relationships (for fast routing)
CREATE TABLE IF NOT EXISTS obsidian_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT UNIQUE NOT NULL,
  title TEXT,
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  backlinks TEXT[] DEFAULT '{}',
  links TEXT[] DEFAULT '{}',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT valid_sync CHECK (synced_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_file_path ON obsidian_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_category ON obsidian_metadata(category);
CREATE INDEX IF NOT EXISTS idx_obsidian_metadata_tags ON obsidian_metadata USING GIN(tags);

-- Obsidian RAG query log
-- Tracks queries for analytics and performance tuning
CREATE TABLE IF NOT EXISTS obsidian_query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT,
  user_id TEXT,
  question TEXT NOT NULL,
  inferred_intent TEXT,
  document_count INTEGER,
  document_paths TEXT[] DEFAULT '{}',
  response_tokens INTEGER,
  execution_time_ms INTEGER,
  cache_hits INTEGER DEFAULT 0,
  cache_misses INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_created_at ON obsidian_query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_guild_id ON obsidian_query_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_obsidian_query_log_intent ON obsidian_query_log(inferred_intent);

-- Enable RLS for cache (optional, admin-only write)
ALTER TABLE obsidian_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE obsidian_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE obsidian_query_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Policy: Only service role can read/write cache
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_cache' AND policyname = 'obsidian_cache_service_role_all'
  ) THEN
    CREATE POLICY obsidian_cache_service_role_all ON obsidian_cache
      FOR ALL
      USING ((select auth.role()) = 'service_role')
      WITH CHECK ((select auth.role()) = 'service_role');
  END IF;

  -- Policy: Service role reads query logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_query_log' AND policyname = 'query_log_read'
  ) THEN
    CREATE POLICY query_log_read ON obsidian_query_log FOR SELECT USING (auth.role() = 'service_role');
  END IF;

  -- Policy: Service role inserts query logs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'obsidian_query_log' AND policyname = 'query_log_write'
  ) THEN
    CREATE POLICY query_log_write ON obsidian_query_log FOR INSERT WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- Function: Auto-clear expired cache entries (optional, call periodically)
CREATE OR REPLACE FUNCTION clear_expired_obsidian_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM obsidian_cache
  WHERE cached_at < (now() - interval '1 hour');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant privileges
REVOKE ALL ON obsidian_cache FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON obsidian_cache TO service_role;
REVOKE ALL ON obsidian_query_log FROM anon, authenticated;
GRANT SELECT, INSERT ON obsidian_query_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON obsidian_metadata TO service_role;
