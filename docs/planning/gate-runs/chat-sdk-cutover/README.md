# Chat SDK Cutover Gate Runs

This directory stores evidence for the M-24 Chat SDK Discord cutover verification session.

Reference contract:

- `docs/planning/CHAT_SDK_DISCORD_CUTOVER_VALIDATION.md`

Generator command:

- `npm run gates:discord:cutover`
- `npm run gates:discord:cutover:dry`

Live gate behavior:

- `npm run gates:discord:cutover` now operator-drives selected-path parity and forced-fallback rollback observation for both eligible surfaces into the live evidence counters before emitting the artifact pair.
- the rollback rehearsal is now surfaced per eligible surface in the report payload so exact-unit cleanup evidence can be inspected without inferring it from neighboring surfaces.
- `npm run gates:discord:cutover:dry` inspects the current live counters without synthesizing new live evidence unless explicit exercise flags are passed.
- lab rehearsal evidence remains isolated from live counters and is never accepted as the final production decision input.
- `npm run gates:discord:cutover:lab:dry` may still accept lab evidence on a dry-run even when dotenv resolves `NODE_ENV=production`; this stays rehearsal-only, writes no final artifact, and does not relax the non-dry production rule.

## Artifact Pair

Each validation run should emit both of the following.

- `YYYY-MM-DD_chat-sdk-cutover-<runId>.md`
- `YYYY-MM-DD_chat-sdk-cutover-<runId>.json`

The generator also consumes the live cutover evidence snapshot at `tmp/discord-ingress-cutover/latest.json`.

## Evidence Sourcing Rules

- An external `/health` payload can substitute only for bot/automation readiness when the validator is running away from the live process.
- Scheduler-policy ownership remains canonical only when that external payload includes `runtimeSchedulerPolicy.summary` with the exact `{ total, appOwned, dbOwned, enabled, running }` shape; otherwise fall back to the signed-in scheduler-policy snapshot or the in-process runtime service.
- When resetting `tmp/discord-ingress-cutover/latest.json` between lab/live windows or tests, persist the new in-memory snapshot immediately after reset. Do not lazy-rehydrate the previous file before writing, or stale totals can leak into the next run.

## Minimum Required Fields

Both artifact formats should capture the same decision inputs.

- `generated_at`
- `run_id`
- `environment`
- `adapter_id`
- `adapter_revision`
- `shadow_mode`
- `rollout_percentage`
- `eligible_surfaces`
- `parity`
- `fallback`
- `continuity_private_thread`
- `sanitization`
- `operator_runtime`
- `rollback`
- `overall`

## Markdown Skeleton

```md
# Chat SDK Discord Cutover Validation

- generated_at:
- run_id:
- environment:
- adapter_id:
- adapter_revision:
- shadow_mode:
- rollout_percentage:
- eligible_surfaces:
- overall: go | no-go

## Parity

- docs.ask:
- muel.prefixed:
- fallback:
- continuity_private_thread:
- sanitization:

## Operator Runtime

- ready:
- scheduler_policy:
- deadletters:
- structured_errors:

## Rollback

- exercised:
- result:
- notes:

## Evidence

- tests:
- transcripts:
- api_checks:
- logs:
```

## Operational Rules

- Treat this directory as evidence, not as the canonical migration plan.
- Record one artifact pair for each shadow, canary, and full-cutover decision point.
- If a run is `no-go`, include the failed invariant and the rollback outcome in the same artifact pair.
- Keep delete-candidate grace-period evidence here until the separate legacy-removal session closes.
