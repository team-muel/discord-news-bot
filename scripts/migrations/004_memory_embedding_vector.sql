-- Migration: Add pgvector embedding column to memory_items for semantic search
-- Requires: CREATE EXTENSION IF NOT EXISTS vector; (already in base schema)
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE)

-- 1. Add embedding column (1536-dim for text-embedding-3-small, 0-fill allowed)
alter table public.memory_items
  add column if not exists embedding vector(1536);

-- 2. Create HNSW index for fast approximate nearest-neighbor search
create index if not exists idx_memory_items_embedding_cosine
  on public.memory_items
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- 3. Composite index: guild + embedding for filtered vector search
create index if not exists idx_memory_items_guild_embedding
  on public.memory_items (guild_id)
  where embedding is not null;

-- 4. Upgraded hybrid search RPC: combines vector similarity + lexical (pg_trgm)
create or replace function public.search_memory_items_hybrid(
  p_guild_id text,
  p_query text,
  p_type text default null,
  p_limit integer default 10,
  p_min_similarity real default 0.08,
  p_query_embedding vector(1536) default null
)
returns table (
  id text,
  guild_id text,
  channel_id text,
  type text,
  title text,
  content text,
  summary text,
  confidence numeric,
  pinned boolean,
  updated_at timestamptz,
  status text,
  lexical_score real,
  vector_score real
)
language sql
stable
as $$
  with scored as (
    select
      m.id,
      m.guild_id,
      m.channel_id,
      m.type,
      m.title,
      m.content,
      m.summary,
      m.confidence,
      m.pinned,
      m.updated_at,
      m.status,
      greatest(
        similarity(coalesce(m.title, ''), coalesce(p_query, '')),
        similarity(coalesce(m.summary, ''), coalesce(p_query, '')),
        similarity(coalesce(m.content, ''), coalesce(p_query, ''))
      )::real as lexical_score,
      case
        when p_query_embedding is not null and m.embedding is not null
        then (1.0 - (m.embedding <=> p_query_embedding))::real
        else 0.0
      end as vector_score
    from public.memory_items m
    where m.guild_id = p_guild_id
      and m.status = 'active'
      and (p_type is null or m.type = p_type)
  )
  select *
  from scored
  where
    coalesce(p_query, '') = ''
    or lexical_score >= greatest(0, least(1, coalesce(p_min_similarity, 0.08)))
    or vector_score >= 0.25
    or coalesce(title, '') ilike ('%' || coalesce(p_query, '') || '%')
    or coalesce(summary, '') ilike ('%' || coalesce(p_query, '') || '%')
    or coalesce(content, '') ilike ('%' || coalesce(p_query, '') || '%')
  order by
    pinned desc,
    -- Blend: 40% vector + 40% lexical + 20% recency proxy via confidence
    (coalesce(vector_score, 0) * 0.4 + coalesce(lexical_score, 0) * 0.4 + coalesce(confidence, 0.5)::real * 0.2) desc,
    updated_at desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;
