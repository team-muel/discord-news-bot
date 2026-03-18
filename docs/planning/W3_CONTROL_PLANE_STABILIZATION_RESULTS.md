# W3 Control Plane Stabilization Results

목표: W3-04(상태 조회 급증 부하 테스트)와 W3-05(stage rollback 리허설)의 실행 증거를 고정한다.

## W3-04 Status API Load Test

실행 환경:

- API base: http://localhost:3001
- endpoint: GET /api/bot/status
- auth: signed session cookie

실행 명령(통제 부하):

- API_BASE=http://localhost:3001 STATUS_LOAD_TOTAL=60 STATUS_LOAD_CONCURRENCY=5 npm run -s load:bot-status

결과:

- totalRequests: 60
- okCount: 60
- failCount: 0
- successRatePct: 100
- throughputRps: 121.7
- latency.p50Ms: 36
- latency.p95Ms: 55
- latency.p99Ms: 71

관찰:

- control-plane 기준 부하에서 p95 지연은 55ms로 안정적이다.
- bot-status-read rate-limit 예산(60 req / 60s) 내에서는 429가 발생하지 않았다.

참고(버스트 스트레스):

- API_BASE=http://localhost:3001 npm run -s load:bot-status (total=200, concurrency=20)
- 결과: 200 중 60개 200, 140개 429(의도된 보호 동작), p95 625ms

## W3-05 Stage Rollback Rehearsal

실행 시나리오:

- admin 세션 생성(allowlist 사용자)
- status before 확인
- POST /api/bot/reconnect (idempotency-key 포함)
- 동일 idempotency-key로 재요청(replay)
- status after 확인

실행 명령:

- API_BASE=http://localhost:3001 node scripts/rehearse-stage-rollback.mjs

결과:

- adminUserId: 723525198732853329
- statusBefore: 200
- reconnectStatus: 409
- reconnectReplayStatus: 409
- replayHeader(Idempotency-Replayed): true
- statusAfter: 200

관찰:

- 재연결이 이미 진행 중인 상태에서 409 반환은 보호 동작으로 일관적이다.
- 동일 idempotency-key replay 요청에 replay 헤더가 설정되어 멱등성 동작이 검증되었다.

## 판정

- W3-04: pass
- W3-05: pass
