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
- `DISCORD_TOKEN` or `DISCORD_BOT_TOKEN`
- `ENABLE_SECONDARY_BOT` (optional, `true` to enable second bot in same service)
- `SECONDARY_DISCORD_TOKEN` (optional, required when `ENABLE_SECONDARY_BOT=true`)
- aliases: `SECONDARY_DISCORD_BOT_TOKEN`, `SECONDARY_BOT_TOKEN`
- `DISCORD_BOT_ALERT_WEBHOOK_URL` (optional)
- `DATABASE_URL` (if used)

Single service / two bots mode

- Keep one Render Web Service
- Primary bot: `DISCORD_TOKEN`
- Secondary bot: `ENABLE_SECONDARY_BOT=true` + `SECONDARY_DISCORD_TOKEN=<token>`
- Important: secondary token must be different from primary token
- Recommended: run crawler scheduler only on primary path (`FEATURE_CRAWLER_SCHEDULER_ENABLED=true` as default)

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
- If you need help wiring Render or adding monitoring, tell me which provider account to use and I can generate a sample config.
