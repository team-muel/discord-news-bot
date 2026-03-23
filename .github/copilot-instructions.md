# Discord News Bot Copilot Instructions

## Mission

Keep the platform stable while shipping fast improvements for Discord operations, knowledge retrieval, and automation — with autonomous sprint pipelines that can plan, implement, review, test, and ship changes.

## Core Priorities

1. Reliability first: avoid changes that can break bot startup, auth, or scheduled automation.
2. Graph-first context strategy: prefer Obsidian link graph retrieval patterns over chunk-first RAG defaults.
3. Security by default: never print or commit secrets from environment variables.
4. Small safe changes: preserve existing APIs unless migration is explicit.
5. Sprint-flow discipline: follow the phase order (plan → implement → review → qa → ops-validate → ship → retro).

## Working Rules

- Prefer targeted edits with tests where possible.
- For risky edits, add guardrails and fail-safe behavior.
- Keep docs in sync when changing behavior that impacts operators.
- Keep workflows and scripts idempotent for unattended runs.

## Internal Naming Boundary

- Role names (OpenCode, OpenDev, NemoClaw, OpenJarvis) are repository-local collaboration labels.
- They do not prove that similarly named external OSS frameworks are installed or directly executed.
- Canonical naming: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`, `docs/ROLE_RENAME_MAP.md`.

## Sprint Skills (gstack-inspired)

Available skills in sprint order:
`/plan`, `/implement`, `/review`, `/qa`, `/security-audit`, `/ops-validate`, `/ship`, `/retro`

Each skill has a SKILL.md in `.github/skills/{name}/` defining:

- When to use, process steps, input/output contract
- Runtime action mapping for production execution
- Next skill transitions

Sprint flow: `plan → implement → review → qa → ops-validate → ship → retro`

Phase → Lead Agent:

- `/plan` → OpenDev (architect)
- `/implement` → OpenCode (implement)
- `/review` → NemoClaw (review)
- `/qa` → OpenCode (QA execution)
- `/security-audit` → NemoClaw (security)
- `/ops-validate` → OpenJarvis (operations)
- `/ship` → OpenJarvis (release)
- `/retro` → OpenDev (reflection)

## Autonomous Execution

The production runtime can autonomously:

- Detect runtime errors and trigger bugfix sprints
- Classify CS tickets and trigger feature/fix sprints
- Run scheduled security audits and code improvement sprints
- Create branches, commit changes, and open PRs via GitHub API

Autonomy is governed by guild-level policy (`SPRINT_AUTONOMY_LEVEL`):

- `full-auto`: all phases auto (use cautiously)
- `approve-ship`: ship requires approval (recommended default)
- `approve-impl`: implement + ship require approval
- `manual`: all phases require approval

## Release Gate Checklist

- Startup/auth/scheduler safety not degraded
- Obsidian graph-first retrieval behavior preserved
- Discord output sanitization verified for deliverable wrappers
- Workflow/script idempotency and rollback path documented
- Sprint changed file cap not exceeded
- All sprint phases passed before ship

## Repo-Specific Notes

- Runtime sprint state persists to Supabase table `sprint_pipelines`.
- Sprint pipeline uses existing `actionRunner` with governance gates, FinOps budgets, and circuit breakers.
- Sanitize user-facing Discord outputs, including wrapped deliverable sections.
- Keep Obsidian CLI and headless roles explicit in docs and release gates.
