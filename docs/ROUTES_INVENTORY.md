# Routes Inventory

- Generated at: 2026-03-14T08:56:17.988Z
- Source: src/app.ts + src/routes/*.ts
- Notes: middleware detection is static and best-effort for requireAuth/requireAdmin/rate limiter usage.

| Method | Path | Auth | Admin | Rate Limit | Source |
| --- | --- | --- | --- | --- | --- |
| GET | / | no | no | no | src/routes/health.ts:72 |
| GET | /api/auth/callback | no | no | yes | src/routes/auth.ts:263 |
| GET | /api/auth/invite | no | no | no | src/routes/auth.ts:252 |
| GET | /api/auth/login | no | no | yes | src/routes/auth.ts:236 |
| POST | /api/auth/logout | yes | no | no | src/routes/auth.ts:229 |
| GET | /api/auth/me | no | no | no | src/routes/auth.ts:202 |
| POST | /api/auth/sdk | no | no | yes | src/routes/auth.ts:216 |
| POST | /api/benchmark/events | yes | no | no | src/routes/benchmark.ts:8 |
| GET | /api/benchmark/summary | yes | no | no | src/routes/benchmark.ts:14 |
| GET | /api/bot/agent/actions/approvals | no | yes | no | src/routes/bot.ts:493 |
| POST | /api/bot/agent/actions/approvals/:requestId/decision | no | yes | yes | src/routes/bot.ts:515 |
| GET | /api/bot/agent/actions/policies | no | yes | no | src/routes/bot.ts:440 |
| PUT | /api/bot/agent/actions/policies | no | yes | yes | src/routes/bot.ts:458 |
| GET | /api/bot/agent/deadletters | no | yes | no | src/routes/bot.ts:301 |
| GET | /api/bot/agent/finops/budget | no | yes | no | src/routes/bot.ts:1187 |
| GET | /api/bot/agent/finops/showback | no | yes | no | src/routes/bot.ts:1167 |
| GET | /api/bot/agent/finops/summary | no | yes | no | src/routes/bot.ts:1151 |
| POST | /api/bot/agent/learning/run | no | yes | yes | src/routes/bot.ts:561 |
| GET | /api/bot/agent/memory/beta/go-no-go | no | yes | no | src/routes/bot.ts:1135 |
| GET | /api/bot/agent/memory/conflicts | no | yes | no | src/routes/bot.ts:765 |
| POST | /api/bot/agent/memory/conflicts/:conflictId/resolve | no | yes | yes | src/routes/bot.ts:789 |
| POST | /api/bot/agent/memory/items | no | yes | yes | src/routes/bot.ts:656 |
| POST | /api/bot/agent/memory/items/:memoryId/feedback | no | yes | yes | src/routes/bot.ts:723 |
| POST | /api/bot/agent/memory/jobs/:jobId/cancel | no | yes | yes | src/routes/bot.ts:927 |
| GET | /api/bot/agent/memory/jobs/deadletters | no | yes | no | src/routes/bot.ts:889 |
| POST | /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue | no | yes | yes | src/routes/bot.ts:905 |
| POST | /api/bot/agent/memory/jobs/run | no | yes | yes | src/routes/bot.ts:829 |
| GET | /api/bot/agent/memory/jobs/stats | no | yes | no | src/routes/bot.ts:867 |
| GET | /api/bot/agent/memory/quality/metrics | no | yes | no | src/routes/bot.ts:949 |
| GET | /api/bot/agent/memory/retrieval-eval/cases | no | yes | no | src/routes/bot.ts:1028 |
| POST | /api/bot/agent/memory/retrieval-eval/cases | no | yes | yes | src/routes/bot.ts:989 |
| POST | /api/bot/agent/memory/retrieval-eval/runs | no | yes | yes | src/routes/bot.ts:1053 |
| GET | /api/bot/agent/memory/retrieval-eval/runs/:runId | no | yes | no | src/routes/bot.ts:1087 |
| POST | /api/bot/agent/memory/retrieval-eval/runs/:runId/tune | no | yes | yes | src/routes/bot.ts:1109 |
| POST | /api/bot/agent/memory/retrieval-eval/sets | no | yes | yes | src/routes/bot.ts:965 |
| GET | /api/bot/agent/memory/search | no | yes | no | src/routes/bot.ts:623 |
| POST | /api/bot/agent/onboarding/run | no | yes | yes | src/routes/bot.ts:543 |
| GET | /api/bot/agent/policy | no | yes | no | src/routes/bot.ts:316 |
| POST | /api/bot/agent/privacy/forget-guild | no | yes | yes | src/routes/bot.ts:369 |
| GET | /api/bot/agent/privacy/forget-preview | yes | no | no | src/routes/bot.ts:402 |
| POST | /api/bot/agent/privacy/forget-user | yes | no | yes | src/routes/bot.ts:320 |
| GET | /api/bot/agent/sessions | no | yes | no | src/routes/bot.ts:286 |
| POST | /api/bot/agent/sessions | no | yes | yes | src/routes/bot.ts:581 |
| GET | /api/bot/agent/sessions/:sessionId | no | yes | no | src/routes/bot.ts:567 |
| POST | /api/bot/agent/sessions/:sessionId/cancel | no | yes | yes | src/routes/bot.ts:609 |
| GET | /api/bot/agent/skills | no | yes | no | src/routes/bot.ts:312 |
| POST | /api/bot/automation/:jobName/run | no | yes | yes | src/routes/bot.ts:231 |
| POST | /api/bot/reconnect | no | yes | yes | src/routes/bot.ts:250 |
| GET | /api/bot/status | yes | no | no | src/routes/bot.ts:88 |
| GET | /api/bot/usage | no | yes | no | src/routes/bot.ts:1202 |
| GET | /api/fred/playground | no | no | no | src/routes/fred.ts:106 |
| GET | /api/quant/panel | no | no | no | src/routes/quant.ts:53 |
| GET | /api/research/preset/:presetKey | no | no | no | src/routes/research.ts:16 |
| POST | /api/research/preset/:presetKey | no | yes | no | src/routes/research.ts:36 |
| GET | /api/research/preset/:presetKey/history | yes | no | no | src/routes/research.ts:25 |
| POST | /api/research/preset/:presetKey/restore/:historyId | no | yes | no | src/routes/research.ts:58 |
| GET | /api/status | no | no | no | src/routes/health.ts:68 |
| GET | /api/trades/ | yes | no | no | src/routes/trades.ts:49 |
| POST | /api/trades/ | no | yes | no | src/routes/trades.ts:66 |
| GET | /api/trading/position | yes | yes | no | src/routes/trading.ts:99 |
| POST | /api/trading/position/close | yes | yes | yes | src/routes/trading.ts:115 |
| GET | /api/trading/runtime | yes | yes | no | src/routes/trading.ts:60 |
| POST | /api/trading/runtime/pause | yes | yes | yes | src/routes/trading.ts:74 |
| POST | /api/trading/runtime/resume | yes | yes | yes | src/routes/trading.ts:83 |
| POST | /api/trading/runtime/run-once | yes | yes | yes | src/routes/trading.ts:66 |
| GET | /api/trading/strategy | yes | yes | no | src/routes/trading.ts:29 |
| PUT | /api/trading/strategy | yes | yes | yes | src/routes/trading.ts:39 |
| POST | /api/trading/strategy/reset | yes | yes | yes | src/routes/trading.ts:50 |
| GET | /health | no | no | no | src/routes/health.ts:25 |
| GET | /ready | no | no | no | src/routes/health.ts:50 |

