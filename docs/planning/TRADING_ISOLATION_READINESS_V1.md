# Trading Isolation Readiness v1

목표: Week 4의 초기 항목(W4-01~W4-03)을 코드/운영 절차/검증 증거로 고정한다.

## W4-01 Read Model / Write Model Boundary

### Read model (조회 전용)

- GET /api/trading/strategy
- GET /api/trading/runtime
- GET /api/trading/position

특성:

- 상태/설정/포지션 조회만 수행
- 외부 상태 변경(side effect) 없음

### Write model (변이 전용)

- PUT /api/trading/strategy
- POST /api/trading/strategy/reset
- POST /api/trading/runtime/run-once
- POST /api/trading/runtime/pause
- POST /api/trading/runtime/resume
- POST /api/trading/position/close

특성:

- 전략/런타임/포지션에 직접 영향
- requireAuth + requireAdmin + tradingControlRateLimiter 적용

경계 규칙:

- read model은 상태 반영/조회만 허용한다.
- write model은 관리자 권한과 제어면 rate-limit 없이는 실행하지 않는다.

## W4-02 Distributed Lock / Kill Switch Procedure

### Distributed lock (필수)

구현 기준:

- 엔진 루프와 run-once는 `trading-engine-main-loop` lock을 획득해야 실행한다.
- lock 획득 실패(`LOCK_HELD`) 시 중복 실행을 차단한다.
- lock 테이블 비가용(`LOCK_TABLE_UNAVAILABLE`) 시 fail-close로 동작한다.

운영 절차:

1. `/api/trading/runtime`에서 `lastLoopError` 확인
2. `Trading lock unavailable:*` 또는 `Another instance*` 패턴 확인
3. 다중 인스턴스 환경에서는 lock 충돌 원인(lease 만료/소유자) 점검

### Kill switch (운영 중단)

즉시 중단 경로:

1. API kill switch: `POST /api/trading/runtime/pause`
2. Config kill switch: `PUT /api/trading/strategy` with `enabled=false`
3. Process kill switch: `START_TRADING_BOT=false` 후 재시작

복구 경로:

1. 원인 제거
2. `POST /api/trading/runtime/resume`
3. 필요 시 `POST /api/trading/runtime/run-once`로 단일 사이클 검증

## W4-03 Rollback Path Check (stage / queue / provider)

### Stage rollback

- 대상: trading runtime isolate 단계
- 경로: 신규 단계 중단 -> 기존 안정 경로로 즉시 복귀
- 실행 예: pause -> strategy.enabled=false -> 상태 확인

### Queue rollback

- 대상: memory queue-first 경로(운영 전반 공통)
- 경로: enqueue 중지 + consumer drain + 동기 fallback 제한 복귀
- 참고: docs/planning/MEMORY_ADMIN_COMMANDS.md

### Provider rollback

- 대상: LLM provider 체인
- 경로: 품질 게이트 미달 시 quality-optimized profile로 강제 회귀
- 참고: docs/planning/runtime-profiles/quality-first.env

판정 규칙:

- 하나라도 실패하면 no-go, 즉시 rollback 기록을 남긴다.
- no-go 포맷은 docs/planning/GO_NO_GO_GATE_TEMPLATE.md를 따른다.

## 검증 명령

- npm run -s trading:isolation:validate
- npm run -s lint
- npm run -s gates:validate
