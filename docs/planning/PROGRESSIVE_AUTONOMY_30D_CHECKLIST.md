# Progressive Autonomy 30-Day Checklist

기준 문서:

- docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md
- docs/planning/EXECUTION_BOARD.md
- docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md
- docs/RUNBOOK_MUEL_PLATFORM.md

운영 원칙:

- Stage 전환은 go/no-go 게이트 4종을 모두 통과해야 한다.
- 실패 시 즉시 rollback을 수행하고 incident evidence를 기록한다.

## Week 1 (D1-D7) - Interface and Contract Freeze

### 목표

- Core Decision Engine 경계 고정
- Event/Command/Evidence 계약 버전 고정

### 체크리스트

- [ ] W1-01 Core command 인터페이스 문서 작성
- [ ] W1-02 Discord adapter -> core command 매핑 표 작성
- [ ] W1-03 Event envelope v1 계약 승인
- [ ] W1-04 Command envelope v1 계약 승인
- [ ] W1-05 Evidence bundle v1 계약 승인
- [ ] W1-06 신규 경로 envelope 준수율 100% 검증

### 산출물

- [ ] contracts JSON schema 파일
- [ ] mapping 문서
- [ ] 검증 로그

### 완료 기준

- 신규 기능 100%가 envelope 계약 사용
- 핵심 경로 1개 이상 adapter/core 분리 경계 적용

## Week 2 (D8-D14) - Queue-first Worker Split v1

### 목표

- memory 작업 enqueue/consume 분리
- retry/backoff/deadletter 정책 고정

### 체크리스트

- [ ] W2-01 memory task type 목록 확정
- [ ] W2-02 enqueue API/producer 경로 확정
- [ ] W2-03 consumer 처리 순서/재시도 정책 확정
- [ ] W2-04 deadletter 분류 코드 표준화
- [ ] W2-05 deadletter 자동 복구 규칙 확정
- [ ] W2-06 queue lag/retry/deadletter 대시보드 노출

### 산출물

- [ ] 큐 정책 문서
- [ ] deadletter 운영 절차
- [ ] 관측 지표 리포트

### 완료 기준

- memory 장주기 작업의 70% 이상 비동기 큐 경유
- deadletter 자동/수동 복구 절차 모두 문서화

## Week 3 (D15-D21) - Control Plane Stabilization

### 목표

- bot status/control 경로 운영 정책 일원화
- 운영 명령 idempotency/rate-limit 일관화

### 체크리스트

- [ ] W3-01 read-heavy API 캐시 TTL 표준안 고정
- [ ] W3-02 admin action idempotency 일관성 점검
- [ ] W3-03 rate-limit 정책 키/윈도우 기준 통일
- [ ] W3-04 상태 조회 급증 부하 테스트 실행
- [ ] W3-05 장애 시 stage rollback 리허설 수행

### 산출물

- [ ] control plane 정책표
- [ ] 부하 테스트 결과
- [ ] rollback 리허설 기록

### 완료 기준

- 상태 API 급증 시 p95 지연 목표 충족
- 관리자 액션 중복 실행 회귀 0건

## Week 4 (D22-D30) - Trading Isolation Readiness

### 목표

- trading read/write 경계 설계 고정
- canary cutover 준비

### 체크리스트

- [ ] W4-01 trading read model/write model 경계 문서화
- [ ] W4-02 distributed lock, kill switch 운영 절차 확정
- [ ] W4-03 stage/queue/provider rollback 경로 점검
- [ ] W4-04 canary guild 1개 선정 및 기준선 측정
- [ ] W4-05 24h canary 관측 후 go/no-go 판정
- [ ] W4-06 실패 시 10분 내 복귀 리허설 통과

### 산출물

- [ ] trading isolation readiness 문서
- [ ] canary 운영 기록
- [ ] go/no-go 판정 로그

### 완료 기준

- trading 독립 전환 계약/절차 용어 일치
- canary 실패 시 10분 내 복귀 가능

## Daily Operator Log (Template)

날짜:

- Stage:
- 오늘 목표:
- 수행 항목:
- Gate 상태(reliability/quality/safety/governance):
- 리스크/이슈:
- 조치/롤백 여부:
- 증거 링크:
- 다음 작업:
