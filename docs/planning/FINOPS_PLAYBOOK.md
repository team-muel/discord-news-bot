# FinOps Playbook

## 목표

- 비용 가시화(단위 원가)
- 예산 가드레일(일/월)
- 자동 완화 모드(Degraded)
- 길드별 Showback 리포트

## API

- `GET /api/bot/agent/finops/summary?guildId=&days=`
- `GET /api/bot/agent/finops/showback?days=`
- `GET /api/bot/agent/finops/budget?guildId=`

## 예산 동작

1. `utilization < degrade_threshold`: `normal`
2. `degrade_threshold <= utilization < hard_block_threshold`: `degraded`
3. `utilization >= hard_block_threshold`: `blocked`

## 운영자 자동 의사결정표 (Who/When/Threshold/Action)

| 담당               | 언제             | 임계치                                                    | 자동 조치                                 | 수동 SOP                              |
| ------------------ | ---------------- | --------------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| L1 On-Call         | 실시간 감시(5분) | `utilization < degrade_threshold`                         | 상태 유지                                 | 주간 비용 상위 액션 점검              |
| L2 Service Owner   | 실시간 감시(5분) | `degrade_threshold <= utilization < hard_block_threshold` | 비허용 액션 skip, 런너 retry/timeout 축소 | 허용 액션/예산/단가 재조정            |
| Incident Commander | 실시간 감시(5분) | `utilization >= hard_block_threshold`                     | 기본 액션 차단, exempt만 허용             | 차단 해제 승인 또는 기능 축소 결정    |
| Incident Commander | 일일 점검        | `blocked` 24시간 초과                                     | No-Go 후보 플래그                         | 워크로드 분리 또는 릴리즈 축소안 확정 |

세부 통합 기준은 `docs/OPERATOR_SOP_DECISION_TABLE.md`를 따른다.

## Degraded 모드 정책

- 허용 액션: `FINOPS_DEGRADE_ALLOWED_ACTIONS`
- 런너 리소스 축소:
  - `ACTION_FINOPS_DEGRADED_RETRY_MAX`
  - `ACTION_FINOPS_DEGRADED_TIMEOUT_MS`

## Blocked 모드 정책

- 기본 차단
- 예외 액션: `FINOPS_HARD_BLOCK_EXEMPT_ACTIONS`

## 비용 산정 방식(현재)

- action log 기반 추정치
- retrieval/job는 이벤트 건당 단가 적용
- 토큰 기반 정확 원가는 향후 provider usage 연동으로 대체 예정

## 운영 루틴 (주간 30분)

1. 상위 비용 액션 Top 10 확인
2. 실패 재시도 비용 증가 구간 확인
3. 품질 저하(citation/recall/SLA)와 절감 조치 충돌 여부 확인
4. 다음 주 단가/예산/허용 액션 조정

## 즉시 실행 루틴 (Incident 중)

1. `GET /api/bot/agent/finops/budget?guildId=`로 모드(`normal|degraded|blocked`)를 확인한다.
2. 모드에 해당하는 자동 조치가 실제로 적용되었는지 `agent_action_logs`로 검증한다.
3. `blocked`면 Incident Commander 승인 없이 해제하지 않는다.
4. 상태 업데이트 cadence는 `docs/ONCALL_COMMS_PLAYBOOK.md`를 따른다.
