# Go/No-Go Gate Template (Progressive Autonomy)

사용 목적:

- Stage 전환 시 reliability/quality/safety/governance 게이트를 동일 기준으로 판정
- 자동화 판정과 운영자 수동 검토를 같은 포맷으로 기록

자동 로그 생성 명령:

- 기본 템플릿 생성:
  - `npm run gates:init-log -- --stage=A --scope=guild:123 --operator=auto`
- no-go + 롤백 자동 채움:
  - `npm run gates:init-log -- --stage=B --scope=guild:123 --operator=auto --decision=no-go --rollbackType=queue --rollbackDeadlineMin=10`

## 1) Run Metadata

- run_id:
- stage: A | B | C
- target_scope: guild:<id> | global
- started_at:
- ended_at:
- operator:
- change_set:

## 2) Reliability Gate

- p95_latency_ms:
- mttr_min:
- queue_lag_sec:
- error_rate_pct:
- threshold_profile:
- verdict: pass | fail
- reasons:

## 3) Quality Gate

- citation_rate:
- retrieval_hit_at_k:
- hallucination_review_fail_rate:
- session_success_rate:
- threshold_profile:
- verdict: pass | fail
- reasons:

## 4) Safety Gate

- approval_required_compliance_pct:
- unapproved_autodeploy_count:
- policy_violation_count:
- privacy_block_count:
- verdict: pass | fail
- reasons:

## 5) Governance Gate

- roadmap_synced: true | false
- execution_board_synced: true | false
- backlog_synced: true | false
- runbook_synced: true | false
- changelog_synced: true | false
- verdict: pass | fail
- reasons:

## 6) Final Decision

- overall: go | no-go
- required_actions:
- rollback_required: true | false
- rollback_type: none | stage | queue | provider
- rollback_deadline_min:

## 7) Evidence Bundle

- summary:
- artifacts:
- verification:
- error:
- retry_hint:
- runtime_cost:

## 8) Post-Decision Checklist

- [ ] incident template 기록 완료
- [ ] comms playbook 공지 완료
- [ ] next checkpoint 예약 완료
- [ ] follow-up owner 지정 완료
