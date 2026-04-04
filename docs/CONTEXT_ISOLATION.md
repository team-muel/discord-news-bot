# Context Isolation Guide

This document defines a fast path for focused edits and reviews. Use a single context entrypoint instead of scanning the full repository.

## Why This Exists

- Reduce cognitive load for non-developers and reviewers.
- Keep AI-assisted edits focused on one domain.
- Limit regression risk by touching a smaller file set.
- **Prevent cross-domain integration gaps** — each domain has explicit boundary contracts (see `docs/contracts/`).

## Current Domain Map

### Discord Runtime
- **Files**: `src/discord/` (commands, messages, runtime, auth, session)
- **Services**: `src/services/discord-support/` (topology, telemetry, CRM, reaction rewards)
- **Shared utility**: `src/utils/discordChannelMeta.ts`
- **Use for**: Command handling, message processing, passive memory capture, guild topology
- **Boundary contracts**: [DISCORD_TO_MEMORY](contracts/DISCORD_TO_MEMORY.md), [DISCORD_SOCIAL_GRAPH](contracts/DISCORD_SOCIAL_GRAPH.md)

### Memory System
- **Files**: `src/services/memory/` (consolidation, evolution, embedding, quality, job runner, poison guard)
- **Use for**: 4-tier memory lifecycle (raw → summary → concept → schema), embedding, retrieval
- **Boundary contracts**: [DISCORD_TO_MEMORY](contracts/DISCORD_TO_MEMORY.md) (inbound), [MEMORY_TO_OBSIDIAN](contracts/MEMORY_TO_OBSIDIAN.md) (outbound)

### Obsidian Vault
- **Files**: `src/services/obsidian/` (router, adapters, authoring, RAG, cache, quality, bootstrap, lore sync, sanitization)
- **Use for**: Knowledge vault writes, graph-first retrieval, Obsidian ↔ Supabase sync
- **Boundary contracts**: [MEMORY_TO_OBSIDIAN](contracts/MEMORY_TO_OBSIDIAN.md) (inbound), [OBSIDIAN_READ_LOOP](contracts/OBSIDIAN_READ_LOOP.md) (outbound)

### Community Graph
- **Files**: `src/services/communityGraphService.ts`
- **Use for**: Social relationship tracking, interaction event recording, private thread exclusion
- **Boundary contracts**: [DISCORD_SOCIAL_GRAPH](contracts/DISCORD_SOCIAL_GRAPH.md)

### Sprint Pipeline
- **Files**: `src/services/sprint/`, `src/services/skills/`, `.github/skills/`
- **Use for**: Autonomous sprint phases (plan → implement → review → qa → ship → retro)
- **Boundary contracts**: [SPRINT_DATA_FLOW](contracts/SPRINT_DATA_FLOW.md)

### Trading
- **Files**: `src/services/trading/`
- **Use for**: Trading engine lifecycle, strategy config, AI order execution
- **Note**: Largely isolated domain — minimal cross-domain boundaries

### Auth & Session
- **Files**: `src/discord/auth.ts`, `src/discord/session.ts`, `src/services/authService.ts`, `src/services/adminAllowlistService.ts`
- **Use for**: Login/session security, admin allowlist, CSRF protection

### Ops Primitives
- **Files**: `src/services/infra/`, `src/utils/network.ts`, `src/utils/async.ts`
- **Use for**: Distributed locking, rate limiting, timeout, concurrency, circuit breakers
- **Note**: Shared infrastructure consumed by all domains

## Recommended Review Workflow

1. Pick one domain from the map above.
2. Follow only direct exports from that domain's files.
3. For cross-domain changes, read the relevant **boundary contract** in `docs/contracts/`.
4. Avoid opening unrelated services unless the change requires cross-domain behavior.
5. Run `npm run lint` after any domain-level change.

## Prompting Template For AI

Use this template for focused AI edits:

```text
Work only in `<domain files>` and directly imported files.
Goal: <single behavior goal>
Constraints: no unrelated refactors; keep API compatibility unless specified.
Cross-domain rules: see docs/contracts/<relevant contract>.md
Validation: run npm run lint.
```
