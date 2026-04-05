# Runtime Name And Surface Matrix

## Purpose

This document is the canonical source of truth for two questions that were previously spread across multiple files.

1. What a name means inside this repository.
2. What runtime surface is actually implemented and callable in the current deployment.

Use this document when a role name, runtime label, external OSS name, or model family name could be misread as proof of direct integration.

## Reading Rule

- internal role names describe repository-local collaboration and runtime labels
- external product or model names describe separate systems unless this matrix explicitly marks an implemented runtime surface
- runtime truth is established by registered actions, configured workers, provider configuration, and operator status endpoints
- if this matrix and a secondary document disagree, update the secondary document to match this file plus current code

## Name Collision Matrix

| Legacy internal name | Neutral internal name | Internal meaning | Common external name collision | Collision interpretation rule |
| --- | --- | --- | --- | --- |
| `opencode` | `implement` | implementation, edits, tests, execution | none tracked here as canonical external runtime | treat as repository-local implementation role only |
| `opendev` | `architect` | architecture, sequencing, ADR planning | OpenDev-style naming may be confused with generic external dev tooling | treat as repository-local architecture role only |
| `nemoclaw` | `review` | review, regression, security, risk | NVIDIA NemoClaw | does not imply direct NVIDIA NemoClaw integration |
| `openjarvis` | `operate` | operations, workflows, unattended automation | OpenJarvis (Stanford) | internal `openjarvis` labels map to upstream open-jarvis/OpenJarvis framework when integrated |
| `local-orchestrator` | `coordinate` | routing and multi-role coordination | generic orchestrator frameworks | does not imply generic external orchestrator discovery or embedding |
| `langgraph` | `agentGraph` | loop-based state machine executor for multi-step agent pipelines (11 nodes, edge resolver, shadow execution) | LangChain LangGraph (`@langchain/langgraph`) | NOT LangChain LangGraph. Internal executor is a 95-line for-loop state machine with no checkpointing, HITL, branching/merging, or time-travel debugging. `@langchain/langgraph` npm package is not installed. Rename to neutral name planned |

## External Name Reference

| External name | Category | Current repository status | Integration rule |
| --- | --- | --- | --- |
| Ollama | local model runtime/provider | supported | implemented in LLM client provider and litellm.config.yaml |
| NVIDIA OpenShell | agent sandbox runtime (Rust, ★4.4k) | CLI installed, sandbox pending (Phase 2); isolation target (M-12) | Safe, private runtime for autonomous AI agents. K3s-based sandbox with YAML policy-enforced filesystem/network/process/inference control. v0.0.22 latest; adapter at `src/services/tools/adapters/openshellCliAdapter.ts` with WSL routing; probe passes; sandbox creation blocked on Docker Desktop WSL native integration; M-12 targets: implement.execute sandbox delegation, policy↔governance sync |
| NVIDIA NemoClaw | reference stack: OpenClaw-in-OpenShell bundle (JS/TS/Shell, ★18.4k) | CLI installed, sandbox push failed (Phase 3) | Turnkey setup that installs OpenShell, onboards an OpenClaw agent in a hardened sandbox, and configures routed inference (default: Nemotron). NOT an independent AI or runtime — it is a guided installer + blueprint + state manager wrapping OpenClaw + OpenShell. Adapter at `src/services/tools/adapters/nemoclawCliAdapter.ts` with WSL routing; Docker image built but K3s gateway push failed; blocked on Phase 2 completion |
| NVIDIA Nemotron | model family | integration complete (Phase 1) | `nvidia/nemotron-3-super-120b-a12b` via NVIDIA Endpoint API; registered in litellm.config.yaml as `muel-nemotron`; E2E verified; `LLM_API_TIMEOUT_LARGE_MS` (90s) supports large model calls |
| OpenClaw | always-on personal AI assistant (TypeScript, ★348k) | CLI installed, runtime blocked (Phase 4); channel bridge target (M-13) | The AI agent itself — handles conversation, reasoning, skill execution, multi-channel relay (WhatsApp/Telegram/Slack). Ecosystem: ClawhHub (skill directory ★7.5k), acpx (Agent Client Protocol CLI ★1.9k), lobster (workflow shell ★1.1k). npm CLI installed; agent.chat blocked on cmdop gRPC server; M-13 targets: Gateway session bridge, multi-channel relay, skill create trigger |
| OpenJarvis | local-first personal AI framework (Python/Rust, Stanford, ★2.1k) | integration active (Phase 4); learning loop target (M-11) | Completely separate project from OpenClaw/NemoClaw stack. Built at Stanford Hazy Research / Scaling Intelligence Lab. 5 primitives: Intelligence, Engines, Agents, Tools & Memory, Learning. v0.1.0 installed; `jarvis serve` running on port 8000 (OpenAI-compatible API); llmClient `openjarvis` provider E2E verified; adapter at `src/services/tools/adapters/openjarvisAdapter.ts` (HTTP + CLI dual); M-11 targets: bench→gate feed, optimize schedule, trace→learning closed loop |

## Runtime Surface Matrix

| Surface | Repository-local owner | Runtime artifact | Verification surface | Auto-integrated | Manual install or config required | Current status |
| --- | --- | --- | --- | --- | --- | --- |
| Local IDE collaboration routing | `local-orchestrator` / `coordinate` | `.github/agents/*`, `.github/prompts/local-collab-*.prompt.md`, `.github/instructions/multi-agent-routing.instructions.md` | documentation and prompt contracts only | yes for customization layer | no extra runtime install | implemented as customization layer, not execution proof |
| Structured super-agent facade | repository control plane | `src/services/superAgentService.ts` | `GET /api/bot/agent/super/capabilities`, `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions` | yes | admin API access required | implemented |
| Role-backed collaboration actions | repository runtime | `local.orchestrator.route`, `local.orchestrator.all`, `opendev.plan`, `nemoclaw.review`, `openjarvis.ops`, `opencode.execute` | `GET /api/bot/agent/actions/catalog`, `POST /api/bot/agent/actions/execute` | yes | no extra install for in-process execution | implemented |
| Neutral role aliases | repository runtime compatibility layer | `coordinate.route`, `coordinate.all`, `architect.plan`, `review.review`, `operate.ops`, `implement.execute` | `GET /api/bot/agent/actions/catalog` | yes | no extra install | implemented |
| Advisory role workers | `coordinate`, `architect`, `review`, `operate` (legacy aliases: `local-orchestrator`, `opendev`, `nemoclaw`, `openjarvis`) | HTTP workers from `scripts/agent-role-worker.ts` | `GET /api/bot/agent/runtime/role-workers`, `GET /api/bot/agent/runtime/unattended-health` | no | worker URL env plus optional token required | implemented when configured |
| Local CLI tool slice | `operate` (legacy: `openjarvis`) | `tools.run.cli`, `src/services/tools/*` | `GET /api/bot/agent/tools/status`, `GET /api/bot/agent/actions/catalog` | no | explicit env registration required | implemented as a narrow single-tool slice |
| Ollama provider support | LLM provider layer | `src/services/llmClient.ts` provider config | provider/env validation and runtime behavior | no | Ollama runtime plus env config required | implemented when configured |
| Generic local OSS CLI discovery | tool auto-loader layer | `src/services/tools/adapterAutoLoader.ts` glob scan + duck-type check, `registerExternalAdapter`/`unregisterExternalAdapter` | `GET /api/bot/agent/tools/adapters` | no | adapter file in `adapters/` dir + valid ID pattern required | **implemented (M-15)** — branded string ExternalAdapterId, glob-scan auto-registration, onboarding checklist generation |
| Observer Layer (Phase F) | autonomous scanning | `src/services/observer/observerOrchestrator.ts` + 6 channels | internal signal bus (no HTTP API) | no | `OBSERVER_ENABLED=true` required | implemented — error patterns, memory gaps, perf drift, code health, convergence, Discord pulse |
| Intent Formation (Phase G) | autonomous intent | `src/services/intent/intentFormationEngine.ts` + 6 rules | `src/routes/bot-agent/intentRoutes.ts` | no | `INTENT_FORMATION_ENABLED=true` required | implemented — observation → rule-based intent → sprint trigger |
| Progressive Trust (Phase H) | trust scoring | `src/services/sprint/trustScoreService.ts` | internal (trust-gated sprint autonomy) | no | `TRUST_ENGINE_ENABLED=true` required | implemented — guild×category trust score, daily decay, loop breaker |
| Signal Bus | in-process event hub | `src/services/runtime/signalBus.ts` + `signalBusWiring.ts` | `SIGNAL_BUS_ENABLED` + internal diagnostics | yes | no extra config | implemented — 17 signal types, async fire-and-forget, cooldown/dedup |
| Workflow Persistence + Traffic Routing | A/B routing | `src/services/workflow/trafficRoutingService.ts` + `workflowPersistenceService.ts` | `GET /agent/traffic/decisions`, `GET /agent/traffic/distribution` | no | `TRAFFIC_ROUTING_ENABLED=true` | implemented — 4-gate routing (flag/readiness/bucket/divergence) |
| User CRM | user profiling | `src/services/discord-support/userCrmService.ts` | `src/routes/bot-agent/crmRoutes.ts` (GET /agent/crm/*) | no | Supabase user_profiles table | implemented — write-behind activity tracking, profiles, leaderboard |
| MCP Unified Server | single MCP entry | `src/mcp/unifiedServer.ts` (40 tools) | GCP VM :8850 (Caddy :8447) or local stdio | no | GCP VM access or local `scripts/unified-mcp-stdio.ts` | implemented — standard + indexing + Obsidian + ext.* |
| Generic upstream framework embedding for OpenShell, NemoClaw, OpenClaw, OpenJarvis, DeepWiki, n8n | external runtime integration | 6 adapters implemented + probed; 33 capabilities mapped; composite execution (primary + secondary) active | see `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md`, `docs/contracts/SPRINT_DATA_FLOW.md` | no | install + env config + adapter enable flags required | Phase 1 complete; external adapter capability expansion (고도화) complete — 28 enrichment actions, 5 secondary adapter mappings, ext.* MCP bridge, OpenClaw session bootstrap |
| ext.* MCP bridge | sprint pipeline / tool layer | `src/mcp/unifiedToolAdapter.ts` ext.* routing | `ext.<adapterId>.<capability>` tool calls via MCP | no | at least one external adapter enabled | implemented — routes external adapter capabilities as MCP tools with `ext.` namespace |
| OpenClaw Gateway session bootstrap | sprint pipeline | `src/services/tools/adapters/openclawCliAdapter.ts` bootstrapOpenClawSession | OpenClaw session endpoint `/api/sessions/{id}/message` | no | `OPENCLAW_GATEWAY_URL` + `OPENCLAW_GATEWAY_TOKEN` required | implemented — idempotent per sessionId, registers ext.* tools as session skills before implement phase |
| NVIDIA Nemotron inference via LiteLLM | LLM provider layer | litellm.config.yaml `muel-nemotron` entry, LiteLLM proxy on :4000 | LiteLLM proxy model routing + `/health/liveliness` probe | no | NVIDIA API key required | implemented and verified |

## Operator Verification Order

When checking whether something is actually callable in a deployment, use this order.

1. `GET /api/bot/agent/actions/catalog`
2. `GET /api/bot/agent/runtime/role-workers`
3. `GET /api/bot/agent/tools/status`
4. `GET /api/bot/agent/runtime/unattended-health`
5. relevant provider and worker environment configuration

If a role or tool name appears only in `.github` customization files or planning documents and does not appear through the runtime surfaces above, treat it as non-operational documentation context.

## Code Anchors

- action registration: `src/services/skills/actions/registry.ts`
- role-backed action implementations: `src/services/skills/actions/agentCollab.ts`
- advisory worker definitions: `src/services/agent/agentRoleWorkerService.ts`
- action catalog and direct execution API: `src/routes/bot-agent/governanceRoutes.ts`
- role worker and unattended runtime status API: `src/routes/bot-agent/runtimeRoutes.ts`
- local CLI tool status API: `src/routes/bot-agent/toolsRoutes.ts`
- super-agent facade API: `src/routes/bot-agent/coreRoutes.ts`
- ext.* MCP bridge: `src/mcp/unifiedToolAdapter.ts`
- external adapter composite execution: `src/services/sprint/sprintWorkerRouter.ts`
- observer orchestrator: `src/services/observer/observerOrchestrator.ts`
- intent formation engine: `src/services/intent/intentFormationEngine.ts`
- trust score service: `src/services/sprint/trustScoreService.ts`
- signal bus: `src/services/runtime/signalBus.ts`
- adapter auto-loader: `src/services/tools/adapterAutoLoader.ts`
- traffic routing: `src/services/workflow/trafficRoutingService.ts`
- user CRM: `src/services/discord-support/userCrmService.ts`
- unified MCP server: `src/mcp/unifiedServer.ts`
- phase enrichment map: `src/services/sprint/sprintPreamble.ts`
- OpenClaw session bootstrap: `src/services/tools/adapters/openclawCliAdapter.ts`
- shared circuit breaker: `src/utils/circuitBreaker.ts`

## Relationship To Other Docs

- `docs/ARCHITECTURE_INDEX.md` explains current runtime structure and boundaries.
- `docs/RUNBOOK_MUEL_PLATFORM.md` explains operator procedure.
- `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md` explains IDE collaboration behavior.
- `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md` explains the future generalized local tool layer that does not yet exist.
- `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md` explains the concrete plan for integrating NVIDIA OpenShell, NemoClaw, OpenClaw, Stanford OpenJarvis, and Nemotron as real Tool layer components.

## Naming Compatibility Policy

**Current status: Phase C complete (2026-03-24).**

All internal source code, types, actions, worker specs, tests, docs, and prompts now use neutral names as canonical labels. Legacy names are still accepted as input aliases for backward compatibility in `normalizeAgentRole()`, `McpWorkerKind`, worker spec aliases, and `ROLE_TOOLS`.

- Phase A (completed): docs and prompts prefer new names; runtime accepts both legacy and new labels.
- Phase B (completed): scripts/workflows/env prefer new names; legacy labels remain as deprecated aliases.
- Phase C (completed 2026-03-24): all source code uses neutral names as canonical; legacy aliases kept only at input boundaries; external OSS adapter IDs (nemoclaw, openjarvis, openshell, openclaw) remain unchanged.
