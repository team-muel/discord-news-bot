# Memory Queue Policy v1

## Scope

- target service: src/services/memoryJobRunner.ts
- queue tables: memory_jobs, memory_job_deadletters
- objective: queue-first 운영에서 재시도/백오프/데드레터 정책을 단일 기준으로 고정

## Task Types

- short_summary
- topic_synthesis
- durable_extract

## Processing Model

- enqueue -> queued
- consumer poll -> running
- success -> completed
- retryable failure -> queued (next_attempt_at with exponential backoff)
- retry limit exceeded -> failed + deadletter record

## Retry and Backoff

- max retries: MEMORY_JOBS_MAX_RETRIES (default 3)
- backoff base: MEMORY_JOBS_BACKOFF_BASE_MS (default 15000)
- backoff max: MEMORY_JOBS_BACKOFF_MAX_MS (default 1800000)
- schedule formula: min(backoff_max, backoff_base \* 2^(attempt-1))

## Deadletter Auto Recovery

- enabled: MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED (default true)
- interval: MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS (default 120000)
- batch size: MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE (default 3)
- max recovery attempts: MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS (default 3)

## SLO and Gates

- queue lag p95: <= 120s
- deadletter pending > 0 for 30m: no-go
- retry scheduled ratio > 40% in 1h: degraded
- deadletter ignored > 0 in release window: no-go

## Operator APIs

- GET /api/bot/agent/memory/jobs/queue-stats
- GET /api/bot/agent/memory/jobs/runner-stats
- GET /api/bot/agent/memory/jobs/deadletters
- POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue

## Validation

- npm run -s trading:isolation:validate
- npm run -s gates:validate
- npm run -s memory:queue:report:dry
