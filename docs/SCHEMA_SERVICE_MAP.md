# Schema to Service Map

- Source schema: docs/SUPABASE_SCHEMA.sql
- Source scan: src/services/**/*.ts
- Notes: static string matching for .from(...) and .rpc(...) usage.

## Tables

| Table | Services |
| --- | --- |
| agent_action_approval_requests | src/services/privacyForgetService.ts |
| agent_action_logs | src/services/agent/agentWorkerApprovalGateSnapshotService.ts<br/>src/services/finopsService.ts<br/>src/services/opencodeOpsService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/skills/actionExecutionLogService.ts<br/>src/services/sprint/selfImprovementLoop.ts<br/>src/services/taskRoutingAnalyticsService.ts<br/>src/services/taskRoutingMetricsService.ts<br/>src/services/toolLearningService.ts |
| agent_action_policies | - |
| agent_answer_quality_reviews | src/services/agent/agentGotAnalyticsService.ts<br/>src/services/agent/agentQualityReviewService.ts |
| agent_conversation_threads | src/services/privacyForgetService.ts |
| agent_conversation_turns | src/services/privacyForgetService.ts |
| agent_got_cutover_profiles | src/services/agent/agentGotCutoverService.ts<br/>src/services/agent/agentOpsService.ts |
| agent_got_edges | src/services/agent/agentGotStore.ts |
| agent_got_nodes | src/services/agent/agentGotStore.ts |
| agent_got_runs | src/services/agent/agentGotAnalyticsService.ts<br/>src/services/agent/agentGotStore.ts |
| agent_got_selection_events | src/services/agent/agentGotStore.ts |
| agent_llm_call_logs | src/services/agent/agentSloService.ts<br/>src/services/eval/rewardSignalService.ts<br/>src/services/llmExperimentAnalyticsService.ts |
| agent_opencode_change_requests | - |
| agent_opencode_publish_queue | - |
| agent_privacy_gate_samples | src/services/agent/agentPrivacyTuningService.ts |
| agent_privacy_policies | src/services/agent/agentPrivacyPolicyService.ts |
| agent_retention_policies | - |
| agent_runtime_policies | src/services/agent/agentPolicyService.ts |
| agent_semantic_answer_cache | src/services/agent/agentGotAnalyticsService.ts<br/>src/services/semanticAnswerCacheService.ts |
| agent_sessions | src/services/agent/agentSessionStore.ts<br/>src/services/conversationTurnService.ts<br/>src/services/eval/rewardSignalService.ts<br/>src/services/privacyForgetService.ts |
| agent_skill_catalog | src/services/skills/registry.ts |
| agent_slo_alert_events | - |
| agent_slo_policies | - |
| agent_steps | src/services/agent/agentSessionStore.ts |
| agent_telemetry_queue_tasks | - |
| agent_tool_learning_candidates | src/services/agent/agentSloService.ts<br/>src/services/toolLearningService.ts |
| agent_tool_learning_logs | src/services/toolLearningService.ts |
| agent_tool_learning_rules | src/services/agent/agentSloService.ts<br/>src/services/taskRoutingService.ts<br/>src/services/toolLearningService.ts |
| agent_tot_candidate_pairs | src/services/agent/agentGotAnalyticsService.ts<br/>src/services/agent/agentTotPolicyService.ts |
| agent_tot_policies | src/services/agent/agentTotPolicyService.ts<br/>src/services/entityNervousSystem.ts |
| agent_user_privacy_preferences | - |
| agent_weekly_reports | src/services/sprint/selfImprovementLoop.ts |
| agent_workflow_profiles | src/services/agent/agentWorkflowService.ts |
| alert_slots | - |
| api_idempotency_keys | - |
| api_rate_limits | - |
| bot_state | - |
| candles | - |
| community_actor_profiles | src/services/communityGraphService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
| community_interaction_events | src/services/communityGraphService.ts<br/>src/services/eval/rewardSignalService.ts<br/>src/services/privacyForgetService.ts |
| community_relationship_edges | src/services/communityGraphService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
| discord_login_sessions | src/services/discordLoginSessionStore.ts |
| distributed_locks | src/services/infra/distributedLockService.ts |
| error_history | - |
| guild_lore_docs | src/services/agent/agentMemoryService.ts |
| intent_exemplars | src/services/langgraph/nodes/intentExemplarStore.ts |
| logs | - |
| macro_data | - |
| macro_series | - |
| market_regime | - |
| memory_conflicts | src/services/agent/agentMemoryStore.ts<br/>src/services/memory/memoryJobRunner.ts<br/>src/services/memory/memoryQualityMetricsService.ts |
| memory_feedback | src/services/agent/agentMemoryStore.ts<br/>src/services/memory/memoryQualityMetricsService.ts<br/>src/services/privacyForgetService.ts |
| memory_item_links | src/services/memory/memoryConsolidationService.ts<br/>src/services/memory/memoryEvolutionService.ts |
| memory_items | src/services/agent/agentMemoryStore.ts<br/>src/services/memory/memoryConsolidationService.ts<br/>src/services/memory/memoryEmbeddingService.ts<br/>src/services/memory/memoryEvolutionService.ts<br/>src/services/memory/memoryJobRunner.ts<br/>src/services/memory/memoryQualityMetricsService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
| memory_job_deadletters | src/services/memory/memoryJobRunner.ts |
| memory_jobs | src/services/agent/agentMemoryStore.ts<br/>src/services/finopsService.ts<br/>src/services/memory/memoryJobRunner.ts<br/>src/services/memory/memoryQualityMetricsService.ts |
| memory_retrieval_logs | src/services/agent/agentMemoryStore.ts<br/>src/services/eval/rewardSignalService.ts<br/>src/services/finopsService.ts<br/>src/services/memory/memoryQualityMetricsService.ts |
| memory_sources | src/services/agent/agentMemoryService.ts<br/>src/services/agent/agentMemoryStore.ts<br/>src/services/memory/memoryJobRunner.ts<br/>src/services/privacyForgetService.ts |
| news_sentiment | src/services/news/newsSentimentMonitor.ts |
| retrieval_eval_cases | src/services/eval/retrievalEvalService.ts |
| retrieval_eval_results | src/services/agent/agentGotAnalyticsService.ts<br/>src/services/eval/retrievalEvalService.ts |
| retrieval_eval_runs | src/services/agent/agentRuntimeReadinessService.ts<br/>src/services/eval/retrievalEvalService.ts |
| retrieval_eval_sets | src/services/eval/retrievalEvalService.ts |
| retrieval_eval_targets | src/services/eval/retrievalEvalService.ts |
| retrieval_ranker_active_profiles | src/services/entityNervousSystem.ts<br/>src/services/eval/retrievalEvalService.ts |
| retrieval_ranker_experiments | src/services/eval/retrievalEvalService.ts |
| settings | - |
| sources | src/services/agent/agentSloService.ts<br/>src/services/goNoGoService.ts<br/>src/services/news/newsChannelStore.ts<br/>src/services/news/newsSentimentMonitor.ts<br/>src/services/news/sourceMonitorStore.ts<br/>src/services/news/youtubeSubscriptionStore.ts<br/>src/services/news/youtubeSubscriptionsMonitor.ts |
| sprint_journal_entries | src/services/sprint/selfImprovementLoop.ts |
| sprint_pipelines | src/services/sprint/selfImprovementLoop.ts |
| system_error_events | - |
| trades | - |
| trading_engine_configs | - |
| trading_signals | - |
| user_roles | - |
| users | src/services/infra/baseRepository.ts<br/>src/services/news/newsChannelStore.ts |
| worker_approvals | - |

## RPC Functions

| RPC | Services |
| --- | --- |
| acquire_rate_limit | src/services/infra/supabaseRateLimitService.ts |
| ensure_pg_cron_job | src/services/infra/pgCronBootstrapService.ts |
| ensure_platform_maintenance_cron | src/services/infra/supabaseExtensionOpsService.ts |
| evaluate_platform_hypothetical_indexes | src/services/infra/supabaseExtensionOpsService.ts |
| get_platform_cron_jobs | src/services/infra/supabaseExtensionOpsService.ts |
| get_platform_extension_status | src/services/infra/supabaseExtensionOpsService.ts |
| get_platform_hypopg_candidates | src/services/infra/supabaseExtensionOpsService.ts |
| get_platform_pg_statements_top | src/services/infra/supabaseExtensionOpsService.ts |
| search_memory_items_hybrid | src/services/agent/agentMemoryStore.ts |

