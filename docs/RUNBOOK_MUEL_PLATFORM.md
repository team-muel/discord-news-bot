# Muel Platform Unified Runbook

This is the single operational runbook for the Muel platform across Discord, Render, Supabase, Vercel, and Obsidian sync.

Use this document as the first entrypoint for DevOps/SRE operations.
Detailed domain docs are linked where needed, but this runbook is designed to be executable end-to-end.

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

Suggested baseline SLO (adjust as needed):

- API availability: 99.5%
- Discord bot readiness: 99.0%
- Obsidian sync freshness: within 60 minutes

## 2) Source of Truth

Open these first when verifying behavior:

- Runtime architecture index: `docs/ARCHITECTURE_INDEX.md`
- 24/7 runtime ops: `docs/OPERATIONS_24_7.md`
- Operator decision matrix: `docs/OPERATOR_SOP_DECISION_TABLE.md`
- Platform document control tower: `docs/planning/PLATFORM_CONTROL_TOWER.md`
- Harness playbook: `docs/HARNESS_ENGINEERING_PLAYBOOK.md`
- Harness manifest template: `docs/HARNESS_MANIFEST.example.yaml`
- Harness release gates: `docs/HARNESS_RELEASE_GATES.md`
- Frontend contract and CORS/auth details: `docs/FRONTEND_INTEGRATION.md`
- Supabase schema: `docs/SUPABASE_SCHEMA.sql`
- Obsidian sync operations: `docs/OBSIDIAN_SUPABASE_SYNC.md`
- MCP tool spec and rollout: `docs/planning/mcp/MCP_TOOL_SPEC.md`, `docs/planning/mcp/MCP_ROLLOUT_1W.md`
- Lightweight worker split: `docs/planning/mcp/LIGHTWORKER_SPLIT_ARCH.md`
- Generated route map: `docs/ROUTES_INVENTORY.md`
- Schema-service map: `docs/SCHEMA_SERVICE_MAP.md`

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
2. Set required env values:
   - `NODE_ENV=production`
   - `START_BOT=true`
   - `START_AUTOMATION_JOBS=true`
   - `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`)
   - `JWT_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_KEY`)
   - LLM keys (`AI_PROVIDER` + provider key)
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

## 5) Daily Operations (Day 2)

### 5.1 Runtime Health

- Monitor:
  - `/health`
  - `/ready`
  - `/api/bot/status`
- Review Render logs for restart loops, auth failures, and upstream timeouts.

### 5.2 Data Health

- Watch for missing schema fallback warnings.
- Verify memory pipelines continue to persist and retrieve expected rows.
- Confirm `guild_lore_docs` freshness is within expected sync window.

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

## 9) Change Management

For any change touching routes, persistence, runtime controls, or auth:

1. Update relevant docs.
2. If architecture meaning changed, update `docs/ARCHITECTURE_INDEX.md` and `docs/CHANGELOG-ARCH.md`.
3. Regenerate and verify generated docs with `npm run docs:build` / `npm run docs:check`.
4. Record rollback strategy before release.

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
npm run mcp:dev
npm run worker:crawler
npm run sync:obsidian-lore:dry
npm run sync:obsidian-lore
```

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

Recommended production baseline:

1. Start with `ACTION_RUNNER_MODE=dry-run` in first rollout window
2. Restrict `ACTION_ALLOWED_ACTIONS` to required subset only
3. Set strict host/table allowlists before enabling `execute`
4. Review `agent_action_logs` regularly for policy and quality drift

MCP delegation controls:

- `ACTION_MCP_DELEGATION_ENABLED`
- `ACTION_MCP_STRICT_ROUTING`
- `ACTION_MCP_TIMEOUT_MS`
- `MCP_YOUTUBE_WORKER_URL`
- `MCP_NEWS_WORKER_URL`
- `MCP_COMMUNITY_WORKER_URL`
- `MCP_WEB_WORKER_URL`
- `MCP_YOUTUBE_DEFAULT_WEBHOOK_URL`
- `CRAWLER_WORKER_WEB_ALLOWED_HOSTS`
- `CRAWLER_WORKER_FETCH_TIMEOUT_MS`
- `YOUTUBE_MONITOR_MCP_WORKER_URL`
- `YOUTUBE_MONITOR_MCP_TIMEOUT_MS`
- `YOUTUBE_MONITOR_MCP_STRICT`
- `NEWS_MONITOR_MCP_WORKER_URL`
- `NEWS_MONITOR_MCP_TIMEOUT_MS`
- `NEWS_MONITOR_MCP_STRICT`

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
