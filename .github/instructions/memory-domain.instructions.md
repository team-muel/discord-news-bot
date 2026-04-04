---
description: "Memory domain rules — 4-tier lifecycle, embedding, evolution links, thread context columns, and poison guard."
applyTo: "src/services/memory/**"
---

# Memory Domain Rules

> Loaded automatically when editing memory services.

## 4-Tier Lifecycle

Memory items progress through tiers:
1. **Raw** — captured from Discord or external sources
2. **Summary** — consolidated from multiple raw items
3. **Concept** — abstracted patterns across summaries
4. **Schema** — stable structural knowledge

Tier transitions happen in `memoryConsolidationService.ts`. Do not skip tiers.

## Inbound Data Requirements

When receiving data from Discord (via `passiveMemoryCapture.ts` or `backfill-discord-memory.ts`):

- Thread context columns are mandatory: `channel_type`, `is_thread`, `parent_channel_id`, `is_private_thread`
- Tags must use correct prefix from `buildChannelTags()`: `channel:` or `thread:`
- Source reference must be hierarchical URI from `buildSourceRef()`

See `docs/contracts/DISCORD_TO_MEMORY.md` for full specification.

## Outbound Data

When writing to Obsidian (via evolution or consolidation):

- Must go through `writeObsidianNoteWithAdapter()` — never direct adapter calls
- Content must include YAML frontmatter
- Sanitization is enforced by the router

See `docs/contracts/MEMORY_TO_OBSIDIAN.md` for full specification.

## Evolution Links (A-MEM)

- `memoryEvolutionService.ts` manages associative links between memory items
- Links are typed: `related`, `evolved_from`, `contradicts`, `supersedes`
- LLM-based relation classification determines link type (not keyword matching)

## Poison Guard

- `memoryPoisonGuard.ts` filters potentially harmful or injected content
- Applied before storage, not after retrieval
- Do not bypass for "internal" content

## Embedding

- `memoryEmbeddingService.ts` generates embeddings via `text-embedding-3-small` (1536 dims)
- Stored in pgvector column for hybrid search
- Re-embedding triggered on significant content updates

## Cross-Domain Contract

Full specifications: `docs/contracts/DISCORD_TO_MEMORY.md` (inbound), `docs/contracts/MEMORY_TO_OBSIDIAN.md` (outbound)
