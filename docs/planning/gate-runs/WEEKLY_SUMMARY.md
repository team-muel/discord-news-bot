# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-03-21T08:59:37.465Z
- total_runs: 36
- go: 11
- no_go: 14
- pending: 11
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 32 |
| B | 1 |
| unknown | 3 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 11
- reliability_only_fail: 1
- quality_only_fail: 1
- all_gates_pending: 1
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 14
- required_actions_total: 49
- required_actions_estimated_completed: 33
- required_action_completion_rate: 0.6735
- checklist_complete_runs: 10
- checklist_incomplete_runs: 4

## Runtime Loop Evidence Completion

- runs_with_evidence: 7
- complete_runs: 4
- incomplete_runs: 3
- missing_runs: 29
- known_runs: 7
- completion_rate: 0.5714

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 13
- complete_runs: 4
- incomplete_runs: 9
- missing_runs: 23
- known_runs: 13
- runtime_evidence_backfilled_runs: 6
- completion_rate: 0.3077

## Sandbox Delegation Completion

- verified_runs: 4
- incomplete_runs: 3
- missing_runs: 29
- known_runs: 7
- completion_rate: 0.5714

## Quality Signal Summary

- citation_rate_avg: 0 (samples=13)
- retrieval_hit_at_k_avg: 0 (samples=13)
- hallucination_review_fail_rate_avg: 0 (samples=13)
- session_success_rate_avg: 0 (samples=13)

## Strategy Quality Normalization (M-07)

- retrieval_eval_runs_availability: ok
- answer_quality_reviews_availability: ok
- retrieval_eval_runs_samples: 82
- answer_quality_review_samples: 0
- baseline_normalized_quality_score: 0.1026
- tot_normalized_quality_score: 0
- got_normalized_quality_score: 0
- delta_tot_vs_baseline: -0.1026
- delta_got_vs_baseline: -0.1026

## Recent Runs

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate-20260321-085933 | A | weekly:auto | pending | false | none | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-085933.md |
| gate-20260321-085857 | A | weekly:auto | pending | false | none | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-085857.md |
| gate-post-fallback-1774082910559 | A | weekly:auto:post-fallback | no-go | true | stage | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082910559.md |
| gate-20260321-084830 | A | weekly:auto | no-go | true | stage | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-20260321-084830.md |
| gate-post-fallback-1774082881983 | A | weekly:auto:post-fallback | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082881983.md |
| gate-20260321-084801 | A | weekly:auto | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-20260321-084801.md |
| gate-20260321-083944 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-20260321-083944.md |
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| MONTHLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md |
| gate-post-fallback-1773928500597 | A | weekly:auto:post-fallback | no-go | true | stage | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-post-fallback-1773928500597.md |
| gate-20260319-135500 | A | weekly:auto | no-go | true | stage | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135500.md |
| gate-20260319-135437 | A | weekly:auto:post-fallback | no-go | true | stage | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135437.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-20260319-135316 | A | weekly:auto | pending | false | none | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-135316.md |
| gate-20260319-134426 | A | weekly:auto | pending | false | none | missing | incomplete | missing | docs/planning/gate-runs/2026-03-19_gate-20260319-134426.md |
