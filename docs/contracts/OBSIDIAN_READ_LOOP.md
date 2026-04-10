# Domain Contract: Obsidian Read Loop

> Defines how data flows back from the Obsidian vault into runtime retrieval and responses.

## Boundary

- **Source**: Obsidian vault exposed through the adapter chain, with `remote-mcp` as the primary production path via the canonical shared MCP ingress (`MCP_SHARED_MCP_URL`, usually `/mcp`)
- **Sink**: `src/services/obsidian/obsidianRagService.ts`, Discord command responses, and any service consuming shared memory hints
- **Strategy**: Graph-first retrieval (link graph → semantic search → chunk fallback)

## Retrieval Architecture

### 1. Graph-First Priority

Retrieval MUST prefer Obsidian's link graph over chunk-based RAG:

```text
1. Resolve query → identify seed notes via tag/title match
2. Traverse backlinks and outgoing links (1-2 hops)
3. Score by link density + recency + semantic similarity
4. Fall back to vector similarity only when graph yields < threshold results
```

**Forbidden**: Defaulting to pure vector similarity search without attempting graph traversal first.

### 2. Search Tiers (from memoryEvolutionService)

| Tier | Trigger | Method |
| --- | --- | --- |
| Graph-first | Default | Obsidian link graph traversal + tag filtering |
| Hybrid | Graph results < 3 | Graph results + vector similarity merge |
| Semantic-only | No vault configured | pgvector cosine similarity via Supabase |
| Cache hit | Recent identical query | `obsidianCacheService.ts` result |

### 2.5 Metadata-Only vs Supabase Boundary

The read loop now distinguishes between two layers:

- **Metadata-only layer (Obsidian-native)**
  - Source of truth: frontmatter + tags + backlinks + wikilinks
  - Used for: `status`, `valid_at`, `invalid_at`, `supersedes`, `source_refs`, `canonical_key`
  - Purpose: rank active notes above invalid/superseded ones, prefer grounded notes, preserve graph-first retrieval
- **Supabase-backed layer (operational acceleration)**
  - Source of truth: `obsidian_cache` TTL cache and hit counters
  - Used for: cross-process cache reuse, cache hit tracking, faster repeated reads
  - Not used as the semantic authority for note validity or supersession

This means note lifecycle and meaning should be encoded in Obsidian metadata first. Supabase improves speed and observability, but it does not replace the vault as the canonical semantic store.

### 3. Cache Layer

- `obsidianCacheService.ts` caches search results with TTL
- Cache key: normalized query + guild_id + tag filters
- Cache invalidation: on vault write (via router callback)

### 4. Quality Scoring

- `obsidianQualityService.ts` scores notes for retrieval quality
- Factors: frontmatter completeness, backlink count, content length, recency
- Low-quality notes deprioritized in retrieval results

## Data Flow

```text
Discord command / agent query
  → obsidianRagService.search(query, guildId, options)
  → [check cache] obsidianCacheService.get(cacheKey)
  → [if miss] graph traversal via adapter
  → frontmatter-aware reranking (`invalid_at`, `supersedes`, `source_refs`, `status`)
  → [if insufficient] hybrid: merge with vector search
  → rank and filter results
  → return to caller for response formatting
```

In production this usually means Render, IDE agents, or another service calling the shared GCP vault service over `remote-mcp` and the canonical shared `/mcp` ingress, not direct local disk access.

## Response Formatting Rules

When Obsidian content surfaces in Discord responses:

- Strip internal wikilinks `[[note]]` → plain text
- Truncate to Discord embed limits (4096 chars for embed description)
- Attribute source note in footer
- Never expose vault file paths to users

## Current Limitation

> **CRITICAL**: the read loop can appear healthy while returning empty results if the remote MCP server is reachable but the remote vault is locked, unauthenticated, or otherwise unavailable. Operators should inspect the live runtime probe, not just adapter selection.

## Test References

- `src/services/obsidian/obsidianRagService.test.ts` — search and retrieval tests

## Related Contracts

- [MEMORY_TO_OBSIDIAN.md](./MEMORY_TO_OBSIDIAN.md) — upstream: memory → vault writes
- [DISCORD_TO_MEMORY.md](./DISCORD_TO_MEMORY.md) — origin: Discord → memory
