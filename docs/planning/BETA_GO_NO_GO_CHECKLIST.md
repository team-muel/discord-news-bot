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
8. `obsidian_cli_headless_split == pass` (역할 경계 위반 0건)
9. `graph_first_no_chunking_policy == pass` (기본 회수 전략이 비청킹/그래프 우선)

If all pass: `decision=go`, otherwise `decision=no-go`.

## Notes

- `recall@k` is currently proxy-based:
  - `returned_count >= k` and `avg_score >= 0.45`
- This should be upgraded with labeled relevance evaluation in pilot stage.
- Gate 8 pass condition example:
  - CLI 전용 작업이 서버 배치 경로에서 호출되지 않음
  - Headless 동기화가 무인 환경에서 독립 실행 가능
- Gate 9 pass condition example:
  - 회수 정책 문서와 런타임 설정이 그래프 신호(태그/백링크/링크) 우선으로 일치
  - 청킹은 기본 전략이 아닌 예외 fallback으로만 사용
