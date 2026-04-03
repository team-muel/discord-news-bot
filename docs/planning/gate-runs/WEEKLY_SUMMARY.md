# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-04-03T19:05:45.655Z
- total_runs: 38
- go: 11
- no_go: 15
- pending: 12
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 34 |
| B | 1 |
| unknown | 3 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 12
- reliability_only_fail: 1
- quality_only_fail: 1
- all_gates_pending: 1
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 15
- required_actions_total: 53
- required_actions_estimated_completed: 33
- required_action_completion_rate: 0.6226
- checklist_complete_runs: 10
- checklist_incomplete_runs: 5

## Runtime Loop Evidence Completion

- runs_with_evidence: 9
- complete_runs: 4
- incomplete_runs: 5
- missing_runs: 29
- known_runs: 9
- completion_rate: 0.4444

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 15
- complete_runs: 4
- incomplete_runs: 11
- missing_runs: 23
- known_runs: 15
- runtime_evidence_backfilled_runs: 6
- completion_rate: 0.2667

## Sandbox Delegation Completion

- verified_runs: 4
- incomplete_runs: 5
- missing_runs: 29
- known_runs: 9
- completion_rate: 0.4444

## Quality Signal Summary

- citation_rate_avg: 0 (samples=15)
- retrieval_hit_at_k_avg: 0.0068 (samples=15)
- hallucination_review_fail_rate_avg: 0 (samples=15)
- session_success_rate_avg: 0 (samples=15)

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

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate-20260321-084830 | A | weekly:auto | no-go | true | stage | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-084830.md |
| gate-20260321-085857 | A | weekly:auto | pending | false | none | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-085857.md |
| gate-20260321-085933 | A | weekly:auto | pending | false | none | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-085933.md |
| gate-20260321-091717 | A | weekly:auto | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-20260321-091717.md |
| gate-20260321-092102 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-20260321-092102.md |
| gate-post-fallback-1774082881983 | A | weekly:auto:post-fallback | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082881983.md |
| gate-post-fallback-1774082910559 | A | weekly:auto:post-fallback | no-go | true | stage | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082910559.md |
| MONTHLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-20260319-111714 | A | weekly:auto | no-go | true | stage | missing | missing | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-111714.md |
| gate-20260319-112128 | A | weekly:auto:test | pending | false | none | missing | missing | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112128.md |
| gate-20260319-112731 | A | weekly:auto:profile-hint | pending | false | none | missing | missing | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112731.md |
| gate-20260319-112800 | A | weekly:auto:profile-hint-pass | go | false | none | missing | missing | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112800.md |
| gate-20260319-112914 | A | weekly:auto | no-go | true | stage | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-112914.md |
