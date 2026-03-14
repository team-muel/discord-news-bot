# Obsidian Search Benchmark

- Started at: 2026-03-14T01:34:16.023Z
- Vault path: C:\Muel_S\discord-news-bot\docs
- Runs per query: 15
- Query count: 6

## Summary

- Mean avg latency: 0.38 ms
- Mean p95 latency: 2.61 ms

## Per Query

| Query | Runs | Limit | Avg (ms) | P95 (ms) | Min (ms) | Max (ms) | Avg Results |
|---|---:|---:|---:|---:|---:|---:|---:|
| tag:ops | 15 | 8 | 0.49 | 7.11 | 0.01 | 7.11 | 0.00 |
| tag:policy | 15 | 8 | 0.01 | 0.02 | 0.00 | 0.02 | 0.00 |
| incident postmortem | 15 | 8 | 0.35 | 0.99 | 0.24 | 0.99 | 5.00 |
| memory retrieval | 15 | 8 | 0.75 | 6.55 | 0.28 | 6.55 | 8.00 |
| trading strategy | 15 | 8 | 0.29 | 0.50 | 0.21 | 0.50 | 8.00 |
| news summary | 15 | 8 | 0.40 | 0.47 | 0.32 | 0.47 | 2.00 |

## Notes

- This benchmark measures end-to-end search latency via adapter router.
- First-run warmup costs are included; increase BENCH_RUNS for stable medians.