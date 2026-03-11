-- Supabase schema bootstrap (idempotent)
-- Run in Supabase SQL Editor.

-- ==========================================
-- 1. Initial reset (optional)
-- ==========================================
-- drop table if exists public.error_history cascade;
-- drop table if exists public.macro_data cascade;
-- drop table if exists public.macro_series cascade;
-- drop table if exists public.logs cascade;
-- drop table if exists public.settings cascade;
-- drop table if exists public.alert_slots cascade;
-- drop table if exists public.sources cascade;
-- drop table if exists public.users cascade;

-- ==========================================
-- 2. User and service infrastructure
-- ==========================================

create table if not exists public.users (
  id text primary key,
  username text not null,
  avatar text,
  discord_access_token text,
  discord_refresh_token text,
  created_at timestamptz default current_timestamp,
  updated_at timestamptz default current_timestamp
);

create table if not exists public.sources (
  id serial primary key,
  user_id text references public.users(id) on delete set null,
  name text not null,
  url text not null unique,
  guild_id text,
  channel_id text,
  guild_name text,
  channel_name text,
  is_active boolean not null default true,
  lock_token text,
  lock_expires_at timestamptz,
  last_post_id text,
  last_post_signature text,
  last_check_status text,
  last_check_error text,
  last_check_at timestamptz,
  created_at timestamptz default current_timestamp
);

-- Node-only migration safety: add columns when table already exists from older schema.
alter table public.sources add column if not exists guild_id text;
alter table public.sources add column if not exists channel_id text;
alter table public.sources add column if not exists guild_name text;
alter table public.sources add column if not exists channel_name text;
alter table public.sources add column if not exists is_active boolean not null default true;
alter table public.sources add column if not exists lock_token text;
alter table public.sources add column if not exists lock_expires_at timestamptz;

create index if not exists idx_sources_guild_channel on public.sources (guild_id, channel_id);
create index if not exists idx_sources_lock on public.sources (lock_token, lock_expires_at);

create table if not exists public.alert_slots (
  id serial primary key,
  user_id text not null references public.users(id) on delete cascade,
  source_id int not null references public.sources(id) on delete cascade,
  guild_id text not null,
  channel_id text not null,
  guild_name text,
  channel_name text,
  is_active boolean default true,
  created_at timestamptz default current_timestamp,
  unique(source_id, channel_id)
);

create table if not exists public.settings (
  key text,
  user_id text references public.users(id) on delete cascade,
  value text not null,
  updated_at timestamptz default current_timestamp,
  primary key (key, user_id)
);

create table if not exists public.logs (
  id serial primary key,
  user_id text references public.users(id) on delete cascade,
  message text not null,
  type text not null,
  created_at timestamptz default current_timestamp
);

-- ==========================================
-- 3. Macro indicator infrastructure
-- ==========================================

create table if not exists public.macro_series (
  series_id text primary key,
  name text not null,
  frequency text,
  description text,
  last_updated timestamptz default now()
);

create table if not exists public.macro_data (
  id serial primary key,
  series_id text references public.macro_series(series_id) on delete cascade,
  date date not null,
  value numeric not null,
  created_at timestamptz default now(),
  unique(series_id, date)
);

insert into public.macro_series (series_id, name, frequency, description) values
('CPIAUCSL', 'Consumer Price Index (CPI)', 'Monthly', 'US urban consumer price index'),
('FEDFUNDS', 'Federal Funds Rate', 'Monthly', 'US central bank policy rate'),
('T10Y2Y', 'Yield Spread (10Y-2Y)', 'Daily', 'Treasury curve inversion indicator'),
('M2SL', 'M2 Money Stock', 'Monthly', 'Broad money supply')
on conflict (series_id) do update
set name = excluded.name,
    frequency = excluded.frequency,
    description = excluded.description;

-- ==========================================
-- 4. Error logging optimization
-- ==========================================

create table if not exists public.error_history (
  id serial primary key,
  source_id int references public.sources(id) on delete cascade,
  error_message text not null,
  occurred_at timestamptz default now()
);

create or replace function public.log_source_error()
returns trigger
language plpgsql
as $$
begin
  if (new.last_check_status = 'error' and old.last_check_status is distinct from 'error') then
    insert into public.error_history (source_id, error_message)
    values (new.id, new.last_check_error);
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_log_error on public.sources;
create trigger trigger_log_error
after update on public.sources
for each row
execute function public.log_source_error();

-- ==========================================
-- 5. Orphan source cleanup trigger
-- ==========================================

create or replace function public.delete_orphaned_source()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.alert_slots where source_id = old.source_id) then
    delete from public.sources where id = old.source_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trigger_delete_orphaned_source on public.alert_slots;
create trigger trigger_delete_orphaned_source
after delete on public.alert_slots
for each row
execute function public.delete_orphaned_source();

-- ==========================================
-- 6. TradingView signal pipeline
-- ==========================================

create table if not exists public.trading_signals (
  id serial primary key,
  symbol text not null,
  signal_type text not null,
  price numeric,
  qty numeric,
  leverage int default 1,
  received_at timestamptz default now()
);

-- ==========================================
-- 7. Quant regime master
-- ==========================================

create table if not exists public.market_regime (
  date date primary key,
  regime_phase text not null,
  inflation_score numeric,
  growth_score numeric,
  description text,
  updated_at timestamptz default now()
);

-- ==========================================
-- 8. User roles
-- ==========================================

create table if not exists public.user_roles (
  user_id text primary key,
  role text not null default 'user',
  granted_at timestamptz default current_timestamp,
  granted_by text
);

create index if not exists idx_user_roles_role on public.user_roles(role);

-- Replace with real Discord user id before production use.
insert into public.user_roles (user_id, role)
values ('123456789012345678', 'admin')
on conflict (user_id) do update
set role = 'admin';

-- ==========================================
-- 9. Common updated_at trigger helper
-- ==========================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==========================================
-- 10. Trading backend runtime tables
-- ==========================================

create table if not exists public.trades (
  id bigint generated by default as identity primary key,
  exchange text not null default 'binance',
  symbol text not null,
  timeframe text not null default 'tick',
  side text not null check (side in ('long', 'short')),
  entry_ts timestamptz not null,
  entry_price numeric not null,
  qty numeric not null,
  tp_price numeric,
  sl_price numeric,
  status text not null default 'open' check (status in ('open', 'closed', 'canceled', 'error')),
  exchange_order_ids jsonb,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trades_symbol_status_entry_ts
  on public.trades (symbol, status, entry_ts desc);

drop trigger if exists trg_trades_updated_at on public.trades;
create trigger trg_trades_updated_at
before update on public.trades
for each row
execute function public.set_updated_at();

create table if not exists public.candles (
  id bigint generated by default as identity primary key,
  exchange text not null,
  symbol text not null,
  timeframe text not null,
  ts timestamptz not null,
  open numeric not null,
  high numeric,
  low numeric,
  close numeric not null,
  volume numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (exchange, symbol, timeframe, ts)
);

create index if not exists idx_candles_lookup
  on public.candles (exchange, symbol, timeframe, ts desc);

create table if not exists public.bot_state (
  exchange text not null,
  symbol text not null,
  timeframe text not null,
  last_ts timestamptz,
  updated_at timestamptz not null default now(),
  primary key (exchange, symbol, timeframe)
);

drop trigger if exists trg_bot_state_updated_at on public.bot_state;
create trigger trg_bot_state_updated_at
before update on public.bot_state
for each row
execute function public.set_updated_at();

create table if not exists public.trading_engine_configs (
  id text primary key,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_trading_engine_configs_updated_at on public.trading_engine_configs;
create trigger trg_trading_engine_configs_updated_at
before update on public.trading_engine_configs
for each row
execute function public.set_updated_at();

-- ==========================================
-- 11. Distributed locks and news dedup history
-- ==========================================

create table if not exists public.distributed_locks (
  name text primary key,
  owner_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_distributed_locks_updated_at on public.distributed_locks;
create trigger trg_distributed_locks_updated_at
before update on public.distributed_locks
for each row
execute function public.set_updated_at();

create table if not exists public.news_sentiment (
  id bigint generated by default as identity primary key,
  guild_id text,
  title text not null,
  link text not null,
  event_signature text,
  sentiment_score numeric,
  created_at timestamptz not null default now()
);

alter table public.news_sentiment add column if not exists guild_id text;
alter table public.news_sentiment add column if not exists title text;
alter table public.news_sentiment add column if not exists link text;
alter table public.news_sentiment add column if not exists event_signature text;
alter table public.news_sentiment add column if not exists sentiment_score numeric;
alter table public.news_sentiment add column if not exists created_at timestamptz not null default now();

create index if not exists idx_news_sentiment_guild_created_at
  on public.news_sentiment (guild_id, created_at desc);

create index if not exists idx_news_sentiment_event_signature
  on public.news_sentiment (event_signature);

-- ==========================================
-- 12. Distributed API rate limiting
-- ==========================================

create table if not exists public.api_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  hit_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists idx_api_rate_limits_window_end
  on public.api_rate_limits (window_end);

create or replace function public.acquire_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_max integer
)
returns table (
  allowed boolean,
  current_count integer,
  retry_after_sec integer
)
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into public.api_rate_limits (bucket_key, window_start, window_end, hit_count, updated_at)
  values (p_key, p_window_start, p_window_end, 1, now())
  on conflict (bucket_key, window_start)
  do update
    set hit_count = public.api_rate_limits.hit_count + 1,
        window_end = excluded.window_end,
        updated_at = now()
  returning hit_count into v_count;

  allowed := v_count <= greatest(1, p_max);
  current_count := v_count;
  retry_after_sec := greatest(1, ceil(extract(epoch from (p_window_end - now())))::integer);
  return next;
end;
$$;

-- ==========================================
-- 13. Multi-agent sessions and long memory
-- ==========================================

create table if not exists public.guild_lore_docs (
  id bigint generated by default as identity primary key,
  guild_id text not null,
  title text not null,
  summary text,
  content text,
  source text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_guild_lore_docs_guild_updated_at
  on public.guild_lore_docs (guild_id, updated_at desc);

create table if not exists public.agent_sessions (
  id text primary key,
  guild_id text not null,
  requested_by text not null,
  goal text not null,
  priority text not null default 'balanced',
  requested_skill_id text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  result text,
  error text
);

create index if not exists idx_agent_sessions_guild_updated_at
  on public.agent_sessions (guild_id, updated_at desc);

alter table if exists public.agent_sessions
  add column if not exists priority text not null default 'balanced';

drop trigger if exists trg_agent_sessions_updated_at on public.agent_sessions;
create trigger trg_agent_sessions_updated_at
before update on public.agent_sessions
for each row
execute function public.set_updated_at();

create table if not exists public.agent_steps (
  id text primary key,
  session_id text not null references public.agent_sessions(id) on delete cascade,
  role text not null,
  title text not null,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  output text,
  error text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_steps_session_updated_at
  on public.agent_steps (session_id, updated_at desc);
