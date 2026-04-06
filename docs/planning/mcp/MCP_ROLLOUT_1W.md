# MCP Rollout Plan (1 Week)

> **Status: Complete (2026-03-18 → 2026-03-25)** — Initial rollout finished. See iteration notes below.

## Goal

Ship a production-safe MCP bridge for Muel with governance controls and observability.

## Day 1 - Contract Freeze ✅

- Finalized tool names, inputs, outputs.
- Froze error code style and compatibility policy.
- Published `MCP_TOOL_SPEC.md`.

## Day 2 - Runtime Integration ✅

- Wired MCP server startup script and local smoke tests.
- Validated stock/analysis/action tools with real env.
- Added baseline logs for tool calls.

## Day 3 - Safety Hardening ✅

- Enforced tenant context requirement.
- Restricted direct action execution to approved scopes.
- Verified allowlist and approval queue interaction.

## Day 4 - SRE Guardrails ✅

- Defined SLO for MCP tool latency/success.
- Added alert thresholds (error burst, timeout burst).
- Added runbook section for MCP incident response.

## Day 5 - Staging Drill ✅

- Ran canary traffic in staging.
- Executed failure injection:
  - upstream timeout
  - invalid tool args
  - policy-denied execution
- Validated rollback playbook.

## Day 6 - Production Canary ✅

- Enabled for small admin cohort.
- Monitored tool success and approval queue behavior.
- Kept fallback route to existing bot/API flow.

## Day 7 - General Availability Gate ✅

- Reviewed KPIs and incident logs.
- Decided GA.
- Published post-rollout report and next-iteration backlog.

## Exit Criteria ✅

- No sev incident during canary window ✅
- Tool success rate >= 99% for safe tools ✅
- Approval-required actions have auditable lifecycle ✅
- Rollback tested and documented ✅

---

## Iteration 2 (2026-04-05+)

### New in This Iteration

1. **Multi-server architecture**: muelCore + muelIndexing + gcpCompute (SSH) + Supabase + DeepWiki
2. **Obsidian tool adapter**: 20+ tools for vault read/write/RAG operations
3. **ext.* adapter bridge**: 8 external adapters exposed as MCP tools via `unifiedToolAdapter.ts`
4. **`diag.llm` tool**: LLM connectivity diagnostic added to muelCore (v2 spec)
5. **Unified MCP server**: `src/mcp/unifiedServer.ts` for full-catalog access via SSH to GCP VM

### Next Iteration Targets

- `muelUnified` local entry in `.vscode/mcp.json` (currently only available via SSH gcpCompute)
- Auth context propagation for tenant-scoped tool calls
- Per-tool rate limiting and quota enforcement
- Tool call observability dashboard (success rate, p95 latency per tool)

