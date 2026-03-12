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
