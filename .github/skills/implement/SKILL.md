---
description: "Sprint Phase: Build — implement the smallest safe change set from a plan or bug report. Focused on TypeScript/Node.js production code, tests, and type safety."
applyTo: "src/**"
---

<!-- Token Budget: ~400 base, ~1,200 with references -->

# /implement

> Ship the smallest valid change. Verify before moving on.

## When to Use

- Writing or modifying production code
- Refactoring for readability and maintainability
- Adding or updating unit and integration tests
- Fixing compile, lint, or runtime errors
- Implementing a milestone slice from `/plan` output

## Lead Agent

`implement` (implement role)

## Process

1. **Reuse gate** — search the existing codebase for services/functions that overlap with the objective. If an existing file covers 70%+ of the need, extend it. Cite 3 files searched and why none suffice before creating any new file.
2. **Scope the patch** — identify the minimal file set from the plan or bug report. New files per sprint are capped (default: 3, enforced by scope guard).
3. **Implement** — make the smallest valid change; preserve existing contracts unless explicitly required.
4. **Validate locally** — run `tsc --noEmit` and relevant test suites.
5. **Document changes** — what changed, why, how validated, remaining risk.
6. **Hand off** — pass to `/review` for defensive review.

## Inputs

| Field         | Required | Description                              |
| ------------- | -------- | ---------------------------------------- |
| objective     | yes      | What to implement                        |
| plan_ref      | no       | Reference to `/plan` output or milestone |
| changed_files | no       | Pre-identified file targets              |

## Output Contract

```
- Changed files list
- Patch summary (what and why)
- Validation results (typecheck, tests)
- Known risks and remaining work
- Recommended next skill: /review
```

## Guardrails

- **Reuse over creation**: extending an existing 500-line file is almost always better than creating a new 200-line file. New abstractions must justify their existence.
- New files per sprint are hard-capped by `SPRINT_NEW_FILE_CAP` (default: 3, enforced by `scopeGuard.checkNewFileCreation`). Test files don't count.
- Do not perform unrelated refactors.
- Prefer `muelIndexing` MCP tools for symbol discovery before broad text search.
- Escalate architectural reshaping to `/plan` before broad refactors.
- Backward compatibility check for public bot or API behavior.

## Next Skills

| Condition                      | Next            |
| ------------------------------ | --------------- |
| Implementation complete        | `/review`       |
| Architecture questions surface | `/plan`         |
| Operational concerns surface   | `/ops-validate` |

## HITL Decision

### Act (proceed without asking)

- Fixing typecheck or lint errors
- Adding or updating tests for existing behavior
- Renaming internal variables or functions
- Applying a fix explicitly described in `/review` findings

### Ask (confirm before proceeding)

- Changing public API signatures or Discord command options
- Creating or modifying database migrations
- Deleting files or removing exports
- Adding new external dependencies
- Changing env var names or defaults in `config.ts`

## References

Loaded on demand — not part of initial SKILL.md context:

- `references/backward-compat-checklist.md` — when touching public APIs or shared contracts
- `references/test-patterns.md` — when writing or modifying Vitest tests

## Runtime Counterpart

- Action: `implement.execute` (legacy: `opencode.execute`)
- Discord intent: `implement|refactor|bugfix|test|구현|리팩터`
- Worker env: `MCP_IMPLEMENT_WORKER_URL` (legacy: `MCP_OPENCODE_WORKER_URL`)
