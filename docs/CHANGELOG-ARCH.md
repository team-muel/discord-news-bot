# Architecture Changelog

Use this log for architecture-significant changes only.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

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

## 2026-04-18 - Discord Eligible Slash Surface Routing Extracted From The Main Command Router

- Why: even after the shared `/뮤엘` policy helper and session-progress parity work landed, `commandRouter.ts` still owned the eligible slash-surface product routing inline. That kept the main Discord shell file responsible for `/해줘`, `/뮤엘`, and the legacy `/만들어줘` grace branch instead of treating those as one focused eligible-surface boundary.
- Scope: extracted eligible slash dispatch into a dedicated helper, kept `/해줘` Chat SDK-first docs fallback behavior, kept `/뮤엘` intent-based docs versus vibe routing, preserved the legacy `/만들어줘` grace handoff, added focused regression coverage, and refreshed the cutover/cleanup/execution docs with a fresh local-process go artifact.
- Impacted Routes: Discord slash `/해줘`, `/뮤엘`; legacy cached `/만들어줘` grace interactions
- Impacted Services: `src/discord/runtime/eligibleChatSurfaceRouter.ts`, `src/discord/runtime/eligibleChatSurfaceRouter.test.ts`, `src/discord/runtime/commandRouter.ts`, `docs/planning/DISCORD_CHAT_SURFACE_FULL_CLOSURE_PLAN.md`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/LEGACY_CLEANUP_LANE.md`, `docs/planning/EXECUTION_BOARD.md`, `docs/planning/gate-runs/chat-sdk-cutover/2026-04-18_chat-sdk-cutover-20260418-095009.md`, `docs/planning/gate-runs/chat-sdk-cutover/2026-04-18_chat-sdk-cutover-20260418-095009.json`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this is a routing-ownership refactor, not a legacy deletion. The fresh `2026-04-18` artifact confirms the current code still records both eligible rollback rehearsals locally, but the cleanup gate remains closed until the deployed internal control plane emits the same production evidence for `muel-message`.
- Validation: `vitest run src/discord/runtime/eligibleChatSurfaceRouter.test.ts src/discord/commands/vibe.test.ts src/discord/muelEntrySurface.test.ts`; `npx tsc --noEmit`; `npm run gates:discord:cutover -- --exerciseLiveEvidence=true --exerciseRollback=true --rollbackDryRun=true`

## 2026-04-18 - Discord Muel Session Progress Contract Unified Across Slash And Prefixed Message Flows

- Why: the eligible `/뮤엘` build and automation paths still had transport-specific session lifecycle handling. Slash requests normalized coding goals and managed progress updates one way, while prefixed `뮤엘 ...` requests used a separate manual path. That kept workstream 3 partially open even after the shared entry-policy helper landed.
- Scope: introduced a shared `/뮤엘` response sink for full-session flows, reused the same `ack -> updateProgress -> final -> followUp` lifecycle across slash and prefixed message paths, and normalized coding-intent runtime goals so both entries drive the same downstream session request.
- Impacted Routes: Discord slash `/뮤엘`; prefixed `뮤엘 ...`
- Impacted Services: `src/discord/commands/vibe.ts`, `src/discord/commands/vibe.test.ts`, `docs/planning/DISCORD_CHAT_SURFACE_FULL_CLOSURE_PLAN.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this closes a transport-parity gap without reopening the retired `/만들어줘` surface or changing the live Chat SDK ownership gates. Remaining closure work for the eligible surfaces is still about live default-on evidence and the exact-unit legacy cleanup lane.
- Validation: `npx tsc --noEmit`; `vitest run src/discord/commands/vibe.test.ts`

## 2026-04-18 - Discord Public Command Surface Simplified And Session Jargon Reduced

- Why: the Discord slash surface still exposed too many operator-only commands and internal terms like `세션` or `정책` to ordinary users. That made the product feel more like a control plane than a simple chat interface.
- Scope: removed internal admin/policy slash commands from registration, narrowed the default simple-command allowlist, simplified `/시작`, rewrote `/온보딩` and `/중지` descriptions, and cleaned up user-facing help/onboarding/vibe copy to prefer `작업` over `세션` on public surfaces.
- Impacted Routes: Discord slash `/도움말`, `/뮤엘`, `/해줘`, `/시작`, `/온보딩`, `/중지`, `/로그인`
- Impacted Services: `src/discord/commandDefinitions.ts`, `config/runtime/discordCommandCatalog.js`, `src/discord/commands/agent.ts`, `src/discord/commands/admin.ts`, `src/discord/messages.ts`, `src/discord/muelEntrySurface.test.ts`, `src/services/agent/agentOpsService.test.ts`, `docs/SKILLSET_LAYER.md`, `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the removed operator commands are no longer slash-registered, but their runtime handlers remain in place for short-lived cached-command grace and future internal reuse. `/중지` now prefers `작업아이디` while still accepting the legacy `세션아이디` option name for compatibility.
- Validation: `npx tsc --noEmit`; `vitest run src/discord/muelEntrySurface.test.ts src/services/agent/agentOpsService.test.ts`

## 2026-04-18 - Discord Eligible Chat Surface Policy Now Shares One Helper

- Why: the eligible `/뮤엘` chat surfaces still depended on scattered Discord-local heuristics for session intent detection, low-signal clarification, quick-chat gating, and vibe session priority. That made latency or UX adjustments require touching multiple files and increased the chance of routing drift.
- Scope: added a shared `muelEntryPolicy` helper, rewired the Discord command router, vibe handlers, and session priority selection to consume that helper, and added focused regression coverage for the shared policy decisions.
- Impacted Routes: Discord slash `/뮤엘`; prefixed `뮤엘 ...`; mention-first vibe message flow
- Impacted Services: `src/discord/muelEntryPolicy.ts`, `src/discord/runtime/commandRouter.ts`, `src/discord/commands/vibe.ts`, `src/discord/session.ts`, `src/discord/muelEntryPolicy.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this is a behavior-preserving consolidation for the existing eligible chat surfaces, with one intentional guardrail improvement: low-signal `/뮤엘` requests now consistently fall into the clarification lane instead of drifting between docs and session handling.
- Validation: `npx tsc --noEmit`; `vitest run src/discord/commands/vibe.test.ts src/discord/session.test.ts src/discord/muelEntryPolicy.test.ts src/discord/muelEntrySurface.test.ts`; `npm run test:discord`

## 2026-04-18 - Discord Build And Automation Entry Collapsed Into Muel

- Why: the dedicated `/만들어줘` slash surface duplicated build intent, complicated the Chat SDK cutover inventory, and no longer represented a required product capability once `/뮤엘` and prefixed `뮤엘 ...` were already carrying the live session flow.
- Scope: removed the public `/만들어줘` slash registration, routed build or automation intent from `/뮤엘` into the existing vibe/session path, updated the Chat SDK runtime and command router to stop treating `/만들어줘` as a first-class public transport, and aligned operator/planning docs with `/뮤엘` as the canonical entry.
- Impacted Routes: Discord slash `/뮤엘`, `/해줘`; prefixed `뮤엘 ...`; stale `/만들어줘` interactions are handled only by a short-lived router grace fallback until one successful slash re-registration window closes.
- Impacted Services: `config/runtime/discordCommandCatalog.js`, `src/discord/commandDefinitions.ts`, `src/discord/runtime/chatSdkRuntime.ts`, `src/discord/runtime/commandRouter.ts`, `src/discord/commands/vibe.ts`, `src/discord/messages.ts`, `src/discord/commands/admin.ts`, `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/EXECUTION_BOARD.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: on the first deploy after this change, some Discord clients can still surface a cached `/만들어줘` command until slash sync propagation completes. The runtime keeps a literal grace-window fallback so those stale interactions still enter the vibe/session flow instead of returning `unknown command`. That fallback should be removed after one confirmed deploy plus slash re-registration window.
- Validation: `npx tsc --noEmit`; `vitest run src/discord/commands/vibe.test.ts src/discord/runtime/chatSdkRuntime.test.ts src/discord/muelEntrySurface.test.ts`; `npm run test:discord`

## 2026-04-18 - Owner Personalized Agent Orchestration Strategy Added

- Why: the repository had already documented the public-facing Muel super-agent tier and the operator/runtime continuity substrate, but it still lacked one canonical document that states the primary owner user should receive a much stronger personalized orchestration experience across Hermes, OpenJarvis, OpenClaw, compute, GUI, and delegated execution lanes.
- Scope: added a new owner-only strategy document, linked the higher-order Muel vision and public super-agent packaging docs to that owner tier, linked the operator service-bundle doc to the same boundary, and registered the document in the planning index and shared-knowledge backfill catalog.
- Impacted Routes: none
- Impacted Services: `docs/planning/OWNER_PERSONALIZED_AGENT_ORCHESTRATION.md`, `docs/planning/MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`, `docs/planning/MUEL_SUPER_AGENT_PRODUCT_PACKAGING.md`, `docs/front-uiux-handoff/MUEL_SUPER_AGENT_PRODUCT_EXPERIENCE.md`, `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation only. This makes the owner-only orchestration tier explicit without claiming that the public Muel product should expose the full control-plane topology to end users.
- Validation: markdown review against `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`, `scripts/local-ai-stack-control.mjs`, and planning index/catalog conventions

## 2026-04-18 - Muel Super Agent Packaging Strategy And UX Handoff Added

- Why: the repo already had a real super-agent facade and operator-facing service bundle packaging, but it still lacked the product-layer documentation that explains why Muel itself should be packaged as a super agent and what product-experience artifact should exist for that packaging.
- Scope: added a canonical planning document for Muel super-agent product packaging, added a companion front/UIUX handoff artifact, linked the higher-order Muel strategy and existing operator service-bundle doc to the new packaging layer, and registered the planning document in the shared-knowledge backfill catalog.
- Impacted Routes: none
- Impacted Services: `docs/planning/MUEL_SUPER_AGENT_PRODUCT_PACKAGING.md`, `docs/front-uiux-handoff/MUEL_SUPER_AGENT_PRODUCT_EXPERIENCE.md`, `docs/planning/MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`, `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`, `docs/front-uiux-handoff/README.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation only. This does not expose the current admin-only super-agent routes publicly, and it explicitly keeps public packaging separate from raw internal bundle IDs and operator jargon.
- Validation: markdown review against `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `src/services/superAgentService.ts`, and front/UIUX handoff conventions

## 2026-04-18 - Muel Vision, Roadmap, And Design Intent Codified As A Public Strategy Anchor

- Why: the repository had execution roadmaps and subsystem plans, but it still lacked a single public knowledge document that captured the user's actual long-term vision, roadmap horizons, and design intent. That made the project easy to misread as a Discord bot, a QA assistant, or a loose AI demo instead of an early substrate for a broader Muel-centered IP and service system.
- Scope: added a canonical strategy document that explains the user's higher-order vision, long-term company-facing direction, layered roadmap, and ownership boundaries; linked the existing short-term Muel service spine and the current execution roadmap back to that strategy anchor; registered the new document in the planning index and shared-knowledge backfill catalog.
- Impacted Routes: none
- Impacted Services: `docs/planning/MUEL_VISION_ROADMAP_AND_DESIGN_INTENT.md`, `docs/planning/MUEL_IDOL_SERVICE_SPINE.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation only. This clarifies strategic ownership and sequence without changing runtime behavior or active execution-board priority.
- Validation: markdown review against `docs/planning/MUEL_IDOL_SERVICE_SPINE.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, and planning index/catalog conventions

## 2026-04-18 - Muel Strategy Refined To Put Public-Ready Dense Communication Ahead Of Further Surface Expansion

- Why: the initial Muel service-spine baseline established Muel as the shared idol IP and public service face, but it still risked letting outward implementation run ahead of the one gate that matters first: whether Muel can already be shown openly as a serious agent for unspecified users.
- Scope: refined the canonical Muel strategy document so further idol, campaign, and service-surface expansion is explicitly gated behind a Phase 0 dense-communication readiness threshold, with acceptance criteria tied to community, support, and trust conversation quality.
- Impacted Routes: none
- Impacted Services: `docs/planning/MUEL_IDOL_SERVICE_SPINE.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation only. This tightens sequence and acceptance criteria for future work without changing the current execution board or runtime behavior.
- Validation: markdown review against `docs/planning/BETA_GO_NO_GO_CHECKLIST.md`, `docs/planning/EXECUTION_BOARD.md`, and the existing Muel service-spine strategy

## 2026-04-18 - Muel Idol Service Spine Added As A Short-Term IP And Service Strategy Baseline

- Why: the repo had already accumulated real persona, CRM, auth, automation, and quality surfaces around `Muel`, but the strategic layer still described Muel mostly as a bot or assistant name. That left the near-term product direction under-specified even though the user-facing intention had shifted toward making Muel the common idol IP and service face.
- Scope: added a strategy/reference planning document that reframes the current repository as the access, control, CRM, and automation substrate for a Muel-centered idol service spine; registered the document in the planning index and shared-knowledge backfill catalog.
- Impacted Routes: none
- Impacted Services: `docs/planning/MUEL_IDOL_SERVICE_SPINE.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation and shared-knowledge alignment only. This slice does not change runtime ownership, execution-board priority, or claim that the repository already owns OBS, VTuber runtime, or full merchandise operations.
- Validation: markdown review against current persona, CRM, auth, automation, and runtime-quality surfaces in the repo; JSON catalog syntax review

## 2026-04-18 - Continuity Packets And Goal Status Ignore Stale Dry-Run Session Headlines

- Why: an old `executing + dry_run` OpenJarvis workflow session with no active steps could keep its non-placeholder objective authoritative, leaving the safe queue and active execution-board objective correct underneath while the operator-facing handoff/progress/status headline still pointed at obsolete work.
- Scope: added a shared stale-session detector in workflow-state helpers, taught continuity packet sync to prefer the explicit safe-queue head or active execution-board objective when that stale condition is present, and aligned goal-status/session-open bundle objective resolution with the same rule.
- Impacted Routes: N/A
- Impacted Services: `scripts/openjarvis-workflow-state.mjs`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/run-openjarvis-goal-cycle.mjs`
- Impacted Tables/RPC: none
- Risk/Regression Notes: released sessions still honor the execution-board focus override as before; only long-stale dry-run executing sessions without active running steps lose headline authority, which prevents split-brain continuity packets without hiding live workstream state.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/internal.test.ts scripts/run-chat-sdk-discord-cutover-validation.test.ts`; `npm exec tsc -- --noEmit`; `npm run -s openjarvis:packets:sync`; `npm run -s openjarvis:goal:status`

## 2026-04-18 - Discord Cutover Rehearsal Now Captures Rollback Evidence For Both Eligible Surfaces

- Why: the cleanup lane was still blocked for the prefixed `muel-message` fallback branch because the cutover rehearsal only generated forced-fallback rollback evidence for `docs-command`, forcing operators to infer exact-unit readiness from neighboring surfaces.
- Scope: extended both the local validator helper and the service-role internal cutover exercise route so selected-path parity still runs for both eligible surfaces and rollback rehearsal now also forces the prefixed `muel-message` branch through the hard-disable fallback path.
- Impacted Routes: internal `POST /api/internal/discord/ingress/cutover/exercise`
- Impacted Services: `scripts/lib/chatSdkDiscordCutoverValidator.ts`, `scripts/run-chat-sdk-discord-cutover-validation.ts`, `src/routes/internal.ts`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/gate-runs/chat-sdk-cutover/README.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: aggregate rollback evidence now includes per-surface forced-fallback details for both `docs-command` and `muel-message`; this does not by itself satisfy the stricter production live artifact requirement for legacy removal, but it closes the local/operator rehearsal evidence gap.
- Validation: `npx vitest run src/routes/internal.test.ts scripts/run-chat-sdk-discord-cutover-validation.test.ts`; `npm exec tsc -- --noEmit`; `npm run -s gates:discord:cutover:dry -- --exerciseLiveEvidence=true`

## 2026-04-18 - Eligible Discord Surfaces Now Run Through Real Chat SDK Runtime Paths

- Why: the repo had already normalized the eligible Discord ingress seam and even used the `chat-sdk` label in cutover evidence, but the live code path still answered those surfaces through repo-local handlers without any real upstream Chat SDK runtime in the request path.
- Scope: added a real Chat SDK runtime backed by the official `chat` and `@chat-adapter/discord` packages, wired slash `/해줘` and `/뮤엘` plus prefixed `뮤엘 ...` through that runtime when Discord app credentials are present, defaulted the eligible ingress owner policy to `chat-sdk`, and cleared the execution-board single-objective override so the explicit safe queue can drive the requested migration -> cleanup -> roadmap order.
- Impacted Routes: Discord slash `/해줘`, `/뮤엘`; prefixed `뮤엘 ...`
- Impacted Services: `src/discord/runtime/chatSdkRuntime.ts`, `src/discord/runtime/commandRouter.ts`, `src/discord/commands/vibe.ts`, `src/config.ts`, `server.ts`, `docs/planning/EXECUTION_BOARD.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the real Chat SDK runtime is guarded by `DISCORD_CHAT_SDK_ENABLED`, `DISCORD_PUBLIC_KEY`, and `DISCORD_APPLICATION_ID`. If those are missing, the repo falls back to the preexisting legacy handlers instead of failing bot startup. Redis state is preferred when `REDIS_URL` is configured; otherwise the runtime uses in-memory state.
- Validation: `npx tsc --noEmit`; targeted Vitest for `src/discord/commands/docs.test.ts` and `src/discord/commands/vibe.test.ts`

## 2026-04-18 - Legacy Cleanup Lane Reclassified The First Discord Exact Unit To Rollback-Only

- Why: the original inventory lock correctly kept mass delete closed, but it still overstated uncertainty by leaving every Discord exact unit in `Keep-For-Now` even after live cutover artifacts had already closed predecessor evidence for the `docs.ask` fallback branch.
- Scope: refreshed the canonical legacy cleanup lane, the Discord adapter mapping inventory, the cutover validation contract, and the execution board so only the evidence-closed exact unit moves to `Rollback-Only`.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/LEGACY_CLEANUP_LANE.md`, `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/EXECUTION_BOARD.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation only. Whole-file removal and mass delete remain closed; the prefixed `muel-message` fallback branch still stays in `Keep-For-Now` until its own live rollback evidence exists.
- Validation: markdown review against `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-142211.json`, `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-144035.json`, and `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-161707.json`

## 2026-04-18 - Baseline Docs Synced To Live Discord Canary, Local n8n Closure, And Canonical Provider Lane

- Why: the canonical baseline docs were lagging behind three lanes that had already entered runtime reality. Operators still had to reconstruct from gate-run artifacts and runbook deltas what was live now versus what was still waiting on a full owner transition.
- Scope: synced `docs/planning/EXECUTION_BOARD.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, and this changelog so they distinguish entered state from pending owner-transition work across the Discord cutover, local n8n starter closure, and canonical provider lane.
- Impacted Routes: Discord slash `/해줘`, `/뮤엘`; prefixed `뮤엘 ...`; no new HTTP routes
- Impacted Services: `docs/planning/EXECUTION_BOARD.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: baseline docs now treat green live cutover evidence for the eligible Discord surfaces as already entered reality, but they keep full default-on, rollback grace-close, legacy demotion/removal, and phase 2 Discord surfaces explicitly outside the completed owner-transition boundary. Local n8n starter closeout and the canonical provider lane are now baseline reality rather than queued intent.
- Validation: doc review against `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-161707.md`, `docs/planning/gate-runs/chat-sdk-cutover/2026-04-17_chat-sdk-cutover-20260417-142211.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`

## 2026-04-17 - Discord Ingress Cutover Now Supports Live Runtime Policy Switching

- Why: the Discord cutover gate could prove ingress parity only inside the validator process. It still lacked a control plane that could switch the preferred adapter on a running process and then read back live selected-owner evidence from that same runtime.
- Scope: added file-backed Discord ingress runtime policy overrides, service-role protected internal cutover policy/exercise/snapshot routes, explicit `--applyLivePolicy=true` support in the cutover validator, and runbook updates for the live control-plane path.
- Impacted Routes: `GET /api/internal/discord/ingress/cutover/snapshot`, `POST /api/internal/discord/ingress/cutover/policy`, `POST /api/internal/discord/ingress/cutover/exercise`
- Impacted Services: `src/discord/runtime/discordIngressAdapter.ts`, `src/routes/internal.ts`, `scripts/lib/chatSdkDiscordCutoverValidator.ts`, `scripts/run-chat-sdk-discord-cutover-validation.ts`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: live runtime switching is explicit opt-in only. Standard cutover runs stay local unless `--applyLivePolicy=true` is passed with a reachable runtime base URL and service-role token. Rollback rehearsal still uses a temporary call-level override and does not persist a hard-disable into the canonical per-surface policy.
- Validation: `npx vitest run src/routes/internal.test.ts src/discord/runtime/discordIngressAdapter.test.ts scripts/run-chat-sdk-discord-cutover-validation.test.ts`; `npx tsc --noEmit`; `npm run gates:discord:cutover -- --applyLivePolicy=true --runtimeBaseUrl=http://127.0.0.1:3001 --preferredAdapterId=chat-sdk --rolloutPercentage=25 --docsShadowMode=false --muelShadowMode=false --docsHardDisable=false --muelHardDisable=false`

## 2026-04-17 - Local n8n Starter Lane Now Closes Through Approval-Gated Apply And Rollback

- Why: the local n8n automation lane could already draft reusable starter workflows and seed them locally, but deterministic tasks still stopped at draft or seed payload output. There was no approval-backed closure that turned a matched starter plan into an installable workflow with replayable rollback artifacts.
- Scope: added doctor normalization, dry-run install preview, operation-log capture, and rollback replay to the local n8n bootstrap script; added a thin approval/apply wrapper that reuses the existing action governance store; extended workflow drafts so matched starter tasks expose approval-gated install commands instead of draft-only metadata; updated the operator runbook and package command surface.
- Impacted Routes: N/A
- Impacted Services: `scripts/bootstrap-n8n-local.mjs`, `scripts/run-n8n-local-approval.ts`, `src/services/skills/actionGovernanceStore.ts`, `src/services/automation/apiFirstAgentFallbackService.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: `agent_action_approval_requests` reuse only, no schema changes
- Risk/Regression Notes: direct local seed still exists as breakglass maintenance, but the deterministic closeout path is now `preview -> request approval -> approve/apply -> rollback`. Automatic rollback and updateExisting remain tied to the public API lane, while docker CLI fallback still supports create or skip-existing only.
- Validation: targeted Vitest for bootstrap/governance/automation draft surfaces; `npx tsc --noEmit`

## 2026-04-17 - LLM Provider Default Lane Collapsed To OpenJarvis LiteLLM Ollama

- Why: the provider stack had drifted into a branched chain where OpenClaw, direct cloud providers, and Hugging Face could leak back into the default path through env profiles, Render defaults, and LiteLLM fallback aliases. That made the control-plane story harder to reason about and blurred the line between the default lane and experiment lanes.
- Scope: collapsed the canonical provider lane to `openjarvis -> litellm -> ollama`, pruned duplicated provider-order overrides from the main env profiles, removed the Render and worker-example pattern that used `OPENCLAW_BASE_URL` as a LiteLLM proxy surrogate, and tightened LiteLLM default fallbacks so the default front door no longer auto-mixes Hugging Face or NVIDIA opt-in aliases.
- Impacted Routes: none
- Impacted Services: `src/services/llm/routing.ts`, `src/configLlmProviders.ts`, `litellm.config.yaml`, `src/services/llmClient.test.ts`, `render.yaml`, `config/env/*.profile.env`, `config/env/*worker*.env.example`, `docs/ARCHITECTURE_INDEX.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the default lane now assumes OpenJarvis is the control surface whenever it is enabled, LiteLLM is the remote broker, and Ollama is the direct local fallback. Direct cloud providers, Hugging Face, and OpenClaw direct-completion surfaces still work, but only as explicit opt-in lanes or as the compatibility escape hatch when the canonical lane is unavailable.
- Validation: targeted Vitest for `src/services/llmClient.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Personal Operating System Service Bundles Added On The Existing Super-Agent Surface

- Why: the repository already had the primitives for routing, bounded execution, knowledge distillation, and weekly reporting, but operators still had to know the raw internal surfaces. That kept the repo feeling like an agent lab instead of a callable personal operating system.
- Scope: added a named personal service bundle catalog to the existing `superAgentService`, exposed bundle catalog/detail/recommend/session routes under the existing `/agent/super/*` namespace, and documented the bundle layer in the runtime matrix plus a dedicated operator doc.
- Impacted Routes: `GET /api/bot/agent/super/services`, `GET /api/bot/agent/super/services/:serviceId`, `POST /api/bot/agent/super/services/:serviceId/recommend`, `POST /api/bot/agent/super/services/:serviceId/sessions`
- Impacted Services: `src/services/superAgentService.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: none
- Risk/Regression Notes: packaging layer only. The new surface reuses the existing super-agent, action, runtime, and report primitives and does not introduce a new orchestration engine.
- Validation: `npx vitest run src/services/superAgentService.test.ts src/routes/botAgentGovernance.test.ts src/routes/botAgentRoutes.smoke.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Legacy Cleanup Lane Now Locks Inventory Before Post-Replacement Deletion

- Why: the repo still has multiple legacy or compatibility surfaces across Discord ingress, provider aliases, naming aliases, control-plane bootstrap glue, and deterministic inline fallbacks. Deleting them ad hoc would risk collapsing live rollback or compatibility boundaries before their replacement lanes are actually closed.
- Scope: added a canonical cleanup-lane plan that classifies the remaining buckets as Remove-Now, Rollback-Only, or Keep-For-Now; linked the lane from the execution board; and registered the plan for shared-knowledge backfill.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/LEGACY_CLEANUP_LANE.md`, `docs/planning/EXECUTION_BOARD.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation and shared-knowledge alignment only. The lane explicitly keeps deletion closed until predecessor lanes prove replacement-complete for the exact unit being removed.
- Validation: markdown review; JSON catalog syntax review

## 2026-04-17 - Eligible Discord Chat Surfaces Now Run Through A Normalized Ingress Seam

- Why: the Chat SDK migration boundary was documented, but the live repo still routed the eligible chat surfaces directly through surface-local logic. That left no single runtime seam for adapter selection, evidence capture, canary/rollback policy, or future Chat SDK insertion.
- Scope: introduced a normalized Discord ingress layer with per-surface policy and evidence tracking, rewired the slash docs and prefixed `뮤엘 ...` surfaces through that seam, and added per-surface config controls for preferred adapter, hard-disable, shadow mode, and rollout percentage.
- Impacted Routes: Discord slash `/해줘`, `/뮤엘`; prefixed `뮤엘 ...`
- Impacted Services: `src/discord/runtime/discordIngressAdapter.ts`, `src/discord/runtime/commandRouter.ts`, `src/discord/commands/docs.ts`, `src/discord/commands/vibe.ts`, `src/config.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: non-target Discord surfaces remain unchanged. Private threads still skip continuity enqueue, and the eligible surfaces preserve deterministic fallback to the current handlers when the preferred adapter is declined, held out, hard-disabled, or fails.
- Validation: `npx vitest run src/discord/runtime/discordIngressAdapter.test.ts src/discord/commands/docs.test.ts src/discord/commands/vibe.test.ts`; `npm run test:discord`; `npx tsc --noEmit`

## 2026-04-17 - Knowledge Compiler Added Supervisor Artifact And Broader Durable-Root Scanning

- Why: knowledge control could emit index, log, and lint artifacts, but it still lacked a machine-readable follow-up surface saying what to fix next. Snapshot selection also under-scanned durable shared roots, which made control artifacts less useful outside the narrow chat-answer/memory slice.
- Scope: expanded tracked and candidate knowledge roots, added a `SUPERVISOR.md` artifact with prioritized follow-up actions, exposed that artifact through the knowledge-control surface, and kept semantic-lint persistence from recursively triggering another compile.
- Impacted Routes: MCP knowledge-control artifact selection for `artifact=supervisor`
- Impacted Services: `src/services/obsidian/knowledgeCompilerService.ts`, `src/services/obsidian/authoring.ts`, `src/mcp/obsidianToolAdapter.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive knowledge-control surface only. Generated knowledge artifacts now allow high link density and semantic-lint writes skip recursive recompilation so the supervisor/lint flow does not churn itself.
- Validation: `npx vitest run src/services/obsidian/knowledgeCompilerService.test.ts src/mcp/obsidianToolAdapter.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Capability Audit Exit Stances Codified For LiteLLM And OpenClaw

- Why: Session A needed a hard line between true blockers and intentionally optional lanes. LiteLLM was still modeled as a controller-side always-on requirement even though runtime docs treated it as an opt-in remote provider lane, and capability audit findings for OpenClaw, Hermes local skills, DeepWiki, and probe coverage were still emitted as unresolved findings instead of documented stances.
- Scope: demoted `litellmProxy` out of the always-on operating baseline, added baseline-carried capability-audit acknowledgements, taught `capability:audit` to separate active findings from documented optional/accepted states, and aligned the runtime matrix, runbook, and capability-gap docs around the same stance.
- Impacted Routes: N/A
- Impacted Services: `config/runtime/operating-baseline.json`, `src/services/runtime/operatingBaseline.ts`, `scripts/audit-capability-availability.ts`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/planning/CAPABILITY_GAP_ANALYSIS.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: LiteLLM direct proxy health remains visible as an opt-in remote provider lane, but it no longer gates controller-side always-on readiness. OpenClaw gateway health remains optional ingress-only until the chat surface is restored.
- Validation: `npx vitest run src/services/runtime/operatingBaseline.test.ts`; `npm run -s capability:audit:markdown`; `npx tsc --noEmit`

## 2026-04-17 - Discord Cutover Live Gate Now Collects Its Own Live Evidence

- Why: the cutover validator could already separate lab vs live counters, but Session B was still stuck because the canonical surface policy was being overwritten by rollback rehearsal events, public `/health` had no canonical scheduler summary for external runtime evidence, and the non-dry live gate still depended on pre-existing live traffic instead of being able to open its own bounded operator window.
- Scope: exposed `schedulerPolicySummary` from public health, stopped Discord ingress evidence recording from mutating the canonical per-surface policy snapshot, taught the cutover validator to operator-drive live selected-path plus forced-fallback evidence by default on non-dry runs, and updated the cutover validation/runbook docs to make the live-vs-lab decision contract explicit.
- Impacted Routes: `/health`
- Impacted Services: `src/routes/health.ts`, `src/contracts/bot.ts`, `src/discord/runtime/discordIngressAdapter.ts`, `src/discord/runtime/discordIngressAdapter.test.ts`, `scripts/run-chat-sdk-discord-cutover-validation.ts`, `scripts/run-chat-sdk-discord-cutover-validation.test.ts`, `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`, `docs/planning/gate-runs/chat-sdk-cutover/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: public health now carries only the canonical scheduler summary counts, not the full scheduler-policy item list. Rollback rehearsal telemetry still records `policyMode=rollback` per event, but the persisted canonical surface policy now stays tied to explicit prime/update calls so one rehearsal cannot silently flip the reported live control state.
- Validation: `npx vitest run src/routes/health.test.ts src/discord/runtime/discordIngressAdapter.test.ts scripts/run-chat-sdk-discord-cutover-validation.test.ts`; `npx tsc --noEmit`; `npm run gates:discord:cutover`

## 2026-04-17 - Future Control-Plane Planner Now Emits Structured Session Synthesis

- Why: the queue-aware future planner could already say whether the next safe step was stabilize, seed, launch, or close out, but it still left one high-leverage decision implicit: which bounded session shape should open next and which execution lane should carry it. That kept Copilot relaunch viable, but it still forced ad hoc child-lane choreography for GUI, remote-compute, and bounded-wave work.
- Scope: extended `scripts/local-ai-stack-control.mjs` so `buildFutureControlPlanePlan()` now emits a structured `sessionSynthesis` block with session kind, observed and planned queue mode, launch objective, coordinator contract, bounded Copilot handoff mode, primary execution lane, and bounded child-turn choreography; added focused regression coverage in `scripts/local-ai-stack-control.test.ts`; updated the dual-agent orchestration plan, Multica control-plane playbook, and unified runbook so the new structured output becomes the canonical bridge between OpenJarvis queue state and visible child-lane execution.
- Impacted Routes: N/A
- Impacted Services: `scripts/local-ai-stack-control.mjs`, `scripts/local-ai-stack-control.test.ts`, `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive planning output only. The future planner still does not create a new runtime owner and still fails closed to `hermes-local-operator` unless the objective explicitly signals GUI/browser or remote-heavy scope.
- Validation: `npx vitest run scripts/local-ai-stack-control.test.ts`

## 2026-04-17 - Shared Wrapper Bootstrap And Discord Cutover Lab Evidence Added

- Why: the previous hardening wave made shared-MCP readiness fail closed and froze the Discord ingress migration boundary, but the remaining operator gap was still practical rather than conceptual. `MCP_SHARED_MCP_URL` alone did not give teammates a reusable `upstream.gcpcompute.*` lane, and the cutover validator still had no low-risk rehearsal mode that could prove parity and rollback paths without polluting live evidence.
- Scope: added `scripts/ensure-shared-mcp-upstream.mjs` plus package aliases so `.env` can upsert the canonical `gcpcompute` wrapper lane from the shared `/mcp` ingress automatically; taught `proxyRegistry` to reuse shared MCP auth tokens for that wrapper lane without duplicating secrets into `MCP_UPSTREAM_SERVERS`; extended `discordIngressAdapter` and the cutover validator so lab rehearsal evidence is tracked separately from live evidence; updated `local-ai-stack-control.mjs`, runbook guidance, and profile/env examples so Obsidian packet sync and the new bootstrap/rehearsal commands surface directly in operator flows.
- Impacted Routes: N/A
- Impacted Services: `src/mcp/proxyRegistry.ts`, `src/mcp/proxyAdapter.test.ts`, `scripts/ensure-shared-mcp-upstream.mjs`, `scripts/audit-capability-availability.ts`, `src/discord/runtime/discordIngressAdapter.ts`, `src/discord/runtime/discordIngressAdapter.test.ts`, `scripts/run-chat-sdk-discord-cutover-validation.ts`, `scripts/local-ai-stack-control.mjs`, `scripts/local-ai-stack-control.test.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `config/env/local-first-hybrid.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`, `.env.example`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive control-plane hardening only. Shared wrapper bootstrap now derives the correct simple-proxy base from the canonical shared ingress instead of asking operators to hand-write JSON, and cutover lab rehearsal no longer contaminates live no-go evidence because the snapshot tracks live vs lab counters separately.
- Validation: `npx vitest run src/mcp/proxyAdapter.test.ts src/discord/runtime/discordIngressAdapter.test.ts scripts/local-ai-stack-control.test.ts`; `node scripts/ensure-shared-mcp-upstream.mjs --dryRun=true`; `npm run gates:discord:cutover:lab:dry`

## 2026-04-17 - Queue-Aware Supervisor Swarm Mode Added

- Why: the bounded swarm substrate already existed, but the live supervisor/control-plane layer still only knew how to relaunch a single queued chat turn. That meant the new swarm worker model stopped at the low-level launch helper instead of becoming a restart-safe operator workflow.
- Scope: extended `run-openjarvis-goal-cycle.mjs` with explicit queue swarm mode, worktree/distiller restart flags, queued swarm status payloads, and swarm-aware pause boundaries; extended `ack-openjarvis-reentry.ts` so queue swarm mode survives reentry restart; extended `local-ai-stack-control.mjs` so future planning recommends `queue:chat` vs `queue:swarm` from live supervisor mode; extended `localAutonomySupervisorService` and runtime remediation command building so detached self-heal restarts preserve queue swarm mode instead of silently downgrading to chat; added `openjarvis:autopilot:queue:swarm` scripts and updated runbook/operating-plan docs.
- Impacted Routes: N/A
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/run-openjarvis-hermes-runtime-control.ts`, `scripts/ack-openjarvis-reentry.ts`, `scripts/local-ai-stack-control.mjs`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/runtime/localAutonomySupervisorService.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive only. Queue-chat remains the default single-turn relaunch path, and the CLI now fails closed if both queue-chat and queue-swarm modes are enabled at the same time. Swarm restart state preserves explicit executor worktree and artifact budget settings instead of silently downgrading back to chat mode.
- Validation: `npx vitest run scripts/ack-openjarvis-reentry.test.ts scripts/local-ai-stack-control.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts src/services/runtime/localAutonomySupervisorService.test.ts`; `npx tsc --noEmit`; `npm run -s openjarvis:autopilot:queue:swarm:dry`

## 2026-04-17 - Hermes Bounded Swarm Launch And Closeout Wiring Added

- Why: the runtime already had queue-aware GPT relaunch, role-bounded Hermes context profiles, and reentry acknowledgment, but it still lacked the actual execution substrate for opening multiple bounded GPT workers from one coordinator turn. The new local operating plan required a swarm board, shard packets, worktree-safe launch roots, and closeout metadata that survives across worker turns.
- Scope: extended `openjarvisHermesRuntimeControlService` with swarm board/shard artifact generation, bounded multi-launch orchestration, and swarm closeout recording; extended `hermesVsCodeBridgeService` so allowed roots can include isolated worktree paths for worker sessions; extended `ack-openjarvis-reentry.ts` to carry wave/shard metadata and update swarm closeout artifacts; added `openjarvis:hermes:runtime:swarm-launch` scripts; updated the runtime contract doc with the bounded parallel worker rule.
- Impacted Routes: N/A
- Impacted Services: `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/runtime/hermesVsCodeBridgeService.ts`, `scripts/run-openjarvis-hermes-runtime-control.ts`, `scripts/ack-openjarvis-reentry.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: bounded additive feature only. Single-ingress compatibility mode remains intact; swarm launch is opt-in and capped at three workers. Worktree-isolated roots are allowlisted explicitly rather than widening the VS Code bridge globally.
- Validation: `npx vitest run src/services/runtime/hermesVsCodeBridgeService.test.ts src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts scripts/ack-openjarvis-reentry.test.ts`; `npx tsc --noEmit`; `npm run -s openjarvis:hermes:runtime:swarm-launch:dry -- --waveObjective="stabilize shared wrapper readiness"`

## 2026-04-17 - Capability Audit Added And Shared MCP Wrapper Readiness Now Fails Closed

- Why: the repo already had operating-baseline docs, low-level tool probes, adapter status, and automation catalogs, but there was still no single capability-engineering surface that said which lanes were truly unlocked, which were merely guardrailed, and which looked wired only because a raw remote URL existed. The biggest live false-green was shared MCP: the canonical URL could be set while no `upstream.<namespace>.*` wrapper lane was actually active.
- Scope: hardened `buildGcpNativeAutopilotContext()` so shared-MCP readiness now distinguishes raw remote URL wiring from actual `MCP_UPSTREAM_SERVERS` wrapper activation, added a unified `scripts/audit-capability-availability.ts` audit surface plus package aliases, expanded `docs/planning/CAPABILITY_GAP_ANALYSIS.md` with the 2026-04-17 live unlock snapshot/order/guardrails, and registered that doc in `config/runtime/knowledge-backfill-catalog.json` for shared wiki promotion.
- Impacted Routes: N/A
- Impacted Services: `scripts/lib/openjarvisAutopilotCapacity.mjs`, `scripts/lib/openjarvisAutopilotCapacity.test.ts`, `scripts/audit-capability-availability.ts`, `package.json`, `docs/planning/CAPABILITY_GAP_ANALYSIS.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive operator/control-plane hardening only. Always-on raw URLs still count as service wiring, but shared wrapper readiness now fails closed until `MCP_UPSTREAM_SERVERS` exposes at least one enabled namespace. The new capability audit is diagnostic only and does not mutate runtime state.
- Validation: `npx vitest run scripts/lib/openjarvisAutopilotCapacity.test.ts`; `npx tsc --noEmit`; `npm run capability:audit`; `npm run capability:audit:markdown`

## 2026-04-17 - Discord Chat SDK Migration Boundary Frozen For Incremental Channel Ingress Refactor

- Why: M-24 already declared that Discord should become a channel-ingress abstraction rather than the permanent runtime owner, but the repo still lacked one concrete boundary document saying exactly what moves into the adapter seam, what stays Discord-native, and which legacy files become removal candidates only after live cutover proof.
- Scope: expanded `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md` from a command mapping reference into the concrete boundary-definition document for the incremental Discord -> Chat SDK migration path; froze the first migrated surfaces to `docs.ask` plus prefixed `뮤엘 ...`; documented the transport envelope/sink contract, non-goals, phased migration sessions, and legacy removal candidates; and registered the document in `config/runtime/knowledge-backfill-catalog.json` for shared-knowledge ingestion.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/DISCORD_ADAPTER_CORE_COMMAND_MAPPING_V1.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation and knowledge-catalog alignment only. No runtime behavior changed in this slice, and the boundary explicitly forbids a big-bang replacement of bot lifecycle, slash registration, passive memory, guild lifecycle, or other Discord-native operational surfaces.
- Validation: markdown review; JSON catalog syntax review

## 2026-04-17 - Capability Demand Events Now Preserve Structured Evidence Ref Details

- Why: `capability_demand.evidence_refs` still collapsed supporting evidence down to locator strings even after `artifact_ref` hot-state had gained `artifact_plane` and `github_settlement_kind`. That left blocked-route and missing-capability history unable to preserve whether a cited repo artifact was a repo file, commit, pull request, CI run, or other GitHub settlement form.
- Scope: extended workflow capability-demand types and closeout generation to carry additive `evidenceRefDetails`, taught workflow persistence to serialize and parse `payload.demands[*].evidence_ref_details` with legacy locator backfill, and projected the same detail block through OpenJarvis autopilot status plus session-open bundles.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`, `automation.session_open_bundle`
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceTransforms.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunnerWorkflowCloseout.ts`, `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunner.test.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: no new table or RPC contract added; `public.workflow_events.payload.demands[*]` may now include additive `evidence_ref_details` entries while `evidence_refs` remains for compatibility
- Risk/Regression Notes: additive payload change only. Existing callers can keep reading `evidence_refs`, and legacy rows backfill structured details from locator strings so old demand history still renders repo-file, GitHub, log, vault-note, and workflow-session hints without a data migration.
- Validation: `npx vitest run src/services/skills/actionRunner.test.ts src/services/workflow/workflowPersistenceService.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Workflow Artifact Refs Now Distinguish GitHub Settlement Kind

- Why: `artifact_plane=github` was enough to distinguish repo-visible settlement from external evidence, but it still left branch, commit, pull request, issue, and CI-run forms collapsed into one plane-level label. That meant hot-state and session-open bundles still lost the exact GitHub settlement form that operators and Hermes handoff notes need.
- Scope: added additive `github_settlement_kind` metadata to workflow artifact-ref payload entries, inferred it for legacy rows from existing locators and ref kinds, taught the source action-artifact extractor to emit explicit plane and GitHub settlement metadata for new refs, projected it through OpenJarvis autopilot status and session-open evidence refs, and surfaced the richer label in Hermes runtime handoff notes when the GitHub form adds information beyond the base ref kind.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`, `automation.session_open_bundle`
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceTransforms.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunnerArtifacts.ts`, `src/services/skills/actionRunner.test.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: no new table or RPC contract added; `public.workflow_events.payload.refs[*]` may now include additive `github_settlement_kind` metadata when the artifact plane resolves to GitHub
- Risk/Regression Notes: additive payload change only. Existing callers can keep omitting the field because persistence and runtime projection infer repo-file, branch, commit, pull-request, issue, CI-run, review, and release shapes from the current locator/ref-kind patterns.
- Validation: `npx vitest run src/services/workflow/workflowPersistenceService.test.ts src/services/skills/actionRunner.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Workflow Artifact Refs Now Carry Artifact Plane Metadata

- Why: hot-state already persisted structured `artifact_ref` rows, but those refs still forced downstream consumers to guess whether a repo path or URL belonged to the GitHub settlement plane, Obsidian durable notes, or an external surface. That left the multi-plane model explicit in planning prose while the runtime artifact objects themselves stayed under-specified.
- Scope: added additive `artifact_plane` metadata to workflow artifact-ref payload entries, inferred it for legacy rows and unchanged callers, and projected the same field through OpenJarvis autopilot status plus session-open evidence refs.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`, `automation.session_open_bundle`
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceTransforms.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: no new table or RPC contract added; `public.workflow_events.payload.refs[*]` may now include additive `artifact_plane` metadata
- Risk/Regression Notes: additive payload change only. Existing callers can keep omitting the field because persistence and runtime projection infer GitHub for repo files and git refs, Obsidian for vault notes, hot-state for workflow sessions/logs, and external for non-GitHub URLs.
- Validation: `npx vitest run src/services/workflow/workflowPersistenceService.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/botAgentObsidianRuntime.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Workflow Draft Stages Now Model GitHub Artifact Settlement

- Why: the multi-plane planner already exposed GitHub as the artifact and review plane in route previews and optimizer state owners, but `automation.workflow.draft` still collapsed closeout into the hot-state ledger. That made it too easy for unattended workflow drafts to imply that repo-visible settlement lived in Supabase or Obsidian instead of on GitHub.
- Scope: extended workflow draft stage ownership with an explicit GitHub artifact-settlement stage, separated hot-state closeout from repo-visible artifact settlement, updated the direct workflow-draft and optimizer-plan tests, and documented the stage split in the GPT/Hermes operating plan.
- Impacted Routes: `automation.workflow.draft`; embedded `workflowDraft` output inside `automation.optimizer.plan`
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive planner-output change only. Existing callers still receive the same draft shape, but stage owners now make the GitHub settlement boundary explicit so hot-state closeout, repo-visible artifacts, and durable promotion are no longer implied to share one owner.
- Validation: `npx vitest run src/services/automation/apiFirstAgentFallbackService.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - Unified Local Control-Plane Doctor Added For Multica Hermes Copilot And OpenJarvis

- Why: the repository already had separate local stack doctor surfaces, Hermes bridge diagnostics, OpenJarvis goal status, and a Multica playbook, but there was still no single repo-owned entrypoint that told the operator whether the visible coordination plane, local continuity lane, bounded VS Code chat relay, and detached self-heal loop were all actually usable together.
- Scope: extended `scripts/local-ai-stack-control.mjs` with an opt-in control-plane overlay that probes Multica CLI/playbook availability, Hermes quick chat health, Hermes VS Code bridge readiness for bounded `code chat` relaunch, OpenJarvis goal status, and detached local autonomy supervisor state; added phased activation-plan output with entry and exit criteria; taught the `up` path to start the detached local autonomy supervisor when this overlay is enabled; exposed canonical `local:control-plane:*` package scripts; and documented the new entrypoint in the platform runbook.
- Impacted Routes: N/A
- Impacted Services: `scripts/local-ai-stack-control.mjs`, `scripts/local-ai-stack-control.test.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the new overlay is opt-in and does not change the existing `local:stack:*` flows unless `--controlPlane=true` or the new `local:control-plane:*` aliases are used. Multica remains validation-only here and is not auto-started; VS Code Copilot remains a bounded transport surface and is not turned into a state owner. The only new auto-start behavior is the detached local autonomy supervisor behind the explicit control-plane `up` path.
- Validation: `npx vitest run scripts/local-ai-stack-control.test.ts`; `npx tsc --noEmit`; `npm run local:control-plane:doctor`; `npm run local:control-plane:up:dry`

## 2026-04-17 - Future Control-Plane Cadence Surfaced As A Repo-Owned Plan Command

- Why: the new unified control-plane doctor could tell whether the local coordination and continuity surfaces were healthy, but operators still had to remember the follow-up sequence from memory: when to reseed the queue, when to relaunch the next bounded VS Code chat, and when to close a GPT turn back into hot-state. That made the current slice usable once, but not yet repeatable as an ongoing process.
- Scope: extended `scripts/local-ai-stack-control.mjs` with a `future` action that reads the current control-plane report and turns it into a future-cycle cadence plan; exposed a canonical `local:control-plane:future` script; added a package script for `openjarvis:hermes:runtime:queue-objective:auto`; documented the six-step follow-up cadence in the main runbook; and added unit coverage for the new planning surface.
- Impacted Routes: N/A
- Impacted Services: `scripts/local-ai-stack-control.mjs`, `scripts/local-ai-stack-control.test.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this is a planning and operator-cadence surface only. It does not auto-launch a new Copilot chat or auto-ack a GPT turn by itself. Instead it makes the safe sequence explicit so future local cycles reuse the same bounded commands and ownership model.
- Validation: `npx vitest run scripts/local-ai-stack-control.test.ts`; `npx tsc --noEmit`; `npm run local:control-plane:future`

## 2026-04-17 - Live OpenJarvis Autopilot Entrypoints Now Opt Out Of Dry-Run Explicitly

- Why: the repo already had queue-aware OpenJarvis and Hermes reentry paths, but the package entrypoints still inherited `run-openjarvis-goal-cycle.mjs`'s safe default of `dryRun=true`. That meant operator-facing commands such as `openjarvis:autopilot:queue:chat` looked live, opened visible monitoring surfaces, and still failed to execute the actual bounded mutation path. This was one of the concrete reasons the local stack still felt under-leveraged even after the runtime wiring existed.
- Scope: updated the live `openjarvis:goal:*` and `openjarvis:autopilot:*` package scripts to pass `--dryRun=false` explicitly, added matching `:dry` inspection aliases, documented the live-vs-dry contract in the GPT-Hermes operating plan and platform runbook, and extended the Multica control-plane playbook with a four-surface leverage-recovery sequence that ties Multica, Hermes, OpenJarvis, and VS Code Copilot into one repeatable flow.
- Impacted Routes: none
- Impacted Services: `package.json`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this intentionally changes operator-facing package behavior from inspection-default to live-default for the non-`:dry` OpenJarvis goal/autopilot entrypoints. The new `:dry` aliases preserve the prior safe inspection path, so rollback is to use those aliases or revert the package script lines.
- Validation: `npm run openjarvis:autopilot:queue:chat`; `npm run openjarvis:goal:status`; `npx tsc --noEmit`
- Follow-up hardening in the same change window: updated the future control-plane planner so it now treats an actively executing workflow as a monitor boundary instead of incorrectly recommending another immediate GPT relaunch, and it now flags `auto_launch_queued_chat=false` on the live Hermes supervisor as queue-chat mode drift that should be repaired at the next safe boundary.

## 2026-04-17 - Continuity Packet Watch-State Now Prefers The Detached Local Autonomy Watcher

- Why: the repo already exposed both a detached local autonomy watcher and a one-shot `local:autonomy:supervisor:once` check, but both shared the same status artifact. That made continuity packet sync prefer the most recent one-shot PID, so a harmless foreground check could briefly make `continuity_watch_alive=false` even while the real detached watcher was still healthy.
- Scope: hardened `resolveLocalAutonomyWatchState` so continuity packet sync now prefers the detached manifest PID when a non-detached one-shot status payload is newer, added a regression test covering that precedence rule, and updated the runbook so operators know that `:once` refreshes summary state without hiding the real detached watcher.
- Impacted Routes: none
- Impacted Services: `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive observability hardening only. Detached watcher liveness now stays stable in continuity packets after a foreground check, while summary text still comes from the most recent status payload.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts`; `npx tsc --noEmit`; `npm run openjarvis:packets:sync -- --reason=post-watch-state-fix`

## 2026-04-17 - Multi-Plane Runtime Guidance Surfaced In Automation Catalog And Hermes Launch Context

- Why: ADR-008 and the architecture docs had already fixed the multi-plane ownership model, but the live automation planning surface still did not expose GitHub as an explicit artifact/review plane and Hermes delegated launches were not yet guaranteed to read the new decision and Multica playbook before broad repo archaeology.
- Scope: updated the API-first and agent-fallback automation catalog, optimizer plan, continuity-packet route serialization, session-open bundle, and activation-pack read-next bundle to model GitHub as a first-class artifact/review plane alongside Supabase hot-state and Obsidian semantic ownership; added the same plane split to runtime guardrails and asset delegation; wired Hermes scout, delegated-operator, and executor launches to include ADR-008 and the Multica control-plane playbook in their context candidates; and surfaced the same route ownership in Hermes runtime handoff notes.
- Impacted Routes: `automation.capability.catalog`, `automation.route.preview`, `automation.optimizer.plan`, `automation.session_open_bundle`, continuity packet sync output, Hermes VS Code launch prompts, Hermes runtime handoff notes
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: this remains a control-surface hardening slice, not a broad runtime migration. GitHub is now explicit in planning and runtime launch guidance as the artifact/review plane, but Supabase still owns mutable workflow state and Obsidian still owns durable semantic meaning.
- Validation: targeted Vitest for the automation catalog/optimizer service, continuity/session-open smoke coverage, and Hermes runtime control service; `npx tsc --noEmit`.

## 2026-04-17 - Multi-Plane Operating Model Canonicalized

- Why: the repo had already drifted toward a stronger operating split where Multica handles visible coordination, shared Obsidian owns durable meaning, Supabase plus n8n own hot-state workflow execution, GitHub owns artifact and review settlement, and agent runtimes act as pluggable worker lanes. That shape had been discussed, but it was not yet fixed in the repo's canonical decision and indexing surfaces.
- Scope: added a repo ADR compatibility stub for the multi-plane operating model, aligned Architecture Index ownership language and adoption order, updated the Platform Control Tower intake rules and canonical ownership table, expanded the Multica playbook's plane split to include workflow routers and GitHub, registered the shared backfill target, and indexed the new canonical surfaces in the planning README.
- Impacted Routes: N/A
- Impacted Services: `docs/adr/ADR-008-multi-plane-operating-model.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/PLATFORM_CONTROL_TOWER.md`, `docs/planning/README.md`, `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation and control-surface alignment only. This does not claim that the full runtime migration is already implemented. It only fixes the ownership model and rollout order the repo should now use when future runtime work lands.
- Validation: shared `requirement.compile` promotion for the decision artifact; VS Code diagnostics check for updated Markdown and JSON files.

## 2026-04-17 - LiteLLM Remote NVIDIA Reasoning Alias Expansion

- Why: the current workstation-local lanes are still the primary default, but the repo needed a narrower and more defensible next step for remote delegation posture: add larger NVIDIA-hosted reasoning and code-capable model aliases without changing the default provider order or claiming that the broader agent operating model is already production-shaped.
- Scope: added opt-in LiteLLM aliases for Gemma 4 31B, Qwen coder 32B and 480B, and Nemotron Ultra 253B; documented the expanded NVIDIA NIM alias surface in the runtime matrix.
- Impacted Routes: N/A
- Impacted Services: `litellm.config.yaml`, `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: existing defaults (`muel-balanced`, `muel-fast`, `muel-precise`, local Ollama lanes, provider order) remain unchanged. The new aliases are opt-in only and still require `NVIDIA_NIM_API_KEY`. NVIDIA build/NIM trial surfaces may log prompts and outputs under their API trial terms, so these lanes should be treated as non-confidential until a separate policy decision changes that.
- Validation: NVIDIA NIM model ID verification against `docs.api.nvidia.com` for `google/gemma-4-31b-it`, `qwen/qwen2.5-coder-32b-instruct`, `qwen/qwen3-coder-480b-a35b-instruct`, and `nvidia/llama-3.1-nemotron-ultra-253b-v1`; VS Code diagnostics check for updated YAML/Markdown files.

## 2026-04-17 - Multica Local Control Plane Baseline Retired LM Studio Backend

- Why: the Multica pilot had a hidden dependency on an old LM Studio-style Hermes endpoint at `http://127.0.0.1:1234/v1`, which produced empty-output failures and obscured the real local control-plane baseline. After retiring that path, the next blocker was agent drift: child-issue runs were summarizing `multica issue get` JSON, falling back to generic assistant chat, or invoking irrelevant local tools instead of executing the bounded validation request.
- Scope: documented the Multica local runtime baseline and the issue-execution contract so the canonical workflow now treats LM Studio as retired for this control-plane path, keeps Hermes behind local Ollama, and requires child-lane agents to execute the issue request directly instead of echoing task metadata, spawning local todo placeholders, looping on session-inspection tools, or drifting into irrelevant vision/edit-tool calls. The local wrapper baseline also now records that OpenClaw JSON validation on this workstation should normalize onto a repo-specific isolated agent workspace plus a visible `multica` CLI shim instead of trusting daemon-provided `--session-id` reuse against the default main workspace.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: the canonical local Multica workflow no longer assumes an LM Studio endpoint on port `1234`. `Hermes Local` should use a verified local Ollama OpenAI-compatible endpoint, and the local ACP wrapper may still need a deliberately narrow disabled-tool surface for bounded validation runs on this workstation, including vision and edit tools that can fire even when the issue forbids repo mutation. `OpenClaw Local` also should not trust daemon-provided raw `--session-id` execution for stateless JSON checks on this workstation; normalize those checks through a repo-specific isolated agent workspace and keep the local `multica` CLI discoverable on PATH or the lane will fail before it reads the assigned issue.
- Validation: WSL Hermes config inspection, direct ACP session construction checks for disabled-tool filtering, local `Hermes: Quick Local Check`, OpenClaw isolated-agent workspace smoke, manual issue-style OpenClaw wrapper repro after adding the `multica` PATH shim, and Multica daemon log review

## 2026-04-17 - Session Policy-Gate Block Handling Moved Behind Session Prelude Helper

- Why: `multiAgentService.ts` still duplicated policy-gate block terminalization in both the main pipeline and the primary LangGraph handler map. The transition logic already lived in `sessionPrelude.ts`, but the block-result completion path still sat in the host facade.
- Scope: extended `langgraph/sessionRuntime/sessionPrelude.ts` with a reusable policy-gate state helper that applies the transition, terminalizes blocked sessions, and touches allowed sessions; rewired both `executeSessionWithMainPipeline()` and the primary LangGraph `policy_gate` handler in `multiAgentService.ts`; and added focused coverage in `sessionPrelude.test.ts`.
- Impacted Routes: none; task-policy gating and blocked-session messaging remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: host queue ownership, non-task completion, and terminal session persistence remain in the same layers. This slice only removes duplicated policy-block completion wiring from the facade.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`, `src/services/langgraph/sessionRuntime/branchRuntime.test.ts`, and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - LangGraph Requested-Skill And Fast-Path State Writers Moved Behind Branch Runtime Wrappers

- Why: `multiAgentService.ts` still owned the last requested-skill and fast-path shadowGraph state mutations in the primary LangGraph handler map even though the underlying execution and refine primitives already lived in `branchRuntime.ts`. That kept the host facade responsible for `executionDraft` and `finalCandidate` writes that belong with branch-runtime node behavior.
- Scope: extended `langgraph/sessionRuntime/branchRuntime.ts` with stateful requested-skill and fast-path wrappers, rewired the primary LangGraph handler map in `multiAgentService.ts` to delegate to them, and added focused coverage for the new wrapper surface in `branchRuntime.test.ts`.
- Impacted Routes: none; requested-skill and fast-path runtime behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/branchRuntime.ts`, `src/services/langgraph/sessionRuntime/branchRuntime.test.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: host queue ownership, terminalization, and branch selection remain in the same layers. This slice only removes the remaining requested-skill and fast-path handler-local shadow state duplication from the facade.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/branchRuntime.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-17 - M-24 Reframed As Channel Ingress Abstraction With Chat SDK-Ready Boundaries

- Why: the repository had already proven that Discord ingress can prefer OpenClaw while Hermes continues as the bounded continuity lane, but the milestone wording still made OpenClaw sound like the permanent architectural owner of M-24. The next decision was narrower: keep the current Discord/OpenClaw path as the first adapter, preserve single-ingress compatibility mode, and leave a clean insertion point for a future Chat SDK surface without reopening the runtime ownership model.
- Scope: redefined M-24 in the execution board, capability-gap analysis, roadmap, and single-ingress operating plan as a channel-ingress abstraction milestone. The updated docs now state that OpenClaw remains the first ingress adapter, Hermes remains the complementary continuity/operator lane, and Chat SDK belongs in the ingress layer rather than the runtime-ownership layer.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/EXECUTION_BOARD.md`, `docs/planning/CAPABILITY_GAP_ANALYSIS.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation and test-fixture alignment only. The live Discord router still prefers OpenClaw under the same health gates and still falls back to the existing handlers when that ingress does not accept the request. What changed is the forward contract: future channel surfaces should reuse the same normalized ingress boundary instead of competing for runtime ownership.
- Validation: markdown review; targeted Vitest for `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`

## 2026-04-17 - Shared Wiki Canonical Ownership Extended To Prior Art And Repository Appendix

- Why: the prior-art reference and beginner appendix had already been promoted into shared Obsidian targets, but the repo copies still carried full source content. That kept extra prose in the active planning surface and left automated backfill exposed to accidental overwrite from reduced mirror sources.
- Scope: converted the repo copies of the agent-orchestration prior art and repository appendix into compatibility stubs, and marked their catalog entries as `compatibility-stub` so automated backfill skips them.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/AGENT_ORCHESTRATION_PRIOR_ART.md`, `docs/planning/contexts/team-muel_discord-news-bot_beginner-to-system-builder-appendix.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. Shared wiki ownership is unchanged, but repo-to-vault backfill now treats these reduced repo mirrors as skip-only sources and the active repo doc surface stays smaller.
- Validation: `npm run -s docs:externalization:audit:json` candidate status check before conversion; follow-up audit after stub conversion

## 2026-04-17 - Shared Wiki Canonical Ownership Extended To Local Collaboration Workflow And MCP Profile

- Why: the local collaboration workflow and IDE MCP workspace profile were already catalog-backed and present in shared Obsidian, but the repo copies still carried full source prose. That kept more operator/reference material in the active repo surface than the externalization plan intends.
- Scope: converted the local collaboration workflow and IDE MCP workspace setup docs into compatibility stubs, and marked their catalog entries as `compatibility-stub` so automated backfill skips the reduced repo mirrors.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. Shared wiki and shared MCP profile ownership remain unchanged, while the repo planning surface loses two more duplicated long-form reference docs.
- Validation: `node --import dotenv/config --import tsx scripts/audit-repo-doc-externalization.ts --json` filtered candidate check before conversion; follow-up externalization audit and backfill dry-run after stub conversion

## 2026-04-17 - Shared Wiki Canonical Ownership Extended To Obsidian Digital Twin Docs

- Why: the digital-twin constitution, ingest workflow, note schema, and note templates were already catalog-backed and present in shared Obsidian, but the repo copies still carried full reference content. That left more long-form knowledge-control material in the active planning surface than the externalization plan intends.
- Scope: converted four Obsidian digital-twin docs into compatibility stubs, and marked their catalog entries as `compatibility-stub` so automated backfill skips the reduced repo mirrors.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_INGEST_WORKFLOW.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. Shared digital-twin guidance remains canonical in Obsidian, while the repo-local planning surface loses four additional duplicated reference docs.
- Validation: `node --import dotenv/config --import tsx scripts/audit-repo-doc-externalization.ts --json` filtered candidate check before conversion; follow-up externalization audit and backfill dry-run after stub conversion

## 2026-04-17 - Shared Wiki Canonical Ownership Extended To Unattended OpenJarvis And Secret-Rotation Ops Docs

- Why: the unattended OpenJarvis autonomy setup and secret-rotation rollout docs were already catalog-backed and present in shared Obsidian, but the repo copies still carried full operational prose. That left the final two long-form externalization candidates in the active repo surface.
- Scope: converted the unattended OpenJarvis autonomy setup and secret-rotation rollout docs into compatibility stubs, and marked their catalog entries as `compatibility-stub` so automated backfill skips the reduced repo mirrors.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md`, `docs/SECRET_ROTATION_AND_SUPABASE_RO_ROLLOUT.md`, `config/runtime/knowledge-backfill-catalog.json`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. Shared operations guidance remains canonical in Obsidian, and the active repo externalization lane no longer has any remaining stub-ready non-stub candidates.
- Validation: `node --import dotenv/config --import tsx scripts/audit-repo-doc-externalization.ts --json` filtered candidate check before conversion; follow-up externalization audit and backfill dry-run after stub conversion

## 2026-04-16 - Hermes Runtime Profile Family And Reentry Promotion Continuity Added

- Why: the Hermes continuity lane only exposed a broad delegated profile, so unattended relaunches could not preserve narrower intent like scout, executor, distiller, or guardian work. Reentry closeout knowledge also risked staying trapped in workflow events instead of flowing into shared knowledge.
- Scope: expanded Hermes runtime context profiles with auto resolution, threaded the selected profile through session-start prep, goal-cycle relaunch manifests, MCP and admin route surfaces, added operator scripts for the new launch profiles, and attached shared-knowledge promotion to reentry acknowledgments.
- Impacted Routes: `/agent/runtime/openjarvis/session-start`, `/agent/runtime/openjarvis/hermes-runtime/chat-launch`, MCP tools `automation.session_start_prep`, `automation.hermes_runtime.chat_launch`
- Impacted Services: `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/ack-openjarvis-reentry.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/mcp/toolAdapter.ts`, `package.json`
- Impacted Tables/RPC: none; workflow event payloads now carry richer profile and promotion metadata
- Risk/Regression Notes: queued-chat relaunch now defaults to `auto` profile inference rather than a hardcoded delegated profile, and distiller/guardian closeouts can emit shared-knowledge promotion metadata plus `artifact_ref` workflow events. Existing delegated-operator launches remain supported.
- Validation: `npm exec tsc -- --noEmit`; targeted Vitest for `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `scripts/ack-openjarvis-reentry.test.ts`, `src/mcp/toolAdapter.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`

## 2026-04-16 - Local-First OpenJarvis Model Drift Removed From Operator Profiles

- Why: the local-first operator lane and direct OpenJarvis CLI defaults had drifted to `qwen2.5:7b-instruct`, but the verified workstation inventory and current local Ollama lane expose `qwen2.5:7b`. That drift broke direct `jarvis ask` and made `openjarvis:serve:local` fragile until operators hand-edited both repo env and local user config.
- Scope: aligned the local-first/OpenClaw env profiles and `.env.example` to `qwen2.5:7b`, pinned repo-local OpenJarvis serve on explicit Ollama engine settings, added `local:stack:first:*` control-surface scripts, tightened OpenJarvis serve engine/model resolution, and updated runtime defaults/tests to the same local lane.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-first-hybrid.profile.env`, `config/env/local-first-hybrid-gemma4.profile.env`, `config/env/local-openclaw-stack.profile.env`, `scripts/start-openjarvis-serve.mjs`, `package.json`, `.env.example`, `src/configLlmProviders.ts`, `src/services/llm/client.ts`, `src/services/llm/providers.ts`, `src/services/tools/adapters/openjarvisAdapter.ts`, `src/services/llmClient.test.ts`, `src/services/llm/providers.test.ts`, `src/services/tools/adapters/openjarvisAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: repo-local OpenJarvis serve now defaults to direct Ollama when the configured model is a direct local model, while retaining LiteLLM when operators explicitly use `muel-*` aliases. Remote max-delegation control-plane behavior remains unchanged.
- Validation: `npm run env:profile:local-first-hybrid`; direct `jarvis ask --no-stream "Reply with only OK"`; `npm run openjarvis:serve:local`; authenticated `GET http://127.0.0.1:8000/v1/models`; targeted Vitest for updated LLM/OpenJarvis tests; `npm run lint`

## 2026-04-16 - Session Bootstrap Moved Into Runtime Support Helper

- Why: `multiAgentService.ts` still owned priority normalization, workflow step templating, and queued session skeleton construction even though those concerns define runtime bootstrap shape rather than queue orchestration.
- Scope: added `langgraph/runtimeSupport/runtimeSessionBootstrap.ts` for priority normalization, initial step construction, and queued-session creation; rewired `multiAgentService.ts` to delegate start-session and step rebuild paths; added focused bootstrap tests and updated the services directory map.
- Impacted Routes: none; start-session validation and queue ownership remain in `multiAgentService.ts`
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionBootstrap.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionBootstrap.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: public session lifecycle APIs are unchanged. This slice only narrows host ownership around bootstrap defaults and initial workflow step generation.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeSessionBootstrap.test.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionState.test.ts`, `src/services/langgraph/runtimeSupport/runtimeTerminal.test.ts`, and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Retry And Resume Session State Reset Moved Into Runtime Session State Helpers

- Why: after the terminal-writer extraction, `multiAgentService.ts` still mutated retry and resume state inline even though those field resets are session-state concerns, not queue ownership concerns.
- Scope: extended `langgraph/runtimeSupport/runtimeSessionState.ts` with retry reset and resume preparation helpers, rewired `multiAgentService.ts` to delegate to them while keeping queue enqueue/persist ownership in the host, added focused runtime-session-state coverage, and updated the services directory map.
- Impacted Routes: none; retry queue semantics, resumable checkpoint gating, and HITL resume behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionState.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionState.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: host queue orchestration and public session lifecycle APIs remain unchanged. This slice only removes repeated retry/resume field mutation from the facade.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeSessionState.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Terminal Session Finalization Moved Behind Runtime Terminal Support

- Why: `multiAgentService.ts` still owned the terminal writer end-to-end, including persist-and-emit state mutation, checkpoint clearing, outcome attribution, assistant-turn binding, and best-effort shadow follow-up. Those are runtime terminal mechanics rather than session-facade API behavior.
- Scope: extended `langgraph/runtimeSupport/runtimeTerminal.ts` with terminal-status detection and terminal-session finalization orchestration, rewired `multiAgentService.ts` to use a thin dependency-injected wrapper, added focused runtime-terminal coverage, and updated the services directory map.
- Impacted Routes: none; terminal status semantics, assistant-turn persistence, and shadow follow-up behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeTerminal.ts`, `src/services/langgraph/runtimeSupport/runtimeTerminal.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: queue ownership, session lifecycle APIs, and runtime queue drain behavior remain in the host. This slice only removes the terminal cleanup writer from the facade while preserving the same persistence callbacks and best-effort async side effects.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeTerminal.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Traffic Routing Host Helpers Moved Into Runtime Routing Support

- Why: `multiAgentService.ts` still owned traffic-route normalization, fallback decision assembly, route-to-engine session mutation, and route-resolution persistence/logging inline. Those concerns are runtime routing mechanics, not session-facade API behavior.
- Scope: added `langgraph/runtimeSupport/runtimeRouting.ts` for traffic-route application, normalization, fallback construction, and route-resolution orchestration; rewired `multiAgentService.ts` to delegate to the helper while preserving host-controlled persistence and logger callbacks; added focused runtime-routing tests; and updated the services directory map.
- Impacted Routes: none; traffic-route selection, langgraph/main engine selection, and fallback-to-main semantics remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeRouting.ts`, `src/services/langgraph/runtimeSupport/runtimeRouting.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: route persistence timing and fallback ownership remain in the host callback layer. This slice only removes inline traffic-routing state mutation and normalization logic from the facade.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeRouting.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - LangGraph Checkpoint And HITL Pause State Moved Into Runtime Session State Helpers

- Why: after the handler wrapper extractions, `multiAgentService.ts` still carried checkpoint persistence, resumable-session detection, and HITL pause-state mutation inline even though those are session-state concerns rather than host orchestration concerns.
- Scope: extended `langgraph/runtimeSupport/runtimeSessionState.ts` with checkpoint persistence/clear helpers, resumable-session detection, and HITL pause-state mutation; rewired `multiAgentService.ts` to use the extracted helpers through host-provided persistence callbacks; added focused runtime-session-state coverage; and updated the services directory map.
- Impacted Routes: none; checkpoint resume semantics, HITL pause persistence, and terminal checkpoint clearing remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionState.ts`, `src/services/langgraph/runtimeSupport/runtimeSessionState.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: session persistence timing still flows through the host callbacks, so this slice does not change queue ownership or Supabase write behavior. It only moves repeated checkpoint/HITL state mutation behind runtime session-state helpers.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeSessionState.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - HITL Review And Compose Response Wrappers Moved Behind Session Runtime Helpers

- Why: even after the earlier deliberation and prelude slices, `multiAgentService.ts` still directly owned the primary LangGraph HITL review mutation path and the final compose-response terminalization branch. Those were the last obvious handler-local state writers in the primary graph host.
- Scope: extended `langgraph/sessionRuntime/fullReviewDeliberationNodes.ts` with a reusable HITL review state wrapper, extended `langgraph/sessionRuntime/sessionPrelude.ts` with a compose-response resolver for task and non-task terminalization, rewired the primary LangGraph handler map in `multiAgentService.ts` to delegate to both helpers, and added focused coverage in the corresponding helper test files.
- Impacted Routes: none; HITL pause/resume flow, requested-skill/fast-path completion, and final result selection behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.ts`, `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.test.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the host still owns queue control, checkpoint persistence callbacks, and terminal session persistence. This slice only removes the remaining handler-local HITL and compose-response state wiring while preserving existing terminal status semantics.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`, `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.test.ts`, and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Multi-Agent Session Prelude Helpers Moved Into Session Runtime Layer

- Why: `multiAgentService.ts` still mixed intent classification, policy transition, execution-strategy trace decoration, and non-task terminalization inline with host orchestration. Those concerns already aligned more naturally with the existing `langgraph/sessionRuntime` boundary than with the top-level session facade.
- Scope: added `langgraph/sessionRuntime/sessionPrelude.ts` for intent-classification prelude, policy transition application, execution-strategy shadow updates, and non-task terminalization; rewired `multiAgentService.ts` to delegate to the helper through an injected dependency bundle; added focused unit coverage; and updated the services directory map.
- Impacted Routes: none; public session facade APIs and runtime queue ownership remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: branch execution, queue ownership, and terminal persistence contracts remain in their existing layers. This slice only moves the pre-branch session runtime prelude into the sessionRuntime layer with explicit host-provided mutators.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Multi-Agent Compile Prompt And Memory Hydration Wrappers Consolidated In Session Prelude

- Why: after the initial prelude extraction, `multiAgentService.ts` still duplicated prompt-compilation session mutation and memory-hydration shadow updates across both the main pipeline and the primary LangGraph handler map.
- Scope: extended `langgraph/sessionRuntime/sessionPrelude.ts` with compiled-prompt application and session-memory hydration wrappers, rewired the main pipeline and handler map in `multiAgentService.ts` to use them, and expanded focused unit coverage in `sessionPrelude.test.ts`.
- Impacted Routes: none; prompt normalization, task-goal selection, and memory-hint loading behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.ts`, `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this slice only removes duplicated host wiring. The same `runCompilePromptNode()` and `runHydrateMemoryNode()` primitives still own the underlying behavior, now behind the shared session-prelude facade.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/sessionPrelude.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Requested-Skill And Fast-Path LangGraph Handlers Reused Branch Runtime Helpers

- Why: `multiAgentService.ts` still kept separate requested-skill and fast-path node handler implementations even though `branchRuntime.ts` already owned the same execution/refine behavior for the main pipeline branches.
- Scope: extended `langgraph/sessionRuntime/branchRuntime.ts` with reusable requested-skill and fast-path node helpers, rewired the primary LangGraph handler map in `multiAgentService.ts` to delegate to them, and added focused branch-runtime tests for the new helper surface.
- Impacted Routes: none; requested-skill and fast-path runtime behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/branchRuntime.ts`, `src/services/langgraph/sessionRuntime/branchRuntime.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: trace node labels used by the primary LangGraph path are preserved, while the main pipeline branch runtime continues to use its existing stage-level trace labels through the same shared execution helpers.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/branchRuntime.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Full-Review LangGraph State Writers Moved Behind FullReviewNodes Helpers

- Why: `multiAgentService.ts` still directly owned the full-review plan/execution/critique shadowGraph writes and node-local trace decoration even after the underlying full-review execution primitives had already moved into `fullReviewNodes.ts`.
- Scope: extended `langgraph/sessionRuntime/fullReviewNodes.ts` with stateful wrapper helpers for full-review plan, execution, and critique nodes; rewired the primary LangGraph handler map in `multiAgentService.ts` to use them; and added focused coverage for the new wrapper surface in `fullReviewNodes.test.ts`.
- Impacted Routes: none; full-review plan/research/critique behavior remains unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/fullReviewNodes.ts`, `src/services/langgraph/sessionRuntime/fullReviewNodes.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the same `runPlanTaskNode()`, `runResearchTaskNode()`, and `runCriticReviewNode()` primitives still own the underlying work. This slice only moves the handler-specific shadowGraph update contract and trace emission behind shared helpers.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/fullReviewNodes.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Full-Review Deliberation State Writers Moved Behind Deliberation Helpers

- Why: `multiAgentService.ts` still directly owned the ToT shadow snapshot write, final candidate state write, and selected-final promotion write for the primary LangGraph full-review path, even though the underlying deliberation primitives already lived in `fullReviewDeliberationNodes.ts`.
- Scope: extended `langgraph/sessionRuntime/fullReviewDeliberationNodes.ts` with stateful wrappers for ToT exploration, final compose, and candidate promotion; rewired the primary LangGraph handler map in `multiAgentService.ts` to use them; and added focused wrapper coverage in `fullReviewDeliberationNodes.test.ts`.
- Impacted Routes: none; ToT cutover, compose, and promotion behavior remain unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.ts`, `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the same `runComposeFinalNode()`, `runPromoteBestCandidateNode()`, and `runToTShadowExploration()` primitives still own the underlying decision logic. This slice only removes host-side shadowGraph and node-trace duplication for the primary LangGraph path.
- Validation: targeted Vitest for `src/services/langgraph/sessionRuntime/fullReviewDeliberationNodes.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Config And Stateful Caches Moved Behind Dedicated Helpers

- Why: `actionRunner.ts` was still mixing env-derived policy, cache/circuit state, gate-verdict memoization, and execution flow in one host file. That made the next extraction steps riskier because tests and future refactors would keep touching hidden singleton state inline.
- Scope: added `actionRunnerConfig.ts` for env-driven runner policy and cacheability defaults, added `actionRunnerState.ts` for gate-verdict caching, FinOps lookup throttling, circuit/cache singletons, and action utility tracking, rewired `actionRunner.ts` to consume those helpers while keeping its public facade, and updated the services directory map plus focused tests.
- Impacted Routes: none; existing runtime/admin surfaces still import `syncHighRiskActionsToSandboxPolicy()` and `getActionUtilityScore()` through `actionRunner.ts`
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerConfig.ts`, `src/services/skills/actionRunnerState.ts`, `src/services/skills/actionRunner.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: defaults and public behavior are intentionally unchanged. The new `__resetActionRunnerForTests()` hook only affects test/runtime reset callers and prevents future singleton leakage during additional refactor slices.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Workflow Closeout Builder Moved Behind Dedicated Helper

- Why: after the config/state extraction, `actionRunner.ts` still kept the pipeline closeout distillate and capability-demand builder inline with execution flow. That made the pipeline section harder to scan and left a cohesive pure computation block inside the host facade.
- Scope: added `actionRunnerWorkflowCloseout.ts` for workflow closeout artifact calculation, rewired `actionRunner.ts` to delegate through a narrow evidence-ref callback while preserving the existing `buildWorkflowCloseoutArtifacts()` export surface, and updated the services directory map.
- Impacted Routes: none; goal-pipeline behavior and workflow persistence remain unchanged
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerWorkflowCloseout.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: only helper placement changed. Artifact-ref extraction still lives in `actionRunner.ts`, so the new helper receives normalized evidence locators without changing closeout semantics or the public test surface.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Artifact And News Parsing Helpers Moved Behind Dedicated Helper

- Why: `actionRunner.ts` still carried artifact display formatting, workflow artifact-ref extraction, URL normalization, and external-news artifact parsing inline. Those routines are pure parsing/formatting concerns with existing tests and do not belong in the main execution host.
- Scope: added `actionRunnerArtifacts.ts` for reflection-display formatting, workflow artifact reference extraction, and external-news artifact parsing; rewired `actionRunner.ts` to import and re-export the public helper surface; and updated the services directory map.
- Impacted Routes: none; action execution output, workflow artifact persistence, and external-news capture behavior remain unchanged
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerArtifacts.ts`, `src/services/skills/actionRunner.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: parsing semantics are intentionally unchanged. `actionRunner.ts` continues to expose `formatActionArtifactsForDisplay()` and `extractWorkflowArtifactRefs()` so existing callers and tests keep the same import surface.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner External News Capture Moved Behind Dedicated Helper

- Why: `actionRunner.ts` still embedded a full subflow for external-news capture policy checks, dedupe/fingerprint logic, and memory persistence. That behavior is a separate concern from action execution and made the host file harder to reason about.
- Scope: added `actionRunnerNewsCapture.ts` for policy gating, domain filtering, freshness checks, fingerprint dedupe, and semantic-memory persistence; rewired `actionRunner.ts` to delegate to the helper; added focused helper tests; and updated the services directory map.
- Impacted Routes: none; this only reorganizes internal orchestration for `news.google.search` success handling
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerNewsCapture.ts`, `src/services/skills/actionRunnerNewsCapture.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: behavior is intentionally preserved. The new helper accepts optional dependency overrides so policy/dedupe persistence can now be tested without pulling in live DB or memory services.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts` and `src/services/skills/actionRunnerNewsCapture.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Shared Execution Primitive Moved Behind Dedicated Helper

- Why: after the policy, parsing, and closeout slices, `actionRunner.ts` still duplicated the real action invoke path across non-pipeline and pipeline modes. Timeout handling, worker-result normalization, structured error logging, retry rules, circuit state, and cache key generation remained coupled to the host facade.
- Scope: added `actionRunnerExecution.ts` for cache-key generation, cache access, circuit checks, and normalized action execution with retry/timeout handling; rewired both `runGoalActions()` and the pipeline step executor to use the same execution primitive; added focused execution-helper tests; and updated the services directory map.
- Impacted Routes: none; non-pipeline action execution and goal-pipeline step execution keep the same outward behavior while sharing the same internal execution path
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerExecution.ts`, `src/services/skills/actionRunnerExecution.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: retry stop conditions and timeout/error normalization are intentionally preserved. The pipeline step executor now uses the same normalized execution primitive as the classic runner path, reducing divergence risk between the two modes.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`, `src/services/skills/actionRunnerNewsCapture.test.ts`, and `src/services/skills/actionRunnerExecution.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Pipeline Session Persistence Moved Behind Dedicated Helper

- Why: `runGoalPipeline()` still mixed workflow-session lifecycle persistence with planning and output rendering. Session start, executing transition, replan event recording, per-step workflow writes, and final closeout were a coherent workflow-side-effect concern rather than host orchestration logic.
- Scope: added `actionRunnerPipelinePersistence.ts` for goal-pipeline session lifecycle persistence, rewired `actionRunner.ts` to delegate to it, added focused lifecycle tests, and updated the services directory map.
- Impacted Routes: none; goal-pipeline behavior and workflow persistence semantics remain unchanged
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerPipelinePersistence.ts`, `src/services/skills/actionRunnerPipelinePersistence.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: execution planning and user-visible output remain in `actionRunner.ts`. The new helper only centralizes workflow persistence side effects, reducing drift between planner-empty and session-complete closeout paths.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`, `src/services/skills/actionRunnerExecution.test.ts`, `src/services/skills/actionRunnerNewsCapture.test.ts`, and `src/services/skills/actionRunnerPipelinePersistence.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Action Runner Governance And Approval Gate Moved Behind Dedicated Helper

- Why: `runGoalActions()` still embedded the guild-policy fetch path, disabled-policy branch, high-risk approval escalation, and approval-request creation inline. That was the last large policy block still mixed into the host execution loop.
- Scope: added `actionRunnerGovernance.ts` for governance evaluation and approval-request escalation, rewired `actionRunner.ts` to consume the helper while preserving the same logging/output behavior, added focused helper tests, and updated the services directory map.
- Impacted Routes: none; action execution still produces the same blocked/approval states and the same approval request side effects
- Impacted Services: `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunnerGovernance.ts`, `src/services/skills/actionRunnerGovernance.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the helper only centralizes policy decision logic. Action logs, diagnostics counters, and user-visible output formatting remain in `actionRunner.ts` so blocked-state behavior stays stable.
- Validation: targeted Vitest for `src/services/skills/actionRunner.test.ts`, `src/services/skills/actionRunnerExecution.test.ts`, `src/services/skills/actionRunnerNewsCapture.test.ts`, `src/services/skills/actionRunnerPipelinePersistence.test.ts`, and `src/services/skills/actionRunnerGovernance.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Hermes Reentry Ack Now Auto-Queues The Next Bounded Objective Before Restart

- Why: queued chat relaunch and reentry acknowledgment were already in place, but the closeout path still depended on a separately pre-populated safe queue. That meant a completed GPT turn could still stop at summary time even when the live hot-state already contained a clear next bounded objective in `next_queue_head` or capability-demand objective fields.
- Scope: threaded `sessionId` through the OpenJarvis status helper so hot-state reads can stay pinned to the acknowledged workflow session, added a runtime-control helper that synthesizes bounded queue candidates from the current Hermes status bundle and writes them into the safe queue when the queue is empty, wired `scripts/ack-openjarvis-reentry.ts` to call that helper before restarting the queue-aware supervisor, and taught the continuous goal-cycle loop to call the same helper immediately when auto-select is enabled but no queued candidate is available. Added focused unit coverage for the runtime-control helper and the reentry-ack closeout path.
- Impacted Routes: no new HTTP route; the behavior change applies to the existing `openjarvis:hermes:runtime:reentry-ack` closeout CLI and the underlying runtime-control service
- Impacted Services: `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `scripts/ack-openjarvis-reentry.ts`, `scripts/ack-openjarvis-reentry.test.ts`
- Impacted Tables/RPC: none; this change reuses the existing workflow event hot-state, continuity packet safe queue, and supervisor restart path
- Risk/Regression Notes: auto-queueing is intentionally narrow. It runs only when queued-objective auto-selection is enabled, skips when the queue already has candidates, and refuses to synthesize new queue entries while capacity is asking for `escalate`. Candidate synthesis is limited to `next_queue_head` plus explicit capability-demand objectives so generic `next_action` text does not get promoted into the queue. The continuous goal-cycle now immediately retries after a successful auto-queue instead of falling through to an idle wait.
- Validation: targeted Vitest for `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts` and `scripts/ack-openjarvis-reentry.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Multi-Agent Execute Session Terminal Helpers Moved To Runtime Support

- Why: after the snapshot/outcome-cache extraction, `multiAgentService.ts` still carried execute-time fallback and terminal failure normalization inline. That kept route-fallback policy, user-safe error mapping, and side-effectful fallback state reset coupled to the host facade even though they are runtime support concerns.
- Scope: added `langgraph/runtimeSupport/runtimeTerminal.ts` for langgraph-primary fallback application and terminal failure normalization, rewired `executeSession()` in `multiAgentService.ts` to delegate to the new helpers, added focused unit coverage for the helper surface, and updated the services directory map.
- Impacted Routes: none; session start/cancel/resume and runtime snapshot surfaces are unchanged
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/langgraph/runtimeSupport/runtimeTerminal.ts`, `src/services/langgraph/runtimeSupport/runtimeTerminal.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: public multi-agent session APIs, queue ownership, and existing terminal status semantics remain unchanged. This slice narrows execute-time branching but intentionally leaves the heavier terminal writer and branch-runtime execution inside `multiAgentService.ts` for later extraction.
- Validation: targeted Vitest for `src/services/langgraph/runtimeSupport/runtimeTerminal.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-16 - Multi-Agent Runtime Snapshot And Outcome Cache Moved Behind Dedicated Helpers

- Why: active milestone M-21 explicitly calls for shrinking oversized root-level services without changing their public facade. `multiAgentService.ts` still owned two low-risk concerns that did not need to live inside the session host: runtime snapshot assembly and the cross-session recent-outcome cache.
- Scope: extracted multi-agent runtime constants into `multiAgentConfig.ts`, moved runtime snapshot building and recent session outcome cache handling into `multiAgentSnapshot.ts`, kept `multiAgentService.ts` as the public facade and queue owner, and updated the test reset hook so extracted outcome state is cleared between test runs. Added focused unit coverage for the extracted helper module.
- Impacted Routes: none; existing runtime snapshot consumers still call `getMultiAgentRuntimeSnapshot()` through `multiAgentService.ts`
- Impacted Services: `src/services/multiAgentService.ts`, `src/services/multiAgentConfig.ts`, `src/services/multiAgentSnapshot.ts`, `src/services/multiAgentSnapshot.test.ts`, `src/services/DIRECTORY_MAP.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: public multi-agent session APIs, queue ownership, and runtime snapshot shape remain unchanged. This slice intentionally stops at facade-safe extraction and does not yet move branch execution or queue host behavior out of `multiAgentService.ts`.
- Validation: targeted Vitest for `src/services/multiAgentSnapshot.test.ts` and `src/services/multiAgentService.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Hermes Autonomy Can Be Pinned To One Execution-Board Focus Objective

- Why: the repo can already auto-promote approved queued objectives, but that behavior still allows stale safe-queue entries or generic board backlog items to compete with a newly declared strategic focus. The user direction for this slice is stricter: keep autonomous reassignment pointed at codebase optimization only until that focus is deliberately removed.
- Scope: added an execution-board focus override section that the goal-cycle candidate builder reads before any packet safe queue or generic board backlog, switched the non-override board fallback from Active WIP to Queued Now so completed-loop promotion no longer reuses active WIP as the next target, added an optional `replaceExisting` flag to the Hermes queue-objective control surface so operators can reset the safe queue to a single bounded objective, refocused the execution board around M-21 codebase optimization, fixed continuity packet sync so explicit handoff queue overrides survive later sync passes, guarded `scripts/sync-openjarvis-continuity-packets.ts` so importing the module no longer fires a side-effect `manual-sync`, and taught the detached local-autonomy supervisor drift tracker to restart when the continuity sync script itself changes.
- Impacted Routes: existing `POST /api/bot/agent/runtime/openjarvis/hermes-runtime/queue-objective` now accepts `replaceExisting=true` when the safe queue must be reset to one objective
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `scripts/run-local-autonomy-supervisor.ts`, `scripts/run-local-autonomy-supervisor.test.ts`, `scripts/sync-openjarvis-continuity-packets.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/mcp/toolAdapter.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/EXECUTION_BOARD.md`
- Impacted Tables/RPC: none; this change reuses the existing continuity packet, runtime admin route, and local MCP queue-objective surface
- Risk/Regression Notes: when the new execution-board focus section is populated, autonomous candidate selection intentionally ignores stale safe-queue and generic execution-board backlog items. Queue replacement remains opt-in through `replaceExisting=true`; default queue writes still append for existing callers. Mixed remote-write/local-read Obsidian routing now also mirrors shared queue writes back into the local vault path so later packet sync reads the same explicit queue that operators just wrote, and sync imports no longer trigger unsolicited live packet rewrites.
- Validation: targeted Vitest for `scripts/openjarvis-remote-workstream-smoke.test.ts`, `scripts/run-local-autonomy-supervisor.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, and `src/mcp/toolAdapter.test.ts`; `npx tsc --noEmit`; live queue-objective write to `HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md`; live `npx tsx scripts/sync-openjarvis-continuity-packets.ts --reason=manual-sync`

## 2026-04-15 - Discord OpenClaw Ingress Now Bridges Into Hermes Continuity And OpenJarvis Managed Memory Maintenance

- Why: M-24 required the Discord surface to stop at neither slash routing nor one-off replies. The repo needed a real Discord ingress path that can prefer OpenClaw when the gateway is healthy, fall back safely to existing docs/vibe behavior when it is not, and close one recurring bounded objective with managed-agent trace and feedback instead of leaving memory maintenance as a detached script lane.
- Scope: added a shared OpenClaw Discord ingress helper at the command-router edge, injected it into the existing docs and prefixed vibe handlers, and promoted OpenJarvis memory sync into a managed maintenance flow that resolves a stable agent, triggers the repo-owned sync executor, captures the latest trace, and records feedback. Added an admin runtime route plus focused route and handler coverage.
- Impacted Routes: existing Discord `/해줘`, `/뮤엘`, and prefixed `뮤엘 ...` ingress can now short-circuit through OpenClaw with fallback to the prior handlers; added `POST /api/bot/agent/runtime/openjarvis/memory-sync/managed`
- Impacted Services: `src/discord/runtime/commandRouter.ts`, `src/discord/commands/docs.ts`, `src/discord/commands/vibe.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/discord/commands/docs.test.ts`, `src/discord/commands/vibe.test.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`
- Impacted Tables/RPC: none; the new managed path reuses existing OpenJarvis external adapter actions and the repo-owned `scripts/sync-openjarvis-memory.ts` executor
- Risk/Regression Notes: Discord continuity queueing is intentionally narrow and skips private-thread promotion to avoid leaking thread-local intent into broader continuity surfaces. OpenClaw ingress remains gateway-gated and silently falls back to the existing docs/vibe flow if the gateway does not handle the request, so the older Discord behavior remains intact under degraded local tool conditions.
- Validation: targeted Vitest for `src/discord/commands/docs.test.ts`, `src/discord/commands/vibe.test.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - LLM P95 Latency Now Drives Go-No-Go, Temporary Cost-Optimized Provider Downgrade, And Operator Visibility

- Why: active milestone M-20 requires the platform to react when LLM latency SLOs drift, but the repo previously treated p95 latency as a reporting signal only. That left three gaps: go/no-go decisions could stay green while latency was already degraded, the runtime had no immediate circuit-breaker style downgrade path even though a temporary provider profile override mechanism already existed, and operators could not tell from the runtime view whether the effective provider profile came from the workflow default or an active gate override.
- Scope: added an LLM p95 latency check to the go/no-go report using logged LLM call telemetry and the existing `AGENT_SLO_INTELLIGENCE_MAX_P95_LATENCY_MS` threshold, wired the existing 30-second gate provider-profile override so `evaluateGuildSloReport` automatically sets `cost-optimized` for the affected guild when the SLO breach is detected, and exposed the active gate override separately in the LLM runtime snapshot for unattended-health/operator inspection.
- Impacted Routes: existing `GET /api/bot/agent/runtime/unattended-health` now includes `llmRuntime.gateProviderProfile` so operators can distinguish a temporary gate override from the workflow default profile
- Impacted Services: `src/config.ts`, `src/services/goNoGoService.ts`, `src/services/goNoGoService.test.ts`, `src/services/agent/agentSloService.ts`, `src/services/agent/agentSloService.test.ts`, `src/services/llm/client.ts`, `src/services/llmClient.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`
- Impacted Tables/RPC: no schema change; reads existing `agent_llm_call_logs` telemetry and existing SLO policy tables
- Risk/Regression Notes: the downgrade is intentionally temporary and in-memory only, using the pre-existing 30-second gate override TTL. This keeps the change as a short-lived circuit breaker rather than a persistent policy rewrite, and avoids clearing other gate-driven overrides unless the new latency breach actually occurs. The new runtime visibility is additive only and does not change provider selection by itself.
- Validation: targeted Vitest for `src/services/goNoGoService.test.ts`, `src/services/agent/agentSloService.test.ts`, `src/services/llmClient.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Operator Runtime Surfaces Now Expose Local Max-Delegation Readiness

- Why: the repository already had a standard doctor for the `local-nemoclaw-max-delegation` profile, but the canonical operator surfaces still could not explain why the local 24-hour autonomy lane was blocked. Operators had to leave `unattended-health` and `operator-snapshot` and run the separate script manually.
- Scope: exported the existing local stack doctor as a reusable helper, surfaced its result under `localAutonomy` in both `GET /api/bot/agent/runtime/unattended-health` and `GET /api/bot/agent/runtime/operator-snapshot`, and updated focused route coverage plus operator docs to explain the new signal.
- Impacted Routes: `GET /api/bot/agent/runtime/unattended-health`, `GET /api/bot/agent/runtime/operator-snapshot`
- Impacted Services: `scripts/local-ai-stack-control.mjs`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`
- Impacted Tables/RPC: no table or RPC contract changed; the new operator-visible block reuses the existing local stack doctor and its current workflow-state/memory projection reads
- Risk/Regression Notes: this adds local stack probing work to the admin runtime routes, but it intentionally reuses the existing doctor contract instead of creating a second readiness implementation with divergent semantics.
- Validation: targeted Vitest for `src/routes/botAgentObsidianRuntime.test.ts` and `scripts/local-ai-stack-control.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - OpenJarvis Scheduler Is Now A First-Class Runtime Surface For Long-Running Memory Watch

- Why: the repository already leveraged OpenJarvis managed memory maintenance and documented scheduler usage historically, but operators still had no repo-owned control surface to inspect scheduler state, ensure a recurring memory-watch task, or start the scheduler daemon itself. That left 24-hour local autonomy partially wired: Hermes continuity could keep the queue alive, while OpenJarvis long-running scheduling still depended on ad hoc CLI knowledge.
- Scope: expanded the OpenJarvis adapter with scheduler create/pause/resume/cancel/logs capabilities; added repo-owned scheduler status, ensure-memory-sync-schedule, and daemon-start helpers under the existing OpenJarvis memory control service; exposed new admin runtime routes for scheduler status, memory-sync schedule ensure, and daemon start; surfaced scheduler status in operator snapshot and unattended-health payloads; and added CLI entrypoints for `openjarvis:scheduler:start`, `openjarvis:scheduler:status`, and `openjarvis:memory:sync:schedule:ensure`.
- Impacted Routes: new `GET /api/bot/agent/runtime/openjarvis/scheduler`, new `POST /api/bot/agent/runtime/openjarvis/memory-sync/schedule`, new `POST /api/bot/agent/runtime/openjarvis/scheduler/start`; existing `GET /api/bot/agent/runtime/operator-snapshot` and `GET /api/bot/agent/runtime/unattended-health` now include OpenJarvis scheduler state alongside memory sync state.
- Impacted Services: `src/services/tools/adapters/openjarvisAdapter.ts`, `src/services/tools/externalAdapterTypes.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `scripts/run-openjarvis-scheduler.ts`, `package.json`, `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/services/tools/adapters/openjarvisAdapter.test.ts`
- Impacted Tables/RPC: none; the new scheduler control surface only wraps existing OpenJarvis CLI and existing repo-owned runtime routes.
- Risk/Regression Notes: OpenJarvis scheduler tasks execute agent prompts and still require the scheduler daemon to be running separately; the repo-owned memory sync script remains the canonical direct refresh path. The new memory-watch schedule defaults to a short deterministic prompt so scheduler list output can be matched reliably even when upstream CLI tables truncate prompt columns.
- Validation: targeted Vitest for `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, and `src/services/tools/adapters/openjarvisAdapter.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Repo Runtime Now Keeps The Local Max-Delegation Lane And Hermes Supervisor Alive

- Why: exposing `localAutonomy` in operator views made the blocker visible, but visibility alone does not satisfy 24-hour unattended autonomy. The repo still had no app-owned loop that would automatically re-run the local stack doctor/up sequence and requeue the Hermes continuous supervisor when it dropped.
- Scope: added a repo-owned `localAutonomySupervisorLoop` that starts at `service-init`, checks whether the local max-delegation lane is relevant in the current environment, heals the local stack through the existing `runUp()` control surface when doctor fails, and queues the existing `start-supervisor-loop` remediation when Hermes continuity is present but not alive; the local lane now also requests `autoLaunchQueuedChat=true` on that remediation so queued next objectives can reopen the next GPT session instead of stopping at a supervisor-only loop; if a stale manual-chat supervisor is still alive, the loop now replaces it with the queue-aware profile once the active workflow is no longer executing; queued supervisor remediation now also forwards the explicit `dryRun` mode into the spawned goal-cycle command so a live auto-chat repair does not silently fall back to preview-only VS Code chat launch; queued-chat handoff state is now surfaced as `awaiting_reentry_acknowledgment` in goal status and Hermes runtime readiness, and the local autonomy loop treats that state as a wait boundary instead of blindly relaunching the supervisor while GPT closeout is still pending; the first awaiting-ack boundary now also refreshes continuity packet sync immediately so the queued reentry objective and wait state become visible before the handoff goes stale; if that wait boundary ages past 15 minutes, runtime status now marks it stale, local autonomy reports `reentry=stale-ack`, records a deduped workflow `capability_demand`, and reruns continuity packet sync so the Obsidian handoff/progress packet mirrors the stalled handoff as an operator-visible blocker; continuity packet sync now also falls back to the detached `local-autonomy-supervisor` manifest/status/log artifacts so handoff/progress packets can surface `continuity_watch_alive` and watcher evidence refs when no active launch manifest exists; packet-generated continuity guidance lines in Safe Autonomous Queue are now filtered out of `autonomous_goal_candidates` so release-to-restart prefers real bounded work instead of repeating packet-maintenance boilerplate; added a standalone detached `npm run local:autonomy:supervisor` entrypoint plus `status`, `stop`, `restart`, and `watch` variants for sessions where the repo runtime is not already running; detached manifest/status artifacts now carry a tracked-code fingerprint and the detached start command auto-restarts a stale daemon when the self-heal code changed; surfaced the loop in runtime route payloads and scheduler policy; and added focused regression coverage for the new runtime service, bootstrap wiring, scheduler policy, runtime route outputs, queued-supervisor remediation forwarding, queued reentry wait-boundary handling, continuity watch fallback observability, and daemon drift detection helpers.
- Impacted Routes: existing `GET /api/bot/agent/runtime/loops` and `GET /api/bot/agent/runtime/operator-snapshot` now include `localAutonomySupervisorLoop`; existing `GET /api/bot/agent/runtime/scheduler-policy` now includes `local-autonomy-supervisor`
- Impacted Services: `src/services/runtime/localAutonomySupervisorService.ts`, `src/services/runtime/localAutonomySupervisorService.test.ts`, `src/services/runtime/runtimeBootstrap.ts`, `src/services/runtime/runtimeBootstrap.test.ts`, `src/services/runtime/runtimeSchedulerPolicyService.ts`, `src/services/runtime/runtimeSchedulerPolicyService.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `scripts/local-ai-stack-control.mjs`, `scripts/run-local-autonomy-supervisor.ts`, `scripts/run-local-autonomy-supervisor.test.ts`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`
- Impacted Tables/RPC: no new table or RPC contract added; the loop reuses existing local doctor/up probes plus the existing OpenJarvis Hermes remediation contract
- Risk/Regression Notes: the new loop is fail-closed to environments that do not expose local managed surfaces, so shared or remote-only deployments do not start it. On local max-delegation environments it will spawn the Hermes supervisor without a visible terminal to keep unattended continuity quiet and repeatable, and it now explicitly targets queue-aware GPT relaunch instead of leaving that behavior to whichever env default happened to be active. Detached local-autonomy daemons still keep their in-memory code image, but manifest/status now mark that drift explicitly and the detached start path will replace a stale daemon instead of silently reporting `alreadyRunning=true` on outdated code.
- Validation: targeted Vitest for `src/services/runtime/localAutonomySupervisorService.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, and `scripts/openjarvis-remote-workstream-smoke.test.ts`; `npx tsc --noEmit`; live `npm run local:autonomy:supervisor:stop`; live `npm run local:autonomy:supervisor:once`; artifact verification in `tmp/autonomy/local-autonomy-supervisor.json` plus `tmp/autonomy/launches/latest-interactive-goal-loop.json` showing `auto_launch_queued_chat=true`, `last_reason=queued-chat-launched`, `awaiting_reentry_acknowledgment=true`, and `bridgeResult.dryRun=false`

## 2026-04-15 - Shared OpenJarvis Memory Sync Now Fails Soft On Sparse Obsidian Runtime Status Shapes

- Why: the shared GCP runtime had already exposed OpenJarvis memory sync through the shared control plane, but the runtime-side projection script still assumed every deployed Obsidian router returned `accessPosture.summary`. Sparse or older shared runtime mirrors could therefore queue the sync successfully and then crash before writing `tmp/openjarvis-memory-feed/summary.json`, which made the live shared demonstration look like a silent no-op instead of a diagnosable control-plane result.
- Scope: hardened `scripts/sync-openjarvis-memory.ts` so Obsidian runtime status lookup is optional and summary generation falls back to selected-adapter hints when `accessPosture.summary` is absent or the status lookup itself throws; added regression coverage for the fallback summary path; and republished the shared control slice to the canonical shared MCP runtime.
- Impacted Routes: no HTTP route shape changed; existing shared control-plane entrypoints for OpenJarvis memory sync now complete with a projection summary even when the shared runtime only exposes an older Obsidian adapter status shape
- Impacted Services: `scripts/sync-openjarvis-memory.ts`, `scripts/sync-openjarvis-memory.test.ts`, shared runtime mirror under `/opt/muel/shared-mcp-runtime`
- Impacted Tables/RPC: none
- Risk/Regression Notes: the shared runtime can now project repo-backed Obsidian fallback documents and write `tmp/openjarvis-memory-feed/summary.json` even when Obsidian runtime posture metadata is incomplete. Full `jarvis memory index` still depends on the `jarvis` CLI being installed on the shared host; the runtime now records that missing dependency as `memoryIndex.status=skipped` with `reason=cli_unavailable` instead of failing before the summary artifact exists.
- Validation: targeted Vitest for `scripts/sync-openjarvis-memory.test.ts`; no TypeScript errors in the changed script/test; narrow shared publish with `scripts/publish-gcp-shared-mcp.ps1 -SyncProfile openjarvis-shared-control -IncludePath scripts/sync-openjarvis-memory.ts -RestartServices`; live remote run on `/opt/muel/shared-mcp-runtime` produced `projection prepared: docs=4 obsidian=3 repo=1 supabase=0`, `SUMMARY_EXISTS=1`, and a persisted `tmp/openjarvis-memory-feed/summary.json`

## 2026-04-15 - Runtime Operator Views Now Expose The Missing Eval Loop Statuses And Repo-Owned Maintenance Surfaces

- Why: the repo already treated /api/bot/agent/runtime/loops and operator snapshot as the canonical operator view for unattended loop state, but those views still omitted reward-signal and eval-auto-promote loop status even though scheduler policy already tracked them. They also had no operator-visible representation of the new repo-owned Obsidian and eval maintenance control surfaces, so the control-plane contract existed in code but not in the main runtime view.
- Scope: extended the existing runtime loops and operator snapshot payloads to include reward signal and eval auto-promote loop status plus the repo-owned Obsidian and eval maintenance control surfaces.
- Impacted Routes: no route shape changed; existing `GET /api/bot/agent/runtime/loops` and `GET /api/bot/agent/runtime/operator-snapshot` now include reward/eval loop status and maintenance control-surface metadata
- Impacted Services: `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: this is an additive operator-surface change only. It does not change loop ownership, scheduling cadence, or execution behavior; it makes the already-canonical runtime views match the current repo-owned execution contract more closely.
- Validation: targeted Vitest for `src/routes/botAgentObsidianRuntime.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Eval Internal Loops Now Use A Repo-Owned Control Facade And Obsidian Maintenance Can Delegate Safely

- Why: the target architecture for this repo is still db-owned cadence with repo-owned execution contracts. After the first Obsidian facade slice, the eval internal routes were still invoking raw loop services directly, and the Obsidian facade still had no safe delegation seam for a shared operate worker. That left two gaps: internal eval automation had no explicit repo-owned control boundary, and remote Obsidian execution could recurse if worker tools simply called back into the same delegation path.
- Scope: added a small eval maintenance control facade for retrieval eval, reward signal, and auto-promote internal execution; upgraded the Obsidian maintenance control facade with an optional operate-worker delegation preference plus strict and fallback behavior; and exposed forced-local MCP run tools for lore sync and graph audit so shared workers can execute the task body without re-entering the delegation path.
- Impacted Routes: no HTTP route shape changed; existing `POST /api/internal/eval/retrieval`, `POST /api/internal/eval/reward-signal`, and `POST /api/internal/eval/auto-promote` now call the eval facade, while shared MCP tool catalogs gain `obsidian.sync.run` and `obsidian.quality.audit.run`
- Impacted Services: `src/services/eval/evalMaintenanceControlService.ts`, `src/routes/internal.ts`, `src/services/obsidian/obsidianMaintenanceControlService.ts`, `src/mcp/obsidianToolAdapter.ts`, `src/services/eval/evalMaintenanceControlService.test.ts`, `src/services/obsidian/obsidianMaintenanceControlService.test.ts`, `src/routes/internal.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: repo runtime remains the canonical execution contract and still defaults to local execution. Remote Obsidian delegation is opt-in through `OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR=operate-worker`; `OBSIDIAN_MAINTENANCE_STRICT_DELEGATION=true` can fail closed instead of falling back local. The new MCP run tools explicitly force local execution to avoid worker-to-worker recursion.
- Validation: targeted Vitest for `src/routes/internal.test.ts`, `src/services/eval/evalMaintenanceControlService.test.ts`, `src/services/obsidian/obsidianMaintenanceControlService.test.ts`, and `src/mcp/obsidianToolAdapter.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Obsidian Maintenance Execution Now Flows Through A Repo-Owned Control Facade

- Why: the recommended target structure for this repository is for scheduling to remain db-ownable while execution contracts stay owned by the repository runtime. Obsidian sync and graph audit were still being invoked directly from route handlers, which left no explicit repo-owned seam for future delegation or runtime relocation.
- Scope: added a small Obsidian maintenance control service that now owns lore sync and graph audit execution for the existing internal and admin routes, while preserving the current route contracts and underlying sync/audit implementations.
- Impacted Routes: no route shape changed; existing `POST /api/internal/obsidian/sync`, `POST /api/internal/obsidian/audit`, and `POST /api/bot/agent/obsidian/quality/audit` now call the facade instead of the raw domain runners
- Impacted Services: `src/services/obsidian/obsidianMaintenanceControlService.ts`, `src/routes/internal.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/services/obsidian/obsidianMaintenanceControlService.test.ts`, `src/routes/internal.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: behavior stays local to the repo runtime for now; the value of this slice is that future delegation to a shared executor or specialist worker can move behind one control boundary instead of leaking into route handlers.
- Validation: targeted Vitest for `src/routes/internal.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, and `src/services/obsidian/obsidianMaintenanceControlService.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Shared MCP Now Exposes OpenJarvis Memory Sync And Safe Session-Prep Dry Runs On Sparse Runtime Mirrors

- Why: the repository already had OpenJarvis memory projection status and run surfaces, but they were only reachable through admin/runtime paths. Promoting that leverage into the shared MCP surface exposed two follow-on issues: the shared GCP runtime mirror is intentionally sparse, so static `toolAdapter.ts` imports could crash `unified-mcp-http.service` on unrelated optional modules before the new tools ever registered, and `session_start_prep` dry-runs could still mutate the Hermes handoff queue when the queue helper did not inherit the dry-run contract.
- Scope: added shared MCP tools for OpenJarvis memory sync status and queued execution, changed the memory sync runner to launch the underlying script directly through `node --import tsx` instead of depending on remote `package.json` script parity, hardened `src/mcp/toolAdapter.ts` to lazy-load optional automation, personalization, and Hermes/OpenJarvis helper modules so partial shared-runtime deploys do not block server startup, promoted the narrow OpenJarvis/Hermes session-open dependency set into the shared runtime mirror, fixed `prepareOpenJarvisHermesSessionStart` so dry-run queue previews do not write back into the live handoff packet, and codified the verified narrow rollout bundle as `scripts/publish-gcp-shared-mcp.ps1 -SyncProfile openjarvis-shared-control`.
- Impacted Routes: shared MCP tool catalog now includes `automation.openjarvis.memory_sync.status` and `automation.openjarvis.memory_sync.run`
- Impacted Services: `src/mcp/toolAdapter.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/runtime/hermesVsCodeBridgeService.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-workflow-state.mjs`, `scripts/lib/openjarvisAutopilotCapacity.mjs`, `scripts/sync-openjarvis-memory.ts`, `scripts/publish-gcp-shared-mcp.ps1`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/mcp/toolAdapter.test.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`
- Impacted Tables/RPC: no repo table or RPC contract changed; shared runtime deployment added the new files under `/opt/muel/shared-mcp-runtime` and restarted `unified-mcp-http.service`
- Risk/Regression Notes: sparse shared-runtime mirrors remain valid, but `toolAdapter.ts` must keep optional higher-layer helpers behind lazy imports or partial GCP syncs can fail closed at process start. The new memory sync execution path now reflects the real direct script command in diagnostics instead of a local-only `npm run` alias, and Hermes queue preview paths must continue to propagate `dryRun` or remote session-start preparation can silently mutate operator continuity packets.
- Validation: targeted Vitest for `src/mcp/toolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts`, and `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`; `npx tsc --noEmit`; PowerShell parser validation for `scripts/publish-gcp-shared-mcp.ps1`; live shared MCP health at `https://34.56.232.61.sslip.io/mcp/health` returning `status=ok` with both new OpenJarvis memory sync tools present; live shared `automation.session_start_prep` dry-run verified with identical pre/post handoff-packet hashes; live shared `automation.hermes_runtime.remediate` start-supervisor-loop dry-run returned `ok=true` with unchanged before/after supervisor process counts

## 2026-04-15 - Max-Delegation Local Stack Now Has A Standard Doctor, Status, And Up Control Surface

- Why: the repository already had all the raw parts of a powerful local AI stack, but operators still had to remember a scattered bring-up sequence across env profile switching, LiteLLM sidecars, local n8n, local OpenJarvis serve, the local implement worker, and separate hot-state diagnostics. That kept the local control plane useful but inefficient.
- Scope: added a standard local stack control script for the `local-nemoclaw-max-delegation` profile with `doctor`, `status`, and `up` actions; wired npm entrypoints; summarized deterministic local service readiness, direct-vault Obsidian posture, OpenJarvis memory projection freshness, and the latest workflow hot-state summary; and documented the new control surface in the platform runbook.
- Impacted Routes: N/A
- Impacted Services: `scripts/local-ai-stack-control.mjs`, `scripts/local-ai-stack-control.test.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added; the new status surface reads existing local workflow session mirrors and can prefer the existing Supabase-backed workflow hot-state when available through `readLatestWorkflowState`
- Risk/Regression Notes: the new `up` action only auto-starts deterministic local services that the repo can already manage directly: local LiteLLM, local n8n, local OpenJarvis serve, and the local opencode worker. OpenClaw, NemoClaw, and OpenShell remain operator-managed or WSL-managed surfaces and are reported as manual lanes instead of being force-started from the repo.
- Validation: targeted Vitest for `scripts/local-ai-stack-control.test.ts`; `npx tsc --noEmit`; live dry-run smoke for `node scripts/local-ai-stack-control.mjs --action=up --profile=local-nemoclaw-max-delegation --applyProfile=true --dryRun=true`

## 2026-04-15 - Local Workstation Executor Now Supports Observable Local Compute And Active-Window GUI Control

- Why: the first workstation slice already exposed bounded browser launch, app launch, screenshots, and workspace file mutation, but it still stopped short of a practical local Compute Agent or GUI Agent lane. Without explicit command execution and active-window input, operators still had to bridge the last mile with hidden shell glue or manual typing.
- Scope: extended the built-in `workstation` adapter with bounded `command.exec`, `app.activate`, `input.text`, and `input.hotkey` capabilities; updated the workstation probe output and API-first/agent-fallback catalog language to describe the stronger local actuator surface; and refreshed the architecture index so the local computer-use contract now explicitly includes observable command and input steps.
- Impacted Routes: `automation.capability.catalog`, `automation.route.preview`, `automation.optimizer.plan`, local MCP tools under `ext.workstation.*`
- Impacted Services: `src/services/tools/adapters/workstationAdapter.ts`, `src/services/tools/adapters/workstationAdapter.test.ts`, `src/services/tools/externalToolProbe.ts`, `src/services/tools/externalAdapterTypes.ts`, `src/services/automation/apiFirstAgentFallbackService.ts`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: workstation command execution remains bounded by explicit target plus argument lists and workspace-scoped cwd selection rather than raw free-form shell strings. GUI input stays limited to activating an existing desktop window and sending text or hotkeys into that active surface; this is still a bounded computer-use actuator, not a full unattended desktop supervisor.
- Validation: targeted Vitest for `src/services/tools/adapters/workstationAdapter.test.ts`; targeted infra/core verification for `src/services/tools/externalToolProbe.ts` and `src/services/automation/apiFirstAgentFallbackService.ts`; `npx tsc --noEmit`

## 2026-04-15 - Obsidian Graph Audit Became A First-Class Runtime Loop And Trigger Surface

- Why: the repository already had an Obsidian graph audit script and a read-only snapshot surface, but operators still lacked a first-class runtime loop, internal trigger, and scheduler visibility path comparable to the existing lore sync loop. That left a readiness gap between having the audit artifact and actually running or supervising it as part of the control plane.
- Scope: added an app/db-ownable Obsidian graph audit loop wrapper around the existing audit script, exposed manual admin and internal trigger routes, surfaced the loop in runtime/operator views and scheduler policy snapshots, and added focused regression coverage for the new route and policy wiring.
- Impacted Routes: `POST /api/internal/obsidian/audit`, `POST /api/bot/agent/obsidian/quality/audit`
- Impacted Services: `src/services/obsidian/obsidianQualityService.ts`, `src/services/runtime/bootstrapDiscordLoops.ts`, `src/services/infra/pgCronBootstrapService.ts`, `src/services/runtime/runtimeSchedulerPolicyService.ts`, `src/routes/internal.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/routes/bot-agent/runtimeRoutes.ts`
- Impacted Tables/RPC: no repo table or RPC contract changed; pg_cron bootstrap can now install `muel_obsidian_graph_audit` to call the new internal route
- Risk/Regression Notes: the change reuses the existing `scripts/audit-obsidian-graph.ts` script rather than creating a second audit implementation, keeps loop ownership explicit through app vs. pg_cron policy, and intentionally returns a non-success HTTP status when the audit fails so unattended operators can detect degraded graph quality instead of silently treating a failing audit as healthy.
- Validation: `npx tsc --noEmit`, targeted Vitest for `src/routes/internal.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, and `src/services/runtime/runtimeSchedulerPolicyService.test.ts`

## 2026-04-15 - OpenJarvis Adapter Now Covers Managed-Agent Lifecycle, State, And Trace Inspection

- Why: the previous adapter slice exposed inventory and message entrypoints, but it still left most managed-agent control and observability behind raw upstream routes. That meant the repo treated OpenJarvis as the preferred control plane while forcing operators back into ad hoc route knowledge for pause, resume, run, recover, state, tasks, messages, and traces.
- Scope: expanded the OpenJarvis adapter with managed-agent get, delete, pause, resume, run, recover, state, message history, task list, trace list, and trace detail capabilities; added global managed-agent health and recommended-model reads; kept the lite/MCP surface conservative by exposing only the new global read-only health surfaces; and added focused regression coverage for path builders and lite tool exposure.
- Impacted Routes: `ext.openjarvis.jarvis.agents.health`, `ext.openjarvis.jarvis.recommended-model`
- Impacted Services: `src/services/tools/adapters/openjarvisAdapter.ts`, `src/services/tools/externalAdapterTypes.ts`, `src/services/tools/adapters/openjarvisAdapter.test.ts`, `src/mcp/unifiedToolAdapter.test.ts`
- Impacted Tables/RPC: no repo table or RPC contract changed; new calls target upstream OpenJarvis HTTP surfaces under `/v1/managed-agents/{agent_id}`, `/pause`, `/resume`, `/run`, `/recover`, `/state`, `/messages`, `/tasks`, `/traces`, `/traces/{trace_id}`, plus `/v1/agents/health` and `/v1/recommended-model`
- Risk/Regression Notes: lifecycle and inspection calls remain full adapter capabilities rather than wide lite exposure, because state and trace payloads can contain rich execution detail. The lite catalog only gained the global read-only health surfaces.
- Validation: targeted Vitest for `src/services/tools/adapters/openjarvisAdapter.test.ts` and `src/mcp/unifiedToolAdapter.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - OpenJarvis Adapter Now Exposes Serve Inventory And Managed-Agent Control Surfaces

- Why: the repository already treated OpenJarvis as the preferred local control surface, but the external adapter still behaved mostly like a thin ask plus telemetry wrapper. That left model inventory, tool inventory, server identity, and managed-agent lifecycle operations outside the first-class adapter surface even though upstream OpenJarvis already exposes stable HTTP routes for them.
- Scope: expanded the built-in OpenJarvis adapter with server info, model list, tool list, managed-agent list, managed-agent create, and managed-agent message capabilities; exposed the safe inventory subset through the lite capability catalog; and added focused regression coverage for the new payload builders plus MCP tool exposure.
- Impacted Routes: `ext.openjarvis.jarvis.server.info`, `ext.openjarvis.jarvis.models.list`, `ext.openjarvis.jarvis.tools.list`, `ext.openjarvis.jarvis.agent.list`
- Impacted Services: `src/services/tools/adapters/openjarvisAdapter.ts`, `src/services/tools/externalAdapterTypes.ts`, `src/mcp/unifiedToolAdapter.test.ts`
- Impacted Tables/RPC: no repo table or RPC contract changed; new calls target upstream OpenJarvis HTTP surfaces under `/v1/info`, `/v1/models`, `/v1/tools`, and `/v1/managed-agents`
- Risk/Regression Notes: managed-agent create and message remain adapter-level capabilities, but only the read-oriented inventory subset is exposed through the lite MCP catalog by default. Per-request agent selection for `/v1/chat/completions` is still not supported upstream and continues to route through the documented CLI path.
- Validation: targeted Vitest for `src/services/tools/adapters/openjarvisAdapter.test.ts` and `src/mcp/unifiedToolAdapter.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Team Packet Sharing Method Now Separates Supabase Hot-State From Obsidian Packet Mirrors

- Why: the repository already had a useful Hermes plus GPT packet discipline, but the team-facing explanation still risked collapsing packet transport, hot mutable workflow state, and durable semantic notes into one blurry concept. That made it harder to recommend the method broadly, especially for teammates who do not run the same local Hermes or OpenJarvis stack.
- Scope: clarified the team-shared startHere doc, architecture ownership rule, and Hermes packet contract so ACP and packet handoff are described as optional local accelerators, while Supabase remains the mutable workflow owner and Obsidian remains the durable packet mirror and semantic owner.
- Impacted Routes: N/A
- Impacted Services: `docs/TEAM_SHARED_OBSIDIAN_START_HERE.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. The main effect is a clearer team-sharing rule: packet transport can stay local and optional, but team-visible mutable state should converge in Supabase and team-visible durable meaning should converge in shared Obsidian.
- Validation: targeted markdown/json diagnostics plus shared backfill of the updated team startHere and Hermes planning docs

## 2026-04-15 - Local Workstation Executor Adds A First-Class Computer-Use Actuator For Browser, App, Screenshot, And Workspace File Steps

- Why: the repo already had a non-trivial control plane for route selection, hot-state, and semantic ownership, but local computer-use still fell back to ad hoc shell or operator glue. That left browser launch, desktop app launch, screenshot capture, and workspace-scoped file mutation without a first-class wrapped surface or an explicit place in the API-first plus agent-fallback model.
- Scope: added a built-in `workstation` external adapter with bounded browser, desktop, screenshot, and workspace file capabilities, exposed it through the adapter registry, surfaced it in the automation capability catalog and asset delegation matrix, and extended operator probe coverage plus architecture docs to reflect the new local actuation lane.
- Impacted Routes: `automation.capability.catalog`, `automation.route.preview`, `automation.optimizer.plan`
- Impacted Services: `src/services/tools/adapters/workstationAdapter.ts`, `src/services/tools/externalAdapterRegistry.ts`, `src/services/tools/externalAdapterTypes.ts`, `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/tools/externalToolProbe.ts`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: workstation file actions are deliberately constrained to paths under the current workspace root, while browser, app-launch, and screenshot actions stay on the local operator machine only. This is still a bounded actuator, not a full DOM-level browser automation stack or unattended GUI supervisor.
- Validation: targeted Vitest for `src/services/tools/adapters/workstationAdapter.test.ts`, `src/services/tools/externalToolProbe.test.ts`, and `src/services/automation/apiFirstAgentFallbackService.test.ts`; `npx tsc --noEmit`

## 2026-04-15 - Team Shared Obsidian Start Here Became The First Human-Primary Knowledge Entry

- Why: the repository already contained local OpenJarvis and Hermes-oriented operating slices, but most teammates do not actually have those local tools. Without an explicit first-entry explanation, the shared knowledge surface could imply that optional personal runtime lanes were team prerequisites instead of accelerators.
- Scope: added a team-shared Obsidian-first onboarding doc, aligned always-on agent collaboration instructions with the same rule, linked the new entrypoint from architecture and planning navigation, and promoted it into the knowledge backfill catalog as the first operator-primary startHere path.
- Impacted Routes: N/A
- Impacted Services: `docs/TEAM_SHARED_OBSIDIAN_START_HERE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. The main effect is that team-facing documentation and shared Obsidian now make the required collaboration surface explicit: shared Obsidian and repo-backed runtime truth are the defaults, while local OpenJarvis or Hermes lanes remain optional continuity or acceleration overlays.
- Validation: `npm run obsidian:backfill:system -- --entry control-team-shared-obsidian-start-here --overwrite`; backfill report confirmed `existing=1`, `operatorPrimaryMissing=0`, `startHereMissing=0`, and `writeAdapter=remote-mcp`

## 2026-04-13 - Pre-GUI Local Readiness Now Distinguishes OpenClaw Control UI From Chat Capability And Treats Existing OpenShell Sandboxes As Ready

- Why: pre-GUI local bring-up on Windows + WSL was still hiding the real blockers. OpenClaw gateway health alone could look ready even when `/v1/models` returned the HTML control UI instead of a JSON chat surface, and OpenShell sandbox bootstrap could look broken when the expected sandbox already existed and was already `Ready`.
- Scope: hardened OpenClaw provider and adapter readiness so control-only gateway responses stay explicitly unreachable for chat, made OpenShell sandbox create idempotent for an already-existing named sandbox, enriched the external tool probe and Windows bootstrap script to report sandbox registration plus OpenClaw default model and chat-surface truth.
- Impacted Routes: N/A
- Impacted Services: `src/services/llm/providers.ts`, `src/services/tools/adapters/openclawCliAdapter.ts`, `src/services/tools/adapters/openshellCliAdapter.ts`, `src/services/tools/externalToolProbe.ts`, `scripts/bootstrap-external-tools.ps1`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: local compute isolation now reports the existing `muel-assistant` sandbox as the normal ready state instead of treating `already exists` as a bootstrap failure. OpenClaw now only gets chat readiness credit when the gateway proves a JSON chat surface; on this workstation the remaining OpenClaw blocker is still host memory plus gateway product shape, not missing repo wiring.
- Validation: targeted Vitest for `src/services/llm/providers.test.ts`, `src/services/tools/adapters/openclawCliAdapter.test.ts`, `src/services/tools/adapters/openshellCliAdapter.test.ts`, and `src/services/tools/externalToolProbe.test.ts`; `npx tsc --noEmit`; live `npm run -s tools:probe -- --json`; live `powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-external-tools.ps1`

## 2026-04-13 - NemoClaw Local Profiles Now Pin OpenClaw To Qwen 7B After 8B Tool-Lane Memory Failure

- Why: the previous local autonomy repair work left one last mismatch between repo config and runtime truth. The actual OpenClaw/Hermes embedded lane could not stay on `OPENCLAW_MODEL=openclaw`, and the first exact-8B replacement candidate, `ollama/llama3.1:8b`, failed locally because OpenClaw embedded runs needed about 15.9 GiB while the workstation only exposed about 7.5 GiB of free system memory to Ollama at runtime. That meant the local tool lane was still only working because of user-local state, not because the active NemoClaw repo profiles described the real working path.
- Scope: pinned the active NemoClaw local profiles so repo runtime now sends OpenClaw gateway and OpenClaw-backed provider traffic to the verified tool-capable local model `ollama/qwen2.5:7b`, while preserving Nemotron Nano 8B as the main local reasoning lane for host Ollama, OpenJarvis, and NemoClaw sandbox inference.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the local chain is now intentionally split by capability instead of pretending one local model can do every role. Qwen 7B is the memory-safe OpenClaw/Hermes tool lane on this workstation, while Nemotron remains the higher-quality reasoning lane. The user-local OpenClaw default may still drift, but the repo profiles now carry the same working model selection used by the validated gateway and embedded-agent path.
- Validation: live `ollama pull llama3.1:8b`; live `openclaw models set ollama/llama3.1:8b`; live `openclaw agent --agent main --local -m "Reply with only OK" --session-id local-llama31-8b-smoke` returning an Ollama memory error; live `ollama pull qwen2.5:7b`; live `openclaw models set ollama/qwen2.5:7b`; live `openclaw agent --agent main --local -m "Reply with only OK" --session-id local-qwen25-7b-smoke` returning `OK`

## 2026-04-13 - Local NemoClaw Profiles Now Align OpenJarvis And LiteLLM To Nemotron While OpenClaw Uses A Tool-Capable Ollama Default

- Why: the local autonomy chain still looked coherent on paper but routed real traffic through stale Qwen bindings and a broken OpenClaw default. The active NemoClaw profiles already pinned host Ollama to the installed Nemotron Nano 8B model, but OpenJarvis workflow bindings, optimize defaults, and the LiteLLM local alias still pointed at unavailable or stale Qwen models. Separately, OpenClaw could be pointed at local Ollama, but the installed Nemotron GGUF failed embedded runs because it does not support tool calling in the Ollama API, which left the OpenClaw/Hermes leg of the chain non-functional for autonomous work.
- Scope: updated the two NemoClaw local profiles to bind OpenJarvis workflow, serve, and optimize lanes to the installed Nemotron Nano 8B model and to launch the local OpenJarvis serve surface with an explicit agent override, updated the OpenJarvis local optimize baseline to the same Nemotron model, repointed the LiteLLM `muel-local` alias to the installed Nemotron Ollama model, and validated the user-local OpenClaw state so the default embedded model now uses a tool-capable local Ollama model while the repo keeps Nemotron for the main reasoning lane.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`, `config/runtime/openjarvis-local-first-optimize.toml`, `litellm.config.yaml`, `scripts/start-openjarvis-serve.mjs`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: OpenJarvis local serve now takes an optional env-driven agent override so the repo can steer the HTTP completion surface without changing upstream OpenJarvis code. The main local reasoning lane stays on Nemotron, but OpenClaw embedded runs must continue using a tool-capable local model until an Ollama-hosted 8B model with reliable tool support replaces the current Nemotron GGUF. The OpenClaw default-model/auth change lives in the user-local `~/.openclaw` state, not in repo config.
- Validation: live `npm run env:profile:local-nemoclaw-max-delegation`; live rebuild of the local LiteLLM container; live OpenJarvis relaunch via `npm run openjarvis:serve:local`; live `POST /v1/chat/completions` against LiteLLM `muel-local`; live `openclaw models auth paste-token --provider ollama` plus `openclaw models set ollama/mistral:latest`; live `openclaw agent --agent main --local -m "Reply with only OK"`; `npx tsc --noEmit`

## 2026-04-13 - Local OpenClaw Gateway Health And Chat Capability Are Now Treated Separately

- Why: live bring-up on Windows + WSL showed two different false positives in the local chain. First, the repo-side WSL wrappers assumed `/root` and therefore missed the real user-scoped OpenShell and NemoClaw installs under the active WSL home. Second, the local OpenClaw 2026.3.13 dev gateway on `19001` served a healthy control UI plus `/healthz`, but it did not expose the OpenAI-compatible chat surface that the repo had been treating as implied by health alone. That made the local chain look more complete than it really was and pushed review/chat lanes into misleading fallback behavior.
- Scope: updated the OpenShell and NemoClaw WSL wrappers to use the active `$HOME` instead of hard-coded `/root`, updated the NemoClaw sandbox execution path to use `openshell sandbox exec` instead of assuming an SSH alias, hardened the OpenClaw gateway helper so it separately probes chat capability before using gateway chat, updated the OpenClaw adapter to prefer gateway transport only when the gateway is actually chat-capable, and documented the distinction in the runbook.
- Impacted Routes: N/A
- Impacted Services: `src/services/tools/adapters/openshellCliAdapter.ts`, `src/services/tools/adapters/nemoclawCliAdapter.ts`, `src/services/tools/externalToolProbe.ts`, `src/services/openclaw/gatewayHealth.ts`, `src/services/tools/adapters/openclawCliAdapter.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: a healthy OpenClaw local gateway now means control ingress only unless `/v1/models` confirms a JSON chat surface. This reduces false positives for local autonomy bring-up, but it also means OpenClaw chat no longer gets credit from `healthz` alone. Local OpenClaw CLI still remains a separate dependency: if its global agent config keeps Anthropic as the default provider without credentials, the repo will correctly fall back instead of silently claiming a working OpenClaw chat lane.
- Validation: targeted Vitest for `src/services/openclaw/gatewayHealth.test.ts`, `src/services/tools/adapters/openclawCliAdapter.test.ts`, `src/services/tools/adapters/openshellCliAdapter.test.ts`, and `src/services/tools/externalToolProbe.test.ts`; live `npm run tools:probe -- --json`; live OpenShell sandbox readiness check (`muel-assistant` -> `Ready`); live OpenClaw route probes on `http://127.0.0.1:19001`; live `openclaw agent --agent main --local -m "Reply with only OK"` showing the remaining Anthropic auth blocker outside repo config

## 2026-04-13 - NemoClaw Profiles Now Carry A Non-Conflicting OpenClaw Ingress And Named OpenShell Sandbox Defaults

- Why: the local NVIDIA-oriented profiles still stopped short of the user-requested chain. They declared NemoClaw and OpenJarvis, but they did not explicitly wire in host OpenClaw ingress, they left OpenShell sandbox delegation off for implement fast-paths, and the OpenShell auto-create path could create an unnamed sandbox that did not match the runtime's expected `muel-assistant` id. Live bring-up also exposed a real port collision: host OpenClaw defaulted to `18789`, while NemoClaw onboarding strongly assumes the same dashboard port.
- Scope: updated the NemoClaw local profiles so they now enable host OpenClaw on the dev-profile port `19001`, enable OpenShell sandbox delegation with explicit default sandbox id/image, taught the OpenShell adapter to accept an explicit sandbox name, taught the opencode action to auto-create the expected sandbox name instead of an anonymous one, improved the external tool probe so OpenClaw reports gateway reachability instead of CLI-only presence, added npm helpers for the dev-profile OpenClaw gateway, and updated the runbook to document the OpenClaw `19001` versus NemoClaw `18789` port ownership split.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`, `src/services/tools/adapters/openshellCliAdapter.ts`, `src/services/skills/actions/opencode.ts`, `src/services/tools/externalToolProbe.ts`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: pure `local-openclaw-stack` keeps the canonical OpenClaw local port `18789`. Only NemoClaw-oriented profiles move host OpenClaw to `19001`, because those profiles need `18789` free for NemoClaw dashboard bootstrap. The OpenShell auto-create path now prefers a deterministic sandbox name, which is safer for unattended implement/qa flows that already expect `muel-assistant`.
- Validation: live `npm run tools:probe -- --json`; live `Invoke-RestMethod http://127.0.0.1:18789/healthz`; live OpenClaw process inspection on port `18789`; targeted Vitest and `tsc --noEmit`

## 2026-04-13 - NemoClaw Local Max-Delegation Profile Added And Discord Marked As Replaceable Ingress

- Why: the existing local profiles still stopped short of the user's intended operating posture. NemoClaw-first local work could keep the implement lane on the remote worker or keep n8n delegation disabled, which meant “delegate locally as much as possible” still required manual `.env` surgery. The planning docs also still risked reading Discord as a fixed control surface instead of a replaceable ingress, and the main news/youtube/article-context call sites still treated n8n as a soft preference with inline fallback.
- Scope: added an explicit `local-nemoclaw-max-delegation` env profile that keeps the NemoClaw lane, points implement delegation at the local worker, enables local n8n delegation for the ready starter workflows, turns delegation-first into a real inline-fallback stop for the main news/youtube/article-context call sites, explicitly disables the legacy local news and YouTube fallback lanes in that profile, leaves alert dispatch on the inline fallback until a real sink exists, wired the profile into the apply script and npm scripts, updated the runbook, and documented Discord as a replaceable ingress in the single-ingress operating plan.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-nemoclaw-max-delegation.profile.env`, `scripts/apply-env-profile.mjs`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: existing conservative local profiles remain unchanged. The max-delegation profile is an explicit opt-in because local n8n delegation assumes the starter workflows are seeded and active. `N8N_DELEGATION_FIRST` is now intentionally fail-closed for configured news/youtube/article-context RSS paths so inline fetch/scrape/summary code stays off in that profile. Runtime alerts still keep inline fallback because the alert-dispatch webhook remains intentionally unset until a real n8n sink exists.
- Validation: `npm run env:profile:local-nemoclaw-max-delegation:dry`

## 2026-04-13 - Local n8n Bootstrap Can Auto-Provision Public API Keys And workflow.execute Falls Back To Webhooks

- Why: the remaining local n8n blocker was no longer installation or starter import, but the manual `N8N_API_KEY` step and the fact that local n8n 2.15 rejects `POST /api/v1/executions` with `405`, which left repo-side `workflow.execute` effectively broken for webhook-based starter workflows.
- Scope: taught `scripts/bootstrap-n8n-local.mjs` to generate or repair a repo-managed local n8n public API key directly from the running container and sync it into repo `.env`, expanded that repo-managed key to include workflow delete/activate/deactivate scopes, updated the generated local n8n README/operator docs to describe the auto-provision path, marked the seeded starter workflows active by default for localhost use by calling the dedicated activation route after public-API create/update, stamped deterministic `webhookId` values into starter webhook nodes so updateExisting can repair old CLI-imported workflows, switched the starter Code-node HTTP calls from plain `fetch` to n8n's request helper for runner compatibility, and taught the n8n adapter to fall back from direct execution to the workflow's webhook path when the local public API does not support `/api/v1/executions`.
- Impacted Routes: N/A
- Impacted Services: `scripts/bootstrap-n8n-local.mjs`, `scripts/bootstrap-n8n-local.test.ts`, `package.json`, `src/services/tools/adapters/n8nAdapter.ts`, `src/services/tools/adapters/n8nAdapter.enabled.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: local n8n `user_api_keys` rows are now managed automatically by the bootstrap script for the repo-managed `muel-local-public-api` label; no repo DB schema change
- Risk/Regression Notes: the auto-provisioner only runs against the local self-hosted `muel-local-n8n` container and only manages the repo-labeled public API key, so manually created UI keys are not rewritten. The starter bundle now comes up active on localhost, so review any imported webhook routes before exposing the service beyond loopback. `workflow.execute` webhook fallback is intentionally limited to workflows whose public definition still exposes a safe webhook node path; non-webhook workflows still surface the original execute failure.
- Validation: live `npm run n8n:local:doctor` already reports `workflowApiReady=true`; targeted Vitest for `scripts/bootstrap-n8n-local.test.ts` and `src/services/tools/adapters/n8nAdapter.enabled.test.ts`; live HTTP probe confirmed local n8n 2.15 returns `405` on `POST /api/v1/executions`, matching the fallback trigger

## 2026-04-13 - Local Profiles Now Enforce Direct-Vault-First Obsidian Routing And n8n List Can Fall Back To Container CLI

- Why: the local env profiles still left Obsidian effectively mixed or remote-first, and the repo-local `n8n.status` / `n8n.workflow.list` surfaces still looked artificially blocked when the local container was healthy but `N8N_API_KEY` had not been created yet.
- Scope: updated all local env profiles to enable `local-fs` plus `native-cli`, prioritize direct-vault adapters before `remote-mcp`, explicitly route `daily_note` and `task_management` through `native-cli`, exported the local n8n CLI workflow-list helper, and taught the `n8n.status` plus `n8n.workflow.list` skill actions to fall back to `docker exec ... n8n list:workflow` on `HTTP_401`.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-first-hybrid.profile.env`, `config/env/local-first-hybrid-gemma4.profile.env`, `config/env/local-openclaw-stack.profile.env`, `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`, `scripts/bootstrap-n8n-local.mjs`, `src/services/skills/actions/n8n.ts`, `src/services/skills/actions/n8n.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: `remote-mcp` remains configured as fallback, so shared ingress still survives local adapter outages. The new n8n CLI fallback is intentionally read-only for workflow discovery; workflow execute/status and public-API CRUD still require `N8N_API_KEY`.
- Validation: `npm run env:profile:local-nemoclaw-max-delegation`; direct router smoke showed `local-fs` primary for read/search/write and `native-cli` primary for daily/task; targeted Vitest for `scripts/bootstrap-n8n-local.test.ts` and `src/services/skills/actions/n8n.test.ts`

## 2026-04-13 - Local OpenJarvis Hybrid Lane Now Uses The Rust Memory Backend And Auth-Aware Windows Probes

- Why: the local Windows hybrid path still had one degraded-runtime gap and one observability gap. `jarvis serve` could come up while warning that `openjarvis_rust` was missing, which left the memory backend inactive, and the Windows readiness script could misreport the local API because it did not consistently use OpenJarvis auth headers or `.env` fallback values.
- Scope: documented the exact local bring-up and recovery order for the NemoClaw + OpenJarvis + n8n lane, hardened the Windows readiness probe flow around authenticated OpenJarvis checks, and validated the upstream OpenJarvis install path required to activate the Rust-backed memory lane.
- Impacted Routes: N/A
- Impacted Services: `docs/RUNBOOK_MUEL_PLATFORM.md`, `scripts/bootstrap-external-tools.ps1`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the local hybrid lane still keeps OpenJarvis on the validated LiteLLM/Qwen serve path; this change does not migrate the inference lane, but it removes the degraded memory-backend startup state and makes local health reporting closer to the real operator path. The Rust binding repair remains an operator-side install step against the upstream OpenJarvis checkout, not a vendored repo dependency.
- Validation: `npm run openjarvis:serve:local`; authenticated `GET http://127.0.0.1:8000/v1/models` returned `200`; OpenJarvis startup logged `Memory: active`

## 2026-04-13 - NemoClaw-Centered Local Stack Profile Added And Windows Readiness Checks Hardened

- Why: local Windows setup still had two practical blind spots for the NVIDIA/NemoClaw path. Operators had no dedicated NemoClaw-first env profile for the Nemotron 8B lane, and the Windows readiness script still treated Docker CLI presence as if the engine were up while also missing WSL-native OpenShell/NemoClaw installs. That made the intended setup path look less ready than it was and left the sandbox-to-host Ollama bridge implicit.
- Scope: added a dedicated `local-nemoclaw-stack` env profile, stamped `NEMOCLAW_SANDBOX_OLLAMA_URL=http://host.docker.internal:11434` into the local profiles that already enable NemoClaw, improved the Windows readiness script so it checks Docker engine state and probes OpenShell/NemoClaw inside WSL, and updated operator/env docs to reflect the new hardened local path.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-first-hybrid.profile.env`, `config/env/local-first-hybrid-gemma4.profile.env`, `config/env/local-openclaw-stack.profile.env`, `scripts/apply-env-profile.mjs`, `scripts/bootstrap-external-tools.ps1`, `package.json`, `.env.example`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the new profile intentionally keeps OpenJarvis workflow bindings on Qwen so the first Nemotron step is limited to the direct local lane and the NemoClaw sandbox lane. Existing local profiles that already enable NemoClaw now explicitly route sandbox inference to `host.docker.internal`, which is required on Windows Docker Desktop + WSL when Ollama stays on the host. The readiness script is now stricter about Docker by failing when the engine is down instead of silently treating CLI presence as enough.
- Validation: `npm run env:profile:local-nemoclaw-stack:dry`, `npm run lint`

## 2026-04-13 - OpenClaw-Centered Local Stack Env Profile Added

- Why: the repository already had OpenClaw, OpenShell, and NemoClaw integration points, but operators still had no dedicated env profile that treated OpenClaw as the primary local daemon ingress. That kept setup ergonomics biased toward Ollama-first or Hermes-side A/B flows even when the intended local operating model was "OpenClaw first, worker lane second."
- Scope: added a dedicated `local-openclaw-stack` env profile, wired it into the profile-apply script and npm entrypoints, and updated operator and environment docs so the OpenClaw-first setup path is visible without changing the runtime bootstrap DAG.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-openclaw-stack.profile.env`, `scripts/apply-env-profile.mjs`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the new profile defaults `OPENCLAW_GATEWAY_URL` and `OPENCLAW_BASE_URL` to the local OpenClaw gateway and blanks gateway/API tokens so it does not silently depend on a shared secret surface. It also defaults `MCP_IMPLEMENT_WORKER_URL` to the local opencode worker, which makes the stack genuinely local but requires the operator to start that worker first or override the URL back to the remote GCP worker when they want fail-closed unattended execution. OpenJarvis workflow bindings remain on the existing Qwen lane so this setup changes ingress ownership without turning the unattended execution path into an implicit model migration.
- Validation: `npm run env:profile:local-openclaw-stack:dry`, `npm run lint`

## 2026-04-13 - Autopilot Optimizer Now Returns An Asset Delegation Matrix For Hermes And Shared Surfaces

- Why: the optimizer could already describe route mode, workflow draft, and guardrails, but it still left one practical unattended-work gap unresolved: Hermes and GPT had to infer asset ownership from prose. That made it too easy to keep debating structure while missing the real question of which surface should own Supabase hot-state, Obsidian promotion, shared MCP wrappers, Hermes-local mutation, OpenJarvis local reasoning, and GPT recall boundaries.
- Scope: extended `automation.optimizer.plan` so it now returns an explicit `assetDelegationMatrix` describing default owners, current readiness, avoid rules, bottlenecks, and next moves for the main runtime assets; updated direct service and MCP tests; and documented that unattended Hermes work should consult this matrix before widening into document archaeology.
- Impacted Routes: existing local MCP tool `automation.optimizer.plan` only; no new route or tool name added
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive planner output only. The matrix does not change runtime ownership by itself; it makes the intended ownership explicit so Hermes, GPT, and future shared wrappers can converge on the same selection policy. Existing callers that only read route, workflow, or guardrail fields continue to work.
- Validation: `npm exec tsc -- --noEmit`; `npx vitest run src/services/automation/apiFirstAgentFallbackService.test.ts src/mcp/toolAdapter.test.ts`

## 2026-04-13 - Autopilot Tool-Layer Optimizer Now Returns Route, Cost, Observability, And Workflow Draft Contracts

- Why: the repository already had a useful API-first and agent-fallback route preview, but it still stopped at diagnostic guidance. That left the new Autopilot objective underpowered because the system could describe the route without also returning the operating contract, public-lane guardrails, shared-team scale-out posture, or a reusable n8n workflow draft that could become a real deterministic workflow.
- Scope: extended the automation planning service with an optimizer plan and workflow draft generator, reused the existing local n8n starter workflow builders to emit reusable draft candidates and optional seed payloads, exposed the new surfaces through local MCP tools, updated the activation pack guidance to recommend those tools, and documented the new planning surfaces in the GPT Hermes single-ingress operating plan.
- Impacted Routes: local MCP tools `automation.optimizer.plan` and `automation.workflow.draft`; existing `automation.route.preview` and activation-pack guidance now point at those deeper planning surfaces when relevant
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `src/mcp/toolAdapter.ts`, `src/mcp/toolAdapter.test.ts`, `scripts/lib/automationActivationPack.mjs`, `scripts/bootstrap-n8n-local.mjs`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive planning and draft-generation change only. The optimizer still preserves the existing API-first contract, keeps provider auth/versioning in the wrapped provider layer, keeps Supabase and Obsidian as the hot-state and semantic owners, and returns workflow drafts without auto-applying them. Public Discord routes now surface explicit sanitization guidance instead of assuming the fallback path is inherently safe.
- Validation: `npm exec tsc -- --noEmit`; `npx vitest run src/services/automation/apiFirstAgentFallbackService.test.ts src/mcp/toolAdapter.test.ts`

## 2026-04-13 - Hermes GPT Relaunches Can Now Acknowledge Closeout Back Into Hot-State

- Why: the queue-aware relay loop could already open the next bounded VS Code GPT turn, but it still stopped at launch. That left the actual GPT turn outcome outside the canonical workflow ledger, so Hermes had no deterministic way to know that the relaunched turn had completed, what it decided, whether it hit a boundary, or whether the queue-aware supervisor should continue.
- Scope: added a reusable workflow-event append helper for local and remote workflow sessions, added a dedicated `openjarvis:hermes:runtime:reentry-ack` CLI that records `reentry_acknowledged` plus closeout events back into workflow hot-state and can restart the queue-aware goal-cycle when safe, updated the GPT relaunch prompt to require the closeout acknowledgment command, and taught the queue-chat loop state to mark launched turns as awaiting reentry acknowledgment.
- Impacted Routes: no new HTTP route in this slice; the reentry acknowledgment path is exposed as a repo CLI command for bounded GPT turn closeout
- Impacted Services: `scripts/openjarvis-workflow-state.mjs`, `scripts/ack-openjarvis-reentry.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `package.json`, `scripts/ack-openjarvis-reentry.test.ts`, `scripts/openjarvis-workflow-state.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`
- Impacted Tables/RPC: existing `workflow_events` table only; no schema migration or new RPC required
- Risk/Regression Notes: the new reentry plane is additive. GPT closeout must still execute the explicit reentry-ack command for fully closed-loop behavior, but once run it records the outcome into the canonical workflow ledger and can restart the queue-aware supervisor without inventing a second state plane.
- Validation: `npx tsc --noEmit`; focused Vitest for `scripts/ack-openjarvis-reentry.test.ts`, `scripts/openjarvis-workflow-state.test.ts`, and `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`

## 2026-04-13 - Workflow Capability Demand Ledger Can Now Be Exported And Backfilled To Shared Obsidian

- Why: the hot-state plane now persists capability demands correctly, but the shared Obsidian backfill path still only knew about static repo docs and changelog mirrors. That meant the practical repeated-gap ledger remained stuck inside workflow_events unless someone manually reconstructed it.
- Scope: added a generated repo-visible workflow capability-demand ledger source, added an export script that compiles recent `capability_demand` workflow events into a markdown mirror, wired that mirror into `knowledge-backfill-catalog.json`, added focused script tests, and exposed composite npm commands for export plus shared-vault backfill.
- Impacted Routes: no new HTTP route; shared Obsidian backfill now has a dedicated catalog target for workflow capability-demand history via existing backfill tooling
- Impacted Services: `scripts/export-workflow-capability-demand-ledger.ts`, `scripts/export-workflow-capability-demand-ledger.test.ts`, `docs/planning/development/WORKFLOW_CAPABILITY_DEMAND_LEDGER.md`, `config/runtime/knowledge-backfill-catalog.json`, `package.json`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: reads existing `workflow_events` and `workflow_sessions`; no schema change
- Risk/Regression Notes: this adds a repo-visible generated mirror, not a new semantic owner. Supabase workflow events remain canonical hot-state; the generated markdown file is the compatibility source that lets shared Obsidian ingest the recent demand ledger without inventing a parallel runtime store.
- Validation: `npx tsc --noEmit`; focused Vitest for `scripts/export-workflow-capability-demand-ledger.test.ts`

## 2026-04-13 - Capability Demands Now Persist As Workflow Events And Closeout Helper Output

- Why: the session-open bundle and Hermes runtime note already projected a useful capability-demand ledger, but those demands were still derived from current runtime state instead of being recorded as hot-state history. That left GPT closeout quality partially manual and made it harder to distinguish newly discovered gaps from older unresolved demands.
- Scope: extended `workflowPersistenceService` with a dedicated `capability_demand` event helper plus latest-summary reader, added a reusable closeout helper in `actionRunner` so planner-empty and session-complete boundaries emit decision distillates and capability demands together, and updated `run-openjarvis-goal-cycle.mjs` plus the OpenJarvis status contract so session-open bootstrap prefers persisted capability-demand history over freshly derived fallback demand generation.
- Impacted Routes: existing `GET /agent/runtime/openjarvis/autopilot`, `GET /agent/runtime/openjarvis/session-open-bundle`, `automation.session_open_bundle`, and `POST /agent/runtime/openjarvis/hermes-runtime/chat-note` surfaces now see persisted capability-demand history when present without adding a new route
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/skills/actionRunner.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.test.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`
- Impacted Tables/RPC: existing `workflow_events` table only; no schema migration or new RPC required
- Risk/Regression Notes: capability-demand persistence is additive and keeps the derived bundle path as fallback, so older workflow sessions without the new event type still bootstrap correctly. The new closeout helper intentionally preserves the existing decision-distillate wording while attaching a parallel demand ledger for planner-empty and failed pipeline boundaries.
- Validation: `npx tsc --noEmit`; targeted Vitest coverage for `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.test.ts`, and `scripts/openjarvis-remote-workstream-smoke.test.ts`

## 2026-04-13 - Session-Open Bundle Now Exposes Compact Bootstrap And Capability Demands

- Why: the dual-agent contract already said GPT should start from a very small bundle and Hermes should leave behind reusable capability-demand artifacts instead of forcing repeated context reacquisition. But the runtime surfaces still returned a larger undifferentiated bundle and the Hermes runtime note did not project the missing-capability ledger explicitly.
- Scope: updated `scripts/run-openjarvis-goal-cycle.mjs` so the session-open bundle now emits `compact_bootstrap` and `capability_demands` projections derived from current hot-state, route guidance, blockers, recall boundaries, and queued objectives; updated `openjarvisHermesRuntimeControlService` so the Hermes runtime Obsidian note includes those sections and persists the resulting demand summaries and next queue head in note metadata; updated the TypeScript status contract and focused tests for the new shape.
- Impacted Routes: existing `GET /agent/runtime/openjarvis/session-open-bundle`, `automation.session_open_bundle`, and `POST /agent/runtime/openjarvis/hermes-runtime/chat-note` surfaces now return or project the smaller bootstrap contract and capability-demand ledger without adding a new endpoint
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`
- Impacted Tables/RPC: none
- Risk/Regression Notes: additive read-model change only. Capability demands are currently derived from existing runtime state rather than recorded as their own workflow event type, so the ledger is immediately useful for bootstrap and Obsidian projection without yet changing workflow persistence.
- Validation: `npx tsc --noEmit`; `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts`; focused Vitest run for `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts` via a temporary single-file config

## 2026-04-13 - Hermes Runtime Contract Now Treats Hermes As GPT's Delegate And Records Capability Demands

- Why: the repo had already defined Hermes as the persistent continuity runtime, but the operator goal is stronger than passive continuity. Hermes is intended to act as GPT's hands-side collaborator and delegate, especially for dynamic research, bounded crawling, environment probing, and low-cost evidence gathering. Without an explicit contract, repeated missing capabilities risked being rediscovered as narrative friction instead of being promoted into reusable system improvements.
- Scope: updated `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md` to define Hermes as GPT's delegated hands and proxy, require asymmetric efficiency where GPT focuses on reasoning and Hermes focuses on bounded execution and research, and add a `capability_demand` contract so missing tools, routes, adapters, sync gaps, or enablement steps are left behind as Obsidian-visible reusable improvement inputs instead of transient chat residue.
- Impacted Routes: no runtime route added yet; this change defines the documentation contract future runtime closeout helpers should emit
- Impacted Services: `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation-only change. The main design implication is that repeated missing capability discovery should now converge into deterministic scripts, adapters, n8n branches, shared MCP contracts, or canonical notes rather than recurring workaround text.
- Validation: manual alignment review against `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md`, `docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md`, and shared Obsidian requirement archaeology

## 2026-04-13 - GPT Hermes Efficient Operating Contract Now Uses A 2 Plus 1 Habit Model

- Why: the repo had already proved bounded continuity, queued VS Code relaunch, and Hermes runtime readiness, but the practical working habit was still too implicit. That created avoidable startup archaeology, overly broad turn closeouts, and repeated confusion about what GPT should do inside a bounded turn versus what Hermes should keep doing between turns.
- Scope: updated `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md` to codify a compact 2 plus 1 operating contract: GPT starts by reading the smallest useful bundle and identifying the cheapest valid route; GPT ends by distilling the turn into a compact restart surface and bounded next-objective queue; Hermes owns between-session continuity, personalization, low-cost local execution, and explicit recall back to GPT.
- Impacted Routes: no new route or CLI contract added
- Impacted Services: `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: none
- Risk/Regression Notes: documentation-only change. The main effect is to narrow the expected operator habit around session-open bundle first, API-first and agent-fallback routing, short closeout distillates, and Hermes-managed continuity instead of broad packet or doc rereads.
- Validation: shared requirement compile against shared Obsidian context; manual alignment review against `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, and the current runtime operating baseline memory

## 2026-04-13 - Queue-Aware Hermes Loop Now Prioritizes Operator Queue And Exposes Live Chat-Launch Flag

- Why: the first queue-aware live-loop rollout still had two practical gaps. Released packet-resume launches could outrank the next approved queued objective, and the runtime status payload exposed `auto_select_queued_objective` but not `auto_launch_queued_chat`, forcing operators to read the loop state file directly to confirm whether live queued chat handoff was armed.
- Scope: updated `run-openjarvis-goal-cycle.mjs` so a distinct queued objective can preempt released packet-resume when queue-aware mode is enabled and no explicit capacity-recovery override is active; merged packet `safe_queue` entries into workstream-derived resume state; surfaced `auto_launch_queued_chat` in the status payload; and changed Hermes queue writes so the latest operator-injected objective is prepended to the safe queue instead of appended.
- Impacted Routes: existing `GET /agent/runtime/openjarvis/autopilot` status route now includes `supervisor.auto_launch_queued_chat`; existing queue/chat runtime routes are reused
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: queue-aware preemption still does not override explicit GCP capacity-recovery runs or `continueUntilCapacity` loops. The live loop now favors the latest operator-approved safe-queue objective for bounded VS Code chat handoff, which is the intended autonomy posture after released sessions.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts`; temporary-config Vitest run for `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`; `npx vitest run --project=routes src/routes/botAgentObsidianRuntime.test.ts`; `npx tsc --noEmit`; live queue injection + `queued_chat_launched` verification through `npm run openjarvis:goal:status`

## 2026-04-13 - Hermes Runtime Notes Now Project Supabase Hot-State Into Obsidian

- Why: the runtime surfaces already knew whether the active workflow was coming from Supabase and already carried compact decision distillates, recall boundaries, and artifact refs. But the operator-visible Hermes chat-note projection still flattened that state into a generic runtime summary, which made the visible Obsidian surface weaker than the actual hot-state plane.
- Scope: taught `openjarvisHermesRuntimeControlService` to build Hermes runtime chat notes from the current status plus the compact session-open bundle, explicitly label the hot-state source, and project the latest decision distillate, recall boundary, queued objectives, and artifact refs into both the note body and frontmatter.
- Impacted Routes: existing `POST /agent/runtime/openjarvis/hermes-runtime/chat-note` route and `automation.hermes_runtime.chat_note` MCP tool reuse the richer projection automatically
- Impacted Services: `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive read-model change only. Supabase remains the hot mutable ledger when the workflow source is `supabase`; Obsidian notes stay visible projections for operators and chat follow-up.
- Validation: targeted Vitest for `openjarvisHermesRuntimeControlService`, plus focused typecheck/tests for the modified slice

## 2026-04-13 - Queue-Aware Hermes Supervisor Can Launch The Next VS Code Chat Turn

- Why: manual queue-objective and chat-launch surfaces were already available, but the continuous goal-cycle supervisor still stopped at the point where it had selected the next approved objective. That left one obvious gap in the local autonomy story: Hermes could identify the next bounded task, yet the operator still had to manually translate that into the new GPT chat-launch surface.
- Scope: taught `run-openjarvis-goal-cycle.mjs` to optionally combine queued-objective selection with the Hermes runtime control helper when `autoLaunchQueuedChat=true`, added a thin `run-openjarvis-hermes-runtime-control.ts` CLI for direct queue and chat actions, added package entrypoints for the queue-chat supervisor and low-level runtime-control commands, updated smoke coverage for forwarded launch args, documented the bounded `queued_chat_launched` stop behavior plus the new operator entrypoints, and wired `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md` into the knowledge backfill catalog so the updated operator flow can promote into the shared Obsidian surface.
- Impacted Routes: existing Hermes runtime queue/chat routes and MCP tools are reused; no new HTTP route or MCP method was required for this slice
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/run-openjarvis-hermes-runtime-control.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `package.json`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: queue-to-chat relaunch remains opt-in. The supervisor does not assume a hidden persistent GPT process; it yields immediately after opening the bounded VS Code chat handoff and records that yield as `queued_chat_launched`. On Windows, the Hermes bridge keeps pinning the VS Code CLI to `bin/code.cmd` so the chat launch uses the documented CLI shim rather than relying on `Code.exe` resolution.
- Validation: focused Vitest coverage for runtime, route, MCP, and smoke files; `npm exec tsc -- --noEmit`; `code.cmd chat --help`; dry-run Hermes bridge chat launch via `node --import dotenv/config --import tsx ./scripts/run-hermes-vscode-bridge.ts --action=chat --prompt="Hermes queued objective smoke" --chatMode=agent --dryRun=true`

## 2026-04-13 - Hermes Can Queue The Next Objective And Relaunch VS Code Chat Via Native CLI

- Why: the repo had already proven that Hermes could preserve bounded continuity across GPT session boundaries, but there was still one material gap in the local IDE operating model: Hermes could keep packet state and queued objectives alive, yet it still could not explicitly seed the next approved objective back into a fresh VS Code Copilot chat turn. That made it look like a GUI-agent or Computer-Use layer might be required when the real missing primitive was a narrow prompt-launch surface.
- Scope: extended the Hermes VS Code bridge allowlist with a native `chat` action backed by the documented `code chat` CLI, added Hermes runtime control functions to append approved objectives into the continuity handoff packet safe queue and launch a fresh VS Code chat session from the compact session-open bundle, wired those capabilities into admin routes and local MCP tools, and updated the GPT-Hermes operating plan to state that broad desktop automation is not the default requirement for GPT reactivation in the local IDE.
- Impacted Routes: `POST /agent/runtime/openjarvis/hermes-runtime/queue-objective`, `POST /agent/runtime/openjarvis/hermes-runtime/chat-launch`, `POST /agent/runtime/hermes/vscode-bridge`, local MCP tools `automation.hermes_runtime.queue_objective`, `automation.hermes_runtime.chat_launch`
- Impacted Services: `src/services/runtime/hermesVsCodeBridgeService.ts`, `scripts/run-hermes-vscode-bridge.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/mcp/toolAdapter.ts`, `src/services/runtime/hermesVsCodeBridgeService.test.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive local-control change only. Hermes still uses an allowlisted bridge and explicit queue surfaces instead of broad desktop control, and the new chat launch flow remains dependent on the same packet logging and VS Code CLI availability checks as the rest of the bridge.
- Validation: `npx vitest run src/services/runtime/hermesVsCodeBridgeService.test.ts src/services/openjarvis/openjarvisHermesRuntimeControlService.test.ts src/routes/botAgentObsidianRuntime.test.ts src/mcp/toolAdapter.test.ts src/routes/botAgentRoutes.smoke.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Hermes Runtime Added Standalone Diagnostics And One-Click Remediation

- Why: the new `hermes_runtime` readiness block made the maturity gap visible, but it still required two extra operator steps that were unnecessary friction: fetching the full session-open bundle just to inspect runtime state, and manually translating blocker text into the same supervisor or VS Code bridge commands every time. The next safe step was to expose the runtime snapshot directly and attach bounded remediation actions to the subset of blockers that already had reusable local control surfaces.
- Scope: added standalone Hermes runtime inspection and remediation surfaces for admin routes and local MCP tools, introduced a thin `openjarvisHermesRuntimeControlService` that reuses the existing goal-cycle supervisor launcher, Hermes VS Code bridge, and Obsidian chat/inbox note schema, extended `hermes_runtime` with structured `remediation_actions`, added a direct Obsidian chat-note creation surface for visible local interaction, and documented the direct-diagnostic and note-seeding contract in the GPT-Hermes operating plan.
- Impacted Routes: `GET /agent/runtime/openjarvis/autopilot`, `GET /agent/runtime/openjarvis/session-open-bundle`, `GET /agent/runtime/openjarvis/hermes-runtime`, `POST /agent/runtime/openjarvis/hermes-runtime/chat-note`, `POST /agent/runtime/openjarvis/hermes-runtime/remediate`, local MCP tools `automation.session_open_bundle`, `automation.hermes_runtime`, `automation.hermes_runtime.chat_note`, `automation.hermes_runtime.remediate`, local CLI `openjarvis:goal:status`
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentRoutes.smoke.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/chat.ts`, `src/mcp/toolAdapter.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive control-plane change only. The new remediation surface reuses existing supervisor and VS Code bridge execution paths instead of introducing a parallel runtime controller; the POST/admin and MCP remediation entrypoints still execute only a narrow allowlist of bounded actions and keep dry-run support for inspection-first workflows.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/botAgentObsidianRuntime.test.ts src/routes/botAgentRoutes.smoke.test.ts src/mcp/toolAdapter.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Hermes Runtime Readiness Added To Goal-Cycle Status And Session-Open Bundle

- Why: the repository had already proved that Hermes can cross a GPT session boundary, but that proof still left one operator-visible ambiguity unresolved: the runtime surfaces did not explicitly say whether Hermes was currently acting like a helper, a continuity sidecar, or a near-persistent local operator. That made it too easy to confuse post-session continuity with full local-runtime maturity.
- Scope: added a `hermes_runtime` readiness block to goal-cycle status and the compact session-open bundle, derived from release-to-resume continuity, supervisor liveness, hot-state attachment, queued objective promotion, route exposure of `hermes-local-operator`, and observed IDE handoff signals; updated focused smoke, route, and MCP tests; and documented the new readiness surface in the GPT-Hermes operating plan.
- Impacted Routes: `GET /agent/runtime/openjarvis/autopilot`, `GET /agent/runtime/openjarvis/session-open-bundle`, local MCP tool `automation.session_open_bundle`, local CLI `openjarvis:goal:status`
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive read-model change only. The readiness block does not start or stop the loop by itself; it makes the current maturity gap explicit so the operator can distinguish safe bounded continuity from a truly persistent local-runtime posture.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/botAgentObsidianRuntime.test.ts src/mcp/toolAdapter.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Hermes Can Promote Approved Queue Items Into New Objectives

- Why: the previous continuous-loop work proved that Hermes could restart the same bounded objective after release, but it still did not satisfy the stronger autonomy requirement of selecting the next approved goal when the current one was complete. The missing behavior was not more relaunch mechanics; it was a safe next-objective selector that could reuse existing approval surfaces instead of stopping at every GPT boundary.
- Scope: added an autonomous goal-candidate reader that prioritizes Safe Autonomous Queue items and then `docs/planning/EXECUTION_BOARD.md` `Queued Now`, exposed those candidates through goal-cycle status and the compact session-open bundle, taught the continuous supervisor loop to launch one approved queued objective at a time when `autoSelectQueuedObjective=true`, and added new queue-oriented autopilot npm entrypoints plus updated overnight docs.
- Impacted Routes: `GET /agent/runtime/openjarvis/session-open-bundle`, local MCP tool `automation.session_open_bundle`, local CLI `openjarvis:goal:status`
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `package.json`, `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: queue-driven next-goal selection is opt-in. Default resume and bounded-loop behavior remain unchanged unless `autoSelectQueuedObjective=true` or the new queue-oriented scripts are used. Escalation boundaries still stop the loop instead of silently consuming the next backlog item.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Overnight GCP Recovery Loop Can Run Unbounded Until A Real Stop Condition

- Why: the existing continuous-loop proof only demonstrated repeated bounded relaunches. It still defaulted to tiny loop caps, which meant Hermes could prove session resurrection but not realistically stay active overnight while the operator was absent. The remaining autonomy gap was not restart correctness anymore; it was uninterrupted duration on the GCP and Render recovery path.
- Scope: added explicit loop-limit normalization so `maxCycles=0` and `maxIdleChecks=0` can mean unbounded supervisor operation, forced GCP-capacity-recovery launches from `auto` into the `operations` route, taught unattended operations runs to capture `ops:gcp:report:weekly` before memory sync and gates, added smoke coverage for the new loop-limit and operations-step behavior, and added dedicated overnight npm entrypoints for the hidden or visible GCP recovery lane.
- Impacted Routes: N/A
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/run-openjarvis-unattended.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `package.json`, `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: bounded loop defaults remain unchanged for the generic `openjarvis:autopilot:loop` surface. Unbounded behavior is opt-in through explicit zero-valued limits or the new overnight GCP recovery scripts, and the loop still stops on wait boundaries, escalation, capacity target completion, or explicit run failure.
- Validation: `npx vitest run scripts/openjarvis-remote-workstream-smoke.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Compact Bootstrap Priority Codified Before Advisor-Style Escalation

- Why: after the closed-loop restart proof and the compact session-open bundle landed, the next design question was whether the repo should immediately add Claude-style advisor orchestration. The current context-footprint audit showed that startup and workflow context cost remain the bigger bottleneck, so the repo needed an explicit machine-readable rule that bootstrap compaction comes first and advisor-style escalation stays conditional.
- Scope: extended the API-first and agent-fallback routing service with orchestration guidance in both the capability catalog and route preview, extended the session-open bundle with the same compact-bootstrap-first guidance, added focused tests across automation, runtime, smoke, and MCP surfaces, and updated planning docs so the same priority is documented in the GPT-Hermes operating contract.
- Impacted Routes: `GET /agent/runtime/openjarvis/session-open-bundle`, local MCP tools `automation.capability.catalog`, `automation.route.preview`, `automation.session_open_bundle`
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive guidance only. The new fields do not change workflow execution by themselves; they make route posture explicit so deterministic API-first work can stay advisor-free, hard reasoning checkpoints can request at most one bounded advisor hop, and policy-sensitive work still routes directly to GPT recall.
- Validation: `npx vitest run src/services/automation/apiFirstAgentFallbackService.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/botAgentObsidianRuntime.test.ts src/mcp/toolAdapter.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - OpenJarvis Session-Open Bundle Added For Compact GPT And Hermes Bootstrap

- Why: proving released-session auto-restart solved the continuity boundary, but session-open cost was still too high because the next GPT or Hermes cycle had to reacquire context from broad status and planning surfaces. The next optimization step needed one compact bootstrap object that carries only the active hot-state delta, route guidance, continuity rule, and optional operator personalization.
- Scope: added a reusable session-open bundle builder on top of the existing goal-cycle status payload, exposed it through the local CLI, runtime admin route, and local MCP tool adapter, and added focused tests for the compact bundle plus route and MCP contracts.
- Impacted Routes: `GET /agent/runtime/openjarvis/session-open-bundle`, local MCP tool `automation.session_open_bundle`
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/mcp/toolAdapter.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`, `src/mcp/toolAdapter.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the bundle is a compact read model only; it does not change workflow execution. Personalization is optional on the route and MCP surfaces and absent from the local CLI surface unless a future slice wires the same snapshot into local script execution.
- Validation: `node scripts/run-openjarvis-goal-cycle.mjs --sessionOpenBundle=true --runtimeLane=operator-personal`, `npx vitest run src/mcp/toolAdapter.test.ts scripts/openjarvis-remote-workstream-smoke.test.ts src/routes/botAgentObsidianRuntime.test.ts src/routes/botAgentRoutes.smoke.test.ts`, `npx tsc --noEmit`

## 2026-04-13 - Closed-Loop Hermes Proof Elevated Into Bootstrap And Logging Rules

- Why: after live validation proved that Hermes can restart the next bounded cycle after a released session, the remaining architecture problem was no longer proof of continuity. The remaining problem was reducing session-open cost, making personalization explicit, and ensuring that autonomy changes always leave durable Obsidian-visible artifacts.
- Scope: updated the single-ingress compatibility plan to record the validated closed-loop proof and define post-proof optimization priorities, and tightened the dual-agent runtime contract with explicit bootstrap minimization, Obsidian logging, and personalization rules.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: documentation-only change. Runtime behavior is unchanged by this entry; it codifies how future session bootstrap, personalization, and durable knowledge promotion should be shaped now that released-session auto-restart is proven.
- Validation: live bounded goal-cycle proof already recorded in runtime artifacts; markdown review

## 2026-04-12 - Hermes Supervisor Can Auto-Restart Released Automation Cycles

- Why: the previous loop still stopped at release unless the old GCP-capacity exception was active, which meant Hermes could keep a session alive but not convincingly prove that it can restart the next bounded cycle after a session has already completed.
- Scope: added explicit `auto_restart_on_release` metadata through the OpenJarvis unattended workflow session, taught resume-state derivation and continuity packets to treat eligible released sessions as Hermes-resumable again, surfaced that rule through goal-cycle status, and added smoke coverage for the released-then-resumable case.
- Impacted Routes: indirect runtime visibility via existing goal-cycle status surfaces
- Impacted Services: `scripts/openjarvis-workflow-state.mjs`, `scripts/run-openjarvis-unattended.mjs`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: auto restart remains bounded and opt-in at the workflow metadata level. The loop still stops on escalation, wait boundaries, or failed health signals; the new behavior only changes released sessions that are explicitly marked as restartable automation cycles.
- Validation: targeted Vitest for `scripts/openjarvis-remote-workstream-smoke.test.ts`, live goal-cycle loop smoke, `npx tsc --noEmit`

## 2026-04-12 - Hermes Continuity Packets Now Carry Hybrid Route Guidance

- Why: the repository already knew how to describe API-first versus fallback routing at the architecture level, but Hermes continuity packets still carried only status and next-action data. That left the local persistent runtime without one explicit, machine-readable statement of which path to prefer for the active objective.
- Scope: taught the continuity packet sync to compute API-first and agent-fallback guidance for the active workflow objective, embed that guidance plus MCP wrapping patterns into the handoff and progress packets, surface the same parsed guidance through goal-cycle status, and update the continuity docs so packet semantics now include route guidance rather than status alone.
- Impacted Routes: indirect runtime visibility via existing goal-cycle status surfaces
- Impacted Services: `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: this change does not auto-reroute live work by itself. It closes the Hermes-side loop by making the preferred deterministic path, fallback surfaces, canonical example match, and wrapping pattern explicit in the continuity packets and status payload, while leaving the underlying workflow engine unchanged.
- Validation: targeted Vitest for `scripts/openjarvis-remote-workstream-smoke.test.ts`, focused infra and routes coverage, `npx tsc --noEmit`

## 2026-04-12 - API-First Hybrid Routing Diagnostic Surface Added

- Why: the repository already had local n8n bootstrap, shared MCP routing, external adapter wrapping, and Hermes continuity, but those surfaces still lacked one explicit contract that says when automation should stay on the cheap deterministic API path and when it should escalate into MCP or Hermes fallback. Without that contract, the assets were real but still felt operationally scattered.
- Scope: added a small routing service that summarizes current API-first, MCP wrapping, Hermes fallback, remote execution, canonical examples, and observability layering; exposed that summary and a route-preview calculator as new MCP tools; and updated canonical architecture docs so the target hybrid pattern is now documented as API-first first, agent fallback second, and Obsidian promotion last.
- Impacted Routes: indirect MCP surface only via existing `/api/mcp/rpc` and `/api/mcp/tools`
- Impacted Services: `src/services/automation/apiFirstAgentFallbackService.ts`, `src/services/automation/apiFirstAgentFallbackService.test.ts`, `src/mcp/toolAdapter.ts`, `src/mcp/toolAdapter.test.ts`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`, `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: this slice is diagnostic and planning-oriented. It does not silently reroute existing production tasks. Existing n8n delegation, shared MCP proxy routing, and Hermes goal-cycle behavior stay intact until later slices bind concrete workloads to the new contract. The new canonical example and observability sections document that the reverse-engineered YouTube community workflow is already a valid handoff slice, and that OpenJarvis is only one observability layer rather than the whole stack.
- Validation: focused Vitest coverage for the new routing service and MCP tool adapter, `npx tsc --noEmit`

## 2026-04-12 - Local n8n Seed Now Falls Back To Container CLI Import

- Why: local n8n bootstrap was already in place, but starter workflow import still looked blocked on `N8N_API_KEY` even for the initial local self-hosted case. That created unnecessary friction in the exact bootstrap path now prioritized for Hermes plus local n8n.
- Scope: taught the local n8n bootstrap script to fall back to `docker exec ... n8n import:workflow` when the local container is running but `N8N_API_KEY` is absent, added parsing/tests for the CLI list output, and updated operator docs to distinguish initial local import from public-API CRUD/update flows.
- Impacted Routes: N/A
- Impacted Services: [scripts/bootstrap-n8n-local.mjs](scripts/bootstrap-n8n-local.mjs), [scripts/bootstrap-n8n-local.test.ts](scripts/bootstrap-n8n-local.test.ts), [docs/RUNBOOK_MUEL_PLATFORM.md](docs/RUNBOOK_MUEL_PLATFORM.md)
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the CLI fallback only supports initial import or skip-existing behavior. Updating existing workflows through the repo still requires `N8N_API_KEY` and the public API path. Imported starter workflows remain review-first and should not imply that delegation is safe to enable immediately.
- Validation: `npm run n8n:local:seed`, targeted Vitest for bootstrap and goal-cycle scripts, `npx tsc --noEmit`

## 2026-04-12 - GCP Capacity Recovery Demoted From Default Autopilot Goal To Explicit Override

- Why: GCP capacity recovery started as an experimental operator objective, but the current goal-cycle defaults and packet handling let that experiment behave too much like a persistent success metric. For the local-first Hermes rollout, the active goal is local continuity plus self-hosted n8n orchestration, not silently chasing a stored remote-capacity target across sessions.
- Scope: hardened the goal-cycle so continuous loop mode no longer defaults to `continueUntilCapacity`, stopped stale packet or workstream recovery flags from automatically reviving GCP-capacity mode, added a regression test for stale packet recovery text, and updated the planning docs to describe remote leverage as optional diagnostics or explicit override work rather than the default target of the local-first loop.
- Impacted Routes: N/A
- Impacted Services: [scripts/run-openjarvis-goal-cycle.mjs](scripts/run-openjarvis-goal-cycle.mjs), [scripts/openjarvis-remote-workstream-smoke.test.ts](scripts/openjarvis-remote-workstream-smoke.test.ts), [docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md](docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md), [docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md](docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md)
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: explicit `--gcpCapacityRecovery=true --continueUntilCapacity=true` flows still work, including the dedicated gcp-recovery npm scripts. What changed is the default and the persistence rule: old packet text or old workstream state no longer re-arms that mode unless the current invocation asks for it.
- Validation: targeted smoke tests plus typecheck

## 2026-04-12 - GPT Session Limits And Hermes Persistence Elevated As First-Class Planning Premises

- Why: the repository already had a dual-agent target document, but the adjacent compatibility documents still read too much like GPT should remain the only real assistant. That framing hid the actual operating premise: GPT-5.4 cannot keep acting once a bounded Autopilot session ends, while the locally running Hermes agent can persist and carry continuity, learning, and local execution forward.
- Scope: updated the single-ingress compatibility plan, the dual-agent target-state plan, and the current runtime continuity contract so they all explicitly separate compatibility-mode single ingress from the real target state where Hermes is a true second assistant and local self-hosted n8n is part of the practical orchestration path.
- Impacted Routes: N/A
- Impacted Services: [docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md](docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md), [docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md](docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md), [docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md](docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md)
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: documentation-only change. The live compatibility loop still uses packet-centered single ingress, but those docs no longer define that fallback as the architectural target. The target state now explicitly depends on Hermes persistence to overcome GPT session boundaries and treats local self-hosted n8n as a valid orchestration surface.
- Validation: markdown review

## 2026-04-12 - Docker Desktop Repositioned As Local Infra Sidecar Surface

- Why: local Windows development in this repository needs a more precise stance than either “put everything in Docker Desktop” or “remove Docker Desktop entirely.” Official Docker and WSL guidance aligns with a hybrid split: keep high-I/O agent work and host-native model inference outside container bind-mount loops, while still using Docker Desktop where isolation, restart policy, port publishing, and operator visibility materially help.
- Scope: added a tracked local infra compose file for a Docker Desktop LiteLLM sidecar that reaches host-native Ollama via `host.docker.internal`, added npm helper commands for that compose surface, and updated the single-ingress operating plan plus runbook to define Docker Desktop as an infra sidecar lane rather than the primary Hermes execution substrate.
- Impacted Routes: N/A
- Impacted Services: [compose.local-infra.yaml](compose.local-infra.yaml), [package.json](package.json), [docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md](docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md), [docs/RUNBOOK_MUEL_PLATFORM.md](docs/RUNBOOK_MUEL_PLATFORM.md)
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the new Docker Desktop helper intentionally does not containerize Ollama or the repo edit loop. It only covers the LiteLLM sidecar, preserving the existing local-first hybrid contract where inference remains host-native and high-I/O work stays out of Windows bind-mount bottlenecks. n8n bootstrap remains on its separate generated compose path.
- Validation: `docker compose -f compose.local-infra.yaml config`, `npx tsc --noEmit`

## 2026-04-12 - Local n8n Bootstrap Surface Added For Self-Hosted Delegation Readiness

- Why: the repository already had n8n delegation and adapter wiring, but local operators still lacked a turnkey way to scaffold a self-hosted n8n instance, inspect readiness, and understand the difference between webhook delegation readiness and REST API key readiness.
- Scope: added a local n8n bootstrap/doctor script plus npm entrypoints, stamped safe local n8n defaults into the local env profiles, wired concrete `N8N_WEBHOOK_*` defaults, expanded the generated starter bundle to cover all seven delegatable webhook tasks, added a manifest plus public-API seed path for importing/updating that bundle when `N8N_API_KEY` is present, clarified the local bootstrap path in operator docs and `.env.example`, and hardened `n8n.status` so a reachable local n8n without `N8N_API_KEY` reports the real auth gap instead of looking fully disconnected.
- Impacted Routes: N/A
- Impacted Services: `scripts/bootstrap-n8n-local.mjs`, `scripts/bootstrap-n8n-local.test.ts`, `package.json`, `config/env/local.profile.env`, `config/env/local-first-hybrid.profile.env`, `.env.example`, `.env`, `src/services/skills/actions/n8n.ts`, `src/services/skills/actions/n8n.test.ts`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the bootstrap script still writes only into `tmp/n8n-local/`, which is git-ignored, and preserves an existing generated `.env` unless `--force=true` is passed. Webhook path defaults are pre-wired in local profiles and the active `.env`, but `N8N_DELEGATION_ENABLED` remains false by default so seeded workflows can be reviewed and activated safely before delegation is turned on. The new `n8n:local:seed` path requires `N8N_API_KEY`; without it, the repo can still use webhook delegation once workflows are imported manually. The `alert-dispatch` starter deliberately requires a real sink so inline alert fallback is not silently swallowed.
- Validation: `node scripts/bootstrap-n8n-local.mjs --dryRun=true`, `node scripts/bootstrap-n8n-local.mjs --status=true`, `vitest run scripts/bootstrap-n8n-local.test.ts src/services/skills/actions/n8n.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - Workflow Artifact Refs Now Persist In Hot-State And Surface In Autopilot Status

- Why: the dual-agent target state called for `artifact_ref` as a hot-state object, but pipeline execution still kept artifacts as opaque strings inside step results and logs. That meant files, URLs, workflow-session handles, and reflection targets could not be recovered from runtime state without replaying raw artifacts.
- Scope: added structured `artifact_ref` workflow-event batching, taught `goal-pipeline` to extract ref-like artifact strings from step outputs, and surfaced the latest artifact-ref batch through workflow summaries and OpenJarvis autopilot status.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.ts`, `src/services/skills/actionRunner.test.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/botAgentObsidianRuntime.test.ts`
- Impacted Tables/RPC: no new table or RPC contract added; `public.workflow_events` now also carries `artifact_ref` batches in payload form
- Risk/Regression Notes: extraction is intentionally conservative and only persists ref-like artifacts such as repo/vault paths, URLs, git refs, workflow session handles, and reflection targets. Free-form artifact text remains unstructured to avoid turning arbitrary summaries into false references.
- Validation: `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.test.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - Workflow Decision Distillates Now Persist In Hot-State And Surface In Autopilot Status

- Why: the workflow plane already carried `recall_request`, but it still lacked a compact durable conclusion object that could survive execution and later be promoted into Obsidian without replaying raw step logs. That left runtime/operator surfaces able to say a recall happened, but not what the short reusable conclusion actually was.
- Scope: added a first-class `decision_distillate` workflow-event helper and session-summary projection, taught `goal-pipeline` to emit distillates for planner-empty, released, and failed completions, and surfaced the latest distillate through the OpenJarvis autopilot status payload used by runtime admin routes.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/botAgentObsidianRuntime.test.ts`
- Impacted Tables/RPC: no new table or RPC contract added; `public.workflow_events` now also carries `decision_distillate` events alongside `recall_request`
- Risk/Regression Notes: the new distillate payload is intentionally compact and promotion-oriented (`next_action`, `source_event`, `promote_as`, `tags`) so runtime surfaces can show the latest durable conclusion without treating raw artifacts as structured refs. This closes part of the dual-agent hot-state target without changing public API shapes beyond additive fields.
- Validation: `src/services/workflow/workflowPersistenceService.test.ts`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - OpenJarvis Autopilot Status Now Surfaces Recall And GCP Capacity In Runtime APIs

- Why: the goal-cycle scripts already computed composite Autopilot capacity, GCP-native leverage, and packet-derived resume state, but the server-side runtime admin APIs still exposed only worker, queue, and memory-sync health. That left the new `recall_request` hot-state and GCP-capacity recovery lane effectively invisible to operators unless they ran the local script directly.
- Scope: made the goal-cycle status module import-safe, added latest structured recall-request summary to the status payload, wrapped that payload in a runtime service, and exposed it through both `unattended-health` and a dedicated OpenJarvis autopilot runtime route.
- Impacted Routes: `GET /agent/runtime/unattended-health`, `GET /agent/runtime/openjarvis/autopilot`
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/services/openjarvis/openjarvisAutopilotStatusService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`
- Impacted Tables/RPC: no new table or RPC contract added; runtime API now surfaces the existing `recall_request` event semantics already stored in `public.workflow_events`
- Risk/Regression Notes: the route now reports both packet/workstream continuity state and GCP-native capacity from the existing goal-cycle status builder, so operators can distinguish healthy local continuity from real remote-lane leverage without shelling into the script manually. Import-guarding the goal-cycle script also prevents accidental CLI execution when the status builder is reused from server-side code.
- Validation: `scripts/openjarvis-remote-workstream-smoke.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - Workflow Recall Requests Now Live In Structured Runtime State

- Why: the dual-agent runtime contract already defined `recall_request` as the right boundary when Hermes or pipeline automation needed GPT re-entry, but the canonical repository workflow plane still only exposed failure rows and free-form packets. That meant recall intent could disappear from the hot-state layer even when workflow rows were present.
- Scope: added a structured workflow recall-request helper on top of `workflow_events`, surfaced the latest recall metadata in workflow session summaries, and taught `goal-pipeline` to emit recall requests when planning returns no executable actions or execution fails after planning.
- Impacted Routes: N/A
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/actionRunner.ts`
- Impacted Tables/RPC: `public.workflow_events`
- Risk/Regression Notes: no new table was added; `recall_request` is modeled as a first-class `workflow_events.event_type` with compact payload fields such as `next_action`, `blocked_action`, and `failed_step_names`. `getWorkflowSessionSummary()` now returns the most recent recall metadata when present, so GPT re-entry can read structured hot-state instead of relying only on continuity packets.
- Validation: `src/services/workflow/workflowPersistenceService.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - Canonical Workflow Persistence Stamps Runtime Lanes

- Why: the script-side OpenJarvis workstream plane already stamped `runtime_lane` for the personal GPT plus Hermes operator path, but the canonical repository workflow persistence layer could still write lane-less rows through runtime callers such as `goal-pipeline`. That left a reopening path where future public or internal workflow traffic could collapse back into the same shared bucket.
- Scope: hardened the canonical workflow persistence service so every workflow session stores an explicit runtime lane, exposed that lane in session summaries, updated `goal-pipeline` session creation to stamp a caller-visible lane instead of relying on operator-side defaults, and routed the live ops/MCP goal callers through the pipeline-aware path with explicit public or system lanes.
- Impacted Routes: N/A
- Impacted Services: `src/services/workflow/workflowPersistenceService.ts`, `src/services/skills/actionRunner.ts`, `src/services/skills/modules/opsExecution.ts`, `src/mcp/toolAdapter.ts`, `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/modules/opsExecution.test.ts`, `src/mcp/toolAdapter.test.ts`
- Impacted Tables/RPC: `public.workflow_sessions`
- Risk/Regression Notes: `goal-pipeline` now defaults to `public-guild` for guild-scoped runs and `system-internal` for MCP or system-scoped runs unless an explicit `runtime_lane` is provided. The live ops execution surface now passes `public-guild` explicitly, and MCP tool calls pass `system-internal` explicitly, so pipeline mode can be enabled without silently falling back to mixed shared workflow rows.
- Validation: `src/services/workflow/workflowPersistenceService.test.ts`, `src/services/skills/modules/opsExecution.test.ts`, `src/mcp/toolAdapter.test.ts`, `npx tsc --noEmit`

## 2026-04-12 - OpenJarvis Goal Cycle Prefers Supabase Workstream State

- Why: the repository already had formal Supabase workflow tables for `workflow_sessions`, `workflow_steps`, and `workflow_events`, but the local OpenJarvis unattended and goal-cycle path still treated local JSON plus continuity packets as the main runtime truth. That kept packet state too close to a control-plane role when the safer target was structured workstream state with packets reduced to briefing and fallback artifacts.
- Scope: extended the script-side OpenJarvis workflow-state helper to mirror workflow sessions, steps, and events into Supabase while preserving the local JSON mirror; updated unattended execution, goal-cycle status/resume, and packet sync so they prefer the structured workstream plane when available.
- Impacted Routes: N/A
- Impacted Services: `scripts/openjarvis-workflow-state.mjs`, `scripts/run-openjarvis-unattended.mjs`, `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/openjarvis-workflow-state.test.ts`
- Impacted Tables/RPC: `public.workflow_sessions`, `public.workflow_steps`, `public.workflow_events`
- Risk/Regression Notes: local JSON workflow files remain a compatibility mirror and fallback, so a missing Supabase env or missing workflow tables does not block local unattended runs. When the shared workflow plane is reachable, goal-cycle status and continuity packet generation now prefer that structured state instead of relying on packet-only or latest-file inference. The operator path now also stamps an explicit `runtime_lane` boundary so personal GPT plus Hermes workflows do not silently collapse into future public Muel user traffic.
- Validation: targeted diagnostics on touched files plus `scripts/openjarvis-workflow-state.test.ts`

## 2026-04-12 - GPT-Hermes Local Dual-Agent Orchestration Target Added

- Why: the packet-centered single-ingress compatibility model solved continuity safety, but it underfit the clarified operator goal. Hermes is intended to become a real second local assistant, self-hosted n8n remains a valid future orchestration surface, and Obsidian should stay the semantic owner without remaining the mandatory hot-path transport bus.
- Scope: added a new target-state planning document for GPT plus Hermes local dual-agent orchestration, then updated the current single-ingress plan and runtime contract to label them as current compatibility layers rather than the final target, and wired the new target doc into planning index, architecture index, and the backfill catalog.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`, `docs/planning/README.md`, `docs/ARCHITECTURE_INDEX.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation-only change. The current packet and single-ingress flow remains the compatible live path, but it is now explicitly framed as transitional. The new target architecture shifts hot-path coordination toward structured workstream state with optional n8n orchestration while keeping Obsidian as the semantic owner and durable promotion layer.
- Validation: markdown review plus JSON catalog validation

## 2026-04-12 - Interactive Goal Cycle Wrapper, Visible Terminal Launch, And Context Footprint Audit Added

- Why: the repo already had a capable unattended OpenJarvis workflow engine, but it was still awkward to operate as a user-driven goal cycle, it gave Hermes no explicit human-visible terminal habit when launching interactive work, and it had no direct audit surface for instruction/prompt/skill/workflow token pressure. That made it harder to both optimize the context budget and run bounded automation interactively from a concrete objective.
- Scope: added a goal-cycle wrapper that reuses the existing unattended workflow engine with an explicit interactive scope and status view, added a visible PowerShell launch path for Windows Hermes interactive runs, then hardened that launch into a detached runner plus monitor pattern with persisted launch manifests/logs, added automatic Obsidian continuity handoff/progress packet sync for interactive goal sessions plus a local vault mirror for those packets, extended the same launcher with packet-based resume mode and a bounded supervisor loop, surfaced actual VS Code CLI bridge usage in status/launch metadata, added an audit script for always-on instruction and skill/workflow footprint, and wired all of it into npm scripts plus operator docs.
- Impacted Routes: N/A
- Impacted Services: `scripts/run-openjarvis-goal-cycle.mjs`, `scripts/run-openjarvis-unattended.mjs`, `scripts/sync-openjarvis-continuity-packets.ts`, `scripts/run-hermes-vscode-bridge.ts`, `scripts/audit-agent-context-footprint.mjs`, `package.json`, `docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md`, `docs/planning/OPENJARVIS_UNATTENDED_AUTONOMY_SETUP.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the interactive wrapper does not invent a new workflow engine; it reuses `run-openjarvis-unattended.mjs` and the same runtime artifact paths, which keeps the automation boundary unified. Visible terminal launch is Windows-specific and defaults only for interactive Hermes runs, but the actual runner is now detached from the monitor window so local continuity does not depend on the visible shell staying open. Interactive goal sessions now also sync stable handoff/progress packets through the Obsidian write adapter and mirror them into the local vault path; if shared adapter auth degrades, the local mirror preserves machine-local packet recovery while the underlying workflow still preserves local JSON state. Packet-based resume and the bounded supervisor loop intentionally refuse to auto-launch when the active progress packet says it is waiting for the next GPT objective or an explicit escalation. Visible resume/loop launches can auto-open the local progress packet through the VS Code CLI allowlist bridge, but only as editor control plane, not as a fake reasoning surface. Headless validation remains available through `--visibleTerminal=false`. The context audit is read-only and heuristic-based, so it is intended to highlight bottlenecks rather than act as a hard policy gate.
- Validation: `npm run openjarvis:goal:run:hidden -- --objective="validate interactive goal cycle wiring" --dryRun=true`, `npm run openjarvis:goal:status`, `npm run agent:context:audit`, `npm run lint`

## 2026-04-12 - Gemma 4 Hermes-Side A/B Env Profile Added

- Why: the repository currently ties local Ollama, OpenJarvis workflow bindings, NemoClaw inference, and optimize judge settings to the same Qwen lane. A Gemma 4 trial needed a bounded entry point that could strengthen Hermes-side local reasoning without silently replacing the unattended Qwen path.
- Scope: added a dedicated `local-first-hybrid-gemma4` env profile, wired it into the profile-apply script and npm scripts, and synchronized operator docs so the new path is clearly positioned as a Hermes-side Ollama A/B lane rather than a full production swap.
- Impacted Routes: N/A
- Impacted Services: `config/env/local-first-hybrid-gemma4.profile.env`, `scripts/apply-env-profile.mjs`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the new profile changes only the direct Ollama lane to `gemma4:e4b` by default while preserving OpenJarvis workflow bindings, optimize judge, and NemoClaw inference on Qwen. This keeps the blast radius focused on local Hermes-side reasoning and avoids turning the unattended path into an implicit model migration.
- Validation: `npm run env:profile:local-first-hybrid:gemma4:dry`, `npm run lint`

## 2026-04-16 - Hermes Chat Launch Gains Delegated Operator Context Profile

- Why: Hermes continuity and VS Code relaunch were already working, but the launch surface still treated Hermes too narrowly. The next gap was not another transport primitive; it was giving Hermes a richer bounded startup context so it could leverage roadmap, shared-knowledge, architecture, and upstream research surfaces without turning every turn back into broad archaeology.
- Scope: added a `delegated-operator` context profile for Hermes VS Code chat launch, enriched the launch prompt with shared-knowledge and upstream-research guidance, attached canonical roadmap and Hermes runtime contract docs by default, propagated the profile through the local runtime-control CLI, admin route, MCP tool, and queued auto-chat launch path, and added a shortcut script for delegated launches.
- Impacted Routes: `POST /agent/runtime/openjarvis/hermes-runtime/chat-launch`, local MCP tool `automation.hermes_runtime.chat_launch`
- Impacted Services: `src/services/openjarvis/openjarvisHermesRuntimeControlService.ts`, `scripts/run-openjarvis-hermes-runtime-control.ts`, `scripts/run-openjarvis-goal-cycle.mjs`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/mcp/toolAdapter.ts`, `package.json`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: additive launch-context change only. Default manual launches still work without the new profile, while queue-aware auto-chat now opts into the broader delegated context so Hermes can start from canonical docs and shared-knowledge guidance instead of only packet-local hints.
- Validation: targeted Vitest for Hermes runtime control and MCP tool routing, plus `npx tsc --noEmit`

## 2026-04-12 - Hermes VS Code Bridge Added For Single-Ingress Sidecar Control

- Why: the single-ingress operating plan had already narrowed Hermes to a five-action VS Code CLI allowlist, but the repo still lacked a bounded runtime surface that could execute those actions, fail closed when packet logging was unavailable, and expose operator-visible status.
- Scope: added a Hermes VS Code bridge service with allowlist validation, packet logging, admin runtime status/run routes, and npm script entrypoints; added targeted runtime and route tests for the new control surface.
- Impacted Routes: `GET /api/bot/agent/runtime/hermes/vscode-bridge`, `POST /api/bot/agent/runtime/hermes/vscode-bridge`
- Impacted Services: `src/services/runtime/hermesVsCodeBridgeService.ts`, `scripts/run-hermes-vscode-bridge.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/services/runtime/hermesVsCodeBridgeService.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `package.json`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the bridge stays inside the approved five-action allowlist, restricts targets to the repo root or active vault root, fails closed when `code.cmd` or the active packet is missing, and does not reopen ACP or prompt injection as a steady-state control path.
- Validation: `npm run lint`, targeted Vitest for `src/services/runtime/hermesVsCodeBridgeService.test.ts` and `src/routes/botAgentObsidianRuntime.test.ts`, plus `npm run hermes:vscode:bridge:status`

## 2026-04-12 - Hermes GPT Contract Extended With Learning Capture And Context Economics

- Why: continuity alone was not enough. The local dual-agent contract still needed two missing economic rules: GPT decisions should become reusable Hermes learning assets, and Hermes should compress and stage context so GPT is not pushed into expensive low-value work by a bad packet boundary.
- Scope: extended the dual-agent runtime contract with decision-distillate rules, progressive context disclosure, low-value escalation bans, and anti-bottleneck cost guardrails; extended the handoff and progress packet templates with decision-learning and context-budget sections.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation-only change. The main effect is to bias future Hermes-GPT collaboration toward compressed deltas, reusable decision distillates, and fewer low-signal escalations or standalone notes created only to satisfy a minimal-change instinct.
- Validation: documentation review and markdown error validation on touched planning artifacts

## 2026-04-12 - Hermes GPT Dual-Agent Runtime Contract Added

- Why: the Hermes bootstrap and digital-twin write rules were enough to get a local hands-layer running, but they still did not define how a bounded GPT-5.4 reasoning session hands work off to a persistent local Hermes runtime between sessions. The next gap was continuity, not installation.
- Scope: added one canonical local continuity contract for handoff packets, Hermes autonomy boundaries, recall triggers, and shared progress snapshots; extended the note schema and note templates for `packet_kind`; wired the new contract into planning index, architecture index, bootstrap guidance, and the repo-to-vault backfill catalog.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md`, `docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md`, `docs/planning/README.md`, `docs/ARCHITECTURE_INDEX.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation-only change. The main effect is to make local Jarvis-style continuity explicit instead of leaving it implicit in chat state or ad-hoc workspace notes. The contract stays intentionally local-overlay scoped so it does not overwrite the broader repository runtime ownership model.
- Validation: documentation review plus backfill-catalog registration for the new contract and packet templates

## 2026-04-12 - Obsidian Digital Twin Templates And Ingest Loop Added

- Why: the constitution and schema made the vault write boundary explicit, but they still did not tell a hands-layer runtime exactly what note shapes to emit or what the first safe source-to-canonical loop should look like. The next gap was operational, not conceptual.
- Scope: added concrete digital twin note templates and a repeatable ingest workflow, then wired both into planning index, architecture index, and the repo-to-vault backfill catalog.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_INGEST_WORKFLOW.md`, `docs/planning/README.md`, `docs/ARCHITECTURE_INDEX.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation-only change. The main effect is to narrow future vault writes toward predictable skeletons and a failure-closed ingest loop instead of free-form note generation.
- Validation: documentation review plus backfill-catalog registration for the new planning artifacts

## 2026-04-11 - Obsidian Digital Twin Write Contract And Hermes Bootstrap Added

- Why: the repo already treated shared Obsidian as the semantic owner, but it still lacked one explicit write-side contract for turning arbitrary documents into durable digital-twin knowledge objects. The first Hermes rollout boundary was also still implicit, which made it too easy to talk about local autonomy without defining the minimum safe loop first.
- Scope: added a digital-twin constitution, a minimum note-schema contract, and a Hermes-plus-Obsidian bootstrap spec; wired all three into planning index, architecture index, and knowledge backfill catalog.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md`, `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md`, `docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md`, `docs/planning/README.md`, `docs/ARCHITECTURE_INDEX.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: documentation-only change, but it raises the bar for future vault writes by making transformation mode, provenance, frontmatter integrity, and first-loop safety explicit instead of implicit.
- Validation: documentation review plus backfill-catalog registration for the new planning artifacts

## 2026-04-11 - GCP Worker Cost Report Now Surfaces Native Hardening Gaps

- Why: the existing weekly/monthly GCP worker report proved that the current control-plane VM was alive, but it still under-reported the exact Compute Engine features we were not using. That made the worker look like a generic VM even though the real next gap was GCP-native hardening, not role discovery.
- Scope: extended the GCP worker cost/health script to inspect custom-domain posture, snapshot-policy attachment, OS Login metadata, Shielded VM flags, automatic restart, and default-service-account/cloud-platform-scope usage; synchronized the runbook with the same operator priorities.
- Impacted Routes: N/A
- Impacted Services: `scripts/archive/report-gcp-worker-cost-health.mjs`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: additive diagnostics only. The report still fails only for real health/readiness gaps, while GCP-native hardening gaps remain warnings so current production flow is not blocked during rollout.
- Validation: `node --check scripts/archive/report-gcp-worker-cost-health.mjs`

## 2026-04-12 - OpenJarvis Memory Projection Freshness Surfaced In Runtime Control Planes

- Why: the repo already projected authoritative Obsidian, repo, and Supabase context into `tmp/openjarvis-memory-feed`, but operator surfaces still could not tell whether that projection existed, how fresh it was, or whether `jarvis memory index` actually completed. That made OpenJarvis capacity look lower than it really was and hid the remaining operational gaps behind a silent temp directory.
- Scope: extended the memory-sync script to persist indexing outcome into `summary.json`, added a runtime service that evaluates projection presence/freshness/health from that summary, and surfaced the result in operator snapshot, unattended health, and Obsidian runtime admin views.
- Impacted Routes: `GET /api/bot/agent/runtime/operator-snapshot`, `GET /api/bot/agent/runtime/knowledge-control-plane`, `GET /api/bot/agent/runtime/unattended-health`, `GET /api/bot/agent/obsidian/runtime`
- Impacted Services: `scripts/sync-openjarvis-memory.ts`, `src/services/openjarvis/openjarvisMemorySyncStatusService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: this slice does not auto-trigger projection or flip shared ingress. It only turns the existing OpenJarvis memory projection into an operator-visible control-plane signal so stale, dry-run-only, skipped-index, or missing-summary states are visible before they silently degrade capacity.
- Validation: targeted Vitest suites for `src/services/openjarvis/openjarvisMemorySyncStatusService.test.ts` and `src/routes/botAgentObsidianRuntime.test.ts`, plus `npx tsc --noEmit`

## 2026-04-12 - OpenJarvis Memory Sync Became Admin-Triggerable And Ops-Gated

- Why: surfacing freshness alone still left one gap. Operators could now see stale or missing OpenJarvis memory projection state, but the control plane still lacked a built-in way to re-run the projection from the admin surface, and the release/readiness gates still did not fail when a configured learning loop was running on stale memory.
- Scope: added an admin runtime route that triggers the existing `openjarvis:memory:sync` scripts through a dedicated service, and wired configured-memory-sync freshness into go/no-go and runtime readiness evaluation so stale projection shows up as an operational gate failure instead of only a diagnostic hint.
- Impacted Routes: `POST /api/bot/agent/runtime/openjarvis/memory-sync`, `GET /api/bot/agent/runtime/readiness`
- Impacted Services: `src/services/openjarvis/openjarvisMemorySyncStatusService.ts`, `src/services/goNoGoService.ts`, `src/services/agent/agentRuntimeReadinessService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`
- Impacted Tables/RPC: no new table or RPC contract added
- Risk/Regression Notes: the new admin trigger defaults to dry-run and stays behind admin rate limiting and idempotency. Go/no-go and readiness only require fresh OpenJarvis memory sync when the learning loop or memory sync is actually configured, so environments that intentionally do not run OpenJarvis memory projection are not blocked.
- Validation: targeted Vitest suites for `src/services/goNoGoService.test.ts`, `src/services/agent/agentRuntimeReadinessService.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`, plus `npx tsc --noEmit`

## 2026-04-12 - Requester Personalization Snapshot Added To Runtime And Memory Hydration

- Why: the repo already had guild workflow profiles, user persona snapshots, consent flags, and guild-user learning preferences, but runtime composition still lacked one effective personalization layer. Memory hint caching also keyed only on guild+goal, so requester-specific hints could be reused across different users for the same goal.
- Scope: added a requester-level personalization snapshot service, threaded its prompt hints into agent memory hydration, tightened social-context hint loading behind requester consent, and exposed an operator runtime route to inspect the effective snapshot for a guild/user pair.
- Impacted Routes: `GET /api/bot/agent/runtime/personalization`
- Impacted Services: `src/services/agent/agentPersonalizationService.ts`, `src/services/agent/agentMemoryService.ts`, `src/services/communityGraphService.ts`, `src/routes/bot-agent/runtimeRoutes.ts`
- Impacted Tables/RPC: reads `agent_user_privacy_preferences`, `user_learning_prefs`, `community_actor_profiles`, `community_relationship_edges`, `memory_items`, and `agent_workflow_profiles`; no new table or RPC contract added
- Risk/Regression Notes: memory hint caching is now requester-scoped, so cross-user leakage from short-lived cache reuse is reduced. Social-context hints are suppressed when the requester has not granted profiling/social consent, and personalization hints stay intentionally small so they bias the prompt without materially inflating token load.
- Validation: targeted Vitest suites for `src/services/agent/agentMemoryService.test.ts`, `src/services/communityGraphService.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`, plus `npx tsc --noEmit`

## 2026-04-12 - Requester Personalization Now Changes Runtime Priority, Provider, Retrieval, And Admin Profile Comparison

- Why: the first personalization slice only exposed snapshot metadata and prompt hints. It did not yet change the actual runtime path that chooses execution priority, provider posture, retrieval profile, or operator-facing admin inspection. That left OpenJarvis and the multi-agent runtime underusing the requester signal already being computed.
- Scope: extended requester personalization snapshots with recommended/effective runtime selections, resolved them once per session, applied the effective priority at execution start, propagated provider profile through planner, skill, reasoning, and intent-classification LLM calls, shaped lore retrieval queries by the selected retrieval profile, and surfaced the same runtime snapshot plus user-to-user comparison in the Discord `/프로필` admin flow.
- Impacted Routes: Discord `/프로필` slash command and user profile admin flow; no new public HTTP route contract changed in this slice
- Impacted Services: `src/services/agent/agentPersonalizationService.ts`, `src/services/agent/agentMemoryService.ts`, `src/services/multiAgentService.ts`, `src/services/multiAgentTypes.ts`, `src/services/multiAgentReasoningStrategies.ts`, `src/services/langgraph/nodes/coreNodes.ts`, `src/services/langgraph/sessionRuntime/fullReviewNodes.ts`, `src/services/skills/actionRunner.ts`, `src/services/skills/actions/planner.ts`, `src/services/skills/modules/common.ts`, `src/services/skills/modules/opsExecution.ts`, `src/services/skills/types.ts`, `src/discord/commands/persona.ts`, `src/discord/commandDefinitions.ts`
- Impacted Tables/RPC: continues reading `retrieval_ranker_active_profiles`, `agent_workflow_profiles`, `agent_user_privacy_preferences`, `user_learning_prefs`, and persona/community-memory sources; no new table or RPC contract added
- Risk/Regression Notes: requester personalization now materially affects live runtime choices, so overly broad heuristics would have real execution impact. The heuristic was tightened so generic ops/operator role tags do not override explicit concise signals by themselves. Gate overrides still win for provider profile, and requester comparison in Discord remains admin-only.
- Validation: targeted Vitest suites for `src/services/agent/agentPersonalizationService.test.ts`, `src/services/agent/agentMemoryService.test.ts`, `src/services/multiAgentService.test.ts`, `src/discord/commands/persona.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`, plus `npx tsc --noEmit`

## 2026-04-12 - Retrieval Eval, Local Fallback Search, And Weekly Variant Reporting Aligned

- Why: retrieval quality remained the main bottleneck, but the repo was still measuring it through a shallower adapter-search path than runtime graph-first retrieval, and weekly reports still assumed obsolete retrieval variant names (`baseline/tot/got`). That made optimization inputs and operator summaries structurally misleading.
- Scope: hardened local filesystem vault ranking for mixed `tag:` plus multi-token queries, added a graph-first `graph_lore` retrieval-eval variant, and aligned weekly self-improvement plus go/no-go summaries to actual retrieval variants and active/best deltas.
- Impacted Routes: indirect impact on operator weekly reporting and retrieval tuning only; no public HTTP route contract changed
- Impacted Services: `src/services/obsidian/adapters/localFsAdapter.ts`, `src/services/obsidian/adapters/localFsAdapter.test.ts`, `src/services/eval/retrievalEvalService.ts`, `scripts/generate-self-improvement-weekly.mjs`, `scripts/summarize-go-no-go-runs.mjs`, `scripts/auto-judge-from-weekly.mjs`
- Impacted Tables/RPC: reads `public.retrieval_eval_runs`, `public.retrieval_ranker_active_profiles`, and `public.agent_answer_quality_reviews`; no new table or RPC contract added
- Risk/Regression Notes: weekly summaries now expose real retrieval variants (`baseline`, `graph_lore`, `intent_prefix`, `keyword_expansion`) with active/best recall deltas instead of legacy `tot/got` placeholders. Auto-judge fallback now prefers active or best retrieval recall before baseline-only fallback, so quality-gate evidence is closer to live retrieval behavior.
- Validation: `npx tsc --noEmit`, `runTests` for `src/services/obsidian/adapters/localFsAdapter.test.ts`, `node --import dotenv/config scripts/summarize-go-no-go-runs.mjs --dryRun=true --allowMissingQualityTables=true`, `node --import dotenv/config scripts/generate-self-improvement-weekly.mjs --dryRun=true --allowMissingQualityTables=true`, and `node --import dotenv/config scripts/auto-judge-from-weekly.mjs --dryRun=true --allowMissingSourceReports=true`

## 2026-04-12 - Adaptive OpenJarvis Optimize Profiles For Weekly Retrieval Pressure

- Why: the remaining local-first learning-loop gap was no longer CLI wiring but the fact that weekly optimize still depended on a static benchmark/config and fixed objective weights. That forced humans to keep retuning optimize priorities by hand even when the observed bottleneck was already obvious from weekly retrieval and quality signals.
- Scope: introduced a shared adaptive optimize-profile generator for weekly self-improvement and auto-judge flows, enabled local-first hybrid to opt into that adaptive mode, and expanded the fallback local optimize TOML so even static fallback keeps system-prompt and tool-set delegation in the OpenJarvis search space.
- Impacted Routes: indirect impact on unattended operator workflows only; no public HTTP route contract changed
- Impacted Services: `scripts/lib/openjarvisOptimizeProfile.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `scripts/auto-judge-from-weekly.mjs`, `config/runtime/openjarvis-local-first-optimize.toml`, `config/env/local-first-hybrid.profile.env`, `.env.example`
- Impacted Tables/RPC: best-effort writes continue to `public.agent_weekly_reports` for `jarvis_optimize_result`; no new table or RPC contract added
- Risk/Regression Notes: adaptive mode now generates a temporary TOML under `tmp/openjarvis-optimize/` from current weekly retrieval/latency signals and lets OpenJarvis search prompt, tool-set, and reasoning-turn space instead of only numeric sampling knobs. Static benchmark-only or static-config behavior remains available when adaptive mode is disabled. The generated constraints keep graph-first retrieval, local Ollama execution, and unattended-run safety as hard guardrails, so delegation widens without silently changing the repo's retrieval ownership boundary.
- Validation: targeted script error scan, `npx tsc --noEmit`, and a real `npm run openjarvis:autonomy:run` under the local-first hybrid profile

## 2026-04-12 - OpenJarvis Authoritative Memory Projection And Learning Loop Flag Convergence

- Why: after making OpenJarvis the preferred control surface, the next gap was that the active unattended path still lacked one authoritative ingestion step for Obsidian and Supabase context, and weekly self-improvement behavior was split across partially overlapping env toggles. That left OpenJarvis memory underfed and made it too easy to believe the learning loop was active when only one sub-path was configured.
- Scope: added a dedicated `openjarvis:memory:sync` projection step that reads authoritative Obsidian context through the adapter router, projects selected Supabase weekly reports into an ephemeral OpenJarvis memory feed, and inserts that step into the unattended routing policy. Also converged active weekly bench and optimize toggles so `OPENJARVIS_LEARNING_LOOP_ENABLED` can act as the umbrella switch while legacy step-specific flags remain valid overrides. Follow-up hardening in the same change window aligned Windows CLI execution with `jarvis.cmd`, switched bench calls to the real `jarvis bench run --json` surface with a safe minimal latency benchmark, re-enabled local-first optimize through a tracked provider-aware config that pins optimizer, judge, and trial execution to local Ollama instead of the cloud default judge path, and made weekly optimize triggers pre-sync authoritative memory so OpenJarvis sees current Obsidian and Supabase context before self-improvement or auto-judge optimization runs.
- Impacted Routes: indirect impact on unattended operator workflows only; no public HTTP route contract changed
- Impacted Services: `scripts/sync-openjarvis-memory.ts`, `scripts/openjarvis-routing-policy.mjs`, `docs/planning/runtime-profiles/openjarvis-routing-policy.json`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `scripts/lib/cliArgs.mjs`, `package.json`, `config/env/local-first-hybrid.profile.env`, `config/runtime/openjarvis-local-first-optimize.toml`, `src/services/tools/adapters/openjarvisAdapter.ts`, `config/runtime/operating-baseline.json`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: reads `public.agent_weekly_reports`; no new table or RPC contract added
- Risk/Regression Notes: the new memory sync step writes only to `tmp/openjarvis-memory-feed` before invoking `jarvis memory index`. When authoritative sources are unavailable it degrades to partial projection or skip behavior instead of mutating ownership. Bench and optimize remain overridable by the more specific env flags even when the umbrella learning-loop flag is enabled. On Windows, OpenJarvis CLI execution now resolves through `cmd.exe /c` so `jarvis.cmd` is reachable from Node-based automation. Optimize no longer pretends a generic HTTP endpoint exists; it requires an explicit benchmark/config for the real CLI contract, and the local-first hybrid profile now points at a tracked local-Ollama optimize config instead of free-floating benchmark flags. Weekly optimize triggers now run a best-effort memory sync first so the local learning loop actually consumes the latest authoritative projection instead of whatever was indexed in a prior cycle. This keeps the open-source local learning path active without smuggling cloud judge defaults back into the loop. Memory indexing now surfaces missing native-extension installs as an environment blocker rather than a silent CLI miss.
- Validation: typecheck, targeted OpenJarvis adapter parser and optimize-arg tests, real `openjarvis:memory:sync`, unattended routing dry-run validation under the applied local-first hybrid profile, and a real non-dry unattended run after the native-extension build completed

## 2026-04-12 - OpenJarvis-Centered Control Surface And Implement Fallback Convergence

- Why: after reviewing the actual upstream OpenJarvis repository, the repo-local architecture needed to align with how OpenJarvis is really shaped. Upstream OpenJarvis is not just another raw model endpoint; it is a higher-level surface that composes agents, tools, memory, learning, telemetry, and OpenAI-compatible serve APIs over pluggable engines. Keeping OpenClaw on the implement-phase external-success path blurred that boundary and allowed a conversational adapter to short-circuit the canonical hands layer.
- Scope: sprint fallback routing now keeps implement on the canonical executor path instead of a chat-first external adapter path, LLM provider defaults now prefer OpenJarvis as the control surface when it is enabled, and the operating baseline/runtime docs now describe OpenJarvis as the canonical always-on control plane with OpenCode/implement as the hands layer.
- Impacted Routes: indirect impact on sprint phase execution and runtime/operator snapshots; no public HTTP route contract changed
- Impacted Services: `src/services/sprint/sprintWorkerRouter.ts`, `src/services/sprint/sprintOrchestrator.ts`, `src/services/llm/routing.ts`, `config/runtime/operating-baseline.json`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: when `OPENJARVIS_ENABLED=true` and no stronger explicit provider override is present, default provider resolution now prefers OpenJarvis before lower-level providers. Implement phase no longer treats an external conversational adapter as a successful terminal fallback, so code-change flows converge on `implement.execute` and its existing hands-layer contracts.
- Validation: targeted Vitest LLM routing and sprint orchestrator suites, plus focused type/error validation on touched files

## 2026-04-12 - Shared MCP Operating Standard And Same-Window Promotion Rule Documented

- Why: the strengthened GCP shared MCP is now at the point where operating consistency matters more than attaching more lanes. The repo needed one explicit place to state what to harden next, how to use the shared/local MCP surfaces in the IDE, and that shared Obsidian/profile sync for operator-visible control-plane changes should close in the same change window instead of becoming a separate follow-up task.
- Scope: expanded the IDE MCP workspace setup document with next-step GCP VM priorities, IDE agent usage guardrails, a same-window completion rule, and a daily/shared-publish checklist; added a repo-shareable user-memory extract for team collaboration alignment.
- Impacted Routes: N/A
- Impacted Services: `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/planning/TEAM_SHAREABLE_USER_MEMORY.md`, `docs/planning/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: this is guidance-only, but it raises the bar for treating lane metadata completeness, publish verification, and shared profile backfill as part of normal operator workflow instead of optional cleanup.
- Validation: documentation review and same-window shared profile backfill attempted via `obsidian:backfill:system` for `service-unified-mcp-profile`

## 2026-04-11 - Learned Routing Rules, Action Execute Payloads, And Upstream Tool Drift Hardened

- Why: the next DeepWiki-guided review pass found three control-plane gaps that could survive normal happy-path testing. Learned task-routing regexes could be stored in Supabase and later fail silently at match time, `/agent/actions/execute` still accepted loosely bounded `args` objects at the admin ingress, and upstream MCP catalogs could expose sanitized-name collisions where two different upstream tools mapped to the same internal name.
- Scope: task-routing learning rules now validate regex safety on both persistence and load, learning rule/candidate listings surface invalid signal-pattern diagnostics, admin action execution only accepts bounded JSON-safe plain-object args, and upstream proxy diagnostics now report raw, filtered, invalid, and colliding tool counts while dropping ambiguous collisions.
- Impacted Routes: `POST /api/bot/agent/actions/execute`
- Impacted Services: `src/utils/validation.ts`, `src/services/toolLearningService.ts`, `src/services/taskRoutingService.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `src/mcp/proxyAdapter.ts`
- Risk/Regression Notes: invalid learned routing patterns are now explicit operator-visible faults instead of silent no-op rules, oversized or non-JSON-safe admin action payloads are rejected up front, and colliding upstream tools are hidden until the upstream namespace is fixed so a proxied call cannot resolve to the wrong original tool.
- Validation: targeted Vitest task-routing, tool-learning, governance-route, and proxy-adapter suites passed; `npx tsc --noEmit` passed

## 2026-04-11 - Action Approval Fallback No Longer Disappears Under Partial DB Failure

- Why: DeepWiki-guided review plus local verification found a control-plane drift bug in the approval store. When Supabase was configured but `createActionApprovalRequest()` hit a transient DB write failure, the request was stored only in in-memory fallback state. However, `listActionApprovalRequests()` and `decideActionApprovalRequest()` still treated Supabase as authoritative and ignored that fallback row, so the approval appeared to succeed but vanished from the admin surface in the same process.
- Scope: approval listing now merges DB rows with in-memory fallback rows, and approval decisions can operate on fallback requests when the DB lookup/update path misses or fails. Successful DB updates clear stale fallback rows.
- Impacted Services: `src/services/skills/actionGovernanceStore.ts`
- Risk/Regression Notes: during transient DB outages, approval state is now internally consistent within the running process instead of disappearing between create/list/decide steps. Restart-time durability is still bounded by the existing in-memory fallback design.
- Validation: targeted Vitest action-governance fallback tests passed; `npx tsc --noEmit` passed

## 2026-04-11 - Discord Intent Regex Overrides Now Fail Closed On Invalid Input

- Why: a DeepWiki-guided audit found that invalid `DISCORD_CODING_INTENT_PATTERN` or `DISCORD_AUTOMATION_INTENT_PATTERN` overrides silently fell back to the broad default regex. An operator trying to narrow intent detection could therefore misconfigure the pattern and accidentally widen request classification back to the default behavior.
- Scope: Discord runtime intent regex handling now uses default patterns only when no override is supplied. If a custom override is syntactically invalid or looks ReDoS-suspect, the override is disabled instead of reverting to the broader default, and diagnostics expose whether each intent pattern is default, custom, or disabled-invalid.
- Impacted Services: `src/discord/runtimePolicy.ts`, `src/discord/commands/vibe.ts`
- Risk/Regression Notes: a broken custom override now fails closed and stops matching instead of silently restoring broad matching. This is an intentional safety tradeoff in favor of explicit operator correction.
- Validation: targeted Vitest Discord runtime-policy tests passed; `npx tsc --noEmit` passed

## 2026-04-11 - Admin Route Input Contracts Hardened For Privacy, Obsidian Promotion, And Channel Routing

- Why: a DeepWiki-guided control-plane review found three places where invalid admin input could be silently normalized or downgraded instead of being rejected: privacy regex rules could be stored even when downstream compilation would drop them, Obsidian promotion accepted unknown `artifactKind` values that fell back to repository-context notes, and channel routing keys were rewritten by sanitization before save.
- Scope: privacy policy writes now reject malformed or unsafe regex rules up front, Obsidian promotion and wiki change capture enforce allowed enum values at both HTTP and MCP ingress, and runtime channel routing only accepts canonical key names that round-trip without mutation.
- Impacted Routes: `PUT /api/bot/agent/privacy/policy`, `POST /api/bot/agent/obsidian/knowledge-promote`, `POST /api/bot/agent/obsidian/wiki-change-capture`, `PUT /api/bot/agent/runtime/channel-routing`
- Impacted Services: `src/services/agent/agentPrivacyPolicyService.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/mcp/obsidianToolAdapter.ts`
- Risk/Regression Notes: operators using previously lossy channel names or unsupported artifact/change kinds will now get explicit validation errors instead of silent fallback behavior. This is an intentional contract tightening.
- Validation: targeted Vitest admin route and MCP Obsidian adapter tests passed; `npx tsc --noEmit` passed

## 2026-04-11 - Sprint Event Replay And Discord Deliverable Rendering Hardened

- Why: DeepWiki-guided review found two subtle correctness gaps that could survive routine testing: event-sourced sprint replay stored `phaseResults` under bare phase names while the live orchestrator used `phase-ordinal` keys, and Discord user-facing rendering only extracted `## Deliverable` blocks, which left heading-format variance able to fall back to the full raw output.
- Scope: sprint phase result key generation is now shared between the live orchestrator and Ventyd reducer so replay preserves retry history, and Discord session rendering now accepts deeper markdown headings / emphasized labels for deliverable extraction while stripping verification and debug sections more defensively.
- Impacted Routes: `GET /api/bot/agent/sprint/pipelines/:id/events`, Discord session progress rendering surfaces
- Impacted Services: `src/services/sprint/phaseResultKey.ts`, `src/services/sprint/sprintOrchestrator.ts`, `src/services/sprint/eventSourcing/sprintPipelineEntity.ts`, `src/discord/session.ts`
- Risk/Regression Notes: sprint diagnostics now expose per-execution `phaseResults` keys consistently with live pipeline snapshots, and Discord users should see fewer cases where malformed deliverable headings leak verification or debug text.
- Validation: targeted Vitest sprint event-sourcing, sprint orchestrator, and discord session tests passed; `npx tsc --noEmit` passed

## 2026-04-11 - Public Health Surfaces Redact Detailed Bootstrap Diagnostics

- Why: `/health` and `/dashboard` are documented public surfaces, but recent bootstrap hardening had started exposing raw startup task messages, pg_cron error text, and loop ownership details there. That violated the established contract that public health surfaces only expose summary operational metadata.
- Scope: public health and dashboard responses now keep summary startup/bootstrap state visible while detailed error text, startup task messages, and loop ownership details only appear for signed-in admins.
- Impacted Routes: `GET /health`, `GET /dashboard`
- Impacted Services: `src/routes/health.ts`, `src/routes/dashboard.ts`, `src/services/adminAllowlistService.ts`, `src/contracts/bot.ts`
- Risk/Regression Notes: public health probes and unauthenticated dashboard access remain available, but operators now need an admin session or the protected runtime endpoints for full bootstrap diagnostics.
- Validation: targeted Vitest health/runtime suites passed and `npx tsc --noEmit` passed

## 2026-04-11 - Runtime Bootstrap Fallback And Startup Diagnostics Hardened

- Why: the runtime could previously mark several loops as pg_cron-owned before bootstrap actually confirmed any jobs, which created a silent failure mode where app loops were skipped even when pg_cron install failed. Startup failures for sprint rehydration, MCP router init, sandbox sync, and adapter auto-load were also too easy to miss because they only surfaced as debug-only skips.
- Scope: pg_cron ownership confirmation now derives from completed bootstrap results, replaceable app loops wait for bootstrap resolution before deciding ownership, startup task outcomes are tracked in-process, and `/health` plus `/dashboard` now expose pg_cron/bootstrap and startup warning state.
- Impacted Routes: `GET /health`, `GET /dashboard`
- Impacted Services: `src/services/infra/pgCronBootstrapService.ts`, `src/services/runtime/runtimeBootstrap.ts`, `src/services/runtime/bootstrapServerInfra.ts`, `src/services/tools/adapterAutoLoader.ts`, `src/routes/health.ts`, `src/routes/dashboard.ts`, `src/contracts/bot.ts`
- Impacted Tables/RPC: `public.ensure_pg_cron_job` bootstrap path only; no schema contract change
- Risk/Regression Notes: loop skipping is now fail-safe toward app-owned fallback when pg_cron bootstrap is partial or failed. This can temporarily favor duplicate-safe app loops over silent non-execution, which is the intended reliability tradeoff.
- Validation: targeted Vitest runtime/health/DeepWiki/sprint suites passed and `npx tsc --noEmit` passed

## 2026-04-11 - IDE-Safe Tool Schema Normalization And Shared-Only Bootstrap

- Why: one malformed MCP tool schema is enough to make VS Code reject the tool catalog before the user can do any useful work. The immediate incident came from a custom server exporting array parameters without `items`, but the deeper team issue was that a teammate should still be able to start with `gcpCompute` using only SSH access instead of needing local Obsidian token or local MCP wiring first.
- Scope: shared MCP tool-schema normalization for upstream catalogs, regression tests for IDE-safe schemas, shared-only teammate bootstrap path, and onboarding/troubleshooting guidance for catalog recovery
- Impacted Routes: `tools/list` over shared MCP stdio/HTTP, `GET /mcp/health`
- Impacted Services: `src/mcp/schemaNormalization.ts`, `src/mcp/proxyAdapter.ts`, `src/mcp/proxyAdapter.test.ts`, `src/mcp/unifiedToolAdapter.ts`, `src/mcp/unifiedToolAdapter.test.ts`, `scripts/bootstrap-team.ps1`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: malformed upstream schemas are now normalized before the shared catalog is exposed, which keeps array nodes from missing `items` in the IDE-facing surface. This does not magically fix a completely separate broken local MCP server registered outside `gcpCompute`, so the shared-only bootstrap path remains the operational escape hatch when a teammate's local catalog is poisoned.
- Validation: focused Vitest coverage added for upstream array-schema normalization and unified-catalog IDE-safety; bootstrap now has an explicit `-SharedOnly` mode for SSH-only team onboarding

## 2026-04-11 - Shared MCP Runtime Mirror Split From Git Checkout

- Why: the shared GCP MCP surface was still executing directly from `/opt/muel/discord-news-bot`, so every publish turned the remote git checkout into a mutable deployment tree. That made remote `dirty` state structurally inevitable and caused publish safety checks to fight the deployment model instead of protecting it.
- Scope: gcpCompute SSH target, shared MCP systemd template, GCP runtime env example, bootstrap expectations, publish script behavior, and operator docs for the new non-git runtime mirror path
- Impacted Routes: `GET /mcp/health`, `GET /obsidian/health`
- Impacted Services: `.vscode/mcp.json`, `config/systemd/unified-mcp-http.service`, `config/env/unified-mcp.gcp.env.example`, `scripts/publish-gcp-shared-mcp.ps1`, `scripts/bootstrap-team.ps1`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: shared MCP now expects to run from `/opt/muel/shared-mcp-runtime`, while the old `/opt/muel/discord-news-bot` path becomes a legacy source checkout rather than the live execution surface. Existing remote dirty state may remain in the legacy checkout, but it no longer blocks shared MCP rollout once the new runtime mirror is deployed.
- Validation: publish script updated to deploy into a non-git runtime mirror and to migrate the existing GCP env file from the legacy checkout when needed; bootstrap and docs now point teammates at the runtime mirror rather than the git working tree

## 2026-04-11 - Teamwide gcpCompute Adoption Readiness Gates

- Why: the shared GCP MCP surface was already usable, but team-wide aggressive adoption still depended on three operational truths being explicit: lane contracts must be visible, teammate bootstrap must expose what the shared surface is actually advertising, and the shared Obsidian service profile must be republished when the repo-side contract changes.
- Scope: teammate onboarding/readiness guidance, bootstrap visibility for shared lanes, and shared-profile backfill discipline for the unified MCP service profile
- Impacted Routes: N/A
- Impacted Services: `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `scripts/bootstrap-team.ps1`, `docs/CHANGELOG-ARCH.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime routing changed. This slice raises the operating bar for team adoption by treating lane metadata, `diag.upstreams`, public health upstream summaries, and service-profile backfill as first-class readiness gates instead of implicit tribal knowledge.
- Validation: PowerShell parser validation passed for `scripts/bootstrap-team.ps1`; docs updated to describe the same lane-governance contract the live shared MCP now exposes

## 2026-04-11 - Federated Upstream Namespace Diagnostics And Control-Plane Metadata

- Why: shared MCP could already proxy multiple upstream namespaces, but those lanes were still opaque config blobs. That made multi-repo, multi-runtime collaboration look like a checkout-sync problem instead of a federated control-plane problem, and it left operators without a first-class way to inspect which semantic, operational, or execution lanes were actually mounted.
- Scope: upstream MCP metadata contract, diagnostics surface, health visibility, and env/doc examples for federated namespace lanes
- Impacted Routes: `GET /mcp/health`, `GET /health`
- Impacted Services: `src/mcp/proxyRegistry.ts`, `src/mcp/proxyAdapter.ts`, `src/mcp/toolAdapter.ts`, `src/mcp/unifiedServer.ts`, `src/mcp/proxyAdapter.test.ts`, `src/mcp/unifiedToolAdapter.test.ts`, `.env.example`, `config/env/unified-mcp.gcp.env.example`, `config/env/production.profile.env`, `config/env/local.profile.env`, `config/env/local-first-hybrid.profile.env`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no existing upstream routing contract was removed. Existing `MCP_UPSTREAM_SERVERS` entries remain valid, while new optional metadata (`label`, `plane`, `audience`, `owner`, `sourceRepo`) and the new `diag.upstreams` tool make the shared surface easier to reason about when multiple external execution runtimes, separate wikis, or cross-repo service lanes are attached.
- Validation: focused Vitest coverage for proxy/unified MCP adapters plus targeted typecheck on the touched MCP modules

## 2026-04-11 - Secret Surface Sanitization And Shared Supabase RO Rollout Guidance

- Why: the repo-side architecture cleanup and env-template hardening were complete, but operator follow-through was still implicit. The remaining risk was no longer missing code support; it was stale live credentials in real secret stores and an unstructured rollout path for the shared read-only Supabase MCP surface.
- Scope: tracked env documentation sanitization, shared `supabase_ro` rollout guidance, operator secret-rotation checklist, runbook linkage, and shared-vault backfill wiring
- Impacted Routes: N/A
- Impacted Services: `docs/.env`, `.env.example`, `config/env/production.profile.env`, `config/env/local.profile.env`, `config/env/local-first-hybrid.profile.env`, `scripts/apply-env-profile.mjs`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/SECRET_ROTATION_AND_SUPABASE_RO_ROLLOUT.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime code path changed. This slice reduces the chance of reintroducing live secrets into tracked documentation, makes `.env.profile-backup` explicitly operator-sensitive, and defines `supabase_ro` as a filtered shared read plane rather than a general admin ingress.
- Validation: targeted markdown and script diagnostics passed on all touched files; tracked docs were re-scanned for obvious secret patterns and only placeholder examples remained

## 2026-04-11 - Phase 3 Policy Completion And Upstream Filter Support Landed

- Why: after phase 2, the remaining Supabase hygiene risk was no longer missing tables but the last 27 policyless RLS tables plus a world-readable `obsidian_cache` policy. In parallel, shared read-only Supabase MCP was still blocked because the upstream proxy could not filter write-capable tools.
- Scope: live phase-3 policy migration, `obsidian_cache` hardening, migration/checklist/inventory alignment, and upstream MCP tool allowlist/denylist support with tests
- Impacted Routes: N/A
- Impacted Services: `docs/MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION.sql`, `docs/MIGRATIONS_APPLY_ALL.sql`, `docs/OBSIDIAN_HEADLESS_MIGRATION.sql`, `docs/SUPABASE_CLEANUP_INVENTORY.md`, `docs/planning/SUPABASE_HYGIENE_EXECUTION_PLAN.md`, `docs/SUPABASE_MIGRATION_CHECKLIST.md`, `src/utils/migrationRegistry.ts`, `src/mcp/proxyRegistry.ts`, `src/mcp/proxyAdapter.ts`, `src/mcp/proxyAdapter.test.ts`
- Impacted Tables/RPC: `public.agent_sessions`, `public.agent_steps`, `public.sources`, `public.users`, `public.guild_lore_docs`, the remaining legacy/operator tables with RLS enabled, and `public.obsidian_cache`
- Risk/Regression Notes: this slice closes every previously policyless RLS table in `public` as explicit `service_role`-only ownership and removes the last `USING (true)` policy. Shared Supabase MCP is no longer code-blocked, but it is still not safe to roll out without a curated read-only allowlist.
- Validation: live phase-3 migration applied successfully; `public.schema_migrations` recorded `MIGRATION_SUPABASE_HYGIENE_PHASE3_POLICY_COMPLETION`; direct catalog queries confirmed `rls_enabled_no_policy = 0` and remaining `USING (true)` / `WITH CHECK (true)` policies = 0; targeted tests passed for `src/mcp/proxyAdapter.test.ts` and `src/utils/migrationRegistry.test.ts`

## 2026-04-11 - Runtime Service Policies Applied And Canonical Schema Drift Closed

- Why: the broader Supabase audit showed that the next live gap was no longer missing tables but low-ambiguity policy coverage on runtime service tables, while repo-visible canonical schema sections for reward/eval/workflow surfaces had fallen behind the applied live migration shapes. That combination kept the DB ownership story and the repo-visible source of truth out of sync.
- Scope: live runtime-service policy migration apply, `user_learning_prefs` hardening, migration/checklist alignment, and canonical schema synchronization for reward/eval/workflow/traffic tables
- Impacted Routes: N/A
- Impacted Services: `docs/MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES.sql`, `docs/MIGRATIONS_APPLY_ALL.sql`, `docs/SUPABASE_SCHEMA.sql`, `docs/SUPABASE_CLEANUP_INVENTORY.md`, `docs/planning/SUPABASE_HYGIENE_EXECUTION_PLAN.md`, `docs/SUPABASE_MIGRATION_CHECKLIST.md`, `src/utils/migrationRegistry.ts`
- Impacted Tables/RPC: `public.api_idempotency_keys`, `public.api_rate_limits`, `public.discord_login_sessions`, `public.distributed_locks`, `public.schema_migrations`, `public.agent_telemetry_queue_tasks`, `public.user_learning_prefs`, `public.reward_signal_snapshots`, `public.eval_ab_runs`, `public.shadow_graph_divergence_logs`, `public.workflow_sessions`, `public.workflow_steps`, `public.workflow_events`, `public.traffic_routing_decisions`
- Risk/Regression Notes: this slice keeps runtime access on the direct SDK path and only hardens tables already used through server-side flows. It also removes the last permissive `user_learning_prefs` policy from the prior hygiene snapshot. Remaining `rls_enabled_no_policy` work is narrowed to runtime-domain and legacy tables, not the low-ambiguity service-table set.
- Validation: live migration `supabase_hygiene_phase2_runtime_service_policies` applied successfully; `public.schema_migrations` recorded `MIGRATION_SUPABASE_HYGIENE_PHASE2_RUNTIME_SERVICE_POLICIES`; targeted policy catalog query confirmed the seven new `service_role` policies; policyless RLS table count dropped from `33` to `27`

## 2026-04-11 - Autonomy Reporting Baseline Reconciled With Live Scripts

- Why: the unattended OpenJarvis weekly pipeline had drifted away from the canonical repo-visible migration surface. Runtime scripts expected `agent_weekly_reports`, `agent_llm_call_logs`, `memory_jobs`, and `memory_job_deadletters`, plus newer `report_kind` and `job_type` values, while the tracked migration set and script entrypoints no longer matched that reality.
- Scope: weekly auto-judge entrypoint restoration, null-safe weekly metric coercion, named Supabase migration for autonomy reporting baseline, and migration/checklist/schema alignment
- Impacted Routes: N/A
- Impacted Services: `scripts/auto-judge-from-weekly.mjs`, `scripts/auto-judge-go-no-go.mjs`, `scripts/archive/auto-judge-go-no-go.mjs`, `docs/MIGRATION_AUTONOMY_REPORTING_BASELINE.sql`, `docs/SUPABASE_SCHEMA.sql`, `docs/planning/MIGRATION_AGENT_WEEKLY_REPORTS.sql`, `src/utils/migrationRegistry.ts`, `docs/SUPABASE_MIGRATION_CHECKLIST.md`
- Impacted Tables/RPC: `public.agent_weekly_reports`, `public.agent_llm_call_logs`, `public.memory_jobs`, `public.memory_job_deadletters`
- Risk/Regression Notes: this slice does not move runtime DB access to MCP. It restores the expected weekly auto-judge entrypoint, prevents `null -> 0` coercion from turning missing latency snapshots into `errorRatePct=100`, and adds a tracked migration so new or drifted environments can converge on the autonomy reporting baseline without relying on the monolithic schema file alone.
- Validation: `npm run -s openjarvis:autonomy:run` reproduced the current failures before the fix; after the fix and live migration apply, the same command completed with `OPENJARVIS][UNATTENDED] final status: pass`, `self_improvement_patterns` persisted successfully, and weekly auto-judge created fresh gate-run markdown/json artifacts without `MODULE_NOT_FOUND`

## 2026-04-11 - Supabase Hygiene Phase 1 Applied And M2 Ownership Split Locked

- Why: Supabase hygiene had already been partially modeled in repo docs, but the real bottleneck was the live database state. After phase 1 was applied and verified against the connected project, the remaining work needed to be reframed from bulk lint cleanup into ownership-driven policy design so the next slice would harden live runtime tables first without accidentally defining the wrong product boundary.
- Scope: live phase 1 hygiene verification, cleanup inventory refresh, phase 2 ownership triage, and shared-MCP rollout gate clarification
- Impacted Routes: N/A
- Impacted Services: `docs/MIGRATION_SUPABASE_HYGIENE_PHASE1.sql`, `docs/SUPABASE_CLEANUP_INVENTORY.md`, `docs/planning/SUPABASE_HYGIENE_EXECUTION_PLAN.md`, `src/services/userLearningPrefsService.ts`, `src/services/agent/agentSessionStore.ts`, `src/middleware/idempotency.ts`, `src/services/infra/supabaseRateLimitService.ts`, `src/services/discord-support/discordLoginSessionStore.ts`, `src/services/infra/distributedLockService.ts`, `src/routes/auth.ts`, `src/routes/bot.ts`
- Impacted Tables/RPC: `memory_items`, `intents`, `agent_trust_scores`, `obsidian_query_log`, `ventyd_events`, `agent_sessions`, `agent_steps`, `api_idempotency_keys`, `api_rate_limits`, `discord_login_sessions`, `distributed_locks`, `schema_migrations`, `sources`, `users`, `user_learning_prefs`
- Risk/Regression Notes: phase 1 is already live and reduced advisor counts, but the remaining 33 `rls_enabled_no_policy`, 68 `auth_rls_initplan`, and 1 `rls_policy_always_true` finding are intentionally not being auto-closed. The repo now treats M2 as an ownership split: runtime service tables first, runtime domain tables second, ownership-heavy analytics/community/learning families after that, and shared Supabase MCP still blocked until upstream tool filtering or a dedicated read-only ingress exists.
- Validation: live verification confirmed policy changes on `memory_items`, `intents`, `agent_trust_scores`, `obsidian_query_log`, and `ventyd_events`, creation of the 12 phase 1 FK indexes, and advisor delta from security `54 -> 34` plus performance `211 -> 186`; targeted runtime-path review confirmed `user_learning_prefs` is currently reached through the server-side direct SDK path rather than a client JWT flow

## 2026-04-11 - Additional Planning Surface Closure For Autonomy And GCP Profiles

- Why: two remaining planning docs still presented themselves as `ACTIVE` even though they no longer owned current execution state. One already mapped to a shared service-profile backfill lane, and the other had become a target-state strategy reference with implemented status now reflected in architecture/runtime surfaces instead of a standalone WIP plan.
- Scope: planning status-header normalization, planning index alignment, and shared-vault backfill catalog expansion for the autonomy strategy doc
- Impacted Routes: N/A
- Impacted Services: `docs/planning/AUTONOMOUS_AGENT_EVOLUTION_PLAN.md`, `docs/planning/GCP_OSS_INTEGRATION_BLUEPRINT.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. `AUTONOMOUS_AGENT_EVOLUTION_PLAN.md` now acts as a strategy/phase-intent reference instead of an implicit execution tracker, while `GCP_OSS_INTEGRATION_BLUEPRINT.md` now reads as a service-profile reference aligned to the operating baseline and shared OpenJarvis profile. Active rollout truth remains centralized in `EXECUTION_BOARD.md`, the roadmap, architecture index, and shared-vault coverage.
- Validation: targeted markdown review; adapter-aware backfill coverage report verified remote shared-vault presence for the current planning-doc batch; `npx tsc --noEmit`

## 2026-04-11 - Planning Execution Surface Convergence

- Why: the 2026-04-11 planning batch had already been promoted into the shared vault and partially implemented, but several repo planning documents still advertised `Proposed` status in a way that could be misread as parallel active WIP. That ambiguity risked reintroducing multiple execution boards instead of one canonical control surface.
- Scope: planning status-header normalization, execution-surface boundary clarification, and migration-note boundary tightening
- Impacted Routes: N/A
- Impacted Services: `docs/planning/README.md`, `docs/planning/MANAGED_AGENTS_FOUR_LAYER_MODEL.md`, `docs/planning/REPO_DOC_EXTERNALIZATION_PLAN.md`, `docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md`, `docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md`, `docs/planning/mcp/OBSIDIAN_AGENT_LEVERAGE_PRIORITIES.md`, `docs/planning/OBSIDIAN_SEED_OBJECTS_PRIORITY.md`, `docs/planning/LANGGRAPHJS_AGENTGRAPH_MIGRATION_PLAN.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. These docs now make a stricter distinction between active execution control and reference/control artifacts: current rollout state belongs in `EXECUTION_BOARD.md`, completed slices belong in changelog and development slices, and shared-vault coverage remains the promotion parity source. The LangGraph migration plan remains implementation-coupled, but no longer acts like an implicit second execution board.
- Validation: targeted markdown review; shared knowledge bundle confirmed the affected docs are already present as shared control/reference artifacts; markdown diagnostics on touched docs passed; targeted overwrite backfill applied to the affected catalog entries

## 2026-04-11 - Decision Trace And Incident Graph Surfaces Added

- Why: compiled bundle, requirement, promotion, lint, and workset surfaces already existed, but there was still no first-class way to trace why a policy exists or to resolve an incident into service, playbook, contradiction, and next-action shape without manual archaeology.
- Scope: Obsidian knowledge compiler semantic aggregation, MCP/admin route surface expansion, focused tests, and route smoke coverage
- Impacted Routes: `GET /agent/obsidian/decision-trace`, `GET /agent/obsidian/incident-graph`
- Impacted Services: `src/services/obsidian/knowledgeCompilerService.ts`, `src/mcp/obsidianToolAdapter.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: adds `decision.trace` and `incident.graph.resolve` without changing existing tool inputs. Decision tracing now returns artifact/evidence steps, contradiction signals, and supersedes references; incident graph resolution now compiles affected services, blockers, next actions, and related operational objects from the same Obsidian-first control plane.
- Validation: `npm exec tsc -- --noEmit`; focused Vitest coverage passed for `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, and `src/routes/botAgentRoutes.smoke.test.ts`

## 2026-04-11 - Explicit Trigger Source Provenance Implemented In Runtime Knowledge Tools

- Why: the planning and MCP contract docs had already declared that user-provided implementation-driving sources must stay human-visible, but the live `knowledge.bundle.compile` and `requirement.compile` surfaces still did not carry those trigger sources through runtime responses, admin routes, and promoted requirement notes.
- Scope: Obsidian knowledge compiler provenance typing and merge logic, MCP/admin route input propagation, focused tests, and planning index alignment
- Impacted Routes: `GET /agent/obsidian/knowledge-bundle`, `GET /agent/obsidian/requirement-compile`
- Impacted Services: `src/services/obsidian/knowledgeCompilerService.ts`, `src/mcp/obsidianToolAdapter.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `docs/planning/README.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: `knowledge.bundle.compile` now preserves caller-supplied explicit sources as trigger artifacts, includes them in returned inputs/provenance, and emits a coverage gap when only trigger sources exist without supporting compiled knowledge. `requirement.compile` now returns `sourceArtifacts` and writes trigger/supporting labels into promoted requirement notes so the same causality trail remains visible to humans and agents.
- Validation: focused Vitest coverage passed for `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, and `src/routes/botAgentObsidianRuntime.test.ts`

## 2026-04-11 - Human-Visible Source Provenance For Shared Knowledge

- Why: planning and knowledge externalization had already shifted toward shared Obsidian plus shared MCP, but the rules still did not explicitly say that user-supplied articles, URLs, and prior discussion references must remain visible as sources before implementation. That omission made it too easy to treat provenance as agent-private context instead of a human-visible organizational review surface.
- Scope: planning policy clarification and MCP knowledge-contract provenance rules
- Impacted Routes: N/A
- Impacted Services: `docs/planning/REPO_DOC_EXTERNALIZATION_PLAN.md`, `docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md`, `docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. Documentation now treats knowledge-panel provenance as a shared human-and-agent surface, requires implementation-driving user sources to remain visible in bundle provenance, and clarifies that `gcpCompute` plus shared Obsidian are organizational infrastructure for team review and handoff, not a single-user scratch layer.
- Validation: targeted policy/contract review plus shared-vault backfill of the touched canonical notes

## 2026-04-11 - Repo Doc Externalization And Delete-Ready Policy

- Why: the planning tree had grown into an inefficient agent-facing working set. The repository already had Obsidian-first retrieval, backfill, and wikiization primitives, but it still lacked a canonical rule for which docs stay local, which docs become shared-Obsidian primary, and when a repo markdown file can shrink to a stub or disappear entirely.
- Scope: documentation operating-model planning, planning index alignment, and shared-vault backfill catalog expansion
- Impacted Routes: N/A
- Impacted Services: `docs/planning/REPO_DOC_EXTERNALIZATION_PLAN.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. This slice defines a local control core, Obsidian-primary mirror rules, archive-first evidence lanes, and a six-condition delete-ready gate so repo markdown can be reduced without breaking MCP-first retrieval quality.
- Validation: targeted planning and catalog review against current planning volume, existing backfill coverage, development-archaeology rules, and transition-plan constraints

## 2026-04-11 - Managed Agents Four-Layer Architecture Overlay

- Why: Anthropic's managed-agents framing made the missing separation explicit between the reasoning harness, execution surfaces, durable session memory, and semantic ownership. The repo needed a design memo that remaps the current assets and infra into those four layers without discarding the existing Obsidian operating-system work.
- Scope: architecture planning memo, architecture index alignment, and shared-vault backfill catalog expansion
- Impacted Routes: N/A
- Impacted Services: `docs/planning/MANAGED_AGENTS_FOUR_LAYER_MODEL.md`, `docs/ARCHITECTURE_INDEX.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. This slice formalizes Render as the primary brain ingress, the GCP shared MCP and external adapters as the hands-heavy execution layer, Supabase as the session owner, and shared Obsidian as the semantic owner, while explicitly calling out current worker hybrid debt and the need for stronger session contracts.
- Validation: targeted doc review against the operating baseline, Obsidian blueprint, transition plan, and MCP knowledge contracts; backfill catalog entry added for shared-vault promotion

## 2026-04-11 - Second-Wave Semantic Control Plane Surfaces Implemented

- Why: the first composite slice made shared knowledge queryable, but durable promotion, contradiction visibility, and active workset synthesis were still manual steps. The next bottleneck was not retrieval anymore, but turning answers, gaps, and runtime state into stable semantic objects and operator-facing worksets.
- Scope: Obsidian promotion/lint services, runtime workset synthesis, MCP tool surface expansion, admin routes, focused tests, and route smoke coverage
- Impacted Routes: `GET /agent/runtime/workset`, `POST /agent/obsidian/knowledge-promote`, `GET /agent/obsidian/semantic-lint-audit`
- Impacted Services: `src/services/obsidian/authoring.ts`, `src/services/obsidian/knowledgeCompilerService.ts`, `src/services/obsidian/index.ts`, `src/mcp/obsidianToolAdapter.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: adds three new semantic-control surfaces, `knowledge.promote`, `semantic.lint.audit`, and `workset.resolve`, without changing existing external contracts. Promotion now writes durable object pages with provenance/frontmatter, semantic lint makes negative knowledge explicit instead of silent drift, and workset synthesis ties compiled bundle evidence to current blockers and next actions.
- Validation: focused Vitest coverage passed for Obsidian compiler, MCP adapter, admin routes, and route smoke tests; repo lint/typecheck (`tsc --noEmit`) passed after the slice

## 2026-04-11 - First-Wave Obsidian Composite Tools Implemented

- Why: the repo already had policy, planning, and backfill guidance for shared MCP plus shared Obsidian, but the highest-value composite capabilities were only partially implemented. Internal knowledge resolution and requirement compilation still required manual archaeology instead of first-class tool surfaces.
- Scope: Obsidian knowledge compiler composites, MCP tool adapter surface, bot-agent admin routes, focused tests, and route smoke coverage
- Impacted Routes: `GET /agent/runtime/operator-snapshot`, `GET /agent/obsidian/knowledge-bundle`, `GET /agent/obsidian/internal-knowledge`, `GET /agent/obsidian/requirement-compile`, `POST /agent/obsidian/wiki-change-capture`
- Impacted Services: `src/services/obsidian/knowledgeCompilerService.ts`, `src/mcp/obsidianToolAdapter.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/bot-agent/qualityPrivacyRoutes.ts`, `src/services/obsidian/knowledgeCompilerService.test.ts`, `src/mcp/obsidianToolAdapter.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `src/routes/botAgentRoutes.smoke.test.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: adds two new composite surfaces, `internal.knowledge.resolve` and `requirement.compile`, on top of the already added bundle/snapshot/wiki-capture path. The internal resolver now uses direct shared MCP-backed Obsidian retrieval before fallback and only keeps repo artifacts as supporting context when needed. Requirement compilation now emits structured problem, constraint, workflow, gap, and next-artifact output and can optionally promote a durable requirement note into the shared vault without changing existing runtime APIs. `operator.snapshot` can now include a compact internal knowledge summary so runtime readiness views surface the same shared-control-plane context instead of only raw runtime status.
- Validation: targeted Vitest coverage for knowledge compiler, MCP adapter, admin routes, and route smoke coverage passed; repo lint/typecheck (`tsc --noEmit`) passed after this slice

## 2026-04-11 - Obsidian Leverage Priorities, Knowledge Bundle Spec, And Seed Object Plan

- Why: the routing and wikiization posture had already shifted toward shared MCP and shared Obsidian, but the repo still lacked a concrete top-five implementation order, a detailed `knowledge.bundle.compile` contract, and an explicit seed-object backlog for the shared wiki.
- Scope: leverage-priority planning, detailed compiled-knowledge tool spec, wiki seed-object prioritization, planning index alignment, shared-vault backfill catalog expansion
- Impacted Routes: N/A
- Impacted Services: `docs/planning/mcp/OBSIDIAN_AGENT_LEVERAGE_PRIORITIES.md`, `docs/planning/mcp/KNOWLEDGE_BUNDLE_COMPILE_SPEC.md`, `docs/planning/OBSIDIAN_SEED_OBJECTS_PRIORITY.md`, `docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. This slice makes the next shared-MCP and shared-Obsidian implementation order explicit, defines a composite bundle contract with provenance and gap semantics, and identifies the first wiki objects that should be seeded to reduce repeated archaeology.
- Validation: targeted markdown review of the new planning artifacts and backfill catalog structure review

## 2026-04-11 - Shared MCP Internal Knowledge Routing And Obsidian Wikiization Policy

- Why: the shared MCP server was already functioning as a common team surface, but agent guidance still risked treating it as a repo helper while durable repo memory and architecture-significant changes could still terminate in repo-local memory or changelog artifacts instead of converging into shared wiki objects.
- Scope: global shared-MCP/internal-knowledge routing clarification, Obsidian wikiization policy for repo memory and changelog handling, development-archaeology/transition alignment, tool-first wiki change-capture contract, knowledge backfill catalog expansion
- Impacted Routes: N/A
- Impacted Services: `.github/copilot-instructions.md`, `.github/instructions/mcp-routing.instructions.md`, `.github/instructions/shared-knowledge-routing.instructions.md`, `.github/instructions/obsidian-wikiization.instructions.md`, `.github/instructions/tribal-knowledge.instructions.md`, `docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md`, `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`, `docs/planning/mcp/TOOL_FIRST_KNOWLEDGE_CONTRACTS.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime code changed. Agent guidance now treats `gcpCompute` as a team/company internal knowledge ingress and shifts durable repo memory plus changelog-worthy change capture toward shared Obsidian wiki objects while keeping repo-local artifacts as compatibility mirrors or source material.
- Validation: targeted markdown and instruction validation on touched files, plus backfill catalog structure review

## 2026-04-10 - Development Archaeology Seed Objects And Team Repeatability

- Why: the development-archaeology contract had been defined, but the team still lacked concrete seed objects proving that repository-context and development-slice notes can be created from repo source and replayed into the shared vault.
- Scope: repository-context seed for `team-muel/discord-news-bot`, development-slice seed for the archaeology rollout, README/catalog alignment, and explicit team repeatability workflow in the archaeology policy
- Impacted Routes: N/A
- Impacted Services: `docs/planning/contexts/team-muel_discord-news-bot.md`, `docs/planning/development/2026-04-10_obsidian-development-archaeology-wikiization.md`, `docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. This slice seeds the first durable archaeology objects and keeps the repeat path repo-driven so other operators can run the same workflow from `main`.
- Validation: targeted backfill of the new repository-context and development-slice notes plus full catalog coverage report

## 2026-04-10 - Development Archaeology Wikiization Contract

- Why: the Obsidian operating model already covered control, runtime, and improvement knowledge, but repo-wide development process, `.github` customization, scripts/config context, and cross-repo integrations still remained scattered across the repository with no stable archaeology layer.
- Scope: development-archaeology canonical doc, object-model expansion for `repository_context` and `development_slice`, blueprint/transition/README alignment, repo-to-vault backfill catalog entry for the new policy doc
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OBSIDIAN_DEVELOPMENT_ARCHAEOLOGY.md`, `docs/planning/OBSIDIAN_OBJECT_MODEL.md`, `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`, `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`, `docs/planning/README.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed. This slice defines how repo-wide development history and multi-repo/service context should converge into wiki objects without mirroring every file into the vault.
- Validation: targeted backfill of the new archaeology policy note plus full catalog coverage report

## 2026-04-10 - Indexing MCP Local Overlay Contract Clarification

- Why: `muelIndexing` and `gcpCompute` both exposed indexing tools, but the intended split between shared repo truth and local dirty-workspace overlay was still too implicit in docs and agent guidance. That ambiguity invited the wrong server choice during planning, implementation, and review.
- Scope: local-overlay indexing role clarification, overlap matrix documentation, IDE/workflow/skill routing alignment, MCP tool spec externalization into the shared vault
- Impacted Routes: N/A
- Impacted Services: `.vscode/mcp.json`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `docs/planning/mcp/MCP_TOOL_SPEC.md`, `docs/ARCHITECTURE_INDEX.md`, `.github/instructions/mcp-routing.instructions.md`, `.github/instructions/workflow-pr-review.instructions.md`, `.github/instructions/workflow-branch-analysis.instructions.md`, `.github/instructions/tribal-knowledge.instructions.md`, `.github/skills/plan/SKILL.md`, `.github/skills/implement/SKILL.md`, `.github/skills/review/SKILL.md`, `config/runtime/knowledge-backfill-catalog.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime product behavior changed. `muelIndexing` remains available, but docs and IDE metadata now treat it as a strict local overlay lane while `gcpCompute` remains the shared truth for committed/team repository analysis.
- Validation: `node --import tsx scripts/backfill-obsidian-system.ts --report --json`, targeted backfill of MCP docs to the synced vault

## 2026-04-10 - Shared Vault Write Readiness Gate + Externalization Catalog Expansion

- Why: shared MCP read/search could still appear healthy while write routing remained pinned to a local adapter, which made team-shared visibility and phone-sync claims ambiguous. At the same time, backlog, roadmap, and incident/postmortem templates were not yet part of the canonical repo-to-vault backfill set.
- Scope: shared-write fail-closed health signaling, repo-to-vault catalog expansion for backlog/roadmap/incident templates, local/production profile alignment toward canonical shared `/mcp`
- Impacted Routes: `GET /api/bot/agent/obsidian/runtime`, `GET /api/bot/agent/runtime/knowledge-control-plane`, MCP `obsidian.adapter.status`
- Impacted Services: `src/services/obsidian/router.ts`, `src/services/obsidian/router.test.ts`, `config/runtime/knowledge-backfill-catalog.json`, `config/env/production.profile.env`, `config/env/local-first-hybrid.profile.env`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: read/search behavior is unchanged. Obsidian health now fails closed when remote MCP is configured but writes are still routed away from `remote-mcp`, more planning/incident artifacts are eligible for canonical vault backfill, and profile defaults now prefer canonical shared `/mcp` while preserving the legacy env alias name.
- Validation: `npx vitest run src/services/obsidian/router.test.ts`, `npx tsc --noEmit`

## 2026-04-10 - Shared MCP Canonical Team Access Promotion

- Why: the remote Obsidian path had already become operational, but key env examples, contracts, and IDE routing guidance still left room for local-vault-first interpretation. That weakened the goal of making the shared MCP surface the default team and agent reference plane.
- Scope: remote MCP diagnostics enrichment, canonical shared ingress visibility, `.env.example` shared MCP defaults, IDE routing/doc contract alignment toward shared vault access
- Impacted Routes: `GET /api/bot/agent/obsidian/runtime`, MCP `obsidian.adapter.status`
- Impacted Services: `src/services/obsidian/adapters/remoteMcpAdapter.ts`, `.env.example`, `docs/contracts/MEMORY_TO_OBSIDIAN.md`, `docs/contracts/OBSIDIAN_READ_LOOP.md`, `docs/planning/mcp/MCP_TOOL_SPEC.md`, `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`, `.github/instructions/mcp-routing.instructions.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: additive diagnostics and doc/env alignment only. Existing `/obsidian` compatibility ingress remains valid, but shared/team workflows now treat `/mcp` and `MCP_SHARED_MCP_URL` as the canonical path.
- Validation: `npx vitest run src/services/obsidian/adapters/remoteMcpAdapter.test.ts`, `npx tsc --noEmit`

## 2026-04-10 - Human-First Obsidian Access Profile + Vault Coverage Verification

- Why: the vault and knowledge-control surface had become usable as a runtime memory plane, but neither operators nor the agent had a single machine-readable answer for which repo docs are human-primary, which ones should seed autonomous reference, and whether those canonical docs are actually present in the live vault.
- Scope: human-first repo-to-vault catalog policy, operator/agent entrypoint metadata, vault coverage reporting for system backfill, knowledge-control surface enrichment, sprint prompt injection for human-first reference paths
- Impacted Routes: `GET /api/bot/agent/obsidian/knowledge-control`, `GET /api/bot/agent/runtime/loops` via embedded `knowledgeControl`, MCP `obsidian.knowledge.control`
- Impacted Services: `config/runtime/knowledge-backfill-catalog.json`, `scripts/backfill-obsidian-system.ts`, `src/services/obsidian/knowledgeCompilerService.ts`, `src/services/sprint/sprintPreamble.ts`, `package.json`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: additive metadata only. Existing backfill, runtime, and MCP surfaces remain backward-compatible while gaining a human-first access policy and vault coverage snapshot. No write-path routing behavior changes in this slice.
- Validation: `npm run test:obsidian -- --runInBand` equivalent targeted coverage via Vitest on touched obsidian services, `npx tsc --noEmit`, `npm run obsidian:backfill:system:report`, `npm run obsidian:backfill:system`, `npm run retrieval:bootstrap -- --source catalog --guild 1284113159191269386`

## 2026-04-10 - Obsidian Operating System Blueprint, Object Model, and Transition Plan

- Why: the repository had already moved toward Obsidian as a runtime-visible knowledge/control surface, but the intended end state was still implicit across runbook prose, roadmap notes, and runtime routes. A vault-first operating blueprint makes the design goal inspectable before additional loops and schemas deepen drift.
- Scope: Obsidian-centered target-state architecture, canonical object families for the vault, phased transition plan, planning index sync, execution-board linkage, architecture index references
- Impacted Routes: N/A
- Impacted Services: `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md`, `docs/planning/OBSIDIAN_OBJECT_MODEL.md`, `docs/planning/OBSIDIAN_TRANSITION_PLAN.md`, `docs/planning/README.md`, `docs/planning/EXECUTION_BOARD.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no runtime behavior changed in this slice. The new documents define the intended semantic owner model: evidence remains immutable, canonical object meaning belongs in the vault, runtime surfaces mirror that graph, and Supabase/cache layers remain derived acceleration planes rather than semantic authorities.
- Validation: consistency review against `docs/ARCHITECTURE_INDEX.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/contracts/OBSIDIAN_READ_LOOP.md`, `docs/planning/PLATFORM_CONTROL_TOWER.md`, `docs/planning/EXECUTION_BOARD.md`

## 2026-04-10 - Knowledge Control 4-Plane Blueprint Surface

- Why: the vault gained service, quality, customer, incident, and improvement notes quickly, but operators still lacked a runtime-visible architectural overlay and a reflection-bundle hint system to tell control truth, runtime truth, record evidence, and learning rules apart.
- Scope: knowledge-control surface metadata, control-tower artifact resolution, refined guild/sprint-journal reflection bundle classification, caller-facing next-path exposure for subscription/topology/journal/telemetry/reward writes, write-path bundle consumption for guild/system/retro notes, structured reflection artifacts for obsidian guild-doc action results, runner/outcome-side reflection consumption for follow-up guidance, vault schema registry expansion, runtime test contract updates
- Follow-up: `ops-execution` now preserves additive action outcomes and pushes them into live `shadowGraph.outcomes`, so reflection guidance survives beyond runner text output and becomes visible in runtime session state.
- Follow-up: sprint `plan|review|qa` phases now auto-inject knowledge-control and operating-baseline context, `GET /agent/runtime/knowledge-control-plane` now exposes the machine-readable operating baseline alongside control-surface metadata, and the repo ships a canonical backfill catalog plus CLI/bootstrap scripts for system-doc wiki seeding and retrieval-eval coverage.
- Follow-up: system backfill now skips existing canonical vault notes by default unless overwrite is explicitly requested, and retrieval bootstrap resolves guild-relative eval targets from synced source metadata so target paths match live vault layouts.
- Follow-up: MCP `obsidian.adapter.status` and the runtime knowledge-control snapshot now surface remote vault runtime details plus a local-vs-remote desktop parity check, so remote-mcp writes can be evaluated against the user-visible desktop vault instead of being treated as implicitly equivalent.
- Follow-up: `writeObsidianNoteWithAdapter()` no longer degrades across adapters after a primary write failure. A failed remote write now stays failed instead of silently succeeding through `local-fs`, preserving same-vault write semantics for desktop/mobile Obsidian visibility.
- Impacted Routes: `GET /api/bot/agent/obsidian/knowledge-control`, MCP `obsidian.knowledge.control`
- Impacted Services: `src/services/obsidian/knowledgeCompilerService.ts`, `src/services/obsidian/authoring.ts`, `src/services/obsidian/obsidianRagService.ts`, `src/services/skills/actions/obsidian.ts`, `src/services/skills/actionRunner.ts`, `src/services/agent/agentOutcomeContract.ts`, `src/services/discord-support/discordChannelTelemetryService.ts`, `src/services/discord-support/discordReactionRewardService.ts`, `src/mcp/obsidianToolAdapter.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: existing `artifactPaths` remain backward-compatible; new `controlPaths`, `blueprint`, `bundleSupport`, `pathIndex`, and optional `bundle` response fields are additive. Successful guild/system writes and retro writes now attach additive reflection-bundle metadata for downstream verification or logging. Guild-scoped event notes now prefer lore/history/decision hubs over customer ledgers by default, while `guilds/*/sprint-journal/*` notes resolve as learning-plane artifacts. Artifact resolution now accepts `blueprint|canonical-map|cadence|gate-entrypoints` aliases. Generic action result contracts remain unchanged; structured reflection is emitted additively through existing `artifacts` and verification/log channels, then consumed by runner display and AgentOutcome follow-up guidance rather than shown as raw payloads.
- Validation: `npx vitest run src/services/obsidian/knowledgeCompilerService.test.ts src/mcp/obsidianToolAdapter.test.ts src/routes/botAgentObsidianRuntime.test.ts src/services/obsidian/authoring.test.ts src/services/skills/actions/obsidian.test.ts`, `npx vitest run src/services/discord-support/discordChannelTelemetryService.test.ts src/services/discord-support/discordReactionRewardService.test.ts src/services/skills/actions/obsidian.test.ts`, `npx tsc --noEmit`

## 2026-04-10 - Operating Runtime Manifest Baseline

- Why: GCP machine profile, canonical worker endpoints, always-on required services, and local-only acceleration lanes were drifting across runbooks and deploy notes. A machine-readable runtime manifest reduces contract drift and keeps readiness interpretation consistent.
- Scope: runtime baseline manifest, repo-managed Caddy ingress template, LF-enforced deployment file attributes, GCP worker cost/health reporting, local hybrid readiness output, runbook/control-tower/GCP deployment docs
- Impacted Routes: N/A
- Impacted Services: `.gitattributes`, `scripts/archive/report-gcp-worker-cost-health.mjs`, `scripts/archive/check-local-hybrid-readiness.mjs`, `scripts/deploy-gcp-workers.sh`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: `env:check:local-hybrid` remains a local readiness check only; operators must still use unattended-health plus remote worker/LiteLLM/remote-mcp health for always-on decisions. Caddy public ingress is now path-prefix based and should be treated as repo-managed config.
- Validation: `gcloud compute instances describe instance-20260319-223412 --project gen-lang-client-0405212361 --zone us-central1-c --format="get(machineType)"`, `npm run ops:gcp:report:weekly`, `npm run ops:gcp:report:monthly`

## 2026-04-10 - Obsidian Knowledge Control Plane + Compatibility Surface Hardening

- Why: shared-vault metadata, knowledge compiler artifacts, unattended inbox answering, and the restored Discord ask alias all became real runtime surfaces, but operators still lacked a single documented control-plane view and rollback toggles for them.
- Scope: obsidian runtime/control-plane routes, inbox chat loop observability, env template/example alignment, runbook/changelog synchronization
- Impacted Routes: `GET /api/bot/agent/runtime/loops`, `GET /api/bot/agent/runtime/knowledge-control-plane`, `GET /api/bot/agent/obsidian/runtime`, `GET /api/bot/agent/obsidian/knowledge-control`, Discord `/뮤엘`, `/해줘`, `/구독`
- Impacted Services: obsidian inbox chat loop stats, knowledge compiler runtime surfaces, news monitor candidate-source fallback wiring, operator docs for remote-mcp/inbox/news rollout
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: `obsidianInboxChatLoop` is now exposed as a first-class runtime loop for rollout/rollback decisions. `/해줘` remains a compatibility alias while `/뮤엘` is the preferred ask surface. News candidate collection can legitimately succeed via n8n, MCP worker, or local fallback, so operators should check the surfaced source before triage.
- Validation: `npx vitest run src/routes/botAgentObsidianRuntime.test.ts`, `npx tsc --noEmit`

## 2026-04-10 - Canonical Executor Contract Alignment

- Why: executor runtime는 이미 neutral naming (`implement.execute`, `MCP_IMPLEMENT_WORKER_URL`) 방향을 갖고 있었지만 일부 운영 surface와 env/template가 여전히 legacy `opencode.*` 명칭에 고정돼 있었다. canonical contract를 노출하고 legacy persistence는 유지해 drift를 줄인다.
- Scope: config/runtime/governance/env validator, env profiles, executor docs/runbook/template alignment
- Impacted Routes: `GET /api/bot/agent/runtime/unattended-health`, `GET /api/bot/agent/self-growth/policy`, `POST /api/bot/agent/opencode/bootstrap-policy`
- Impacted Services: config alias resolution (`MCP_IMPLEMENT_WORKER_URL`), executor contract metadata in runtime/governance snapshots, env validation warnings for legacy-only env usage
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: persisted governance/log action key remains `opencode.execute` for backward compatibility. Canonical action/worker naming is additive and does not require data migration in this slice.
- Validation: `npx vitest run src/routes/botAgentObsidianRuntime.test.ts`, `npm run env:check`, `npm run env:check:local-hybrid`, `npx tsc --noEmit`

## 2026-04-10 - OpenJarvis Upper-Lane Workflow Binding

- Why: local-first 모드에서 OpenJarvis를 일반 fallback provider처럼 다루면 Ollama 중심 빠른 추론과 운영 orchestration 계층이 섞인다. operations/eval/worker 계열 action은 OpenJarvis binding/profile로 분리해 역할을 명시한다.
- Scope: 10 files — `src/services/llm/routing.ts`, `src/services/llm/client.ts`, `src/services/llmClient.test.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `scripts/validate-env.mjs`, `.env`, `config/env/local-first-hybrid.profile.env`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/LOCAL_FIRST_HYBRID_AUTONOMY.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`
- Impacted Routes: `GET /api/bot/agent/runtime/unattended-health`
- Impacted Services: operations capability ordering, workflow binding/profile runtime snapshot, env validator binding/profile lint, local-first hybrid env defaults
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: `operate.ops`/`openjarvis.ops`/`eval.*`/`worker.*` 는 OpenJarvis가 enabled 되면 먼저 시도된다. OpenJarvis health probe가 실패하면 readiness pruning 으로 Ollama/OpenClaw/LiteLLM 경로로 즉시 내려간다.
- Validation: `npx vitest run src/services/llmClient.test.ts src/routes/botAgentObsidianRuntime.test.ts`, `npm run env:check`, `npm run env:check:local-hybrid`, `npx tsc --noEmit`

## 2026-04-11 - Render Rollback And One-Off Job Operations Surfaced Through The Internal Adapter

- Why: the current Render starter footprint was still leaving useful operator convenience on the table. Deploy rollback and ad-hoc job execution existed on the platform, but the repo still pushed operators toward the dashboard, and the live Blueprint health check still pointed at `/health` even though readiness policy treats `/ready` as the restart/deploy gate.
- Scope: extended the Render adapter with deploy trigger/rollback and one-off job actions, aligned `render.yaml` to `/ready`, and synchronized the runbook plus Render env template with the new operating contract.
- Impacted Routes: N/A
- Impacted Services: `src/services/tools/adapters/renderAdapter.ts`, `src/services/tools/adapters/renderAdapter.test.ts`, `render.yaml`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: no steady-state runtime behavior changes unless the new adapter actions are invoked. `/health` remains available for diagnostics, but Render deploy/restart decisions now follow `/ready`, which reflects bot and automation readiness instead of generic process health alone.
- Validation: `npx vitest run --project infra`, `npx tsc --noEmit`

## 2026-04-10 - Runtime LLM Snapshot + Env Profile Command Recovery

- Why: 운영 문서는 env profile 명령과 local-hybrid readiness check를 가정했지만 package.json 에 실제 스크립트가 없었고, control-plane 에서는 LLM provider readiness/chain 상태를 직접 볼 수 없었다.
- Scope: 7 files — `src/services/llm/providers.ts`, `src/services/llm/client.ts`, `src/routes/bot-agent/runtimeRoutes.ts`, `src/routes/botAgentObsidianRuntime.test.ts`, `scripts/validate-env.mjs`, `package.json`, `docs/RUNBOOK_MUEL_PLATFORM.md`
- Impacted Routes: `GET /api/bot/agent/runtime/unattended-health`
- Impacted Services: LLM runtime snapshot helper, unattended health surface, env validator provider support (`litellm`, `openjarvis`, `kimi`), npm env profile wrappers
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: unattended-health 응답에 `llmRuntime` 블록이 추가된다. env profile 명령은 기존 `scripts/apply-env-profile.mjs` 와 archived local-hybrid checker를 감싸는 얇은 wrapper이므로 런타임 동작 변경은 없다.
- Validation: `npm run env:profile:local-first-hybrid:dry`, `npm run env:check:local-hybrid`, `npx vitest run src/routes/botAgentObsidianRuntime.test.ts src/services/llmClient.test.ts`, `npx tsc --noEmit`

## 2026-04-09 - LLM Capability Routing + Health-Aware Provider Pruning

- Why: env상 enabled 된 provider가 실제로 죽어 있어도 chain 후보에 남아 지연과 실패를 유발했다. action별로 provider를 직접 고정하는 대신 capability 중심 우선순위와 runtime readiness pruning을 도입해 local-first 경로를 더 안정적으로 만든다.
- Scope: 5 files — `src/services/llm/providers.ts`, `src/services/llm/routing.ts`, `src/services/llm/client.ts`, `src/services/llmClient.test.ts`, `docs/ARCHITECTURE_INDEX.md`
- Impacted Routes: N/A
- Impacted Services: LLM provider runtime state/cooldown cache, probeable local provider preflight (`ollama`, `litellm`, `openjarvis`), actionName→capability reorder (`chat/code/memory/review/operations`), broker loop success/failure feedback
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: explicit `provider` 지정 요청은 그대로 단일 provider 호출을 유지한다. probe 불가능한 provider는 기존처럼 unknown 상태로 호출 후보에 남는다. local HTTP health endpoint 실패 시 짧은 cooldown 동안 chain에서 제외된다.
- Validation: `npx tsc --noEmit`, `npx vitest run src/services/llmClient.test.ts`

## 2026-04-06 - Render Adapter + Platform Dashboard + Obsidian Headless Sync

- Why: 에이전트가 Render 인프라를 자율적으로 관리하고, 모든 플랫폼 상태를 시각적으로 모니터링하며, Obsidian Cloud와 서버 vault를 양방향 동기화한다.
- Scope: 11 files — `renderAdapter.ts` (new, 9 caps), `renderAdapter.test.ts` (new, 20 tests), `dashboard.ts` (new, visual HTML), `app.ts`, `health.ts`, `bot.ts` (contracts), `externalAdapterRegistry.ts`, `externalAdapterTypes.ts`, `externalToolProbe.test.ts`, `render.yaml`, `.env.example`
- Impacted Routes: `GET /dashboard` (visual platform status page)
- Impacted Services: Render adapter (service/deploy/events/env management), health endpoint (vault readiness), dashboard (adapter chain + capability routing)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: Render adapter read-only by default (env.update requires explicit call). Dashboard is public (no auth) — shows only operational metadata, no secrets.
- Validation: 36/36 tests passed, tsc clean, live API verified (7/7 Render capabilities).

## 2026-04-06 - M-15 Pluggable Adapter Framework

- Why: 기존 ExternalAdapterId가 closed union literal (`'openshell' | 'nemoclaw' | 'openclaw' | 'openjarvis'`)이라 새 어댑터를 추가할 때마다 타입 파일 수정이 필요했다. 동적 어댑터 등록과 glob scan 자동 발견으로 확장성을 확보한다.
- Scope: 7 files — `externalAdapterTypes.ts`, `externalAdapterRegistry.ts`, `adapterAutoLoader.ts` (new), `externalToolProbe.test.ts`, `runtimeBootstrap.ts` → `bootstrapServerInfra.ts`, `generate-onboarding-checklist.mjs`, `package.json`
- Impacted Routes: N/A
- Impacted Services: `externalAdapterTypes.ts` (branded string ID + `ADAPTER_ID_PATTERN` + `validateAdapterId` + `KNOWN_ADAPTER_IDS`), `externalAdapterRegistry.ts` (`registerExternalAdapter`/`unregisterExternalAdapter`), `adapterAutoLoader.ts` (glob scan + duck-type check), `bootstrapServerInfra.ts` (startup auto-load)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 기존 4개 built-in 어댑터 호환 유지. built-in ID 덮어쓰기/해제 차단.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (151 files, 1365 tests), `npm run tools:onboarding` dry run 검증.

## 2026-04-05 - Phase F+G+H Autonomous Agent Evolution Loop

- Why: 에이전트의 자율 진화를 위해 환경 스캔(F) → 의도 형성(G) → 신뢰 기반 자율 실행(H) 3단계 루프를 구축한다.
- Scope: 30+ files — `src/services/observer/` (11 files), `src/services/intent/` (5 files), `src/services/sprint/trustScoreService.ts`, `src/services/runtime/signalBusWiring.ts`, `src/services/runtime/bootstrapServerInfra.ts`, config, migration SQL, profile env
- Impacted Routes: `src/routes/bot-agent/intentRoutes.ts` (Phase G API)
- Impacted Services: Observer (6 channels + orchestrator + store), Intent Formation (6 rules + engine + store), Progressive Trust (trust score computation + trust decay + loop breaker)
- Impacted Tables/RPC: `observations` (Phase F), `intents` (Phase G), `agent_trust_scores` (Phase H)
- Risk/Regression Notes: 모든 Phase는 env flag로 통제 (OBSERVER_ENABLED, INTENT_FORMATION_ENABLED, TRUST_ENGINE_ENABLED). 기본값 비활성화. production-pilot.profile.env에서 활성화.
- Validation: 1365 tests passed, tsc clean.

## 2026-04-04 - Observer Layer: Autonomous Environment Scanning (Phase F)

- Why: Agent 자율 진화를 위해 환경(에러 패턴, 메모리 갭, LLM 성능 드리프트, 코드 건강도, 수렴 추세, Discord 활동량)을 주기적으로 스캔하고 위험 신호를 자동 감지하는 계층이 필요했다.
- Scope: 11 files — `src/services/observer/` 전체 디렉토리 (types, orchestrator, store, 7 channels)
- Impacted Routes: N/A (internal scanning layer)
- Impacted Services: `src/services/observer/observerOrchestrator.ts` (주기적 스캔 코디네이터 + 신호 발신), `observationStore.ts` (Supabase 영속화 + in-memory fallback), `errorPatternChannel.ts` (런타임 에러 클러스터링), `memoryGapChannel.ts` (오래된/저신뢰 메모리 탐지), `perfDriftChannel.ts` (LLM latency/cost 회귀), `codeHealthChannel.ts` (TypeScript 타입체크 에러), `convergenceDigestChannel.ts` (수렴 리포트 래핑), `discordPulseChannel.ts` (길드 활동량 모니터링)
- Impacted Tables/RPC: `scripts/migrations/008_observer_layer.sql` (pending migration)
- Risk/Regression Notes: 미커밋 상태. 스캐닝은 fire-and-forget이며 핵심 응답 경로를 블로킹하지 않음. 각 channel은 독립적으로 비활성화 가능.
- Validation: 미커밋 — 컴파일은 기존 빌드에 포함되지 않음.

## 2026-04-04 - Platform Signal Bus: In-Process Event Hub

- Why: "Supabase에 쓰고 누가 읽기를 기대하는" 패턴을 즉시 인프로세스 신호 전파로 대체하여 eval 루프, go/no-go, convergence, memory quality, workflow 이벤트를 sprint trigger, runtime alert, traffic routing에 즉시 연결한다.
- Scope: 3 files — `src/services/runtime/signalBus.ts`, `signalBusWiring.ts`, `signalBus.test.ts`
- Impacted Routes: N/A (runtime internal event bus)
- Impacted Services: `signalBus.ts` (17개 시그널 타입, typed payload, async fire-and-forget, cooldown/dedup, diagnostics snapshot), `signalBusWiring.ts` (producer→consumer 자동 배선)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 리스너는 비동기이며 producer를 블로킹하지 않음. `SIGNAL_BUS_ENABLED` env로 통제.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - Bot Auto-Recovery Service

- Why: Discord gateway 연결 끊김이나 예상치 못한 크래시 이후 수동 개입 없이 봇이 자동 복구되어야 하는 운영 요구사항.
- Scope: 2 files — `src/services/runtime/botAutoRecoveryService.ts`, `botAutoRecoveryService.test.ts`
- Impacted Routes: N/A (runtime lifecycle)
- Impacted Services: `botAutoRecoveryService.ts` (자동 복구 로직), `runtimeBootstrap.ts`에서 소비
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 복구 실패 시 기존 프로세스 재시작 경로(pm2/Render)로 폴백.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - [UNCOMMITTED] Workflow Persistence + Traffic Routing Service

- Why: A/B 트래픽 라우팅 결정 및 워크플로 이벤트를 영속화하여, sprint/session 실행 경로의 관찰 가능성과 회귀 분석을 지원한다.
- Scope: 4 files — `src/services/workflow/trafficRoutingService.ts`, `trafficRoutingService.test.ts`, `workflowPersistenceService.ts`, `workflowPersistenceService.test.ts`
- Impacted Routes: N/A (consumed by multiAgentService, sprintOrchestrator)
- Impacted Services: `trafficRoutingService.ts` (트래픽 라우팅 결정 + 영속화), `workflowPersistenceService.ts` (워크플로 이벤트 기록)
- Impacted Tables/RPC: `scripts/migrations/007_workflow_traffic_routing.sql` (pending migration — `workflow_sessions`, `workflow_steps`, `workflow_events`)
- Risk/Regression Notes: 미커밋 상태. `TRAFFIC_ROUTING_ENABLED` env 통제. 미설정 시 기존 경로에 영향 없음.
- Validation: 미커밋 — 로컬 테스트 존재.

## 2026-04-04 - [UNCOMMITTED] Security Pipeline Orchestrator

- Why: OWASP Top 10 기반 보안 스캔을 코드 레벨에서 자동화하기 위한 파이프라인.
- Scope: 1 file — `src/services/security/securityPipelineOrchestrator.ts`
- Impacted Routes: N/A (consumed by `scripts/generate-security-candidates.ts`)
- Impacted Services: `securityPipelineOrchestrator.ts` (보안 후보 탐지 + STRIDE 위협 모델 자동화)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 스캔 전용, 런타임 동작 변경 없음.
- Validation: 미커밋.

## 2026-04-04 - [UNCOMMITTED] Sprint Event Sourcing + Metrics Collector + Worker Router

- Why: 스프린트 파이프라인의 관찰 가능성 강화를 위해 이벤트 소싱 기반 상태 추적, 위상 메트릭 수집, 외부 어댑터 라우터를 분리한다.
- Scope: 5+ files — `src/services/sprint/eventSourcing/` (bridge), `sprintMetricsCollector.ts`, `sprintWorkerRouter.ts`, `sprintDiffSummarizer.ts`
- Impacted Routes: N/A (sprint internal)
- Impacted Services: `eventSourcing/bridge.ts` (pipeline/phase/file/cancel/block 이벤트 발행), `sprintMetricsCollector.ts` (phase 타이밍, loop-back 카운트), `sprintWorkerRouter.ts` (PHASE_WORKER_KIND, PHASE_EXTERNAL_ADAPTER, circuit breaker, secondary adapter 매핑), `sprintDiffSummarizer.ts` (diff → 구조적 변경 요약 생성)
- Impacted Tables/RPC: `scripts/migrations/011_ventyd_event_sourcing.sql` (pending)
- Risk/Regression Notes: 미커밋 상태. sprintOrchestrator에서 이미 import 중이나 git에 미추적.
- Validation: 미커밋 — sprintDiffSummarizer.test.ts 존재.

## 2026-04-04 - [UNCOMMITTED] MCP Unified Server + Obsidian Tool Adapter

- Why: 여러 MCP 서버(기본, 인덱싱, Obsidian)를 단일 진입점으로 통합하고, Obsidian 볼트 조작을 MCP 도구로 노출한다.
- Scope: 5 files — `src/mcp/unifiedServer.ts`, `src/mcp/unifiedToolAdapter.ts`, `unifiedToolAdapter.test.ts`, `src/mcp/obsidianToolAdapter.ts`, `obsidianToolAdapter.test.ts`, `scripts/unified-mcp-stdio.ts`
- Impacted Routes: N/A (MCP stdio transport)
- Impacted Services: `unifiedServer.ts` (MCP 라우터 통합), `unifiedToolAdapter.ts` (ext.* MCP bridge 포함), `obsidianToolAdapter.ts` (vault search/read/write/backlinks 도구)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. MCP stdio 서버는 IDE 연결 전용이며 런타임에 영향 없음.
- Validation: 미커밋 — 테스트 파일 존재.

## 2026-04-04 - [UNCOMMITTED] Agent Collab Decomposition + Guild Analytics + n8n Delegation

- Why: `agentCollab.ts`가 600+ 줄로 비대해져 역할별/기능별 분리 필요. 길드 분석과 n8n 위임도 독립 모듈로 추출.
- Scope: 10+ files — `src/services/skills/actions/agentCollabHelpers.ts`, `agentCollabJarvis.ts`, `agentCollabOrchestrator.ts`, `agentCollabRoles.ts`, `agentCollabSprint.ts`, `guildAnalytics.ts`, `n8n.ts`, `src/services/automation/n8nDelegationService.ts` + 테스트
- Impacted Routes: `src/routes/bot-agent/crmRoutes.ts` (new)
- Impacted Services: 기존 `agentCollab.ts`의 기능을 역할 기반 모듈로 분리
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. 기존 agentCollab export는 유지되며 내부 분해만 진행.
- Validation: 미커밋 — guildAnalytics.test.ts, n8n.test.ts, n8n.delegation.test.ts 존재.

## 2026-04-04 - [UNCOMMITTED] Shared Utilities: Circuit Breaker, Discord Channel Meta, Vector Math

- Why: 여러 서비스에서 반복되던 circuit breaker 패턴, Discord 채널 메타데이터 추출, 벡터 연산을 공유 유틸리티로 추출한다.
- Scope: 6 files — `src/utils/circuitBreaker.ts`, `circuitBreaker.test.ts`, `discordChannelMeta.ts`, `discordChannelMeta.test.ts`, `vectorMath.ts`, `errorMessage.ts`
- Impacted Routes: N/A
- Impacted Services: `circuitBreaker.ts` (actionRunner + sprintWorkerRouter의 인라인 CB 대체), `discordChannelMeta.ts` (채널/스레드 메타 표준화), `vectorMath.ts` (코사인 유사도 등)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 미커밋 상태. sprintOrchestrator, multiAgentService 등에서 이미 import 중.
- Validation: 미커밋 — 각 테스트 파일 존재.

## 2026-04-04 - Obsidian Native CLI Adapter + Graph-First Retrieval + Advanced Integrations

- Why: Obsidian CLI 1.12.7+ native 어댑터를 도입하여 검색/backlinks/read/write/graph_metadata를 CLI 네이티브로 지원하고, graph connectivity 기반 검색 점수 부스트, 레트로 결과 자동 볼트 기록, 2-hop 그래프 탐색, 반응형 학습 루프, 지식 갭 탐지, daily note 자동화, Discord↔Obsidian 태스크 브릿지를 구현한다.
- Scope: 10+ files — `src/services/obsidian/adapters/nativeCliAdapter.ts` (new, 350 lines), `obsidianRagService.ts` (graph-first boost, writeRetroToVault, 2-hop traversal, reactive learning, gap detection, daily note, task bridge), `router.ts`, `scripts/audit-obsidian-graph.ts`, `src/discord/commands/tasks.ts` (new), `src/discord/commands/docs.ts`, `src/discord/messages.ts`
- Impacted Routes: N/A (Discord commands + internal services)
- Impacted Services: `nativeCliAdapter.ts` (CLI adapter), `obsidianRagService.ts` (5개 advanced feature 추가), `router.ts` (native CLI 라우팅)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: native CLI 미설치 시 기존 어댑터 체인으로 자동 폴백. 반응형 학습 루프는 fire-and-forget. 지식 갭 리포트는 threshold 도달 시만 기록.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (670 tests passed), `nativeCliAdapter.test.ts` (21 new tests).

## 2026-04-04 - M-18 Platform Lightweighting Phase B

- Why: pg_cron 이관 확대(login cleanup, obsidian sync, SLO check)와 중복 코드 통합(searchMemoryHybrid 3개 호출자 → 1개 공유 헬퍼)으로 런타임 경량화를 진행한다.
- Scope: 11 files — pgCronBootstrapService, agentMemoryService, agentMemoryStore, agentSloService, memoryEvolutionService, obsidianLoreSyncService, platformLightweightingService, runtimeSchedulerPolicyService, render.yaml
- Impacted Routes: N/A
- Impacted Services: `pgCronBootstrapService.ts` (login/obsidian/SLO cron 추가), `agentMemoryStore.ts` (searchMemoryHybrid 공유 헬퍼), `agentMemoryService.ts` (중복 검색 로직 제거), `memoryEvolutionService.ts` (중복 검색 로직 제거)
- Impacted Tables/RPC: pg_cron 스케줄 3개 추가
- Risk/Regression Notes: owner toggle(`OBSIDIAN_SYNC_LOOP_OWNER`, `AGENT_SLO_ALERT_LOOP_OWNER`, `DISCORD_LOGIN_SESSION_CLEANUP_OWNER`)로 app/db 위임 전환 가능.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (97 files, 635 tests passed).

## 2026-04-03 - M-11 Intent Intelligence Layer (Exemplar Store, Signal Enricher, Outcome Attributor)

- Why: 인텐트 분류 정확도를 대화 턴, 소셜 시그널, 시간 특성으로 강화하고, 세션 종료 시 outcome을 intent에 귀속시켜 분류 정확도 피드백 루프를 구축한다.
- Scope: 10 files — `src/services/langgraph/nodes/intentExemplarStore.ts` (new), `intentSignalEnricher.ts` (new), `intentOutcomeAttributor.ts` (new), `coreNodes.ts` (enriched signal intent classification), `agentRuntimeTypes.ts` (AgentIntentSignal type), `multiAgentService.ts` (intent attribution on session close), `conversationTurnService.ts` (recent turn query), + 3 test files
- Impacted Routes: N/A (internal classification pipeline)
- Impacted Services: `intentExemplarStore.ts` (Supabase-backed exemplar CRUD + bootstrap), `intentSignalEnricher.ts` (대화턴+소셜시그널+시간 feature 결합), `intentOutcomeAttributor.ts` (세션 outcome → intent 정확도 피드백), `coreNodes.ts` (enriched signals + exemplar matching으로 분류 개선)
- Impacted Tables/RPC: `intent_exemplars` (new table via schema)
- Risk/Regression Notes: Exemplar store 미구축 시 기존 규칙 기반 분류로 폴백. Attribution은 세션 종료 후 비동기 best-effort.
- Validation: `npx tsc --noEmit` (0 errors), 3개 신규 테스트 파일.

## 2026-04-03 - M-12/M-13 External Tool Adapters: OpenShell Sandbox + OpenJarvis Bench + OpenClaw Relay

- Why: 외부 도구 어댑터를 stub에서 실사용 가능한 수준으로 확대. OpenShell sandbox 정책 동기화, OpenJarvis bench JSON 파서, OpenClaw session relay를 구현한다.
- Scope: 10 files — `openshellCliAdapter.ts` (sandbox create/exec/policy), `openjarvisAdapter.ts` (bench --json parser, optimize trigger), `openclawCliAdapter.ts` (session relay, channel routing), `actionRunner.ts` (sandbox delegation path), `opencode.ts` (sandbox-first execution + fallback), + 3 adapter test files, `externalAdapterTypes.ts`
- Impacted Routes: N/A (tool execution layer)
- Impacted Services: `openshellCliAdapter.ts`, `openjarvisAdapter.ts`, `openclawCliAdapter.ts`, `actionRunner.ts` (implement.execute → sandbox delegation), `opencode.ts` (sandbox-first)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: 각 어댑터는 CLI 미설치 시 skip/fallback. Sandbox delegation은 `OPENSHELL_ENABLED` 미설정 시 기존 경로 유지.
- Validation: `npx tsc --noEmit` (0 errors), 3개 신규 어댑터 테스트.

## 2026-04-03 - M-11 Self-Improvement Loop + Sprint Learning Enhancements

- Why: 주간 auto-judge 결과와 sprint retro에서 자동으로 개선 패턴을 추출하고, 검증된 패턴을 다음 sprint에 주입하는 자기 개선 루프를 구축한다.
- Scope: 8 files — `src/services/sprint/selfImprovementLoop.ts` (new, 613 lines), `selfImprovementLoop.test.ts` (new), `sprintOrchestrator.ts` (retro 단계 통합), `sprintTriggers.ts` (auto-improve trigger), `sprintPreamble.ts` (improvement context 주입), `sprintLearningJournal.ts`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`
- Impacted Routes: N/A (sprint internal + ops automation)
- Impacted Services: `selfImprovementLoop.ts` (패턴 영속화, 회귀 검증, 개선 적용), `sprintOrchestrator.ts` (retro → self-improvement 연결)
- Impacted Tables/RPC: Supabase에 개선 패턴 영속화 (기존 sprint_pipelines 확장)
- Risk/Regression Notes: Self-improvement은 retro 단계 이후에만 실행. 패턴 적용은 검증 통과 후에만 활성화.
- Validation: `npx tsc --noEmit` (0 errors), `selfImprovementLoop.test.ts` (200 lines).

## 2026-04-03 - M-13 Discord Runtime + OpenClaw Channel Bridge

- Why: OpenClaw gateway를 Discord 런타임에 통합하고, 채널 수준 라우팅 정책을 추가하여 멀티 채널 에이전트 실행을 지원한다.
- Scope: 13 files — `src/bot.ts` (OpenClaw gateway hook), `runtimeRoutes.ts` (channel routing/policy sync/self-improvement admin), `runtimePolicy.ts` (channel-level routing), `discord/auth.ts`, `discord/session.ts` (OpenClaw session relay), `passiveMemoryCapture.ts` (enhanced signal capture), `config.ts` (OpenClaw config entries)
- Impacted Routes: `src/routes/bot-agent/runtimeRoutes.ts` (channel routing, policy sync, self-improvement endpoints)
- Impacted Services: `bot.ts`, `runtimePolicy.ts`, `runtimeRoutes.ts`, `passiveMemoryCapture.ts`
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: OpenClaw gateway가 미설정 시 기존 단일 채널 동작 유지. 채널 라우팅 정책은 opt-in.
- Validation: docs regenerated (DEPENDENCY_GRAPH, ROUTES_INVENTORY, SCHEMA_SERVICE_MAP).

## 2026-04-04 - Sprint Pipeline External OSS Capability Expansion (고도화)

- Why: 외부 OSS 6개(OpenClaw, OpenJarvis, NemoClaw, OpenShell, DeepWiki, n8n) 33개 capability 중 18%만 사용 중이었다. 복합 실행(secondary adapter), enrichment 확대, OpenClaw session bootstrap, ext.* MCP bridge를 도입해 capability 활용률을 70%+로 확대한다.
- Scope: 8 files — sprintPreamble.ts, sprintWorkerRouter.ts, sprintOrchestrator.ts, openclawCliAdapter.ts, unifiedToolAdapter.ts, circuitBreaker.ts (new shared util), + 3 test files
- Impacted Routes: N/A (sprint internal pipeline only)
- Impacted Services: `src/services/sprint/sprintPreamble.ts` (PHASE_ENRICHMENT_MAP ~12→28 enrichment actions), `src/services/sprint/sprintWorkerRouter.ts` (PhaseAdapterMapping type with `secondary` field, buildSecondaryAdapterArgs), `src/services/sprint/sprintOrchestrator.ts` (secondary adapter composite execution, OpenClaw bootstrap), `src/services/tools/adapters/openclawCliAdapter.ts` (bootstrapOpenClawSession), `src/mcp/unifiedToolAdapter.ts` (ext.* MCP bridge), `src/utils/circuitBreaker.ts` (new shared CB replacing inline duplicates in actionRunner + sprintWorkerRouter)
- Impacted Tables/RPC: N/A (no schema changes)
- Risk/Regression Notes: Secondary adapter 실패는 primary 결과에 영향 없음 (append-only). OpenClaw bootstrap은 sessionId 기준 idempotent. ext.* bridge는 기존 MCP 라우팅에 `ext.` prefix로 네임스페이스 격리. OPENSHELL_ENABLED/N8N_ENABLED 미설정 시 해당 secondary/enrichment 자동 skip.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (130 files, 1152 tests passed)

## 2026-04-06 - M-17 Infrastructure Optimization + Services Subdirectory Restructure Phase 2

- Why: (1) setInterval 기반 스케줄러를 Supabase pg_cron으로 이관해 단일 진실 원천 통합. (2) Obsidian wikilink 그래프를 Supabase에 동기화해 graph-first retrieval 강화. (3) ollama/litellm-admin/mcp-indexing 어댑터 추가로 외부 도구 커버리지 확대. (4) Planner 반복 목표에 TTL pattern cache 적용. (5) services/ 디렉토리 6개 도메인 서브디렉토리 분리 (eval/, infra/, memory/, news/, obsidian/, trading/).
- Scope: 113 files — 13 new, ~40 renamed/moved, ~60 import path updates
- Impacted Routes: `src/routes/bot-agent/` (memoryRoutes, qualityPrivacyRoutes, rewardEvalRoutes, runtimeRoutes), `src/routes/trades.ts`, `src/routes/trading.ts`
- Impacted Services: `src/services/infra/pgCronBootstrapService.ts` (new), `src/services/tools/adapters/{ollamaAdapter,litellmAdminAdapter,mcpIndexingAdapter}.ts` (new), `src/services/eval/index.ts`, `src/services/infra/index.ts`, `src/services/memory/index.ts`, `src/services/news/index.ts`, `src/services/obsidian/index.ts`, `src/services/trading/index.ts` (new barrels), `scripts/sync-obsidian-lore.ts` (wikilink extraction), `src/services/skills/actions/planner.ts` (pattern cache)
- Impacted Tables/RPC: `ensure_pg_cron_job` (new RPC via migration SQL), `memory_item_links` (graph sync writes)
- Risk/Regression Notes: 런타임 동작 변경 없음 for subdirectory moves. pg_cron migration SQL은 Supabase SQL editor에서 수동 실행 필요. Pattern cache는 `PLANNER_PATTERN_CACHE_ENABLED` env로 opt-in.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (97 files, 635 tests passed).

## 2026-04-02 - M-10 Codebase Health: Agent Services Subdirectory Restructure

- Why: `src/services/` flat directory에 100+ 파일이 혼재해 탐색이 어려웠다. agent 관련 25개 서비스 + 9개 테스트를 `src/services/agent/`로 분리하여 도메인 경계를 명확히 한다.
- Scope: 34개 파일을 `src/services/` → `src/services/agent/`로 이동. 33개 외부 파일의 import 경로, 11개 `vi.mock()` 경로, 동적 `import()` 및 인라인 타입 참조를 일괄 수정.
- Impacted Routes: `src/routes/bot-agent/` (6개 route 파일 import 경로 변경)
- Impacted Services: `src/services/agent/*` (25 source + 9 test), `src/bot.ts`, `src/services/multiAgentService.ts`, `src/services/multiAgentTypes.ts`, `src/services/runtimeBootstrap.ts`, `src/services/runtimeSchedulerPolicyService.ts`, `src/services/langgraph/` (6 files), `src/services/skills/actionRunner.ts`, `src/services/skills/actions/` (2 files), `src/discord/` (4 files)
- Impacted Tables/RPC: N/A (import path changes only)
- Risk/Regression Notes: 런타임 동작 변경 없음. import 경로만 변경. 모든 export/import이 동일한 모듈을 참조.
- Validation: `npx tsc --noEmit` (0 errors), `npx vitest run` (88 files, 550 tests passed), `npm run docs:build`, `npm run docs:check`.

## 2026-03-27 - Entity Nervous System Feedback Circuits

- Why: Discord 안에서 동작하는 자율 진화 엔티티라는 목표에 맞춰, 기존의 분리된 루프들을 감각→기억, 보상→행동, 자기 성찰→자기 수정의 닫힌 피드백 회로로 연결할 필요가 있었다.
- Scope: added `entityNervousSystem` integration service, wired session terminal state into `durable_extraction` memory jobs, connected reward snapshot persistence to behavior adjustment, and persisted retro optimize/failure insights as self-notes injected into subsequent agent memory hints.
- Impacted Routes: N/A (runtime/service boundary and persistence change only).
- Impacted Services: `src/services/entityNervousSystem.ts`, `src/services/multiAgentService.ts`, `src/services/rewardSignalService.ts`, `src/services/agentMemoryService.ts`, `src/services/sprint/sprintOrchestrator.ts`, `src/services/entityNervousSystem.test.ts`.
- Impacted Tables/RPC: `public.entity_self_notes` (new), `public.memory_jobs`, `public.agent_tot_policies`, `public.retrieval_ranker_active_profiles`, `public.reward_signal_snapshots`.
- Risk/Regression Notes: session 종료 후 memory precipitation과 reward-based adjustment는 best-effort 비동기 경로로 연결되어 기존 핵심 응답 경로를 블로킹하지 않는다. `entity_self_notes` 미적용 환경에서는 self-note 주입만 비활성화되고 기존 memory hint 경로는 유지된다.
- Validation: `npx tsc --noEmit`, `npx vitest run`, `npm run docs:build`, `npm run docs:check`.

## 2026-03-27 - Reward Signal Normalization + A/B Eval Auto-Promote + Shadow Graph Runner + Embedding Context Selection

- Why: 자율 진화 아키텍처의 4개 구조적 기반을 동시에 도입한다. (1) Discord reactions, session outcomes, citation rates, LLM latency를 단일 보상 스칼라로 정규화. (2) baseline vs candidate config A/B 평가 + 자동 승격 파이프라인. (3) LangGraph 세션의 대안 노드 핸들러를 shadow 실행하여 divergence를 감지. (4) 메모리 힌트 하이브리드 검색(vector+lexical)으로 전환.
- Scope: 6 new files — `rewardSignalService.ts`, `rewardSignalService.test.ts`, `evalAutoPromoteService.ts`, `evalAutoPromoteService.test.ts`, `langgraph/shadowGraphRunner.ts`, `shadowGraphRunner.test.ts`, + `agentMemoryService.ts` 변경. Migration: `005_reward_signal_and_eval.sql`
- Impacted Routes: N/A (service layer only)
- Impacted Services: `rewardSignalService.ts` (가중치 기반 보상 블렌딩, 스냅샷 영속화, 추세 분석), `evalAutoPromoteService.ts` (eval run 생성, 보상 샘플 수집, LLM judge, 자동 승격), `shadowGraphRunner.ts` (병렬 shadow 실행, divergence 감지/로깅), `agentMemoryService.ts` (hybrid search 전환)
- Impacted Tables/RPC: `reward_signal_snapshots` (new), `eval_runs` (new), `shadow_graph_divergence_logs` (new), `search_memory_items_hybrid` RPC 활용
- Risk/Regression Notes: Shadow runner는 `SHADOW_GRAPH_RUNNER_ENABLED=false` 기본값으로 log-only(트래픽 영향 없음). Eval auto-promote는 threshold 미달 시 기존 config 유지. Hybrid search는 embedding 미존재 시 classic ilike 폴백.
- Validation: `npx tsc --noEmit`, `npx vitest run`.

## 2026-03-23 - Discord Login Rate-Limit Startup Log Downgrade

- Why: Render 부팅 시 Discord session start 429가 이미 보호 동작으로 처리되고 있었지만, 시작 경로 로그가 `error` 위주로 남아 운영자가 실제 장애와 rate-limit cooldown 상태를 구분하기 어려웠다.
- Scope: Discord login rate-limit 에러를 시작 경로에서 별도 식별해 `warn` 레벨로 기록하도록 조정했다. 프로세스 생존, cooldown 보존, auto/manual recovery 제어 동작은 유지한다.
- Impacted Routes: N/A (runtime logging only)
- Impacted Services: `src/bot.ts`, `server.ts`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: 로그 레벨만 조정되며, 비-rate-limit 로그인 실패는 기존처럼 `error`로 유지된다.
- Validation: `npm run lint`.

## 2026-03-23 - Unattended Weekly Report Missing-Table Fail-Open Guard

- Why: `openjarvis-unattended` 스케줄 워크플로가 아직 적용되지 않은 Supabase 주간 리포트 테이블과 소스 스냅샷 부재를 hard fail로 취급해, 운영 자동화 자체가 불필요하게 실패하고 있었다.
- Scope: unattended 주간 리포트 경로에서 `agent_llm_call_logs` 및 `agent_weekly_reports` 누락 시 skip 처리 가드를 추가하고, GitHub Actions 스케줄 워크플로에 해당 fail-open 환경 플래그를 주입했다. 함께 stale 상태였던 dependency graph 산출물을 갱신했다.
- Impacted Routes: N/A (ops automation and generated docs only)
- Impacted Services: `scripts/generate-llm-latency-weekly-report.mjs`, `scripts/generate-hybrid-weekly-report.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `.github/workflows/openjarvis-unattended.yml`, `docs/DEPENDENCY_GRAPH.md`.
- Impacted Tables/RPC: reads `public.agent_llm_call_logs`, `public.agent_weekly_reports`.
- Risk/Regression Notes: 기본 CLI 동작은 fail-closed를 유지하고, unattended 워크플로에서만 환경 플래그로 skip 허용을 활성화한다. 따라서 수동 점검이나 로컬 검증 경로의 엄격성은 유지된다.
- Validation: `npm run lint`, `npm run docs:build`, `npm run docs:check` (stale diff root cause confirmed to `docs/DEPENDENCY_GRAPH.md` before staging updated artifact).

## 2026-03-21 - External Tool Layer Integration Plan (NemoClaw, OpenShell, OpenClaw, OpenJarvis, Nemotron)

- Why: 내부 역할 라벨(nemoclaw, openjarvis 등)을 실제 외부 OSS 도구로 연결하는 Tool Layer 통합 시작. NVIDIA NemoClaw(★14.5k), OpenShell(★2.8k), OpenClaw(openclaw.ai), Stanford OpenJarvis(★1.6k), Nemotron 모델을 로컬 IDE Tool Layer로 통합하여 recursive/self-learning 자율 에이전트 파이프라인을 구축한다. OpenJarvis는 Stanford Scaling Intelligence Lab(Hazy Research, Christopher Ré, John Hennessy)의 로컬 우선 개인 AI 프레임워크로, 5-primitive composable stack (Intelligence, Engine, Agents, Tools & Memory, Learning)을 제공하며 trace 기반 self-learning loop(자동 최적화)을 내장한다.
- Scope: 신규 `EXTERNAL_TOOL_INTEGRATION_PLAN.md` 생성, `RUNTIME_NAME_AND_SURFACE_MATRIX.md` External Name Reference 및 Surface Matrix 업데이트, `LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`에 구체적 adapter 인터페이스(OpenShell/NemoClaw/OpenClaw/OpenJarvis) 추가, `litellm.config.yaml`에 `muel-nemotron` 모델 등록, `scripts/bootstrap-external-tools.sh` readiness 체크 스크립트 생성.
- Impacted Routes: N/A (planning/documentation/config phase)
- Impacted Services: `litellm.config.yaml` (muel-nemotron entry + fallback chain), future `src/services/tools/adapters/` (openshellCliAdapter, nemoclawCliAdapter, openclawCliAdapter, openjarvisAdapter).
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: (1) litellm.config.yaml에 muel-nemotron 추가는 `NVIDIA_NIM_API_KEY` 미설정 시 해당 모델만 호출 실패하며 기존 모델에 영향 없음. (2) 외부 도구 adapter는 아직 stub/계획 단계이며, 기존 in-process 역할 실행 경로에 영향 없음. (3) 모든 외부 도구는 선택적(optional)이며 미설치 시 기존 폴백 경로 유지.
- Validation: `npm run -s lint`, `bash scripts/bootstrap-external-tools.sh --check-only` (readiness surface 확인).

## 2026-03-21 - Quality Metric Wiring & Null Coercion Fix (Retrieval Eval Fallback + resolveMetric)

- Why: auto-judge weekly quality gate가 영구 `pending`(source-only quality 샘플 0건) 상태였고, `null ?? '' → Number('') → 0` 버그로 데이터 없는 메트릭이 실제 값 0으로 전달되어 잘못된 pass/fail 판정이 발생했음. Retrieval eval 데이터(82건, recall@k=0.1026)가 존재함에도 quality gate에 연결되지 않았음.
- Scope: `scripts/auto-judge-from-weekly.mjs` — strategy_quality_normalization fallback 배선, `resolveMetric` 헬퍼 도입, per-action latency 진단 출력, `top_actions` select 추가.
- Impacted Routes: N/A (ops automation only)
- Impacted Services: `scripts/auto-judge-from-weekly.mjs`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` (`top_actions` column now selected; `baseline_summary.strategy_quality_normalization` consumed as quality fallback).
- Risk/Regression Notes: (1) Quality gate가 `pending` → `fail`로 전환될 수 있음 (retrieval recall이 threshold 미달 시). 이는 의도된 정직 신호. (2) Safety metrics가 서버 미연결 시 `0` → `null`(pending)로 변경됨 — 이전에는 null→0 변환 버그로 잘못 pass/fail 판정. (3) `hasRetrievalEvalFallback=true` 시 historical gate verdict override를 건너뛰고 gate 자연 평가 적용.
- Validation: `npm run -s lint`, `npx vitest run` (6/6), `npm run -s gates:validate` (35건), `npm run -s gates:fixtures:check`, `npm run -s gates:weekly-report:all:dry` (7단계 통과).

## 2026-03-21 - Weekly Auto-Judge Metric Mapping Fix (Self-Reference + Unit Mismatch)

- Why: weekly auto-judge가 go/no-go weekly 집계의 `no_go` 카운트를 `error_rate_pct`로, LLM delta를 절대 p95로 오용하여 실제 운영 상태와 무관한 no-go를 반복 생성했고, quality 입력이 자기 참조 루프(weekly:auto 산출물 → 다음 주 judge 입력)에 의해 0으로 고정되는 문제가 있었음.
- Scope: `scripts/auto-judge-from-weekly.mjs`의 reliability/quality 입력 매핑을 수정하고, `scripts/summarize-go-no-go-runs.mjs`에 source-only `auto_judge_signal_summary`를 추가해 weekly:auto 파생 run이 다음 주기 judge 입력을 오염하지 않게 했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-from-weekly.mjs`, `scripts/summarize-go-no-go-runs.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads/writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` `baseline_summary.auto_judge_signal_summary` added).
- Risk/Regression Notes: 기존 weekly auto-judge 결과에서 error_rate_pct 해석이 달라져 이전 run과 직접 비교 시 차이가 나타남. quality gate override 우선순위가 변경되어 insufficientSamples가 fail보다 앞선다.
- Validation: `npm run -s lint`, `npx vitest run src/services/runtimeSchedulerPolicyService.test.ts src/services/agentWorkerApprovalGateSnapshotService.test.ts`, `npm run -s gates:validate`, `npm run -s gates:fixtures:check`, `npm run -s gates:weekly-report:all:dry`.

## 2026-03-21 - Neutral Role Alias Compatibility Layer

- Why: 문서에서 정의한 neutral 내부 역할명으로 점진 전환할 수 있도록, legacy 이름을 즉시 제거하지 않고 런타임이 양쪽 이름을 모두 수용하게 만들기 위함.
- Scope: added neutral action aliases, neutral worker/env alias resolution, local worker script aliases, and runtime role normalization while preserving legacy action contracts.
- Impacted Routes: `GET /api/bot/agent/actions/catalog`, `POST /api/bot/agent/actions/execute`, `GET /api/bot/agent/runtime/role-workers`.
- Impacted Services: `src/services/skills/actions/types.ts`, `src/services/skills/actions/registry.ts`, `src/services/workerExecution.ts`, `src/services/skills/actionExecutionLogService.ts`, `src/routes/bot-agent/governanceRoutes.ts`, `src/services/agentRoleWorkerService.ts`, `src/services/skills/actions/mcpDelegate.ts`, `scripts/agent-role-worker.ts`, `scripts/check-agent-role-workers.mjs`, `scripts/validate-env.mjs`, `package.json`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: legacy names remain the canonical persisted/logged runtime roles for compatibility, while neutral aliases are accepted for action lookup, worker startup, and env resolution.
- Validation: `npm run lint`, targeted Vitest coverage for alias registration and env alias resolution.

## 2026-03-21 - Collaboration Boundary Documentation Realignment

- Why: 역할 이름, IDE 커스터마이징, 실제 런타임 액션, 향후 로컬 외부 도구 통합 설계가 서로 다른 층위인데도 문서상 한 덩어리처럼 읽히던 문제를 줄이기 위함.
- Scope: clarified customization-vs-runtime boundaries in architecture, operations, runbook, planning, env template, and `.github` collaboration files; added a dedicated planning document for future local external tool adapter architecture.
- Impacted Routes: N/A (documentation only).
- Impacted Services: `docs/ARCHITECTURE_INDEX.md`, `docs/OPERATIONS_24_7.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/planning/README.md`, `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`, `.github/instructions/multi-agent-routing.instructions.md`, `.github/agents/*.agent.md`, `.github/prompts/local-collab-*.prompt.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; intent is to reduce operator and developer confusion by making runtime truth depend on action registration, worker configuration, and runtime endpoints rather than role naming.
- Validation: editor diagnostics on touched markdown/customization files and consistency review against runtime action/worker surfaces.

## 2026-03-21 - Super Agent Facade Initial Slice

- Why: 계획된 슈퍼 에이전트 구현을 한 번에 전면 교체하지 않고, 기존 `multiAgentService` 위에 구조화된 목표 입력과 lead/consult 추천을 제공하는 안전한 facade로 시작하기 위함.
- Scope: added `superAgentService` with structured task recommendation and session start delegation, added admin API endpoints for capabilities/recommendation/session start, and documented the new facade in the architecture index.
- Impacted Routes: `GET /api/bot/agent/super/capabilities`, `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions`.
- Impacted Services: `src/services/superAgentService.ts`, `src/services/superAgentService.test.ts`, `src/routes/bot-agent/coreRoutes.ts`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: existing `startAgentSession` execution path remains the runtime owner; the new facade only normalizes structured input into a session goal and recommendation payload, so rollback is limited to removing the facade routes and service.
- Validation: targeted service tests and editor diagnostics for touched route/service/docs files.

## 2026-03-21 - Super Agent Contract Alignment

- Why: Phase 1 계획에 맞춰 supervisor 입력 계약을 `task_id`, `guild_id`, `objective`, `constraints`, `risk_level`, `acceptance_criteria`, `inputs`, `budget` 중심으로 고정하고, route/control-plane 출력과 runtime session 매핑을 분리하기 위함.
- Scope: `superAgentService` now normalizes snake_case supervisor envelopes, emits `task`, `route`, `runtime_mapping` 구조를 반환하며, super-agent routes prefer snake_case request payloads while keeping camelCase compatibility.
- Impacted Routes: `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions`.
- Impacted Services: `src/services/superAgentService.ts`, `src/services/superAgentService.test.ts`, `src/routes/bot-agent/coreRoutes.ts`.
- Impacted Docs: `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/ARCHITECTURE_INDEX.md`.
- Risk/Regression Notes: newly added super-agent endpoints changed response shape to expose contract-aligned `task`, `route`, `runtime_mapping`; existing stable agent session APIs are unchanged.
- Validation: focused Vitest coverage for snake_case/camelCase normalization and runtime delegation, plus diagnostics on touched files.

## 2026-03-21 - Local Collaborative Agent Control Plane Contracts

- Why: 로컬 IDE에서는 rigid sequential handoff보다 lead + consult 방식이 더 생산적이지만, 기존 runtime handoff 구조와 어긋나지 않도록 prompt/customization 계약을 스키마 수준으로 고정할 필요가 있었다.
- Scope: added local collaborative contract schemas, connected local-collab customization docs to runtime architecture docs, and clarified that local collaborative prompts are control-plane guidance over the existing multi-agent runtime.
- Impacted Routes: N/A (customization/docs only)
- Impacted Services: `.github/instructions/multi-agent-routing.instructions.md`, `.github/agents/local-orchestrator.agent.md`, `.github/prompts/local-collab-route.prompt.md`, `.github/prompts/local-collab-consult.prompt.md`, `.github/prompts/local-collab-synthesize.prompt.md`, `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`, `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`, `docs/planning/MULTI_AGENT_NODE_EXTRACTION_TARGET_STATE.md`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; the new schemas are intended to stabilize prompt outputs and future supervisor alignment without replacing existing `multiAgentService` or `ActionHandoff` contracts.
- Validation: customization file validation via editor diagnostics, schema/doc consistency review against `src/services/multiAgentService.ts`, `src/services/skills/actions/types.ts`, `src/services/workerExecution.ts`, and `src/services/skills/actionExecutionLogService.ts`.

## 2026-03-21 - MCP Indexing Server + Code Index Service

- Why: IDE에서 코드베이스 구조(심볼, 참조, 스코프)를 MCP 프로토콜로 노출하여, 에이전트가 코드 탐색과 분석을 정밀하게 수행할 수 있게 한다.
- Scope: 5 new files — `src/mcp/indexingServer.ts` (MCP stdio 서버, 106 lines), `src/mcp/indexingToolAdapter.ts` (도구 어댑터, 226 lines), `indexingToolAdapter.test.ts`, `src/services/codeIndexService.ts` (코드 인덱스 서비스, 1071 lines), `scripts/indexing-mcp-stdio.ts`
- Impacted Routes: N/A (MCP stdio transport, IDE 전용)
- Impacted Services: `codeIndexService.ts` (심볼 정의/참조 탐색, 파일 아웃라인, 스코프 읽기, 컨텍스트 번들), `indexingServer.ts` (MCP 프로토콜 라우팅), `indexingToolAdapter.ts` (도구 인터페이스 정규화)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: MCP stdio 서버는 IDE 연결 전용이며 런타임 프로세스에 영향 없음. 별도 프로세스로 실행.
- Validation: `indexingToolAdapter.test.ts` (228 lines).

## 2026-03-20 - Static Worker Endpoint Baseline and Cutover Runbooks

- Why: GCP worker를 실제 운영 경로로 붙인 뒤에도 IP 변동과 임시 도메인 의존으로 인한 drift를 줄이고, Render/도메인/원격 추론 분리 절차를 같은 기준으로 남기기 위함.
- Scope: reserved the current GCP worker IP as static, updated Render deployment env baseline to require the remote worker, corrected architecture-index provider docs, and added domain/inference split runbooks.
- Impacted Routes: N/A (deployment/docs/config only)
- Impacted Services: `render.yaml`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/GCP_OPENCODE_WORKER_VM_DEPLOY.md`, `docs/planning/GCP_REMOTE_INFERENCE_NODE.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: Render service now has an explicit remote worker dependency in the deployment definition; temporary `sslip.io` usage remains acceptable short-term but should be replaced by a custom domain before broader rollout.
- Validation: reserved static IP `34.56.232.61` in GCP, verified existing HTTPS worker health, and confirmed local hybrid dry-run remains passing before doc/config sync.

## 2026-03-20 - Local-First Hybrid Inference + Remote Autonomy Guardrails

- Why: 로컬 머신이 켜져 있을 때는 Ollama 우선 추론으로 품질/속도를 높이고, 운영 환경에서는 OpenJarvis unattended autonomy와 원격 worker fail-closed 정책을 동시에 유지하기 위함.
- Scope: added configurable LLM base provider order, introduced `local-first-hybrid` env profile, extended env validation for hybrid guardrails, and synchronized operator docs/runbook/env template.
- Impacted Routes: N/A (provider selection / ops profile / docs only)
- Impacted Services: `src/services/llmClient.ts`, `src/services/llmClient.test.ts`, `scripts/validate-env.mjs`, `scripts/apply-env-profile.mjs`, `config/env/local-first-hybrid.profile.env`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/ARCHITECTURE_INDEX.md`, `docs/planning/LOCAL_FIRST_HYBRID_AUTONOMY.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: local-first profile without remote fallback provider or without `MCP_OPENCODE_WORKER_URL` now fails validation earlier, preventing accidental local-only drift in unattended paths.
- Validation: `npm run -s lint`, `npx vitest run src/services/llmClient.test.ts`, `npm run -s env:profile:local-first-hybrid:dry`, `npm run -s env:check`.

## 2026-03-20 - GCP VM Worker Deployment Baseline

- Why: GCP VM를 이미 확보한 상태에서 `opencode.execute`를 로컬 PC 전원 상태와 분리해 운영하기 위한 최소 배포 아티팩트를 제공하기 위함.
- Scope: added worker Dockerfile, GCP VM env example, systemd unit example, and deployment runbook for the HTTP opencode worker.
- Impacted Routes: N/A (deployment artifacts only)
- Impacted Services: `Dockerfile.opencode-worker`, `config/env/opencode-worker.gcp.env.example`, `config/systemd/opencode-local-worker.service.example`, `docs/planning/GCP_OPENCODE_WORKER_VM_DEPLOY.md`, `docs/planning/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `package.json`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: worker remains fail-closed by URL contract; deployment still requires operator-managed firewall, TLS, and process supervision on GCP VM.
- Validation: `npm run -s lint`.

## 2026-03-20 - Canonical Document Hierarchy Confirmation

- Why: reduce planning drift by making document ownership explicit at the top of the canonical roadmap, execution board, backlog, runbook, operations, and architecture index.
- Scope: added document-role labels and canonical navigation order across planning and operations docs; confirmed control tower precedence language.
- Impacted Routes: N/A (documentation only)
- Impacted Services: `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/OPERATIONS_24_7.md`, `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `docs/planning/EXECUTION_BOARD.md`, `docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md`, `docs/planning/README.md`, `docs/planning/PLATFORM_CONTROL_TOWER.md`, `docs/ARCHITECTURE_INDEX.md`.
- Impacted Tables/RPC: N/A.
- Risk/Regression Notes: no runtime behavior change; intent is to remove ambiguity about where direction, status, task breakdown, and operating procedure live.
- Validation: manual hierarchy review against `docs/planning/PLATFORM_CONTROL_TOWER.md` and canonical references in the touched docs.

## 2026-03-19 - Weekly Governance Normalization (Legacy Pending Exclusion + Required-Action Completion + Quality Sample Guard)

- Why: no-go 원인 분석과 운영 후속조치 추적을 주간 스냅샷에 내장하고, sparse quality sample(0값)로 인한 weekly auto-judge 오판정을 줄이며, legacy pending no-go를 현재 운영 KPI에서 분리하기 위함.
- Scope: go/no-go 주간 집계 스크립트에 no-go root cause 및 required action completion 집계를 추가하고, legacy pending 보정 옵션 + normalized 별도 산출물을 도입했으며, weekly auto-judge에 최소 quality sample 가드와 quality fail 시 post-fallback 재판정 체인을 추가했다. 또한 self-improvement 주간 패턴 생성이 no-go root cause/후속조치 완료율 신호를 사용하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`, `docs/planning/ROADMAP_STATUS_2026-03-19.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` baseline summary fields expanded: `no_go_root_cause`, `required_action_completion`, `legacy_pending_*`).
- Risk/Regression Notes: normalized 모드(`excludeLegacyPendingNoGo`)를 활성화하면 요약 KPI가 raw 집계와 달라질 수 있으므로 cutoff를 명시해 운영자가 비교해야 한다.
- Validation: `npm run -s gates:weekly-report:dry`, `npm run -s gates:weekly-report:normalized:dry`, `npm run -s gates:weekly-report:supabase`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Remote-Only OpenJarvis Autonomy Baseline Enforcement

- Why: 로컬 의존 0 목표를 운영 기본값으로 고정하고, OpenJarvis unattended 루프가 원격 워커 미연결 상태에서 우회 실행되지 않도록 fail-closed를 강화하기 위함.
- Scope: unattended workflow env를 remote-only 필수값으로 확장하고, 런타임/런북/env 템플릿을 동일 정책으로 동기화했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `.github/workflows/openjarvis-unattended.yml`, `scripts/run-openjarvis-unattended.mjs`, `docs/RUNBOOK_MUEL_PLATFORM.md`, `docs/RENDER_AGENT_ENV_TEMPLATE.md`, `docs/planning/REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md`, `docs/planning/README.md`.
- Impacted Tables/RPC: `public.workflow_sessions`, `public.workflow_steps`, `public.workflow_events`, `public.agent_weekly_reports` (운영 검증 대상으로 명시).
- Risk/Regression Notes: GitHub Actions에서 신규 secret 미설정 시 unattended run이 실패하도록 변경되어 초기 설정 누락이 즉시 드러난다(의도된 fail-closed).
- Validation: `npm run -s openjarvis:autonomy:run:dry`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Stage Rollback Readiness Checklist Auto-Validation Gate

- Why: Later 단계(M-08)의 rollback runbook 자동 점검 체크리스트 운영화를 코드/CI 게이트로 강제해 리허설 증거의 신선도와 10분 목표 준수 여부를 자동 검증하기 위함.
- Scope: rollback rehearsal weekly summary를 읽어 freshness/fail count/p95 recovery SLA를 검증하는 스크립트를 추가하고 strict 체인/CI에 연결했다.
- Impacted Routes: N/A (ops automation/CI only)
- Impacted Services: `scripts/validate-stage-rollback-readiness.mjs`, `package.json`, `.github/workflows/main.yml`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (markdown artifact validation only)
- Risk/Regression Notes: 주간 리허설 요약이 오래되면 strict gate가 fail-closed로 차단되며, `allowZeroRuns` 플래그로 무증거 환경에서의 초기 도입 리스크를 완화한다.
- Validation: `npm run -s rehearsal:stage-rollback:validate:strict`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - M-05 Opencode Pilot Signals in Self-Improvement Weekly Report

- Why: approval_required 고정 파일럿이 운영 중 실제로 준수되는지 주간 루프에서 자동 점검하고, 승인 큐 적체를 패치 제안으로 연결하기 위함.
- Scope: self-improvement weekly 스크립트가 opencode.execute 실행 로그와 승인 요청 테이블을 집계해 pilot signal 섹션 및 관련 failure pattern을 생성하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_action_logs`, `public.agent_action_approval_requests` (or configured `ACTION_APPROVAL_TABLE`).
- Risk/Regression Notes: approval table 미존재 시 missing_table 상태로 degrade하여 리포트를 유지하고, 기존 weekly snapshot 필수 입력 계약은 변경하지 않는다.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s lint`.

## 2026-03-19 - M-07 Strategy Quality Normalization Metrics in Go/No-Go Weekly Snapshot

- Why: ToT/GoT + baseline 간 품질 추세를 주간 의사결정 스냅샷에서 직접 비교할 수 있도록 정규화 계측값을 영속화한다.
- Scope: go-no-go weekly summary 스크립트가 retrieval_eval_runs + answer quality reviews를 집계해 전략별 normalized quality score와 delta를 markdown/weekly payload에 추가한다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.retrieval_eval_runs`, `public.agent_answer_quality_reviews`; writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly`, `baseline_summary.strategy_quality_normalization`).
- Risk/Regression Notes: quality source table 미존재 시 missing_table/no_supabase_config 상태로 degrade하여 기존 주간 집계 fail-closed 계약을 깨지 않는다.
- Validation: `npm run -s gates:weekly-report:supabase:dry`, `npm run -s lint`.

## 2026-03-19 - M-07 Labeled Quality Weekly Signals in Self-Improvement Loop

- Why: Next 단계의 M-07 요구사항(라벨 기반 recall@k + hallucination review 자동 리포트)을 기존 주간 self-improvement 체인에 통합해 품질 회귀를 자동 탐지한다.
- Scope: self-improvement weekly 스크립트가 retrieval eval run summary와 human-labeled answer quality review를 읽어 Labeled Quality Signals 섹션과 신규 failure pattern을 생성하도록 확장했다.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.retrieval_eval_runs`, `public.agent_answer_quality_reviews`.
- Risk/Regression Notes: 품질 테이블 미구축 환경에서도 리포트가 중단되지 않도록 missing_table 상태로 degrade 하며, 기존 weekly snapshot 필수 입력(go/llm/hybrid)은 기존 fail-closed를 유지한다.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s lint`.

## 2026-03-19 - No-Request Missing-Action Proposal Queue + Opencode Approval-Required Pilot Lock

- Why: Close M-03/M-05 운영 공백을 줄이기 위해 요청 공백 구간에서도 누락 액션을 자동 제안 큐로 전환하고, Opencode executor를 approval_required로 고정해 safety gate를 강제한다.
- Scope: bot runtime에 background worker proposal sweep 루프와 opencode policy 자동 보정 로직을 추가했다.
- Impacted Routes: N/A (runtime automation only)
- Impacted Services: `src/bot.ts`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_action_logs`; uses worker approval store (`worker_approvals` or file fallback) to dedupe/cooldown/pending cap.
- Risk/Regression Notes: background sweep은 Supabase 미설정 시 자동 비활성화되며, 생성 품질가드(최근 generation success rate)와 중복/쿨다운 제한으로 과잉 제안을 차단한다.
- Validation: `npm run -s lint`.

## 2026-03-19 - Memory Queue SLO Alert Auto-Trigger (Incident/Comms Draft)

- Why: Close M-08 operational gap by automatically turning queue lag/retry/deadletter threshold breaches into actionable incident/comms evidence.
- Scope: extended memory queue weekly report script with SLO breach evaluation, severity/no-go candidate classification, and automatic alert artifact generation for incident/comms drafts.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=memory_queue_weekly` baseline now includes `slo_alert`).
- Risk/Regression Notes: alerts are artifact-level automation (no external paging side effects); dry-run keeps preview-only behavior.
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Provider Profile Auto-Fallback on Quality Gate Failure

- Why: Close remaining M-06/M-07 gap by making provider profile regression deterministic when weekly quality evidence degrades.
- Scope: extended go/no-go weekly summary with per-gate verdict counts, added quality override input and provider fallback decision fields in auto-judge, wired weekly auto-judge to trigger fallback when quality fails are present, and added stable-window dual profile hinting (`cost-optimized`) for M-06 operations.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads/writes `public.agent_weekly_reports` (`report_kind=go_no_go_weekly` `baseline_summary.gate_verdict_counts` used as weekly auto-judge signal).
- Risk/Regression Notes: quality override is applied only when weekly aggregation includes gate verdict evidence; weekly quality averages are derived from structured gate metrics and remain nullable when historical logs lack those fields.
- Validation: `npm run -s gates:weekly-report:supabase`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - Auto-Judge Checklist Auto-Close and Weekly Chain Integration

- Why: Remove remaining manual operator step after automated no-go decisions by auto-generating closure evidence and pre-closing post-decision checklist items.
- Scope: added auto checklist completion and optional closure document creation in auto-judge; weekly-derived auto-judge now enables these options by default; all-weekly pipeline now chains weekly auto-judge at tail.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (gate md/json artifact generation only for this change)
- Risk/Regression Notes: checklist auto-close applies only when enabled and skips pending decisions; generated closure files are date-scoped and reusable as evidence references.
- Validation: `npm run -s gates:auto-judge:weekly:pending`, `npm run -s gates:validate:strict`, `npm run -s lint`.

## 2026-03-19 - CI Strict Gate Enforcement + Weekly-Derived Auto-Judge Profiles

- Why: Reduce governance drift by enforcing strict checklist validation in CI and deriving gate decisions from weekly operational snapshots with stage-aware thresholds.
- Scope: enabled strict checklist gate in CI workflow, added weekly-derived auto-judge script and npm commands, and upgraded auto-judge with stage/profile presets plus rollback/memory deadletter signals.
- Impacted Routes: N/A (ops automation/CI/documentation only)
- Impacted Services: `.github/workflows/main.yml`, `scripts/auto-judge-go-no-go.mjs`, `scripts/auto-judge-from-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` for `go_no_go_weekly`, `llm_latency_weekly`, `rollback_rehearsal_weekly`, `memory_queue_weekly`.
- Risk/Regression Notes: weekly-derived auto-judge may produce fail when upstream weekly snapshots are stale; this is intended fail-closed behavior.
- Validation: `npm run -s gates:auto-judge:example`, `npm run -s gates:auto-judge:weekly:pending`, `npm run -s lint`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Memory Queue Weekly Snapshot Integration into Hybrid/Self-Improvement

- Why: Extend roadmap automation so queue/deadletter pressure directly influences weekly decision snapshots and patch proposal generation.
- Scope: expanded memory queue weekly report to support supabase sink (`memory_queue_weekly`), integrated rollback/memory signals into hybrid decision logic, and made self-improvement require/consume rollback+memory snapshots.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `scripts/generate-hybrid-weekly-report.mjs`, `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=memory_queue_weekly` read/write; hybrid and self-improvement read path expanded).
- Risk/Regression Notes: Self-improvement weekly now fails fast if rollback/memory snapshots are missing in the target window, with local markdown fallback used when Supabase snapshots are unavailable; rollback/memory writers can skip upsert when DB report_kind constraint is not yet migrated.
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s lint`, `npm run -s gates:validate`.

## 2026-03-19 - Go/No-Go Strict Checklist Validation Gate

- Why: Enforce R-008 operational discipline by preventing recent gate runs from passing with incomplete post-decision checklist items.
- Scope: extended go/no-go validator with optional checklist enforcement window and added strict npm command/docs.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/validate-go-no-go-runs.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: strict mode is opt-in; default validation behavior remains backward compatible for historical fixtures.
- Validation: `npm run -s gates:validate`, `npm run -s gates:validate:strict`.

## 2026-03-19 - Week2 Queue Deliverables Closure (Policy + Deadletter SOP + Observability)

- Why: Close remaining Week2 checklist artifacts by turning queue/deadletter operations into explicit policy docs and executable weekly observability reporting.
- Scope: added memory queue policy and deadletter SOP docs, added weekly queue observability report script, and wired npm commands/planning index/checklist.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/report-memory-queue-weekly.mjs`, `package.json`, `docs/planning/MEMORY_QUEUE_POLICY_V1.md`, `docs/planning/MEMORY_DEADLETTER_SOP_V1.md`, `docs/planning/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md`.
- Impacted Tables/RPC: reads `public.memory_jobs`, `public.memory_job_deadletters`.
- Risk/Regression Notes: reporting is read-only and fail-closed when Supabase credentials are missing (except dry-run preview).
- Validation: `npm run -s memory:queue:report:dry`, `npm run -s lint`, `npm run -s gates:validate`.

## 2026-03-19 - Stage Rollback Rehearsal Evidence Automation (R-017)

- Why: Close roadmap item R-017 by making rollback rehearsal results reproducible, persisted, and auditable with a 10-minute recovery target check.
- Scope: added rollback rehearsal recorder and weekly summary scripts; wired npm commands; synchronized runbook/gate docs and migration report_kind allowlist.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/run-stage-rollback-rehearsal.mjs`, `scripts/summarize-rollback-rehearsals.mjs`, `package.json`, `docs/planning/gate-runs/README.md`, `docs/RUNBOOK_MUEL_PLATFORM.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=rollback_rehearsal_weekly`).
- Risk/Regression Notes: Dry-run mode emits preview artifacts without calling runtime endpoints; real mode remains fail-closed on rehearsal failure.
- Validation: `npm run -s rehearsal:stage-rollback:record:dry`, `npm run -s gates:weekly-report:rollback:dry`, `npm run -s lint`.

## 2026-03-19 - Go/No-Go Gate Auto-Judge Rule Implementation

- Why: Close roadmap item R-016 by replacing manual-only stage decision interpretation with a reproducible threshold-based auto-judge flow.
- Scope: added `scripts/auto-judge-go-no-go.mjs`, npm commands (`gates:auto-judge`, `gates:auto-judge:example`), and gate-runs README usage docs.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/auto-judge-go-no-go.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: N/A (writes gate markdown/json logs under docs planning artifacts).
- Risk/Regression Notes: Missing metric inputs default to fail (or pending with allowPending) to avoid false-positive go decisions.
- Validation: `npm run -s gates:auto-judge:example`, `npm run -s gates:validate`.

## 2026-03-19 - Self-Improvement Loop v1 Automation (Failure Pattern -> Patch Proposal)

- Why: Operationalize roadmap item M-05 by converting weekly failures into executable patch proposals with explicit regression checks.
- Scope: added `scripts/generate-self-improvement-weekly.mjs`, new npm commands (`gates:weekly-report:self-improvement`, `gates:weekly-report:self-improvement:dry`), and expanded `gates:weekly-report:all` to include self-improvement generation.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-self-improvement-weekly.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: reads `public.agent_weekly_reports` snapshots (`go_no_go_weekly`, `llm_latency_weekly`, `hybrid_weekly`) as source signals.
- Risk/Regression Notes: script fails fast if any source snapshot is missing in the target window to avoid partial/low-confidence proposals.
- Validation: `npm run -s gates:weekly-report:self-improvement:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Hybrid Weekly Snapshot Automation (go/no-go + latency)

- Why: Consolidate weekly gate and latency outcomes into one decision artifact for roadmap governance and faster operator triage.
- Scope: added `scripts/generate-hybrid-weekly-report.mjs`, npm commands (`gates:weekly-report:hybrid`, `gates:weekly-report:hybrid:dry`), and promoted `gates:weekly-report:all` to include hybrid snapshot generation.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/generate-hybrid-weekly-report.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (`report_kind=hybrid_weekly`).
- Risk/Regression Notes: Hybrid report requires both `go_no_go_weekly` and `llm_latency_weekly` source snapshots in the same window; if missing, script fails fast to prevent partial governance evidence.
- Validation: `npm run -s gates:weekly-report:hybrid:dry`, `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Go/No-Go Weekly Report Supabase Sink Integration

- Why: Persist governance weekly decision snapshots into Supabase so roadmap/gate evidence can be queried and audited from a single storage plane.
- Scope: extended `scripts/summarize-go-no-go-runs.mjs` with sink routing (`markdown|supabase|stdout`), optional Supabase upsert to `public.agent_weekly_reports`, and added npm shortcuts/docs for supabase and dry-run paths.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (upsert, `report_kind=go_no_go_weekly`).
- Risk/Regression Notes: Default behavior remains markdown output; supabase sink is opt-in and fail-safe when table missing under allow-missing mode.
- Validation: `npm run -s gates:weekly-report:dry`, `npm run -s gates:weekly-report:supabase:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Weekly Report All-Pipeline Default Promotion

- Why: Make roadmap governance snapshots durable by default in weekly automation, not markdown-only best effort.
- Scope: promoted `gates:weekly-report:all` to execute `gates:weekly-report:supabase` before LLM latency weekly sink run; updated runbook snippet in gate-runs README.
- Impacted Routes: N/A (ops automation/documentation only)
- Impacted Services: `package.json`, `docs/planning/gate-runs/README.md`.
- Impacted Tables/RPC: `public.agent_weekly_reports` (default weekly write path includes `go_no_go_weekly` + `llm_latency_weekly`).
- Risk/Regression Notes: Existing dry-run behavior preserved; if table is missing, go/no-go sink follows allow-missing mode and logs explicit skip reason.
- Validation: `npm run -s gates:weekly-report:all:dry`, `npm run -s gates:validate`.

## 2026-03-19 - Opencode/NemoClaw/OpenDev Execution Plan Integration

- Why: Align newly expanded execution-board milestones with an explicit 3-layer delivery plan and ownership model.
- Scope: added `docs/planning/OPENCODE_NEMOCLAW_OPENDEV_EXECUTION_PLAN.md`, synchronized planning index, and reflected milestone-level additions in execution board.
- Impacted Routes: N/A (planning/governance documentation only)
- Impacted Services: N/A (no runtime code-path changes)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime regression; planning clarity improved for M-04/M-05/M-06 scope ownership.
- Validation: `npm run -s gates:validate`, `npm run -s gates:weekly-report -- --days=7`.

## 2026-03-19 - Go/No-Go Weekly Summary Refresh and Stage Evidence Consolidation

- Why: Keep governance reporting in sync with newly accumulated stage evidence and prevent stale operational decisions.
- Scope: regenerated `docs/planning/gate-runs/WEEKLY_SUMMARY.md` to include recent A-stage and trading-isolation runs.
- Impacted Routes: N/A (ops reporting artifact only)
- Impacted Services: `scripts/summarize-go-no-go-runs.mjs`, `scripts/validate-go-no-go-runs.mjs` (execution output sync)
- Impacted Tables/RPC: N/A
- Risk/Regression Notes: No runtime behavior changes; operator decision context now reflects latest gate outcomes.
- Validation: `npm run -s gates:weekly-report -- --days=7`, `npm run -s gates:validate`.

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

## 2026-03-18 - GoT/LangGraph 실행 엔진 + Task Routing + SLO 모니터링 + Community Graph

- Why: (1) Graph-of-Thought 추론 전략을 LangGraph-style 상태 그래프 노드로 구조화. (2) 태스크를 기술/연산/창작/검색 경로로 자동 라우팅. (3) 에이전트 SLO(응답 시간, 품질) 실시간 추적. (4) Discord 상호작용 기반 커뮤니티 소셜 그래프 구축. (5) OpenCode GitHub 큐 + publish worker 추가.
- Scope: 30+ new files — `src/services/agent/agentGot{PolicyService,CutoverService,Store,AnalyticsService}.ts`, `agentSloService.ts`, `agentTelemetryQueue.ts`, `agentQualityReviewService.ts`, `src/services/opencode/{opcodeGitHubQueueService,opcodeOpsService,opencodePublishWorker}.ts`, `taskRoutingService.ts`, `taskRoutingAnalyticsService.ts`, `taskRoutingMetricsService.ts`, `toolLearningService.ts`, `communityGraphService.ts`, `conversationTurnService.ts`, `llmExperimentAnalyticsService.ts`, `semanticAnswerCacheService.ts`, `efficiencyOptimizationService.ts`, `platformLightweightingService.ts`, `runtimeSchedulerPolicyService.ts`, `supabaseExtensionOpsService.ts`, `userPersonaService.ts`, `langgraph/nodes/{coreNodes,runtimeNodes,composeNodes}.ts` + tests
- Impacted Routes: `/api/bot/agent/*` (GoT/SLO/telemetry endpoints), `/api/bot/status` (확장)
- Impacted Services: `multiAgentService.ts` (GoT policy gating, cutover logic), `agentMemoryService.ts` (hybrid search), `obsidianRagService.ts` (graph-first 통합), `llmClient.ts` (실험 분석 연동)
- Impacted Tables/RPC: `agent_got_shadow_runs`, `agent_slo_metrics`, `agent_telemetry_queue`, `task_routing_decisions`, `community_interactions` (schema additions)
- Risk/Regression Notes: GoT는 `AGENT_GOT_ENABLED=false` 기본값. Task routing은 기존 단일경로 폴백 유지. SLO alert는 임계값 미도달 시 비활성.
- Validation: `npx tsc --noEmit`, `npx vitest run`.

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

## 2026-03-14 - Obsidian Headless RAG System Phase 1 + Worker Generation Pipeline

- Why: (1) 전통적 벡터 DB 한계를 넘어 Obsidian 그래프 구조를 활용한 컨텍스트 보존 RAG 시스템을 구축한다. (2) 에이전트가 누락된 능력을 자체 생성할 수 있는 동적 워커 생성 파이프라인을 도입한다.
- Scope: 10+ new files — `src/services/obsidianHeadlessService.ts` (CLI 기반 vault 검색/읽기, 폴백 직접 파일 I/O, 메타데이터 추출), `obsidianCacheService.ts` (Supabase 백드 캐싱/TTL/히트 추적), `obsidianRagService.ts` (인텐트 기반 문서 라우팅), `obsidianRagService.test.ts`, `src/services/workerGeneration/workerGenerationPipeline.ts` (worker 코드 생성 파이프라인), `dynamicWorkerRegistry.ts` (생성된 worker 등록/캐시), `workerApprovalStore.ts` (승인 게이트), `workerSandbox.ts` (샌드박스 검증)
- Impacted Routes: `/api/bot/agent/*` (docs command RAG 연동)
- Impacted Services: `obsidianHeadlessService.ts` (CLI vault 접근), `obsidianCacheService.ts` (캐시 관리), `obsidianRagService.ts` (인텐트→문서 라우팅), `workerGenerationPipeline.ts` (LLM 코드 생성 → 승인 → 등록), `dynamicWorkerRegistry.ts` (부팅 시 승인된 worker 복원), `workerApprovalStore.ts` (file + Supabase 듀얼 모드), `workerSandbox.ts` (격리 실행 검증)
- Impacted Tables/RPC: `guild_lore_docs` (cache read/write), `worker_approvals` (new table)
- Risk/Regression Notes: Obsidian CLI 미설치 시 직접 파일 I/O 폴백. Worker generation은 승인 게이트 통과 필수. 샌드박스 검증 실패 시 등록 차단.
- Validation: `npx tsc --noEmit`, `npx vitest run` (76 tests).

## 2026-03-14 - Ops Observability: Dynamic Worker Hardening + Policy UX + News Dedup

- Why: (1) actionRunner에 fail-closed 거버넌스와 트렌드/Top-N 장애 코드 진단을 추가. (2) workerApprovalStore에 파일/Supabase 듀얼 모드 + 진단 스냅샷. (3) 뉴스 캡처 시맨틱 중복 제거. (4) 봇-에이전트 세션의 정책 차단 진단과 worker 제안 UX 개선.
- Scope: 15+ files — `actionRunner.ts` (fail-closed, diagnostics, trend), `workerApprovalStore.ts` (dual mode), `dynamicWorkerRegistry.ts` (boot restore, cache-busting), `workerProposalMetrics.ts` (funnel metrics), `newsCaptureDedupService.ts` (new), `userLearningPrefsService.ts` (new), `webSearch.ts` (new), `newsVerify.ts` (new), `discord/messages.ts` (catalog)
- Impacted Routes: `/api/bot/status` (worker proposal metrics + action diagnostics 포함)
- Impacted Services: `actionRunner.ts`, `workerApprovalStore.ts`, `dynamicWorkerRegistry.ts`, `workerProposalMetrics.ts`, `newsCaptureDedupService.ts`, `userLearningPrefsService.ts`
- Impacted Tables/RPC: `worker_approvals` (RLS, index, trigger), `MIGRATION_DEDUPE_LEARNING.sql` (뉴스 핑거프린트 스키마)
- Risk/Regression Notes: 거버넌스 기본값이 fail-closed로 변경. `ACTION_GOVERNANCE_DEFAULT_MODE` env로 통제 가능.
- Validation: `npx tsc --noEmit`, `npx vitest run` (76 tests, 9 modules).
