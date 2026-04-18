# Capability Gap Analysis — Muel Platform

> **Created: 2026-04-05** | Canonical assessment of current implementation vs. harness engineering vision.  
> Reference: [UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md](./UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md) | [EXECUTION_BOARD.md](./EXECUTION_BOARD.md)

## Purpose

This document maps what is **actually built and running** against what the strategic vision requires. It exists to prevent "document drift" — where docs describe a future state as if it were the present.

Use this before sprint planning. Every item here should have a milestone in the execution board.

---

## 1. MCP Infrastructure — Current vs. Document

### MCP Built Today

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

### MCP Gaps To Vision

| Gap | Priority | Notes |
| --- | -------- | ----- |
| `muelUnified` not in local `.vscode/mcp.json` | M-22 | GCP VM only; local dev needs SSH workaround |
| Auth context not propagated in MCP calls | future | Tools currently run without tenant scoping |
| Per-tool rate limiting and quota enforcement | future | No MCP-level throttle; relies on action runner |
| Tool call observability dashboard | future | Success rate, p95 latency per tool not tracked |
| `action.execute.direct` restricted to non-prod | ✅ Fixed | Was undocumented; now in spec |
| `diag.llm` tool undocumented in spec | ✅ Fixed (2026-04-05) | Added to MCP_TOOL_SPEC.md v2 |

---

## 2. Discord Surface — Current vs. Expected

### Discord Built Today

| Feature | Status | Entry |
| ------- | ------ | ----- |
| Slash commands (Korean) | ✅ 20+ commands | `src/discord/commandDefinitions.ts` |
| Message prefix `뮤엘 ...` | ✅ Working | `src/discord/commands/vibe.ts` |
| `ext.openclaw` relay option | ⚠️ Config-gated | `OPENCLAW_ENABLED`, gateway health check |
| Button interactions | ✅ Working | `src/discord/runtime/buttonInteractions.ts` |
| Passive memory capture | ✅ Working | `src/discord/runtime/passiveMemoryCapture.ts` |
| Session progress update | ✅ Working | `src/discord/commands/agent.ts` |
| Community graph capture | ✅ Working | co_presence/reaction/reply/mention |

### Discord Gaps To Vision

| Gap | Priority | Notes |
| --- | -------- | ----- |
| Channel ingress abstraction for Discord requests | M-24 | Current Discord path prefers OpenClaw (`OPENCLAW_GATEWAY_URL`) when healthy; target is a pluggable ingress contract that can later host Chat SDK without changing routing or state ownership |
| `/스프린트` command for Discord-triggered sprint | future | Currently admin-only via HTTP API |
| Sprint progress visible in Discord | partial | Session updates work; sprint phase updates not threaded |
| Thread-based code collaboration UI | ✅ Exists | `/뮤엘` or `뮤엘 ...` build intent → code thread pattern |
| Discord MCP tool for agents | vision | Agents can't send Discord messages via MCP tool |

---

## 3. Harness Engineering — Current vs. Vision

The "harness engineering" vision from the 2026-04 direction: **agents that learn recursively, operate autonomously, and proactively initiate work**.

### What is Built (Phase F/G/H)

| Harness Component | Implementation | Status |
| ----------------- | -------------- | ------ |
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

- Synthesis (I): Intent → multi-agent plan synthesis. Status: not implemented. Notes: needs planner integration.
- MetaCognition (J): System-level self-evaluation. Status: not implemented. Notes: needs eval framework.

### Recursive Learning Gap Analysis

- Sprint outcome → Learning Journal: working. Gap: `SPRINT_LEARNING_JOURNAL_ENABLED`.
- Learning Journal → Next sprint plan: working at 75%+ confidence. Gap: auto-apply only when `SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED=true`.
- Cross-sprint pattern recognition: working. Gap: `SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW` window.
- Error pattern → Bugfix sprint: working via `SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED`. Gap: approval gate still required.
- Performance regression → Fix sprint: working via `SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED`. Gap: approval gate still required.
- Cross-loop improvement tracking: config only. Gap: `SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED=false`.
- Convergence → Sprint trigger: working. Gap: Signal Bus + intentFormation only.
- Proactive work initiation: partial. Gap: observer scans and intent forms, but sprint approval is still required in `approve-ship` mode.
- Full-auto operation: off by default. Gap: `SPRINT_AUTONOMY_LEVEL=full-auto` exists but is not used in production.

---

## 4. External OSS Adapter Utilization

### Adapter Status (as of 2026-04-05)

- OpenShell: availability check = shell subprocess. Lite mode: N/A. Active usage: `shell.run` via MCP.
- NemoClaw: availability check = process + health check. Lite mode: no. Active usage: sprint review phase.
- OpenClaw: availability check = gateway HTTP → CLI fallback. Lite mode: yes. Active usage: agent relay, skill create.
- OpenJarvis: availability check = HTTP `/v1/chat/completions`. Lite mode: yes. Active usage: sprint ops phase.
- n8n: availability check = HTTP health check. Lite mode: no. Active usage: workflow trigger.
- DeepWiki: availability check = MCP URL. Lite mode: no. Active usage: DeepWiki MCP direct.
- Obsidian: availability check = CLI binary. Lite mode: no. Active usage: Obsidian write/read operations.
- Render: availability check = HTTP API. Lite mode: no. Active usage: deploy trigger.

### Target: 80%+ Utilization (M-22)

Current estimated utilization rate: ~40% (4 of 8 adapters see regular use)

Blockers:

- NemoClaw: requires local process startup; not always available in CI/CD
- n8n: requires configured n8n instance URL
- Render: only used during ship phase
- Obsidian CLI: requires local vault installation

### Live Capability Unlock Snapshot (2026-04-17)

Validated with:

- `npm run capability:audit`
- `npm run -s tools:probe -- --json`
- `hermes.cmd skills list`
- `npm run -s openjarvis:autopilot:status`
- `npm run -s hermes:vscode:bridge:status`

What is actually ready on this workstation right now:

- `hermes-local-operator`: ready. Classification: local-only hands layer. Notes: OpenJarvis/Ollama-backed local continuity lane is usable and the VS Code bridge is configured for bounded `code chat` relaunch.
- `local-workstation-executor`: ready. Classification: local-only actuator. Notes: PowerShell-backed bounded local command/browser/app/file path is live.
- `n8n-router`: ready. Classification: deterministic router, still guardrailed. Notes: adapter is available and configured tasks exist, but the repo still treats n8n as the deterministic router layer rather than the semantic owner.
- `remote-heavy-execution`: ready. Classification: always-on support lane. Notes: Render and the canonical GCP worker surfaces are wired enough to keep remote execution in play.
- `obsidian-semantic-owner`: ready. Classification: durable semantic owner. Notes: shared/local Obsidian adapter path is healthy enough to keep operator knowledge promotion alive.

What is available but intentionally guardrailed or catalog-limited:

- Hermes skills: live state = `1 hub-installed, 74 builtin, 0 local`. Classification: guardrailed. Notes: no repo-local Hermes skill pack is loaded, which is acceptable until a repeated repo-specific workflow truly needs a local skill instead of a wrapper or script.
- OpenJarvis adapter: live state = available, lite-mode. Classification: guardrailed. Notes: rich local agent, eval, optimize, and scheduler capabilities exist in the adapter, but the default tool catalog deliberately exposes only the narrower lite subset until route ownership is explicit.
- OpenClaw adapter: live state = available, lite-mode. Classification: guardrailed. Notes: the adapter exists, but only chat/health are exposed in the lite catalog and the local gateway chat surface is not healthy enough for default ingress.
- n8n, Obsidian, Render, Ollama, LiteLLM, `mcp-indexing`: live state = available, lite-mode. Classification: guardrailed. Notes: these lanes exist, but the catalog intentionally narrows the exposed capability set. Unlocking the full surface should be a deliberate routing decision, not a default.

What is still disconnected and blocks promotion:

- `gcpcompute-shared-mcp`: live state = missing in `automation.capability.catalog`. Classification: disconnected. Why it matters: `MCP_SHARED_MCP_URL` / `OBSIDIAN_REMOTE_MCP_URL` are wired, but `MCP_UPSTREAM_SERVERS` is unset, so no enabled `upstream.<namespace>.*` wrapper lane exists. The service URL is present, but the reusable shared wrapper path is not.

Documented optional or accepted states:

- `litellmProxy`: live state = reachable when configured. Classification: opt-in remote provider lane. Why it matters: direct LiteLLM/NVIDIA NIM routing remains available, but `LITELLM_BASE_URL` is no longer a controller-side always-on requirement.
- OpenClaw gateway chat: live state = CLI installed, API unreachable. Classification: optional ingress lane. Why it matters: the local OpenClaw ingress path stays health-gated; CLI or lite-mode presence does not make it the default ingress owner.
- Hermes local skill pack: live state = `0 local`. Classification: optional lane. Why it matters: the empty repo-local skill pack is acceptable until a repeated repo-specific workflow clearly needs a local skill instead of a shared wrapper or deterministic script.
- DeepWiki adapter: live state = unavailable. Classification: optional lane. Why it matters: useful for repo-doc Q&A, but not an always-on blocker for the current control plane.
- Standard external probe coverage: live state = 8 probe surfaces vs 12 adapter surfaces. Classification: accepted observability gap. Why it matters: `tools:probe` is not the full capability inventory. `capability:audit` is the canonical unlock surface until the low-level probe and adapter registry converge.

Local-only vs. always-on ownership boundary:

- **Always-on required**: `implementWorker`, `architectWorker`, `reviewWorker`, `operateWorker`, `openjarvisServe`, `unifiedMcp`
- **Opt-in remote provider lanes**: `litellmProxy`
- **Local acceleration only**: `localOllama`
- **Operator-personal local lanes**: `hermes-local-operator`, `local-workstation-executor`, OpenClaw gateway, OpenShell/NemoClaw sandbox, local Obsidian adapter, local `mcp-indexing` dirty overlay
- **Promote next, not immediately**: shared MCP wrappers after upstream federation is live; wider adapter capabilities only after routing/ownership/observability are explicit

---

## 5. Documentation vs. Implementation Alignment

### Accurate (no drift)

- `ARCHITECTURE_INDEX.md` — Runtime loop inventory: accurate
- `ARCHITECTURE_INDEX.md` — MCP multi-server table: ✅ Fixed (2026-04-05, muelCore count corrected to 6)
- `contracts/DISCORD_TO_MEMORY.md` — Channel metadata contract: accurate
- `contracts/MEMORY_TO_OBSIDIAN.md` — Sanitization gate: accurate
- `SPRINT_ENV_VARS.md` — Sprint env variables: accurate

### Drift Detected and Fixed (2026-04-05)

- `docs/planning/mcp/MCP_TOOL_SPEC.md`: issue = missing `diag.llm`, missing Obsidian tools, missing ext.* adapters. Fix = upgraded to v2 spec.
- `docs/planning/mcp/MCP_ROLLOUT_1W.md`: issue = showed future tense for completed rollout. Fix = updated to show completion + iteration 2 notes.
- `docs/ARCHITECTURE_INDEX.md`: issue = muelCore listed as 5 tools after `diag.llm` added. Fix = corrected the count.

### Remaining Drift

- `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md`: may have a stale adapter capability list. Priority: M-22 cleanup.
- `docs/planning/GCP_OSS_INTEGRATION_BLUEPRINT.md`: GCP VM setup steps may be outdated. Priority: low, internal only.
- `docs/archive/*`: multiple archived docs still reference old role names. Priority: non-urgent archives cleanup.

---

## 6. Recommended Next Actions

Ordered by strategic importance:

### 2026-04-17 Capability Unlock Order

1. **Reconnect shared MCP as a real wrapper lane** — Set `MCP_UPSTREAM_SERVERS` to at least one enabled upstream namespace and fail readiness if only the raw service URL is wired. This is the highest-leverage unlock because it converts a machine-local service URL into a teammate-usable `upstream.*` lane.

2. **Use `capability:audit` as the canonical unlock inventory** — The low-level external probe does not cover every adapter or catalog limit. Unlock decisions should start from the unified capability audit, not from `tools:probe` output alone.

3. **Keep OpenClaw explicitly optional until the gateway chat surface is restored** — The current state is intentionally “installed but not route-safe.” Do not widen ingress ownership until the gateway chat surface is healthy again.

4. **Keep Hermes local skills empty until a real repeated workflow demands them** — Prefer repo scripts or shared wrappers before adding personal/local skill packs. The current 0-local-skill state is a signal to add contracts, not necessarily a bug.

5. **Keep DeepWiki optional** — Treat DeepWiki as a later unlock for documentation leverage, not as a blocker for the current local capability lane.

### Global Guardrails

- Do not treat direct remote URL wiring as equivalent to a shared wrapper lane. A shared lane is only “unlocked” when the `upstream.<namespace>.*` surface is actually registered and queryable.
- Do not promote local-only lanes to always-on ownership until shared owner, observability, and rollback are explicit.
- Keep auth, versioning, and provider semantics in the provider-native layer instead of burying them in prompt glue or ad hoc notes.
- Keep lite-mode adapters intentionally narrow until route ownership and observability justify widening them.
- Preserve the multi-plane split: Supabase hot-state, Obsidian semantic ownership, GitHub artifact/review plane.

### Longer-Horizon Actions

1. **[M-22] Enable local `muelUnified` MCP entry** — Add unified server to `.vscode/mcp.json` as a local stdio option (not just SSH GCP). This dramatically improves local dev loop for IDE agents.

2. **[M-22] External adapter utilization to 80%** — Identify which adapters are flaky and add integration tests or health page docs. Focus on NemoClaw and n8n.

3. **[M-23] Doc consolidation** — Merge `docs/archive/` documents that have valuable content into living docs. Remove or timestamp-archive the rest.

4. **[M-24] Channel ingress abstraction** — Keep the current Discord/OpenClaw ingress as the first adapter, but split ingress normalization from runtime routing so a future Chat SDK surface can reuse the same policy, fallback, and state-ownership boundaries. Hermes remains the complementary continuity lane, not a competing primary ingress.

5. **[Phase I] Synthesis layer** — Implement intent → multi-agent plan synthesis. This is the missing link between "observing problems" and "deciding what to do about them".

6. **[Phase J] MetaCognition** — System-level self-evaluation. Once Phase I is stable, add weekly system efficiency scoring and strategy adjustment.
