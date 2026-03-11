# Architecture Index

## Purpose

This document is the external analysis entrypoint for the backend repository.
It provides a stable map of runtime flow, domain boundaries, and data boundaries.

## Runtime Entrypoints

- `server.ts`: HTTP API process bootstrap.
- `bot.ts`: Discord bot-only process bootstrap.
- `src/app.ts`: Express middleware and route composition.
- `src/bot.ts`: Discord command/event runtime and bot orchestration.

## Request Flow (HTTP)

1. `server.ts` loads env and monitoring.
2. `createApp()` in `src/app.ts` composes middleware.
3. Global middleware: CORS, JSON body parser, cookie parser, user attach, CSRF guard.
4. Domain routers mounted under `/api/*` plus health and readiness endpoints.
5. Fallback returns `404 NOT_FOUND`.

## Domain Routers

- `/api/auth`: login, callback, session endpoints.
- `/api/research`: preset retrieval and management.
- `/api/fred`: economic data endpoints.
- `/api/quant`: quant panel contract endpoint.
- `/api/bot`: runtime status, automation controls, agent operations.
- `/api/benchmark`: benchmark event ingest and summary.
- `/api/trades`: trade query and write APIs.
- `/api/trading`: strategy/runtime/position control APIs.
- `/health`, `/ready`, `/api/status`: operational health surface.

## Core Service Domains

- Auth and identity: session parse, cookie/token validation, admin allowlist.
- Automation runtime: scheduled jobs and worker health.
- Agent runtime: multi-agent orchestration, policy, memory/session persistence.
- Trading runtime: strategy, engine loop, distributed lock protections.
- Integrations: Supabase, Discord, LLM providers, external market/macro sources.

## Data Boundaries

- Canonical schema bootstrap: `docs/SUPABASE_SCHEMA.sql`.
- Schema usage map (generated): `docs/SCHEMA_SERVICE_MAP.md`.
- Table families:
- User/authn/authz (`users`, `user_roles`, `settings`).
- News and automation telemetry (`sources`, `alerts`, `logs`, `news_sentiment`, `youtube_log`).
- Trading (`trading_strategy`, `trades`, related control/runtime tables).
- Agent runtime (`agent_sessions`, `agent_steps`, policy/memory-related tables when configured).
- Infra primitives (`distributed_locks`, rate-limit RPC backing objects).

## Generated Analysis Artifacts

- Route inventory: `docs/ROUTES_INVENTORY.md`
- Dependency graph: `docs/DEPENDENCY_GRAPH.md`
- Schema-service usage map: `docs/SCHEMA_SERVICE_MAP.md`

Regeneration command:

```bash
npm run docs:build
```

## Change Control

When modifying route registration, core service boundaries, or persistence strategy:

1. Update this index when structure meaning changes.
2. Run `npm run docs:build`.
3. Add an entry in `docs/CHANGELOG-ARCH.md`.
