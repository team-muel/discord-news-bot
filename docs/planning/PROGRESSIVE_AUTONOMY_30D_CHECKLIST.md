# Progressive Autonomy 30-Day Checklist

Status note:

- Historical staged checklist for a prior convergence pass.
- Active priorities now come from `UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`, `EXECUTION_BOARD.md`, and `SPRINT_BACKLOG_MEMORY_AGENT.md`.
- Do not treat the numbered 1~24 sequence below as the current active backlog.

기준 문서:

- docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md
- docs/planning/EXECUTION_BOARD.md
- docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md
- docs/RUNBOOK_MUEL_PLATFORM.md

운영 원칙:

- Stage 전환은 go/no-go 게이트 4종을 모두 통과해야 한다.
- 실패 시 즉시 rollback을 수행하고 incident evidence를 기록한다.

## Convergence Mode (우선순위 잠금)

- 신규 축/신규 기능 파일 추가 금지. 기존 워크플로우 강화만 수행한다.
- 동시 진행 WIP는 최대 3개로 제한한다.
- 모든 항목은 `코드 반영 + 운영 검증 + 증거 기록` 3요건을 충족해야 완료로 본다.
- 1~24 항목은 번호 순서대로 처리하되, 선행 항목 미완료 시 후행 항목 착수 금지.

## 1~24 실행 순서 (고정)

1. W1-01 Core command 인터페이스 문서 작성
2. W1-02 Discord adapter -> core command 매핑 표 작성
3. W1-03 Event envelope v1 계약 승인
4. W1-04 Command envelope v1 계약 승인
5. W1-05 Evidence bundle v1 계약 승인
6. W1-06 신규 경로 envelope 준수율 100% 검증
7. W2-01 memory task type 목록 확정
8. W2-02 enqueue API/producer 경로 확정
9. W2-03 consumer 처리 순서/재시도 정책 확정
10. W2-04 deadletter 분류 코드 표준화
11. W2-05 deadletter 자동 복구 규칙 확정
12. W2-06 queue lag/retry/deadletter 대시보드 노출
13. W3-01 read-heavy API 캐시 TTL 표준안 고정
14. W3-02 admin action idempotency 일관성 점검
15. W3-03 rate-limit 정책 키/윈도우 기준 통일
16. W3-04 상태 조회 급증 부하 테스트 실행
17. W3-05 장애 시 stage rollback 리허설 수행
18. W4-01 trading read model/write model 경계 문서화
19. W4-02 distributed lock, kill switch 운영 절차 확정
20. W4-03 stage/queue/provider rollback 경로 점검
21. W4-04 canary guild 1개 선정 및 기준선 측정
22. W4-05 24h canary 관측 후 go/no-go 판정
23. W4-06 실패 시 10분 내 복귀 리허설 통과
24. D30 통합 증거 묶음(go/no-go + runbook + execution board) 확정

## 오늘 실행 (즉시 처리 3건)

- T-01: W1-01 문서/계약 경계 확정
- T-02: W1-02 adapter 매핑표 확정
- T-03: W1-03 이벤트 envelope 승인 로그/증거 반영

## Week 1 (D1-D7) - Interface and Contract Freeze

### Week 1 목표

- Core Decision Engine 경계 고정
- Event/Command/Evidence 계약 버전 고정

### Week 1 체크리스트

- [x] W1-01 Core command 인터페이스 문서 작성
- [x] W1-02 Discord adapter -> core command 매핑 표 작성
- [x] W1-03 Event envelope v1 계약 승인
- [x] W1-04 Command envelope v1 계약 승인
- [x] W1-05 Evidence bundle v1 계약 승인
- [x] W1-06 신규 경로 envelope 준수율 100% 검증

### Week 1 산출물

- [x] contracts JSON schema 파일
- [x] mapping 문서
- [x] 검증 로그

### Week 1 완료 기준

- 신규 기능 100%가 envelope 계약 사용
- 핵심 경로 1개 이상 adapter/core 분리 경계 적용

## Week 2 (D8-D14) - Queue-first Worker Split v1

### Week 2 목표

- memory 작업 enqueue/consume 분리
- retry/backoff/deadletter 정책 고정

### Week 2 체크리스트

- [x] W2-01 memory task type 목록 확정
- [x] W2-02 enqueue API/producer 경로 확정
- [x] W2-03 consumer 처리 순서/재시도 정책 확정
- [x] W2-04 deadletter 분류 코드 표준화
- [x] W2-05 deadletter 자동 복구 규칙 확정
- [x] W2-06 queue lag/retry/deadletter 대시보드 노출

### Week 2 산출물

- [x] 큐 정책 문서 (`docs/planning/MEMORY_QUEUE_POLICY_V1.md`)
- [x] deadletter 운영 절차 (`docs/planning/MEMORY_DEADLETTER_SOP_V1.md`)
- [x] 관측 지표 리포트 (`npm run memory:queue:report`)

### Week 2 완료 기준

- memory 장주기 작업의 70% 이상 비동기 큐 경유
- deadletter 자동/수동 복구 절차 모두 문서화

## Week 3 (D15-D21) - Control Plane Stabilization

### Week 3 목표

- bot status/control 경로 운영 정책 일원화
- 운영 명령 idempotency/rate-limit 일관화

### Week 3 체크리스트

- [x] W3-01 read-heavy API 캐시 TTL 표준안 고정
- [x] W3-02 admin action idempotency 일관성 점검
- [x] W3-03 rate-limit 정책 키/윈도우 기준 통일
- [x] W3-04 상태 조회 급증 부하 테스트 실행
- [x] W3-05 장애 시 stage rollback 리허설 수행

### Week 3 산출물

- [x] control plane 정책표
- [x] 부하 테스트 결과
- [x] rollback 리허설 기록

### Week 3 완료 기준

- 상태 API 급증 시 p95 지연 목표 충족
- 관리자 액션 중복 실행 회귀 0건

## Week 4 (D22-D30) - Trading Isolation Readiness

### Week 4 목표

- trading read/write 경계 설계 고정
- canary cutover 준비

### Week 4 체크리스트

- [x] W4-01 trading read model/write model 경계 문서화
- [x] W4-02 distributed lock, kill switch 운영 절차 확정
- [x] W4-03 stage/queue/provider rollback 경로 점검
- [x] W4-04 canary guild 1개 선정 및 기준선 측정
- [x] W4-05 24h canary 관측 후 go/no-go 판정
- [x] W4-06 실패 시 10분 내 복귀 리허설 통과

### Week 4 산출물

- [x] trading isolation readiness 문서
- [x] canary 운영 기록
- [x] go/no-go 판정 로그

### Week 4 완료 기준

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
