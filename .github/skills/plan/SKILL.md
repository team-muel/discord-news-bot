---
description: "Sprint Phase: Plan — define target state, constraints, architecture, and phased milestones before implementation begins. Replaces the heavyweight OpenDev delivery gate with a direct-invoke planning skill."
applyTo: "**"
---

# /plan

> Think first. Define the target before touching code.

## When to Use

- Starting a new feature or significant change
- Turning a vague goal into a phased implementation plan
- Defining boundaries between services, agents, or modules
- Writing or updating ADR and strategy documentation
- Evaluating trade-offs across cost, speed, and reliability

## Lead Agent

`opendev` (architect role)

## Process

1. **Clarify the problem** — reframe the user's request into a concrete objective with non-goals.
2. **Map current state** — use `muelIndexing` context bundles and file outlines to understand existing boundaries.
3. **Define target state** — architecture, data flow, API contracts, and ownership boundaries.
4. **Sequence milestones** — each milestone must yield deployable value; name dependencies, decision owners, and gating assumptions.
5. **Risk assessment** — migration safety, rollback, data integrity, and blast radius.
6. **Output the plan** — structured plan document with entry/exit criteria per milestone.

## Inputs

| Field         | Required | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| objective     | yes      | What we are building or changing             |
| constraints   | no       | Budget, timeline, compatibility requirements |
| current_state | no       | Existing architecture or behavior summary    |

## Output Contract

```
- Objective and non-goals
- Current state summary
- Target state architecture
- Milestones with entry/exit criteria
- Risks, dependencies, and mitigation plan
- Recommended next skill: /implement or /review
```

## Next Skills

| Condition                 | Next              |
| ------------------------- | ----------------- |
| Plan approved             | `/implement`      |
| Plan needs risk review    | `/security-audit` |
| Plan needs ops validation | `/ops-validate`   |

## Runtime Counterpart

- Action: `opendev.plan`
- Discord intent: `architecture|adr|boundary|plan|설계|아키텍처`
- Worker env: `MCP_OPENDEV_WORKER_URL`

## Obsidian Integration

- Store approved plans in Obsidian vault under `plans/` with backlink tags
- Prefer graph-first retrieval for related prior decisions
