---
description: "Sprint Phase: Build — implement the smallest safe change set from a plan or bug report. Focused on TypeScript/Node.js production code, tests, and type safety."
applyTo: "**"
---

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

1. **Scope the patch** — identify the minimal file set from the plan or bug report.
2. **Implement** — make the smallest valid change; preserve existing contracts unless explicitly required.
3. **Validate locally** — run `tsc --noEmit` and relevant test suites.
4. **Document changes** — what changed, why, how validated, remaining risk.
5. **Hand off** — pass to `/review` for defensive review.

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

## Runtime Counterpart

- Action: `implement.execute` (legacy: `opencode.execute`)
- Discord intent: `implement|refactor|bugfix|test|구현|리팩터`
- Worker env: `MCP_IMPLEMENT_WORKER_URL` (legacy: `MCP_OPENCODE_WORKER_URL`)
