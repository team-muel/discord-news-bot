---
description: "Sprint Phase: Review — find bugs that pass CI but break in production. Auto-fix obvious issues, flag completeness gaps, and verify release safety."
applyTo: "**"
---

# /review

> Find the bugs that pass CI but blow up in production.

## When to Use

- Code review for any branch with changes
- Hunting regressions after refactors
- Validating edge cases and failure paths
- Pre-release defensive review
- Quick consult during `/implement` for risk shaping

## Lead Agent

`review` (review role)

## Process

1. **Gather context** — use `muelIndexing` symbol definitions, references, and scope reads to understand the change surface.
2. **Review priorities** — in this order:
   - Correctness and runtime safety
   - Security and secret exposure risk
   - Backward compatibility and migration safety
   - Test coverage gaps
   - Operational risk and observability impact
3. **Evidence-backed findings** — include file/line references, minimal reproduction path for concrete bugs.
4. **Auto-fix** — fix obvious issues directly (typos, missing null checks, trivial type errors).
5. **Flag** — mark uncertain points as assumptions or open questions; confirm startup/auth/scheduler paths remain safe.

## Inputs

| Field         | Required | Description                     |
| ------------- | -------- | ------------------------------- |
| changed_files | yes      | Files to review                 |
| patch_summary | no       | Summary of what changed and why |
| risk_level    | no       | low / medium / high             |

## Output Contract

```
- Findings ordered by severity (high → low)
- File and line references for each finding
- Auto-fixed items with explanation
- Proposed fix options for high-severity issues
- Test gaps identified
- Explicit "no critical findings" when clean
- Recommended next skill: /qa or /ship
```

## Next Skills

| Condition            | Next                                 |
| -------------------- | ------------------------------------ |
| No critical findings | `/qa` or `/ship`                     |
| Critical findings    | `/implement` (with precise findings) |
| Security concerns    | `/security-audit`                    |
| Operational concerns | `/ops-validate`                      |

## Runtime Counterpart

- Action: `review.review` (legacy: `nemoclaw.review`)
- Discord intent: `review|regression|risk|security|리뷰|회귀|보안`
- Worker env: `MCP_REVIEW_WORKER_URL` (legacy: `MCP_NEMOCLAW_WORKER_URL`)
