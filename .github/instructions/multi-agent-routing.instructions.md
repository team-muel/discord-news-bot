---
description: "Use when triaging tasks across OpenCode, NemoClaw, OpenJarvis, and OpenDev; enforce deterministic routing and handoff contracts."
---

# Multi-Agent Routing Instruction

## Goal

Route each task through the right collaboration mode with minimal ambiguity.

Boundary note:

- OpenCode, OpenDev, NemoClaw, OpenJarvis, and Local Orchestrator are collaboration roles used by this repository's local IDE workflow
- matching role names do not imply direct installation or embedding of upstream open-source systems
- actual execution support must be confirmed through runtime actions, worker configuration, and operator endpoints in the repository runtime
- similarly named external frameworks and model stacks must be treated as separate systems unless explicitly integrated by runtime configuration

Canonical naming and runtime surface source of truth:

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- `docs/ROLE_RENAME_MAP.md`

## Routing Modes

Local collaborative mode (IDE-first exploration and development):

1. Select one lead agent based on the dominant task shape.
2. Allow up to two consult agents in parallel for architecture, review, or ops input.
3. Return to the lead agent for synthesis and next action.
4. Escalate to delivery mode only when the task becomes release-sensitive or spans multiple risk domains.

Delivery mode (feature or code change):

1. OpenDev: define target state, constraints, and milestone slice.
2. OpenCode: implement the smallest safe change set.
3. NemoClaw: review for regressions, security, and test gaps.
4. OpenJarvis: validate operational readiness, rollback, and unattended safety.

Operations mode (incident, release, recovery):

- OpenJarvis classifies first, then routes by ownership and risk.

Mode selection rule:

- Use `local-collab` by default for local IDE work, brainstorming, iterative implementation, and mixed architecture-plus-code tasks.
- Use `delivery` when the user requests a release-grade execution sequence, PR-ready changes, or formal stage gates.
- Use `operations` for incidents, unattended automation, releases, rollbacks, and recovery workflows.

## Classification Rules

- `architecture`, `roadmap`, `ADR`, `trade-off` -> OpenDev first.
- `implement`, `refactor`, `bugfix`, `test` -> OpenCode first.
- `review`, `risk`, `regression`, `security` -> NemoClaw first.
- `workflow`, `runbook`, `deployment`, `automation`, `rollback` -> OpenJarvis first.

## Collaboration Rules

- In `local-collab`, treat agent specialties as primary strengths, not exclusive ownership.
- A lead agent may consult another agent without surrendering ownership of the task.
- Prefer consult patterns such as `OpenCode + OpenDev`, `OpenCode + NemoClaw`, `OpenJarvis + NemoClaw`, or `OpenDev + OpenJarvis` when the task spans design, implementation, safety, and ops.
- Do not force a full sequential handoff unless the task is explicitly release-sensitive.
- When consult input conflicts, the lead agent must synthesize the trade-off and choose the next step explicitly.

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

For `local-collab`, also include:

- Lead agent
- Consulted agents and why they were consulted
- Whether escalation to `delivery` or `operations` mode is now required

Preferred structured output fields across prompts:

- `lead_agent`: current owner plus ownership reason
- `consult_agents`: optional specialist inputs with timing and purpose
- `required_gates`: checks required before release or escalation
- `handoff`: next owner, why, and expected outcome
- `escalation`: whether the task should move to `delivery` or `operations`
- `next_action`: immediate action for the current owner

## Hard Gates

- Do not degrade startup/auth/scheduler reliability.
- Preserve graph-first Obsidian retrieval behavior.
- Sanitize user-facing Discord deliverables, including wrapped deliverable sections.
- Keep workflows and scripts idempotent.
