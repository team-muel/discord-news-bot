# Muel Harness Engineering Playbook

This document defines how Muel applies Harness Engineering around the model runtime.

## 1) What Harness Engineering Means

Harness Engineering is the full runtime environment design around the model:

- prompt and context contracts
- tool routing and failover
- policy and safety gates
- skill files and execution orchestration
- release/eval criteria

In short: model quality alone is not enough; runtime harness quality determines reliability.

## 2) Current Harness State in This Repo

Already implemented:

- Prompt and context layer:
  - `src/services/skills/actions/code.ts`
  - `docs/CONTEXT_ENGINEERING_STRATEGY.md`
- Rule-based planner harness:
  - `docs/SKILL_ACTION_RULES.json`
  - `src/services/skills/actions/plannerRules.ts`
- Tool execution harness:
  - `src/services/skills/actionRunner.ts`
  - cache, circuit-breaker, retries, approval flow
- MCP/tool-bus harness:
  - `src/mcp/server.ts`
  - `src/services/mcpWorkerClient.ts`
- Runtime queue/deadletter harness:
  - `src/services/multiAgentService.ts`
  - `src/routes/bot.ts` (`/api/bot/agent/deadletters`)
- Runtime control-plane harness:
  - `src/services/runtimeBootstrap.ts`
  - `src/services/runtimeSchedulerPolicyService.ts`
  - `src/routes/bot-agent/runtimeRoutes.ts`
  - `scripts/check-runtime-control-plane.mjs`

## 3) Harness Layers (Muel Standard)

### Layer A: Prompt and Context Contract

- Keep prompt contracts versioned and explicit.
- Enforce context selection/summarization/splitting before generation.
- Store compact memo of applied context strategy per task.

### Layer B: Skills and Action Contracts

- Every action must have deterministic input/output shape.
- Policy rules must remain externalized (`docs/SKILL_ACTION_RULES.json`).
- Action failures must report structured verification and error codes.

### Layer C: MCP and External Tooling

- MCP calls require timeout, parse guard, and typed error normalization.
- Strict host/table allowlists for web/db actions.
- Prefer worker-first execution where external I/O is heavy.

### Layer D: Runtime Governance

- Queue size, step/session timeout, retry attempts, deadletter caps are environment-tunable.
- Track runtime state with queue + deadletter metrics.
- Distinguish `service-init`, `discord-ready`, and `database` scheduler ownership in operator tooling.
- Treat scheduler-policy as the control-plane snapshot for runtime ownership, not as a guessed document-only model.
- Introduce release gates before production promotion.

## 4) Maturity Levels (Apply All)

### Level 1: Minimum Harness

- Prompt/context contracts documented.
- Tool allowlist and timeout enabled.
- Basic lint/typecheck + smoke checks in release flow.

### Level 2: Operational Harness

- Policy-as-data (rules in docs/json) and per-tenant action governance.
- Queue/deadletter monitoring and operator decision matrix.
- Structured error logging with actionable codes.

### Level 3: Enterprise Harness

- Release gates with quality/cost/latency thresholds.
- Weekly harness review and drift correction.
- Incident/postmortem feedback loop updates harness docs within 24h.

## 5) File Standards

Harness-relevant docs should be maintained together:

- Core playbook: `docs/HARNESS_ENGINEERING_PLAYBOOK.md`
- Manifest contract: `docs/HARNESS_MANIFEST.example.yaml`
- Release gates: `docs/HARNESS_RELEASE_GATES.md`
- Runbook integration: `docs/RUNBOOK_MUEL_PLATFORM.md`

## 6) Operator Workflow

1. Validate environment (`npm run env:check`).
2. Validate code/doc sync (`npm run lint`, `npm run docs:check`).
3. Validate runtime APIs (`/health`, `/ready`, `/api/bot/status`).
4. Validate harness risk APIs:
   - `/api/bot/agent/deadletters`
   - `/api/bot/agent/memory/jobs/deadletters`
   - `/api/bot/agent/actions/approvals`
5. Validate runtime control-plane with `npm run ops:runtime:check -- --cookie=<admin-session-cookie> --guildId=<guild-id>`.
6. Confirm `scheduler-policy`, `loops`, and `unattended-health` are reachable and structurally valid.
7. Confirm `service-init` vs `discord-ready` ownership matches deployment intent.
8. Apply Gate 6 (`Runtime Artifact VCS Policy`) from `docs/HARNESS_RELEASE_GATES.md` before rollout.
9. Apply go/no-go decision table before rollout.

Cookie format note:

- `--cookie` should carry authenticated admin session cookie material.
- Preferred explicit form is `name=value` (example: `muel_session=<token>`).
- Raw token input is accepted and normalized with `AUTH_COOKIE_NAME` (default `muel_session`).

## 7) KPIs for Harness Quality

- Session failure rate
- Deadletter count and time-to-recovery
- Action timeout ratio
- Citation/recall quality metrics
- FinOps mode transitions (`normal|degraded|blocked`)

## 8) Change Policy

When harness behavior changes:

1. Update this playbook and `docs/HARNESS_RELEASE_GATES.md`.
2. Update runbook links and decision criteria.
3. Regenerate generated docs (`npm run docs:build`).
4. If route/control-plane meaning changed, confirm `docs/ROUTES_INVENTORY.md` still advertises the correct operator hotspots.
5. Add architecture log entry if runtime meaning changed.
6. If runtime artifact paths or handling changed, re-validate Gate 6 wording matches runbook/unattended/env template policy text.
