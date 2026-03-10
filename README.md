# Discord News Bot (moved backend)

This repository contains the backend extracted from `muel-front-uiux`: an Express + Discord bot service intended to be deployed on Render.

## Separation Contract

- Frontend lives in: `team-muel/muel-front-uiux`
- Backend lives in: `team-muel/discord-news-bot`
- Frontend links this repo as a Git submodule at `moved-bot-repo`

When API contracts change, update backend first and then update frontend callers via `apiFetch`.

Quick start

1. Create a `.env` with the required environment variables (see below).
2. Install dependencies:

```
npm ci
```

3. Run in development:

```
npm run dev
```

4. Start production (Render uses `render.yaml`):

```
npm run start:server
```

Required environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (service role, keep secret)
- `START_BOT` (`true` by default, set `false` for API-only mode)
- `DISCORD_TOKEN` or `DISCORD_BOT_TOKEN` (required when `START_BOT=true`)
- `DISCORD_BOT_ALERT_WEBHOOK_URL` (optional)
- `DATABASE_URL` (if used)
- `APP_BASE_URL` (recommended, frontend origin such as `https://<vercel-domain>`)
- `OAUTH_REDIRECT_ALLOWLIST` (recommended for OAuth redirect validation, e.g. `https://<render-domain>,https://<vercel-domain>`)
- `CORS_ALLOWLIST` (optional, defaults to `OAUTH_REDIRECT_ALLOWLIST`)
- `RESEARCH_PRESET_ADMIN_USER_IDS` (optional, comma-separated Discord user IDs)
- `ADMIN_ALLOWLIST_TABLE` (optional, Supabase table name with `user_id` column)

Single service / primary bot mode

- Keep one Render Web Service
- Primary bot: `START_BOT=true` + `DISCORD_TOKEN`
- Recommended: run crawler scheduler only on primary path (`FEATURE_CRAWLER_SCHEDULER_ENABLED=true` as default)

API-only mode

- Set `START_BOT=false` to run backend API without starting Discord clients.

Local env template

- Copy from: `.env.backend.example`

Render deployment

- This repository includes `render.yaml` to configure a Render Web Service.
- Recommended branch: `moved/backend` (or your production backend branch).
- Build command: `npm ci`
- Start command: `npm run start:server`
- Health check: `/health`

CI

- A lightweight GitHub Actions workflow is included to run install + lint + TypeScript checks on PRs.

Notes

- Secrets and service-role keys must never be published to the client-side repo. Keep them in Render/GitHub Secrets.
- Discord OAuth2 Redirects must include `https://<render-domain>/auth/callback` exactly.
- If you need help wiring Render or adding monitoring, tell me which provider account to use and I can generate a sample config.
