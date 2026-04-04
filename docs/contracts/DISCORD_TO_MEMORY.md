# Domain Contract: Discord → Memory

> Defines the required data transformations when Discord events flow into the memory system.

## Boundary

- **Source**: `src/discord/runtime/passiveMemoryCapture.ts`, `scripts/backfill-discord-memory.ts`
- **Sink**: `src/services/memory/`, Supabase `memory_items` table
- **Shared utility**: `src/utils/discordChannelMeta.ts`

## Required Transformations

### 1. Channel Metadata Resolution

Every Discord message MUST be resolved through `resolveChannelMeta(channel)` before storage.

```ts
import { resolveChannelMeta } from "../../utils/discordChannelMeta.js";
const meta = resolveChannelMeta(message.channel);
```

**Forbidden**: Direct `channel.type` comparison or `(channel as any).parentId` casts.

### 2. Tag Format

Tags attached to memory items MUST use the correct semantic prefix:

| Channel Type | Tag Format | Example |
|---|---|---|
| Text channel | `channel:<name>` | `channel:general` |
| Thread | `thread:<name>` | `thread:bug-discussion` |
| Forum post | `thread:<name>` | `thread:feature-request` |
| Voice channel | `channel:<name>` | `channel:voice-lounge` |

Additional context tags from `buildChannelTags(meta)`:

- `category:<name>` — parent category (if exists)
- `forum:<name>` — parent forum channel (for forum threads)
- `parent_channel:<name>` — parent channel (for non-forum threads)

### 3. Source Reference URI

Memory items MUST include a hierarchical `sourceRef` from `buildSourceRef(meta, guildId)`:

```
discord://guild/<guildId>/channel/<channelId>                    # top-level channel
discord://guild/<guildId>/channel/<parentId>/thread/<threadId>   # thread
```

### 4. Thread Context Columns

When writing to `memory_items`, these columns MUST be populated:

| Column | Source | Required |
|---|---|---|
| `channel_type` | `meta.type` (ChannelType enum string) | Yes |
| `is_thread` | `meta.isThread` | Yes |
| `parent_channel_id` | `meta.parentId` | If thread |
| `is_private_thread` | `meta.isPrivateThread` | If thread |

See `docs/MIGRATION_THREAD_CONTEXT_COLUMNS.sql` for schema.

### 5. Private Thread Exclusion

Private thread content MUST NOT be written to:
- Community graph (`communityGraphService.ts`) — early exit on `isPrivateThread`
- Public-facing Obsidian notes — filter before Obsidian write path

## Forbidden Patterns

- `channel.type === ChannelType.GuildText` without also checking thread types
- `(channel as any).parentId` — use `resolveChannelMeta()` instead
- Storing thread messages without `parent_channel_id` context
- Treating all channels as flat (ignoring thread hierarchy)

## Test References

- `src/utils/discordChannelMeta.test.ts` — 25 unit tests for metadata resolution
- `src/discord/runtime/passiveMemoryCapture.ts` — integration point

## Related Contracts

- [MEMORY_TO_OBSIDIAN.md](./MEMORY_TO_OBSIDIAN.md) — downstream: memory → vault
- [DISCORD_SOCIAL_GRAPH.md](./DISCORD_SOCIAL_GRAPH.md) — parallel: Discord → community graph
