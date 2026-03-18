# Architecture Changelog

Use this log for architecture-significant changes only.

## Template

Copy this block for each change:

```text
## YYYY-MM-DD - <change title>
- Why: <problem or risk being addressed>
- Scope: <modules/routes/services affected>
- Impacted Routes: <list or N/A>
- Impacted Services: <list>
- Impacted Tables/RPC: <list>
- Risk/Regression Notes: <key behavior changes>
- Validation: <tests/smoke commands run>
```

## Entries

## 2026-03-18 - Agent Route Domain Split Completion and Verification Gates

- Why: Complete `/api/bot/agent/*` domain-level route decomposition safely and prevent regressions from future route movement.
- Scope: moved agent route implementations into `src/routes/bot-agent/*Routes.ts`, converted `src/routes/botAgentRoutes.ts` to composer-only registration, added modular route verification script and route smoke tests, and updated route inventory generator to include nested route files.
- Impacted Routes: `/api/bot/agent/*` (no contract change; source files moved from monolithic module to domain modules).
- Impacted Services: `src/routes/botAgentRoutes.ts`, `src/routes/bot-agent/coreRoutes.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/bot-agent/gotRoutes.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `src/routes/bot-agent/memoryRoutes.ts`, `src/routes/bot-agent/learningRoutes.ts`, `scripts/verify-bot-agent-routes.mjs`, `scripts/generate-route-inventory.mjs`.
- Impacted Tables/RPC: N/A (routing surface and tooling only).
- Risk/Regression Notes: route registration ordering is now explicitly module-driven; duplicate path registration is gate-checked by script and smoke test.
- Validation: `npm run routes:check:agent`, `npm run docs:routes`, `npm run test -- src/routes/botAgentRoutes.smoke.test.ts`, `npm run lint`.

## 2026-03-18 - Bot Route Modularization and Runtime Bootstrap Consolidation

- Why: Reduce control-plane complexity by splitting oversized bot route composition, clarifying startup boundaries, and lowering env misconfiguration risk.
- Scope: extracted `/api/bot/agent/*` route registration to dedicated module, introduced centralized runtime bootstrap service, and added deployment-profile-based env validation.
- Impacted Routes: `/api/bot/agent/*` (no contract change, composition moved), `/api/bot/status`, `/api/bot/automation/:jobName/run`, `/api/bot/reconnect`, `/api/bot/usage`.
- Impacted Services: `src/routes/bot.ts`, `src/routes/botAgentRoutes.ts`, `src/services/runtimeBootstrap.ts`, `src/discord/runtime/readyWorkloads.ts`, `server.ts`, `scripts/validate-env.mjs`.
- Impacted Tables/RPC: N/A (no schema/rpc contract changes).
- Risk/Regression Notes: API behavior is preserved, but route registration order is now split across modules; startup loops are orchestrated through one bootstrap surface to avoid duplicate starts.
- Validation: `npm run lint`.

## 2026-03-18 - Gate Log Robustness Hardening (JSON Sidecar + Legacy-safe Summary)

- Why: Prevent weekly gate summary corruption from legacy placeholder values and improve machine-readable operability of go/no-go run logs.
- Scope: go/no-go log generator now writes paired markdown+json outputs; weekly summary parser now prefers json, normalizes legacy placeholders, and sanitizes table cells.
- Impacted Routes: N/A
- Impacted Services: N/A (ops scripting and governance reporting only)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Existing markdown logs remain compatible; legacy entries are normalized as `pending/unknown` instead of producing malformed rows.
- Validation: `npm run gates:init-log -- --stage=A --scope=guild:demo --operator=auto --decision=go`, `npm run gates:weekly-report -- --days=7`, `npm run test:contracts`, `npm run contracts:validate`, `npm run lint`.

## 2026-03-18 - Full Session-Allowlist Execution (Automation Completion)

- Why: Execute all approved follow-up actions from the session end-to-end: weekly gate reporting, schema-to-test integration, and no-go rollback autofill.
- Scope: added gate-run weekly summary script, added autonomy contract schema test, enhanced go/no-go log generator with decision-aware rollback autofill, and wired npm commands.
- Impacted Routes: N/A
- Impacted Services: N/A (testing/ops automation and documentation only)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime request-path behavior changed; CI/test strictness increased for contract drift prevention.
- Validation: `npm run test:contracts`, `npm run gates:init-log -- --stage=B --scope=guild:demo --operator=auto --decision=no-go --rollbackType=queue --rollbackDeadlineMin=10`, `npm run gates:weekly-report -- --days=7`, `npm run lint`.

## 2026-03-18 - Progressive Blueprint Automation Enforcement

- Why: Complete end-to-end execution of progressive autonomy blueprint by adding executable scripts and CI enforcement, not only planning docs.
- Scope: automation scripts for contract validation and go/no-go run-log creation; npm script wiring; CI gate step addition; planning index update.
- Impacted Routes: N/A
- Impacted Services: N/A (no runtime request path changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: CI now fails when autonomy contract schema integrity check fails; this is intended fail-closed behavior for governance consistency.
- Validation: `npm run lint`, `npm run contracts:validate`, `npm run gates:init-log -- --stage=A --scope=guild:demo --operator=auto`.

## 2026-03-18 - Progressive Autonomy Execution Artifacts Finalization

- Why: Convert roadmap-level methodology into operator-ready execution artifacts for immediate stage-based rollout.
- Scope: added 30-day checklist, go/no-go decision template, and contract JSON schema set; linked from roadmap and unified runbook.
- Impacted Routes: N/A (documentation and governance artifact update)
- Impacted Services: N/A (no runtime code path changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; execution ambiguity reduced through standardized checklist/template/schema artifacts.
- Validation: `npm run lint`.

## 2026-03-18 - Progressive Autonomy Evolution Methodology Adoption

- Why: Reduce migration risk while scaling autonomous operations by formalizing strangler-first, queue-first, contract-first, and SLO-driven decomposition into canonical governance docs.
- Scope: roadmap, execution board, sprint backlog, and unified runbook synchronization for staged evolution operations.
- Impacted Routes: N/A (documentation and operational governance update)
- Impacted Services: N/A (no runtime behavior changed in this documentation change set)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; stage gate strictness increased and rollback policy clarified to reduce operational ambiguity.
- Validation: `npm run lint`.

## 2026-03-18 - Runtime Bottleneck and Reliability Hardening

- Why: Mitigate control-plane read bottlenecks and reduce runtime hang risks from upstream network latency and server shutdown edge cases.
- Scope: bot status endpoint caching/in-flight dedupe/rate-limit, Supabase fetch timeout wrapper, HTTP server timeout and graceful shutdown controls.
- Impacted Routes: `/api/bot/status`
- Impacted Services: `src/routes/bot.ts`, `src/services/supabaseClient.ts`, `server.ts`
- Impacted Tables/RPC: Indirect impact on Supabase calls through shared client timeout policy.
- Risk/Regression Notes: Status payload freshness now follows short TTL caching; extreme low-latency dashboards may observe up to cache TTL delay.
- Validation: `npm run lint`.

## 2026-03-17 - Unified Roadmap and Ops Document Integration (Social Ops Baseline)

- Why: Resolve roadmap/runbook/backlog fragmentation and align documentation to current implementation progress (social graph + autonomous loop + reasoning gates).
- Scope: planning and operations documentation governance layer.
- Impacted Routes: N/A (documentation integration change)
- Impacted Services: N/A (no runtime behavior changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime regression; planning ambiguity reduced by canonical roadmap and milestone-bound execution board.
- Validation: `npm run lint`.

## 2026-03-15 - Autonomous Guild Context Ops Loop Baseline

- Why: Move from static lore sync into autonomous multi-guild context operations with feedback/reward signals.
- Scope: Obsidian sync pipeline, guild bootstrap flow, Discord ingestion hooks, operations loop controls.
- Impacted Routes: N/A (runtime loop and Discord event pipeline focused change)
- Impacted Services: obsidianBootstrapService, discordTopologySyncService, discordChannelTelemetryService, discordReactionRewardService, action/session orchestration touchpoints.
- Impacted Tables/RPC: `guild_lore_docs` (primary sync target), memory-related read/write paths (indirect).
- Risk/Regression Notes: Increased automation surface; requires strict timeout/retry/failure-rate guard tuning and lock-file hygiene.
- Validation: `npm run lint`, operational smoke via `obsidian:ops-cycle` and `obsidian:ops-loop` configuration checks.

## 2026-03-15 - Frontier 2026 Roadmap Sync for Personal AGI Testbed

- Why: Align planning and operations docs with current direction: AI-built user services, real-time context learning, Discord UX/CS automation, and single-operator execution model.
- Scope: Program roadmap, execution board, unified runbook ownership/risk framing.
- Impacted Routes: N/A (planning/operations documentation synchronization)
- Impacted Services: Planning and governance layers (no runtime code path changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime behavior change; delivery risk reduced by clearer priorities and single-operator governance model.
- Validation: `npm run lint`.

## 2026-03-15 - Graph-First Doctrine and Hardcoding Remediation Sync

- Why: Prevent context drift by enforcing Obsidian CLI/Headless split, graph-first retrieval policy, and structured hardcoding cleanup.
- Scope: Obsidian sync runbook, beta go/no-go gates, frontier roadmap, sprint backlog, hardcoding checklist.
- Impacted Routes: N/A (documentation/governance layer update)
- Impacted Services: N/A (no runtime code path changed in this update)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No direct runtime change; operational consistency and deployment gate strictness increased.
- Validation: `npm run lint`.

## 2026-03-15 - Discord Runtime Policy Centralization (Hardcoding Phase 1)

- Why: Reduce hardcoding drift by centralizing Discord intent patterns and output length limits into a shared runtime policy layer.
- Scope: `src/discord/runtimePolicy.ts` added; command definitions, docs command handlers, market handler, and UI builders migrated to shared limits/patterns.
- Impacted Routes: N/A (Discord interaction/runtime layer refactor)
- Impacted Services: Discord command handling and rendering policy only.
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Existing imports remained compatible by re-exporting intent patterns from command definitions.
- Validation: `npm run lint`.

## 2026-03-15 - Obsidian Code Map Sync (Sourcetrail-style View)

- Why: Enable full-code observability in personal Obsidian vault with function/class notes, backlinks, and lightweight auto-sync on file changes.
- Scope: `scripts/sync-obsidian-code-map.ts`, npm scripts, environment options, and operations runbook.
- Impacted Routes: N/A (offline tooling and vault generation)
- Impacted Services: N/A (no runtime API behavior changed)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Watch mode relies on recursive fs watcher support; if unavailable on environment, run one-shot generation via cron/task scheduler.
- Validation: `npm run lint`; one-shot and watch command smoke in local path.

## 2026-03-15 - Obsidian Code Map Tag Policy Flexibility

- Why: Support project-specific taxonomy by making code-map tags configurable instead of fixed values.
- Scope: `scripts/sync-obsidian-code-map.ts`, `.env.example`, runbook documentation for tag policy controls.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Custom tag inputs are normalized (lowercase/safe chars) which may alter user-provided raw casing.
- Validation: `npm run lint`; one-shot generation smoke with default tag policy.

## 2026-03-15 - Obsidian Code Map Post-Processing for Tag De-duplication

- Why: Reduce Obsidian tag duplication noise and improve architecture-level scanability in generated code-map notes.
- Scope: `scripts/sync-obsidian-code-map.ts`, `.env.example`, runbook tag policy section.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Inline hashtag lines are disabled by default; users depending on inline-only tag parsing should re-enable via config.
- Validation: `npm run lint`; `npm run obsidian:code-map -- --repo <repo> --vault <vault>`.

## 2026-03-15 - Obsidian Code Map Structural Navigation Upgrade

- Why: Improve human readability by shifting from flat file/symbol lists to guided navigation and dependency-first layout.
- Scope: `scripts/sync-obsidian-code-map.ts` index/file/symbol rendering and graph construction strategy.
- Impacted Routes: N/A (offline tooling only)
- Impacted Services: N/A
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Entrypoint detection is heuristic/path-based and may over-include scripts until rule tuning is refined.
- Validation: `npm run lint`; `npm run obsidian:code-map -- --repo <repo> --vault <vault>`.
