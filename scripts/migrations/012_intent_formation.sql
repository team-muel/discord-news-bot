-- Migration 012: Intent Formation Engine tables
-- Supports Phase G of Autonomous Agent Evolution

-- ── intents table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.intents (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id        text        NOT NULL,
  hypothesis      text        NOT NULL,
  objective       text        NOT NULL,
  rule_id         text        NOT NULL,
  priority_score  real        NOT NULL DEFAULT 0.5,
  autonomy_level  text        NOT NULL DEFAULT 'approve-impl',
  status          text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'executing', 'completed', 'rejected', 'expired')),
  observation_ids text[]      NOT NULL DEFAULT '{}',
  sprint_id       text,
  cooldown_key    text        NOT NULL,
  token_cost      int         NOT NULL DEFAULT 0,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_intents_guild_status_created
  ON public.intents (guild_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intents_cooldown_created
  ON public.intents (cooldown_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intents_sprint
  ON public.intents (sprint_id)
  WHERE sprint_id IS NOT NULL;

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.update_intents_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intents_updated_at ON public.intents;
CREATE TRIGGER trg_intents_updated_at
  BEFORE UPDATE ON public.intents
  FOR EACH ROW EXECUTE FUNCTION public.update_intents_updated_at();

-- RLS
ALTER TABLE public.intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY intents_service_role_all ON public.intents
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── agent_trust_scores table (Phase H preview) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_trust_scores (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id    text        NOT NULL,
  category    text        NOT NULL,
  score       real        NOT NULL DEFAULT 0.35,
  factors     jsonb       NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_scores_guild_category_computed
  ON public.agent_trust_scores (guild_id, category, computed_at DESC);

ALTER TABLE public.agent_trust_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY trust_scores_service_role_all ON public.agent_trust_scores
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Track migration
INSERT INTO public.schema_migrations (version, description)
VALUES ('012', 'Intent Formation Engine + Trust Scores tables')
ON CONFLICT (version) DO NOTHING;
