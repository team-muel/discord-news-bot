---
description: "Obsidian write-path rules — sanitization gate, frontmatter requirements, adapter routing, and vault path safety."
applyTo: "src/services/obsidian/**"
---

# Obsidian Write Domain Rules

> Loaded automatically when editing Obsidian services.

## Write Path

- **All writes** must go through `writeObsidianNoteWithAdapter()` in `router.ts`.
- **Never** call adapter `writeNote()` directly — the router enforces sanitization and fallback.

## Sanitization Gate

- `sanitizeForObsidianWrite()` is called automatically by the router.
- Content below 20 characters is blocked (returns `null`, logged as warning).
- Do not add "trusted" bypass paths — all content is sanitized equally.

## Frontmatter

Every note must include YAML frontmatter:
```yaml
---
title: "<note title>"
created: "<ISO 8601>"
source: "<origin service>"
tags: [...]
guild_id: "<guild ID>"
---
```

## Vault Path

- `OBSIDIAN_VAULT_PATH` defaults to empty string — all writes are silent no-ops without it.
- Paths must be sanitized: no `..`, no absolute paths outside vault root.
- File names must be cross-OS safe (no `:`, `?`, `*`, `<`, `>`, `|`).

## Retrieval Strategy

- Graph-first: link graph traversal + tag filtering (default)
- Hybrid: graph + vector similarity (when graph yields < 3 results)
- Semantic-only: pgvector cosine similarity (when no vault configured)
- Strip wikilinks `[[note]]` before Discord responses.

## Cross-Domain Contract

Full specification: `docs/contracts/MEMORY_TO_OBSIDIAN.md` and `docs/contracts/OBSIDIAN_READ_LOOP.md`
