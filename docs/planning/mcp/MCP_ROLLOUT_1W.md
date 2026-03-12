# MCP Rollout Plan (1 Week)

## Goal

Ship a production-safe MCP bridge for Muel with governance controls and observability.

## Day 1 - Contract Freeze

- Finalize tool names, inputs, outputs.
- Freeze error code style and compatibility policy.
- Publish `MCP_TOOL_SPEC.md`.

## Day 2 - Runtime Integration

- Wire MCP server startup script and local smoke tests.
- Validate stock/analysis/action tools with real env.
- Add baseline logs for tool calls.

## Day 3 - Safety Hardening

- Enforce tenant context requirement.
- Restrict direct action execution to approved scopes.
- Verify allowlist and approval queue interaction.

## Day 4 - SRE Guardrails

- Define SLO for MCP tool latency/success.
- Add alert thresholds (error burst, timeout burst).
- Add runbook section for MCP incident response.

## Day 5 - Staging Drill

- Run canary traffic in staging.
- Execute failure injection:
  - upstream timeout
  - invalid tool args
  - policy-denied execution
- Validate rollback playbook.

## Day 6 - Production Canary

- Enable for small admin cohort.
- Monitor tool success and approval queue behavior.
- Keep fallback route to existing bot/API flow.

## Day 7 - General Availability Gate

- Review KPIs and incident logs.
- Decide GA vs extended canary.
- Publish post-rollout report and next-iteration backlog.

## Exit Criteria

- No sev incident during canary window
- Tool success rate >= 99% for safe tools
- Approval-required actions have auditable lifecycle
- Rollback tested and documented
