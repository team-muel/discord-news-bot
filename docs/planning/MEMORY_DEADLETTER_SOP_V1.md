# Memory Deadletter SOP v1

## Trigger Conditions

- deadletter queue count > 0
- repeated failed jobs in same guild/job_type
- recovery_status=ignored appears during active release window

## Triage Sequence

1. Inspect deadletters: GET /api/bot/agent/memory/jobs/deadletters?limit=50
2. Group by error_code and guild_id
3. Confirm whether error is retryable or policy/data issue
4. Check queue lag and retry pressure: GET /api/bot/agent/memory/jobs/queue-stats

## Error Code Handling Matrix

- SUPABASE_NOT_CONFIGURED: infra/env fix first, no requeue
- MEMORY_JOBS_QUERY_FAILED: transient DB issue, retry after health check
- MEMORY_JOB_DEADLETTER_READ_FAILED: storage read failure, retry once then escalate
- DEADLETTER_NOT_FOUND: stale operator input, close ticket
- DEADLETTER_ALREADY_REQUEUED: idempotent success, verify job status
- UNKNOWN: capture raw payload and escalate to on-call

## Recovery Paths

- Auto recovery: periodic requeue by runner (actor=auto-recovery)
- Manual recovery: POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue
- Ignore path: if recovery attempts exceeded, mark as ignored and create incident evidence

## Escalation

- SEV-2: deadletter pending grows for 30m with queue lag degradation
- SEV-1: deadletter growth + memory retrieval impact on user responses

## Evidence Checklist

- incident template updated: docs/ONCALL_INCIDENT_TEMPLATE.md
- comms cadence posted: docs/ONCALL_COMMS_PLAYBOOK.md
- root cause + mitigation + prevention recorded
- follow-up owner and checkpoint registered

## Validation Commands

- npm run -s memory:queue:report
- npm run -s gates:validate
