# Personal Operating System Services

## Purpose

This document packages existing primitives into named personal services.

It is a packaging layer over the current control plane. It does not add a new execution engine.

For public-facing Muel super-agent packaging, see `docs/planning/MUEL_SUPER_AGENT_PRODUCT_PACKAGING.md` and `docs/front-uiux-handoff/MUEL_SUPER_AGENT_PRODUCT_EXPERIENCE.md`.
For the stronger owner-only personalized orchestration tier, see `docs/planning/OWNER_PERSONALIZED_AGENT_ORCHESTRATION.md`.

The canonical API surface is under `/api/bot/agent/super/services/*`.

## Route Entrypoints

- `GET /api/bot/agent/super/services`
- `GET /api/bot/agent/super/services/:serviceId`
- `POST /api/bot/agent/super/services/:serviceId/recommend`
- `POST /api/bot/agent/super/services/:serviceId/sessions`

## Service Catalog

| Service ID | Service Name | Default Mode / Lead | What It Packages | Primary Existing Surfaces | Existing Commands |
| --- | --- | --- | --- | --- | --- |
| `personal-workflow-copilot` | Personal Workflow Copilot | `local-collab` / `Architect` | turns current personal operating context into one bounded next step, owner lane, and artifact list | `GET /api/bot/agent/runtime/operator-snapshot`, `GET /api/bot/agent/runtime/workset`, `POST /api/bot/agent/super/sessions` | `npm run local:control-plane:future`, `npm run openjarvis:goal:status` |
| `personal-backlog-router` | Personal Backlog Router | `delivery` / `Architect` | classifies backlog into now, next, later, and human-review lanes using the existing routing surfaces | `GET /api/bot/agent/task-routing/summary`, `GET /api/bot/agent/runtime/operator-snapshot`, `POST /api/bot/agent/super/recommend` | `npm run local:autonomy:supervisor:status`, `npm run openjarvis:goal:status` |
| `knowledge-distiller` | Knowledge Distiller | `delivery` / `Review` | turns source material into reusable operator knowledge and promotion-ready artifacts | `GET /api/bot/agent/obsidian/knowledge-control`, `POST /api/bot/agent/obsidian/knowledge-promote`, `GET /api/bot/agent/obsidian/internal-knowledge` | `npm run wiki:commit`, `npm run obsidian:backfill:system:report` |
| `local-hands-runner` | Local Hands Runner | `operations` / `Implement` | runs one bounded local implementation or operator task through the existing execution surfaces | `GET /api/bot/agent/actions/catalog`, `POST /api/bot/agent/actions/execute`, `POST /api/bot/agent/runtime/openjarvis/hermes-runtime/chat-launch` | `npm run openjarvis:hermes:runtime:chat-launch:executor`, `npm run openjarvis:hermes:runtime:swarm-launch:dry` |
| `weekly-quality-or-cost-reporter` | Weekly Quality Or Cost Reporter | `operations` / `Operate` | emits the current weekly quality or cost picture from existing report commands and runtime evidence | `GET /api/bot/agent/runtime/operator-snapshot`, `GET /api/bot/agent/runtime/unattended-health`, `GET /api/bot/agent/runtime/loops` | `npm run gates:weekly-report:all:dry`, `npm run ops:gcp:report:weekly`, `npm run capability:audit:markdown` |

## Operator Rules

- Use a service bundle when the request matches one of the named operating-system jobs above.
- Use the raw super-agent surface when the request does not fit a named bundle yet.
- Keep outputs explicit about which existing route surfaces or package commands were actually used.
- If a bundle needs a capability that does not already exist, extend the underlying existing surface first. Do not create a parallel engine just for the bundle.

## Request Shape

The route wrappers accept the same bounded task fields already used by the super-agent facade.

- required: `guild_id`
- optional: `objective`, `priority`, `constraints`, `acceptance_criteria`, `inputs`, `budget`, `route_mode`, `requested_lead_agent`, `skill_id`, `current_stage`

If `objective` is omitted, the bundle default objective is used.

## Expected Outcome

The service layer should let an operator call this repository as a personal operating system rather than as a loose agent experiment surface.

That means each call should resolve to a named job, a bounded lane, explicit verification surfaces, and reusable follow-up artifacts.
