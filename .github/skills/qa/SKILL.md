---
description: "Sprint Phase: QA — test the running application, find bugs, fix them with atomic commits, re-verify. Auto-generates regression tests."
applyTo: "**"
---

# /qa

> Test it. Find what's broken. Fix it. Prove it stays fixed.

## When to Use

- After `/review` passes with no critical findings
- Testing running app behavior (not just static analysis)
- Verifying Discord bot commands, API endpoints, automation flows
- Regression testing after bugfix

## Lead Agent

`implement` (implement role — QA execution requires code-level verification)

## Process

1. **Identify test targets** — map changed behavior to testable surfaces (routes, commands, services).
2. **Execute tests** — run `vitest`, `scripts/smoke-api.mjs`, endpoint verification.
3. **Find bugs** — log discrepancies between expected and actual behavior with reproduction steps.
4. **Fix** — atomic commits per bug, minimal blast radius.
5. **Regression test** — generate new test case for each fix found.
6. **Re-verify** — ensure fix doesn't break existing tests (`vitest run`).

## Inputs

| Field          | Required | Description                            |
| -------------- | -------- | -------------------------------------- |
| changed_files  | yes      | Files to test against                  |
| review_summary | no       | Output from `/review` phase            |
| test_targets   | no       | Specific routes, commands, or services |

## Output Contract

```
- Test execution results (pass/fail counts, duration)
- Bugs found with reproduction steps
- Fixes applied with atomic commit references
- New regression tests generated (file paths)
- Recommended next skill: /ops-validate or /ship
```

## Guardrails

- Do not skip existing test suites — always run full suite after changes.
- Each bug fix must have a corresponding test before marking resolved.
- Never modify test assertions to match broken behavior.

## Next Skills

| Condition          | Next                        |
| ------------------ | --------------------------- |
| All tests pass     | `/ops-validate`             |
| Bugs found & fixed | `/review` (re-review fixes) |
| Unfixable issues   | `/plan` (re-scope)          |

## Runtime Counterpart

- Action: `qa.test`
- Discord intent: `test|qa|테스트|검증|확인`
- Worker env: `MCP_QA_WORKER_URL`
