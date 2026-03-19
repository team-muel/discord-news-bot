# Hybrid Weekly Decision Snapshot

- generated_at: 2026-03-19T11:17:12.892Z
- window_days: 7
- guild_id: *
- provider: *
- action_prefix: *
- overall_status: review_required

## Go/No-Go Summary

- total_runs: 16
- go: 10
- no_go: 5
- pending: 1

## LLM Latency Summary

- baseline_total: 0
- candidate_total: 70
- p95_delta_ms: 6739
- p50_delta_ms: 3844
- success_rate_delta_pct: 100

## Rollback Rehearsal Summary

- total_runs: 0
- pass: 0
- fail: 0
- p95_elapsed_ms: 0

## Memory Queue Summary

- jobs_total: 0
- retry_rate_pct: 0
- queue_lag_p95_sec: 0
- deadletter_pending: 0
- deadletter_ignored: 0

## Inputs

- go_no_go_report_key: go_no_go_weekly|2026-03-19|days:7|guild:*|provider:*|prefix:*
- llm_latency_report_key: llm_latency_weekly|*|*|*|2026-03-09T11:17:12.306Z|2026-03-09T11:17:12.307Z|2026-03-16T11:17:12.307Z|2026-03-19T11:17:12.307Z
- rollback_rehearsal_report_key: missing
- memory_queue_report_key: missing
