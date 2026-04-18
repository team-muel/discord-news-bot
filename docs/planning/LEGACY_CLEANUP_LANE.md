# Legacy Cleanup Lane

Status note:

- Inventory-lock lane only. This document does not authorize deletion by itself.
- Current lane state: Remove-Now = none, Rollback-Only = two Discord exact units, Keep-For-Now = all remaining scoped units. Mass delete remains closed.
- This lane is downstream of the Chat SDK live cutover lane, provider cleanup lane, naming canonicalization lane, control-plane canonicalization lane, and deterministic task extraction lane.

## Objective

Lock the remaining legacy cleanup inventory and the exact remove conditions for each scope so future deletion work only opens after replacement is complete for the exact unit being removed.

## Non-Goals

- mass-delete remaining legacy surfaces in the current change window
- use this lane as proof that any replacement is already complete
- collapse live rollback paths before their grace window is explicitly closed
- widen cleanup scope beyond the five buckets listed below
- mix canonicalization implementation and deletion implementation into one patch by default

## Global Decision Rule

- This lane consumes predecessor evidence. It does not generate replacement-complete evidence on its own.
- A unit may move from Keep-For-Now to Rollback-Only only when the replacement for that exact unit is live, default-on or canonical in production-facing routing, and the rollback grace window is explicit.
- A unit may move from Rollback-Only to Remove-Now only when the grace window is closed, operators no longer rely on the legacy entrypoint, and docs/tests/health surfaces no longer name the old path as active.
- If a scope still provides live input compatibility, env compatibility, routing compatibility, or deterministic inline fallback, classify it as Keep-For-Now even if a future replacement already exists elsewhere.
- Future deletion patches must cite the exact scope row and predecessor evidence that opened the delete gate.

## Current Scope Snapshot

| Scope | Predecessor lane that must close first | Current decision | Why deletion stays closed |
| --- | --- | --- | --- |
| Discord legacy path | M-24 cutover default-on plus grace-close | Exact-unit Rollback-Only + Keep-For-Now remainder | Live cutover evidence is now closed for the `docs.ask` post-ingress fallback exact unit and the prefixed `muel-message` post-ingress fallback exact unit. Whole files and all remaining Discord units stay locked until their own exact rollback evidence closes. |
| Provider alias sprawl | Provider cleanup and canonical env/profile lane | Keep-For-Now | Runtime routing, provider config, and env validation still accept alias names and alias env keys as live compatibility behavior. |
| Naming compatibility residue | Canonical role/action/output lane | Keep-For-Now | Legacy role names, action aliases, worker kinds, and env fallbacks are still accepted at input boundaries and operator surfaces. |
| Control-plane compatibility glue | Canonical shared-MCP/bootstrap lane | Keep-For-Now | Legacy shared-MCP alias ingress, legacy env keys, and baseline compatibility fields are still published or read by active bootstrap and diagnostics surfaces. |
| Deterministic task inline residue | Deterministic task extraction/delegation lane | Keep-For-Now | Inline deterministic handlers and delegation-first fallbacks still own live execution or rollback behavior. |

Global snapshot for this lane today:

- Remove-Now: none
- Rollback-Only: `src/discord/commands/docs.ts` post-ingress legacy fallback branch inside `handleDocsAskRequest()` for `docs.ask`; `src/discord/commands/vibe.ts` prefixed `muel-message` post-ingress fallback continuation after the Chat SDK/ingress attempt declines
- Keep-For-Now: all remaining scoped units

## Scope A - Discord Legacy Path

Inventory anchors:

- `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md` section 7 (`Removal Inventory Lock`)
- `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`
- `src/discord/runtime/commandRouter.ts`
- `src/discord/commands/docs.ts`
- `src/discord/commands/vibe.ts`
- `src/discord/session.ts`

Current classification:

- Remove-Now: none
- Rollback-Only: the post-ingress legacy fallback branch inside `src/discord/commands/docs.ts` `handleDocsAskRequest()` for `/뮤엘` and `/해줘`; and the prefixed `muel-message` post-ingress fallback continuation inside `src/discord/commands/vibe.ts` `handleVibeMessage()` after the Chat SDK/ingress attempt declines. The replacement request path is now the live ingress seam and the old branches remain only as explicit rollback/grace behavior.
- Keep-For-Now: all remaining rows already locked in `DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`, including the rest of `docs.ts`, the remaining active units in `vibe.ts`, all of `session.ts`, and the remaining non-eligible portions of `commandRouter.ts`.

Exact predecessor evidence closed for the rollback-only units:

- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-142211.json` closed the first production window with `docs-command` in `default-on`, live selected-path parity, runtime fallback observation, and rollback pass.
- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-144035.json` repeated the same production verdict, confirming that the `docs.ask` fallback is explicit grace behavior rather than missing-owner drift.
- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-161707.json` later changed the preferred adapter owner again while keeping `docs.ask` on the same ingress boundary, which confirms that the replacement boundary is the ingress seam rather than one adapter brand.
- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-212611.json` refreshed the current `chat-sdk` canary parity for both eligible surfaces and kept the prefixed exact unit one artifact away from rollback-only.
- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-18_chat-sdk-cutover-20260418-095009.json` confirmed that the current local-process control plane records forced-fallback rollback observations for both eligible surfaces at rollout 100, which narrowed the remaining gap to the deployed internal control plane only.
- `docs/planning/gate-runs/chat-sdk-cutover/2026-04-18_chat-sdk-cutover-20260418-124225.json` closed the deployed internal control-plane window at rollout 100 with live selected-path parity plus forced-fallback rollback observations for both eligible surfaces, which opens the prefixed `muel-message` fallback exact unit for rollback-only classification.

Delete gate opens only when all of the following are true:

- the exact row in `DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md` moves out of non-removal first
- the eligible replacement path is live and default-on for that exact unit, not just for a neighboring seam
- `CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md` stays green for the relevant surface after the rollback grace window closes
- the current Discord router no longer owns that exact surface as the primary runtime boundary

Current rule:

- Do not open a whole-file or mass-deletion patch against these four files from the current state.
- Do not move additional Discord units to Rollback-Only on neighboring-surface evidence alone; each exact unit still needs its own selected-path plus rollback proof.

## Scope B - Provider Alias Sprawl

Inventory anchors:

- `src/services/llm/routing.ts` (`normalizeProviderAlias()`, `parseProviderList()`)
- `src/configLlmProviders.ts` (HF, Claude, Gemini, Kimi, and OpenClaw alias env acceptance)
- `scripts/validate-env.mjs`
- `docs/ARCHITECTURE_INDEX.md`

Concrete live compatibility still present:

- provider aliases: `hf`, `claude`, `local`, `jarvis`, `moonshot`
- env alias families: `HF_TOKEN` / `HF_API_KEY` / `HUGGINGFACE_API_KEY`, `KIMI_API_KEY` / `MOONSHOT_API_KEY`, `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`

Current classification:

- Remove-Now: none
- Rollback-Only: none
- Keep-For-Now: all provider name aliases and env alias families listed above

Delete gate opens only when all of the following are true:

- the provider cleanup lane closes with canonical provider names and canonical env keys as the only documented active names
- `scripts/validate-env.mjs` and related docs-policy checks no longer rely on alias acceptance to avoid silent breakage
- active env profiles and operator runbooks are migrated off alias names
- a follow-up inventory refresh confirms that alias acceptance is no longer part of the runtime safety contract

## Scope C - Naming Compatibility Residue

Inventory anchors:

- `src/services/skills/actions/types.ts` (`LEGACY_AGENT_ROLES`, `ACTION_NAME_ALIAS_GROUPS`, `normalizeAgentRole()`)
- `src/services/skills/actions/mcpDelegate.ts` (`McpWorkerKind`, `LEGACY_KIND_ALIAS`)
- `src/services/agent/agentRoleWorkerService.ts`
- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

Concrete live compatibility still present:

- legacy role names: `openjarvis`, `opencode`, `nemoclaw`, `opendev`
- legacy action aliases: `opencode.execute`, `opendev.plan`, `nemoclaw.review`, `openjarvis.ops`, `local.orchestrator.route`, `local.orchestrator.all`
- legacy worker kinds and env fallbacks that still resolve into canonical neutral workers

Current classification:

- Remove-Now: none
- Rollback-Only: none
- Keep-For-Now: all legacy role names, action aliases, worker-kind aliases, and env fallbacks that are still accepted at input boundaries

Delete gate opens only when all of the following are true:

- persisted runtime inputs, stored rows, and operator-facing payloads no longer emit or require legacy names
- canonical neutral labels are the only active names in operator docs, health snapshots, and env examples
- `agentRoleWorkerService`, `mcpDelegate`, and action normalization no longer need legacy fallbacks for live callers
- an inventory refresh confirms that the remaining legacy names are true rollback residue instead of active compatibility readers

## Scope D - Control-Plane Compatibility Glue

This scope treats "unused" as a provisional label only. Nothing here is considered unused until the canonical bootstrap path proves that zero live readers remain.

Inventory anchors:

- `src/services/obsidian/adapters/remoteMcpAdapter.ts` (`MCP_SHARED_MCP_URL`, `OBSIDIAN_REMOTE_MCP_URL`, `/mcp` vs `/obsidian` compatibility)
- `src/services/agent/agentRoleWorkerService.ts` (legacy worker env fallbacks)
- `config/runtime/operating-baseline.json` (`legacyEnvKey`, `legacyUrl`)
- shared control-plane scripts and profiles that still accept compatibility aliases while the canonical path stabilizes

Concrete live compatibility still present:

- shared-MCP alias ingress: `OBSIDIAN_REMOTE_MCP_URL` and `/obsidian`
- worker legacy env keys surfaced in the operating baseline and worker health specs
- compatibility fields that still explain or preserve the old control-plane bootstrap path

Current classification:

- Remove-Now: none
- Rollback-Only: none
- Keep-For-Now: all shared-MCP alias ingress, worker legacy env fallback wiring, and baseline compatibility fields that are still published or read

Delete gate opens only when all of the following are true:

- the canonical shared-MCP/bootstrap lane is the sole active bootstrap and diagnostics path
- no env profile, audit surface, or helper script still reads the legacy control-plane alias values
- `remoteMcpAdapter` no longer needs the compatibility alias ingress for the live shared path
- the operating baseline can drop `legacyEnvKey` and `legacyUrl` fields for the affected service without hiding an active migration dependency

## Scope E - Deterministic Task Inline Residue

Inventory anchors:

- `src/discord/runtime/commandRouter.ts` (`DISCORD_CHAT_COMMAND_NAMES.METRIC_REVIEW` inline handler)
- `src/services/metricReviewFormatter.ts`
- `src/services/intent/metricReviewService.ts`
- `src/services/automation/n8nDelegationService.ts` (`shouldSkipInlineFallback()`)
- `src/services/skills/actions/news.ts`
- `src/services/news/newsMonitorWorkerClient.ts`
- `src/services/news/youtubeMonitorWorkerClient.ts`
- `src/services/news/newsSentimentMonitor.ts`
- `src/services/runtime-alerts/dispatcher.ts`

Concrete live residue still present:

- the Discord `Metric Review` command still formats and replies inline in `commandRouter.ts` even though reusable deterministic service layers already exist
- delegation-first news and content paths still keep inline fallback branches for RSS, article-context, and related fetch/summarize flows
- alert dispatch intentionally keeps inline webhook fallback until a real replacement sink exists

Current classification:

- Remove-Now: none
- Rollback-Only: none
- Keep-For-Now: all inline deterministic handlers and delegation-first fallback branches listed above

Delete gate opens only when all of the following are true:

- a dedicated shared handler or transport-neutral task service owns the exact deterministic command or task path end-to-end
- delegation-first or worker-backed execution is the default-on path for the exact task, with parity evidence for success and rollback behavior
- the alert path has a real sink before inline webhook fallback is removed
- a refresh pass confirms the inline branch is no longer the active execution or rollback owner

## Future Deletion Protocol

Any future cleanup patch opened from this lane must follow this order:

1. cite the exact scope and predecessor evidence that opened the gate
2. refresh the inventory before changing code so stale assumptions do not survive into deletion work
3. move units to Rollback-Only before Remove-Now when the grace window is still open
4. update execution state, changelog, and shared-knowledge capture in the same change window

## Lane Exit Criteria

This inventory-lock lane is considered complete for now when all of the following are true:

- the five scoped buckets and their delete gates are documented in one canonical plan document
- `docs/planning/EXECUTION_BOARD.md` references the lane as a queued follower, not an active deletion stream
- the shared-knowledge backfill catalog registers this document for promotion into the shared wiki surface
- future cleanup work can point to an explicit Remove-Now / Rollback-Only / Keep-For-Now source instead of re-running broad archaeology
