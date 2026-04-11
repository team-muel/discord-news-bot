# Supabase Cleanup Inventory

Status: 2026-04-11 snapshot

Purpose: establish the real database state before enabling any team-shared Supabase MCP surface.

## Post-Apply Snapshot

Phase 1, the low-ambiguity phase 2 runtime-service policy slice, and the phase 3 policy-completion slice were applied to the currently connected Supabase project on 2026-04-11.

- Supabase native migration history now includes `supabase_hygiene_phase1`.
- Supabase native migration history now includes `supabase_hygiene_phase2_runtime_service_policies`.
- Supabase native migration history now includes `supabase_hygiene_phase3_policy_completion`.
- `public.schema_migrations` now includes `MIGRATION_SUPABASE_HYGIENE_PHASE1`.
- `public.schema_migrations` now includes `MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES`.
- `public.schema_migrations` now includes `MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION`.
- Live policy verification confirms:
	- `memory_items_guild_write` removed and replaced by split insert/update/delete policies
	- `intents_service_role_all` no longer uses `USING (true)`
	- `trust_scores_service_role_all` no longer uses `USING (true)`
	- `obsidian_query_log` read/write now require `service_role`
	- duplicate `ventyd_events` policy removed
	- `api_idempotency_keys`, `api_rate_limits`, `discord_login_sessions`, `distributed_locks`, `schema_migrations`, and `agent_telemetry_queue_tasks` now have explicit `service_role`-only policies
	- `user_learning_prefs` no longer exposes the permissive `user can manage own prefs` policy and now uses `user_learning_prefs_service_role_all`
	- `agent_sessions`, `agent_steps`, `sources`, `users`, `guild_lore_docs`, and the remaining legacy/operator tables now have explicit `service_role`-only policies
	- `obsidian_cache` is no longer world-readable; it now uses `obsidian_cache_service_role_all`
- Live index verification confirms all 12 phase-1 covering FK indexes were created.

### Advisor Delta

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| Security advisors | 54 | 34 | -20 |
| function_search_path_mutable | 17 | 0 | -17 |
| rls_policy_always_true | 4 | 1 | -3 |
| Performance advisors | 211 | 186 | -25 |
| multiple_permissive_policies | 25 | 0 | -25 |
| unindexed_foreign_keys | 15 | 3 | advisor still reports 3, but direct catalog query returned 0 live missing FK indexes |

Remaining high-signal items after phase 3 policy completion:

- Direct catalog verification shows `rls_enabled_no_policy` is now `0` for `public`.
- Direct catalog verification shows policies with `USING (true)` or `WITH CHECK (true)` are now `0` for `public`.
- 68 `auth_rls_initplan` findings remain across broader memory and agent policy families.
- `unused_index` lint count increased after adding safe covering indexes; this should not be treated as a rollback signal without workload observation.
- Full advisor totals were not re-collected after phase 3; post-phase-3 claims in this doc are based on direct policy catalog queries.

## Broader Drift Audit Findings

- Live table presence is not the main drift. The audited reward/eval/workflow/privacy/runtime-service families all exist in the connected project.
- The main remaining gaps are repo-side narration, future selective reopening decisions, and shared-MCP rollout curation rather than missing live policy coverage.
- `docs/SUPABASE_SCHEMA.sql` sections 25-27 had lagged behind the live migration 005/007 shapes for `reward_signal_snapshots`, `eval_ab_runs`, `shadow_graph_divergence_logs`, `workflow_sessions`, `workflow_steps`, `workflow_events`, and `traffic_routing_decisions`.
- `docs/MIGRATIONS_APPLY_ALL.sql` had stopped before the named `MIGRATION_AUTONOMY_REPORTING_BASELINE` slice; the bundle was updated to carry the post-bootstrap tracked migrations too.

## Ownership Triage Snapshot

The remaining tables do not share the same risk profile. The next slice should start from the tables the runtime already exercises through direct service-role SDK calls.

### Runtime service tables: lowest ambiguity

- Closed on 2026-04-11 for `api_idempotency_keys`, `api_rate_limits`, `discord_login_sessions`, `distributed_locks`, `schema_migrations`, `agent_telemetry_queue_tasks`, and `user_learning_prefs`
- The adjacent runtime-domain slice was also closed on 2026-04-11 for `agent_sessions`, `agent_steps`, `sources`, `users`, and `guild_lore_docs`
- Representative runtime paths:
	- `src/services/agent/agentSessionStore.ts`
	- `src/middleware/idempotency.ts`
	- `src/services/infra/supabaseRateLimitService.ts`
	- `src/services/discord-support/discordLoginSessionStore.ts`
	- `src/services/infra/distributedLockService.ts`
	- `src/routes/auth.ts`
	- `src/routes/bot.ts`
	- `src/discord/runtime/botRuntimeState.ts`
	- `src/services/userLearningPrefsService.ts`
- The service-table subset above was the safest M2 fast-follow because the current app runtime already reaches them through server-side direct SDK access rather than a user JWT client.

### Active domain tables: ownership-heavy

- `guild_lore_docs`
- Community graph tables and relationship data
- Agent learning, GOT, and tool-learning tables
- Retrieval and evaluation tables
- Entity, observation, and reward-signal tables
- These families already had explicit policies before phase 3. The remaining work here is no longer "add a missing policy" but "decide whether any currently service-mediated contract should later be selectively reopened with guild/user-scoped reads or writes".

### Legacy, analytics, or low-signal tables: operator-only until proven needed

- `alert_slots`, `bot_state`, `candles`, `error_history`, `logs`, `macro_data`, `macro_series`, `market_regime`, `news_capture_fingerprints`, `news_sentiment`, `obsidian_metadata`, `research_preset_audit`, `research_presets`, `settings`, `system_error_events`, `system_telemetry`, `trades`, `trading_engine_configs`, `trading_signals`, `user_embeddings`, `user_roles`, `youtube_log`
- These were closed in phase 3 as explicit `service_role`-only tables. The remaining decision is retirement, not missing ownership.

### user_learning_prefs note

- The live runtime path does not currently depend on client JWT access for this table. Reads and writes go through `src/services/userLearningPrefsService.ts`, which is called from Discord command and interaction flows.
- That made the `service_role`-only phase 2 closure operationally safe for the current app.
- Re-open this boundary only if a future direct JWT-backed self-service contract is intentionally introduced.

## Runtime Split

- App runtime currently talks to Supabase directly through @supabase/supabase-js and src/services/supabaseClient.ts.
- Unified MCP supports upstream Supabase proxying, but the runtime does not load MCP_UPSTREAM_SERVERS today.
- Local runtime env currently has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY present, MCP_UPSTREAM_SERVERS absent, and MCP_SHARED_MCP_URL present only for shared Obsidian/indexing surfaces.

## Migration Ledgers

There are two different migration ledgers in play, plus one repo-side registry contract.

| Surface | Current state | Meaning | Risk |
| --- | --- | --- | --- |
| Supabase native migration history | 5 latest visible entries include `012_intent_formation`, `supabase_hygiene_phase1`, `autonomy_reporting_baseline`, `supabase_hygiene_phase2_runtime_service_policies`, `supabase_hygiene_phase3_policy_completion` | Platform migration history returned by Supabase MCP | Still distinct from repo-local ledger semantics |
| public.schema_migrations | 11 rows | Repo-local SQL history used by app health checks | Still diverges from native Supabase ledger |
| src/utils/migrationRegistry.ts KNOWN_MIGRATIONS | 10 tracked names | Repo contract for startup validation | Tracks the repo-visible named slices, not every historical DB row |

## Drift Confirmed

- public.schema_migrations exists and is populated.
- Repo runtime validation and Supabase native migration history are not the same ledger.
- The DB contains OBSIDIAN_HEADLESS_MIGRATION_POLICIES in public.schema_migrations, but no matching source SQL file exists in the repo.
- Source SQL still contains permissive or overlapping policies that match live advisor findings.
- Shared Supabase MCP is not wired into runtime today, so cleanup still targets the direct SDK path first.
- Upstream tool filtering now exists in `src/mcp/proxyRegistry.ts` and `src/mcp/proxyAdapter.ts`; shared rollout is no longer blocked by missing code support, only by allowlist curation and env rollout.

## Advisor Snapshot

| Category | Count | Notes |
| --- | --- | --- |
| Security advisors | 54 | 33 rls_enabled_no_policy, 17 function_search_path_mutable, 4 rls_policy_always_true |
| Performance advisors | 211 | 102 unused_index, 68 auth_rls_initplan, 25 multiple_permissive_policies, 15 unindexed_foreign_keys, 1 duplicate_index |

Notes:

- A direct catalog query identified 12 currently missing covering FK indexes in public; this is the authoritative list used for phase 1.
- The security and performance lint totals are high enough that Supabase hygiene should happen before any shared team MCP exposure.

## High-Priority Findings

### Policy shape

- public.memory_items has a SELECT policy plus an ALL policy, which creates multiple permissive policy findings and repeated auth function evaluation per row.
- public.intents and public.agent_trust_scores both use service-role policies defined as USING (true) / WITH CHECK (true).
- public.obsidian_query_log allows unrestricted inserts and world-readable selects in the source migration path.
- public.ventyd_events has duplicate service-role policies in the live DB.

### Function hardening

The following functions have mutable search_path today and need explicit pinning:

- public.set_updated_at
- public.acquire_rate_limit
- public.increment_obsidian_cache_hit
- public.cleanup_discord_login_sessions
- public.clear_expired_obsidian_cache
- public.get_platform_hypopg_candidates
- public.acquire_distributed_lease
- public.track_user_activity
- public.ensure_pg_cron_job
- public.get_platform_extension_status
- public.cleanup_agent_llm_call_logs
- public.cleanup_api_idempotency_keys
- public.update_intents_updated_at
- public.log_source_error
- public.search_memory_items_hybrid (two overloads)
- public.delete_orphaned_source

### Missing FK indexes

Phase 1 adds covering indexes for these live gaps:

- agent_conversation_threads.last_session_id
- agent_got_selection_events.candidate_node_id
- agent_opencode_change_requests.source_action_log_id
- agent_tool_learning_rules.source_candidate_id
- alert_slots.user_id
- error_history.source_id
- logs.user_id
- memory_conflicts.item_a_id
- memory_conflicts.item_b_id
- retrieval_eval_runs.eval_set_id
- retrieval_ranker_experiments.run_id
- sources.user_id

## Phase 1 Scope

The first cleanup slice is intentionally limited to safe, low-ambiguity fixes:

- normalize the highest-risk RLS policies
- remove the known ventyd_events duplicate policy
- pin search_path on the current mutable-function set
- add the live missing covering FK indexes
- track the cleanup as MIGRATION_SUPABASE_HYGIENE_PHASE1

Phase 1 migration source: [docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql](docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql)

Execution plan: [docs/planning/SUPABASE_HYGIENE_EXECUTION_PLAN.md](docs/planning/SUPABASE_HYGIENE_EXECUTION_PLAN.md)

## Deferred After Phase 1

- RLS ownership design for the 33 tables that have RLS enabled but no policies
- unused index retirement after a real observation window and pg_stat review
- remaining auth_rls_initplan findings across other memory and agent tables
- cleanup of repo/source migration drift around OBSIDIAN_HEADLESS_MIGRATION_POLICIES
- shared read-only Supabase MCP wiring after upstream tool filtering exists