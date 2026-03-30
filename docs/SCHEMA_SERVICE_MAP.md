# Schema to Service Map

- Source schema: docs/SUPABASE_SCHEMA.sql
- Source scan: src/services/**/*.ts
- Notes: static string matching for .from(...) and .rpc(...) usage.

## Tables

| Table | Services |
| --- | --- |
| agent_action_approval_requests | src/services/privacyForgetService.ts |
| agent_action_logs | src/services/agentWorkerApprovalGateSnapshotService.ts<br/>src/services/finopsService.ts<br/>src/services/opencodeOpsService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/skills/actionExecutionLogService.ts<br/>src/services/taskRoutingAnalyticsService.ts<br/>src/services/taskRoutingMetricsService.ts<br/>src/services/toolLearningService.ts |
| agent_action_policies | - |
| agent_answer_quality_reviews | src/services/agentGotAnalyticsService.ts<br/>src/services/agentQualityReviewService.ts |
| agent_conversation_threads | src/services/privacyForgetService.ts |
| agent_conversation_turns | src/services/privacyForgetService.ts |
| agent_got_cutover_profiles | src/services/agentGotCutoverService.ts<br/>src/services/agentOpsService.ts |
| agent_got_edges | src/services/agentGotStore.ts |
| agent_got_nodes | src/services/agentGotStore.ts |
| agent_got_runs | src/services/agentGotAnalyticsService.ts<br/>src/services/agentGotStore.ts |
| agent_got_selection_events | src/services/agentGotStore.ts |
| agent_llm_call_logs | src/services/agentSloService.ts<br/>src/services/llmExperimentAnalyticsService.ts<br/>src/services/rewardSignalService.ts |
| agent_opencode_change_requests | - |
| agent_opencode_publish_queue | - |
| agent_privacy_gate_samples | src/services/agentPrivacyTuningService.ts |
| agent_privacy_policies | src/services/agentPrivacyPolicyService.ts |
| agent_retention_policies | - |
| agent_runtime_policies | src/services/agentPolicyService.ts |
| agent_semantic_answer_cache | src/services/agentGotAnalyticsService.ts<br/>src/services/semanticAnswerCacheService.ts |
| agent_sessions | src/services/agentSessionStore.ts<br/>src/services/conversationTurnService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/rewardSignalService.ts |
| agent_skill_catalog | src/services/skills/registry.ts |
| agent_slo_alert_events | - |
| agent_slo_policies | - |
| agent_steps | src/services/agentSessionStore.ts |
| agent_telemetry_queue_tasks | - |
| agent_tool_learning_candidates | src/services/agentSloService.ts<br/>src/services/toolLearningService.ts |
| agent_tool_learning_logs | src/services/toolLearningService.ts |
| agent_tool_learning_rules | src/services/agentSloService.ts<br/>src/services/taskRoutingService.ts<br/>src/services/toolLearningService.ts |
| agent_tot_candidate_pairs | src/services/agentGotAnalyticsService.ts<br/>src/services/agentTotPolicyService.ts |
| agent_tot_policies | src/services/agentTotPolicyService.ts<br/>src/services/entityNervousSystem.ts |
| agent_user_privacy_preferences | - |
| agent_weekly_reports | - |
| agent_workflow_profiles | src/services/agentWorkflowService.ts |
| alert_slots | - |
| api_idempotency_keys | - |
| api_rate_limits | - |
| bot_state | - |
| candles | - |
| community_actor_profiles | src/services/communityGraphService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
| community_interaction_events | src/services/communityGraphService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/rewardSignalService.ts |
| community_relationship_edges | src/services/communityGraphService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
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
| memory_items | src/services/agentMemoryService.ts<br/>src/services/agentMemoryStore.ts<br/>src/services/memoryEmbeddingService.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/memoryQualityMetricsService.ts<br/>src/services/privacyForgetService.ts<br/>src/services/userPersonaService.ts |
| memory_job_deadletters | src/services/memoryJobRunner.ts |
| memory_jobs | src/services/agentMemoryStore.ts<br/>src/services/finopsService.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/memoryQualityMetricsService.ts |
| memory_retrieval_logs | src/services/agentMemoryStore.ts<br/>src/services/finopsService.ts<br/>src/services/memoryQualityMetricsService.ts<br/>src/services/rewardSignalService.ts |
| memory_sources | src/services/agentMemoryService.ts<br/>src/services/agentMemoryStore.ts<br/>src/services/memoryJobRunner.ts<br/>src/services/privacyForgetService.ts |
| news_sentiment | src/services/newsSentimentMonitor.ts |
| retrieval_eval_cases | src/services/retrievalEvalService.ts |
| retrieval_eval_results | src/services/agentGotAnalyticsService.ts<br/>src/services/retrievalEvalService.ts |
| retrieval_eval_runs | src/services/agentRuntimeReadinessService.ts<br/>src/services/retrievalEvalService.ts |
| retrieval_eval_sets | src/services/retrievalEvalService.ts |
| retrieval_eval_targets | src/services/retrievalEvalService.ts |
| retrieval_ranker_active_profiles | src/services/entityNervousSystem.ts<br/>src/services/retrievalEvalService.ts |
| retrieval_ranker_experiments | src/services/retrievalEvalService.ts |
| settings | - |
| sources | src/services/agentSloService.ts<br/>src/services/goNoGoService.ts<br/>src/services/newsChannelStore.ts<br/>src/services/newsSentimentMonitor.ts<br/>src/services/sourceMonitorStore.ts<br/>src/services/youtubeSubscriptionStore.ts<br/>src/services/youtubeSubscriptionsMonitor.ts |
| sprint_journal_entries | - |
| sprint_pipelines | - |
| system_error_events | - |
| trades | - |
| trading_engine_configs | - |
| trading_signals | - |
| user_roles | - |
| users | src/services/baseRepository.ts<br/>src/services/newsChannelStore.ts |
| worker_approvals | - |

## RPC Functions

| RPC | Services |
| --- | --- |
| acquire_rate_limit | src/services/supabaseRateLimitService.ts |
| ensure_platform_maintenance_cron | src/services/supabaseExtensionOpsService.ts |
| evaluate_platform_hypothetical_indexes | src/services/supabaseExtensionOpsService.ts |
| get_platform_cron_jobs | src/services/supabaseExtensionOpsService.ts |
| get_platform_extension_status | src/services/supabaseExtensionOpsService.ts |
| get_platform_hypopg_candidates | src/services/supabaseExtensionOpsService.ts |
| get_platform_pg_statements_top | src/services/supabaseExtensionOpsService.ts |
| search_memory_items_hybrid | src/services/agentMemoryService.ts<br/>src/services/agentMemoryStore.ts |

