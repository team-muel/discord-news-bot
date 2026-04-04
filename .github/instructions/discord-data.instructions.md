---
description: "Discord data handling rules — correct channel/thread metadata, tag formats, and source references for all Discord-sourced data."
applyTo: "src/services/discord-support/**,src/discord/**"
---

# Discord Data Domain Rules

> Loaded automatically when editing Discord runtime or support services.

## Channel Metadata

- **Always** use `resolveChannelMeta(channel)` from `src/utils/discordChannelMeta.ts`.
- **Never** use raw `channel.type === ChannelType.GuildText` without checking thread types.
- **Never** cast `(channel as any).parentId` — the shared utility handles this correctly.

## Tag Format

- Channels: `channel:<name>`
- Threads and forum posts: `thread:<name>`
- Additional context: `category:<name>`, `forum:<name>`, `parent_channel:<name>`

## Source Reference

Use `buildSourceRef(meta, guildId)` for hierarchical URIs:
```
discord://guild/<guildId>/channel/<channelId>
discord://guild/<guildId>/channel/<parentId>/thread/<threadId>
```

## Display Prefixes

- `channelDisplayPrefix(meta)` returns `#` for channels, `↳` for threads
- `parentLabel(meta)` returns `category=`, `forum=`, or `parent_channel=` as appropriate

## Privacy

- Private thread content must NOT flow to community graph or public Obsidian notes.
- Check `meta.isPrivateThread` and early-exit or filter accordingly.

## Cross-Domain Contract

Full specification: `docs/contracts/DISCORD_TO_MEMORY.md` and `docs/contracts/DISCORD_SOCIAL_GRAPH.md`
