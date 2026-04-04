# Domain Contract: Discord Social Graph

> Defines the required data transformations when Discord interactions flow into the community graph.

## Boundary

- **Source**: `src/discord/runtime/passiveMemoryCapture.ts` (real-time), `scripts/backfill-discord-memory.ts` (historical)
- **Sink**: `src/services/communityGraphService.ts` → Supabase `community_interaction_events` table
- **Shared utility**: `src/utils/discordChannelMeta.ts`

## Required Transformations

### 1. Interaction Event Structure

Every community interaction MUST include:

| Field | Source | Required |
|---|---|---|
| `guild_id` | Message guild ID | Yes |
| `user_id` | Message author ID | Yes |
| `channel_id` | Resolved channel ID | Yes |
| `interaction_type` | `message` / `reaction` / `reply` / `thread_create` | Yes |
| `target_user_id` | Reply target or reaction author | If applicable |
| `is_thread` | `meta.isThread` | Yes |
| `parent_channel_id` | `meta.parentId` | If thread |
| `is_private_thread` | `meta.isPrivateThread` | If thread |

### 2. Privacy Gate: Private Thread Exclusion

Private thread interactions MUST be excluded from the community graph entirely.

```ts
// communityGraphService.ts
if (params.isPrivateThread) {
  return; // early exit — no DB write
}
```

**Rationale**: Private threads are opt-in conversations. Recording social connections from private contexts violates user expectations.

### 3. Channel Metadata

Use `resolveChannelMeta()` for all channel type resolution:

```ts
const meta = resolveChannelMeta(message.channel);
// Pass to community graph:
recordCommunityInteractionEvent({
  ...baseParams,
  isPrivateThread: meta.isPrivateThread,
});
```

### 4. Graph Edge Types

| Interaction | Edge Direction | Weight |
|---|---|---|
| Message in channel | user → channel (presence) | 1.0 |
| Reply to user | user → target_user (directed) | 2.0 |
| Reaction to message | user → target_user (directed) | 1.5 |
| Thread creation | user → parent_channel (contribution) | 1.5 |

### 5. Thread Attribution

Thread messages create TWO graph signals:
1. User → thread (direct presence)
2. User → parent channel (inherited presence, lower weight)

This ensures thread activity contributes to the parent channel's activity score.

## Forbidden Patterns

- Recording private thread interactions in the graph
- Using raw `channel.type` without `resolveChannelMeta()`
- Creating graph edges without `guild_id` context
- Treating thread-only users as channel-active without weight distinction

## Test References

- `src/services/communityGraphService.test.ts` — interaction recording and privacy tests
- `src/utils/discordChannelMeta.test.ts` — channel type resolution

## Related Contracts

- [DISCORD_TO_MEMORY.md](./DISCORD_TO_MEMORY.md) — parallel: Discord → memory
- [SPRINT_DATA_FLOW.md](./SPRINT_DATA_FLOW.md) — consumer: sprint retro reads graph data
