# T-004: Admin Memory Commands (Discord)

## 목표

관리자가 장기기억을 즉시 교정할 수 있도록 최소 명령 체계를 제공한다.

## 명령 세트

1. /기억검색 query:<text> [유형]

- 길드 메모리 검색 + 근거 표시

2. /기억고정 memoryId:<id> [사유]

- memory_feedback(action=pin)
- memory_items.pinned=true

3. /기억수정 memoryId:<id> 내용:<text> [사유]

- memory_feedback(action=edit)
- memory_items.content/summary 업데이트

4. /기억폐기 memoryId:<id> 사유:<text>

- memory_feedback(action=deprecate)
- memory_items.status=deprecated

5. /기억충돌목록 [상태]

- memory_conflicts 조회

6. /기억충돌해결 conflictId:<id> resolution:<text>

- memory_conflicts.status=resolved
- memory_feedback(action=approve or reject)

## 권한 모델

- requireAdmin 필수
- 일반 사용자는 /기억검색(읽기 축약형)만 허용 가능

## 감사 규칙

- 모든 교정 명령은 actor_id, reason, patch를 memory_feedback에 기록
- 교정 후 5분 내 회수 반영

## 실패 처리

- 대상 memoryId 미존재: NOT_FOUND
- guild_id 불일치: FORBIDDEN
- 이미 deprecated 항목 재폐기: NOOP 처리

## Queue-first Memory Job 운영 (W2 고정)

잡 타입 카탈로그:

- short_summary
- topic_synthesis
- durable_extraction
- reindex
- conflict_scan
- onboarding_snapshot

Producer(Enqueue) 경로:

- `POST /api/bot/agent/memory/jobs/run`
- 입력: guildId, jobType, windowStartedAt, windowEndedAt, input
- 동작: 즉시 실행이 아닌 `memory_jobs(status=queued)` 적재

Consumer/Retry/Deadletter 경로:

- consumer: `src/services/memoryJobRunner.ts`
- claim 규칙: `status=queued` + `next_attempt_at<=now`
- retry/backoff: max retries + exponential backoff
- deadletter: `memory_job_deadletters`

운영 조회/복구 API:

- `GET /api/bot/agent/memory/jobs/stats`
- `GET /api/bot/agent/memory/jobs/deadletters`
- `POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue`
- `POST /api/bot/agent/memory/jobs/:jobId/cancel`

표준 deadletter 분류 코드:

- UNSUPPORTED_JOB_TYPE
- OBSIDIAN_SANITIZER_BLOCKED
- CONTENT_POISON_BLOCKED
- QUERY_FAILED
- INSERT_FAILED
- COMPLETE_FAILED
- SUPABASE_ERROR
- RUNTIME_ERROR

대시보드 핵심 지표(Queue-first):

- retryScheduled
- deadlettered
- queueLagP50Sec
- queueLagP95Sec
- oldestQueuedSec
