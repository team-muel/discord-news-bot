# Self-Improvement Weekly Proposals

- generated_at: 2026-04-11T09:57:16.577Z
- window_days: 7
- guild_id: *
- provider: *
- action_prefix: *

## Source Snapshots

- go_no_go_weekly: go_no_go_weekly|2026-04-11|days:7|guild:*|provider:*|prefix:*
- llm_latency_weekly: llm_latency_weekly|*|*|*|2026-04-01T09:57:14.457Z|2026-04-01T09:57:14.457Z|2026-04-08T09:57:14.458Z|2026-04-11T09:57:14.458Z
- hybrid_weekly: hybrid_weekly|2026-04-11|days:7|guild:*|provider:*|prefix:*
- rollback_rehearsal_weekly: rollback_rehearsal_weekly|2026-04-11|days:7|guild:*|provider:*|prefix:*
- memory_queue_weekly: memory_queue_weekly|2026-04-11|days:7|guild:*|provider:*|prefix:*

## Labeled Quality Signals (M-07)

- retrieval_eval_runs_availability: ok
- retrieval_eval_runs_samples: 200
- recall_at_k_avg_baseline: 0.0776
- recall_at_k_avg_tot: n/a
- recall_at_k_avg_got: n/a
- recall_at_k_delta_got_vs_baseline: n/a

- answer_quality_reviews_availability: ok
- answer_quality_reviews_samples: 0
- hallucination_fail_rate_pct_baseline: n/a
- hallucination_fail_rate_pct_tot: n/a
- hallucination_fail_rate_pct_got: n/a
- hallucination_delta_pct_got_vs_baseline: n/a

## Opencode Pilot Signals (M-05)

- action_logs_availability: ok
- approvals_availability: ok
- opencode_executions_total: 0
- opencode_executions_success: 0
- opencode_executions_failed: 0
- opencode_approval_required_rate: n/a
- opencode_approvals_pending: 0
- opencode_approvals_approved: 0
- opencode_approvals_rejected: 0
- opencode_approvals_expired: 0

## No-Go Root Cause and Action Completion

- no_go_root_reliability_quality_dual_fail: 0
- no_go_root_reliability_only_fail: 0
- no_go_root_quality_only_fail: 0
- no_go_root_all_gates_pending: 0
- required_action_completion_rate: 0
- required_actions_total: 0
- checklist_incomplete_runs: 0

## Agent Role KPI Signals

- availability: ok
- samples: 0
- openjarvis: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- opencode: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- nemoclaw: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- opendev: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0

## Failure Patterns and Patch Proposals

### P-01 pattern-required-action-completion-gap
- severity: high
- signal: required action completion rate=0
- detail: no-go 후속 액션의 실제 완료 추정치가 목표(>=0.95) 미달
- patch_proposal: post-decision checklist 자동완료 조건을 강화하고 미완료 항목을 다음 체크포인트 blocking rule로 승격한다.
- regression_checks:
  - npm run -s gates:validate:strict
  - npm run -s gates:weekly-report -- --days=7

## Regression Verification (vs Previous Week)

- previous_week_data: unavailable (첫 주 또는 이전 주 데이터 없음)
- comparison: skipped

## Execution Gate

- next_step: 승인 가능한 패치 제안을 execution board Next 항목(M-05 self-improvement loop v1)에 연결
- required_validation:
  - npm run -s gates:validate
  - npm run -s gates:weekly-report:all:dry
