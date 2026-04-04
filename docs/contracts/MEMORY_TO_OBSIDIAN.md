# Domain Contract: Memory → Obsidian

> Defines the required data transformations when memory items flow into the Obsidian vault.

## Boundary

- **Source**: `src/services/memory/` (consolidation, evolution), `src/services/skills/actions/agentCollab.ts`
- **Sink**: `src/services/obsidian/router.ts` → adapter chain → vault files
- **Gate**: `sanitizeForObsidianWrite()` in `src/services/obsidian/router.ts`

## Required Transformations

### 1. Sanitization Gate (Mandatory)

ALL content written to Obsidian MUST pass through the centralized sanitization gate in `writeObsidianNoteWithAdapter()`.

```ts
// router.ts — the ONLY write entry point
import { sanitizeForObsidianWrite } from "./obsidianSanitizationWorker.js";
```

The gate:
- Strips dangerous Markdown injection patterns
- Removes potential prompt injection markers
- Validates minimum content length (20 chars)
- Returns `null` for blocked content (logged as warning)

**Forbidden**: Calling adapter `writeNote()` directly without passing through the router.

### 2. Frontmatter Requirements

Every Obsidian note MUST include YAML frontmatter:

```yaml
---
title: "<note title>"
created: "<ISO 8601 timestamp>"
source: "<origin service>"
tags:
  - "<domain tag>"
  - "<context tags>"
guild_id: "<Discord guild ID>"
---
```

Required fields by write source:

| Source | Required Frontmatter |
|---|---|
| Memory consolidation | `title`, `created`, `source: memory`, `tags`, `guild_id` |
| Sprint retro | `title`, `created`, `source: sprint`, `sprint_id`, `phase: retro` |
| Topology sync | `title`, `created`, `source: discord-topology`, `guild_id` |
| Lore sync | `title`, `created`, `source: lore`, `tags`, `guild_id` |

### 3. Content Format

- Use Obsidian-flavored Markdown (wikilinks `[[note]]` for internal references)
- Include backlinks section at bottom when referencing other notes
- Thread context preserved in metadata (not just body text)

### 4. Write Path Architecture

```
Caller → writeObsidianNoteWithAdapter()
  → sanitizeForObsidianWrite(content)
  → primaryAdapter.writeNote(sanitizedParams)
  → [if fails] fallbackAdapter.writeNote(sanitizedParams)
  → [if no adapter] log warning, return null
```

The router tries adapters in priority order:
1. Local filesystem adapter (if `OBSIDIAN_VAULT_PATH` set)
2. Supabase adapter (if `SUPABASE_URL` set)
3. No-op with warning log

### 5. Vault Path Safety

- `OBSIDIAN_VAULT_PATH` defaults to empty string — all writes are silent no-ops without it
- Paths MUST be sanitized: no `..`, no absolute paths outside vault root
- File names MUST be valid across OS (no `:`, `?`, `*`, `<`, `>`, `|`)

## Forbidden Patterns

- Writing to Obsidian without going through `router.ts`
- Skipping `sanitizeForObsidianWrite()` for "trusted" content
- Constructing file paths with user-supplied strings without sanitization
- Writing without frontmatter (breaks Obsidian graph traversal)

## Current Limitation

> **CRITICAL**: `OBSIDIAN_VAULT_PATH` defaults to empty string. In production, ALL Obsidian write paths are silent no-ops unless explicitly configured. This is tracked but not yet resolved.

## Test References

- `src/services/obsidian/router.test.ts` — sanitization gate tests
- `src/services/obsidian/authoring.test.ts` — content formatting tests

## Related Contracts

- [DISCORD_TO_MEMORY.md](./DISCORD_TO_MEMORY.md) — upstream: Discord → memory
- [OBSIDIAN_READ_LOOP.md](./OBSIDIAN_READ_LOOP.md) — downstream: vault → retrieval
