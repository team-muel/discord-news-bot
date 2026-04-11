/**
 * Services — Domain Module Index
 *
 * Each domain is a self-contained barrel export with its own index.ts.
 * Use namespace imports for domain-scoped access:
 *
 *   import { agent, runtime, memory } from '../services';
 *   agent.validateAgentSessionRequest(...)
 *
 * Or import from subdirectories directly:
 *
 *   import { validateAgentSessionRequest } from '../services/agent';
 *   import { startAgentSession } from '../services/multiAgentService';
 *
 * Root-level files are grouped by domain below as a reference map
 * but NOT re-exported to avoid naming conflicts.
 */

// ─── Domain barrel re-exports (namespace style) ────────────────────────

export * as agent from './agent';
export * as automation from './automation';
export * as discordSupport from './discord-support';
export * as eval_ from './eval';
export * as infra from './infra';
export * as agentGraph from './langgraph';
export * as langgraph from './langgraph';
export * as llm from './llm';
export * as memory from './memory';
export * as news from './news';
export * as observer from './observer';
export * as obsidian from './obsidian';
export * as opencode from './opencode';
export * as runtime from './runtime';
export * as runtimeAlerts from './runtime-alerts';
export * as security from './security';
export * as skills from './skills';
export * as sprint from './sprint/eventSourcing';
export * as tools from './tools';
export * as trading from './trading';
export * as workerGeneration from './workerGeneration';
export * as workflow from './workflow';

// ─── Root-level file domain map (import directly) ──────────────────────
//
// AGENT RUNTIME
//   multiAgentService    — session orchestration (start/cancel/execute)
//   multiAgentTypes      — AgentSession, AgentStep, AgentRuntimeSnapshot
//   multiAgentReasoningStrategies — ToT, self-refine, least-to-most, beam
//   multiAgentRuntimeQueue — async job queue
//   superAgentService    — multi-turn orchestration
//   conversationTurnService — turn persistence
//   workerExecution      — worker error types, input normalization
//
// LLM
//   llmClient            — re-exports from llm/client (generateText, etc.)
//   llmExperimentAnalyticsService — experiment tracking
//   llmStructuredParseService     — JSON/structured output parsing
//
// AUTOMATION
//   automationBot        — job scheduling, runtime snapshot
//
// TASK ROUTING
//   taskRoutingService   — route detection, RAG query plan
//   taskRoutingAnalyticsService — routing summary, policy hints
//   taskRoutingMetricsService   — metric recording
//
// AUTH & ADMIN
//   supabaseClient       — Supabase singleton
//   authService          — OAuth, JWT, CSRF
//   adminAllowlistService — admin role checks
//
// ANALYTICS / OPS
//   finopsService        — cost tracking, budget status
//   goNoGoService        — release gate reports
//   metricReviewFormatter — KRA snapshots
//   entityNervousSystem  — memory precipitation, self-notes
//
// INFRASTRUCTURE
//   localStateCache      — in-memory TTL cache
//   structuredErrorLogService — error logging
//   benchmarkStore       — reconnect event storage
//
// COMMUNITY / USER
//   communityGraphService — social graph events
//   userLearningPrefsService — per-user learning toggle
//   userPersonaService   — persona snapshots
//   privacyForgetService — GDPR forget operations
//   semanticAnswerCacheService — RAG result cache
//
// SECURITY
//   securityCandidateContract — candidate types, JSONL parsing
//
// TOOLS / MCP
//   mcpSkillRouter       — MCP worker registration, routing
//   mcpWorkerClient      — MCP tool call client
//   toolLearningService  — tool effectiveness learning
//   researchPresetStore  — research template CRUD
