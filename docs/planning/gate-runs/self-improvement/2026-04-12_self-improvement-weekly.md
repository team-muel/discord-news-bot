# Self-Improvement Weekly Proposals

- generated_at: 2026-04-12T03:27:24.687Z
- window_days: 7
- guild_id: *
- provider: *
- action_prefix: *

## Source Snapshots

- go_no_go_weekly: go_no_go_weekly|2026-04-12|days:7|guild:*|provider:*|prefix:*
- llm_latency_weekly: llm_latency_weekly|*|*|*|2026-04-02T03:27:22.502Z|2026-04-02T03:27:22.502Z|2026-04-09T03:27:22.503Z|2026-04-12T03:27:22.503Z
- hybrid_weekly: hybrid_weekly|2026-04-12|days:7|guild:*|provider:*|prefix:*
- rollback_rehearsal_weekly: rollback_rehearsal_weekly|2026-04-12|days:7|guild:*|provider:*|prefix:*
- memory_queue_weekly: memory_queue_weekly|2026-04-12|days:7|guild:*|provider:*|prefix:*

## Labeled Quality Signals (M-07)

- retrieval_eval_runs_availability: ok
- retrieval_eval_runs_samples: 200
- recall_at_k_avg_baseline: 0.0796 (samples=38)
- recall_at_k_avg_graph_lore: n/a (samples=0)
- recall_at_k_avg_intent_prefix: 0.0224 (samples=38)
- recall_at_k_avg_keyword_expansion: 0.009 (samples=38)
- retrieval_best_variant: intent_prefix
- retrieval_best_variant_recall_at_k_avg: 0.0224
- retrieval_active_variant: n/a
- retrieval_active_variant_recall_at_k_avg: n/a
- retrieval_delta_best_vs_baseline: -0.0572
- retrieval_delta_active_vs_baseline: n/a

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

- no_go_root_reliability_quality_dual_fail: 1
- no_go_root_reliability_only_fail: 0
- no_go_root_quality_only_fail: 0
- no_go_root_all_gates_pending: 0
- required_action_completion_rate: 0
- required_actions_total: 4
- checklist_incomplete_runs: 1

## Agent Role KPI Signals

- availability: ok
- samples: 0
- openjarvis: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- opencode: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- nemoclaw: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0
- opendev: total=0, failed=0, fail_rate=n/a, retry_rate=n/a, p95_duration_ms=0

## Failure Patterns and Patch Proposals

### P-01 pattern-go-no-go-failures
- severity: high
- signal: 주간 no-go 1건
- detail: no-go scope: weekly:auto
- patch_proposal: 최근 no-go scope 기준으로 gate threshold/rollback playbook을 보정하고, 실패 scope별 재검증 스모크를 추가한다.
- regression_checks:
  - npm run -s gates:validate
  - npm run -s gates:weekly-report -- --days=7

### P-02 pattern-dual-gate-fail-cluster
- severity: medium
- signal: reliability+quality 동시 실패 1건
- detail: 동시 실패군은 단일 파라미터 조정보다 provider/queue/retrieval 입력 분리가 우선 필요
- patch_proposal: no-go scope를 provider profile, queue pressure, retrieval quality 신호로 분해하는 triage 리포트를 weekly pipeline에 추가한다.
- regression_checks:
  - npm run -s gates:weekly-report:normalized
  - npm run -s gates:weekly-report:self-improvement:dry

### P-03 pattern-required-action-completion-gap
- severity: high
- signal: required action completion rate=0
- detail: no-go 후속 액션의 실제 완료 추정치가 목표(>=0.95) 미달
- patch_proposal: post-decision checklist 자동완료 조건을 강화하고 미완료 항목을 다음 체크포인트 blocking rule로 승격한다.
- regression_checks:
  - npm run -s gates:validate:strict
  - npm run -s gates:weekly-report -- --days=7

### P-04 pattern-provider-profile-quality-fallback
- severity: high
- signal: quality gate fail 12건
- detail: quality gate fail 감지로 quality-optimized profile 회귀가 필요
- patch_proposal: runtime profile을 quality-first로 회귀하고, 회귀 기간 동안 citation/retrieval/hallucination 지표를 재측정해 fail count가 0으로 복귀하는지 검증한다.
- regression_checks:
  - npm run -s gates:auto-judge:weekly:pending
  - npm run -s gates:weekly-report:all:dry

### P-05 pattern-labeled-recall-regression
- severity: medium
- signal: labeled recall@k delta(intent_prefix-baseline)=-0.0572
- detail: 라벨 기반 retrieval 평가에서 intent_prefix 품질이 baseline 대비 하락
- patch_proposal: retrieval ranker active profile을 baseline 우선으로 임시 회귀하고, eval set/variant를 재실행해 recall@k delta가 0 이상으로 복귀하는지 검증한다.
- regression_checks:
  - npm run -s gates:weekly-report:self-improvement:dry
  - npm run -s gates:weekly-report:all:dry

## Regression Verification (vs Previous Week)

- previous_week_data: unavailable (첫 주 또는 이전 주 데이터 없음)
- comparison: skipped

## Execution Gate

- next_step: 승인 가능한 패치 제안을 execution board Next 항목(M-05 self-improvement loop v1)에 연결
- required_validation:
  - npm run -s gates:validate
  - npm run -s gates:weekly-report:all:dry
