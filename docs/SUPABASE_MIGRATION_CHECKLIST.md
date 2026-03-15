# Supabase Migration Checklist

Apply this checklist when enabling Muel server-ops runtime tables.

## 1. Pre-check

- Confirm project env has valid `SUPABASE_URL` and `SUPABASE_KEY`.
- Back up critical tables if running on production.
- Ensure no long-running write-heavy jobs are active during migration.

## 2. Run Schema Script

- Open Supabase SQL Editor.
- Execute [docs/SUPABASE_SCHEMA.sql](docs/SUPABASE_SCHEMA.sql).
- Verify no fatal errors.

## 3. Verify New Tables

Run quick checks:

- `select count(*) from public.agent_privacy_policies;`
- `select count(*) from public.agent_privacy_gate_samples;`

Expected: queries succeed (counts may be 0 initially).

## 4. Verify Index/Trigger

- Check `idx_guild_lore_docs_guild_updated_at` exists.
- Check `idx_agent_sessions_guild_updated_at` exists.
- Check `idx_agent_steps_session_updated_at` exists.
- Check `trg_agent_sessions_updated_at` exists.

5.  Confirm `public.agent_privacy_gate_samples` has decision audit rows for new task sessions.

- Check `idx_discord_login_sessions_expires_at` exists.
- Check `trg_discord_login_sessions_updated_at` exists.

## 5. Runtime Smoke Test

- `GET /api/bot/agent/privacy/policy?guildId=<guildId>`
- `GET /api/bot/agent/privacy/tuning/recommendation?guildId=<guildId>`

3. Confirm session appears in `public.agent_sessions` and steps in `public.agent_steps`.
4. Confirm `public.agent_sessions.shadow_graph_summary` and `public.agent_sessions.progress_summary` are populated for the latest run.
5. Run `/상태` and confirm response renders normally.

## 5-1. Login Session Persistence Smoke Test

1. In a guild channel, run `/로그인` with a non-admin account.
2. Run `/구독` add/remove flow once to confirm access is granted.
3. Restart backend process.
4. Run `/구독` add/remove again without re-running `/로그인`.
5. Confirm access still works and row exists in `public.discord_login_sessions`.

## 6. Ops Endpoints Smoke Test

- `GET /api/bot/agent/policy`
- `POST /api/bot/agent/onboarding/run` with `guildId`
- `POST /api/bot/agent/learning/run` with optional `guildId`

Expected: 202/200 responses with structured payload.

## 7. Rollback Strategy

- Disable auto background loops temporarily:
  - `AGENT_AUTO_ONBOARDING_ENABLED=false`
  - `AGENT_DAILY_LEARNING_ENABLED=false`
- Keep tables intact (prefer feature toggle rollback before destructive SQL changes).
