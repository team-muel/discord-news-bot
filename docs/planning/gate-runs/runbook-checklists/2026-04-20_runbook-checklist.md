# Stage Rollback Runbook Auto-Check

- generated_at: 2026-04-20T08:27:45.238Z
- verdict: PASS
- checkpoints: 5
- passed: 5
- failed: 0

## Checkpoint Results

- [x] Rehearsal evidence freshness (<= maxSummaryAgeHours)
  - status: OK
  - detail: age_hours=0.0, generated_at=2026-04-20T08:27:28.430Z
- [x] P95 recovery SLA (<= maxRecoveryMinutes)
  - status: OK
  - detail: p95_elapsed_ms=0, limit_ms=600000
- [x] Fail count within threshold
  - status: OK
  - detail: fail=0, max=0
- [x] No-go decision triggers rollback procedure
  - status: OK
  - detail: no no-go runs with rollback required in recent history (not required)
- [x] Post-rollback health endpoints available
  - status: OK
  - detail: GET /health + GET /ready configured (runtime verified at startup)

## Configuration

- maxSummaryAgeHours: 36
- maxRecoveryMinutes: 10
- maxFailCount: 0

## Remediation

- none required
