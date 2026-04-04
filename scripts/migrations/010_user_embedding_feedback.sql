-- Migration 010: User Embedding
-- Inspired by Daangn's long-term user modeling approach.
--
-- user_embeddings: per-user, per-guild embedding vector (averaged from owned memory items)

-- ──── User Embeddings ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_embeddings (
  user_id       TEXT NOT NULL,
  guild_id      TEXT NOT NULL,
  embedding     vector(1536),
  item_count    INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_user_embeddings_guild
  ON user_embeddings (guild_id);

CREATE INDEX IF NOT EXISTS idx_user_embeddings_computed
  ON user_embeddings (computed_at);
