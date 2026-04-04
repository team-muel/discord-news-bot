# PR Body Template

> Load when creating a PR from /ship phase.

## Template

```markdown
## Summary

<one-paragraph description of what changed and why>

## Sprint Trace

- Sprint ID: `<id>`
- Phases completed: plan → implement → review → qa → ops-validate → ship
- Implement↔review loops: <count>

## Changes

| File | Change Type | Description |
|---|---|---|
| `path/to/file.ts` | modified | <what changed> |

## Test Results

- `tsc --noEmit`: ✅ pass
- `vitest run`: ✅ <pass>/<total> passed, <skip> skipped
- Coverage delta: +/- <n>%

## Review Findings Resolved

- [ ] <finding from /review, with resolution>

## Rollback Plan

<how to undo this change if issues detected post-deploy>

## Release Gate Checklist

- [ ] Startup/auth/scheduler safety not degraded
- [ ] Obsidian graph-first retrieval preserved
- [ ] Discord output sanitization verified
- [ ] Workflow/script idempotency verified
- [ ] Sprint changed file cap not exceeded
```

## Commit Message Convention

```
<type>(<scope>): <description>

Types: feat, fix, refactor, test, docs, ops, security
Scope: service name, command name, or "sprint"
```
