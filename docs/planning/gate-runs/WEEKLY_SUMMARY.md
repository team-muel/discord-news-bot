# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-04-11T09:57:13.613Z
- total_runs: 2
- go: 0
- no_go: 0
- pending: 2
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| unknown | 2 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 0
- reliability_only_fail: 0
- quality_only_fail: 0
- all_gates_pending: 0
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 0
- required_actions_total: 0
- required_actions_estimated_completed: 0
- required_action_completion_rate: n/a
- checklist_complete_runs: 0
- checklist_incomplete_runs: 0

## Runtime Loop Evidence Completion

- runs_with_evidence: 0
- complete_runs: 0
- incomplete_runs: 0
- missing_runs: 2
- known_runs: 0
- completion_rate: n/a

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 0
- complete_runs: 0
- incomplete_runs: 0
- missing_runs: 2
- known_runs: 0
- runtime_evidence_backfilled_runs: 0
- completion_rate: n/a

## Sandbox Delegation Completion

- verified_runs: 0
- incomplete_runs: 0
- missing_runs: 2
- known_runs: 0
- completion_rate: n/a

## Quality Signal Summary

- citation_rate_avg: n/a (samples=0)
- retrieval_hit_at_k_avg: n/a (samples=0)
- hallucination_review_fail_rate_avg: n/a (samples=0)
- session_success_rate_avg: n/a (samples=0)

## Strategy Quality Normalization (M-07)

- retrieval_eval_runs_availability: ok
- answer_quality_reviews_availability: ok
- retrieval_eval_runs_samples: 200
- answer_quality_review_samples: 0
- baseline_normalized_quality_score: 0.0776
- tot_normalized_quality_score: 0
- got_normalized_quality_score: 0
- delta_tot_vs_baseline: -0.0776
- delta_got_vs_baseline: -0.0776

## Recent Runs

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| MONTHLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md |
