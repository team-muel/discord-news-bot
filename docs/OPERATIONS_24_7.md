# 24/7 Operations Runbook (Server + Discord Bot + Automation Bot)

This project runs both bots from the server process (`server.ts`).
Use PM2 to keep the process alive and auto-restart on failures.

## 1) Required Environment Variables

Set these in your runtime environment (`.env` or host secret manager):

- `NODE_ENV=production`
- `START_BOT=true`
- `START_TRADING_BOT=false` (enable only when strategy loop should run on this instance)
- `START_AUTOMATION_BOT=true`
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

- If `SECONDARY_DISCORD_TOKEN` / `AUTOMATION_DISCORD_TOKEN` is missing, automation workers are skipped by design.
- In that case automation is treated as disabled in runtime status (no worker restart loop).
- To run only API+primary bot, this token can remain unset.

Optional but recommended:

- `AUTOMATION_PYTHON_COMMAND=python`
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

Why: `npm run build` now installs Python dependencies from `requirements.txt` using
hash-based caching (`.cache/python-requirements.sha256`). If requirements did not change,
the build skips `pip install` for faster deploys.

Additional deploy speed options:

- If automation is off (`START_AUTOMATION_BOT=false`), Python dependency installation is skipped automatically.
- You can force skip with `SKIP_PYTHON_DEPS=true`.
- Dependency profile can be switched via `PYTHON_REQUIREMENTS_PROFILE`:
  - `full` (default): installs full automation stack (`pandas`, `matplotlib`, `PyPDF2` 포함)
  - `core`: installs minimal runtime dependencies only
- Render build command uses `npm ci --no-audit --no-fund` to reduce install overhead.

Also verify Runtime Environment Variables in Render:

- `START_BOT=true`
- `START_AUTOMATION_BOT=false` (recommended when no secondary automation token is used)
- `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`)
- For automation workers (shared token):
  - `SECONDARY_DISCORD_TOKEN=<automation bot token>`
  - optional fallback: `AUTOMATION_DISCORD_TOKEN=<automation bot token>`
  - recommended: `SECONDARY_DISCORD_TOKEN != DISCORD_TOKEN`
- `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY`, `TARGET_CHANNEL_ID`
- `PYTHON_REQUIREMENTS_PROFILE=full` (all features)
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
- automation degraded: Python not found or job script exits non-zero.
- frequent restarts: inspect logs with `npm run pm2:logs` and verify env vars.

## 7) Render Email Alerts Off (Logs Only)

This repository does not send email from code. If someone receives email on automation errors,
it usually comes from Render notification settings.

Disable email alerts in Render:

1. Open Render Dashboard.
2. Go to `Account Settings` -> `Notifications` (or the service `Alerting` tab).
3. Disable email channel for this service/event policy.
4. Keep monitoring through `Logs` and `/health`.

Recommended for your current setup (no secondary automation token):

- Set `START_AUTOMATION_BOT=false`.
- Keep checking issues through Render Logs only.
