---
description: "Sprint-flow skill routing for autonomous agent pipelines — use when triaging tasks across sprint phases."
---

# Sprint Pipeline Routing

## Goal

Route tasks through sprint phases with deterministic flow and clear safety gates.

## Default Sprint Flow

```
/plan → /implement → /review → /qa → /ops-validate → /ship → /retro
```

## Conditional Phase Insertions

- `/security-audit`: inserted between `/review` and `/qa` when high-risk content is detected
- Implement↔review loop: up to `SPRINT_MAX_IMPL_REVIEW_LOOPS` (default 3) iterations when review finds critical issues

## Phase → Lead Agent Mapping

| Phase             | Lead Agent | Runtime Action      |
| ----------------- | ---------- | ------------------- |
| `/plan`           | Architect  | `architect.plan`    |
| `/implement`      | Implement  | `implement.execute` |
| `/review`         | Review     | `review.review`     |
| `/qa`             | Implement  | `qa.test`           |
| `/security-audit` | Review     | `cso.audit`         |
| `/ops-validate`   | Operate    | `operate.ops`       |
| `/ship`           | Operate    | `release.ship`      |
| `/retro`          | Architect  | `retro.summarize`   |

## Autonomy Levels

| Level          | plan         | implement    | review       | qa           | ship         |
| -------------- | ------------ | ------------ | ------------ | ------------ | ------------ |
| `full-auto`    | auto         | auto         | auto         | auto         | auto         |
| `approve-ship` | auto         | auto         | auto         | auto         | **approval** |
| `approve-impl` | auto         | **approval** | auto         | auto         | **approval** |
| `manual`       | **approval** | **approval** | **approval** | **approval** | **approval** |

Default: `approve-ship` — safest balance of automation and human oversight.

## Trigger Types

- `manual`: user invokes via Discord command or API
- `error-detection`: runtime error pattern threshold exceeded
- `cs-ticket`: CS channel message classified as bug-report or feature-request
- `scheduled`: cron-based security audit or self-improvement
- `self-improvement`: retro pattern analysis triggers targeted fix sprint

## IDE Usage

Each skill can be invoked directly from the IDE:

- Every SKILL.md in `.github/skills/` defines when to use, process, and output contract
- The "Next Skills" table in each SKILL.md serves as the routing guide
- No complex mode selection or consult patterns required — sprint order is the guide

## Runtime Usage

- `sprintOrchestrator` executes phases sequentially via `actionRunner`
- Each phase uses the existing governance gates, FinOps budgets, and circuit breakers
- Git operations (branch/commit/PR) are handled by `autonomousGit` when `SPRINT_GIT_ENABLED=true`
- Pipeline state persists to Supabase table `sprint_pipelines`

## Safety Guardrails

- Changed file cap per sprint: `SPRINT_CHANGED_FILE_CAP` (default 10)
- Phase timeout: `SPRINT_PHASE_TIMEOUT_MS` (default 120s)
- Total phase execution limit: `SPRINT_MAX_TOTAL_PHASES` (default 12)
- Protected branches (main/master/production) cannot be modified directly
- All code changes go through branch → PR → merge flow

## Boundary Note

Role names (Implement, Architect, Review, Operate) are repository-local collaboration labels describing function.
They do not imply installation of similarly named external OSS frameworks (NVIDIA NemoClaw, Stanford OpenJarvis, etc.).
Runtime integration exists only where registered actions and configured workers are present.

## Hard Gates

- Do not degrade startup/auth/scheduler reliability.
- Preserve graph-first Obsidian retrieval behavior.
- Sanitize user-facing Discord deliverables, including wrapped deliverable sections.
- Keep workflows and scripts idempotent.
