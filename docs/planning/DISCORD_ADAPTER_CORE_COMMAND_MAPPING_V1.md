# Discord Adapter -> Core Command Mapping v1

Status note:

- Reference mapping specification for Discord adapter to core command translation.
- Canonical boundary-definition document for M-24 channel ingress abstraction and Chat SDK-ready migration seams.
- Current repo state: boundary-definition is complete, and the request-side seam now lives at per-surface `executeDiscordIngress()` injection in `src/discord/runtime/commandRouter.ts` with execution + telemetry in `src/discord/runtime/discordIngressAdapter.ts`. `routeDiscordIngress()` remains a lower-level compatibility helper, not the migration boundary. Eligible chat surfaces now have response sink ownership plus per-surface selector, hard-disable, shadow, rollout/holdout gating, structured ingress telemetry, and green live canary verification. Full default-on, grace-close, and legacy demotion remain separate follow-up work.
- Use this document for contract alignment; WIP priority stays in `docs/planning/EXECUTION_BOARD.md`.

Purpose:

- Define deterministic mapping from Discord command surface to core command intents.
- Keep adapter translation explicit and auditable.

Primary handler hub:

- src/discord/runtime/commandRouter.ts

## 1) Chat Input Command Mapping

| Discord command | Adapter handler | Core command_type | Core payload focus |
| --- | --- | --- | --- |
| 해줘 | docsHandlers.handleAskCommand | docs.ask | query, visibility (compat alias) |
| 뮤엘 | docsHandlers.handleAskCommand | docs.ask | query, visibility |
| 만들어줘 | vibeHandlers.handleMakeCommand | worker.generate.request | goal, coding intent, visibility |
| 변경사항 | docsHandlers.handleChangelogCommand | docs.changelog | Obsidian #changelog tag search |
| 정책 | agentHandlers.handlePolicyCommand | agent.policy.control | subcommand + policy update args |
| 시작 | agentHandlers.handleAgentCommand | agent.session.start | goal/priority/skill |
| 온보딩 | agentHandlers.handleAgentCommand | agent.onboarding.run | guild onboarding trigger |
| 중지 | agentHandlers.handleAgentCommand | agent.session.stop | session identifier |
| 스킬목록 | agentHandlers.handleAgentCommand | agent.skill.list | guild scope |
| 관리자 | adminHandlers.handleAdminCommand | admin.runtime.command | channel/forum/admin ops |
| 상태 | adminHandlers.handleStatusCommand | runtime.status.read | guild/runtime snapshot |
| 관리설정 | adminHandlers.handleManageSettingsCommand | admin.settings.update | learning toggle |
| 잊어줘 | adminHandlers.handleForgetCommand | privacy.forget.request | scope, mode, confirm token |
| 도움말 | adminHandlers.handleHelpCommand | help.read | command catalog |
| 구독 | handleGroupedSubscribeCommand | subscription.command | action/type/link/channel |
| 주가 | handleStockPriceCommand | market.query | symbol + visibility |
| 차트 | handleStockChartCommand | market.query | symbol + visibility |
| 분석 | handleAnalyzeCommand | market.query | query + visibility |
| 유저 | crmHandlers.handleMyInfoCommand | user.crm.self | self CRM profile + login diag |
| 통계 | crmHandlers.handleUserInfoCommand | user.crm.lookup | target user CRM lookup (admin) |
| 프로필 | personaHandlers.handleProfileCommand | user.profile.read | self or target user profile |
| 메모 | personaHandlers.handleMemoCommand | user.note.command | view or add user memo |
| 지표리뷰 | inline in bot.ts | metrics.review.read | metric snapshot generation |

## 2) Non-Chat Interaction Mapping

| Interaction type            | Adapter path                             | Core command_type                        |
| --------------------------- | ---------------------------------------- | ---------------------------------------- |
| button interaction          | handleButtonInteraction                  | agent.action.approval or session.control |
| user context menu           | personaHandlers.handleUserContextCommand | user.profile.context                     |
| modal submit                | personaHandlers.handleUserNoteModal      | user.note.upsert                         |
| message create(simple mode) | vibeHandlers.handleVibeMessage           | agent.run (light)                        |

## 3) Envelope Binding Rule

For each adapter->core handoff:

- Build commandEnvelope v1 before invoking core service.
- Preserve trace_id across eventEnvelope and commandEnvelope chains.
- Attach idempotency_key for retriable commands.

## 4) Evidence Pointers

Source lines:

- src/discord/runtime/commandRouter.ts: switch(commandName) dispatch table
- src/discord/commandDefinitions.ts: slash/context command registration surface
- src/discord/session.ts: startVibeSession and startAgentSession bridge
- src/services/multiAgentService.ts: startAgentSession core entry

Validation:

- npm run contracts:validate
- npm run test:contracts

## 5) Chat SDK-Ready Boundary Definition

Migration goal:

- Reduce Discord-specific code surface to transport normalization, transport reply rendering, and Discord-only side effects.
- Keep the existing Discord/OpenClaw ingress behavior intact while freezing one ingress contract that a future Chat SDK adapter can reuse.
- Preserve current ownership boundaries: Discord is a compatibility ingress, Hermes remains the continuity/operator lane, Supabase remains hot-state, and Obsidian remains durable semantic ownership.

Non-goals for this migration track:

- Replacing `bot.ts` lifecycle, gateway preflight, login/reconnect, or slash-command registration.
- Re-owning Supabase, Obsidian, Hermes, OpenJarvis, or OpenClaw under a new UI/runtime label.
- First-slice migration of button, modal, user-context-menu, guild-lifecycle, reaction, CRM, or passive-memory flows.
- Big-bang transport replacement. This track is additive and must keep rollback to the current Discord router path.

### Current Boundary Freeze

| Area | Current anchor | Boundary decision | First migration slice |
| --- | --- | --- | --- |
| Bot lifecycle and gateway health | `bot.ts`, `src/discord/runtime/botRuntimeState.ts`, `src/discord/runtime/gatewayPreflight.ts` | Keep Discord-native. Not part of Chat SDK migration. | none |
| Slash command registration and permission bits | `src/discord/commandDefinitions.ts` | Keep Discord-native; future adapters consume the normalized command catalog, not Discord builders. | none |
| Docs ask ingress (`/뮤엘`, `/해줘`) | `src/discord/runtime/commandRouter.ts` injects `executeDocsCommandIngress()` backed by `executeDiscordIngress()` into `src/discord/commands/docs.ts` | Request-side seam and response sink are extracted. Legacy docs RAG/LLM remains deterministic fallback. | eligible cutover surface closed |
| Prefixed message ingress (`뮤엘 ...`) | `src/discord/runtime/commandRouter.ts` injects `executePrefixedMessageIngress()` backed by `executeDiscordIngress()` into `src/discord/commands/vibe.ts` | Request-side seam and message sink are extracted for adapter-accept traffic. Quick-chat/full-session remains deterministic fallback. | eligible cutover surface closed |
| Make/code ingress (`/만들어줘`) | `src/discord/commands/vibe.ts` -> `src/discord/session.ts` | Migrate after docs.ask seam is proven stable. | adapter implementation phase 2 |
| Session progress streaming | `src/discord/session.ts` | Reuse as transport-neutral orchestration surface. | adapter implementation |
| OpenClaw ingress preference + Hermes objective queueing | `executeDiscordIngress()` and `openClawDiscordIngressAdapter` in `src/discord/runtime/discordIngressAdapter.ts` (`routeDiscordIngress()` retained as lower-level compatibility helper) | Keep behavior behind the extracted request-side seam. Eligible chat surfaces are closed through sink ownership plus structured telemetry, and live canary verification is green; full default-on plus grace-close remain a separate session. | eligible surfaces live-canary verified; default-on/grace-close pending |
| Admin/persona/tasks/market commands | `src/discord/commands/*.ts` except docs/vibe | Leave on the legacy Discord adapter until chat surfaces are stable. | defer |
| Buttons, modals, user context menus | `src/discord/runtime/buttonInteractions.ts`, `src/discord/commands/persona.ts` | Explicitly out of the first migration. | defer |
| Passive memory, reaction rewards, guild lifecycle, CRM side effects | `src/discord/runtime/passiveMemoryCapture.ts`, reaction handlers, guild lifecycle | Not part of Chat SDK migration. Keep on native Discord runtime. | none |

### Target Contract Surface

Freeze two contracts before code movement:

- `IngressRequestEnvelope v1`: required fields are `surface`, `commandType`, `requestText`, `guildId`, `channelId`, `threadId`, `userId`, `replyVisibility`, `sourceRef`, `traceId`, and `idempotencyKey`.
- `IngressRequestEnvelope v1`: optional hints are `messageId`, `interactionId`, `attachments`, `allowThreadFollowup`, `allowFeedbackReactions`, and `transport`.
- `IngressRequestEnvelope v1`: the envelope owns channel normalization only. It does not become the owner of workflow state, memory state, or runtime governance.
- `IngressResponseSink v1`: minimal operations are `ack`, `updateProgress`, `final`, and `followUp`.
- `IngressResponseSink v1`: Discord-only side effects such as ephemeral/public rendering choice, thread creation, and feedback reaction seeding stay behind the sink implementation.

Existing code that already matches the target seam:

- `src/discord/session.ts` already exposes a sink-style `streamSessionProgress()` and should be reused instead of rewritten.
- `src/routes/chat.ts` already demonstrates a transport-neutral request -> retrieve -> answer shape and is the closest existing pattern for `docs.ask` normalization.
- `src/services/runtime/runtimeProvider.ts` is a host/runtime abstraction, not the channel-ingress contract. Do not stretch it into the new ingress seam.

### Current Implementation State

- Complete in the current repo state:
  - request-side seam extraction into `DiscordIngressRouteRequest`, `DiscordIngressEnvelope`, `DiscordIngressExecution`, `executeDiscordIngress()`, and `openClawDiscordIngressAdapter` in `src/discord/runtime/discordIngressAdapter.ts`; `routeDiscordIngress()` is now a lower-level compatibility helper rather than the cutover boundary
  - handler injection from `src/discord/runtime/commandRouter.ts` into the docs and prefixed-message handlers through `executeDocsCommandIngress()` and `executePrefixedMessageIngress()`
  - `docs.ask` now uses `IngressResponseSink v1` in `src/discord/commands/docs.ts`, so `ack`, `updateProgress`, `final`, and feedback seeding are owned by the sink instead of the request handler body
  - prefixed `뮤엘 ...` now uses a message sink in `src/discord/commands/vibe.ts`, so adapter-accept `message.reply()` and feedback seeding are owned by the sink instead of the ingress decision branch
  - both eligible chat surfaces now share preferred adapter selection, hard-disable, shadow-mode evaluation, per-surface rollout/holdout gating, structured ingress telemetry, and persisted cutover evidence snapshots through `executeDiscordIngress()`
  - `scripts/run-chat-sdk-discord-cutover-validation.ts` can emit md/json gate-run artifacts from the persisted ingress evidence snapshot
- Still incomplete for the full owner-transition window:
  - `/만들어줘` plus the full session-progress reply/update lifecycle remain phase 2 and outside the first cutover window
  - eligible surface 전체 default-on/100 전환, rollback grace-close 종료, legacy demotion/removal은 아직 별도 후속 lane이다
- Session state:
  - boundary-definition: complete
  - adapter-implementation: session A complete, session B complete for the eligible chat surfaces
  - rollout-control primitives: complete for the eligible chat surfaces
  - removal-inventory lock: complete
  - cutover-verification readiness: green for the current canary window; full default-on/grace-close pending

## 6) Incremental Session Plan

- Boundary Definition Session: deliverable is this document, the shared-knowledge backfill registration, and the architecture changelog entry. Status: complete in the current repo state. Exit criteria are that the first migrated surfaces are frozen to `docs.ask` (`/뮤엘`, `/해줘`) plus prefixed `뮤엘 ...`, and non-goals are explicit.
- Discord Adapter Implementation Session A: complete when `docs.ask` owns `IngressResponseSink v1`, docs-specific adapter selection plus hard-disable exists, shadow evaluation emits correlation-id based telemetry, and deterministic fallback to the legacy docs path remains intact. Status: complete in the current repo state.
- Discord Adapter Implementation Session B: complete when prefixed `뮤엘 ...` shares the same sink, selector, and telemetry contract while preserving deterministic fallback to quick chat or the full vibe session. Status: complete in the current repo state. `/만들어줘` remains phase 2 after the first chat surfaces are fully closed.
- Rollout Control Session: core primitives and the first live evidence window are complete for the eligible chat surfaces at the generic ingress seam. Per-surface rollout percentage, holdout-safe canary selection, hard-disable, shadow evaluation, and cutover evidence snapshots now exist, and selected-path plus forced-fallback evidence has already been recorded in production. Remaining work is exact-unit grace-close and later preferred-adapter owner changes, not first-pass parity collection.
- Legacy Removal Identification Session: this is an inventory-lock pass first, not deletion authority. Re-run it after each implementation slice that changes the eligible Discord seams so stale symbols do not survive into the next session. The current live seam is `executeDocsCommandIngress()` / `executePrefixedMessageIngress()` in `src/discord/runtime/commandRouter.ts` plus `executeDiscordIngress()` in `src/discord/runtime/discordIngressAdapter.ts`, not `routeDiscordIngress()` or removed inline helpers. Actual code deletion still starts only after the relevant surface is default-on, cutover evidence exists, and the rollback grace window is explicitly closed. Exit criteria are that the inventory is locked against live code and migrated chat surfaces import Discord types only in the adapter layer, not in the core use-case layer.
- Cutover Verification Session: the first generic-ingress validation window is now closed for `docs.ask` and prefixed `뮤엘 ...`. Later preferred-adapter owner changes still need their own bounded validation window, and rollback to the legacy Discord router should remain open for at least one release window after each broader owner change. Whole-file deletion remains a separate later session.

## 7) Removal Inventory Lock

Current lock date: 2026-04-17, after live cutover go evidence and exact-unit inventory refresh.

### Remove-Now

| File set | Current classification | Why |
| --- | --- | --- |
| `src/discord/commands/docs.ts`, `src/discord/commands/vibe.ts`, `src/discord/session.ts`, `src/discord/runtime/commandRouter.ts` | none | No code unit in these four files is deletion-authorized today. The stale items were document references and pre-extraction assumptions, not live code that has already been superseded. |

### Rollback-Only

| File set | Current classification | Why |
| --- | --- | --- |
| `src/discord/commands/docs.ts` | post-ingress legacy fallback branch inside `handleDocsAskRequest()` for `/뮤엘` and `/해줘` | `executeDocsCommandIngress()` / `executeDiscordIngress()` now owns the live request path, and the production go artifacts include a forced `docs-command` `legacy_fallback` in the same validation window. This retained branch is now grace-period rollback residue, not the primary request owner. |

### Non-Removal

| File | Current live unit | Why it is locked as non-removal now | Recheck trigger |
| --- | --- | --- | --- |
| `src/discord/commands/docs.ts` | `handleAskCommand()`, `createDocsAskResponseSink()`, `handleDocsCommand()` / `handleChangelogCommand()`, and the ingress-accept command shell around `handleDocsAskRequest()` | The Discord.js slash shell and response sink still own the live transport boundary. Only the post-ingress legacy fallback segment is rollback-only; the rest of the file remains active docs command behavior outside the legacy-removal scope. | Reclassify further only after the Discord.js shell is no longer the active transport owner. |
| `src/discord/commands/vibe.ts` | `handlePrefixedMessageIngressRequest()`, the post-ingress prefixed-message continuation inside `handleVibeMessage()`, and slash/session reply wiring in `handleVibeCommand()` / `handleMakeCommand()` | Live selected-path evidence now exists for prefixed `뮤엘 ...`, and the latest production rerun (`2026-04-17_chat-sdk-cutover-20260417-212611.*`) refreshed that parity on the current `chat-sdk` canary. But the exact `muel-message` fallback branch still has no production rollback artifact because the deployed internal exercise route reported only one forced-fallback rollback observation. `/만들어줘` and session flows remain active live units, not rollback residue. | Reclassify the prefixed fallback only after a live `muel-message` rollback observation lands in the cutover evidence window from the deployed two-surface rollback exercise path. |
| `src/discord/session.ts` | `streamSessionProgress()`, render helpers, `startVibeSession()`, and `seedFeedbackReactions()` | `streamSessionProgress()` is the canonical reusable progress surface and is explicitly a keep/reuse asset. `seedFeedbackReactions()` is still a shared helper consumed by live docs and vibe paths; relocation may happen later, but it is not currently a legacy delete or rollback-only unit. | Reclassify only after all Discord sinks stop importing this helper or the helper is moved to a dedicated sink utility module. |
| `src/discord/runtime/commandRouter.ts` | outer `interactionCreate` / `messageCreate` shells, docs ingress injection, slash dispatch table, and non-chat runtime wiring | This file still owns the live Discord runtime boundary for buttons, modals, persona/admin/task/market commands, guild lifecycle, passive memory, CRM side effects, and the current eligible chat-surface dispatch. None of that is superseded yet. | Reclassify only after a registry-based ingress dispatcher or Chat SDK router takes ownership of the eligible chat surfaces without collapsing the non-target runtime duties still hosted here. |

Inventory rule for the next session:

- Do not open a whole-file or mass-deletion patch against these four files from the current state.
- The only exact-unit rollback-only residue currently opened is the `docs.ask` post-ingress legacy fallback block in `src/discord/commands/docs.ts`.
- The next valid inventory refresh for other Discord units still requires exact-unit live selected-path plus exact-unit rollback evidence; neighboring surface proof is not enough.

Explicit non-removal targets for the first migration window:

- `src/discord/commandDefinitions.ts`
- `bot.ts`
- `src/discord/runtime/buttonInteractions.ts`
- `src/discord/runtime/passiveMemoryCapture.ts`
- guild lifecycle and reaction handlers in `src/discord/runtime/commandRouter.ts`

## 8) Hard Invariants

- Existing `/뮤엘`, `/해줘`, `/만들어줘`, and prefixed `뮤엘 ...` behavior must remain intact during migration.
- OpenClaw remains an optional ingress preference, not the semantic owner of the workstream.
- Hermes continuity, OpenJarvis managed operations, Supabase hot-state, and Obsidian semantic ownership remain unchanged.
- Deliverable sanitization and user-facing Discord output safety must remain enforced on the migrated path.
- Rollback must be a routing toggle back to the current Discord adapter path, not a schema or ownership reversal.
