# Architecture Index

## Role Naming

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

## Purpose

This document is the external analysis entrypoint for the backend repository.
It provides a stable map of runtime flow, domain boundaries, and data boundaries.

Shared team entry rule:

- `docs/TEAM_SHARED_OBSIDIAN_START_HERE.md` is the first shared knowledge entrypoint when onboarding or when local tool ownership is unclear.
- Team collaboration must remain usable without local OpenJarvis or Hermes Agent installs.
- References to OpenJarvis or Hermes in this repository often describe optional local continuity or acceleration lanes unless a runtime surface is explicitly marked as shared and deployed.
- Shared Obsidian is the first human and agent collaboration surface; local personal stacks are overlays, not the team default.

Control-plane ownership rule:

- shared Obsidian is the semantic cockpit: human-visible operations control, durable context, wiki, decision history, and graph-first navigation
- Supabase is the operational substrate: sessions, events, policy enforcement, cron, vector and hybrid retrieval, extension ops, structured analytics, and runtime diagnostics
- Multica is the visible coordination control plane for local multi-agent work: issue routing, lane assignment, and operator-facing progress live there, but semantic and hot-state ownership do not
- n8n and other explicit workflow routers are the deterministic workflow kernel layered on top of Supabase hot state: they own waits, retries, branching, and wake-up mechanics when an API-first path exists
- GitHub is the artifact, review, and settlement plane for code, docs, CI evidence, and merge history; it does not become the runtime brain just because workflows or generated artifacts live there
- OpenJarvis, Hermes, OpenClaw, and similar runtimes are pluggable worker or continuity lanes selected by task shape and cost, not by system-of-record ownership
- the design goal is not "Obsidian instead of Supabase" but "Obsidian explains and controls; Supabase executes and measures"
- future Supabase capability growth should happen by expanding the operational substrate, not by pushing semantic ownership out of Obsidian
- ACP, VS Code chat launch, continuity packets, and other transport surfaces do not become state owners by themselves; mutable workflow truth stays in Supabase, while durable semantic packet mirrors and distillates live in Obsidian.

## Multi-Plane Operating Model

- Multica is the visible coordination control plane for bounded local multi-agent work.
- Shared Obsidian remains the semantic owner for durable notes, decisions, retros, operator context, and graph-first knowledge navigation.
- Supabase plus explicit workflow routers such as n8n remain the hot-state and workflow kernel for sessions, events, waits, retries, cron, policy enforcement, and route telemetry.
- GitHub remains the artifact, review, and settlement plane for code changes, documentation PRs, CI evidence, and merge history.
- OpenJarvis, Hermes, OpenClaw, Claude, and similar surfaces are pluggable worker lanes selected by determinism, cost, and task shape rather than by ownership.
- `implement.execute` plus the local workstation executor remain the hands layer for explicit machine actuation, diagnostics, browser or desktop control, and repo mutation.
- OpenJarvis memory and similar stores should be treated as ingestion or retrieval projections over authoritative sources, not as primary owners of Obsidian, Supabase, or GitHub content.

## Multi-Plane Adoption Order

1. Reconfirm runtime truth before changing ownership assumptions. Treat `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, this file, `docs/adr/ADR-008-multi-plane-operating-model.md`, and `config/runtime/operating-baseline.json` as the gate for runtime claims.
2. Codify plane ownership in canonical docs before changing runtime wiring. Keep Multica as coordination only, shared Obsidian as semantic owner, Supabase plus n8n as the workflow kernel, GitHub as artifact plane, and worker runtimes as interchangeable lanes.
3. Keep deterministic orchestration in the workflow kernel first. Use API-first or n8n paths for waits, retries, and branching before paying for agent reasoning.
4. Expose OpenJarvis, Hermes, OpenClaw, and similar surfaces as pluggable workers behind stable contracts instead of treating any one of them as the permanent control owner.
5. Promote durable meaning to shared Obsidian and keep repo-visible mirrors plus changelog entries aligned as compatibility surfaces.

## Local Quality Acceleration Path

- The local-first quality loop is allowed to use shared Obsidian and Supabase as authoritative inputs, but only through projection into OpenJarvis memory.
- The canonical path is: shared Obsidian plus weekly Supabase reports -> `openjarvis:memory:sync` -> local OpenJarvis memory index -> local Ollama-backed `jarvis optimize run` -> weekly gate artifacts.
- Local optimize runs should be provider-aware and explicit. In this repository that means using a tracked optimize config with local Ollama for the optimizer, judge, and trial backend instead of silently falling back to cloud-only judge defaults.
- This acceleration path improves local evaluation and tuning without changing the always-on ownership contract. Obsidian remains semantic owner, Supabase remains operational owner, and OpenJarvis remains the control surface over those sources.
- Operating baseline can acknowledge this loop as a local acceleration check, but it must not be mistaken for always-on production readiness.

## Obsidian Digital Twin Operating Slice

- `docs/planning/OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` defines the write-side boundary for arbitrary document ingestion and durable knowledge formation.
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` defines the minimum note families, frontmatter, and upsert rules needed to keep the vault machine-usable.
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md` provides the concrete note skeletons that operationalize the schema.
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_INGEST_WORKFLOW.md` defines the first safe source-to-canonical ingest loop.
- `docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` defines the smallest safe hands-layer rollout for Hermes before wider autonomy or OpenJarvis projection is expanded.
- `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md` defines the ongoing cross-session contract once Hermes is already live locally and GPT reasoning remains bounded in time.
- `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md` defines the target state where GPT and Hermes share a structured hot-state plane, n8n is orchestration glue, and Obsidian remains the semantic owner instead of the hot-path bus.

## Local GPT-Hermes Continuity Overlay

- This overlay is for local knowledge-work operation, not for replacing repository runtime truth.
- GPT-5.4 is the primary high-reasoning brain during bounded sessions.
- Hermes plus Ollama is the persistent local continuity and execution layer between those sessions.
- Obsidian remains the semantic owner that both layers write toward.
- The concrete handoff packet, progress snapshot, and recall boundary live in `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`.
- The future target where Hermes becomes a first-class second assistant over a structured Supabase or n8n hot-state plane lives in `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md`.

## API-First And Agent-Fallback Hybrid Slice

- Default automation stance: start from deterministic API or DB handling, not from agent reasoning.
- Canonical router surface: n8n or another explicit workflow router owns webhook, schedule, wait, retry, and IF or Switch branching.
- Canonical fallback surface: shared MCP and Hermes only activate after the API path misses, returns low confidence, or needs non-deterministic reasoning.
- Canonical hot-state plane: Supabase workflow sessions and workflow events keep the route outcome, recall boundary, artifact refs, and runtime lane.
- Canonical semantic owner: Obsidian receives durable distillates after execution settles; it does not need to carry every wake-up or retry heartbeat.

Provider-wrapping rule:

- local or repo-owned wrappers should expose stable provider capabilities as `ext.<adapterId>.<capability>`
- shared or remote wrappers should expose shared capabilities as `upstream.<namespace>.<tool>`
- provider-native auth, versioning, and monitoring stay in the underlying API or CLI layer rather than leaking into prompt logic
- bounded local computer-use on the operator machine should prefer `ext.workstation.*` over ad hoc shell glue so command, browser, input, screenshot, and workspace file actions stay observable

Operator diagnostic surface:

- `automation.capability.catalog` summarizes which API-first, MCP wrapping, Hermes fallback, and remote execution surfaces are currently wired
- `automation.route.preview` computes the recommended path for a candidate workflow before implementation or n8n graph changes

Current concrete handoff example:

- the reverse-engineered YouTube community post workflow is already a live example of the new contract
- deterministic first path: n8n or local worker scrapes the community page and returns structured JSON even without an official API
- explicit fallback: when the page shape drifts, Hermes or shared MCP is used for diagnosis and repair rather than silently mixing that work back into the cheap deterministic path

Observability stance:

- OpenJarvis covers telemetry, eval, bench, optimize, memory search, and scheduler visibility well enough to act as an observability adjunct
- it is not yet the sole observer for end-to-end hybrid automation
- Supabase hot-state remains the canonical route-event ledger, n8n remains the workflow-router execution log, and Obsidian remains the durable semantic audit surface

Document Role:

- Canonical for repository runtime structure and service/data boundary map.
- Use this index to locate code surfaces before changing routes, runtime ownership, or persistence boundaries.
- Directional priority still comes from [docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md](docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md).

Primary operations entrypoint:

- `docs/TEAM_SHARED_OBSIDIAN_START_HERE.md` (team-shared onboarding and Obsidian-first collaboration entrypoint)
- `docs/RUNBOOK_MUEL_PLATFORM.md` (unified DevOps/SRE runbook)
- `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` (social mapping + autonomous ops canonical roadmap)
- `docs/planning/EXECUTION_BOARD.md` (milestone-bound now/next/later execution board)
- `docs/OPERATOR_SOP_DECISION_TABLE.md` (who/when/threshold/action decision matrix)
- `docs/HARNESS_ENGINEERING_PLAYBOOK.md` (model runtime harness design)
- `docs/HARNESS_RELEASE_GATES.md` (go/no-go gates for harness quality)
- `docs/ONCALL_INCIDENT_TEMPLATE.md` (incident timeline template)
- `docs/ONCALL_COMMS_PLAYBOOK.md` (incident communications)
- `docs/POSTMORTEM_TEMPLATE.md` (post-incident review)
- `docs/planning/MULTI_AGENT_NODE_EXTRACTION_TARGET_STATE.md` (multiAgentService core split target state)
- `docs/planning/mcp/MCP_TOOL_SPEC.md` (MCP tool contract)
- `docs/planning/mcp/MCP_ROLLOUT_1W.md` (MCP rollout plan)
- `docs/planning/mcp/LIGHTWORKER_SPLIT_ARCH.md` (core-worker split)
- `docs/planning/OBSIDIAN_OPERATING_SYSTEM_BLUEPRINT.md` (vault-first operating system target state)
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_CONSTITUTION.md` (write-side constitution for the digital twin vault)
- `docs/planning/OBSIDIAN_OBJECT_MODEL.md` (canonical vault object families)
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_SCHEMA.md` (minimum note metadata and upsert contract for durable vault writes)
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_NOTE_TEMPLATES.md` (concrete note skeletons for source, digest, canonical, workspace, and decision notes)
- `docs/planning/OBSIDIAN_TRANSITION_PLAN.md` (migration from current mixed control plane)
- `docs/planning/OBSIDIAN_DIGITAL_TWIN_INGEST_WORKFLOW.md` (repeatable source-to-canonical ingest loop for arbitrary material)
- `docs/planning/MANAGED_AGENTS_FOUR_LAYER_MODEL.md` (brain, hands, session, semantic owner overlay across Render, GCP, Supabase, and shared Obsidian)
- `docs/planning/HERMES_OBSIDIAN_MINIMUM_BOOTSTRAP.md` (minimum local hands-layer bootstrap for vault-first work)
- `docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md` (bounded GPT reasoning plus persistent Hermes continuity contract for local operator work)
- `docs/planning/GPT_HERMES_DUAL_AGENT_LOCAL_ORCHESTRATION_PLAN.md` (target local orchestration model where Hermes becomes a first-class second assistant over shared hot-state workstreams)
- `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md` (Multica workspace issue topology, agent role cards, and visible local control-plane rules)
- `docs/planning/LANGGRAPHJS_AGENTGRAPH_MIGRATION_PLAN.md` (current agentGraph naming correction + actual LangGraph.js migration plan)
- `docs/archive/LANGGRAPH_STATEGRAPH_BLUEPRINT.md` (historical LangGraph migration-ready state graph blueprint)
- `docs/archive/GOT_LANGGRAPH_EXECUTION_PLAN.md` (historical GoT reasoning + LangGraph execution rollout plan)
- `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md` (local IDE lead+consult agent workflow)

## Runtime Entrypoints

- `server.ts`: HTTP API process bootstrap.
- `bot.ts`: Discord bot-only process bootstrap.
- `src/app.ts`: Express middleware and route composition.
- `src/bot.ts`: Discord command/event runtime and bot orchestration.

## Domain Boundary Contracts

Cross-domain data flow rules that enforce transformation correctness at service boundaries:

- `docs/contracts/DISCORD_TO_MEMORY.md` — channel metadata, tag format, thread context
- `docs/contracts/MEMORY_TO_OBSIDIAN.md` — sanitization gate, frontmatter, adapter routing
- `docs/contracts/OBSIDIAN_READ_LOOP.md` — graph-first retrieval strategy
- `docs/contracts/DISCORD_SOCIAL_GRAPH.md` — community graph, private thread exclusion
- `docs/contracts/SPRINT_DATA_FLOW.md` — phase transitions, action scoping, retro writes

Context isolation map: `docs/CONTEXT_ISOLATION.md`

## Runtime Details

- `src/routes/bot.ts` + `src/routes/botAgentRoutes.ts`: bot control-plane routes split into core and agent composition boundary.
- `src/routes/bot-agent/*.ts`: agent domain routes (`core`, `runtime`, `got`, `qualityPrivacy`, `governance`, `tools`, `memory`, `learning`) registered by composer.
- `src/services/runtimeBootstrap.ts`: centralized startup boundaries for server process runtime and Discord-ready runtime.
- `src/services/superAgentService.ts`: structured super-agent facade that normalizes a supervisor task envelope, emits schema-aligned route output, and delegates execution to the existing session runtime.
- `src/services/entityNervousSystem.ts`: feedback-circuit integrator that connects session completion, reward trend, and sprint retro outputs back into long-term memory, behavior adjustment, and self-notes.

## Local IDE Collaboration Surface

This repository now defines a customization-level local collaboration surface for IDE work:

- `.github/agents/local-orchestrator.agent.md`
- `.github/prompts/local-collab-route.prompt.md`
- `.github/prompts/local-collab-consult.prompt.md`
- `.github/prompts/local-collab-synthesize.prompt.md`
- `.github/instructions/multi-agent-routing.instructions.md`

Role of this surface:

- choose a lead agent for local IDE work
- attach targeted consult agents without forcing a full delivery pipeline
- standardize `lead_agent`, `consult_agents`, `required_gates`, `handoff`, `escalation`, `next_action`

> This layer is control-plane guidance for local development, not a replacement for `src/services/multiAgentService.ts`.

## Customization vs Runtime Boundary

The repository currently uses the same role names across two different layers:

- customization/control-plane: `.github/agents/*`, `.github/prompts/local-collab-*.prompt.md`, `.github/instructions/multi-agent-routing.instructions.md`
- runtime execution: `src/services/superAgentService.ts`, `src/services/skills/actions/agentCollab.ts`, `src/services/skills/actions/registry.ts`, `src/services/skills/actionRunner.ts`, advisory role workers

Interpretation rule:

- role names such as Implement, Architect, Review, Operate, and Coordinate (and their legacy aliases OpenCode, OpenDev, NemoClaw, OpenJarvis, Local Orchestrator) are repository-local collaboration roles
- they do not by themselves prove that an upstream open-source system is installed, embedded, or directly executed by this repository
- runtime-backed behavior exists only where a registered action, worker URL, or HTTP/MCP transport is present in code and environment

Current runtime-backed collaboration surfaces:

- `coordinate.route` (legacy: `local.orchestrator.route`)
- `coordinate.all` (legacy: `local.orchestrator.all`)
- `architect.plan` (legacy: `opendev.plan`)
- `review.review` (legacy: `nemoclaw.review`)
- `operate.ops` (legacy: `openjarvis.ops`)
- `implement.execute` (legacy: `opencode.execute`)
- `tools.run.cli`

Current local tool/runtime facts:

- local Ollama provider usage is supported in `src/services/llmClient.ts`
- HTTP/MCP-style delegated workers are supported via `src/services/mcpWorkerClient.ts` and `scripts/agent-role-worker.ts`
- a first narrow local CLI tool slice exists via `src/services/tools/*` and `GET /api/bot/agent/tools/status`
- general-purpose discovery and wrapping of arbitrary local OSS CLIs/servers is not yet a first-class runtime layer in this repository

Planning note:

- keep collaboration-role documents focused on routing and handoff contracts
- keep runtime and operator truth in service code plus runtime status endpoints
- track future local external tool integration separately in `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`
- use `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` when a role name could be confused with an external OSS/runtime/model name

## Runtime Loop Inventory (Current Code)

Canonical runtime loop snapshot:

- `src/services/runtime/runtimeSchedulerPolicyService.ts` (`getRuntimeSchedulerPolicySnapshot`)
- Operator API surface: `GET /api/bot/agent/runtime/scheduler-policy`

Startup phase `server-process` (via `startServerProcessRuntime` → `bootstrapServerInfrastructure`):

- `automation-jobs` (`src/services/automationBot.ts`)
- `memory-job-runner` (`src/services/memory/memoryJobRunner.ts`)
- `consolidation-loop` (`src/services/memory/memoryConsolidationService.ts`) — pg_cron 대체 가능
- `user-embedding-loop` (`src/services/memory/userEmbeddingService.ts`) — pg_cron 대체 가능
- `opencode-publish-worker` (`src/services/opencode/opencodePublishWorker.ts`)
- `runtime-alerts` (`src/services/runtime/runtimeAlertService.ts`)
- `bot-auto-recovery` (`src/services/runtime/botAutoRecoveryService.ts`)
- `sprint-pipeline-rehydration` (`src/services/sprint/sprintOrchestrator.ts`)
- `session-rehydration` (`src/services/multiAgentService.ts`)
- `event-sourcing-rehydration` (`src/services/sprint/eventSourcing/bridge.ts`)
- `sprint-scheduled-triggers` (`src/services/sprint/sprintTriggers.ts`)
- `mcp-skill-router` (`src/services/mcpSkillRouter.ts`)
- `sandbox-policy-sync` (`src/services/skills/actionRunner.ts`) — startup + 6h re-sync
- `adapter-auto-loader` (`src/services/tools/adapterAutoLoader.ts`) — M-15 동적 어댑터
- `signal-bus-consumers` (`src/services/runtime/signalBusWiring.ts`)
- `trust-decay-timer` (`src/services/sprint/trustScoreService.ts`) — Phase H, pg_cron 대체 가능
- `observer-loop` (`src/services/observer/observerOrchestrator.ts`) — Phase F, pg_cron 대체 가능
- `intent-formation` (`src/services/intent/intentFormationEngine.ts`) — Phase G

Startup phase `discord-ready` (via `startDiscordReadyRuntime` → `bootstrapDiscordLoops`):

- `automation-modules` (`src/services/automationBot.ts`)
- `agent-daily-learning` (`src/services/agent/agentOpsService.ts`)
- `got-cutover-autopilot` (`src/services/agent/agentOpsService.ts`)
- `login-session-cleanup` when owner=`app` (`src/discord/auth.ts`) — pg_cron 대체 가능
- `obsidian-sync-loop` (`src/services/obsidian/obsidianLoreSyncService.ts`) — pg_cron 대체 가능
- `retrieval-eval-loop` (`src/services/eval/retrievalEvalLoopService.ts`) — pg_cron 대체 가능
- `reward-signal-loop` (`src/services/eval/rewardSignalLoopService.ts`) — pg_cron 대체 가능
- `eval-auto-promote-loop` (`src/services/eval/evalAutoPromoteLoopService.ts`) — pg_cron 대체 가능
- `agent-slo-alert-loop` (`src/services/agent/agentSloService.ts`) — pg_cron 대체 가능
- `guild-topology-sync` (`src/services/discord-support/discordTopologySyncService.ts`)

Startup phase `database` (pg_cron):

- `supabase-maintenance-cron` (`src/services/infra/pgCronBootstrapService.ts`)
- `login-session-cleanup` when owner=`db` (`src/discord/auth.ts` + pg_cron)
- `muel_rate_limit_cleanup` (hourly)
- `muel_observation_cleanup` (daily)
- `muel_intent_eval` (10min)

Terminology rule:

- `startup` is when loop starts (`service-init`, `discord-ready`, `database`).
- `owner` is execution owner (`app`, `db`).
- During incident triage, compare both fields; owner mismatch and startup mismatch are different failure classes.

## LLM Provider Resolution Rules (Code-Aligned)

Canonical source:

- `src/services/llmClient.ts`

Hugging Face token alias order:

1. `HF_TOKEN`
2. `HF_API_KEY`
3. `HUGGINGFACE_API_KEY`

Provider alias normalization:

- `hf` -> `huggingface`
- `claude` -> `anthropic`
- `local` -> `ollama`

Base provider resolution (when request provider is omitted):

1. `AI_PROVIDER` preferred value if configured
2. `LLM_PROVIDER_BASE_ORDER` if configured
3. default fallback priority: `openjarvis` -> `litellm` -> `ollama`
4. compatibility escape hatch when the canonical lane is unavailable: `anthropic` -> `openai` -> `gemini` -> `kimi` -> `huggingface` -> `openclaw`

Fallback chain composition:

1. selected provider
2. action policy matches (`LLM_PROVIDER_POLICY_ACTIONS`)
3. workflow model binding/profile defaults (`LLM_WORKFLOW_MODEL_BINDINGS`, `LLM_WORKFLOW_PROFILE_DEFAULTS`) for action-scoped provider/model and quality posture
4. `LLM_PROVIDER_FALLBACK_CHAIN`
5. base resolver provider
6. `LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER` or default automatic order (`openjarvis`, `litellm`, `ollama`) when `LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=true`
7. capability-aware reorder derived from `actionName` (chat/code/memory/review/ops). The canonical lane stays `openjarvis -> litellm -> ollama`; direct cloud providers, Hugging Face, and OpenClaw only appear when a profile or policy explicitly introduces them.
8. runtime readiness pruning for probeable local providers (`ollama`, `litellm`, `openjarvis`) before live call attempts

Guardrails:

- keep only configured providers
- dedupe chain
- cap attempts by `LLM_PROVIDER_MAX_ATTEMPTS`
- recent provider failures enter short cooldown and are skipped while the cooldown is active
- for HF experiment arm, `LLM_EXPERIMENT_FAIL_OPEN=false` disables non-HF fallback

## Bootstrap Profiles and Startup DAG

Canonical source:

- `server.ts`
- `src/services/runtimeBootstrap.ts`
- `src/bot.ts`

Profile A: server-only (`START_BOT=false`)

```mermaid
flowchart TD
  A[server.ts] --> B[startServerProcessRuntime]
  B --> C[startAutomationJobs]
  B --> D[startMemoryJobRunner]
  B --> E[startOpencodePublishWorker]
  B --> G[startRuntimeAlerts]
```

Profile B: unified server+bot (`START_BOT=true` and token present)

```mermaid
flowchart TD
  A[server.ts] --> B[startServerProcessRuntime]
  A --> C[import src/bot.ts]
  C --> D[startBot]
  D --> E[discord ready]
  E --> F[startDiscordReadyRuntime]
  F --> G[startAutomationModules]
  F --> H[startAgentDailyLearningLoop]
  F --> I[startGotCutoverAutopilotLoop]
  F --> J[startLoginSessionCleanupLoop]
  F --> K[startObsidianLoreSyncLoop]
  F --> L[startRetrievalEvalLoop]
  F --> M[startAgentSloAlertLoop]
```

Profile C: bot-only (`bot.ts` entry)

```mermaid
flowchart TD
  A[bot.ts] --> B[startBot]
  B --> C[discord ready]
  C --> D[startDiscordReadyRuntime]
```

Profile note:

- `config/env/local.profile.env`, `config/env/local-first-hybrid.profile.env`, `config/env/local-openclaw-stack.profile.env`, `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-first-hybrid-gemma4.profile.env`, `config/env/production.profile.env` tune OpenJarvis routing/worker strictness and LLM provider preference only.
- Runtime startup DAG is controlled by entrypoint + `START_BOT` + Discord token presence.

## Request Flow (HTTP)

1. `server.ts` loads env and monitoring.
2. `createApp()` in `src/app.ts` composes middleware.
3. Global middleware: CORS, JSON body parser, cookie parser, user attach, CSRF guard.
4. Domain routers mounted under `/api/*` plus health and readiness endpoints.
5. Fallback returns `404 NOT_FOUND`.

## Domain Routers

- `/api/auth`: login, callback, session endpoints.
- `/api/research`: preset retrieval and management.
- `/api/fred`: economic data endpoints.
- `/api/quant`: quant panel contract endpoint.
- `/api/bot`: runtime status, automation controls, agent operations.
- Agent super-facade endpoints under `/api/bot/agent/super/*`: structured recommendation and session start over the existing session runtime.
- `/api/benchmark`: benchmark event ingest and summary.
- `/health`, `/ready`, `/api/status`: operational health surface.

## Core Service Domains

- **Auth and identity**: session parse, cookie/token validation, admin allowlist.
- **Automation runtime**: scheduled jobs and worker health.
- **Agent runtime**: multi-agent orchestration, policy, memory/session persistence.
- **Sprint pipeline**: plan → implement → review → qa → security-audit → ops-validate → ship → retro (8단계, 결정론적 fast-path 지원).
- **Memory 4-tier**: raw → summary → concept → schema (진화 링크 + 통합 배치 + 사용자 임베딩).
- **Autonomous evolution** (Phase F/G/H):
  - Phase F: Observer Layer — 6 채널 자율 환경 스캐닝 (에러 패턴, 메모리 갭, 성능 드리프트, 코드 건강도, 수렴 추세, Discord 활동량)
  - Phase G: Intent Formation — 관측 → 의도 변환 엔진 (6 규칙 기반 룰)
  - Phase H: Progressive Trust — 길드별 신뢰 점수 기반 자율 실행 범위 결정 (trust decay + loop breaker)
- **External tool adapters**: 7대 OSS 통합 (OpenShell, NemoClaw, OpenClaw, OpenJarvis, DeepWiki, n8n, Render) + Ollama/LiteLLM/MCP 인프라 어댑터. M-15로 동적 어댑터 등록 지원.
- **Signal Bus**: 인프로세스 typed event hub (17개 시그널 타입, eval/go-no-go/convergence/workflow 이벤트 즉시 전파).
- **Traffic routing**: main / shadow / langgraph 3-경로 A/B 라우팅 의사결정.
- **User CRM**: write-behind 활동 추적, 프로필, 길드 멤버십, 리더보드.
- **Integrations**: Supabase, Discord, LLM providers, external market/macro sources.
- **Platform dashboard**: `/dashboard` — 런타임 상태, 어댑터 가용성, Obsidian vault 어댑터 체인 + capability 라우팅 시각화.

## Data Boundaries

- Canonical schema bootstrap: `docs/SUPABASE_SCHEMA.sql` (82 tables) + `scripts/migrations/` (003-012, 추가 테이블).
- Schema usage map (generated): `docs/SCHEMA_SERVICE_MAP.md`.
- Table families:
  - User/authn/authz: `users`, `user_roles`, `settings`, `user_profiles`, `guild_memberships`.
  - News and automation: `sources`, `alert_slots`, `logs`, `news_sentiment`.
  - Trading: `trading_signals`, `market_regime`, `trades`, `candles`, `trading_engine_configs`.
  - Agent runtime: `agent_sessions`, `agent_steps`, `agent_action_logs`, `agent_llm_call_logs`, `agent_weekly_reports`, `agent_skill_catalog`, `agent_workflow_profiles`.
  - Memory: `memory_items`, `memory_sources`, `memory_feedback`, `memory_conflicts`, `memory_jobs`, `memory_item_links`, `memory_job_deadletters`.
  - Eval/reward: `retrieval_eval_sets/cases/targets/runs/results`, `retrieval_ranker_experiments`, `retrieval_ranker_active_profiles`.
  - GoT/ToT: `agent_got_runs/nodes/edges/selection_events/cutover_profiles`, `agent_tot_policies/candidate_pairs`.
  - Sprint: `sprint_pipelines`, `sprint_journal_entries`, `ventyd_events` (event sourcing).
  - Community: `community_interaction_events`, `community_relationship_edges`, `community_actor_profiles`.
  - Autonomous evolution: `intents` (Phase G), `agent_trust_scores` (Phase H), observations (Phase F, migration 008).
  - Workflow: `workflow_sessions`, `workflow_steps`, `workflow_events` (migration 007).
  - Tool learning: `agent_tool_learning_logs/candidates/rules`.
  - Privacy/policy: `agent_privacy_policies/gate_samples`, `agent_user_privacy_preferences`, `agent_retention_policies`, `agent_action_policies`.
  - Infra: `distributed_locks`, `api_rate_limits`, `api_idempotency_keys`.

## Generated Analysis Artifacts

- Route inventory: `docs/ROUTES_INVENTORY.md`
- Dependency graph: `docs/DEPENDENCY_GRAPH.md`
- Schema-service usage map: `docs/SCHEMA_SERVICE_MAP.md`
- Service directory map: `src/services/DIRECTORY_MAP.md`

## Autonomous Evolution Pipeline (Phase F-H)

5-Phase architecture — 3 phases implemented, 2 planned:

| Phase | Name | Status | Entry |
| ----- | ---- | ------ | ----- |
| F | Observer Layer | ✅ 활성 | `src/services/observer/observerOrchestrator.ts` |
| G | Intent Formation | ✅ 활성 | `src/services/intent/intentFormationEngine.ts` |
| H | Progressive Trust | ✅ 활성 | `src/services/sprint/trustScoreService.ts` |
| I | Synthesis | 미구현 | — |
| J | MetaCognition | 미구현 | — |

Phase F: 6개 채널이 환경을 스캔 → `observations` 테이블에 기록 → Signal Bus로 전파.
Phase G: Observation → 규칙 기반 의도 생성 → `intents` 테이블 → (trust 충분 시) Sprint 자동 트리거.
Phase H: 길드×카테고리 신뢰 점수 = successRate×0.35 + rollbackRate×0.20 + scopeCompliance×0.15 + reviewQuality×0.15 + ageDecay×0.15. 신뢰 점수에 따라 자율 실행 범위 결정.

Design doc: `docs/planning/AUTONOMOUS_AGENT_EVOLUTION_PLAN.md`

## MCP Architecture (Multi-Server)

| Surface | Location | 도구 수 | 역할 |
| ------- | -------- | ------- | ---- |
| muelIndexing | `.vscode/mcp.json` (local stdio) | 7 | local overlay 인덱싱 전용 (dirty workspace / uncommitted only) |
| muelUnified | `.vscode/mcp.json` (local stdio) | 40+ | 통합 진입점 (general + Indexing + Obsidian + `ext.*` + `upstream.*` + `diag.upstreams`) |
| gcpCompute | GCP VM `34.56.232.61` (SSH stdio) | 40+ | 원격 통합 서버 (로컬 대비 외부 어댑터 더 풍부) |
| Supabase read plane | `MCP_UPSTREAM_SERVERS` → `upstream.supabase_ro.*` | DB | 팀 공용 read-only diagnostics, schema/advisor/migration/log 조회 |
| DeepWiki | `MCP_UPSTREAM_SERVERS` → `upstream.deepwiki.*` | — | 외부 repo 문서 질의 |

Supabase admin or mutation surfaces are intentionally not listed as shared team MCP surfaces here. If introduced later, they should live behind a separate operator-only namespace or host rather than the shared `supabase_ro` lane.

> **Note**: `muelIndexing`와 `gcpCompute`는 인덱싱 도구가 겹치지만 역할은 다르다. `gcpCompute`는 shared truth, `muelIndexing`는 local overlay diff lane이다. `muelUnified`(로컬)와 `gcpCompute`는 같은 unified 서버지만, 팀 공용 Obsidian/운영 문서/요구사항 확인은 `gcpCompute`를 기본 경로로 본다. `muelUnified`는 로컬 overlay 또는 로컬 전용 vault 실험에만 사용한다.

Federated shared-control-plane 원칙:

- 협업의 기본 단위는 checkout 동기화가 아니라 namespaced capability lane이다.
- 다른 레포, 다른 VM, 다른 external execution runtime도 `MCP_UPSTREAM_SERVERS`에 별도 namespace로 붙일 수 있다.
- 권장 metadata는 `label`, `plane`, `audience`, `owner`, `sourceRepo`다.
- `diag.upstreams`는 현재 붙어 있는 upstream namespace, filter, catalog 상태를 운영자와 IDE agent에게 같은 형식으로 보여준다.
- semantic lane은 Obsidian/shared wiki, operational lane은 Supabase read plane, execution lane은 외부 runtime worker, control lane은 shared orchestration surface로 분리하는 편이 덜 엉킨다.

MCP 서버 코드:

- `src/mcp/server.ts` — 기본 MCP 서버 (stdio/http)
- `src/mcp/indexingServer.ts` — 인덱싱 전용
- `src/mcp/unifiedServer.ts` — 통합 진입점 (기본 + 인덱싱 + Obsidian + `ext.*`)
- `src/mcp/obsidianToolAdapter.ts` — Obsidian vault 도구 (search/read/write/backlinks + 20+ 도구)
- `src/mcp/unifiedToolAdapter.ts` — `ext.*` MCP 브릿지 (외부 어댑터 capability를 MCP 도구로 노출)

전체 도구 카탈로그: `docs/planning/mcp/MCP_TOOL_SPEC.md`
갭 분석: `docs/planning/CAPABILITY_GAP_ANALYSIS.md`

Regeneration command:

```bash
npm run docs:build
```

## Change Control

When modifying route registration, core service boundaries, or persistence strategy:

1. Update this index when structure meaning changes.
2. Run `npm run docs:build`.
3. Add an entry in `docs/CHANGELOG-ARCH.md`.
4. Run `npm run routes:check:agent` to verify duplicated/misplaced agent endpoints across route modules.
