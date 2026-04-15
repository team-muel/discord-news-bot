# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-04-15T14:05:36.420Z
- total_runs: 51
- go: 11
- no_go: 16
- pending: 24
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 47 |
| B | 1 |
| unknown | 3 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 13
- reliability_only_fail: 1
- quality_only_fail: 1
- all_gates_pending: 1
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 16
- required_actions_total: 57
- required_actions_estimated_completed: 33
- required_action_completion_rate: 0.5789
- checklist_complete_runs: 10
- checklist_incomplete_runs: 6

## Runtime Loop Evidence Completion

- runs_with_evidence: 22
- complete_runs: 4
- incomplete_runs: 18
- missing_runs: 29
- known_runs: 22
- completion_rate: 0.1818

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 28
- complete_runs: 4
- incomplete_runs: 24
- missing_runs: 23
- known_runs: 28
- runtime_evidence_backfilled_runs: 6
- completion_rate: 0.1429

## Sandbox Delegation Completion

- verified_runs: 4
- incomplete_runs: 18
- missing_runs: 29
- known_runs: 22
- completion_rate: 0.1818

## Quality Signal Summary

- citation_rate_avg: 0 (samples=28)
- retrieval_hit_at_k_avg: 0.0324 (samples=28)
- hallucination_review_fail_rate_avg: 0 (samples=28)
- session_success_rate_avg: 0 (samples=28)

## Strategy Quality Normalization (M-07)

- retrieval_eval_runs_availability: missing_table
- answer_quality_reviews_availability: missing_table
- retrieval_eval_runs_samples: 0
- answer_quality_review_samples: 0
- retrieval_baseline_recall_at_k_avg: n/a (samples=0, ndcg_avg=n/a)
- retrieval_graph_lore_recall_at_k_avg: n/a (samples=0, ndcg_avg=n/a)
- retrieval_intent_prefix_recall_at_k_avg: n/a (samples=0, ndcg_avg=n/a)
- retrieval_keyword_expansion_recall_at_k_avg: n/a (samples=0, ndcg_avg=n/a)
- retrieval_best_variant: n/a
- retrieval_best_variant_recall_at_k_avg: n/a
- retrieval_active_variant: n/a
- retrieval_active_variant_recall_at_k_avg: n/a
- retrieval_delta_best_vs_baseline: n/a
- retrieval_delta_active_vs_baseline: n/a
- baseline_normalized_quality_score: 0
- tot_normalized_quality_score: 0
- got_normalized_quality_score: 0
- delta_tot_vs_baseline: 0
- delta_got_vs_baseline: 0

## Recent Runs

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate-20260412-032855 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-12_gate-20260412-032855.md |
| MONTHLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-post-fallback-1774082881983 | A | weekly:auto:post-fallback | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082881983.md |
| gate-post-fallback-1774082910559 | A | weekly:auto:post-fallback | no-go | true | stage | complete | complete | verified | docs/planning/gate-runs/2026-03-21_gate-post-fallback-1774082910559.md |
| gate-20260411-095717 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-095717.md |
| gate-20260411-171636 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-171636.md |
| gate-20260411-172234 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-172234.md |
| gate-20260411-173628 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-173628.md |
| gate-20260411-173944 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-173944.md |
| gate-20260411-174852 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-174852.md |
| gate-20260411-181032 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-181032.md |
| gate-20260411-181241 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-181241.md |
| gate-20260411-183824 | A | weekly:auto | no-go | true | stage | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-11_gate-20260411-183824.md |
