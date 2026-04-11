# Supabase Hygiene Execution Plan

Status: M1, M2-A, M2-B, and M2-D applied to current connected project; M4 code support landed, rollout still pending
Date: 2026-04-11

## Objective

Bring the current Supabase project back to a predictable baseline before exposing any team-shared Supabase MCP surface.

## Non-Goals

- Do not move the app runtime from direct SDK access to MCP.
- Do not drop unused indexes during phase 1.
- Do not solve every existing RLS ownership question in one migration.
- Do not expose DDL-capable Supabase MCP tools to a shared team surface yet.

## Current State Summary

- App runtime uses direct SDK access via src/services/supabaseClient.ts.
- Shared MCP proxy code exists, but runtime wiring for upstream Supabase is absent because MCP_UPSTREAM_SERVERS is not configured.
- Live DB hygiene is the bottleneck, not missing client plumbing.
- Broader audit showed that some repo-visible schema narration had also drifted: canonical sections for reward/eval/workflow tables were older than the applied live migration shapes.
- public.schema_migrations and Supabase native migration history are different ledgers and currently diverge.

## Target State

### Database

- High-risk permissive RLS policies are normalized.
- Known mutable search_path functions are pinned.
- Live missing FK indexes are added.
- The repo has a clear, named SQL cleanup slice for repeatable application.

### Runtime

- App runtime remains on direct SDK access for operational writes.
- Shared Supabase MCP, when introduced later, is read-only and analytics-focused.

### Team Access

- Team-shared Supabase MCP is blocked behind explicit tool filtering or a dedicated read-only proxy.
- No shared token is mounted into the current upstream proxy until the proxy can hide write-capable tools.

## Milestones

### M0. Inventory and Baseline

Entry criteria:

- live advisor output collected
- live schema_migrations state collected
- runtime wiring verified

Exit criteria:

- [docs/SUPABASE_CLEANUP_INVENTORY.md](docs/SUPABASE_CLEANUP_INVENTORY.md) exists and is current

### M1. Safe Hygiene Phase 1

Scope:

- memory_items policy split and auth initplan cleanup
- intents and agent_trust_scores service-role policy hardening
- obsidian_query_log policy tightening
- ventyd_events duplicate policy cleanup
- mutable search_path pinning
- missing FK indexes

Exit criteria:

- [docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql](docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql) is ready
- migration checklist references the new phase
- repo migration registry knows about the new migration name

Current observed status on the connected Supabase project:

- completed on 2026-04-11 via native migration `supabase_hygiene_phase1`
- custom ledger row `MIGRATION_SUPABASE_HYGIENE_PHASE1` recorded in `public.schema_migrations`
- post-apply advisor snapshot dropped `function_search_path_mutable` to zero and removed `multiple_permissive_policies`

### M2. RLS Ownership Normalization

Scope:

- resolve 33 RLS-enabled tables with no policies
- normalize broader auth.jwt/auth.role policy templates across memory and agent tables

Exit criteria:

- table ownership matrix exists
- remaining public-role policies are explicit and intentional

Current working split after runtime review:

#### M2-A. Runtime service tables

- `api_idempotency_keys`, `api_rate_limits`, `discord_login_sessions`, `distributed_locks`, `schema_migrations`, `agent_telemetry_queue_tasks`
- Candidate policy shape: `service_role` only
- Why first: the current runtime already uses these through server-side SDK or RPC paths, so the blast radius is small and the ownership model is already implicit.

Current observed status on the connected Supabase project:

- completed on 2026-04-11 via native migration `supabase_hygiene_phase2_runtime_service_policies`
- custom ledger row `MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES` recorded in `public.schema_migrations`
- live policyless-RLS table count reduced from 33 to 27 after this slice
- `user_learning_prefs` was closed as a low-risk fast-follow in the same window because the current runtime path is already server-side only

#### M2-B. Runtime domain tables

- `agent_sessions`, `agent_steps`, `sources`, `users`, `guild_lore_docs`
- Candidate policy shape:
  - `agent_sessions`, `agent_steps`, `sources`, `guild_lore_docs`: guild-aware or `service_role` only depending on whether any future direct client path is intended
  - `users`: likely `service_role` only until a real JWT-backed self-service contract exists
- Why second: these are live paths, but they touch product semantics rather than pure operator infrastructure.

Current observed status on the connected Supabase project:

- completed on 2026-04-11 via native migration `supabase_hygiene_phase3_policy_completion`
- custom ledger row `MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION` recorded in `public.schema_migrations`
- `agent_sessions`, `agent_steps`, `sources`, `users`, and `guild_lore_docs` now all have explicit `service_role`-only policies
- future guild/user-scoped reopening is now a product decision, not a hygiene gap

#### M2-C. Ownership-heavy domain families

- Community graph tables
- Agent learning, GOT, tool-learning, and policy tables
- Retrieval, evaluation, reward, and review tables
- Entity and observation tables
- Candidate policy shape: unresolved until owners decide guild-scoped vs operator-global vs analytics-global boundaries

#### M2-D. Legacy and retirement tables

- Trading, macro, news-analysis, legacy logging, and preset tables that do not drive the current product runtime
- Candidate action: explicit operator-only lock-down or retirement plan

Current observed status on the connected Supabase project:

- completed on 2026-04-11 via the same `supabase_hygiene_phase3_policy_completion` slice
- remaining policyless legacy/operator tables were closed as explicit `service_role`-only tables
- the next move for this family is retirement review, not emergency policy addition

User preference fast-follow:

- completed on 2026-04-11 as part of the runtime-service policy slice
- `user_learning_prefs` now uses `user_learning_prefs_service_role_all`
- re-open only if the intended product direction changes to direct JWT-backed self-service access

### M3. Index Retirement and Perf Follow-Up

Scope:

- validate unused-index candidates against real workload windows
- remove only indexes with a documented observation window and rollback note

Exit criteria:

- unused-index cleanup is backed by measurements, not just lint output

### M4. Shared Read-Only Supabase MCP

Scope:

- expose read-only Supabase diagnostics to the team through shared MCP
- keep operational writes and migrations out of the shared surface

Current code status:

- completed on 2026-04-11 in `src/mcp/proxyRegistry.ts` and `src/mcp/proxyAdapter.ts`
- upstream configs now support `toolAllowlist` and `toolDenylist` wildcard filters against original upstream tool names

Operational rollout still required:

- curate the exact read-only Supabase tool allowlist
- add the filtered `supabase_ro` entry to `MCP_UPSTREAM_SERVERS`
- keep any write or DDL-capable namespace in a separate admin-only surface if needed

Recommended shared shape after filtering exists:

```env
MCP_UPSTREAM_SERVERS=[
  {
    "id":"supabase-ro",
    "url":"https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF",
    "namespace":"supabase_ro",
    "token":"sbp_xxx",
    "protocol":"streamable",
    "enabled":true,
    "toolAllowlist":["get_*","list_*","*_advisors","*_migrations","*_branches","*_logs"]
  }
]
```

Recommended tool contract after filtering exists:

- allow diagnostics only: schema introspection, advisor reads, migration list, extension list, logs
- deny direct DDL and raw write paths on the shared team surface
- keep write-capable Supabase access in operator-only workflows

## Risks

- Tightening policies can break undocumented direct client access if such clients exist outside the repo.
- Search-path pinning can surface latent unqualified references in manually created functions.
- Index additions are low risk, but unused-index deletion is not; keep that out of phase 1.

## Rollback

- Policy rollback: restore the prior policy set from repo history or export before apply.
- Function rollback: remove pinned search_path only if a function proves dependent on implicit resolution.
- Index rollback: drop only the new phase 1 indexes if they cause unexpected write amplification.

## Recommended Next Step After This Slice

Use the M2-A and M2-B split above to decide the next SQL slice. The cleanest next move is to harden runtime service tables first, then either pull `user_learning_prefs` into that slice as `service_role` only or leave it pending until a JWT-backed self-service contract is designed. Keep shared Supabase MCP blocked until proxy-side tool filtering or a dedicated read-only ingress exists.