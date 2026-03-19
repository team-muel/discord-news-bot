---
description: "Use when triaging tasks across OpenCode, NemoClaw, OpenJarvis, and OpenDev; enforce deterministic routing and handoff contracts."
---

# Multi-Agent Routing Instruction

## Goal

Route each task through a predictable sequence with minimal ambiguity.

## Routing Modes

Delivery mode (feature or code change):

1. OpenDev: define target state, constraints, and milestone slice.
2. OpenCode: implement the smallest safe change set.
3. NemoClaw: review for regressions, security, and test gaps.
4. OpenJarvis: validate operational readiness, rollback, and unattended safety.

Operations mode (incident, release, recovery):

- OpenJarvis classifies first, then routes by ownership and risk.

## Classification Rules

- `architecture`, `roadmap`, `ADR`, `trade-off` -> OpenDev first.
- `implement`, `refactor`, `bugfix`, `test` -> OpenCode first.
- `review`, `risk`, `regression`, `security` -> NemoClaw first.
- `workflow`, `runbook`, `deployment`, `automation`, `rollback` -> OpenJarvis first.

## Shared Payload Contract

Every stage payload must include:

- `task_id`
- `guild_id`
- `objective`
- `constraints`
- `risk_level`
- `acceptance_criteria`
- `inputs`
- `budget`

## Handoff Contract

Every stage must emit:

- Scope and non-goals
- Changed files or touched surfaces
- Validation commands and outcomes
- Risks, rollback path, and next owner

## Hard Gates

- Do not degrade startup/auth/scheduler reliability.
- Preserve graph-first Obsidian retrieval behavior.
- Sanitize user-facing Discord deliverables, including wrapped deliverable sections.
- Keep workflows and scripts idempotent.
