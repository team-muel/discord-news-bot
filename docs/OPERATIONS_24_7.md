# 24/7 Operations Runbook (Server + Discord Bot + Automation Jobs)

This project runs one Discord bot plus automation jobs from the server process (`server.ts`).
Use PM2 to keep the process alive and auto-restart on failures.

Related architecture guide:

- `docs/RUNBOOK_MUEL_PLATFORM.md` as the top-level unified runbook (DevOps/SRE entrypoint).
- `docs/CONTEXT_ISOLATION.md` for domain-focused review/edit workflow.
- `docs/MULTI_GUILD_OPERATIONS_CHECKLIST.md` for multi-server rollout checklist and env registration steps.
- `docs/OBSIDIAN_SUPABASE_SYNC.md` for no-disk periodic Obsidian -> Supabase sync.

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

- `DISCORD_READY_TIMEOUT_MS=15000`
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

## 2.1) Render Settings (Important)

When deploying as a Render `Web Service`, set commands exactly as below:

- Build Command: `npm ci; npm run build`
- Start Command: `npm run start`

Why: Node-only runtime no longer installs Python dependencies in the build step.

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

Quick checks:

```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/ready
```

## 6) Common Failure Cases

- `offline` status: `START_BOT` is false or Discord token is missing.
- automation degraded: YouTube RSS fetch errors or invalid subscription/channel mapping.
- frequent restarts: inspect logs with `npm run pm2:logs` and verify env vars.

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
