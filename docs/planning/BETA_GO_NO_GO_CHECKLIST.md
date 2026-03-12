# Beta Go/No-Go Checklist

## Decision API

- Endpoint: `GET /api/bot/agent/memory/beta/go-no-go`
- Auth: admin
- Query:
  - `guildId` (optional)
  - `days` (optional, default 30)

## Core Gates

1. `citation_rate >= 0.95`
2. `recall@5(proxy) >= 0.60`
3. `unresolved_conflict_rate <= 0.05`
4. `job_failure_rate <= 0.10`
5. `correction_sla_p95_minutes <= 5`
6. `pilot guilds >= 3`
7. `deadletter queue == 0`

If all pass: `decision=go`, otherwise `decision=no-go`.

## Notes

- `recall@k` is currently proxy-based:
  - `returned_count >= k` and `avg_score >= 0.45`
- This should be upgraded with labeled relevance evaluation in pilot stage.
