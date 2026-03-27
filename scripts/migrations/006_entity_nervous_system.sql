-- Entity Nervous System: self-notes table for Circuit 3 (Self-Reflection -> Self-Modification)
-- Self-notes accumulate retro insights, reward degradation awareness, and failure patterns.
-- They are loaded as top-priority hints into agent sessions via buildAgentMemoryHints.

CREATE TABLE IF NOT EXISTS entity_self_notes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id      TEXT NOT NULL,
  source        TEXT NOT NULL,          -- e.g. 'retro:sprint_abc', 'reward-behavior'
  note          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at    TIMESTAMPTZ          -- NULL = active; set to expire old notes
);

-- Index for guild-scoped reads ordered by recency
CREATE INDEX IF NOT EXISTS idx_entity_self_notes_guild_created
  ON entity_self_notes (guild_id, created_at DESC);

-- Auto-expire notes older than 30 days (soft: mark expired, don't delete)
-- This can be run periodically by a maintenance job
-- UPDATE entity_self_notes
--   SET expired_at = now()
--   WHERE expired_at IS NULL
--     AND created_at < now() - INTERVAL '30 days';

-- RLS: service role only
ALTER TABLE entity_self_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY entity_self_notes_service_role
  ON entity_self_notes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
