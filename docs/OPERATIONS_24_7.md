# 24/7 Operations Runbook (Server + Discord Bot + Automation Jobs)

This project runs one Discord bot plus automation jobs from the server process (`server.ts`).
Use PM2 to keep the process alive and auto-restart on failures.

Document Role:

- Canonical for 24/7 runtime, deployment, and environment operation.
- Subordinate to [docs/RUNBOOK_MUEL_PLATFORM.md](docs/RUNBOOK_MUEL_PLATFORM.md) for overall incident/runbook flow.
- Use this document when the task is specifically about runtime topology, env setup, PM2/host execution, or unattended process safety.

Related architecture guide:

- `docs/RUNBOOK_MUEL_PLATFORM.md` as the top-level unified runbook (DevOps/SRE entrypoint).
- `docs/OPERATOR_SOP_DECISION_TABLE.md` for operator auto decision thresholds and actions.
- `docs/CONTEXT_ISOLATION.md` for domain-focused review/edit workflow.
- `docs/MULTI_GUILD_OPERATIONS_CHECKLIST.md` for multi-server rollout checklist and env registration steps.
- `docs/OBSIDIAN_SUPABASE_SYNC.md` for no-disk periodic Obsidian -> Supabase sync.

## Runtime Topology and Control Plane

Current runtime topology uses two orthogonal dimensions:

- startup phase: when a workload starts (`service-init`, `discord-ready`, `database`)
- ownership: who owns execution (`app` or `db`)

- `service-init`: starts with the server process before Discord ready.
- `discord-ready`: starts only after the Discord client is ready.
- `database`: jobs owned by Supabase cron instead of the app process.

Current app-owned `service-init` loops:

- memory job runner
- opencode publish worker
- runtime alert scanner
- local autonomy supervisor loop

Current external advisory workers:

- local-orchestrator worker
- OpenDev worker
- NemoClaw worker
- OpenJarvis worker

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

Current app-owned `discord-ready` workloads:

- automation monitors (news/youtube)
- agent daily learning loop
- GoT cutover autopilot loop
- Discord login-session cleanup when app-owned
- Obsidian lore sync loop
- retrieval eval loop
- reward signal loop
- eval auto-promote loop
- agent SLO alert loop

Current app-owned `service-init` or event-gated control workloads:

- intent formation evaluation loop

Current database-owned runtime:

- Supabase maintenance cron jobs
- Discord login-session cleanup when configured to run via DB/cron path
- retrieval eval loop when `muel_retrieval_eval` is confirmed
- reward signal loop when `muel_reward_signal` is confirmed
- eval auto-promote loop when `muel_eval_auto_promote` is confirmed
- agent SLO alert loop when `muel_slo_check` is confirmed
- Obsidian lore sync loop when `muel_obsidian_lore_sync` is confirmed
- intent formation evaluation loop when `muel_intent_eval` is confirmed

Scheduler-policy canonical IDs (operator should compare by ID):

- `service-init`: `memory-job-runner`, `opencode-publish-worker`, `runtime-alerts`, `intent-formation`(app-owned)
- `discord-ready`: `automation-modules`, `agent-daily-learning`, `got-cutover-autopilot`, `login-session-cleanup`(app-owned), `obsidian-sync-loop`, `retrieval-eval-loop`, `reward-signal-loop`, `eval-auto-promote-loop`, `agent-slo-alert-loop`
- `database`: `supabase-maintenance-cron`, `login-session-cleanup`(db-owned), `obsidian-sync-loop`(db-owned), `retrieval-eval-loop`(db-owned), `reward-signal-loop`(db-owned), `eval-auto-promote-loop`(db-owned), `agent-slo-alert-loop`(db-owned), `intent-formation`(db-owned)

Operator control-plane endpoints:

- `GET /api/bot/status`: top-level bot, automation, agent runtime summary
- `GET /api/bot/agent/actions/catalog`: registered action catalog with advisory-worker mapping and optional guild policy overlay
- `POST /api/bot/agent/actions/execute`: admin-only direct execution path for registered actions, including local-orchestrator/OpenDev/NemoClaw/OpenJarvis runtime actions
  - `actionName=local.orchestrator.all` triggers lead + consult + synthesis in one pass
- `GET /api/bot/agent/runtime/scheduler-policy`: canonical runtime ownership/startup snapshot
- `GET /api/bot/agent/runtime/role-workers`: advisory worker specs plus current reachability/health snapshot
- `GET /api/bot/agent/runtime/loops`: loop health for memory, Obsidian sync, retrieval eval
- `GET /api/bot/agent/runtime/loops`: also includes `localAutonomySupervisorLoop`, which self-heals the local max-delegation stack and queues Hermes supervisor restart when the local continuity loop is missing. On the local 24/7 lane it now requests `autoLaunchQueuedChat=true`, so queued next objectives can reopen the next GPT session instead of stopping at supervisor-only continuity.
- If the live Hermes supervisor is present but still reports `auto_launch_queued_chat=false`, the repo-owned local autonomy loop now treats that as mode drift and replaces it with the queue-chat profile once the active workflow is no longer executing.
- If the queue-aware handoff already stopped at `queued_chat_launched` and reports `awaiting_reentry_acknowledgment=true`, treat that as an intentional wait boundary rather than a missing-supervisor incident. In that state the repo-owned local autonomy loop must wait for `openjarvis:hermes:runtime:reentry-ack` instead of relaunching another queued GPT turn. The first healthy awaiting-ack boundary now immediately refreshes continuity packet sync so the handoff/progress notes project the selected queued objective and wait state before the boundary goes stale. Once that wait exceeds 15 minutes, the same runtime surfaces expose `awaiting_reentry_acknowledgment_stale=true`, local autonomy summarizes it as `reentry=stale-ack`, records a deduped workflow `capability_demand`, and reruns continuity packet sync so the local Obsidian handoff/progress notes reflect the stalled handoff as an operator-visible blocker. If there is no active launch manifest/log, the same packet sync now falls back to the detached `local-autonomy-supervisor` manifest/status/log artifacts and surfaces `continuity_watch_alive` plus watcher evidence refs instead of leaving continuity ownership as unknown.
- local-only or pre-server sessions can keep the same self-heal contract alive with `npm run local:autonomy:supervisor`; it now starts a detached local daemon, writes the latest standalone status to `tmp/autonomy/local-autonomy-supervisor.json`, exposes daemon metadata through `npm run local:autonomy:supervisor:status`, and can be stopped with `npm run local:autonomy:supervisor:stop`. Check `watchProcess.detached`, `stats.lastSupervisorQueueLaunchMode`, `stats.lastSupervisorAutoLaunchQueuedChat`, `stats.lastSupervisorAutoLaunchQueuedSwarm`, and `code.restartRecommended` in the status artifact when validating that the lane is still queue-aware and still running the current repo code. The detached start command now auto-restarts a stale daemon when tracked self-heal code changed, and `npm run local:autonomy:supervisor:restart` is the explicit forced fallback when an operator wants a clean rebootstrap.
- `GET /api/bot/agent/runtime/unattended-health`: unattended execution telemetry, opencode readiness, and current LLM routing snapshot including any active gate override
- `GET /api/bot/agent/runtime/unattended-health`: also includes `advisoryWorkersHealth` for local-orchestrator/OpenDev/NemoClaw/OpenJarvis workers
- `GET /api/bot/agent/runtime/unattended-health`: also includes `localAutonomy`, the standard `local-nemoclaw-max-delegation` doctor result for the local 24-hour autonomy lane
- `GET /api/bot/agent/runtime/operator-snapshot`: also includes `localAutonomy` and mirrors the same local max-delegation doctor state inside `runtime.localAutonomy`
- `GET /api/bot/agent/runtime/readiness?guildId=...`: guild-scoped runtime readiness report
- `GET /api/bot/agent/runtime/slo/report?guildId=...`: guild SLO status
- `GET /api/bot/agent/runtime/slo/alerts?guildId=...`: recent SLO alert events

Operator interpretation rule:

- `GET /api/bot/agent/actions/catalog` answers which runtime actions are registered
- `GET /api/bot/agent/runtime/role-workers` answers which advisory worker endpoints are configured and reachable
- `GET /api/bot/agent/runtime/scheduler-policy` answers which unattended workloads are expected to run and who owns them
- `GET /api/bot/agent/runtime/loops` answers whether the repo-owned local self-heal loop itself is alive
- `GET /api/bot/agent/runtime/unattended-health` plus `GET /api/bot/agent/runtime/operator-snapshot` answer whether the local max-delegation lane itself is blocked and what the next repair step is through `localAutonomy.failures` and `localAutonomy.nextSteps`
- if a capability is not visible through one of these runtime surfaces, do not assume that a matching `.github` role or prompt file makes it operationally available

Operational rule:

- When runtime behavior and docs disagree, treat `scheduler-policy` plus `runtimeBootstrap.ts` as the immediate source for incident triage, then patch docs in the same change set.
- For db-owned scheduler items, treat `enabled/running=true` as valid only when the matching pg_cron job name exists (`muel_login_session_cleanup`, `muel_obsidian_lore_sync`, `muel_retrieval_eval`, `muel_reward_signal`, `muel_eval_auto_promote`, `muel_slo_check`, `muel_intent_eval`).

## 1) Required Environment Variables

Quick validation command (run before deploy):

```bash
npm run env:check
```

Set these in your runtime environment (`.env` or host secret manager):

- `NODE_ENV=production`
- `START_BOT=true`
- `START_TRADING_BOT=false` (enable only when strategy loop should run on this instance)
- `START_AUTOMATION_JOBS=true`
- `DISCORD_TOKEN=<your token>` (or `DISCORD_BOT_TOKEN`)
- `JWT_SECRET=<strong secret>`
- `DEV_AUTH_ENABLED=false`
- `DISCORD_OAUTH_CLIENT_ID=<discord app client id>`
- `DISCORD_OAUTH_CLIENT_SECRET=<discord app client secret>`
- `PUBLIC_BASE_URL=https://<your-backend-domain>`
  - `DISCORD_OAUTH_REDIRECT_URI` is optional when `PUBLIC_BASE_URL` is set
- `FRONTEND_ORIGIN=<frontend url list>`

Compact alias set also supported:

- `DISCORD_CLIENT_ID` (alias of `DISCORD_OAUTH_CLIENT_ID`)
- `DISCORD_CLIENT_SECRET` (alias of `DISCORD_OAUTH_CLIENT_SECRET`)
- `OAUTH_REDIRECT_ALLOWLIST` (alias of `FRONTEND_ORIGIN`/`CORS_ALLOWLIST`)

Automation token behavior:

- If `DISCORD_TOKEN` / `DISCORD_BOT_TOKEN` is missing, automation monitor is skipped by design.
- In that case automation is treated as disabled in runtime status.
- To run only API, this token can remain unset.

Optional but recommended:

- `DISCORD_READY_TIMEOUT_MS=45000` (`120000` recommended on Render or other cold-start-prone hosts)
- `DISCORD_START_RETRIES=3`
- `LOG_LEVEL=info`
- `ADMIN_ALLOWLIST_TABLE=user_roles` (if using DB-managed admin roles)
- `ADMIN_ALLOWLIST_ROLE_VALUE=admin`
- `ADMIN_ALLOWLIST_CACHE_TTL_MS=300000`

## 2) Install and Start with PM2

From repository root:

```bash
npm ci
npm run pm2:start
npm run pm2:save
```

Check status:

```bash
npm run pm2:status
npm run pm2:logs
```

Role worker PM2 profile:

```bash
npx pm2 start ecosystem.role-workers.config.cjs --update-env
npm run worker:roles:check
```

Role worker systemd examples:

- [config/systemd/local-orchestrator-worker.service.example](config/systemd/local-orchestrator-worker.service.example)
- [config/systemd/opendev-worker.service.example](config/systemd/opendev-worker.service.example)
- [config/systemd/nemoclaw-worker.service.example](config/systemd/nemoclaw-worker.service.example)
- [config/systemd/openjarvis-worker.service.example](config/systemd/openjarvis-worker.service.example)

## 2.1) Render Settings (Important)

When deploying as a Render `Web Service`, set commands exactly as below:

- Build Command: `npm ci; npm run build`
- Start Command: `npm run start`
- Health Check Path: `/ready`

Why: Node-only runtime no longer installs Python dependencies in the build step.

Bot availability rule for 24/7 operation:

- when `START_BOT=true`, boot must fail closed if Discord token is missing or Discord login never becomes ready
- `/ready` must be treated as the restart signal, because `/health` stays informative even during degraded runtime
- this ensures Render/PM2 restarts the process instead of leaving the API alive while the Discord bot is offline

Also verify Runtime Environment Variables in Render:

- `START_BOT=true`
- `START_AUTOMATION_JOBS=true` (Render process runs 24/7 automation jobs)
- `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`)
- Automation scheduling controls:
  - `AUTOMATION_YOUTUBE_ENABLED=true`
  - `YOUTUBE_MONITOR_INTERVAL_MS=300000`
- `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY`, `ALPHA_VANTAGE_KEY`
- Lock and monitor safety controls:
  - `TRADING_ENGINE_LOCK_LEASE_MS=90000`
  - `YOUTUBE_MONITOR_FETCH_TIMEOUT_MS=15000`
  - `NEWS_MONITOR_FETCH_TIMEOUT_MS=15000`
  - `NEWS_AI_DEDUP_ENABLED=true`
  - `NEWS_DEDUP_LOOKBACK_HOURS=24`
  - `NEWS_DEDUP_HISTORY_MAX_ITEMS=60`

Runtime alert controls:

- `RUNTIME_ALERT_ENABLED=true`
- `RUNTIME_ALERT_SCAN_INTERVAL_MS=30000`
- `RUNTIME_ALERT_COOLDOWN_MS=300000`
- `RUNTIME_ALERT_WEBHOOK_URL=<ops-webhook-url>` (optional)

Trading event-loop/memory safety controls (important on single Render instance):

- `trading_engine_configs.config.runtime.symbolConcurrency` (default `2`)
- `trading_engine_configs.config.runtime.tickYieldEvery` (default `200`)
- `trading_engine_configs.config.runtime.maxTicksPerCycle` (default `2000`)
- `trading_engine_configs.config.runtime.memorySoftLimitMb` (default `0`, disabled)

Recommended single-instance starting values:

- `symbolConcurrency=1`
- `tickYieldEvery=100`
- `maxTicksPerCycle=1200`
- `memorySoftLimitMb=300` (pause engine automatically when heap exceeds this)
- AI-trading execution mode (single Render default):
  - Recommended local mode (same service process):
    - `AI_TRADING_MODE=local`
    - `BINANCE_API_KEY=<your-binance-key>`
    - `BINANCE_API_SECRET=<your-binance-secret>`
    - optional: `BINANCE_FUTURES=true`, `BINANCE_HEDGE_MODE=false`
  - Optional proxy mode (external service delegation):
    - `AI_TRADING_MODE=proxy`
    - `AI_TRADING_BASE_URL=https://<ai-trading-service-domain>`
    - `AI_TRADING_INTERNAL_TOKEN=<shared-internal-token>`
    - `AI_TRADING_ORDER_PATH=/internal/binance/order`
    - `AI_TRADING_POSITION_PATH=/internal/binance/position`
    - `AI_TRADING_TIMEOUT_MS=15000`

- In-process strategy loop (optional):
  - `START_TRADING_BOT=true`
  - `TRADING_DRY_RUN=true` for initial rollout
  - `TRADING_SYMBOLS=BTC/USDT` (comma-separated)
  - `TRADING_TIMEFRAME=30m`
  - `TRADING_CANDLES_TABLE=candles`
  - `TRADING_STATE_TABLE=bot_state`
  - runtime strategy overrides are stored in `trading_engine_configs`
  - runtime controls are available via API:
    - pause: `POST /api/trading/runtime/pause`
    - resume: `POST /api/trading/runtime/resume`
    - force close: `POST /api/trading/position/close`

## 2.2) Supabase Schema Setup (Required for DB mode)

If `news_sentiment` or `youtube_log` table is missing, automation keeps running in no-db mode and logs warnings.
To enable persistent DB storage, run `docs/SUPABASE_SCHEMA.sql` in Supabase SQL Editor.

Typical missing-schema error:

- `PGRST205: Could not find the table 'public.news_sentiment' in the schema cache`

After applying SQL, restart or redeploy the service.

## 3) Restart / Stop Commands

```bash
npm run pm2:restart
npm run pm2:stop
```

## 4) Boot Persistence

Linux:

```bash
npx pm2 startup
# run the printed sudo command once
npm run pm2:save
```

Windows (with PM2 startup support):

```powershell
npx pm2-startup install
npm run pm2:save
```

If `pm2-startup` is unavailable on your Windows host, run PM2 via a service manager
(NSSM/Task Scheduler) and execute `npm run pm2:start` on boot.

## 5) Health Verification

The service is healthy when:

- `GET /health` returns `status: "ok"` or expected `degraded` details
- `GET /api/bot/status` returns bot snapshots with recent successful runtime fields
- `GET /api/bot/agent/runtime/scheduler-policy` shows expected enabled/running ownership for this deployment mode

Quick checks:

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

Admin runtime checks:

```bash
curl -fsS -H "Cookie: muel_session=<session-token>" http://localhost:3000/api/bot/agent/runtime/scheduler-policy
curl -fsS -H "Cookie: muel_session=<session-token>" http://localhost:3000/api/bot/agent/runtime/loops
```

- These endpoints are admin-only and require an authenticated admin session cookie.
- If `AUTH_COOKIE_NAME` is customized, replace `muel_session` with that configured cookie name.

Automated operator check:

```bash
npm run ops:runtime:check -- --cookie=<admin-cookie> --guildId=<guild-id>
```

- `--cookie` accepts either full `name=value` or raw token. Raw token is normalized to `${AUTH_COOKIE_NAME}=<token>` (default cookie name: `muel_session`).

- Use `--strict=false` only for public-endpoint smoke checks when admin session material is not available.
- Default strict mode fails if admin-only control-plane endpoints cannot be verified.

What to verify:

- If `START_BOT=true`, `discord-ready` workloads should appear after bot ready.
- If `START_BOT=false`, expect `service-init` loops only; this is not an incident by itself.
- `memory-job-runner` startup source should reflect whether shared loops were first started by server-process or Discord ready path.
- `trading-engine` may be enabled but effectively paused; check runtime pause state before escalating.
- `runtime-alerts` and `opencode-publish-worker` should be present on server-process instances even when Discord automation is disabled.
- `agent-slo-alert-loop` should only appear in `discord-ready` phase after Discord ready runtime starts.
- `login-session-cleanup` can legitimately appear in either `discord-ready` (owner=app) or `database` (owner=db), depending on `DISCORD_LOGIN_SESSION_CLEANUP_OWNER`.

## 6) Common Failure Cases

- `offline` status: `START_BOT` is false or Discord token is missing.
- automation degraded: YouTube RSS fetch errors or invalid subscription/channel mapping.
- frequent restarts: inspect logs with `npm run pm2:logs` and verify env vars.
- scheduler-policy drift: docs or operator expectation say `discord-ready`, but runtime snapshot shows `service-init` or `database`; inspect `src/services/runtimeBootstrap.ts` and current env toggles before restart.
- unattended path degraded: `/api/bot/agent/runtime/unattended-health` shows queue/readiness issues; inspect approval store fallback, opencode publish worker state, and upstream GitHub queue dependencies.
- ready-only degradation: `/ready` fails while `/health` stays healthy; isolate Discord gateway/auth issues from server-process loops before rolling back the entire service.

Manual run API note (admin dashboard):

- `POST /api/bot/automation/:jobName/run` must include JSON body `{"guildId":"<discord-guild-id>"}`.
- Without `guildId`, API returns `400` by design to prevent cross-guild accidental sends.

Distributed rate limit note:

- Auth/bot admin/trading control routes now use Supabase shared rate-limit via `public.acquire_rate_limit(...)`.
- If `api_rate_limits` table or function is missing, service logs an error once and falls back to in-memory limiter.
- Apply latest `docs/SUPABASE_SCHEMA.sql` before production rollout.

## 7) Render Email Alerts Off (Logs Only)

This repository does not send email from code. If someone receives email on automation errors,
it usually comes from Render notification settings.

Disable email alerts in Render:

1. Open Render Dashboard.
2. Go to `Account Settings` -> `Notifications` (or the service `Alerting` tab).
3. Disable email channel for this service/event policy.
4. Keep monitoring through `Logs` and `/health`.

Recommended for your current setup:

- Keep `START_AUTOMATION_JOBS=true` only when `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`) is configured.
- If you intentionally disable automation, set `START_AUTOMATION_JOBS=false`.
- Keep checking issues through Render Logs only.

## 8) Workflow Migration Policy

Recurring automation jobs are now owned by the Render service, not GitHub Actions.

- YouTube monitoring schedule is handled by the in-process Node monitor.
- Keep GitHub Actions for CI (`main.yml`) and deploy trigger (`render-deploy.yml`).
