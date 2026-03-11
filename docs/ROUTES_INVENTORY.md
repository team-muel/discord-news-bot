# Routes Inventory

- Generated at: 2026-03-11T20:50:30.581Z
- Source: src/app.ts + src/routes/*.ts
- Notes: middleware detection is static and best-effort for requireAuth/requireAdmin/rate limiter usage.

| Method | Path | Auth | Admin | Rate Limit | Source |
| --- | --- | --- | --- | --- | --- |
| GET | / | no | no | no | src/routes/health.ts:59 |
| GET | /api/auth/callback | no | no | yes | src/routes/auth.ts:263 |
| GET | /api/auth/invite | no | no | no | src/routes/auth.ts:252 |
| GET | /api/auth/login | no | no | yes | src/routes/auth.ts:236 |
| POST | /api/auth/logout | yes | no | no | src/routes/auth.ts:229 |
| GET | /api/auth/me | no | no | no | src/routes/auth.ts:202 |
| POST | /api/auth/sdk | no | no | yes | src/routes/auth.ts:216 |
| POST | /api/benchmark/events | yes | no | no | src/routes/benchmark.ts:8 |
| GET | /api/benchmark/summary | yes | no | no | src/routes/benchmark.ts:14 |
| POST | /api/bot/agent/learning/run | no | yes | yes | src/routes/bot.ts:225 |
| GET | /api/bot/agent/memory/conflicts | no | yes | no | src/routes/bot.ts:419 |
| POST | /api/bot/agent/memory/items | no | yes | yes | src/routes/bot.ts:319 |
| POST | /api/bot/agent/memory/items/:memoryId/feedback | no | yes | yes | src/routes/bot.ts:377 |
| POST | /api/bot/agent/memory/jobs/:jobId/cancel | no | yes | yes | src/routes/bot.ts:541 |
| GET | /api/bot/agent/memory/jobs/deadletters | no | yes | no | src/routes/bot.ts:503 |
| POST | /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue | no | yes | yes | src/routes/bot.ts:519 |
| POST | /api/bot/agent/memory/jobs/run | no | yes | yes | src/routes/bot.ts:443 |
| GET | /api/bot/agent/memory/jobs/stats | no | yes | no | src/routes/bot.ts:481 |
| GET | /api/bot/agent/memory/quality/metrics | no | yes | no | src/routes/bot.ts:563 |
| GET | /api/bot/agent/memory/search | no | yes | no | src/routes/bot.ts:286 |
| POST | /api/bot/agent/onboarding/run | no | yes | yes | src/routes/bot.ts:207 |
| GET | /api/bot/agent/policy | no | yes | no | src/routes/bot.ts:203 |
| GET | /api/bot/agent/sessions | no | yes | no | src/routes/bot.ts:184 |
| POST | /api/bot/agent/sessions | no | yes | yes | src/routes/bot.ts:245 |
| GET | /api/bot/agent/sessions/:sessionId | no | yes | no | src/routes/bot.ts:231 |
| POST | /api/bot/agent/sessions/:sessionId/cancel | no | yes | yes | src/routes/bot.ts:272 |
| GET | /api/bot/agent/skills | no | yes | no | src/routes/bot.ts:199 |
| POST | /api/bot/automation/:jobName/run | no | yes | yes | src/routes/bot.ts:129 |
| POST | /api/bot/reconnect | no | yes | yes | src/routes/bot.ts:148 |
| GET | /api/bot/status | yes | no | no | src/routes/bot.ts:58 |
| GET | /api/bot/usage | no | yes | no | src/routes/bot.ts:579 |
| GET | /api/fred/playground | no | no | no | src/routes/fred.ts:106 |
| GET | /api/quant/panel | no | no | no | src/routes/quant.ts:53 |
| GET | /api/research/preset/:presetKey | no | no | no | src/routes/research.ts:16 |
| POST | /api/research/preset/:presetKey | no | yes | no | src/routes/research.ts:36 |
| GET | /api/research/preset/:presetKey/history | yes | no | no | src/routes/research.ts:25 |
| POST | /api/research/preset/:presetKey/restore/:historyId | no | yes | no | src/routes/research.ts:58 |
| GET | /api/status | no | no | no | src/routes/health.ts:55 |
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
| GET | /health | no | no | no | src/routes/health.ts:12 |
| GET | /ready | no | no | no | src/routes/health.ts:37 |

