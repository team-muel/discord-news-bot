# Capability Gap Analysis — Muel Platform

> **Created: 2026-04-05** | Canonical assessment of current implementation vs. harness engineering vision.  
> Reference: [UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md](./UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md) | [EXECUTION_BOARD.md](./EXECUTION_BOARD.md)

## Purpose

This document maps what is **actually built and running** against what the strategic vision requires. It exists to prevent "document drift" — where docs describe a future state as if it were the present.

Use this before sprint planning. Every item here should have a milestone in the execution board.

---

## 1. MCP Infrastructure — Current vs. Document

### What is Built

| Surface | Entry point | Status |
| ------- | ----------- | ------ |
| `muelCore` (6 tools) | `src/mcp/server.ts` + `toolAdapter.ts` | ✅ 통합됨 — `muelUnified`에 포함 |
| `muelIndexing` (7 tools) | `src/mcp/indexingServer.ts` + `indexingToolAdapter.ts` | ✅ Running locally — strict local overlay index for dirty/uncommitted workspace state |
| `muelUnified` (40+ tools) | `src/mcp/unifiedServer.ts` + `unifiedToolAdapter.ts` | ✅ Running on GCP VM via SSH |
| `muelObsidian` (20+ tools) | `src/mcp/obsidianToolAdapter.ts` | ✅ Part of unified |
| `ext.*` adapters (8) | `src/services/tools/externalAdapterRegistry.ts` | ✅ Adapters registered, availability varies |
| `deepwiki` MCP | External URL | ✅ IDE config only |
| `supabase` MCP | External URL | ✅ IDE config only |

Shared/team repo analysis는 `gcpCompute`를 기본 truth surface로 보고, `muelIndexing`는 local diff overlay가 필요할 때만 추가로 사용한다.

### Gaps vs. Vision

| Gap | Priority | Notes |
|-----|----------|-------|
| `muelUnified` not in local `.vscode/mcp.json` | M-22 | GCP VM only; local dev needs SSH workaround |
| Auth context not propagated in MCP calls | future | Tools currently run without tenant scoping |
| Per-tool rate limiting and quota enforcement | future | No MCP-level throttle; relies on action runner |
| Tool call observability dashboard | future | Success rate, p95 latency per tool not tracked |
| `action.execute.direct` restricted to non-prod | ✅ Fixed | Was undocumented; now in spec |
| `diag.llm` tool undocumented in spec | ✅ Fixed (2026-04-05) | Added to MCP_TOOL_SPEC.md v2 |

---

## 2. Discord Surface — Current vs. Expected

### What is Built

| Feature | Status | Entry |
|---------|--------|-------|
| Slash commands (Korean) | ✅ 20+ commands | `src/discord/commandDefinitions.ts` |
| Message prefix `뮤엘 ...` | ✅ Working | `src/discord/commands/vibe.ts` |
| `ext.openclaw` relay option | ⚠️ Config-gated | `OPENCLAW_ENABLED`, gateway health check |
| Button interactions | ✅ Working | `src/discord/runtime/buttonInteractions.ts` |
| Passive memory capture | ✅ Working | `src/discord/runtime/passiveMemoryCapture.ts` |
| Session progress update | ✅ Working | `src/discord/commands/agent.ts` |
| Community graph capture | ✅ Working | co_presence/reaction/reply/mention |

### Gaps vs. Vision

| Gap | Priority | Notes |
|-----|----------|-------|
| Channel ingress abstraction for Discord requests | M-24 | Current Discord path prefers OpenClaw (`OPENCLAW_GATEWAY_URL`) when healthy; target is a pluggable ingress contract that can later host Chat SDK without changing routing or state ownership |
| `/스프린트` command for Discord-triggered sprint | future | Currently admin-only via HTTP API |
| Sprint progress visible in Discord | partial | Session updates work; sprint phase updates not threaded |
| Thread-based code collaboration UI | ✅ Exists | `만들어줘` → code thread pattern |
| Discord MCP tool for agents | vision | Agents can't send Discord messages via MCP tool |

---

## 3. Harness Engineering — Current vs. Vision

The "harness engineering" vision from the 2026-04 direction: **agents that learn recursively, operate autonomously, and proactively initiate work**.

### What is Built (Phase F/G/H)

| Harness Component | Implementation | Status |
|-------------------|---------------|--------|
| **Observer Layer (F)** | `src/services/observer/observerOrchestrator.ts` | ✅ 6 channels scanning |
| Error pattern detection | `observerOrchestrator` + `errorPatternScanner` | ✅ Active |
| Memory gap detection | `memoryGapScanner` | ✅ Active |
| Performance drift | `perfDriftScanner` | ✅ Active |
| Code health | `codeHealthScanner` | ⚠️ `OBSERVER_CODE_HEALTH_ENABLED=false` |
| Convergence digest | `convergenceDigestScanner` | ✅ Active |
| Discord pulse | `discordPulseScanner` | ⚠️ `OBSERVER_DISCORD_PULSE_ENABLED=false` |
| **Intent Formation (G)** | `src/services/intent/intentFormationEngine.ts` | ✅ 6 rules implemented |
| Observation → intent conversion | `intentFormationEngine` | ✅ Active (`INTENT_FORMATION_ENABLED=true`) |
| Token budget guard | `INTENT_DAILY_BUDGET_TOKENS` | ✅ Capped |
| **Progressive Trust (H)** | `src/services/sprint/trustScoreService.ts` | ✅ Score computed |
| Guild-level trust score | trust = successRate×0.35 + ... | ✅ Active (`TRUST_ENGINE_ENABLED=true`) |
| Autonomy level upgrade | trust score → autonomy level expansion | ✅ Active |
| Trust decay | daily decay rate | ✅ Active |
| Loop breaker | `TRUST_LOOP_BREAKER_ENABLED` | ⚠️ Disabled by default |

### What is Missing (Phase I/J)

| Phase | Component | Status | Notes |
|-------|-----------|--------|-------|
| **Synthesis (I)** | Intent → multi-agent plan synthesis | ❌ Not implemented | Needs planner integration |
| **MetaCognition (J)** | System-level self-evaluation | ❌ Not implemented | Needs eval framework |

### Recursive Learning Gap Analysis

| Capability | Current | Gap |
|------------|---------|-----|
| Sprint outcome → Learning Journal | ✅ Working | `SPRINT_LEARNING_JOURNAL_ENABLED` |
| Learning Journal → Next sprint plan | ✅ Working (75%+ confidence) | Auto-apply when `SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED=true` |
| Cross-sprint pattern recognition | ✅ Working | `SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW` window |
| Error pattern → Bugfix sprint | ✅ Working (`SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED`) | Approval gate still required |
| Performance regression → Fix sprint | ✅ Working (`SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED`) | Approval gate still required |
| Cross-loop improvement tracking | ⚠️ Config only | `SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED=false` |
| Convergence → Sprint trigger | ✅ Working | Via Signal Bus + intentFormation |
| **Proactive work initiation** | ⚠️ Partial | Observer scans; Intent forms; but Sprint approval still required in `approve-ship` mode |
| **Full-auto operation** | ⚠️ Off by default | `SPRINT_AUTONOMY_LEVEL=full-auto` enables; not used in production |

---

## 4. External OSS Adapter Utilization

### Adapter Status (as of 2026-04-05)

| Adapter | Availability Check | Lite Mode | Active Usage |
|---------|--------------------|-----------|-------------|
| OpenShell | shell subprocess | N/A | `shell.run` via MCP |
| NemoClaw | process + health check | No | Sprint review phase |
| **OpenClaw** | gateway HTTP → CLI fallback | Yes | Agent relay, skill create |
| OpenJarvis | HTTP `/v1/chat/completions` | Yes | Sprint ops phase |
| n8n | HTTP health check | No | Workflow trigger |
| DeepWiki | MCP URL | No | DeepWiki MCP (direct) |
| Obsidian | CLI binary | No | Obsidian write/read operations |
| Render | HTTP API | No | Deploy trigger |

### Target: 80%+ Utilization (M-22)

Current estimated utilization rate: ~40% (4 of 8 adapters see regular use)

Blockers:
- NemoClaw: requires local process startup; not always available in CI/CD
- n8n: requires configured n8n instance URL
- Render: only used during ship phase
- Obsidian CLI: requires local vault installation

---

## 5. Documentation vs. Implementation Alignment

### Accurate (no drift)

- `ARCHITECTURE_INDEX.md` — Runtime loop inventory: accurate
- `ARCHITECTURE_INDEX.md` — MCP multi-server table: ✅ Fixed (2026-04-05, muelCore count corrected to 6)
- `contracts/DISCORD_TO_MEMORY.md` — Channel metadata contract: accurate
- `contracts/MEMORY_TO_OBSIDIAN.md` — Sanitization gate: accurate
- `SPRINT_ENV_VARS.md` — Sprint env variables: accurate

### Drift Detected and Fixed (2026-04-05)

| Document | Issue | Fix |
|----------|-------|-----|
| `docs/planning/mcp/MCP_TOOL_SPEC.md` | Missing `diag.llm`, missing Obsidian tools, missing ext.* adapters | Upgraded to v2 spec |
| `docs/planning/mcp/MCP_ROLLOUT_1W.md` | Showed future tense for completed rollout | Updated to show completion + iteration 2 notes |
| `docs/ARCHITECTURE_INDEX.md` | muelCore listed as 5 tools (was 6 after `diag.llm` added) | Fixed count |

### Remaining Drift

| Document | Issue | Priority |
|----------|-------|----------|
| `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md` | May have stale adapter capability list | M-22 cleanup |
| `docs/planning/GCP_OSS_INTEGRATION_BLUEPRINT.md` | GCP VM setup steps may be outdated | Low (internal) |
| `docs/archive/*` | Multiple archived docs that reference old role names | Non-urgent (archives) |

---

## 6. Recommended Next Actions

Ordered by strategic importance:

1. **[M-22] Enable local `muelUnified` MCP entry** — Add unified server to `.vscode/mcp.json` as a local stdio option (not just SSH GCP). This dramatically improves local dev loop for IDE agents.

2. **[M-22] External adapter utilization to 80%** — Identify which adapters are flaky and add integration tests or health page docs. Focus on NemoClaw and n8n.

3. **[M-23] Doc consolidation** — Merge `docs/archive/` documents that have valuable content into living docs. Remove or timestamp-archive the rest.

4. **[M-24] Channel ingress abstraction** — Keep the current Discord/OpenClaw ingress as the first adapter, but split ingress normalization from runtime routing so a future Chat SDK surface can reuse the same policy, fallback, and state-ownership boundaries. Hermes remains the complementary continuity lane, not a competing primary ingress.

5. **[Phase I] Synthesis layer** — Implement intent → multi-agent plan synthesis. This is the missing link between "observing problems" and "deciding what to do about them".

6. **[Phase J] MetaCognition** — System-level self-evaluation. Once Phase I is stable, add weekly system efficiency scoring and strategy adjustment.
