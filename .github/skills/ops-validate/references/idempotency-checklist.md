# Idempotency Checklist

> Load when verifying script and workflow reliability for unattended runs.

## Definition

An operation is idempotent if running it N times produces the same result as running it once.

## Checklist for Scripts

- [ ] Re-running the script with the same input produces the same output
- [ ] No duplicate database rows created on repeated runs
- [ ] File operations use write-or-replace, not append
- [ ] API calls use PUT/PATCH (idempotent) over POST where possible
- [ ] Unique constraints or `ON CONFLICT` clauses prevent duplicate inserts

## Checklist for Workflows (GitHub Actions)

- [ ] Re-run from failed step produces correct result
- [ ] Environment setup is deterministic (pinned versions)
- [ ] Artifacts don't accumulate on re-runs
- [ ] Cache keys include content hashes, not just timestamps

## Checklist for Cron Jobs

- [ ] Job handles "already ran for this period" gracefully
- [ ] No race condition if two instances fire simultaneously
- [ ] State markers (e.g., "last processed ID") are durable
- [ ] Failure leaves state recoverable for next run

## Common Idempotency Failures

| Pattern | Problem | Fix |
|---|---|---|
| `INSERT INTO` without `ON CONFLICT` | Duplicate rows | Add `ON CONFLICT DO UPDATE` or `DO NOTHING` |
| `fs.appendFileSync` in cron | File grows forever | Use write-replace or rotate |
| Counter increment in retry loop | Over-counted | Use idempotency key |
| Non-atomic file write | Partial write on crash | Use `atomicWriteFile` from utils |
