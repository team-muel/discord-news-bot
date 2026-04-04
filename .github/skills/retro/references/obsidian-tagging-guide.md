# Obsidian Tagging and Linking Guide

> Load when storing retro or plan documents in the Obsidian vault.

## Tag Conventions

| Tag | Usage |
|---|---|
| `#retro` | All retrospective documents |
| `#sprint-{id}` | Link to specific sprint pipeline |
| `#lessons-learned` | Insights worth referencing later |
| `#adr` | Architecture Decision Records |
| `#incident` | Post-incident reviews |
| `#plan` | Plan documents |
| `#security` | Security-related findings |

## Backlink Patterns

- Retro → link to original `/plan` output document
- Retro → link to `/review` findings that surfaced issues
- Retro → link to related previous retros (pattern detection)
- Plan → link to ADR that informed the decision
- Incident → link to retro that followed

## File Naming

```
retros/YYYY-MM-DD_retro_<sprint-description>.md
plans/YYYY-MM-DD_plan_<objective>.md
docs/adr/YYYY-MM-DD_<decision-title>.md
```

## Graph-First Retrieval

- Prefer following link graph over keyword search
- When retrieving context, start from the most recent related node and walk links
- Respect `OBSIDIAN_RAG_CACHE_TTL_MS` for cached retrievals
- Use `audit-obsidian-graph.ts` to verify link integrity
