---
description: "Sprint Phase: Ship — sync main, run all tests, audit coverage, create PR or deploy. Final gate before production."
applyTo: "**"
---

# /ship

> All gates passed. Ship it.

## When to Use

- All prior sprint phases (plan → implement → review → qa → ops-validate) passed
- Ready to create PR, merge, or deploy
- Need automated pre-ship checklist

## Lead Agent

`operate` (operate role — release engineering)

## Process

1. **Sync** — rebase or merge latest main; resolve conflicts if any.
2. **Full test suite** — `vitest run` + `tsc --noEmit`.
3. **Coverage audit** — ensure no coverage regression vs main.
4. **PR creation** — structured PR body with sprint trace, phase results, test summary.
5. **Deploy trigger** — if autonomy level permits and CI passes.

## Inputs

| Field         | Required | Description                     |
| ------------- | -------- | ------------------------------- |
| sprint_id     | yes      | Sprint pipeline identifier      |
| phase_results | yes      | Summary of all completed phases |
| branch_name   | no       | Branch to ship from             |

## Output Contract

```
- Test results summary (pass/fail/skip counts)
- Coverage delta vs main
- PR URL or deploy status
- Sprint completion summary
- Recommended next skill: /retro
```

## Safety

- Never force-push or skip CI.
- PR body must include: sprint ID, phases completed, test results, review findings resolved.
- Require human approval unless autonomyLevel is `full-auto`.
- Rollback plan must be documented in PR body.

## Next Skills

| Condition         | Next            |
| ----------------- | --------------- |
| PR created/merged | `/retro`        |
| CI fails          | `/qa` (re-test) |
| Deploy fails      | `/ops-validate` |

## Runtime Counterpart

- Action: `release.ship`
- Discord intent: `ship|release|배포|릴리스|PR`
- Worker env: `MCP_RELEASE_WORKER_URL`
