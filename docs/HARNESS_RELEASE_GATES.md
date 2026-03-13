# Harness Release Gates

This document defines release gates for harness-level production readiness.

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
