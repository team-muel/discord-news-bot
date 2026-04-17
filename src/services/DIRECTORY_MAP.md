# Services Directory Structure

## Import Patterns

Every subdirectory has a **barrel `index.ts`** for clean imports:

```ts
// Option 1 — Named import from domain barrel
import { validateAgentSessionRequest, AgentPolicySnapshot } from '../services/agent';

// Option 2 — Namespace import via master barrel
import { agent, runtime, memory } from '../services';
agent.validateAgentSessionRequest(...)

// Option 3 — Direct file import (existing code, still works)
import { startAgentSession } from '../services/multiAgentService';
```

Root-level files (e.g. `multiAgentService.ts`) are imported directly.
See `index.ts` for the full domain map of root-level files.

## Domain Groupings

The `src/services/` directory organizes 100+ service files into domain subdirectories.
Each subdirectory has a barrel `index.ts` for clean imports.

### Agent Runtime & Reasoning (`agent/`)
All agent-related services live in the `agent/` subdirectory.
Core multi-agent session lifecycle, policy, telemetry, governance, reasoning, and quality review.
- `agent/agentRuntimeTypes.ts` — Shared agent role/priority/intent types
- `agent/agentIntentClassifier.ts` — Intent classification and casual chat generation
- `agent/agentPolicyService.ts` — Session validation and policy enforcement
- `agent/agentPrivacyPolicyService.ts` — Privacy deliberation mode and risk scoring
- `agent/agentPrivacyTuningService.ts` — Privacy gate sample recording
- `agent/agentMemoryService.ts` — Memory hint hydration for sessions
- `agent/agentMemoryStore.ts` — Persistent memory CRUD
- `agent/agentSessionStore.ts` — Session persistence to Supabase
- `agent/agentWorkflowService.ts` — Step template profiles
- `agent/agentOpsService.ts` — Ops-triggered agent invocations
- `agent/agentRoleWorkerService.ts` — HTTP role worker health probing
- `agent/agentRuntimeReadinessService.ts` — Runtime readiness checks
- `agent/agentTelemetryQueue.ts` — Async telemetry task queue
- `agent/agentSloService.ts` — SLO metrics tracking
- `agent/agentConsentService.ts` — User consent management
- `agent/agentRetentionPolicyService.ts` — Data retention policies
- `agent/agentGotPolicyService.ts` — GoT budget and policy
- `agent/agentGotCutoverService.ts` — GoT/ToT cutover decisions
- `agent/agentGotStore.ts` — GoT shadow run persistence
- `agent/agentGotAnalyticsService.ts` — GoT analytics
- `agent/agentTotPolicyService.ts` — ToT policy and auto-tuning
- `agent/agentQualityReviewService.ts` — Quality review metrics
- `agent/agentOutcomeContract.ts` — Outcome contract types
- `agent/agentSocialQualitySnapshotService.ts` — Social quality snapshot
- `agent/agentWorkerApprovalGateSnapshotService.ts` — Worker approval gate snapshot
- `multiAgentConfig.ts` — Multi-agent facade-safe host constants extracted from the runtime hub
- `multiAgentService.ts` — Session orchestration hub (start/cancel/execute sessions)
- `multiAgentSnapshot.ts` — Runtime snapshot builder and recent outcome cache helpers
- `multiAgentReasoningStrategies.ts` — ToT/self-refine/least-to-most/beam eval strategies (extracted)
- `multiAgentTypes.ts` — Shared type definitions (AgentSession, AgentStep, etc.)
- `multiAgentRuntimeQueue.ts` — Queue and concurrency management

### Skills & Actions (`skills/`)
Composable skill registry, execution engine, and action implementations.
- `skills/engine.ts` — Skill execution coordinator
- `skills/registry.ts` — Skill registration and lookup
- `skills/actionRunner.ts` — Action governance wrapper
- `skills/actionRunnerArtifacts.ts` — Artifact display, workflow ref extraction, and news artifact parsing helpers
- `skills/actionRunnerConfig.ts` — Action-runner env/config extraction and policy allowlists
- `skills/actionRunnerExecution.ts` — Shared action invoke/retry/cache/circuit primitives for runner and pipeline execution
- `skills/actionRunnerGovernance.ts` — Guild policy, approval-required, and high-risk action gate helper
- `skills/actionRunnerNewsCapture.ts` — External news capture policy gate, dedupe, and memory persistence helper
- `skills/actionRunnerPipelinePersistence.ts` — Goal-pipeline session start, state transitions, step persistence, and closeout lifecycle helper
- `skills/actionRunnerState.ts` — Action-runner caches, gate verdict store, and utility score state
- `skills/actionRunnerWorkflowCloseout.ts` — Pipeline closeout distillate and capability-demand builder
- `skills/actions/` — Individual action implementations (web, rag, news, code, etc.)

### Observer Layer (`observer/`)
Autonomous environment scanning for the agent evolution pipeline (Phase F).
- `observer/observerTypes.ts` — Observation, Channel, Severity, Stats types
- `observer/observerOrchestrator.ts` — Periodic scan coordinator + signal emission
- `observer/observationStore.ts` — Supabase persistence with in-memory fallback
- `observer/errorPatternChannel.ts` — Runtime error clustering from sprintTriggers
- `observer/memoryGapChannel.ts` — Stale/low-confidence memory detection
- `observer/perfDriftChannel.ts` — LLM latency/cost regression from weekly reports
- `observer/codeHealthChannel.ts` — TypeScript type-check error tracking
- `observer/convergenceDigestChannel.ts` — Wraps existing convergence reports
- `observer/discordPulseChannel.ts` — Guild activity volume monitoring

### Sprint Pipeline (`sprint/`)
Autonomous plan→implement→review→qa→ship cycle.
- `sprint/sprintOrchestrator.ts` — Phase state machine
- `sprint/sprintCodeWriter.ts` — LLM-driven source code modification (self-modification)
- `sprint/fastPathExecutors.ts` — Deterministic (zero-LLM) phase executors
- `sprint/autonomousGit.ts` — Branch/commit/PR automation
- `sprint/scopeGuard.ts` — File/command scope restriction
- `sprint/crossModelVoice.ts` — Cross-model review
- `sprint/autoplan.ts` — Multi-lens plan review
- `sprint/llmJudge.ts` — LLM-as-judge evaluation

### Trading (`trading/`)
Stock analysis and investment research.
- `trading/stockService.ts` — Stock quote and chart data
- `trading/investmentAnalysisService.ts` — LLM investment analysis

### News & Monitoring (`news/`)
RSS/Google Finance news ingestion and YouTube monitoring.
- `news/newsCaptureDedupService.ts` — Semantic deduplication
- `news/newsChannelStore.ts` — Channel subscription CRUD
- `news/newsMonitorWorkerClient.ts` — Worker client
- `news/newsSentimentMonitor.ts` — Sentiment scoring
- `news/youtubeSubscriptionsMonitor.ts` — YouTube subscription tracking
- `news/youtubeCommunityScraper.ts` — Community tab scraping
- `news/sourceMonitorStore.ts` — Source monitor persistence
- `news/youtubeMonitorWorkerClient.ts` — YouTube worker client
- `news/youtubeSubscriptionStore.ts` — YouTube subscription CRUD

### Memory (`memory/`)
Memory lifecycle: embedding, evolution, consolidation, quality.
- `memory/memoryEmbeddingService.ts` — Vector embedding generation
- `memory/memoryEvolutionService.ts` — A-MEM inspired inter-memory linking
- `memory/memoryConsolidationService.ts` — H-MEM inspired batch consolidation
- `memory/memoryJobRunner.ts` — Async job queue runner
- `memory/memoryPoisonGuard.ts` — Poison risk assessment
- `memory/memoryQualityMetricsService.ts` — Quality metrics

### Eval & Reward (`eval/`)
A/B evaluation, retrieval eval, reward signal loop.
- `eval/evalAutoPromoteService.ts` — A/B run creation and execution
- `eval/evalAutoPromoteLoopService.ts` — Periodic eval promotion loop
- `eval/retrievalEvalService.ts` — Retrieval eval cases and tuning
- `eval/retrievalEvalLoopService.ts` — Retrieval eval loop
- `eval/rewardSignalService.ts` — Reward snapshot computation
- `eval/rewardSignalLoopService.ts` — Reward signal loop

### Obsidian RAG (`obsidian/`)
Knowledge retrieval via Obsidian vault graph.
- `obsidian/obsidianRagService.ts` — RAG query orchestration (2-hop traversal, reactive learning, gap detection)
- `obsidian/obsidianCacheService.ts` — Cache layer
- `obsidian/obsidianBootstrapService.ts` — Guild vault bootstrap
- `obsidian/obsidianLoreSyncService.ts` — Bidirectional sync
- `obsidian/obsidianQualityService.ts` — Content quality metrics
- `obsidian/obsidianSanitizationWorker.ts` — Write sanitization
- `obsidian/router.ts` — Adapter routing
- `obsidian/authoring.ts` — Document authoring
- `obsidian/types.ts` — Shared types
- `obsidian/adapters/` — Vault adapter implementations

### LangGraph (`langgraph/`)
State graph execution for agent sessions.
- `langgraph/stateContract.ts` — State shape and trace utilities
- `langgraph/executor.ts` — Graph execution engine
- `langgraph/nodes/` — Individual node implementations
- `langgraph/sessionRuntime/` — Branch execution strategies, session-prelude wrappers, and full-review/HITL deliberation helpers
- `langgraph/runtimeSupport/` — Budget, routing, bootstrap, session-state/checkpoint/retry-resume mutation, formatting, evaluation, and terminal fallback/finalization helpers

### External Tools (`tools/`)
External CLI tool integration and execution.
- `tools/externalToolProbe.ts` — System CLI availability probing
- `tools/externalAdapterRegistry.ts` — Adapter registration
- `tools/toolRouter.ts` — Tool routing
- `tools/toolExecutor.ts` — Sandboxed execution
- `tools/adapters/ollamaAdapter.ts` — Ollama model management adapter
- `tools/adapters/litellmAdminAdapter.ts` — LiteLLM proxy admin adapter
- `tools/adapters/mcpIndexingAdapter.ts` — MCP indexing tool adapter

### Infrastructure (`infra/` + root)
Database, auth, observability, and cross-cutting concerns.
- `supabaseClient.ts` — Supabase client singleton (root — high fan-in)
- `llmClient.ts` — Provider-agnostic LLM client (root — high fan-in)
- `infra/baseRepository.ts` — Repository pattern base (error handling, normalization)
- `infra/promptCompiler.ts` — Prompt compilation
- `infra/distributedLockService.ts` — Distributed lease locking
- `infra/supabaseRateLimitService.ts` — Supabase-backed rate limiting
- `infra/supabaseExtensionOpsService.ts` — PG extension and cron management
- `infra/pgCronBootstrapService.ts` — pg_cron job registration and migration SQL
- `authService.ts` — OAuth flow
- `observability/` — Telemetry and monitoring
- `runtime-alerts/` — Alert rules and routing

### OpenCode (`opencode/`)
GitHub queue, ops execution, and publish worker for code generation pipeline.
- `opencode/codeIndexService.ts` — Code index and symbol search
- `opencode/opencodeGitHubQueueService.ts` — Change request and publish queue CRUD
- `opencode/opencodeOpsService.ts` — Execution summary and ops
- `opencode/opencodePublishWorker.ts` — Publish job worker loop

### Runtime Lifecycle (`runtime/`)
Bootstrap, scheduling, alerting, signal bus, and platform optimization.
- `runtime/runtimeBootstrap.ts` — Server/Discord-ready lifecycle coordination
- `runtime/runtimeProvider.ts` — Runtime dependency injection provider
- `runtime/runtimeSchedulerPolicyService.ts` — Scheduler policy snapshot
- `runtime/runtimeAlertService.ts` — Periodic alert scan loop
- `runtime/signalBus.ts` — In-process typed event hub
- `runtime/signalBusWiring.ts` — Signal bus consumer wiring
- `runtime/botAutoRecoveryService.ts` — Bot offline auto-recovery
- `runtime/efficiencyOptimizationService.ts` — Efficiency mode and quick wins
- `runtime/platformLightweightingService.ts` — Platform lightweighting report

### Discord Support (`discord-support/`)
Discord-specific data services (telemetry, rewards, topology, login sessions, CRM).
- `discord-support/discordChannelTelemetryService.ts` — Channel message signal recording
- `discord-support/discordReactionRewardService.ts` — Reaction reward signal recording
- `discord-support/discordTopologySyncService.ts` — Guild topology sync to Obsidian
- `discord-support/discordLoginSessionStore.ts` — Login session persistence
- `discord-support/userCrmService.ts` — User CRM: global profiles, guild memberships, activity tracking (write-behind buffer)

### Intent Formation (`intent/`)
Observation → intent conversion engine (Phase G of Autonomous Evolution).
- `intent/intentTypes.ts` — Intent domain types (severity, category, rule names)
- `intent/intentFormationEngine.ts` — 6 rule-based intent formation + signal bus integration
- `intent/intentStore.ts` — Exemplar CRUD for intent classification training
- `intent/metricReviewService.ts` — Metric review formatter for intent decisions

### LLM Client (`llm/`)
Provider-agnostic LLM text generation and routing.
- `llm/client.ts` — generateText + cache + logging (delegates to providers.ts)
- `llm/providers.ts` — 9 HTTP providers (OpenAI, Anthropic, Gemini, Ollama, LiteLLM, HuggingFace, OpenClaw, OpenJarvis, Nemotron)
- `llm/routing.ts` — Provider chain selection, policy actions, experiment arms

### Automation (`automation/`)
Automation worker orchestration and external workflow delegation.
- `automation/n8nDelegationService.ts` — n8n workflow delegation
- `automation/types.ts` — ChannelSink and automation types
- `automation/runtimeState.ts` — Automation runtime health state
- `automation/health.ts` — Health check helpers

### Workflow & Traffic Routing (`workflow/`)
A/B traffic routing and workflow event persistence.
- `workflow/trafficRoutingService.ts` — 4-gate routing decision engine (flag/readiness/bucket/divergence)
- `workflow/workflowPersistenceService.ts` — Workflow session/step/event persistence

### Worker Generation (`workerGeneration/`)
Dynamic worker auto-proposal and approval pipeline.
- `workerGeneration/backgroundProposalSweep.ts` — Background auto-worker proposal evaluation loop
- `workerGeneration/workerApprovalStore.ts` — Worker approval CRUD
- `workerGeneration/dynamicWorkerRegistry.ts` — Dynamic worker registration
- `workerGeneration/proposalMetrics.ts` — Proposal success metrics

### Security (`security/`)
Automated security scanning pipeline.
- `security/securityPipelineOrchestrator.ts` — OWASP Top 10 + STRIDE threat model automation

### OpenClaw (`openclaw/`)
OpenClaw gateway health monitoring.
- `openclaw/openclawGatewayHealthService.ts` — Gateway status monitoring

### Runtime Alerts (`runtime-alerts/`)
Alert rule evaluation and dispatch.
- `runtime-alerts/alertRules.ts` — Alert condition definitions
- `runtime-alerts/alertDispatcher.ts` — Alert routing and dispatch
- `runtime-alerts/alertConfig.ts` — Alert configuration
