# Go/No-Go Decision Run

- run_id: fixture-no-go-001
- stage: B
- target_scope: guild:fixture
- started_at: 2026-03-18T09:00:00.000Z
- ended_at: 2026-03-18T09:05:00.000Z
- operator: fixture
- change_set: fixture-validation

## Reliability Gate

- p95_latency_ms: 2200
- mttr_min: 12
- queue_lag_sec: 180
- error_rate_pct: 9
- threshold_profile: staging
- verdict: fail
- reasons:
- queue lag threshold exceeded

## Quality Gate

- citation_rate: 0.94
- retrieval_hit_at_k: 0.58
- hallucination_review_fail_rate: 0.09
- session_success_rate: 0.72
- threshold_profile: staging
- verdict: fail
- reasons:
- retrieval hit rate below threshold

## Safety Gate

- approval_required_compliance_pct: 100
- unapproved_autodeploy_count: 0
- policy_violation_count: 0
- privacy_block_count: 1
- verdict: pass
- reasons:

## Governance Gate

- roadmap_synced: true
- execution_board_synced: true
- backlog_synced: true
- runbook_synced: true
- changelog_synced: true
- verdict: pass
- reasons:

## Final Decision

- overall: no-go
- required_actions:
- rollback_execute
- incident_record
- comms_broadcast
- rollback_required: true
- rollback_type: queue
- rollback_deadline_min: 10

## Evidence Bundle

- summary: fixture no-go run for validator regression checks
- artifacts:
- verification:
- error:
- retry_hint:
- runtime_cost:

## Post-Decision Checklist

- [x] rollback 실행 완료
- [x] incident template 기록 완료
- [x] comms playbook 공지 완료
- [ ] next checkpoint 예약 완료
- [ ] follow-up owner 지정 완료
