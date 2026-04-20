# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-04-20T08:27:24.631Z
- total_runs: 124
- go: 11
- no_go: 16
- pending: 97
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 120 |
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

- runs_with_evidence: 95
- complete_runs: 4
- incomplete_runs: 91
- missing_runs: 29
- known_runs: 95
- completion_rate: 0.0421

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 101
- complete_runs: 4
- incomplete_runs: 97
- missing_runs: 23
- known_runs: 101
- runtime_evidence_backfilled_runs: 6
- completion_rate: 0.0396

## Sandbox Delegation Completion

- verified_runs: 4
- incomplete_runs: 91
- missing_runs: 29
- known_runs: 95
- completion_rate: 0.0421

## Quality Signal Summary

- citation_rate_avg: 0 (samples=101)
- retrieval_hit_at_k_avg: 0.009 (samples=101)
- hallucination_review_fail_rate_avg: 0 (samples=101)
- session_success_rate_avg: 0 (samples=101)

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
| WEEKLY_GCP_WORKER_COST_HEALTH | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md |
| WEEKLY_SUMMARY_NORMALIZED | unknown | unknown | pending | unknown | unknown | missing | missing | missing | docs/planning/gate-runs/WEEKLY_SUMMARY_NORMALIZED.md |
| gate-20260415-153504 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-153504.md |
| gate-20260415-153716 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-153716.md |
| gate-20260415-154730 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-154730.md |
| gate-20260415-155613 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-155613.md |
| gate-20260415-155946 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-155946.md |
| gate-20260415-160534 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-160534.md |
| gate-20260415-160807 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-160807.md |
| gate-20260415-161050 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161050.md |
| gate-20260415-161306 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161306.md |
| gate-20260415-161539 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161539.md |
| gate-20260415-161806 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161806.md |
| gate-20260415-162031 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-162031.md |
| gate-20260415-162247 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-162247.md |
