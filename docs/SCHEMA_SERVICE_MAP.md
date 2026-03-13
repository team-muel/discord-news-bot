# Schema to Service Map

- Generated at: 2026-03-13T17:19:23.982Z
- Source schema: docs/SUPABASE_SCHEMA.sql
- Source scan: src/services/**/*.ts
- Notes: static string matching for .from(...) and .rpc(...) usage.

## Tables

| Table | Services |
| --- | --- |
| agent_action_approval_requests | src/services/privacyForgetService.ts |
| agent_action_logs | src/services/finopsService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/skills/actionExecutionLogService.ts |
| agent_action_policies | - |
| agent_sessions | src/services/agentSessionStore.ts<br/>src/services/privacyForgetService.ts |
| agent_steps | src/services/agentSessionStore.ts |
| alert_slots | - |
| api_rate_limits | - |
| bot_state | - |
| candles | - |
| discord_login_sessions | src/services/discordLoginSessionStore.ts |
| distributed_locks | src/services/distributedLockService.ts |
| error_history | - |
| guild_lore_docs | src/services/agentMemoryService.ts |
| logs | - |
| macro_data | - |
| macro_series | - |
| market_regime | - |
| memory_conflicts | src/services/agentMemoryStore.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/memoryQualityMetricsService.ts |
| memory_feedback | src/services/agentMemoryStore.ts<br/>src/services/memoryQualityMetricsService.ts<br/>src/services/privacyForgetService.ts |
| memory_items | src/services/agentMemoryService.ts<br/>src/services/agentMemoryStore.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/memoryQualityMetricsService.ts<br/>src/services/privacyForgetService.ts |
| memory_job_deadletters | src/services/memoryJobRunner.ts |
| memory_jobs | src/services/agentMemoryStore.ts<br/>src/services/finopsService.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/memoryQualityMetricsService.ts |
| memory_retrieval_logs | src/services/agentMemoryStore.ts<br/>src/services/finopsService.ts<br/>src/services/memoryQualityMetricsService.ts |
| memory_sources | src/services/agentMemoryService.ts<br/>src/services/agentMemoryStore.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/privacyForgetService.ts |
| news_sentiment | src/services/newsSentimentMonitor.ts |
| settings | - |
| sources | src/services/crawlerRuntimeRegistry.ts<br/>src/services/goNoGoService.ts<br/>src/services/newsChannelStore.ts<br/>src/services/newsSentimentMonitor.ts<br/>src/services/sourceMonitorStore.ts<br/>src/services/youtubeSubscriptionStore.ts<br/>src/services/youtubeSubscriptionsMonitor.ts |
| system_error_events | - |
| trades | - |
| trading_engine_configs | - |
| trading_signals | - |
| user_roles | - |
| users | src/services/newsChannelStore.ts |

## RPC Functions

| RPC | Services |
| --- | --- |
| acquire_rate_limit | src/services/supabaseRateLimitService.ts |

