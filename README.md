# Discord News Bot (moved backend)

This repository contains the backend extracted from `muel-front-uiux`: an Express + Discord bot service intended to be deployed on Render.

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
- `DISCORD_BOT_ALERT_WEBHOOK_URL` (optional)
- `DATABASE_URL` (if used)

Render deployment

- This repository includes `render.yaml` to configure a Render Web Service. Point Render at this repo and use the `moved/backend` branch (or merge to `main`).

CI

- A lightweight GitHub Actions workflow is included to run install + lint + TypeScript checks on PRs.

Notes

- Secrets and service-role keys must never be published to the client-side repo. Keep them in Render/GitHub Secrets.
- If you need help wiring Render or adding monitoring, tell me which provider account to use and I can generate a sample config.