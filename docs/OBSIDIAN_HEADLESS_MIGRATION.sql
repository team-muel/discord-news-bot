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

-- Policy: Anyone can read cache (world-readable)
CREATE POLICY cache_read ON obsidian_cache FOR SELECT
  USING (true);

-- Policy: Only service role can write cache
CREATE POLICY cache_write ON obsidian_cache FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY cache_update ON obsidian_cache FOR UPDATE
  USING (auth.role() = 'service_role');

-- Policy: Log reads
CREATE POLICY query_log_read ON obsidian_query_log FOR SELECT
  USING (true);

-- Policy: Anyone can insert logs
CREATE POLICY query_log_write ON obsidian_query_log FOR INSERT
  WITH CHECK (true);

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
GRANT SELECT ON obsidian_cache TO anon, authenticated;
GRANT INSERT, UPDATE ON obsidian_cache TO service_role;
GRANT SELECT, INSERT ON obsidian_query_log TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON obsidian_metadata TO service_role;
