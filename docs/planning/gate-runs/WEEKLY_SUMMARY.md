# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-03-20T03:10:15.448Z
- total_runs: 29
- go: 11
- no_go: 10
- pending: 8
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 25 |
| B | 1 |
| unknown | 3 |

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

## Runtime Loop Evidence Completion

- runs_with_evidence: 0
- complete_runs: 0
- incomplete_runs: 0
- missing_runs: 29
- known_runs: 0
- completion_rate: n/a

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

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | File |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | missing | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-20260319-111711 | A | weekly:auto | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-111711.md |
| gate-20260319-111714 | A | weekly:auto | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-111714.md |
| gate-20260319-112128 | A | weekly:auto:test | pending | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112128.md |
| gate-20260319-112731 | A | weekly:auto:profile-hint | pending | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112731.md |
| gate-20260319-112800 | A | weekly:auto:profile-hint-pass | go | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112800.md |
| gate-20260319-112914 | A | weekly:auto | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112914.md |
| gate-20260319-134426 | A | weekly:auto | pending | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-134426.md |
| gate-20260319-135316 | A | weekly:auto | pending | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135316.md |
| gate-20260319-135437 | A | weekly:auto:post-fallback | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135437.md |
| gate-20260319-135500 | A | weekly:auto | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135500.md |
| gate-20260319-170500 | A | control-plane:w3-04-w3-05 | go | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-170500.md |
| gate-20260319-173500 | A | trading-isolation:w4-01-w4-03 | go | false | none | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-173500.md |
| gate-post-fallback-1773928500597 | A | weekly:auto:post-fallback | no-go | true | stage | missing | docs/planning/gate-runs/2026-03-19_gate-post-fallback-1773928500597.md |
