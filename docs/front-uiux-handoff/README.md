# Front UI/UX Handoff Kit

This folder contains copy-ready integration assets for `team-muel/muel-front-uiux`.

## Files

- `env.frontend.example`: frontend env template
- `api.types.ts`: shared response/request typings
- `api.client.ts`: fetch client with cookie-based auth defaults

## Quick Import Into Front Repo

1. Copy `env.frontend.example` into frontend root and rename to `.env.local`.
2. Copy `api.types.ts` and `api.client.ts` into frontend path like `src/lib/muel-api/`.
3. Use `createMuelApiClient(import.meta.env.VITE_API_BASE_URL)` to initialize once.
4. Ensure frontend requests use `credentials: include` (already inside the provided client).

## OAuth Popup Wiring

Backend callback endpoint posts one of these events to opener window:

- `OAUTH_AUTH_SUCCESS`
- `OAUTH_AUTH_ERROR`

Frontend listener example:

```ts
const popupOrigin =
  import.meta.env.VITE_OAUTH_POPUP_ORIGIN ||
  new URL(import.meta.env.VITE_API_BASE_URL).origin;

window.addEventListener("message", (event) => {
  if (event.origin !== popupOrigin) {
    return;
  }

  if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
    // re-fetch /api/auth/me, then update auth store
  }

  if (event.data?.type === "OAUTH_AUTH_ERROR") {
    // show toast and keep user logged out
  }
});
```

Popup start flow:

```ts
const { authorizeUrl } = await api.getAuthLoginUrl();
window.open(authorizeUrl, "discord-login", "width=480,height=720");
```

## Endpoint Groups Used By Frontend

- Public: `/health`, `/api/status`, `/api/quant/panel`, `/api/fred/playground`, `/api/research/preset/:presetKey`
- Auth required: `/api/auth/me`, `/api/auth/logout`, `/api/bot/status`, `/api/research/preset/:presetKey/history`, `/api/trades`
- Admin required: `/api/bot/reconnect`, `/api/bot/automation/:jobName/run`, `/api/research/preset/:presetKey`, `/api/trades (POST)`, `/api/trading/*`

## Admin Permission Readiness

Backend admin checks are strict. If no allowlist source is configured, admin APIs return `503 CONFIG`.

Required backend setup (choose one or both):

- Static allowlist env: `RESEARCH_PRESET_ADMIN_USER_IDS=<discordUserId1>,<discordUserId2>`
- Dynamic allowlist table (Supabase):
  - table: `user_roles` (default, configurable via `ADMIN_ALLOWLIST_TABLE`)
  - accepted user id columns: `user_id` or `discord_user_id` or `id`
  - role filter: `role='admin'` (configurable via `ADMIN_ALLOWLIST_ROLE_VALUE`)
  - inactive row handling: rows with `active=false` are ignored

Frontend behavior recommendations:

- Always call `/api/auth/me` first and cache user id.
- Hide admin menus by default; show only after an admin-only endpoint succeeds.
- Handle `403 FORBIDDEN` as "logged-in but not admin".
- Handle `503 CONFIG` as "backend admin allowlist misconfigured" and show ops guidance.
- Keep a read-only fallback view for panels that use `/api/trading/*` or bot admin actions.

Quick verification flow:

1. Login via OAuth popup.
2. Call `GET /api/auth/me` and confirm session is set.
3. Call `GET /api/trading/strategy`:
4. Expect `200` for admin users, `403` for non-admin users, `503` when allowlist source is missing.

## Deployment Alignment Checklist

- Backend `CORS_ALLOWLIST` includes frontend origin(s).
- Frontend and backend are both HTTPS in production.
- Production backend has `DEV_AUTH_ENABLED=false`.
- Backend session cookie name defaults to `muel_session`; frontend must not override it.
- If Discord OAuth is enabled, backend has:
  - `DISCORD_OAUTH_CLIENT_ID`
  - `DISCORD_OAUTH_CLIENT_SECRET`
  - `DISCORD_OAUTH_REDIRECT_URI` pointing to `/api/auth/callback`

## Known Error Shapes

- `401 { error: 'UNAUTHORIZED' }`
- `403 { error: 'FORBIDDEN' }`
- `409 { ok: false, message: string }` for reconnect/job trigger conflicts
- `422 { error: 'INVALID_PAYLOAD', message?: string }`
- `503 { error: 'CONFIG', message: string }`
- `502 { error: 'UPSTREAM', message: string }` for AI-trading upstream failures

Use `ApiError` from `api.types.ts` to normalize these in your UI layer.
