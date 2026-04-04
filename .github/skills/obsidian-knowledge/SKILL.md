---
description: "Cross-Phase Skill: Obsidian Knowledge — actively query, verify, and write to the Obsidian vault during sprint phases. Covers both retrieval (graph-first search) and operations (sync, audit, write)."
applyTo: "src/services/obsidian/**,src/mcp/obsidian*"
---

<!-- Token Budget: ~500 base, ~1,200 with references -->

# /obsidian-knowledge

> Use the vault. Don't just reference it — query it, verify it, write to it.

## When to Use

- Any sprint phase that should consult prior decisions (ADRs, retros, plans)
- Before implementing: check if vault has relevant architecture notes or prior art
- After implementing: write summaries, retros, or decision records to vault
- When reviewing: verify claimed behaviors against vault documentation
- Operational checks: sync loop health, cache performance, graph quality

## Two Facets

### 1. Retrieval Facet (Read Loop)

Active knowledge retrieval from the Obsidian vault via graph-first strategy.

**MCP Tools:**
| Tool | Purpose |
|---|---|
| `obsidian.search` | Keyword-based graph-first vault search |
| `obsidian.rag` | Intent-based RAG query (architecture, trading, operations, development, memory) |
| `obsidian.read` | Read specific vault file by path |
| `obsidian.graph` | Get graph metadata (backlinks, tags, link density) |

**Retrieval Priority:**

1. Graph traversal (link graph + tag filtering) — **always try first**
2. Hybrid (graph + vector similarity) — when graph yields < 3 results
3. Semantic-only (pgvector) — when no vault configured
4. Cache hit — recent identical query

**Forbidden:** Defaulting to pure vector similarity without graph traversal attempt.

### 2. Operations Facet (Write + Health)

Active vault maintenance and knowledge persistence.

**MCP Tools:**
| Tool | Purpose |
|---|---|
| `obsidian.write` | Write note through sanitization gate |
| `obsidian.sync.status` | Check lore sync loop health |
| `obsidian.cache.stats` | Cache hit rate and document counts |
| `obsidian.quality.audit` | Graph quality snapshot (orphans, dead links, missing properties) |
| `obsidian.adapter.status` | Which adapters are active, strict mode, routing |

## Integration Points Per Sprint Phase

| Phase             | Action                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| `/plan`           | Query vault for prior ADRs and architecture notes before defining target state          |
| `/implement`      | Search vault for existing patterns before creating new code; write implementation notes |
| `/review`         | Verify vault documentation matches code behavior; flag stale docs                       |
| `/qa`             | Check that test scenarios align with vault-documented invariants                        |
| `/security-audit` | Cross-reference vault threat models and prior audit findings                            |
| `/ops-validate`   | Check `obsidian.sync.status` + `obsidian.quality.audit` health                          |
| `/retro`          | Write retro summary to vault under `retros/` with backlink tags                         |
| `/ship`           | Verify vault content is synced and quality gate passes                                  |

## Process

1. **Check vault health** — `obsidian.adapter.status` → confirm at least one adapter is active.
2. **Query prior knowledge** — `obsidian.rag` or `obsidian.search` for relevant context.
3. **Read specific documents** — `obsidian.read` for detailed review of vault files.
4. **Apply knowledge** — incorporate vault findings into current task decisions.
5. **Write back** — `obsidian.write` to persist new knowledge with proper frontmatter.
6. **Verify quality** — `obsidian.quality.audit` to ensure graph health.

## Write Rules

Every note written to vault MUST include YAML frontmatter:

```yaml
---
title: "<note title>"
created: "<ISO 8601>"
source: "<origin: sprint | memory | lore | discord-topology>"
tags: [<domain>, <context>]
guild_id: "<guild ID>"
---
```

**All writes go through `writeObsidianNoteWithAdapter()`** — never bypass the sanitization gate.

## Guardrails

- Never default to chunk-based RAG when graph traversal is available
- All vault writes must pass through the sanitization gate (injection, spam, length checks)
- File paths must be sanitized: no `..`, no absolute paths, cross-OS safe characters
- Strip wikilinks `[[note]]` before Discord responses
- Respect `OBSIDIAN_RAG_CACHE_TTL_MS` for retrieval caching

## HITL Decision

### Act (proceed without asking)

- Reading/searching vault for context
- Checking sync and adapter status
- Writing retro summaries from completed sprints

### Ask (confirm before proceeding)

- Bulk writes (> 3 notes in one operation)
- Deleting or overwriting existing vault notes
- Changing adapter routing configuration

## Environment Variables

| Variable                       | Default   | Purpose                                    |
| ------------------------------ | --------- | ------------------------------------------ |
| `MCP_OBSIDIAN_ADAPTER_ENABLED` | `false`   | Enable obsidian external adapter           |
| `OBSIDIAN_VAULT_PATH`          | (empty)   | Vault root — writes are no-op without this |
| `OBSIDIAN_RAG_CACHE_TTL_MS`    | `3600000` | RAG cache TTL (1h)                         |
| `OBSIDIAN_RAG_MAX_DOCS`        | `10`      | Max documents per RAG query                |
| `OBSIDIAN_ADAPTER_STRICT`      | `false`   | Fail immediately vs fallback chain         |
| `OBSIDIAN_SYNC_LOOP_ENABLED`   | `false`   | Lore sync loop                             |

## Related Contracts

- `docs/contracts/OBSIDIAN_READ_LOOP.md` — retrieval strategy spec
- `docs/contracts/MEMORY_TO_OBSIDIAN.md` — write path + sanitization gate
- `.github/instructions/obsidian-write.instructions.md` — auto-loaded for `src/services/obsidian/**`

## Next Skills

| Condition                    | Next                                      |
| ---------------------------- | ----------------------------------------- |
| Vault has relevant prior art | Continue current phase with context       |
| Vault is empty/starved       | Flag in `/plan` — vault population needed |
| Quality audit fails          | `/ops-validate` for sync remediation      |
| Knowledge persisted          | Continue to next sprint phase             |
