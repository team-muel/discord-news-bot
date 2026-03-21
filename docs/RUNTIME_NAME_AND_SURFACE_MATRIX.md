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
| `openjarvis` | `operate` | operations, workflows, unattended automation | OpenJarvis | does not imply direct upstream OpenJarvis integration |
| `local-orchestrator` | `coordinate` | routing and multi-role coordination | generic orchestrator frameworks | does not imply generic external orchestrator discovery or embedding |

## External Name Reference

| External name | Category | Current repository status | Integration rule |
| --- | --- | --- | --- |
| Ollama | local model runtime/provider | supported | implemented only where provider/env configuration points to Ollama in the LLM client |
| NVIDIA OpenShell | agent runtime/security sandbox | not integrated | do not assume presence unless a future runtime surface explicitly adds it |
| NVIDIA NemoClaw | agent stack/runtime label | not integrated as an upstream runtime | internal `nemoclaw` labels are repository-local and separate from the upstream stack |
| NVIDIA Nemotron | model family | not directly integrated as a named first-class runtime surface | treat as a possible model/provider choice only if future provider config explicitly adds it |
| OpenJarvis | local-first personal AI framework | not integrated as an upstream framework | internal `openjarvis` labels refer to repository-local ops surfaces only |

## Runtime Surface Matrix

| Surface | Repository-local owner | Runtime artifact | Verification surface | Auto-integrated | Manual install or config required | Current status |
| --- | --- | --- | --- | --- | --- | --- |
| Local IDE collaboration routing | `local-orchestrator` / `coordinate` | `.github/agents/*`, `.github/prompts/local-collab-*.prompt.md`, `.github/instructions/multi-agent-routing.instructions.md` | documentation and prompt contracts only | yes for customization layer | no extra runtime install | implemented as customization layer, not execution proof |
| Structured super-agent facade | repository control plane | `src/services/superAgentService.ts` | `GET /api/bot/agent/super/capabilities`, `POST /api/bot/agent/super/recommend`, `POST /api/bot/agent/super/sessions` | yes | admin API access required | implemented |
| Role-backed collaboration actions | repository runtime | `local.orchestrator.route`, `local.orchestrator.all`, `opendev.plan`, `nemoclaw.review`, `openjarvis.ops`, `opencode.execute` | `GET /api/bot/agent/actions/catalog`, `POST /api/bot/agent/actions/execute` | yes | no extra install for in-process execution | implemented |
| Neutral role aliases | repository runtime compatibility layer | `coordinate.route`, `coordinate.all`, `architect.plan`, `review.review`, `operate.ops`, `implement.execute` | `GET /api/bot/agent/actions/catalog` | yes | no extra install | implemented |
| Advisory role workers | `local-orchestrator`, `opendev`, `nemoclaw`, `openjarvis` | HTTP workers from `scripts/agent-role-worker.ts` | `GET /api/bot/agent/runtime/role-workers`, `GET /api/bot/agent/runtime/unattended-health` | no | worker URL env plus optional token required | implemented when configured |
| Local CLI tool slice | `openjarvis` / `operate` | `tools.run.cli`, `src/services/tools/*` | `GET /api/bot/agent/tools/status`, `GET /api/bot/agent/actions/catalog` | no | explicit env registration required | implemented as a narrow single-tool slice |
| Ollama provider support | LLM provider layer | `src/services/llmClient.ts` provider config | provider/env validation and runtime behavior | no | Ollama runtime plus env config required | implemented when configured |
| Generic local OSS CLI discovery | future tool layer | not present as a first-class runtime | none | no | would require new discovery and registry layer | not implemented |
| Generic upstream framework embedding for OpenShell, NemoClaw, OpenJarvis | future external runtime integration | not present as a first-class runtime | none | no | would require explicit adapter/provider/runtime work | not implemented |

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
- advisory worker definitions: `src/services/agentRoleWorkerService.ts`
- action catalog and direct execution API: `src/routes/bot-agent/governanceRoutes.ts`
- role worker and unattended runtime status API: `src/routes/bot-agent/runtimeRoutes.ts`
- local CLI tool status API: `src/routes/bot-agent/toolsRoutes.ts`
- super-agent facade API: `src/routes/bot-agent/coreRoutes.ts`

## Relationship To Other Docs

- `docs/ROLE_RENAME_MAP.md` explains migration and compatibility policy for legacy-to-neutral naming.
- `docs/ARCHITECTURE_INDEX.md` explains current runtime structure and boundaries.
- `docs/RUNBOOK_MUEL_PLATFORM.md` explains operator procedure.
- `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md` explains IDE collaboration behavior.
- `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md` explains the future generalized local tool layer that does not yet exist.
