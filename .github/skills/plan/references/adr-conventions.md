# ADR Conventions

> Load when writing or updating Architecture Decision Records.

## Storage

- ADRs live in `docs/adr/` with date prefix: `YYYY-MM-DD_<title>.md`
- Link from Obsidian vault for graph-first retrieval

## Template

```markdown
# ADR: <Title>

**Date**: YYYY-MM-DD
**Status**: proposed | accepted | superseded by [ADR-xxx]
**Deciders**: <who>

## Context

What is the issue that we're seeing that is motivating this decision?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?

## Alternatives Considered

What other options were evaluated? Why were they rejected?
```

## Linking

- Reference related ADRs with relative links: `[ADR: xxx](./YYYY-MM-DD_xxx.md)`
- Tag in Obsidian: `#adr`, `#architecture`, `#decision`
- Backlink from `/plan` outputs and `/retro` summaries
