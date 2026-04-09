# Frontend Integration Guide

## Base URL

- Production: backend deployment URL (e.g. `https://<your-backend-domain>`)
- Local: `http://localhost:3000`

## Runtime Architecture

- This repository is backend-first and exposes API routes under `/api/*`.
- Browser auth is cookie-based (`muel_session` by default).
- CSRF protection is enabled for authenticated state-changing requests.
- Frontend should call backend only through `apiFetch` wrappers and relative `/api/*` paths.
- Trading strategy loop can run in-process (`START_TRADING_BOT=true`) without external AI-trading service.
- Copy-ready handoff assets for `team-muel/muel-front-uiux` are in `docs/front-uiux-handoff/`.

## Required Backend Env

- `CORS_ALLOWLIST` (preferred) or `FRONTEND_ORIGIN`: comma-separated CORS allowlist
  - Example: `https://muel-front-uiux.vercel.app,http://localhost:5173`
  - alias: `OAUTH_REDIRECT_ALLOWLIST`
- `START_BOT`: `false` for API-only mode, `true` to start Discord bot in same process
- `START_TRADING_BOT`: `true` to run CVD-based trading engine loop in same process
- `START_AUTOMATION_JOBS`: `true` to run Node automation monitor jobs
- `JWT_SECRET`: session token signing key
  - compatibility alias: `SESSION_SECRET`
- `DEV_AUTH_ENABLED`: enables code-based dev auth endpoints (`/api/auth/sdk`, `/api/auth/callback`)
  - default: enabled in non-production, disabled in production
- `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_OAUTH_REDIRECT_URI`
  - when set, `/api/auth/callback` uses real Discord OAuth code exchange + state validation
  - aliases: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- `PUBLIC_BASE_URL` (recommended)
  - if `DISCORD_OAUTH_REDIRECT_URI` is omitted, backend auto-uses `${PUBLIC_BASE_URL}/api/auth/callback`
- `DISCORD_OAUTH_SCOPE` (optional, default: `identify`)
- `DISCORD_OAUTH_STATE_COOKIE_NAME`, `DISCORD_OAUTH_STATE_TTL_SEC` (optional)
- `RESEARCH_PRESET_ADMIN_USER_IDS`: comma-separated admin user IDs for preset mutation APIs
- `ADMIN_ALLOWLIST_TABLE` (optional, default: `user_roles`)
- `ADMIN_ALLOWLIST_ROLE_VALUE` (optional, default: `admin`)
- `ADMIN_ALLOWLIST_CACHE_TTL_MS` (optional, default: `300000`)
- `DISCORD_COMMAND_GUILD_ID` (optional): register slash commands to a specific guild for immediate reflection
- `JSON_BODY_LIMIT` (optional): express json body limit (default: `2mb`)
- `BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS` (optional): `/api/bot/status` benchmark write interval (default: `60000`)
- `BOT_MANUAL_RECONNECT_COOLDOWN_MS` (optional): manual reconnect cooldown for bot runtime (default: `30000`)
  - compatibility alias: `DISCORD_MANUAL_RECONNECT_COOLDOWN_MS`
- `DISCORD_READY_TIMEOUT_MS` (optional): Discord login ready timeout (default: `45000`)
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

- `GET /api/auth/login`
  - Redirects to Discord OAuth authorize URL and stores CSRF state cookie
  - Optional query: `?mode=json` returns `{ authorizeUrl }` for SPA popup control
- `POST /api/auth/sdk`
  - Input: `{ code: string }`
  - Behavior: dev-only fallback auth. Disabled when `DEV_AUTH_ENABLED=false`
- `GET /api/auth/callback?code=...`
  - OAuth popup callback endpoint
  - When Discord OAuth env is configured: verifies `state`, exchanges code, issues session cookie
  - If Supabase is configured, upserts user profile/token fields into `users`
  - Otherwise: falls back to dev code auth only if `DEV_AUTH_ENABLED=true`
- `GET /auth/callback?code=...`
  - Alias endpoint that redirects to `/api/auth/callback` for frontend compatibility
- `GET /api/auth/me`
  - Returns current user or `401`
  - Returns `csrfToken` and `csrfHeaderName` for subsequent mutating requests
- `POST /api/auth/logout`
  - Clears session cookie
  - Requires CSRF header: `<csrfHeaderName>: <csrfToken>`

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
  - `jobName`: `youtube-monitor | news-monitor`
  - Required JSON body: `{ "guildId": "<discord-guild-id>" }`

### CSRF Request Rule

- For authenticated `POST/PUT/PATCH/DELETE` requests, frontend must send CSRF header from `/api/auth/me`.
- Example:
  - `const me = await api.get('/api/auth/me')`
  - `fetch('/api/trading/runtime/pause', { method: 'POST', headers: { [me.csrfHeaderName]: me.csrfToken } })`

### Benchmark

- `POST /api/benchmark/events` (auth required)
- `GET /api/benchmark/summary` (auth required)

### Local-first Chat Inbox

- `GET /api/chat/status` (session auth or bearer token)
  - Returns vault readiness, selected Obsidian adapters, the current local-first/hybrid mode, and the configured LLM hint.
- `POST /api/chat/inbox` (session auth or bearer token)
  - Input: `{ message, title?, guildId?, maxDocs?, contextMode?, persist?, replyToPath?, threadRootPath? }`
  - Behavior: writes the incoming request into an Obsidian inbox-style note, optionally links it to a prior note via `replyToPath`, runs graph-first vault retrieval, then generates an answer with `providerProfile=cost-optimized` so local providers are prioritized.
  - Persistence: when `persist !== false`, the route also writes a dedicated answer note under `chat/answers/...` and updates the original inbox note with an answer link/summary so backlinks are visible inside Obsidian.
  - Response: `{ answer, inbox, answerNote, thread, retrieval, warnings, localFirst }`
- Machine-to-machine usage:
  - Send `Authorization: Bearer <MCP_WORKER_AUTH_TOKEN>` when calling from an external client without browser session cookies.
  - The bearer token is shared with `/api/mcp/*`; keep it private and rotate it if the endpoint is exposed publicly.

### Trades (Supabase)

- `GET /api/trades?symbol=BTCUSDT&status=open&limit=50` (auth required)
- `POST /api/trades` (admin required)
  - Input: `{ symbol, side, entryTs, entryPrice, qty, ... }`
  - Optional: `executeOrder=true` to execute order through configured AI-trading mode (`local` by default on single Render, `proxy` optional)
  - Safety guard envs:
    - `MAX_MANUAL_TRADE_QTY` (default: `10000`)
    - `MAX_MANUAL_TRADE_LEVERAGE` (default: `125`)
    - `MAX_MANUAL_TRADE_ENTRY_PRICE` (default: `10000000`)

### AI-trading

- `GET /api/trading/strategy` (admin required)
  - Returns active strategy config and default config
- `PUT /api/trading/strategy` (admin required)
  - Input: `{ strategy: TradingStrategyConfigPatch }` or direct patch object
  - Persists runtime strategy rules without redeploy
- `POST /api/trading/strategy/reset` (admin required)
  - Resets strategy to env-based defaults
- `GET /api/trading/runtime` (admin required)
  - Returns engine runtime state + active strategy
- `POST /api/trading/runtime/run-once` (admin required)
  - Triggers one immediate strategy cycle (useful for frontend control panel)
- `POST /api/trading/runtime/pause` (admin required)
  - Input: `{ reason?: string }`
  - Pauses auto loop execution while keeping process alive
- `POST /api/trading/runtime/resume` (admin required)
  - Resumes auto loop execution
- `GET /api/trading/position?symbol=BTCUSDT` (admin required)
  - Returns position payload from configured AI-trading mode (`local` by default on single Render, `proxy` optional)
- `POST /api/trading/position/close` (admin required)
  - Input: `{ symbol }`
  - Executes a market close by submitting opposite-side order for current position size

## CORS Rules

- If `FRONTEND_ORIGIN` is empty: permissive CORS for local/dev
- If `FRONTEND_ORIGIN` is set: only listed origins are allowed

## Deployment Notes

- API-only deployment: `START_BOT=false`
- Unified deployment (API + bot): `START_BOT=true` and provide `DISCORD_TOKEN`
- Local-first Obsidian + Ollama profile:
  - Enable `OBSIDIAN_LOCAL_FS_ENABLED=true`
  - Point `OBSIDIAN_VAULT_PATH` (or `OBSIDIAN_SYNC_VAULT_PATH`) at the local vault
  - Prefer `OBSIDIAN_ADAPTER_ORDER=local-fs,native-cli,script-cli,remote-mcp`
  - Use `AI_PROVIDER=ollama` or keep the chat route on `providerProfile=cost-optimized`
- Single-Render default mode: `AI_TRADING_MODE=local` with `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- Optional external delegation mode: `AI_TRADING_MODE=proxy` with `AI_TRADING_BASE_URL`, `AI_TRADING_INTERNAL_TOKEN`
- Full in-process strategy mode: `START_TRADING_BOT=true` with `TRADING_*` params and Supabase candles table
- Strategy rules can be changed live through `/api/trading/strategy` (stored in `trading_engine_configs`)
- Always set strong `JWT_SECRET` in production
- In production, set explicit `CORS_ALLOWLIST`/`FRONTEND_ORIGIN` and keep `DEV_AUTH_ENABLED=false`

## Quick Contract Check

- Start backend: `npm run start:server`
- Run smoke test: `npm run smoke:api`
- Optional remote target: `API_BASE=https://<backend-domain> npm run smoke:api`
