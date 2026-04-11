# Supabase Migration Checklist

Apply this checklist when enabling Muel server-ops runtime tables.

## 1. Pre-check

- Confirm project env has valid `SUPABASE_URL` and `SUPABASE_KEY`.
- Back up critical tables if running on production.
- Ensure no long-running write-heavy jobs are active during migration.
- Confirm which ledger you are validating:
  - Supabase native migration history
  - `public.schema_migrations` used by the app health check

## 2. Run Schema Script

- Open Supabase SQL Editor.
- Execute [docs/SUPABASE_SCHEMA.sql](docs/SUPABASE_SCHEMA.sql).
- Execute [docs/MIGRATION_AUTONOMY_REPORTING_BASELINE.sql](docs/MIGRATION_AUTONOMY_REPORTING_BASELINE.sql).
- Execute [docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql](docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql).
- Execute [docs/MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES.sql](docs/MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES.sql).
- Execute [docs/MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION.sql](docs/MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION.sql).
- Verify no fatal errors.

## 3. Verify New Tables

Run quick checks:

- `select count(*) from public.agent_privacy_policies;`
- `select count(*) from public.agent_privacy_gate_samples;`
- `select count(*) from public.agent_llm_call_logs;`
- `select count(*) from public.agent_weekly_reports;`
- `select count(*) from public.memory_jobs;`
- `select count(*) from public.memory_job_deadletters;`

Expected: queries succeed (counts may be 0 initially).

## 4. Verify Index/Trigger

- Check `idx_guild_lore_docs_guild_updated_at` exists.
- Check `idx_agent_sessions_guild_updated_at` exists.
- Check `idx_agent_steps_session_updated_at` exists.
- Check `idx_agent_weekly_reports_kind_created` exists.
- Check `idx_agent_llm_call_logs_guild_created` exists.
- Check `idx_agent_conversation_threads_last_session_id` exists.
- Check `idx_memory_conflicts_item_a_id` exists.
- Check `idx_memory_conflicts_item_b_id` exists.
- Check `idx_memory_jobs_status_next_attempt` exists.
- Check `idx_memory_job_deadletters_recovery` exists.
- Check `trg_agent_sessions_updated_at` exists.
- Check `trg_agent_weekly_reports_updated_at` exists.

5.  Confirm `public.agent_privacy_gate_samples` has decision audit rows for new task sessions.

- Check `idx_discord_login_sessions_expires_at` exists.
- Check `trg_discord_login_sessions_updated_at` exists.
- Check `public.schema_migrations` contains `MIGRATION_AUTONOMY_REPORTING_BASELINE` when the tracking table exists.
- Check `public.schema_migrations` contains `MIGRATION_SUPABASE_HYGIENE_PHASE1` when the tracking table exists.
- Check `public.schema_migrations` contains `MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES` when the tracking table exists.
- Check `public.schema_migrations` contains `MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION` when the tracking table exists.

## 4-0. Verify Weekly Reporting Alignment

- Confirm `agent_weekly_reports_report_kind_check` allows `self_improvement_patterns`, `jarvis_optimize_result`, `cross_loop_origin`, and `convergence_report`.
- Confirm `memory_job_deadletters_job_type_check` allows `onboarding_snapshot` and `consolidation`.

## 4-1. Verify Policy Cleanup

- Confirm `memory_items_guild_write` no longer exists.
- Confirm `memory_items_guild_insert`, `memory_items_guild_update`, and `memory_items_guild_delete` exist.
- Confirm `intents_service_role_all` is not defined with `USING (true)`.
- Confirm `trust_scores_service_role_all` is not defined with `USING (true)`.
- Confirm only one `ventyd_events_service_role` policy remains on `public.ventyd_events`.
- Confirm `query_log_write` requires `service_role` on `public.obsidian_query_log`.
- Confirm `api_idempotency_keys_service_role_all`, `api_rate_limits_service_role_all`, `discord_login_sessions_service_role_all`, `distributed_locks_service_role_all`, `schema_migrations_service_role_all`, and `agent_telemetry_queue_tasks_service_role_all` exist.
- Confirm `user can manage own prefs` no longer exists on `public.user_learning_prefs`.
- Confirm `user_learning_prefs_service_role_all` exists on `public.user_learning_prefs`.
- Confirm `agent_sessions_service_role_all`, `agent_steps_service_role_all`, `sources_service_role_all`, `users_service_role_all`, and `guild_lore_docs_service_role_all` exist.
- Confirm `obsidian_cache_service_role_all` exists and `cache_read` no longer exists on `public.obsidian_cache`.
- Confirm there are zero `rls_enabled_no_policy` tables in `public`.
- Confirm there are zero policies left with `USING (true)` or `WITH CHECK (true)` in `public`.

## 4-2. Verify Function Hardening

- Re-run Supabase security advisors and confirm the mutable `search_path` count decreased.
- Spot-check `public.set_updated_at`, `public.acquire_rate_limit`, and `public.search_memory_items_hybrid` for explicit `search_path` settings.

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
- Do not drop unused indexes in the same change window as policy cleanup.
