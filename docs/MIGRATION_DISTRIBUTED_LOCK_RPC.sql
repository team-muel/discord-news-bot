-- Migration: Atomic distributed lease acquisition via RPC
-- Replaces the TOCTOU-vulnerable two-step UPDATE -> INSERT pattern
-- with a single INSERT ... ON CONFLICT ... DO UPDATE ... WHERE statement.
--
-- Apply BEFORE deploying the code that calls this function.
-- The code includes a legacy fallback, so deploying code first is safe but suboptimal.

create or replace function public.acquire_distributed_lease(
  p_name text,
  p_owner text,
  p_lease_ms integer
)
returns boolean
language plpgsql
as $$
declare
  v_lease_until timestamptz := now() + make_interval(secs => greatest(5000, p_lease_ms) / 1000.0);
begin
  -- Single atomic statement: INSERT if new, UPDATE if unlocked/expired/re-entrant.
  -- PostgreSQL row-level locking ensures only one concurrent caller succeeds.
  insert into public.distributed_locks (name, owner_token, expires_at, updated_at)
  values (p_name, p_owner, v_lease_until, now())
  on conflict (name) do update
    set owner_token = p_owner,
        expires_at  = v_lease_until,
        updated_at  = now()
    where
      distributed_locks.owner_token is null
      or distributed_locks.expires_at < now()
      or distributed_locks.owner_token = p_owner;

  return found;
end;
$$;
