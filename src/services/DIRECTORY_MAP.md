# Services Directory Structure

## Domain Groupings

The `src/services/` directory contains 100+ service files. This README documents the logical domain groupings
to help navigate the codebase. Files are organized conceptually even though they share a flat directory.

### Agent Runtime (`agent*`)
Core multi-agent session lifecycle, policy, telemetry, and governance.
- `multiAgentService.ts` — Session orchestration hub (start/cancel/execute sessions)
- `multiAgentTypes.ts` — Shared type definitions (AgentSession, AgentStep, etc.)
- `agentIntentClassifier.ts` — Intent classification and casual chat generation
- `multiAgentRuntimeQueue.ts` — Queue and concurrency management
- `agentPolicyService.ts` — Session validation and policy enforcement
- `agentPrivacyPolicyService.ts` — Privacy deliberation mode and risk scoring
- `agentPrivacyTuningService.ts` — Privacy gate sample recording
- `agentMemoryService.ts` — Memory hint hydration for sessions
- `agentMemoryStore.ts` — Persistent memory CRUD
- `agentSessionStore.ts` — Session persistence to Supabase
- `agentWorkflowService.ts` — Step template profiles
- `agentOpsService.ts` — Ops-triggered agent invocations
- `agentRoleWorkerService.ts` — HTTP role worker health probing
- `agentRuntimeReadinessService.ts` — Runtime readiness checks
- `agentRuntimeTypes.ts` — Shared agent role/priority/intent types
- `agentTelemetryQueue.ts` — Async telemetry task queue
- `agentSloService.ts` — SLO metrics tracking
- `agentConsentService.ts` — User consent management
- `agentRetentionPolicyService.ts` — Data retention policies

### Agent Reasoning (`agentGot*`, `agentTot*`, `agentQuality*`)
Graph of Thought, Tree of Thought, and quality review.
- `agentGotPolicyService.ts` — GoT budget and policy
- `agentGotCutoverService.ts` — GoT/ToT cutover decisions
- `agentGotStore.ts` — GoT shadow run persistence
- `agentGotAnalyticsService.ts` — GoT analytics
- `agentTotPolicyService.ts` — ToT policy and auto-tuning
- `agentQualityReviewService.ts` — Quality review metrics

### Skills & Actions (`skills/`)
Composable skill registry, execution engine, and action implementations.
- `skills/engine.ts` — Skill execution coordinator
- `skills/registry.ts` — Skill registration and lookup
- `skills/actionRunner.ts` — Action governance wrapper
- `skills/actions/` — Individual action implementations (web, rag, news, code, etc.)

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

### Trading (`trading*`, `aiTrading*`, `trades*`)
Cryptocurrency trading engine and Binance integration.
- `tradingEngine.ts` — Core trading loop (CVD strategy)
- `tradingStrategyService.ts` — Strategy calculation
- `aiTradingClient.ts` — Remote trading API client
- `localAiTradingClient.ts` — Local Binance execution
- `tradesStore.ts` — Trade persistence
- `distributedLockService.ts` — Multi-instance trade lock

### News & Monitoring (`news*`, `youtube*`, `source*`)
RSS/Google Finance news ingestion and YouTube monitoring.
- `newsCaptureDedupService.ts` — Semantic deduplication
- `newsChannelStore.ts` — Channel subscription CRUD
- `newsMonitorWorkerClient.ts` — Worker client
- `newsSentimentMonitor.ts` — Sentiment scoring
- `youtubeSubscriptionsMonitor.ts` — YouTube subscription tracking
- `youtubeCommunityScraper.ts` — Community tab scraping
- `sourceMonitorStore.ts` — Source monitor persistence

### Obsidian RAG (`obsidian*`)
Knowledge retrieval via Obsidian vault graph.
- `obsidianRagService.ts` — RAG query orchestration
- `obsidianHeadlessService.ts` — Headless CLI integration
- `obsidianCacheService.ts` — Cache layer
- `obsidianBootstrapService.ts` — Guild vault bootstrap
- `obsidianLoreSyncService.ts` — Bidirectional sync
- `obsidianQualityService.ts` — Content quality metrics
- `obsidian/` — Router, authoring, adapters

### LangGraph (`langgraph/`)
State graph execution for agent sessions.
- `langgraph/stateContract.ts` — State shape and trace utilities
- `langgraph/executor.ts` — Graph execution engine
- `langgraph/nodes/` — Individual node implementations
- `langgraph/sessionRuntime/` — Branch execution strategies
- `langgraph/runtimeSupport/` — Budget, formatting, evaluation helpers

### External Tools (`tools/`)
External CLI tool integration and execution.
- `tools/externalToolProbe.ts` — System CLI availability probing
- `tools/externalAdapterRegistry.ts` — Adapter registration
- `tools/toolRouter.ts` — Tool routing
- `tools/toolExecutor.ts` — Sandboxed execution

### Infrastructure
Database, auth, observability, and cross-cutting concerns.
- `supabaseClient.ts` — Supabase client singleton
- `baseRepository.ts` — Repository pattern base (error handling, normalization)
- `authService.ts` — OAuth flow
- `llmClient.ts` — Provider-agnostic LLM client
- `promptCompiler.ts` — Prompt compilation
- `observability/` — Telemetry and monitoring
- `runtime-alerts/` — Alert rules and routing
