# Frontend Integration Guide

## Base URL

- Production: backend deployment URL (e.g. `https://<your-backend-domain>`)
- Local: `http://localhost:3000`

## Runtime Architecture

- This repository is backend-first and exposes API routes under `/api/*`.
- Browser auth is cookie-based (`muel_session` by default).
- Frontend should call backend only through `apiFetch` wrappers and relative `/api/*` paths.

## Required Backend Env

- `FRONTEND_ORIGIN`: comma-separated CORS allowlist
  - Example: `https://muel-front-uiux.vercel.app,http://localhost:5173`
- `START_BOT`: `false` for API-only mode, `true` to start Discord bot in same process
- `START_AUTOMATION_BOT`: `true` to run automation worker bot (legacy python jobs)
- `JWT_SECRET`: session token signing key
- `RESEARCH_PRESET_ADMIN_USER_IDS`: comma-separated admin user IDs for preset mutation APIs

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

### Bot Ops

- `GET /api/bot/status` (auth required)
  - Returns: `healthy`, `statusGrade` (`healthy|degraded|offline`), `statusSummary`, `recommendations`, `nextCheckInSec`, `outageDurationMs`, `bot`, `automation`
- `POST /api/bot/reconnect` (admin required)
- `POST /api/bot/automation/:jobName/run` (admin required)
  - `jobName`: `news-analysis` or `youtube-monitor`

### Benchmark

- `POST /api/benchmark/events`
- `GET /api/benchmark/summary`

## CORS Rules

- If `FRONTEND_ORIGIN` is empty: permissive CORS for local/dev
- If `FRONTEND_ORIGIN` is set: only listed origins are allowed

## Deployment Notes

- API-only deployment: `START_BOT=false`
- Unified deployment (API + bot): `START_BOT=true` and provide `DISCORD_TOKEN`
- Always set strong `JWT_SECRET` in production

## Quick Contract Check

- Start backend: `npm run start:server`
- Run smoke test: `npm run smoke:api`
- Optional remote target: `API_BASE=https://<backend-domain> npm run smoke:api`
