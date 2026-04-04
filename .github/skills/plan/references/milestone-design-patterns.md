# Milestone Design Patterns

> Load when structuring implementation milestones in a /plan.

## Principles

- Each milestone must yield **deployable value** — no "setup-only" milestones
- Dependencies between milestones must be explicit
- Every milestone has entry criteria (what must be true before starting) and exit criteria (what must be true to call it done)

## Milestone Sizing

| Size | LOC | Duration | Risk |
|---|---|---|---|
| XS | <50 | Single session | Low |
| S | 50-200 | 1-2 sessions | Low-Medium |
| M | 200-500 | 2-4 sessions | Medium |
| L | 500+ | Split into multiple milestones | High |

Prefer XS-S milestones. If a milestone exceeds M, split it.

## Template

```markdown
### Milestone N: <verb> <object>

**Entry criteria**: <what must be true>
**Exit criteria**: <what must be true when done>
**Files**: <expected file changes>
**Risk**: <low/medium/high> — <why>
**Dependencies**: <milestone refs or external>
**Rollback**: <how to undo if needed>
```

## Anti-Patterns

- "Prepare infrastructure" milestone with no user-visible change
- Milestone that touches 10+ files (split it)
- Missing rollback path for database changes
- Circular dependencies between milestones
