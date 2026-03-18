# Control Plane Policy Table (W3 Freeze)

목표: Week 3 안정화 항목(W3-01~03)의 운영 기준을 코드/환경변수와 1:1로 고정한다.

## W3-01 Read-heavy API Cache TTL

| 정책 항목            | 기준값              | 환경변수                | 적용 경로           |
| -------------------- | ------------------- | ----------------------- | ------------------- |
| Bot status cache TTL | 5000ms (min 1000ms) | BOT_STATUS_CACHE_TTL_MS | GET /api/bot/status |

기준:

- 상태 조회는 짧은 TTL + in-flight dedupe를 사용한다.
- 1초 미만 TTL은 금지한다.
- 60초 초과 TTL은 운영 상태 왜곡 리스크로 비권장한다.

## W3-02 Admin Action Idempotency

| 정책 항목                                | 기준값             | 환경변수                | 적용 범위                                                |
| ---------------------------------------- | ------------------ | ----------------------- | -------------------------------------------------------- |
| Admin mutation idempotency TTL           | 86400s (min 60s)   | API_IDEMPOTENCY_TTL_SEC | /api/bot 및 /api/bot/agent 하위 mutating admin endpoints |
| User-scoped privacy mutation idempotency | scope=bot-opencode | API_IDEMPOTENCY_TTL_SEC | POST /api/bot/agent/privacy/forget-user                  |

기준:

- admin mutating endpoint는 rate-limit + idempotency를 함께 사용한다.
- 동일 idempotency-key 재요청 시 payload hash가 다르면 409로 거부한다.
- 5xx 응답은 in-progress 레코드를 해제해 안전하게 재시도 가능해야 한다.

## W3-03 Rate-limit Key/Window Standard

| 정책 항목               | 기본값       | 환경변수                                                   | keyPrefix        | store    | onStoreError |
| ----------------------- | ------------ | ---------------------------------------------------------- | ---------------- | -------- | ------------ |
| Status read rate-limit  | 60 req / 60s | BOT_STATUS_RATE_MAX, BOT_STATUS_RATE_WINDOW_MS             | bot-status-read  | supabase | allow        |
| Admin action rate-limit | 20 req / 60s | BOT_ADMIN_ACTION_RATE_MAX, BOT_ADMIN_ACTION_RATE_WINDOW_MS | bot-admin-action | supabase | reject       |

기준:

- 키 생성은 userId + ip 조합을 기본으로 사용한다.
- 제어면 admin mutation endpoint는 공통 adminActionRateLimiter를 사용한다.
- supabase rate-limit backend 장애 시 admin action은 fail-close(reject), status read는 fail-open(allow) 원칙을 따른다.

## 검증 명령

- npm run -s lint
- npm run -s test -- src/routes/botAgentRoutes.smoke.test.ts
- npm run -s gates:validate
