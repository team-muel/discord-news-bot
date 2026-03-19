# Go/No-Go Weekly Summary

- window_days: 7
- generated_at: 2026-03-19T13:53:29.312Z
- total_runs: 22
- go: 11
- no_go: 6
- pending: 5
- legacy_pending_no_go_excluded: 1
- legacy_pending_cutoff: 2026-03-19T00:00:00.000Z

## Stage Distribution

| Stage | Count |
| --- | ---: |
| A | 22 |

## No-Go Root Cause Breakdown

- reliability_quality_dual_fail: 4
- reliability_only_fail: 1
- quality_only_fail: 1
- all_gates_pending: 1
- other: 0

## Required Action Completion (Estimated)

- no_go_runs: 7
- required_actions_total: 21
- required_actions_estimated_completed: 21
- required_action_completion_rate: 1
- checklist_complete_runs: 7
- checklist_incomplete_runs: 0

## Quality Signal Summary

- citation_rate_avg: 0 (samples=3)
- retrieval_hit_at_k_avg: 0 (samples=3)
- hallucination_review_fail_rate_avg: 0 (samples=3)
- session_success_rate_avg: 0 (samples=3)

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

| Run ID | Stage | Scope | Overall | Rollback Required | Rollback Type | File |
| --- | --- | --- | --- | --- | --- | --- |
| gate-20260319-135316 | A | weekly:auto | pending | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-135316.md |
| gate-20260319-134426 | A | weekly:auto | pending | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-134426.md |
| gate-20260319-112800 | A | weekly:auto:profile-hint-pass | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-112800.md |
| gate-20260319-112914 | A | weekly:auto | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-20260319-112914.md |
| gate-20260319-112731 | A | weekly:auto:profile-hint | pending | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-112731.md |
| gate-20260319-112128 | A | weekly:auto:test | pending | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-112128.md |
| gate-20260319-111714 | A | weekly:auto | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-20260319-111714.md |
| gate-20260319-111711 | A | weekly:auto | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-20260319-111711.md |
| gate-20260319-111443 | A | weekly:auto | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-20260319-111443.md |
| gate-20260319-111442 | A | guild:demo | no-go | true | stage | docs/planning/gate-runs/2026-03-19_gate-20260319-111442.md |
| gate-20260319-105036 | A | guild:demo | go | false | none | docs/planning/gate-runs/2026-03-19_gate-20260319-105036.md |
| gate-20260318-081925 (legacy-pending) | B | guild:demo | no-go | true | queue | docs/planning/gate-runs/2026-03-18_gate-20260318-081925.md |
| gate-20260318-172700 | A | trading-isolation:w4-04-w4-06 | no-go | true | stage | docs/planning/gate-runs/2026-03-18_gate-20260318-172700.md |
| gate-20260318-162647 | A | memory-queue:w2-04-w2-06 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-162647.md |
| gate-20260318-161222 | A | memory-queue:w2-01-w2-03 | go | false | none | docs/planning/gate-runs/2026-03-18_gate-20260318-161222.md |
