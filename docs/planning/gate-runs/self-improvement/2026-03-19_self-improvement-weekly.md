# Self-Improvement Weekly Proposals

- generated_at: 2026-03-19T11:17:14.290Z
- window_days: 7
- guild_id: *
- provider: *
- action_prefix: *

## Source Snapshots

- go_no_go_weekly: go_no_go_weekly|2026-03-19|days:7|guild:*|provider:*|prefix:*
- llm_latency_weekly: llm_latency_weekly|*|*|*|2026-03-09T11:17:12.306Z|2026-03-09T11:17:12.307Z|2026-03-16T11:17:12.307Z|2026-03-19T11:17:12.307Z
- hybrid_weekly: hybrid_weekly|2026-03-19|days:7|guild:*|provider:*|prefix:*
- rollback_rehearsal_weekly: rollback_rehearsal_weekly|2026-03-19|days:7|guild:*|provider:*|prefix:*
- memory_queue_weekly: memory_queue_weekly|2026-03-19|days:7|guild:*|provider:*|prefix:*

## Failure Patterns and Patch Proposals

### P-01 pattern-go-no-go-failures
- severity: high
- signal: 주간 no-go 5건
- detail: no-go scope: weekly:auto, weekly:auto, guild:demo, guild:demo, trading-isolation:w4-04-w4-06
- patch_proposal: 최근 no-go scope 기준으로 gate threshold/rollback playbook을 보정하고, 실패 scope별 재검증 스모크를 추가한다.
- regression_checks:
  - npm run -s gates:validate
  - npm run -s gates:weekly-report -- --days=7

### P-02 pattern-llm-latency-regression
- severity: high
- signal: p95 latency delta +6739ms
- detail: candidate window latency가 baseline 대비 악화
- patch_proposal: latency 상위 action을 우선 대상으로 provider fallback/timeout/budget profile을 조정한다.
- regression_checks:
  - npm run -s perf:llm-latency
  - npm run -s perf:llm-latency:weekly:dry

## Execution Gate

- next_step: 승인 가능한 패치 제안을 execution board Next 항목(M-05 self-improvement loop v1)에 연결
- required_validation:
  - npm run -s gates:validate
  - npm run -s gates:weekly-report:all:dry
