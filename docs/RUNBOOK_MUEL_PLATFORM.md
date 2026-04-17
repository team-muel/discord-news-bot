# Muel Platform Unified Runbook

## Naming And Runtime Boundary

Operational documents in this repository may reference legacy internal labels that were used for local routing and worker surfaces.
Those labels do not describe external product installation status.
When this runbook refers to executable runtime surfaces, it means concrete integrations such as Ollama, local CLI tools, MCP servers, local workers, remote workers, and configured model providers.

Canonical naming and runtime surface source of truth:

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- `docs/ROLE_RENAME_MAP.md`

This is the single operational runbook for the Muel platform across Discord, Render, Supabase, Vercel, and Obsidian sync.

Use this document as the first entrypoint for DevOps/SRE operations.
Detailed domain docs are linked where needed, but this runbook is designed to be executable end-to-end.

Document Role:

- Canonical for platform-wide operational procedure.
- Read first for incident handling, deployment verification, and operator execution.
- Companion documents may add detail, but they must not override this runbook's operating procedure.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

## 0) System Scope

Platform components:

- Render Web Service: backend API + Discord bot + automation jobs
- Supabase: persistence for auth, operations, memory, trading, and telemetry
- Vercel: frontend UI
- Local/worker machine: Obsidian vault sync to `guild_lore_docs`

Primary goals:

- Keep Discord bot and API continuously available
- Preserve long-term guild memory with safe fallback (Supabase-first)
- Allow controlled operations through authenticated admin endpoints
- Maintain clear recovery and incident procedures

## 1) Ownership and SLO

Suggested ownership model:

- Service owner: backend runtime and deployment
- Data owner: Supabase schema and data quality
- Frontend owner: Vercel app and OAuth UX
- On-call: first response, mitigation, escalation

Single-operator mode (current):

- This platform can be operated by one developer.
- Primary risk framing is operator context overload and decision latency, not cross-team communication.
- Mitigation baseline:
  - Keep runbooks and changelog synchronized on every architecture-significant change.
  - Keep go/no-go gates and operational thresholds explicit and versioned.
  - Prefer automation with fail-closed defaults for high-impact operations.

Suggested baseline SLO (adjust as needed):

- API availability: 99.5%
- Discord bot readiness: 99.0%
- Obsidian sync freshness: within 60 minutes

## 2) Source of Truth

Open these first when verifying behavior:

- Operational runtime contract manifest: `config/runtime/operating-baseline.json`
- Runtime architecture index: `docs/ARCHITECTURE_INDEX.md`
- Unified roadmap (canonical): `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`
- 24/7 runtime ops: `docs/OPERATIONS_24_7.md`
- Operator decision matrix: `docs/OPERATOR_SOP_DECISION_TABLE.md`
- Platform document control tower: `docs/planning/PLATFORM_CONTROL_TOWER.md`
- Harness playbook: `docs/HARNESS_ENGINEERING_PLAYBOOK.md`
- Harness manifest template: `docs/HARNESS_MANIFEST.example.yaml`
- Harness release gates: `docs/HARNESS_RELEASE_GATES.md`
- Frontend contract and CORS/auth details: `docs/FRONTEND_INTEGRATION.md`
- Supabase schema: `docs/SUPABASE_SCHEMA.sql`
- Secret rotation and shared Supabase read-plane rollout: `docs/SECRET_ROTATION_AND_SUPABASE_RO_ROLLOUT.md`
- Obsidian sync operations: `docs/OBSIDIAN_SUPABASE_SYNC.md`
- Team-shared MCP and IDE operating standard: `docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md`
- Multica local control-plane playbook: `docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md`
- MCP tool spec and rollout: `docs/planning/mcp/MCP_TOOL_SPEC.md`, `docs/planning/mcp/MCP_ROLLOUT_1W.md`
- Lightweight worker split: `docs/planning/mcp/LIGHTWORKER_SPLIT_ARCH.md`
- Progressive autonomy 30-day checklist: `docs/archive/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md` (ARCHIVED)
- Go/No-Go gate template: `docs/planning/GO_NO_GO_GATE_TEMPLATE.md`
- Autonomy contract schemas: `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`
- Local-first hybrid autonomy: `docs/planning/LOCAL_FIRST_HYBRID_AUTONOMY.md`
- Local external tool adapter architecture: `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`
- GCP opencode worker VM deploy: `docs/planning/GCP_OPENCODE_WORKER_VM_DEPLOY.md`
- Remote-only autonomy implementation: `docs/planning/REMOTE_ONLY_AUTONOMY_IMPLEMENTATION.md`
- Generated route map: `docs/ROUTES_INVENTORY.md`
- Schema-service map: `docs/SCHEMA_SERVICE_MAP.md`

Runtime/control-plane verification baseline:

- Treat `config/runtime/operating-baseline.json` as the canonical source for current machine profile, always-on required services, canonical worker endpoints, and local-only acceleration lanes.
- Use public `GET /health` and `/dashboard` for startup summary state only. Detailed startup error text and loop ownership diagnostics are shown only to signed-in admins; use `GET /api/bot/agent/runtime/scheduler-policy` and `GET /api/bot/agent/runtime/loops` for the full operator view.
- Treat `GET /api/bot/agent/runtime/scheduler-policy` as the canonical operator snapshot for loop ownership and startup phase.
- Use `GET /api/bot/agent/runtime/loops` and `GET /api/bot/agent/runtime/unattended-health` before deciding restart, rollback, or workload freeze. `runtime/loops` is also the quickest place to confirm reward-signal and eval-auto-promote loop state plus the current repo-owned Obsidian and eval maintenance control surfaces. Inspect the `llmRuntime` block to see the selected provider, action policy providers, workflow binding, effective provider profile, resolved chain, readiness-pruned chain, and per-provider health.
- Use `GET /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5` when validating A-003 gate -> approval -> model fallback state for a specific guild.
- Use `GET /api/bot/agent/obsidian/runtime` for shared-vault health, remote-mcp diagnostics, cache boundary, and inbox chat loop state.
- Use `GET /api/bot/agent/obsidian/knowledge-control?artifact=lint` and `GET /api/bot/agent/runtime/knowledge-control-plane?guildId=<id>` when validating knowledge freshness, grounding, and compiler health.
- Use `GET /api/bot/agent/actions/catalog` and `GET /api/bot/agent/runtime/role-workers` before assuming that a named role is callable in the current deployment.
- Distinguish startup phase (`service-init`, `discord-ready`, `database`) from execution ownership (`app`, `db`) during incident triage; not every missing Discord-ready loop is a platform-wide outage.

## 2.1) Current Progress Snapshot (2026-03-15)

This snapshot captures what is already running in production-oriented flow.

- Guild onboarding automation:
  - New guild join can auto-bootstrap Obsidian knowledge tree.
  - Optional first ops-cycle can run immediately after bootstrap.
- Obsidian sync model:
  - Sync moved from fixed 3-document mode to manifest-driven recursive collection.
  - All-guild discovery mode is supported for periodic loops.
- Continuous context ingestion:
  - Discord category/channel topology snapshots are persisted to guild knowledge tree.
  - Channel/user activity telemetry snapshots are persisted periodically.
  - Reaction reward snapshots (thumbs-up/thumbs-down) are persisted periodically.
- User feedback loop:
  - User-facing response footer prompt can be enabled for lightweight quality signal.

- Social graph memory plane:
  - `community_interaction_events`, `community_relationship_edges`, `community_actor_profiles` are active schema targets.
  - reply/mention/co_presence/reaction signals are ingested and aggregated.
  - requester-aware social hints are merged into memory hint pipeline.
  - user/guild forget scope includes social graph data.

Operational meaning:

- Current stage is no longer static memory sync.
- Current stage is an autonomous guild-context operating loop with safety gates.

## 2.2) Document Governance (Roadmap/Runbook/Backlog Sync)

For roadmap and operations coherence, use this order:

1. `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`: direction, priorities, milestone IDs
2. `docs/planning/EXECUTION_BOARD.md`: current state (Now/Next/Later)
3. `docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md`: task-level implementation units
4. `docs/RUNBOOK_MUEL_PLATFORM.md`: operational execution procedures

Sync rule:

- If roadmap priority changes, update the four documents above in the same change set.

## 3) Day 0 Provisioning Checklist

### 3.1 Supabase

1. Apply `docs/SUPABASE_SCHEMA.sql` in SQL editor.
2. Verify critical tables exist:
   - `users`, `user_roles`, `discord_login_sessions`
   - `agent_sessions`, `agent_steps`
   - `memory_items`, `memory_sources`, `memory_jobs`
   - `guild_lore_docs`, `api_rate_limits`, `distributed_locks`
3. Confirm service-role credentials are available to backend.

### 3.2 Render (backend + bot)

1. Configure build/start commands:

    - Build: `npm ci; npm run build`
    - Start: `npm run start`
    - Health check: `/ready`
    - Keep `/health` as a diagnostics endpoint only; do not use it as the restart signal.

2. Set required env values:

    - `NODE_ENV=production`
    - `START_BOT=true`
    - `START_AUTOMATION_JOBS=true`
    - `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`)
    - `JWT_SECRET`
    - `SUPABASE_URL`
    - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`)
    - LLM keys (`AI_PROVIDER` + provider key)
    - `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
    - `ACTION_MCP_STRICT_ROUTING=true`
    - `MCP_IMPLEMENT_WORKER_URL=https://34.56.232.61.sslip.io` (temporary TLS endpoint; replace with custom domain later; legacy alias `MCP_OPENCODE_WORKER_URL` supported)
    - `MCP_ARCHITECT_WORKER_URL=https://34.56.232.61.sslip.io/architect`
    - `MCP_REVIEW_WORKER_URL=https://34.56.232.61.sslip.io/review`
    - `MCP_OPERATE_WORKER_URL=https://34.56.232.61.sslip.io/operate`
    - `OPENJARVIS_SERVE_URL=https://34.56.232.61.sslip.io/openjarvis`
    - `MCP_SHARED_MCP_URL=https://34.56.232.61.sslip.io/mcp`
    - `OBSIDIAN_REMOTE_MCP_URL=https://34.56.232.61.sslip.io/mcp` (legacy alias, `/obsidian` compatibility path retained)
    - `MCP_OPENCODE_TOOL_NAME=opencode.run`
    - `RENDER_API_KEY` (optional but recommended for internal deploy trigger, rollback, and one-off job operations)

3. Set web integration env values:
   - `PUBLIC_BASE_URL=https://<render-domain>`
   - `CORS_ALLOWLIST` (include Vercel domain)
   - Discord OAuth keys and callback settings

### 3.3 Vercel (frontend)

1. Set `VITE_API_BASE_URL` to Render backend URL.
2. Ensure cookie auth and CSRF contract is implemented.
3. Validate popup OAuth flow with backend callback endpoint.

### 3.4 Obsidian Sync Worker (no Render disk)

1. On local or worker host, configure:
   - `OBSIDIAN_SYNC_VAULT_PATH`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`)
2. Run:
   - `npm run sync:obsidian-lore:dry`
   - `npm run sync:obsidian-lore`
3. Schedule recurring sync (Windows Task Scheduler recommended).

### 3.5 Server-Only Autonomous Mode (local PC off)

목표: 로컬 PC가 꺼져 있어도 Discord Bot + Render + LiteLLM + Obsidian Headless 경로만으로 서비스 지속.

1. Provider를 프록시 단일 경로로 고정:

- `AI_PROVIDER=openclaw`
- `OPENCLAW_BASE_URL=https://<litellm-proxy-endpoint>`
- `OPENCLAW_API_KEY=<secret>`

1. Obsidian remote-mcp 기반 경로 활성화:

- `OBSIDIAN_REMOTE_MCP_ENABLED=true`
- `MCP_SHARED_MCP_URL=https://<worker-domain-or-sslip>/mcp`
- `OBSIDIAN_REMOTE_MCP_URL=https://<worker-domain-or-sslip>/mcp`
- `OBSIDIAN_REMOTE_MCP_TOKEN=<secret>`
- `OBSIDIAN_VAULT_NAME=<vault-name>`
- `OBSIDIAN_ADAPTER_STRICT=true`
- `OBSIDIAN_ADAPTER_ORDER=remote-mcp,script-cli`
- `OBSIDIAN_ADAPTER_ORDER_READ_LORE=remote-mcp,script-cli`
- `OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=remote-mcp`
- `OBSIDIAN_ADAPTER_ORDER_READ_FILE=remote-mcp`
- `OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=remote-mcp`
- `OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=remote-mcp,script-cli`
- fresh VM에서 `scripts/deploy-gcp-workers.sh` 는 `xvfb-run` 과 `OBSIDIAN_APP_BIN` 기본값 `/opt/obsidian-app/obsidian` 이 있으면 `obsidian-headless`, `unified-mcp-http`, `obsidian-lore-sync.timer` 를 함께 설치해 canonical `/mcp` ingress와 compatibility `/obsidian` alias를 모두 제공하는 always-on shared MCP 경로를 재현한다.
- 팀/IDE 에이전트는 shared operator docs, 요구사항, 계획 note를 확인할 때 로컬 vault 대신 `gcpCompute` 또는 canonical `/mcp` ingress를 기본 경로로 사용한다.

1. OpenJarvis 원격 실행 강제:

- `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
- `MCP_IMPLEMENT_WORKER_URL=<remote-worker-url>`
- `MCP_OPENCODE_TOOL_NAME=opencode.run`
- `ACTION_MCP_STRICT_ROUTING=true`

1. 쓰기 전략 분리:

- 문서/지식 업데이트는 `memory_items`, `guild_lore_docs` 등 DB 경로를 주 경로로 사용
- 파일 직접 쓰기는 `script-cli` 또는 DB 비동기 경로로만 운영 (`local-fs` 미사용)

1. 배포 후 필수 검증:

- `GET /api/bot/agent/obsidian/runtime` 확인
- `GET /ready` 확인
- `memory_retrieval_logs`, `agent_tot_candidate_pairs` 누적 확인

### 3.6 Env Profile Switching (Local vs Production)

목표: `.env` 수동 편집 실수를 줄이고 로컬/운영 프로필 전환을 재현 가능하게 유지한다.

프로필 정의 파일:

- `config/env/local.profile.env`
- `config/env/local-first-hybrid.profile.env`
- `config/env/local-openclaw-stack.profile.env`
- `config/env/local-nemoclaw-stack.profile.env`
- `config/env/local-nemoclaw-max-delegation.profile.env`
- `config/env/local-first-hybrid-gemma4.profile.env`
- `config/env/production.profile.env`

적용 명령:

- 로컬 개발형 적용: `npm run env:profile:local`
- 로컬 추론 우선형 적용: `npm run env:profile:local-first-hybrid`
- OpenClaw daemon 중심 로컬 스택 적용: `npm run env:profile:local-openclaw-stack`
- NemoClaw hardened 로컬 스택 적용: `npm run env:profile:local-nemoclaw-stack`
- NemoClaw 로컬 최대 위임형 적용: `npm run env:profile:local-nemoclaw-max-delegation`
- Hermes Gemma 4 A/B 적용: `npm run env:profile:local-first-hybrid:gemma4`
- 운영형 적용: `npm run env:profile:production`
- 사전 미리보기(dry-run): `npm run env:profile:local:dry`
- 사전 미리보기(dry-run): `npm run env:profile:local-first-hybrid:dry`
- 사전 미리보기(dry-run): `npm run env:profile:local-openclaw-stack:dry`
- 사전 미리보기(dry-run): `npm run env:profile:local-nemoclaw-stack:dry`
- 사전 미리보기(dry-run): `npm run env:profile:local-nemoclaw-max-delegation:dry`
- 사전 미리보기(dry-run): `npm run env:profile:local-first-hybrid:gemma4:dry`
- 사전 미리보기(dry-run): `npm run env:profile:production:dry`

가드레일:

- 적용 스크립트는 기존 `.env`를 `.env.profile-backup`으로 백업한다.
- `.env.profile-backup`은 live secret material로 취급한다. 로컬에서만 유지하고, 외부 공유나 커밋 대상으로 취급하지 않는다.
- 운영형 적용 후에는 `MCP_IMPLEMENT_WORKER_URL`이 실제 원격 워커 URL인지 별도 확인한다. legacy `MCP_OPENCODE_WORKER_URL` 는 호환 alias 로만 본다.
- 적용 직후 `npm run env:check`와 `npm run openjarvis:autonomy:run:dry`로 검증한다.
- local-first hybrid 적용 직후에는 `npm run env:check:local-hybrid`로 Ollama/worker 공존 readiness를 추가 확인한다.
- `local-openclaw-stack` 프로필은 `OPENCLAW_GATEWAY_URL`과 `OPENCLAW_BASE_URL`을 `http://127.0.0.1:18789`로 맞추고 gateway/API 토큰은 기본적으로 비운다. 로컬 또는 공유 gateway가 보호되어 있으면 적용 직후 토큰 값을 다시 채운다.
- `local-openclaw-stack` 프로필은 OpenClaw local ingress를 기본값으로 두고 `MCP_IMPLEMENT_WORKER_URL`은 로컬 worker(`http://127.0.0.1:8787`)로 둔다. 완전 로컬 구현 경로가 필요하면 `npm run worker:opencode:local`을 먼저 띄우고, 원격 fail-closed 구현 경로를 유지하려면 적용 후 `MCP_IMPLEMENT_WORKER_URL`을 GCP worker URL로 덮어쓴다.
- `local-first-hybrid`와 `local-first-hybrid-gemma4` 프로필은 repo-local OpenJarvis serve를 `OPENJARVIS_ENGINE=ollama`, `OPENJARVIS_MODEL=qwen2.5:7b`로 고정한다. Gemma 4 A/B 프로필에서도 Hermes-side direct Ollama lane만 `gemma4:e4b`로 바뀌고, OpenJarvis/NemoClaw/optimize judge는 검증된 Qwen lane에 남는다.
- `local-nemoclaw-stack` 프로필은 direct Ollama lane과 NemoClaw sandbox lane을 같은 Nemotron Nano 8B GGUF로 맞추되, OpenJarvis serve/model binding은 검증된 Qwen lane에 그대로 둔다. 또한 host OpenClaw ingress를 dev-profile 포트 `http://127.0.0.1:19001`로 함께 찍어, NemoClaw dashboard 기본 포트 `18789`와 충돌하지 않게 한다. 목적은 Windows + WSL 환경에서 Ollama 8B -> OpenJarvis -> OpenClaw/Hermes -> NemoClaw/OpenShell 순서를 실제로 성립시키는 것이다.
- `local-nemoclaw-max-delegation` 프로필은 위 구조를 유지하되 `MCP_IMPLEMENT_WORKER_URL`, `MCP_ARCHITECT_WORKER_URL`, `MCP_REVIEW_WORKER_URL`, `MCP_OPERATE_WORKER_URL`, `OPENJARVIS_SERVE_URL`을 canonical GCP control-plane surface로 고정하고 `N8N_DELEGATION_ENABLED=true`를 켠다. 목적은 로컬 Ollama/OpenClaw/n8n 가속은 유지하면서도 24시간 무감독 lane의 hands/control plane은 remote always-on surface로 fail-closed 시키는 것이다.
- NemoClaw 계열 프로필은 `OPENSHELL_SANDBOX_DELEGATION=true`, `OPENSHELL_DEFAULT_SANDBOX_ID=muel-assistant`, `OPENSHELL_DEFAULT_SANDBOX_IMAGE=ollama`를 함께 찍는다. 이렇게 해야 implement fast-path와 OpenShell auto-create가 같은 sandbox 이름을 사용한다.
- Windows Docker Desktop + WSL에서 NemoClaw sandbox inference를 쓰는 로컬 프로필은 `NEMOCLAW_SANDBOX_OLLAMA_URL=http://host.docker.internal:11434`를 명시해야 한다. sandbox 내부 `localhost`는 호스트 Ollama를 가리키지 않는다.
- local OpenClaw 2026.3.13 dev gateway는 `healthz`와 control UI는 살아 있어도 `/v1/chat/completions` 같은 OpenAI-compatible chat surface가 비어 있을 수 있다. 따라서 `OPENCLAW_GATEWAY_URL` health만으로 chat-ready를 판단하지 말고, JSON을 돌려주는 `/v1/models` 확인이나 CLI fallback readiness를 별도로 본다.
- `local-nemoclaw-stack` 프로필은 NemoClaw non-interactive onboarding 힌트(`NEMOCLAW_PROVIDER`, `NEMOCLAW_MODEL`)까지 함께 찍어 WSL install/onboard와 repo runtime 설정이 같은 모델을 보게 한다.
- `local-nemoclaw-max-delegation` 프로필은 `N8N_DELEGATION_FIRST=true`를 사용해, webhook이 설정된 뉴스 RSS/뉴스 후보/기사 컨텍스트/유튜브 feed/community/뉴스 요약 경로에서 inline fetch/scrape/summary fallback을 건너뛴다. 또한 `NEWS_MONITOR_LOCAL_FALLBACK_ENABLED=false`, `YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED=false`를 함께 찍어 legacy local scraper lane도 명시적으로 꺼 둔다. 목적은 로컬 코드베이스를 orchestration 중심으로 더 얇게 유지하는 것이다.
- host OpenClaw와 NemoClaw onboard를 같은 머신에서 함께 쓸 때는 포트 소유권을 분리한다. pure OpenClaw local stack은 기본 포트 `18789`를 계속 쓰고, NemoClaw 계열 프로필은 host OpenClaw를 dev-profile 포트 `19001`로 옮긴다. NemoClaw onboard는 upstream 기본값상 dashboard `18789`를 강하게 가정한다.
- 로컬 OpenJarvis API key는 별도 발급 절차가 아니라 operator가 정하는 정적 bearer token이다. 로컬에서는 `.env`의 `OPENJARVIS_SERVE_API_KEY`를 채우고 `npm run openjarvis:serve:local`로 시작한다. helper가 런타임에서 `OPENJARVIS_API_KEY`로 자동 매핑한다.
- `GET /api/bot/agent/runtime/unattended-health`와 `GET /api/bot/agent/runtime/operator-snapshot`는 이제 `localAutonomy` 블록으로 `local-nemoclaw-max-delegation` 표준 profile의 doctor 결과를 함께 보여준다. 로컬 24시간 자율 lane이 막히면 여기서 바로 `failures`와 `nextSteps`를 읽고, local n8n/LiteLLM bring-up 또는 canonical GCP surface drift 여부를 우선 확인한다.
- repo runtime이 살아 있는 동안에는 `localAutonomySupervisorLoop`가 service-init loop로 함께 돌며, 같은 표준 profile을 주기적으로 doctor/up 하고 Hermes supervisor가 비어 있으면 자동으로 `start-supervisor-loop` remediation을 큐잉한다. local max-delegation lane에서는 이때 `autoLaunchQueuedChat=true`도 함께 요구해서 queued next objective가 있으면 다음 GPT 세션까지 이어간다.
- 이미 떠 있는 Hermes supervisor가 구형 manual-chat 모드라면, 현재 workflow가 `executing`이 아닌 안전 구간에서 local autonomy loop가 그 supervisor를 내리고 queue-aware auto-chat 모드로 다시 올려 24시간 연속성을 수렴시킨다.
- queue-aware supervisor가 `queued_chat_launched` 이후 `awaiting_reentry_acknowledgment=true` 상태로 멈춰 있다면, local autonomy loop는 이를 supervisor-down 고장으로 취급하지 않는다. 이 구간에서는 `openjarvis:hermes:runtime:reentry-ack`가 먼저 실행되어야 하며, status/readiness/local-autonomy 표면은 같은 wait boundary를 유지해서 중복 GPT relaunch를 막는다. 대기 시간이 15분을 넘기면 `awaiting_reentry_acknowledgment_stale=true` 와 `reentry=stale-ack` 경고가 surfaced 되고, local autonomy loop 는 같은 stale boundary 당 한 번만 workflow `capability_demand` 를 기록한 뒤 continuity packet sync 를 다시 돌려 Obsidian-visible handoff/progress packet 까지 갱신한다.
- repo runtime이 없거나 아직 올리지 않은 세션에서는 `npm run local:autonomy:supervisor`가 같은 self-heal logic을 detached 독립 프로세스로 유지한다. 최신 상태는 `tmp/autonomy/local-autonomy-supervisor.json`, 프로세스 메타데이터는 `tmp/autonomy/local-autonomy-supervisor.manifest.json`, stdout/stderr 로그는 `tmp/autonomy/local-autonomy-supervisor.log`에 기록된다. status payload의 `watchProcess`와 `stats.lastSupervisorAutoLaunchQueuedChat`로 standalone lane이 queue-aware chat relaunch를 목표 상태로 유지하는지 바로 확인할 수 있다. continuity packet sync도 이제 이 manifest/status/log를 fallback observability source로 읽으므로 active launch manifest가 비어 있어도 Obsidian handoff/progress packet의 `continuity_watch_alive`와 evidence refs로 detached watcher 생존 여부를 확인할 수 있다. manifest와 status는 tracked code fingerprint도 함께 기록하므로 `npm run local:autonomy:supervisor:status`에서 `code.driftDetected`와 `code.restartRecommended`를 보면 detached daemon이 현재 repo 코드와 어긋났는지 바로 알 수 있다. `npm run local:autonomy:supervisor`는 drift가 감지된 기존 daemon을 자동으로 교체하고, 필요하면 `npm run local:autonomy:supervisor:restart`로 강제 재기동할 수 있다.
- 현재 local-nemoclaw-stack의 OpenJarvis lane은 LiteLLM(`http://127.0.0.1:4000`) 뒤의 검증된 Qwen 모델을 쓴다. `NVIDIA_API_KEY`나 `NVIDIA_NIM_API_KEY`는 NemoClaw/OpenJarvis의 로컬 Ollama/LiteLLM lane을 올리는 데 필수는 아니고, NVIDIA cloud/NIM inference를 직접 쓰려는 경우에만 필요하다.
- Gemma 4 A/B 프로필은 direct Ollama lane만 `gemma4:e4b`로 바꾸고 OpenJarvis, optimize judge, NemoClaw inference는 기존 qwen lane에 유지한다. 목적은 Hermes-side local reasoning 실험이지 unattended worker 전체 교체가 아니다.
- `npm run env:check:local-hybrid` 통과는 로컬 추론 readiness만 의미한다. 항상-온 운영 readiness는 `GET /api/bot/agent/runtime/unattended-health`와 원격 worker/LiteLLM/remote-mcp health로 별도 판단한다.
- 로컬 worker를 사용하는 경우 `npm run worker:opencode:local`을 먼저 실행한 뒤 hybrid 검증을 수행한다.
- 원격 worker가 GCP VM일 경우 외부 IP는 정적 IP로 예약하고, `sslip.io`는 임시 도메인으로만 사용한다.
- shared Supabase MCP가 필요하면 `supabase_ro` 같은 filtered read-only namespace만 공유 표면에 올리고, write/DDL/extension mutation은 별도 operator-only surface로 둔다.

Docker Desktop hybrid stance for this repo:

- Use Docker Desktop for local infra sidecars, not for the primary Hermes edit loop or host-native Ollama inference lane.
- Good Docker Desktop targets here: local LiteLLM proxy and local n8n.
- Keep Hermes, repo editing, test loops, and Obsidian-heavy file I/O native or WSL-native.
- If Linux-side execution is needed, keep the working tree on the WSL filesystem, not under `/mnt/c/...`.
- For container state such as n8n data or cache-like service state, prefer Docker-managed volumes over broad repo bind mounts.
- For containers that need the host model runtime, use `host.docker.internal` rather than hard-coding a host IP.

Tracked Docker Desktop helper commands:

- Validate tracked local infra compose: `npm run docker:local:infra:config`
- Start local LiteLLM sidecar in Docker Desktop: `npm run docker:local:infra:up`
- Tail local LiteLLM sidecar logs: `npm run docker:local:infra:logs`
- Stop tracked local infra sidecar: `npm run docker:local:infra:down`

Tracked Docker Desktop helper files:

- LiteLLM sidecar compose: [compose.local-infra.yaml](compose.local-infra.yaml)
- LiteLLM image build: [Dockerfile.litellm](Dockerfile.litellm)
- n8n bootstrap and generated compose remain separate: [scripts/bootstrap-n8n-local.mjs](scripts/bootstrap-n8n-local.mjs)

### 3.6.0 Quick Local NemoClaw + OpenJarvis + n8n Bring-Up

목표: Windows + WSL + Docker Desktop에서 NemoClaw review lane, OpenJarvis control surface, local n8n delegation lane을 같은 순서로 재현한다.

빠른 표준 제어면:

- 로컬 우선 doctor: `npm run local:stack:first:doctor`
- 로컬 우선 상태판(status): `npm run local:stack:first:status`
- 로컬 우선 프로필 적용 + managed local services bring-up: `npm run local:stack:first:up`
- 로컬 우선 사전 미리보기: `npm run local:stack:first:up:dry`
- 전체 doctor: `npm run local:stack:max:doctor`
- 상태판(status): `npm run local:stack:max:status`
- 표준 프로필 적용 + managed local services bring-up: `npm run local:stack:max:up`
- 사전 미리보기: `npm run local:stack:max:up:dry`
- standalone self-heal loop 1회 점검: `npm run local:autonomy:supervisor:once`
- standalone self-heal loop detached 시작: `npm run local:autonomy:supervisor`
- standalone self-heal loop 상태 확인: `npm run local:autonomy:supervisor:status`
- standalone self-heal loop 중지: `npm run local:autonomy:supervisor:stop`
- standalone self-heal loop 강제 재기동: `npm run local:autonomy:supervisor:restart`
- foreground watch 실행: `npm run local:autonomy:supervisor:watch`

이 제어면은 `local-nemoclaw-max-delegation` 프로필을 표준 기준으로 보고, repo가 직접 관리할 수 있는 deterministic local surfaces만 자동으로 다룬다. `local:stack:first:*` 제어면은 `local-first-hybrid`를 기준으로 같은 doctor/status/up 흐름을 제공하고, repo-local OpenJarvis serve를 direct Ollama `qwen2.5:7b` lane에 고정한다. `muel-*` 같은 LiteLLM alias를 직접 쓰고 싶으면 `OPENJARVIS_ENGINE` 또는 `OPENJARVIS_MODEL`을 명시적으로 덮어쓴다.

- 자동 관리 대상: local LiteLLM sidecar, local n8n, 그리고 현재 profile에서 실제로 local URL로 남아 있는 deterministic service만
- 상태 요약 포함: Obsidian access posture, OpenJarvis memory projection freshness, latest workflow hot-state summary
- 수동 유지 대상: OpenClaw, NemoClaw, OpenShell 같은 WSL/dashboard/operator-managed lanes

현재 `local-nemoclaw-max-delegation` 표준 profile에서는 canonical GCP worker/OpenJarvis surface를 관찰하고, local control surface auto-start는 LiteLLM/n8n 쪽에만 남긴다.

1. Apply the hardened local profile: `npm run env:profile:local-nemoclaw-stack`
2. Start host OpenClaw on the non-conflicting dev port: `npm run openclaw:gateway:dev`
3. Start the tracked local infra sidecar: `npm run docker:local:infra:up`
4. If `muel-assistant` does not exist yet, create or onboard the sandbox before proceeding. The key rule is: keep port `18789` free for NemoClaw dashboard bootstrap, and keep host OpenClaw on dev port `19001` while using this profile.
5. In WSL, confirm the NemoClaw sandbox is healthy before proceeding: `nemoclaw muel-assistant status`
6. Start local OpenJarvis serve: `npm run openjarvis:serve:local`
7. If startup warns `Failed to resolve memory backend: No module named 'openjarvis_rust'`, repair the upstream checkout and restart serve.

```powershell
Set-Location C:\Muel_S\OpenJarvis
uv sync --extra server --extra dev
Remove-Item Env:CONDA_PREFIX -ErrorAction SilentlyContinue
Remove-Item Env:CONDA_DEFAULT_ENV -ErrorAction SilentlyContinue
Remove-Item Env:CONDA_SHLVL -ErrorAction SilentlyContinue
uv run maturin develop -m rust/crates/openjarvis-python/Cargo.toml
```

After the repair, restart `npm run openjarvis:serve:local` and confirm the log prints `Memory: active`.

Then complete the local delegation lane:

1. Bootstrap local n8n runtime files: `npm run n8n:local:bootstrap`
2. Start and seed local n8n: `npm run n8n:local:start` then `npm run n8n:local:seed`
3. If you want the workstation to delegate as much as possible locally after the workflows are ready, switch profiles now: `npm run env:profile:local-nemoclaw-max-delegation`
4. Run readiness checks in this order.

```powershell
npm run env:check:local-hybrid
npm run n8n:local:doctor
powershell -ExecutionPolicy Bypass -File scripts/bootstrap-external-tools.ps1
```

Operator notes:

- `npm run openclaw:gateway:dev:health` should return healthy on `19001` before you treat OpenClaw/Hermes as an active ingress in the NemoClaw profiles.
- `npm run openclaw:gateway:dev:health`는 control ingress 확인일 뿐, chat-capable 확인은 아니다. local OpenClaw 2026.3.13 dev gateway에서는 `/v1/models`가 JSON을 돌려주는지까지 보거나, repo가 CLI/other-lane fallback으로 내려가는지 함께 검증한다.
- The Windows OpenJarvis probe should hit `/v1/models` with an Authorization header sourced from `OPENJARVIS_API_KEY` or `OPENJARVIS_SERVE_API_KEY`. The repo readiness script now does this automatically.
- `Memory: active` means local OpenJarvis is no longer running in the degraded no-Rust memory-backend mode.
- `npm run env:check:local-hybrid` and the PowerShell readiness script certify the local hybrid lane only. Always-on GCP readiness is still a separate check.
- `npm run local:stack:max:up` applies the max-delegation profile before start-up by default, hydrates the current process from the rewritten `.env`, and writes detached local process logs under `tmp/local-ai-stack/processes/`.
- `npm run local:stack:max:doctor` is intended to be the first-stop status surface before broad archaeology: it reports deterministic local service reachability, current direct-vault posture, OpenJarvis memory feed freshness, and the latest hot-state workstream summary for the operator lane.

### 3.6.1 GCP-Native Hardening Priorities

현재 GCP worker는 단순 VM이 아니라 shared MCP, role worker, OpenJarvis serve를 묶는 control-plane 노드다. 그래서 다음 우선순위는 새 역할 추가보다 GCP-native 운영 기능을 더 쓰는 쪽이 맞다.

- custom domain: `sslip.io`는 임시 ingress로만 보고, broader rollout 전에 Cloud DNS 또는 동등한 정식 도메인으로 교체한다.
- snapshot schedule: boot disk에 Compute Engine snapshot schedule 또는 resource policy를 붙여 재배포 이전 복구 지점을 확보한다.
- access hardening: default Compute Engine service account 대신 dedicated least-privilege service account를 사용하고, SSH는 가능하면 OS Login 기준으로 고정한다.
- instance hardening: automatic restart와 Shielded VM 항목(secure boot, vTPM, integrity monitoring)을 운영 baseline으로 본다.
- visibility: `npm run ops:gcp:report:weekly`와 `npm run ops:gcp:report:monthly`는 health만이 아니라 위 hardening 항목이 실제로 붙었는지도 같이 확인하는 체크로 취급한다.

### 3.7 Bootstrap Profiles and Startup DAG

목표: 부팅 경로를 프로파일별로 고정해 장애 triage 시 "무엇이 시작되어야 하는지"를 즉시 판별한다.

공통 규칙:

- `server.ts`는 항상 `startServerProcessRuntime()`를 먼저 실행한다.
- `START_BOT=true`이고 토큰이 있을 때만 `src/bot.ts`가 로드되고 Discord ready 워크로드가 시작된다.
- `config/env/local.profile.env`, `config/env/local-first-hybrid.profile.env`, `config/env/local-openclaw-stack.profile.env`, `config/env/local-nemoclaw-stack.profile.env`, `config/env/local-nemoclaw-max-delegation.profile.env`, `config/env/local-first-hybrid-gemma4.profile.env`, `config/env/production.profile.env`는 OpenJarvis 라우팅/worker 강제 정책과 LLM provider 우선순위만 바꾸며, runtime bootstrap DAG 자체는 바꾸지 않는다.

Profile A: server-only (`START_BOT=false`)

```mermaid
flowchart TD
  A[server.ts] --> B[startServerProcessRuntime]
  B --> C[startAutomationJobs]
  B --> D[startMemoryJobRunner]
  B --> E[startOpencodePublishWorker]
  B --> F[startTradingEngine]
  B --> G[startRuntimeAlerts]
  A --> H[HTTP app listen]
```

Profile B: unified server+bot (`START_BOT=true` and token present)

```mermaid
flowchart TD
  A[server.ts] --> B[startServerProcessRuntime]
  B --> C[service-init loops]
  A --> D[import src/bot.ts]
  D --> E[startBot]
  E --> F[Discord ready event]
  F --> G[startDiscordReadyRuntime]
  G --> H[startAutomationModules]
  G --> I[startAgentDailyLearningLoop]
  G --> J[startGotCutoverAutopilotLoop]
  G --> K[startLoginSessionCleanupLoop]
  G --> L[startObsidianLoreSyncLoop]
  G --> M[startRetrievalEvalLoop]
  G --> N[startAgentSloAlertLoop]
```

Profile C: bot-only process (`bot.ts` entry)

```mermaid
flowchart TD
  A[bot.ts] --> B[startBot]
  B --> C[Discord ready event]
  C --> D[startDiscordReadyRuntime]
  D --> E[discord-ready loops]
```

## 4) Day 1 Go-Live Verification

Run in order:

1. `npm run env:check` (preflight)
2. `GET /health` returns healthy or expected degraded details
3. `GET /ready` confirms runtime readiness
4. OAuth login from frontend works
5. `GET /api/auth/me` returns session + CSRF metadata
6. Admin-only endpoint check (`/api/trading/strategy` or `/api/bot/status`) matches expected permission
7. Obsidian sync dry run and real run complete without fatal errors
8. `guild_lore_docs` has updated rows for active guilds
9. `GET /api/bot/agent/obsidian/runtime` confirms remote-mcp health, cache boundary, and `inboxChatLoop` state
10. `GET /api/bot/agent/obsidian/knowledge-control?artifact=lint` returns no unexplained blocking lint issues
11. Discord ask surface sanity: `/뮤엘` works and `/해줘` resolves through the same compatibility path
12. `/구독` news add shows the candidate source and does not silently report success when automation or source wiring is missing

## 5) Daily Operations (Day 2)

### 5.0 Runtime Artifacts (Role and VCS Policy)

Runtime artifact files are operational outputs, not source-of-truth code/docs. They are useful for
diagnostics, replay, and local fallback, but should not be committed as routine code changes.

Primary files:

- `.runtime/worker-approvals.json`
  - Role: file-backend fallback store for worker approval queue/state.
  - Producer: `src/services/workerGeneration/workerApprovalStore.ts`
  - Notes: mutable runtime state; DB backend is preferred in production.
- `tmp/autonomy/openjarvis-unattended-last-run.json`
  - Role: latest unattended workflow summary pointer.
  - Producer: `scripts/run-openjarvis-unattended.mjs`, `scripts/run-openjarvis-goal-cycle.mjs`
- `tmp/autonomy/workflow-sessions/*.json`
  - Role: per-run state transitions and handoff evidence timeline.
  - Producer: `scripts/openjarvis-workflow-state.mjs`

Interactive goal-cycle commands:

- `npm run openjarvis:goal:run -- --objective="<goal>" --dryRun=true|false --routeMode=auto|delivery|operations`
- `npm run openjarvis:goal:run:hidden -- --objective="<goal>" --dryRun=true|false --routeMode=auto|delivery|operations`
- `npm run openjarvis:autopilot:start -- --objective="<goal>" --dryRun=false --routeMode=auto|delivery|operations`
- `npm run openjarvis:autopilot:resume`
- `npm run openjarvis:autopilot:loop -- --objective="<goal>" --dryRun=false --routeMode=operations`
- `npm run openjarvis:goal:status`
- `npm run openjarvis:packets:sync`
- `npm run agent:context:audit`

Hermes runtime continuity dry-run checks:

- `npm run openjarvis:hermes:runtime:chat-launch:auto -- --objective="monitor queue reentry health and recover stale supervisor continuity" --runtimeLane=operator-personal --dryRun=true`
- `npm run openjarvis:hermes:runtime:chat-launch:distiller -- --objective="promote the Hermes runtime profile family outcome into shared wiki and changelog" --runtimeLane=operator-personal --dryRun=true`
- `npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed --profile=distiller --promoteImmediately=true --summary="<one line closeout>" --nextAction="<next bounded step>" --dryRun=true`

Expected dry-run reading:

- `chat-launch:auto` should resolve queue, reentry, supervisor, and recovery objectives into the `guardian` profile and attach the runbook, runtime contract, and continuity packet files.
- `chat-launch:distiller` should keep the explicit `distiller` profile and attach changelog, archaeology, and shared-knowledge contract docs instead of implementation-heavy files.
- `reentry-ack` dry-runs should report `knowledgePromotion.status=skipped` with `dry_run` in `skippedReasons`; promotion becomes a real write only when `--dryRun=false`.
- use the `--name=value` form exactly; these scripts do not reliably parse spaced CLI arguments.
- session-start dry-runs may legitimately return `remediation: null` when the supervisor is already alive. Treat that as healthy no-op behavior, not as a restart failure.

Operational intent:

- `openjarvis:goal:run` reuses the unattended engine but stamps the run as `interactive:goal`, which makes user-driven objective cycles inspectable through the same workflow artifact paths instead of inventing a second orchestration surface.
- On Windows, `openjarvis:goal:run` and `openjarvis:autopilot:start` open a visible PowerShell window by default so Hermes activity is operator-visible instead of silently hidden behind a background process.
- The visible PowerShell is a monitor surface, not the continuity runner itself. The actual runner is detached, writes logs under `tmp/autonomy/launches/*.log`, and its latest launch metadata is mirrored to `tmp/autonomy/launches/latest-interactive-goal.json` so the session can continue even if the monitor window closes.
- The continuity runner now syncs one stable handoff packet and one stable progress packet into Obsidian at session start and completion, and mirrors them into the local vault path so packet recovery does not depend on remote adapter auth. `openjarvis:packets:sync` can be used to repair or refresh that packet state from the latest workflow session.
- Packet resume and the bounded supervisor loop now live in the same launcher surface: resume derives the next cycle from the local packet mirror, while the supervisor loop keeps polling packet state after the monitor closes and only launches again when the packet is explicitly resumable.
- `openjarvis:goal:status` now exposes packet resumability, loop supervisor state, and the last auto-open VS Code CLI bridge result, so operators can tell whether the editor control plane was actually exercised.
- `openjarvis:goal:run:hidden` and `--visibleTerminal=false` preserve headless validation for CI, dry checks, or editor-driven inline debugging.
- `agent:context:audit` is the fast path for finding large always-on instructions, broad `applyTo` instructions, and oversized SKILL/workflow files before adding more prompt surface area.

VCS policy:

- These files are gitignored by default.
- Default policy: runtime artifacts are not tracked in VCS.
- Incident evidence or test fixture commits are allowed only with minimal scope.
- Exception commits include purpose, time window, and retention or removal plan in the same change set.

### 5.1 Runtime Health

- Monitor:
  - `/health`
  - `/ready`
  - `/api/bot/status`
- Treat `/ready` as the deployment and restart gate. `/health` stays intentionally informative even when Discord or automation readiness is still catching up.
- When `RENDER_API_KEY` is configured, internal Render tooling can use `deploy.trigger`, `deploy.rollback`, `job.list`, `job.details`, `job.create`, and `job.cancel` for ad-hoc operations without changing the permanent service definition.
- `GET /api/bot/agent/runtime/loops` now includes `obsidianInboxChatLoop`; treat it like a first-class background loop during rollout and rollback decisions.
- Review Render logs for restart loops, auth failures, and upstream timeouts.

### 5.1.1 Obsidian Control-Plane Checks

1. `GET /api/bot/agent/obsidian/runtime`
2. `GET /api/bot/agent/obsidian/knowledge-control?artifact=lint`
3. `GET /api/bot/agent/runtime/knowledge-control-plane?guildId=<id>`

Expected reading:

- `vaultHealth.remoteMcp` shows whether the shared GCP vault service is reachable, authenticated, and exposing obsidian tools.
- `inboxChatLoop` shows whether unattended `chat/inbox` processing is enabled, how frequently it runs, and whether it is making forward progress.
- `compiler.lastLintSummary` should explain missing `source_refs`, stale active notes, invalid lifecycle metadata, or canonical collisions before retrieval quality is trusted.
- `knowledge-control-plane.snapshot.obsidian.cacheStats` and `retrievalBoundary` distinguish metadata-truth issues from Supabase cache issues.

### 5.1.2 A-003 Operator Verification

When A-003 readiness or release gating is under review, verify in this order:

1. `GET /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5`
2. `GET /api/bot/agent/runtime/unattended-health?guildId=<id>&actionName=operate.ops`
3. `GET /api/bot/agent/runtime/readiness?guildId=<id>`

Expected reading:

- `workerApprovals.pendingApprovals` shows the guild-scoped queue backlog.
- `policyBindings.executorPolicy.runMode` is the canonical field and remains `approval_required` unless an operator-approved exception is active. Legacy alias `policyBindings.opencodeExecutePolicy.runMode` is still emitted for compatibility.
- `llmRuntime.workflowBinding`, `llmRuntime.gateProviderProfile`, `llmRuntime.effectiveProviderProfile`, `modelFallback.defaultProviderFallbackChain`, and `providerPolicyBindings` match the intended provider routing. When `gateProviderProfile` is non-null, treat it as an active temporary circuit-breaker override rather than the steady-state workflow default.
- `safetySignals` stays at `approvalRequiredCompliancePct=100`, `unapprovedAutodeployCount=0`, and `policyViolationCount=0` for the guild under review.
- `delegationEvidence.complete=true` and `missingDelegationExecutions=0` prove the OpenDev -> NemoClaw sandbox path was not bypassed.
- `globalArtifacts.latestGateDecision` confirms the latest provider fallback trigger/target and safety verdict.
- `globalArtifacts.runtimeLoopEvidence` is attached before weekly gate evidence is treated as complete.

If these surfaces disagree, keep high-risk Opencode execution blocked until the mismatch is explained in the incident or release evidence bundle.

### 5.2 Data Health

- Watch for missing schema fallback warnings.
- Verify memory pipelines continue to persist and retrieve expected rows.
- Confirm `guild_lore_docs` freshness is within expected sync window.
- Confirm ops-loop lock behavior is healthy (`.runtime/obsidian-ops-loop.lock` is not stale).
- Confirm knowledge compiler lint remains clean enough for the current rollout and that `source_refs` warnings are understood before promoting unattended inbox answering.
- Confirm aggregate loop failure rate remains below configured threshold (`OBSIDIAN_OPS_MAX_FAILURE_RATE`).
- Confirm reward/telemetry snapshots are generated on schedule for active guilds.

### 5.3 Deployment Hygiene

Before deploy:

1. `npm run lint`
2. `npm run docs:check` (if route/schema impact expected)
3. Validate env deltas and secrets rotation status

After deploy:

1. Re-run health checks
2. Perform one authenticated admin endpoint smoke check
3. Confirm bot command response in at least one production guild

## 6) Incident Response

Severity model (suggested):

- SEV-1: API unavailable, bot fully offline, or auth completely broken
- SEV-2: partial degradation, automation failures, elevated error rate
- SEV-3: non-critical feature failure or delayed batch processing

### 6.1 Immediate Mitigation Playbook

1. Identify blast radius:
   - API-only, bot-only, frontend-only, data-only, or sync-only
2. Check recent changes:
   - deployment, env edits, schema changes, key rotation
3. Stabilize service:
   - restart Render service if stuck
   - pause optional loops if needed (`START_TRADING_BOT=false`, automation toggles)
4. Protect data correctness:
   - avoid manual table edits without traceability

### 6.2 Common Fault Domains

- Discord token/OAuth misconfiguration
- Supabase key/schema mismatch
- CORS allowlist drift between Render and Vercel
- Upstream provider timeout/rate limiting
- Obsidian sync worker not running or vault path inaccessible

### 6.3 Operator Decision Matrix (Who/When/Threshold/Action)

Use `docs/OPERATOR_SOP_DECISION_TABLE.md` as the default decision source during active operations.

Mandatory execution sequence:

1. Query four signals first: Health, FinOps budget, Memory quality, Go/No-Go.
2. Determine decision state from threshold tables (normal/degraded/blocked or SEV level).
3. Execute automatic action first, then complete role-specific manual SOP within SLA.
4. Record evidence in `docs/ONCALL_INCIDENT_TEMPLATE.md` and communicate via `docs/ONCALL_COMMS_PLAYBOOK.md` cadence.

Decision priority when multiple thresholds trigger:

1. SEV-1 safety and availability
2. FinOps `blocked` controls
3. Memory quality degradation controls
4. Optimization and routine operations

## 7) Recovery and Backfill

### 7.1 Supabase Recovery

1. Confirm credential validity.
2. Re-apply missing schema objects from `docs/SUPABASE_SCHEMA.sql`.
3. Validate critical read/write paths from API.

### 7.2 Obsidian Memory Backfill

1. Run `npm run sync:obsidian-lore:dry`.
2. Run `npm run sync:obsidian-lore`.
3. Confirm target rows in `guild_lore_docs` updated.

### 7.3 Bot Runtime Recovery

1. Check token presence and guild permission changes.
2. Restart process.
3. Verify slash command behavior and runtime status endpoints.

## 8) Security and Secrets

- Never expose service-role keys in client apps.
- Keep `DEV_AUTH_ENABLED=false` in production.
- Use strong, rotated `JWT_SECRET`.
- Restrict admin operations using allowlist policy (`user_roles` or static IDs).
- Store webhook URLs and tokens only in secret managers.
- Follow `docs/SECRET_ROTATION_AND_SUPABASE_RO_ROLLOUT.md` when rotating credentials or enabling the shared `supabase_ro` surface.

## 9) Change Management

For any change touching routes, persistence, runtime controls, or auth:

1. Update relevant docs.
2. If architecture meaning changed, update `docs/ARCHITECTURE_INDEX.md` and `docs/CHANGELOG-ARCH.md`.
3. Regenerate and verify generated docs with `npm run docs:build` / `npm run docs:check`.
4. Record rollback strategy before release.

For memory/agent loop changes specifically:

1. Update `docs/OBSIDIAN_SUPABASE_SYNC.md` when bootstrap/sync/loop/reward behavior changes.
2. Memory agent roadmap has been archived to `docs/archive/LONG_TERM_MEMORY_AGENT_ROADMAP.md`.
3. Add an entry to `docs/CHANGELOG-ARCH.md` for architecture-significant automation changes.

## 10) Command Reference

Core commands:

```bash
npm run env:check
npm run lint
npm run build
npm run start
npm run docs:build
npm run docs:check
npm run smoke:api
npm run mcp:unified:dev
npm run mcp:indexing:dev
npm run worker:crawler
npm run sync:obsidian-lore:dry
npm run sync:obsidian-lore
npm run memory:queue:report
npm run memory:queue:report:dry
```

## 11) Progressive Autonomy Evolution Operations

This section defines how to run staged autonomy evolution safely.

### 11.1) Stage Model

1. Stage A: control-plane boundary split (in-process)
2. Stage B: queue-first split for heavy memory jobs
3. Stage C: trading runtime isolation readiness and canary

Rule:

- Never advance to next stage unless all gates pass in current stage.

### 11.2) Mandatory Runtime Contracts

All new automation paths must include these records:

1. Event envelope:

- event_id, event_type, event_version, occurred_at, guild_id, actor_id, payload, trace_id

1. Command envelope:

- command_id, command_type, requested_by, requested_at, idempotency_key, policy_context, payload

1. Policy decision record:

- decision, reasons[], risk_score, budget_state, review_required, approved_by

1. Evidence bundle:

- ok, summary, artifacts[], verification[], error, retry_hint, runtime_cost

### 11.3) Go/No-Go Gate Checklist

Template source:

- `docs/planning/GO_NO_GO_GATE_TEMPLATE.md`

Execute in this order:

1. Reliability gate

- p95 latency within threshold
- MTTR within threshold
- queue lag within threshold

1. Quality gate

- citation_rate within threshold
- retrieval_hit@k within threshold
- hallucination_review_fail_rate within threshold

1. Safety gate

- approval_required compliance 100%
- unapproved auto-deploy count 0
- attach `GET /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5` evidence and verify gate -> approval -> fallback chain

1. Governance gate

- roadmap/execution-board/backlog/runbook/changelog sync completed

Decision:

- If any gate fails: no-go and rollback immediately.

### 11.4) Rollback Operations

1. Stage rollback

- Route traffic back to previous stable path
- freeze new stage writes until incident review closes

1. Render deploy rollback

- Identify the candidate deploy from Render deploy history before restarting the whole service.
- Prefer a targeted rollback to a known deploy ID when only the latest Render deploy is bad.
- If `RENDER_API_KEY` is configured, internal tooling can use `deploy.list`, `deploy.details`, and `deploy.rollback` for this step.

1. Queue rollback

- stop enqueue for impacted task type
- drain consumers and resume synchronous fallback path

1. Provider rollback

- force quality-optimized profile when quality gate fails

1. Evidence logging

- for every rollback: record cause, impact, mitigation, prevention in incident template
- execute `npm run rehearsal:stage-rollback:record -- --maxRecoveryMinutes=10` and keep the generated md/json artifact pair under `docs/planning/gate-runs/rollback-rehearsals/`

### 11.5) Canary Procedure

1. Select one pilot guild
2. Enable stage feature flags for canary only
3. Observe 24h with gate metrics
4. Expand only if all gates pass twice consecutively
5. If failed, rollback within 10 minutes and document evidence

Rollback rehearsal weekly consolidation:

- `npm run gates:weekly-report:rollback`
- `npm run gates:weekly-report:rollback:dry`

Daily execution checklist source:

- `docs/archive/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md` (ARCHIVED)

Contract validation source:

- `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`

Harness release commands:

```bash
npm run lint
npm run docs:check
npm run smoke:api
```

## 10.1) Generic Action Runtime (Commercial Readiness)

Current runtime supports a controlled generic action layer via `ops-execution`:

- `youtube.search.first`
- `stock.quote`
- `stock.chart`
- `investment.analysis`
- `rag.retrieve` (guild memory retrieval with citation-first evidence)
- `youtube.search.webhook` (YouTube 검색 결과를 MCP 워커가 Discord webhook으로 전송)
- `privacy.forget.user` (user-scoped right-to-be-forgotten purge)
- `privacy.forget.guild` (guild-scoped full purge, confirm token required)
- `web.fetch` (host allowlist required)
- `db.supabase.read` (read-only, table allowlist, row limit)
- `implement.execute` (legacy runtime id: `opencode.execute`) — MCP-delegated sandbox terminal execution, policy-first

Safety controls (must be set explicitly in production):

- `ACTION_RUNNER_MODE=execute|dry-run`
- `ACTION_ALLOWED_ACTIONS` (comma list or `*`)
- `ACTION_WEB_FETCH_ALLOWED_HOSTS` (comma host allowlist)
- `ACTION_DB_READ_ALLOWED_TABLES` (read-only tables)
- `ACTION_DB_READ_MAX_ROWS`
- `ACTION_POLICY_TABLE`
- `ACTION_APPROVAL_TABLE`
- `ACTION_APPROVAL_TTL_MS`

Admin APIs for tenant-level governance:

- `GET /api/bot/agent/actions/policies?guildId=<id>`
- `PUT /api/bot/agent/actions/policies`
  - body: `{ guildId, actionName, enabled, runMode }`
  - runMode: `auto | approval_required | disabled`
- `GET /api/bot/agent/actions/approvals?guildId=<id>&status=pending`
- `POST /api/bot/agent/actions/approvals/:requestId/decision`
  - body: `{ decision: 'approve'|'reject', reason? }`
- `POST /api/bot/agent/opencode/bootstrap-policy`
  - body: `{ guildId, runMode?, enabled? }` (default runMode=`approval_required`)
- `GET /api/bot/agent/opencode/summary?guildId=<id>&days=7`
- `POST /api/bot/agent/opencode/change-requests`
  - body: `{ guildId, title, summary?, files?, diffPatch?, targetBaseBranch?, proposedBranch?, sourceActionLogId? }`
- `GET /api/bot/agent/opencode/change-requests?guildId=<id>&status=review_pending`
- `POST /api/bot/agent/opencode/change-requests/:changeRequestId/decision`
  - body: `{ guildId, decision: 'approve'|'reject'|'published'|'failed', note?, publishUrl? }`
- `POST /api/bot/agent/opencode/change-requests/:changeRequestId/queue-publish`
  - body: `{ guildId, provider?, payload? }`
- `GET /api/bot/agent/opencode/publish-queue?guildId=<id>&status=queued`
- `GET /api/bot/agent/opencode/readiness?guildId=<id>`
- `GET /api/bot/agent/conversations/threads?guildId=<id>&requestedBy=<userId?>&limit=50`
- `GET /api/bot/agent/conversations/threads/:threadId/turns?guildId=<id>&limit=200`
- `GET /api/bot/agent/conversations/by-session/:sessionId?guildId=<id>`

Recommended production baseline:

1. Start with `ACTION_RUNNER_MODE=dry-run` in first rollout window
2. Restrict `ACTION_ALLOWED_ACTIONS` to required subset only
3. Set strict host/table allowlists before enabling `execute`
4. Review `agent_action_logs` regularly for policy and quality drift

Discord operator surface:

- Preferred ask command: `/뮤엘`
- Compatibility alias: `/해줘`
- Relationship and memory surfaces: `/프로필`, `/메모`
- Threaded implementation surface: `/만들어줘`

MCP delegation controls:

- `ACTION_MCP_DELEGATION_ENABLED`
- `ACTION_MCP_STRICT_ROUTING`
- `ACTION_MCP_TIMEOUT_MS`
- `MCP_YOUTUBE_WORKER_URL`
- `MCP_NEWS_WORKER_URL`
- `MCP_COMMUNITY_WORKER_URL`
- `MCP_WEB_WORKER_URL`
- `MCP_IMPLEMENT_WORKER_URL` (legacy alias: `MCP_OPENCODE_WORKER_URL`)
- `MCP_OPENCODE_TOOL_NAME`
- `AGENT_CONVERSATION_THREAD_IDLE_MS`
- `MCP_YOUTUBE_DEFAULT_WEBHOOK_URL`
- `CRAWLER_WORKER_WEB_ALLOWED_HOSTS`
- `CRAWLER_WORKER_FETCH_TIMEOUT_MS`
- `YOUTUBE_MONITOR_MCP_WORKER_URL`
- `YOUTUBE_MONITOR_MCP_TIMEOUT_MS`
- `YOUTUBE_MONITOR_MCP_STRICT`
- `NEWS_MONITOR_MCP_WORKER_URL`
- `NEWS_MONITOR_MCP_TIMEOUT_MS`
- `NEWS_MONITOR_MCP_STRICT`
- `NEWS_MONITOR_LOCAL_FALLBACK_ENABLED`
- `N8N_DISABLED`
- `N8N_ENABLED`
- `N8N_BASE_URL`
- `N8N_TIMEOUT_MS`
- `N8N_DELEGATION_ENABLED`
- `N8N_DELEGATION_FIRST`
- `N8N_API_KEY`
- `N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES`
- `OBSIDIAN_INBOX_CHAT_LOOP_ENABLED`
- `OBSIDIAN_INBOX_CHAT_LOOP_INTERVAL_SEC`
- `OBSIDIAN_INBOX_CHAT_LOOP_RUN_ON_START`
- `OBSIDIAN_INBOX_CHAT_LOOP_MAX_NOTES_PER_RUN`
- `OBSIDIAN_INBOX_CHAT_LOOP_SEARCH_LIMIT`

Local n8n bootstrap:

1. Generate local-only runtime files: `npm run n8n:local:bootstrap`
2. Review `tmp/n8n-local/.env` and change `N8N_BASIC_AUTH_PASSWORD`
3. Start the container: `npm run n8n:local:start`
4. Review `tmp/n8n-local/starter-workflows.manifest.json` and the generated starter bundle under `tmp/n8n-local/workflows/`
5. Generate or repair the repo-managed local public API key when you want public API CRUD/update support: `npm run n8n:local:api-key:ensure`
6. Seed the full starter bundle: `npm run n8n:local:seed`
7. If `N8N_API_KEY` is absent but the local container is running, the seed command first tries local public API auto-provision and then falls back to container CLI import automatically.
8. Review the seeded workflows you want to keep. The starter bundle now imports active by default so localhost webhook execution works immediately.
9. Re-apply the repo env profile if needed: `npm run env:profile:local`, `npm run env:profile:local-first-hybrid`, `npm run env:profile:local-openclaw-stack`, `npm run env:profile:local-nemoclaw-stack`, or `npm run env:profile:local-nemoclaw-max-delegation`
10. Verify readiness: `npm run n8n:local:doctor`

Operator notes:

- In this repo, local self-hosted n8n means the OSS Docker image is downloaded into Docker Desktop on this machine, the `muel-local-n8n` container is running locally, and state is persisted under `tmp/n8n-local/data`.
- Webhook delegation can work before `N8N_API_KEY` is configured.
- `N8N_API_KEY` is not the installation itself. It only unlocks repo-driven public API CRUD/update behavior.
- For local n8n 2.15.x in this repo, `npm run n8n:local:api-key:ensure` can generate or repair a working repo-managed public API key without a manual UI step.
- Local, local-first-hybrid, local-openclaw-stack, local-nemoclaw-stack, and local-nemoclaw-max-delegation env profiles now stamp concrete `N8N_WEBHOOK_*` defaults and force direct-vault-first Obsidian routing (`local-fs`/`native-cli` first, `remote-mcp` fallback). Keep delegation off until the matching workflows are seeded or imported; the starter bundle now marks them active by default.
- `npm run n8n:local:seed` now tries local public API auto-provision first, then uses the dedicated activate/deactivate routes so the starter bundle really comes up active on localhost, and still performs initial local starter import without `N8N_API_KEY` by using the running container CLI when public API CRUD is unavailable.
- `n8n.workflow.list` and the `n8n.status` skill surface can fall back to the running local container CLI when the public API returns `401`, so local workflow discovery is still possible before `N8N_API_KEY` is configured.
- `n8n.workflow.execute` now retries through the workflow's webhook path when local n8n 2.15 rejects `POST /api/v1/executions`, and the seeded starter workflows now import active by default so that fallback works locally without a manual activation toggle.
- `n8n.workflow.status` and updateExisting/public-API workflow CRUD still require `N8N_API_KEY`, but the repo can provision that key locally with `npm run n8n:local:api-key:ensure`.
- The starter bundle now covers `news-rss-fetch`, `news-summarize`, `news-monitor-candidates`, `youtube-feed-fetch`, `youtube-community-scrape`, `alert-dispatch`, and `article-context-fetch`.
- The `alert-dispatch` starter intentionally fails unless you provide a real sink, so inline fallback remains intact until you wire one.
- `local-nemoclaw-max-delegation` is the explicit opt-in profile for “delegate as much as possible without breaking the 24-hour lane”: it enables n8n delegation, turns on delegation-first for configured news/youtube/article-context tasks so inline fallbacks stay off, explicitly disables the legacy local news and YouTube fallback lanes, pins implement/review/operate/OpenJarvis control surfaces to the canonical GCP lane, and leaves `N8N_WEBHOOK_ALERT_DISPATCH` blank so runtime alerts stay on the inline webhook path until a real n8n sink exists.
- Generated files live under `tmp/n8n-local/`, which is git-ignored in this repo.

Worker-first lightweight split status:

- `youtube.search.first`: worker-first, local heavy parser 제거
- `youtube.search.webhook`: worker-only webhook execution
- `youtube-monitor` 수집/파싱: worker 툴(`youtube.monitor.latest`)로 오프로드
- `news-monitor` 수집/파싱: worker 툴(`news.monitor.candidates`)로 오프로드
- `news.google.search`: worker-first, local RSS parser 제거
- `community.search`: delegation-only
- `web.fetch`: worker-first (strict mode에서 worker 필수)

YouTube lightweight worker split example:

- Action: `youtube.search.webhook`
- Worker Tool: `youtube.search.webhook`
- Required input: `query`
- Webhook target:
  - action args `webhookUrl`, or
  - fallback env `MCP_YOUTUBE_DEFAULT_WEBHOOK_URL`
- Safety: worker accepts Discord webhook domain/path only (`discord.com/api/webhooks/*`)

Privacy forget controls:

- `FORGET_ON_GUILD_DELETE` (auto purge on Discord `guildDelete` event)
- `FORGET_OBSIDIAN_ENABLED` (also remove mapped Obsidian paths)

Privacy APIs:

- `GET /api/bot/agent/privacy/forget-preview?scope=user&userId=<id>&guildId=<id?>`
  - self preview allowed; other-user/guild preview requires admin
- `POST /api/bot/agent/privacy/forget-user` (authenticated; self by default)
  - body: `{ userId?, guildId?, confirm, deleteObsidian?, reason? }`
  - self erase confirm: `FORGET_USER`
  - admin erase-other confirm: `FORGET_USER_ADMIN`
  - non-admin users can only erase their own userId
- `POST /api/bot/agent/privacy/forget-guild` (admin only)
  - body: `{ guildId, confirm: 'FORGET_GUILD', deleteObsidian?, reason? }`

Owner-user mapping migration:

1. Apply updated `docs/SUPABASE_SCHEMA.sql` (adds `memory_items.owner_user_id`)
2. Run `npm run privacy:backfill-memory-owner`
3. Verify deletion preview counts before enabling bulk forget flows

Safety note:

- `privacy.forget.guild` is treated as high-risk and routed through approval by default in action runtime.
- Exception: trusted system actor path (`system:guildDelete`) can execute immediate purge for Discord server removal events.

## 10.2) RAG Retrieval Operations

`rag.retrieve` is designed to run first for evidence-heavy goals before external fetch/analysis actions.

Intent examples where RAG should be prioritized:

- "지난주 결정 근거를 출처와 함께 요약해줘"
- "우리 길드 정책 기억에서 관련 내용 찾아줘"
- "근거 기반으로 분석해줘"

Expected action-chain behavior:

1. `rag.retrieve` first (query from user goal, optional memory type filter)
2. Optional follow-up actions (`investment.analysis`, `web.fetch`, `db.supabase.read`)
3. Final response should preserve citation-first structure

Optional args for `rag.retrieve`:

- `query`: override retrieval query string
- `limit`: top-k retrieval size (1-20)
- `type` or `memoryType`: one of `episode | semantic | policy | preference`

Operational checks:

1. Confirm `memory_items` and `memory_sources` retrieval quality
2. Review `memory_retrieval_logs` latency and returned-count trends
3. If empty retrieval persists, verify guild ingest/sync freshness and query wording

## 10.3) Harness Runtime Operations

Harness references:

- `docs/HARNESS_ENGINEERING_PLAYBOOK.md`
- `docs/HARNESS_MANIFEST.example.yaml`
- `docs/HARNESS_RELEASE_GATES.md`

Runtime deadletter and recovery APIs:

- `GET /api/bot/agent/deadletters?guildId=<id>&limit=<n>`
- `GET /api/bot/agent/memory/jobs/deadletters?guildId=<id>&limit=<n>`
- `POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue`

Recommended pre-release sequence:

1. Run Gate 1 checks (`lint`, `docs:check`).
2. Run Gate 2 health APIs (`/health`, `/ready`, `/api/bot/status`).
3. Verify deadletters are triaged and not growing unexpectedly.
4. Apply Go/No-Go decision from `docs/OPERATOR_SOP_DECISION_TABLE.md`.

Provider harness note:

- Current runtime supports `openai`, `gemini`, `anthropic`, `openclaw`, `ollama`.
- If provider is unavailable, session creation fails by design to avoid silent degraded outputs.

## 10.4) Full Executor Profile (Alternative 2: Permissive-License Stack)

Goal:

- Build a Full Executor without depending on restrictive licenses, using permissive-license components (MIT/Apache-2.0 class).
- Keep existing action-governance and approval controls in this platform as the control plane.

Important interpretation of "self-replication":

- Do not operate uncontrolled self-replication behavior.
- Use controlled self-expansion only:
  - dynamic worker proposal -> approval -> bounded activation
  - fail-closed defaults and automatic rollback on instability

Relationship with `implement.execute` / `opencode.execute`:

- `implement.execute` is the canonical executor contract exposed to new planning/runtime surfaces.
- `opencode.execute` remains the persisted legacy runtime id and backward-compatible API surface.
- Alternative 2 replaces the backend executor worker, not the platform interface.
- Operationally:
  - Keep policy/approval/queue endpoints unchanged
  - Swap worker implementation behind `MCP_IMPLEMENT_WORKER_URL`
  - Preserve action logs and governance history continuity

Result:

- Opencode does not become "unused".
- The channel remains active as an executor abstraction; only its backend engine changes.

### 10.4.1) Recommended Operating Mode

1. Interface freeze:

- Keep `implement.execute` as the canonical contract while preserving `opencode.execute` as a compatibility alias.
- Keep admin APIs under `/api/bot/agent/opencode/*` for backward-compatible operations.

1. Worker replacement:

- Deploy permissive-license executor worker and connect it to `MCP_IMPLEMENT_WORKER_URL`.
- Keep `MCP_OPENCODE_TOOL_NAME=opencode.run` unless contract migration is completed.

1. Governance first:

- Start with `runMode=approval_required`.
- Expand to `auto` only for low-risk guilds/scopes after error-rate review.

### 10.4.2) Controlled Self-Expansion Loop

Use this bounded loop for "autonomous growth" in production:

1. Detect missing capability from action/runtime failures.
1. Generate worker proposal with scope and test plan.
1. Require approval (human or policy gate).
1. Activate in shadow/canary guild scope.
1. Promote to wider scope only when SLO and failure thresholds pass.
1. Auto-disable and rollback on threshold breach.

Mandatory controls:

- Max concurrent dynamic workers per guild
- TTL for newly activated workers
- Budget cap and timeout cap per worker/task
- Deadletter/requeue visibility for every failed run
- Hard deny for destructive operations unless explicit break-glass mode is enabled
- For multi-instance deployments, enable distributed lock for publish worker and keep fail-open disabled by default.
- Keep admin action rate-limit in fail-closed mode when distributed limiter backend is unavailable.

Recommended promotion defaults (Two-Track):

- Keep one-off capabilities in ephemeral path by default (no registry activation).
- Promote to persistent worker/proposal queue only when all thresholds pass in the recent 7-day window:
  - Request frequency >= 5
  - Distinct requesters >= 3
  - Average outcome score >= 0.65
  - Policy-block rate <= 0.10
- Start conservative; tune per guild after weekly report review.

### 10.4.3) Break-Glass for Near-Unrestricted Execution

If near-unrestricted execution is needed:

1. Use isolated runtime (ephemeral container/VM per high-risk task).
2. Issue short-lived credentials only.
3. Enable full audit logging and session replay.
4. Enforce two-step approval for break-glass token issuance.
5. Auto-expire token and destroy runtime after completion.

This provides "Full Executor" experience while keeping platform-level safety and incident recoverability.

### 10.4.4) Publish Worker Cutover (Code Improvement Completion)

To complete actual code-improvement automation, implement and enable the publish worker described in:

- `docs/planning/OPENCODE_PUBLISH_WORKER_MIN_SPEC.md`

Current implementation note:

- Backend bootstrap includes publish worker loop startup when `OPENCODE_PUBLISH_WORKER_ENABLED=true`.

Execution sequence (minimum):

1. Apply latest schema and confirm queue tables are healthy.
1. Configure GitHub credentials and target repo env values.
1. Enable worker in shadow mode (no real PR creation).
1. Run canary guild cutover with approval-required policy.
1. Validate E2E path:

- change request create -> approve -> queue publish -> PR created

1. Promote scope only after failure-rate and queue-latency checks pass.

Operational answer:

- If only MCP executor worker is added, execution automation is available but code publish remains pending.
- If publish worker is added too, the platform supports closed-loop code improvement (execution + PR publication).

## 10.5) Formal Turn Model (Conversation Threads)

Purpose:

- Persist user/assistant interaction history as ordered turns for replay, debugging, and quality review.

Current model:

- Thread table: `agent_conversation_threads`
- Turn table: `agent_conversation_turns`
- Session linkage: `agent_sessions.conversation_thread_id`, `agent_sessions.conversation_turn_index`

Runtime behavior:

1. Session start records a `user` turn.
2. Session terminal response records an `assistant` turn.
3. If the latest thread is idle beyond `AGENT_CONVERSATION_THREAD_IDLE_MS`, a new thread is created.

Operational checks:

1. Verify thread growth and last-turn freshness using `/api/bot/agent/conversations/threads`.
2. Inspect ordered turns for a thread via `/api/bot/agent/conversations/threads/:threadId/turns`.
3. Trace a session back to conversation history via `/api/bot/agent/conversations/by-session/:sessionId`.

Privacy:

- User/guild forget flow includes conversation thread/turn deletion scope.

## 10.5.1) Unattended GoT Cutover Autopilot

Purpose:

- Reflect dashboard cutover readiness into `agent_got_cutover_profiles` automatically without manual ops.

Env controls:

- `AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED=true`
- `AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN=60`
- `AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS=100`
- `AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT=100`
- `AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES=20`

Runtime behavior:

1. Loop runs every `AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN` minutes.
1. For each guild, it evaluates `getAgentGotCutoverDecision(forceRefresh=true)`.
1. It upserts `agent_got_cutover_profiles`:

- readiness recommended: `rollout_percentage=AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT`
- readiness not recommended: `rollout_percentage=0`

1. Last run state is visible in `GET /api/bot/agent/policy` under `ops` snapshot.

Manual trigger:

- `POST /api/bot/agent/got/cutover/autopilot/run` (body optional: `guildId`)

## 10.5.2) Unattended Control-Plane Hardening

Purpose:

- Prevent duplicate execution on admin write APIs and survive telemetry backlog during restart/failover.

Runtime controls:

- API idempotency:

1. `API_IDEMPOTENCY_TABLE=api_idempotency_keys`
2. `API_IDEMPOTENCY_TTL_SEC=86400`
3. `API_IDEMPOTENCY_REQUIRE_HEADER=false` (운영 안정화 후 true 권장)

- Durable telemetry queue:

1. `AGENT_TELEMETRY_DURABLE_QUEUE_ENABLED=true`
2. `AGENT_TELEMETRY_DURABLE_TABLE=agent_telemetry_queue_tasks`
3. `AGENT_TELEMETRY_DURABLE_MAX_ATTEMPTS=5`
4. `AGENT_TELEMETRY_DURABLE_RETRY_BASE_MS=5000`
5. `AGENT_TELEMETRY_DURABLE_RETRY_MAX_MS=300000`
6. `AGENT_TELEMETRY_DURABLE_RECOVERY_BATCH=200`
7. `AGENT_TELEMETRY_DURABLE_STALE_RUNNING_MS=300000`

Operational checks:

1. `GET /api/bot/agent/runtime/unattended-health?guildId=<id>`로 합성 상태 점검.
2. `GET /api/bot/agent/runtime/telemetry-queue`에서 `durableEnabled`, `durableHealthy` 확인.
3. `POST` 관리자 API 호출 시 `Idempotency-Key` 헤더를 붙여 재시도 중복 실행 방지.

Expected behavior:

1. 같은 `Idempotency-Key` + 동일 payload 재요청은 기존 결과를 재생(`Idempotency-Replayed: true`)한다.
2. 같은 key를 다른 payload에 재사용하면 `409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`가 반환된다.
3. telemetry task 실행 실패는 지수 백오프로 재시도되고, 최대 시도 초과 시 durable queue에 `failed`로 남는다.

## 10.5.3) LLM Provider A/B + Self-Growth Policy

Purpose:

- Provider 비용/지연/성공률을 같은 지표로 비교하고, HF canary를 안전하게 검증한다.
- 자동 확장 범위를 운영 정책으로 명시한다.

Runtime controls:

1. `LLM_CALL_LOG_ENABLED=true`
2. `LLM_CALL_LOG_TABLE=agent_llm_call_logs`
3. `LLM_EXPERIMENT_ENABLED=true`
4. `LLM_EXPERIMENT_NAME=hf_ab_v1`
5. `LLM_EXPERIMENT_HF_PERCENT=20`
6. `LLM_EXPERIMENT_GUILD_ALLOWLIST=<guild-id-csv>`
7. `LLM_EXPERIMENT_FAIL_OPEN=true`
8. `HF_TOKEN=<secret>` 또는 `HF_API_KEY=<secret>` 또는 `HUGGINGFACE_API_KEY=<secret>`
9. `LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=true|false`
10. `LLM_PROVIDER_MAX_ATTEMPTS=<1..6>`
11. `LLM_PROVIDER_FALLBACK_CHAIN=openclaw,openai,...`
12. `LLM_PROVIDER_POLICY_ACTIONS=<pattern=provider1,provider2;...>`

HF token alias rule (code-aligned):

1. Hugging Face key resolution order는 `HF_TOKEN` -> `HF_API_KEY` -> `HUGGINGFACE_API_KEY`.
2. 위 3개 중 하나라도 유효하면 Hugging Face provider는 configured 상태로 간주된다.
3. 운영 템플릿은 `HF_TOKEN`을 표준 키로 사용하고, 나머지 2개는 하위 호환 alias로만 유지한다.

Provider fallback rule (code-aligned):

1. 요청이 `provider`를 명시하면 fallback 없이 해당 provider만 사용한다.
2. 미지정 시 provider chain 구성 순서는 `selected provider -> action policy -> LLM_PROVIDER_FALLBACK_CHAIN -> base resolver provider -> automatic fallback order(openclaw, openai, anthropic, gemini, huggingface, ollama)`이다.
3. chain은 중복 제거 후 "configured provider"만 남기고 `LLM_PROVIDER_MAX_ATTEMPTS`로 절단한다.
4. HF experiment arm에서 `LLM_EXPERIMENT_FAIL_OPEN=false`면 Hugging Face 단일 경로로 고정된다.
5. HF experiment arm에서 `LLM_EXPERIMENT_FAIL_OPEN=true`면 Hugging Face 우선 후 chain fallback을 허용한다.

Operational checks:

1. `GET /api/bot/agent/llm/experiments/summary?experimentName=hf_ab_v1&guildId=<id>&days=14`
2. `totals.avgLatencyMs`, `totals.estimatedCostUsd`, arm별 `successRate` 비교
3. `control` 대비 `huggingface` arm의 실패율/지연 악화 시 `LLM_EXPERIMENT_HF_PERCENT`를 즉시 하향

Self-growth profile (opencode.execute governance):

1. 조회: `GET /api/bot/agent/self-growth/policy?guildId=<id>`
2. 적용: `POST /api/bot/agent/self-growth/policy/apply` body `{ guildId, profile }`
3. `profile` 값:

- `human_gate`: `approval_required` (권장 기본값)
- `conditional_auto`: `auto` (지표 안정 시 제한적으로)
- `disabled`: 자동 확장 비활성

Recommended rollout:

1. `human_gate` + HF 10~20%로 시작
2. 7~14일 관측 후 성공률/지연/비용 악화가 없을 때만 `LLM_EXPERIMENT_HF_PERCENT` 확대
3. 자동 확장 전환(`conditional_auto`)은 정책 차단률과 실패 재시도율이 안정 구간일 때만 승인

## 10.5.4) Supabase Extensions Runtime Verification

When pgvector/pg_trgm/pg_cron/pg_net/pg_graphql/hypopg/pg_stat_statements are enabled:

1. `GET /api/bot/agent/runtime/supabase/extensions?includeTopQueries=true&topLimit=10`
1. Confirm all target extensions show `installed=true` in `snapshot.extensions`.
1. If `pg_stat_statements` is active, verify `snapshot.topQueries` is populated and review high `totalExecTime` queries.
1. Use `snapshot.notes` as migration hints for cron/job offloading and index tuning loops.

Operational utility endpoints:

1. List cron jobs:

- `GET /api/bot/agent/runtime/supabase/cron-jobs`

1. Ensure maintenance jobs (idempotency key cleanup + llm call log retention):

- `POST /api/bot/agent/runtime/supabase/cron-jobs/ensure-maintenance`
- body: `{ "llmRetentionDays": 30 }`

1. HypoPG candidate list:

- `GET /api/bot/agent/runtime/supabase/hypopg/candidates`

1. HypoPG hypothetical index evaluation:

- `POST /api/bot/agent/runtime/supabase/hypopg/evaluate`
- body: `{ "ddls": ["create index on ...", "create index on ..."] }`

Memory retrieval hybrid mode (pg_trgm):

1. Set `MEMORY_HYBRID_SEARCH_ENABLED=true` and tune `MEMORY_HYBRID_MIN_SIMILARITY`.
2. Validate memory search quality and retrieval latency from `/api/bot/agent/memory/search` + `memory_retrieval_logs`.

PM2 commands:

```bash
npm run pm2:start
npm run pm2:status
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
```

## 11) Runbook Review Cadence

Recommended:

- Weekly: verify links, commands, and ownership sections
- Monthly: review SLOs, incidents, and mitigation quality
- Per major release: validate this runbook against production reality

## 12) Incident Toolkit

Use these templates as the default operational flow:

1. Start incident timeline with `docs/ONCALL_INCIDENT_TEMPLATE.md`
2. Send updates using `docs/ONCALL_COMMS_PLAYBOOK.md`
3. Complete retrospective with `docs/POSTMORTEM_TEMPLATE.md`

Direct links:

- `docs/ONCALL_INCIDENT_TEMPLATE.md`
- `docs/ONCALL_COMMS_PLAYBOOK.md`
- `docs/POSTMORTEM_TEMPLATE.md`

Suggested lifecycle:

1. Detection and triage: fill sections 1-4 in incident template
2. Mitigation phase: continuously update timeline and mitigation log
3. Resolution phase: complete validation and handover notes
4. Within 24h: publish postmortem with tracked action items
5. If thresholds were crossed, update `docs/OPERATOR_SOP_DECISION_TABLE.md` within 24h for rule accuracy
