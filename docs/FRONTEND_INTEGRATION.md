# Frontend Integration Guide

## Base URL

- Production: backend deployment URL (e.g. `https://<your-backend-domain>`)
- Local: `http://localhost:3000`

## Runtime Architecture

- This repository is backend-first and exposes API routes under `/api/*`.
- Browser auth is cookie-based (`muel_session` by default).
- Frontend should call backend only through `apiFetch` wrappers and relative `/api/*` paths.
- Trading strategy loop can run in-process (`START_TRADING_BOT=true`) without external AI-trading service.

## Required Backend Env

- `CORS_ALLOWLIST` (preferred) or `FRONTEND_ORIGIN`: comma-separated CORS allowlist
  - Example: `https://muel-front-uiux.vercel.app,http://localhost:5173`
- `START_BOT`: `false` for API-only mode, `true` to start Discord bot in same process
- `START_TRADING_BOT`: `true` to run CVD-based trading engine loop in same process
- `START_AUTOMATION_BOT`: `true` to run automation worker bot (legacy python jobs)
  - compatibility alias: `ENABLE_SECONDARY_BOT`
- `JWT_SECRET`: session token signing key
  - compatibility alias: `SESSION_SECRET`
- `RESEARCH_PRESET_ADMIN_USER_IDS`: comma-separated admin user IDs for preset mutation APIs
- `DISCORD_COMMAND_GUILD_ID` (optional): register slash commands to a specific guild for immediate reflection
- `JSON_BODY_LIMIT` (optional): express json body limit (default: `2mb`)
- `BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS` (optional): `/api/bot/status` benchmark write interval (default: `60000`)
- `BOT_MANUAL_RECONNECT_COOLDOWN_MS` (optional): manual reconnect cooldown for bot runtime (default: `30000`)
  - compatibility alias: `DISCORD_MANUAL_RECONNECT_COOLDOWN_MS`
- `DISCORD_READY_TIMEOUT_MS` (optional): Discord login ready timeout (default: `15000`)
  - compatibility alias: `DISCORD_LOGIN_TIMEOUT_MS`

## Contract Endpoints

### Health / Status

- `GET /health`
  - Returns: `status`, `botStatusGrade` (`healthy|degraded|offline`), `uptimeSec`, `bot`, `automation`
- `GET /ready`
  - Returns readiness for bot-enabled deployments
- `GET /api/status`
  - Lightweight liveness payload for UI polling/test scripts

### Auth

- `POST /api/auth/sdk`
  - Input: `{ code: string }`
  - Behavior: issues session cookie and returns authenticated user payload
- `GET /api/auth/callback?code=...`
  - OAuth popup callback endpoint (issues session cookie, posts success message to opener, closes window)
- `GET /auth/callback?code=...`
  - Alias endpoint that redirects to `/api/auth/callback` for frontend compatibility
- `GET /api/auth/me`
  - Returns current user or `401`
- `POST /api/auth/logout`
  - Clears session cookie

### Research Presets

- `GET /api/research/preset/:presetKey`
- `GET /api/research/preset/:presetKey/history?limit=20` (auth required)
- `POST /api/research/preset/:presetKey` (admin required)
- `POST /api/research/preset/:presetKey/restore/:historyId` (admin required)

### Macro Data

- `GET /api/fred/playground?ids=UNRATE,CPIAUCSL,FEDFUNDS&range=3Y`
  - Query: `ids` (comma-separated), `range` in `1Y|3Y|5Y|10Y`
  - Returns: `{ source, catalog, series }` compatible payload for frontend playground

### Quant Data

- `GET /api/quant/panel`
  - Returns: `{ source: 'backend', metrics: QuantPanelMetric[] }`
  - Metric ids: `position | winRate | cvd`

### Bot Ops

- `GET /api/bot/status` (auth required)
  - Returns: `healthy`, `statusGrade` (`healthy|degraded|offline`), `statusSummary`, `recommendations`, `nextCheckInSec`, `outageDurationMs`, `bot`, `automation`
- `POST /api/bot/reconnect` (admin required)
- `POST /api/bot/automation/:jobName/run` (admin required)
  - `jobName`: `news-analysis` or `youtube-monitor`

### Benchmark

- `POST /api/benchmark/events`
- `GET /api/benchmark/summary`

### Trades (Supabase)

- `GET /api/trades?symbol=BTCUSDT&status=open&limit=50` (auth required)
- `POST /api/trades` (admin required)
  - Input: `{ symbol, side, entryTs, entryPrice, qty, ... }`
  - Optional: `executeOrder=true` to execute order through configured AI-trading mode (`proxy` or `local`)

### AI-trading

- `GET /api/trading/position?symbol=BTCUSDT` (admin required)
  - Returns position payload from configured AI-trading mode (`proxy` or `local`)

## CORS Rules

- If `FRONTEND_ORIGIN` is empty: permissive CORS for local/dev
- If `FRONTEND_ORIGIN` is set: only listed origins are allowed

## Deployment Notes

- API-only deployment: `START_BOT=false`
- Unified deployment (API + bot): `START_BOT=true` and provide `DISCORD_TOKEN`
- Proxy mode: `AI_TRADING_MODE=proxy` with `AI_TRADING_BASE_URL`, `AI_TRADING_INTERNAL_TOKEN`
- Single-Render delegated mode: `AI_TRADING_MODE=local` with `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- Full in-process strategy mode: `START_TRADING_BOT=true` with `TRADING_*` params and Supabase candles table
- Always set strong `JWT_SECRET` in production

## Quick Contract Check

- Start backend: `npm run start:server`
- Run smoke test: `npm run smoke:api`
- Optional remote target: `API_BASE=https://<backend-domain> npm run smoke:api`
