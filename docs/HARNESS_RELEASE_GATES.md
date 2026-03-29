# Harness Release Gates

This document defines release gates for harness-level production readiness.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

## Gate 1: Build and Contract Integrity

Required:

1. `npm run lint`
2. `npm run docs:check`
3. No unresolved TypeScript errors
4. Planner/action contracts unchanged or intentionally documented

## Gate 2: Runtime Health

Required:

1. `GET /health` is healthy or expected degraded mode
2. `GET /ready` reports ready state
3. `GET /api/bot/status` returns active runtime snapshot
4. `GET /api/bot/agent/runtime/scheduler-policy` matches expected runtime ownership:
   - `service-init`: `memory-job-runner`, `opencode-publish-worker`, `trading-engine`, `runtime-alerts`
   - `discord-ready`: `automation-modules`, `agent-daily-learning`, `got-cutover-autopilot`, `obsidian-sync-loop`, `retrieval-eval-loop`, `login-session-cleanup`(app-owned), `agent-slo-alert-loop`
   - `database`: `supabase-maintenance-cron`, `login-session-cleanup`(db-owned)
5. `GET /api/bot/agent/runtime/loops` reports loop stats without unexpected stopped state for enabled loops
6. `GET /api/bot/agent/runtime/unattended-health` shows healthy telemetry/opencode readiness for unattended paths when enabled

Runtime topology note:

- `server.ts` starts the server-process runtime first.
- `src/services/runtimeBootstrap.ts` starts `service-init` loops before Discord ready.
- `src/discord/runtime/readyWorkloads.ts` starts `discord-ready` workloads only after bot ready.
- `src/services/runtimeSchedulerPolicyService.ts` is the canonical runtime loop inventory surface for operator checks.
- Release validation must confirm that docs, runtime snapshot, and actual startup ownership agree.
- Recommended automation command: `npm run ops:runtime:check -- --cookie=<admin-session-cookie> --guildId=<guild-id>`
- `--cookie` supports `name=value` or raw token (normalized with `AUTH_COOKIE_NAME`, default `muel_session`).

## Gate 3: Harness Safety

Required:

1. Action allowlist and host/table allowlists configured
2. Timeout/retry/circuit-breaker environment values set
3. Poison/sanitizer guards enabled for memory ingest
4. Privacy forget preview and confirmation flows intact

## Gate 4: Queue and Deadletter Stability

Required:

1. `GET /api/bot/agent/deadletters` checked for unexpected growth
2. `GET /api/bot/agent/memory/jobs/deadletters` checked
3. Deadletter recovery path validated (requeue endpoint)

## Gate 5: Cost and Quality

Required:

1. FinOps mode not unexpectedly blocked
2. Memory quality metrics checked:
   - citation rate
   - recall proxy
   - unresolved conflict rate
3. No known conflict with operator decision thresholds

## Gate 6: Runtime Artifact VCS Policy

Required:

1. Runtime artifacts are treated as operational outputs and are not tracked in VCS by default.
2. Incident evidence or test fixture commits are allowed only with minimal scope.
3. Exception commits include purpose, time window, and retention or removal plan in the same change set.
4. Release review confirms runtime artifact paths remain gitignored for routine development commits.

Automation note:

- `npm run gates:validate:strict` includes Gate 6 runtime artifact policy enforcement.

## Gate 7: Provider and Bootstrap Policy Documentation Consistency

Required:

1. HF token alias order remains documented as `HF_TOKEN -> HF_API_KEY -> HUGGINGFACE_API_KEY`.
2. Provider fallback chain rules match runtime resolver behavior (`llmClient.ts`) and fallback controls.
3. Bootstrap profile startup DAGs remain aligned with `server.ts`, `src/services/runtimeBootstrap.ts`, and `src/bot.ts`.
4. The policy anchors in runbook/architecture/env-template docs are validated before release.

Automation note:

- `npm run gates:validate:docs-policy` validates Gate 7 documentation anchors.
- `npm run gates:validate:strict` includes Gate 7 docs-policy validation.

## Go/No-Go Rule

Release is blocked when any of the following holds:

- SEV-1 unresolved condition exists
- deadletter queue is non-zero and untriaged
- finops mode remains `blocked` without Incident Commander approval
- required gate command/API checks fail

## Post-Release Validation

Within 30 minutes after deployment:

1. Repeat Gate 2 endpoints.
2. Run one admin action flow and one memory search flow.
3. Verify no spike in structured error events.
4. Confirm `memory-job-runner.startup` in scheduler policy matches intended boot source for this environment.
5. If `START_BOT=false`, verify `service-init` loops still report expected state while `discord-ready` workloads remain intentionally absent.
