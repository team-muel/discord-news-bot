# Discord News Bot Copilot Instructions

## Mission

Keep the platform stable while shipping fast improvements for Discord operations, knowledge retrieval, and automation.

## Core Priorities

1. Reliability first: avoid changes that can break bot startup, auth, or scheduled automation.
2. Graph-first context strategy: prefer Obsidian link graph retrieval patterns over chunk-first RAG defaults.
3. Security by default: never print or commit secrets from environment variables.
4. Small safe changes: preserve existing APIs unless migration is explicit.

## Working Rules

- Prefer targeted edits with tests where possible.
- For risky edits, add guardrails and fail-safe behavior.
- Keep docs in sync when changing behavior that impacts operators.
- Keep workflows and scripts idempotent for unattended runs.

## Internal Naming Boundary

- Legacy names such as OpenCode, OpenDev, NemoClaw, OpenJarvis, and Local Orchestrator are repository-local collaboration/runtime labels.
- They do not prove that similarly named external OSS frameworks or model stacks are installed or directly executed.
- Prefer neutral internal naming in new docs and prompts, and refer to runtime-configured providers/actions/workers for executable truth.
- Canonical naming and runtime surface source of truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`.
- Naming migration and compatibility policy: `docs/ROLE_RENAME_MAP.md`.

## Agent Routing Guidance

- OpenCode: coding, refactor, and tests.
- NemoClaw: review, risk analysis, and regression hunting.
- OpenJarvis: operations, runbooks, workflows, and unattended automation.
- OpenDev: architecture, roadmap, ADR, and decomposition plans.

Local IDE collaboration default:

- Prefer a lead agent plus targeted consults instead of forcing a full sequential handoff.
- Keep release-sensitive work on the formal multi-agent workflow below.
- Treat agent roles as primary strengths, not hard isolation boundaries, during local development.

## Multi-Agent Workflow

Local collaborative track (default for IDE iteration):

1. Pick the best lead agent for the current dominant task.
2. Consult up to two specialist agents when architecture, review, or ops concerns matter.
3. Synthesize back into one owner before editing, validating, or responding.
4. Escalate to the delivery or operations track when formal gates are required.

Delivery track (feature or code change):

1. OpenDev defines target state, constraints, and phased milestones.
2. OpenCode implements the smallest safe slice for the current milestone.
3. NemoClaw reviews for correctness, regressions, security, and test gaps.
4. OpenJarvis validates operational readiness, rollback, and unattended safety.

Operations track (incident, recover, release):

- OpenJarvis classifies `discover|implement|verify|release|recover` first.
- Route to the owning agent based on classification and risk policy.

If any step fails quality gates, return to OpenCode with precise findings and re-run the sequence.

## Handoff Contract

Each agent handoff should include:

- Scope and non-goals
- Changed files and expected behavior impact
- Validation run and results
- Known risks, rollback path, and follow-up tasks

Required identifiers in every stage payload:

- `task_id`
- `guild_id`
- `objective`
- `constraints`
- `risk_level`
- `acceptance_criteria`
- `inputs`
- `budget`

## Release Gate Checklist

- Startup/auth/scheduler safety not degraded
- Obsidian graph-first retrieval behavior preserved
- Discord output sanitization verified for deliverable wrappers
- Workflow/script idempotency and rollback path documented

## Repo-Specific Notes

- In multi-agent logic, ensure helper signatures match current implementations.
- Sanitize user-facing Discord outputs, including wrapped deliverable sections.
- Keep Obsidian CLI and headless roles explicit in docs and release gates.
