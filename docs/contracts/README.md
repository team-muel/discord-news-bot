# Domain Contracts

> Service-to-service data flow rules that prevent integration gaps across domain boundaries.

## Why These Exist

This repo contains multiple domains (Discord, Memory, Obsidian, Community Graph, Sprint) that each could be independent projects. When context-switching between domains, developers (human or AI) lose awareness of cross-domain transformation requirements. These contracts are the explicit rules that prevent that.

## Contract Index

| Contract | Data Flow | Key Rule |
|---|---|---|
| [DISCORD_TO_MEMORY](./DISCORD_TO_MEMORY.md) | Discord events → memory items | Always use `resolveChannelMeta()`, correct tag prefixes |
| [MEMORY_TO_OBSIDIAN](./MEMORY_TO_OBSIDIAN.md) | Memory items → Obsidian vault | Must pass through `sanitizeForObsidianWrite()` gate |
| [OBSIDIAN_READ_LOOP](./OBSIDIAN_READ_LOOP.md) | Vault → retrieval → responses | Graph-first retrieval, never default to chunk RAG |
| [DISCORD_SOCIAL_GRAPH](./DISCORD_SOCIAL_GRAPH.md) | Discord interactions → community graph | Private thread exclusion, correct edge weights |
| [SPRINT_DATA_FLOW](./SPRINT_DATA_FLOW.md) | Plan → implement → ship → retro | Phase scoping, governance gates, retro → vault write |

## How to Use

1. **Before implementing a cross-domain feature**: Read both the source and sink contracts.
2. **During code review**: Verify that boundary transformations match the contract.
3. **When adding a new domain boundary**: Create a new contract file following the template below.

## Contract Template

```markdown
# Domain Contract: <Source> → <Sink>

> One-line description.

## Boundary
- **Source**: <files/services that produce data>
- **Sink**: <files/services that consume data>
- **Shared utility**: <shared code, if any>

## Required Transformations
### 1. <Transformation name>
<Description, code example, table of rules>

## Forbidden Patterns
- <Anti-pattern 1>
- <Anti-pattern 2>

## Test References
- <Test file paths>

## Related Contracts
- [<Related contract>](<link>)
```
