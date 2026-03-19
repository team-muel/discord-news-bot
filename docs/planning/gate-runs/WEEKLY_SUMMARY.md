# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-03-19T19:15:29.632Z
- total_runs: 27
- go: 11
- no_go: 10
- pending: 6
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 25 |
| B | 1 |
| unknown | 1 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 7
- reliability_only_fail: 1
- quality_only_fail: 1
- all_gates_pending: 1
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 10
- required_actions_total: 33
- required_actions_estimated_completed: 33
- required_action_completion_rate: 1
- checklist_complete_runs: 10
- checklist_incomplete_runs: 0

## Quality Signal Summary

- citation_rate_avg: 0 (samples=6)
- retrieval_hit_at_k_avg: 0 (samples=6)
- hallucination_review_fail_rate_avg: 0 (samples=6)
- session_success_rate_avg: 0 (samples=6)

## Strategy Quality Normalization (M-07)

- retrieval_eval_runs_availability: missing_table
- answer_quality_reviews_availability: missing_table
- retrieval_eval_runs_samples: 0
- answer_quality_review_samples: 0
- baseline_normalized_quality_score: 0
- tot_normalized_quality_score: 0
- got_normalized_quality_score: 0
- delta_tot_vs_baseline: 0
- delta_got_vs_baseline: 0

## Recent Runs

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | File |
| --- | --- | --- | --- | --- | --- | --- |
| gate-20260319-170500 | A | control-plane:w3-04-w3-05 | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-170500.md |
| gate-20260319-173500 | A | trading-isolation:w4-01-w4-03 | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-173500.md |
| gate-post-fallback-1773928500597 | A | weekly:auto:post-fallback | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-post-fallback-1773928500597.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-20260318-081523 | A | guild:demo | pending | unknown | none | docs/planning/gate-runs/2026-03-18_gate-20260318-081523.md |
| gate-20260318-081925 | B | guild:demo | no-go | true | queue | docs/planning/gate-runs/2026-03-18_gate-20260318-081925.md |
| gate-20260318-082348 | A | guild:demo | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-082348.md |
| gate-20260318-144107 | A | contracts:w1-03 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-144107.md |
| gate-20260318-144228 | A | contracts:w1-04-w1-05 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-144228.md |
| gate-20260318-144522 | A | contracts:w1-06 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-144522.md |
| gate-20260318-161222 | A | memory-queue:w2-01-w2-03 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-161222.md |
| gate-20260318-162647 | A | memory-queue:w2-04-w2-06 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-162647.md |
| gate-20260318-172700 | A | trading-isolation:w4-04-w4-06 | no-go | true | stage | docs/planning/gate-runs/2026-03-18_gate-20260318-172700.md |
| gate-20260319-103500 | A | control-plane:w3-01-w3-03 | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-103500.md |
| gate-20260319-105036 | A | guild:demo | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-105036.md |
