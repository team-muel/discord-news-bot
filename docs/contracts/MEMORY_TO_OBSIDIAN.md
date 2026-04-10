# Domain Contract: Memory → Obsidian

> Defines the required data transformations when memory items flow into the Obsidian vault.

## Boundary

- **Source**: `src/services/memory/` (consolidation, evolution), `src/services/skills/actions/agentCollab.ts`, other shared services that persist durable knowledge
- **Sink**: `src/services/obsidian/router.ts` → adapter chain → shared remote MCP vault service (default) or explicit local overlay adapters
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

Recommended durability fields for knowledge-bearing notes:

```yaml
observed_at: "<when this fact/note was observed or produced>"
valid_at: "<when it became usable>"
invalid_at: "<when it was superseded/invalidated>"   # optional
status: "open|answered|active|superseded|invalid"    # domain-specific
canonical_key: "<stable identity across rewrites>"   # optional but preferred
source_refs: ["<source note path>", "<source note path>"]
```

The router now auto-injects frontmatter when callers provide plain markdown plus `properties`/`tags` but forget to prepend YAML manually. Notes that already include frontmatter are preserved.

Required fields by write source:

| Source | Required Frontmatter |
| --- | --- |
| Memory consolidation | `title`, `created`, `source: memory`, `tags`, `guild_id` |
| Sprint retro | `title`, `created`, `source: sprint`, `sprint_id`, `phase: retro` |
| Topology sync | `title`, `created`, `source: discord-topology`, `guild_id` |
| Lore sync | `title`, `created`, `source: lore`, `tags`, `guild_id` |

### 3. Content Format

- Use Obsidian-flavored Markdown (wikilinks `[[note]]` for internal references)
- Include backlinks section at bottom when referencing other notes
- Thread context preserved in metadata (not just body text)

### 4. Write Path Architecture

```text
Caller → writeObsidianNoteWithAdapter()
  → sanitizeForObsidianWrite(content)
  → primaryAdapter.writeNote(sanitizedParams)
  → [if primary write fails] return null and preserve primary target semantics
  → [if no adapter] log warning, return null
```

The router tries adapters in priority order. Current production preference is:

1. `remote-mcp` — shared vault service on the GCP VM via `MCP_SHARED_MCP_URL` (legacy alias: `OBSIDIAN_REMOTE_MCP_URL`)
2. `native-cli` — local native CLI when a host machine has direct vault access
3. `script-cli` — script-based bridge for narrow fallback paths
4. `local-fs` — direct filesystem fallback when the process can mount the vault locally

This layer is intended to be a shared memory backplane for multiple services, not a single bot-only write path.

When `remote-mcp` has recent probe failures or repeated tool-call failures, the router temporarily de-prioritizes it behind healthy local adapters instead of paying the remote timeout cost on every call. This is a short-lived circuit-breaker, not a permanent disable. Once a primary write adapter is selected, however, write failure does not silently fall through to another adapter.

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

> **CRITICAL**: production now assumes `remote-mcp` first. If the GCP MCP server is unreachable, auth fails, or the remote vault is locked/unavailable, writes can still collapse into no-op or fallback behavior unless operators inspect the runtime health response.

## Test References

- `src/services/obsidian/router.test.ts` — sanitization gate tests
- `src/services/obsidian/authoring.test.ts` — content formatting tests

## Related Contracts

- [DISCORD_TO_MEMORY.md](./DISCORD_TO_MEMORY.md) — upstream: Discord → memory
- [OBSIDIAN_READ_LOOP.md](./OBSIDIAN_READ_LOOP.md) — downstream: vault → retrieval
