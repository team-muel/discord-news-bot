# 24/7 Operations Runbook (Server + Discord Bot + Automation Bot)

This project runs both bots from the server process (`server.ts`).
Use PM2 to keep the process alive and auto-restart on failures.

## 1) Required Environment Variables

Set these in your runtime environment (`.env` or host secret manager):

- `NODE_ENV=production`
- `START_BOT=true`
- `START_AUTOMATION_BOT=true`
- `DISCORD_TOKEN=<your token>` (or `DISCORD_BOT_TOKEN`)
- `JWT_SECRET=<strong secret>`
- `FRONTEND_ORIGIN=<frontend url list>`

Optional but recommended:

- `AUTOMATION_PYTHON_COMMAND=python`
- `DISCORD_READY_TIMEOUT_MS=15000`
- `DISCORD_START_RETRIES=3`
- `LOG_LEVEL=info`

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

- Build Command: `npm ci; python -m pip install -r requirements.txt; npm run build`
- Start Command: `npm run start`

Why: `youtube_monitor.py` and `bot_task.py` require Python packages from `requirements.txt`
(`discord.py`, `feedparser`, `supabase`, etc.). Without this step, automation jobs fail with
`ModuleNotFoundError`.

Also verify Runtime Environment Variables in Render:

- `START_BOT=true`
- `START_AUTOMATION_BOT=true`
- `DISCORD_TOKEN` (or `DISCORD_BOT_TOKEN`)
- For automation workers (shared token):
  - `SECONDARY_DISCORD_TOKEN=<automation bot token>`
  - optional fallback: `AUTOMATION_DISCORD_TOKEN=<automation bot token>`
- `SUPABASE_URL`, `SUPABASE_KEY`, `OPENAI_API_KEY`, `TARGET_CHANNEL_ID`

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
