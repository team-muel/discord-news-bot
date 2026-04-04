# Domain Contract: Obsidian Read Loop

> Defines how data flows back from the Obsidian vault into runtime retrieval and responses.

## Boundary

- **Source**: Obsidian vault (local filesystem or Supabase mirror)
- **Sink**: `src/services/obsidian/obsidianRagService.ts`, Discord command responses
- **Strategy**: Graph-first retrieval (link graph → semantic search → chunk fallback)

## Retrieval Architecture

### 1. Graph-First Priority

Retrieval MUST prefer Obsidian's link graph over chunk-based RAG:

```
1. Resolve query → identify seed notes via tag/title match
2. Traverse backlinks and outgoing links (1-2 hops)
3. Score by link density + recency + semantic similarity
4. Fall back to vector similarity only when graph yields < threshold results
```

**Forbidden**: Defaulting to pure vector similarity search without attempting graph traversal first.

### 2. Search Tiers (from memoryEvolutionService)

| Tier | Trigger | Method |
|---|---|---|
| Graph-first | Default | Obsidian link graph traversal + tag filtering |
| Hybrid | Graph results < 3 | Graph results + vector similarity merge |
| Semantic-only | No vault configured | pgvector cosine similarity via Supabase |
| Cache hit | Recent identical query | `obsidianCacheService.ts` result |

### 3. Cache Layer

- `obsidianCacheService.ts` caches search results with TTL
- Cache key: normalized query + guild_id + tag filters
- Cache invalidation: on vault write (via router callback)

### 4. Quality Scoring

- `obsidianQualityService.ts` scores notes for retrieval quality
- Factors: frontmatter completeness, backlink count, content length, recency
- Low-quality notes deprioritized in retrieval results

## Data Flow

```
Discord command / agent query
  → obsidianRagService.search(query, guildId, options)
  → [check cache] obsidianCacheService.get(cacheKey)
  → [if miss] graph traversal via adapter
  → [if insufficient] hybrid: merge with vector search
  → rank and filter results
  → return to caller for response formatting
```

## Response Formatting Rules

When Obsidian content surfaces in Discord responses:
- Strip internal wikilinks `[[note]]` → plain text
- Truncate to Discord embed limits (4096 chars for embed description)
- Attribute source note in footer
- Never expose vault file paths to users

## Current Limitation

> **CRITICAL**: The read loop is functional but starved — write paths are mostly no-ops (see [MEMORY_TO_OBSIDIAN.md](./MEMORY_TO_OBSIDIAN.md)), so the vault has minimal content to retrieve from. Graph-first retrieval is architecturally correct but practically idle.

## Test References

- `src/services/obsidian/obsidianRagService.test.ts` — search and retrieval tests

## Related Contracts

- [MEMORY_TO_OBSIDIAN.md](./MEMORY_TO_OBSIDIAN.md) — upstream: memory → vault writes
- [DISCORD_TO_MEMORY.md](./DISCORD_TO_MEMORY.md) — origin: Discord → memory
