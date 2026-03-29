-- Migration: Reward signal normalization + A/B eval promotion tables
-- Depends on: agent_sessions, agent_llm_call_logs, memory_retrieval_logs
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE)

-- 1. Aggregated reward signals per guild per window
create table if not exists public.reward_signal_snapshots (
  id bigint generated always as identity primary key,
  guild_id text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  -- Normalized component scores (0..1)
  reaction_score real not null default 0,
  session_success_rate real not null default 0,
  citation_rate real not null default 0,
  latency_score real not null default 0,
  -- Blended scalar reward
  reward_scalar real not null default 0,
  -- Raw counts for debugging
  reaction_up integer not null default 0,
  reaction_down integer not null default 0,
  session_total integer not null default 0,
  session_succeeded integer not null default 0,
  retrieval_logs_count integer not null default 0,
  avg_retrieval_score real,
  avg_latency_ms real,
  p95_latency_ms real,
  created_at timestamptz not null default now()
);

create index if not exists idx_reward_signal_snapshots_guild_window
  on public.reward_signal_snapshots (guild_id, window_end desc);

-- Prevent duplicate snapshots for the same guild+window (race condition guard)
create unique index if not exists idx_reward_signal_snapshots_guild_window_unique
  on public.reward_signal_snapshots (guild_id, window_start);

-- 2. A/B eval comparison runs
create table if not exists public.eval_ab_runs (
  id bigint generated always as identity primary key,
  guild_id text not null,
  eval_name text not null,
  baseline_config jsonb not null default '{}'::jsonb,
  candidate_config jsonb not null default '{}'::jsonb,
  baseline_reward real,
  candidate_reward real,
  delta_reward real,
  verdict text not null default 'pending',  -- 'pending' | 'promote' | 'reject' | 'inconclusive'
  judge_reasoning text,
  sample_count integer not null default 0,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_eval_ab_runs_guild
  on public.eval_ab_runs (guild_id, created_at desc);

-- 3. Shadow graph divergence logs
create table if not exists public.shadow_graph_divergence_logs (
  id bigint generated always as identity primary key,
  session_id text not null,
  guild_id text not null,
  main_path_nodes text[] not null default array[]::text[],
  shadow_path_nodes text[] not null default array[]::text[],
  diverge_at_index integer,
  main_final_status text,
  shadow_final_text text,
  shadow_error text,
  quality_delta real,
  elapsed_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_shadow_graph_divergence_guild
  on public.shadow_graph_divergence_logs (guild_id, created_at desc);

-- 4. RLS policies
alter table public.reward_signal_snapshots enable row level security;
alter table public.eval_ab_runs enable row level security;
alter table public.shadow_graph_divergence_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='reward_signal_snapshots' and policyname='reward_signal_snapshots_service_role'
  ) then
    create policy reward_signal_snapshots_service_role on public.reward_signal_snapshots
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='eval_ab_runs' and policyname='eval_ab_runs_service_role'
  ) then
    create policy eval_ab_runs_service_role on public.eval_ab_runs
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='shadow_graph_divergence_logs' and policyname='shadow_graph_divergence_logs_service_role'
  ) then
    create policy shadow_graph_divergence_logs_service_role on public.shadow_graph_divergence_logs
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end
$$;
