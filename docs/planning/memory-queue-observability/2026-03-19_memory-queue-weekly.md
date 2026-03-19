# Memory Queue Observability Weekly Report

- generated_at: 2026-03-19T11:17:13.825Z
- window_days: 7
- guild_id: *
- baseline_from: 2026-03-12T11:17:13.826Z
- baseline_to: 2026-03-19T11:17:13.825Z

## Queue Summary

- jobs_total: 0
- jobs_queued: 0
- jobs_running: 0
- jobs_completed: 0
- jobs_failed: 0
- jobs_deadlettered: 0
- retry_rate_pct: 0

## Lag and Recovery

- queue_lag_p50_sec: 0
- queue_lag_p95_sec: 0
- deadletter_total: 0
- deadletter_requeued: 0
- deadletter_ignored: 0
- deadletter_pending: 0

## Deadletter Error Codes (Top)

| error_code | count |
| --- | ---: |
| - | 0 |

## Commands

- queue stats API: GET /api/bot/agent/memory/jobs/queue-stats
- deadletters API: GET /api/bot/agent/memory/jobs/deadletters
- requeue API: POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue
