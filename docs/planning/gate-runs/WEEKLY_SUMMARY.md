# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-04-15T16:25:29.398Z
- total_runs: 87
- go: 0
- no_go: 1
- pending: 86
- legacy_pending_no_go_excluded: 0
- legacy_pending_cutoff: n/a

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 85 |
| unknown | 2 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 1
- reliability_only_fail: 0
- quality_only_fail: 0
- all_gates_pending: 0
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 1
- required_actions_total: 4
- required_actions_estimated_completed: 0
- required_action_completion_rate: 0
- checklist_complete_runs: 0
- checklist_incomplete_runs: 1

## Runtime Loop Evidence Completion

- runs_with_evidence: 85
- complete_runs: 0
- incomplete_runs: 85
- missing_runs: 2
- known_runs: 85
- completion_rate: 0

## A-003 Operator Surface Completion

- canonical_endpoint: /api/bot/agent/runtime/worker-approval-gates?guildId=<id>&recentLimit=5
- runs_with_surface: 85
- complete_runs: 0
- incomplete_runs: 85
- missing_runs: 2
- known_runs: 85
- runtime_evidence_backfilled_runs: 0
- completion_rate: 0

## Sandbox Delegation Completion

- verified_runs: 0
- incomplete_runs: 85
- missing_runs: 2
- known_runs: 85
- completion_rate: 0

## Quality Signal Summary

- citation_rate_avg: 0 (samples=85)
- retrieval_hit_at_k_avg: 0.0095 (samples=85)
- hallucination_review_fail_rate_avg: 0 (samples=85)
- session_success_rate_avg: 0 (samples=85)

## Strategy Quality Normalization (M-07)

- retrieval_eval_runs_availability: ok
- answer_quality_reviews_availability: ok
- retrieval_eval_runs_samples: 200
- answer_quality_review_samples: 0
- retrieval_baseline_recall_at_k_avg: 0.084 (samples=36, ndcg_avg=0.0638)
- retrieval_graph_lore_recall_at_k_avg: 0 (samples=2, ndcg_avg=0)
- retrieval_intent_prefix_recall_at_k_avg: 0.0237 (samples=36, ndcg_avg=0.0211)
- retrieval_keyword_expansion_recall_at_k_avg: 0.0095 (samples=36, ndcg_avg=0.0095)
- retrieval_best_variant: graph_lore
- retrieval_best_variant_recall_at_k_avg: 0
- retrieval_active_variant: n/a
- retrieval_active_variant_recall_at_k_avg: n/a
- retrieval_delta_best_vs_baseline: -0.084
- retrieval_delta_active_vs_baseline: n/a
- baseline_normalized_quality_score: 0.084
- tot_normalized_quality_score: 0
- got_normalized_quality_score: 0
- delta_tot_vs_baseline: -0.084
- delta_got_vs_baseline: -0.084

## Recent Runs

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | Runtime Loop Evidence | A-003 Surface | Sandbox Delegation | File |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gate-20260415-162247 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-162247.md |
| gate-20260415-162031 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-162031.md |
| gate-20260415-161806 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161806.md |
| gate-20260415-161539 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161539.md |
| gate-20260415-161306 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161306.md |
| gate-20260415-161050 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-161050.md |
| gate-20260415-160807 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-160807.md |
| gate-20260415-160534 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-160534.md |
| gate-20260415-155946 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-155946.md |
| gate-20260415-155613 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-155613.md |
| gate-20260415-154730 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-154730.md |
| gate-20260415-153716 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-153716.md |
| gate-20260415-153504 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-153504.md |
| gate-20260415-153156 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-153156.md |
| gate-20260415-152850 | A | weekly:auto | pending | false | none | incomplete | incomplete | incomplete | docs/planning/gate-runs/2026-04-15_gate-20260415-152850.md |
