# Discord News Bot Copilot Instructions

## Mission

Keep the platform stable while shipping fast improvements for Discord operations, knowledge retrieval, and automation — with autonomous sprint pipelines that can plan, implement, review, test, and ship changes.

## Core Priorities

1. Reliability first: avoid changes that can break bot startup, auth, or scheduled automation.
2. Graph-first context strategy: prefer Obsidian link graph retrieval patterns over chunk-first RAG defaults.
3. Security by default: never print or commit secrets from environment variables.
4. Small safe changes: preserve existing APIs unless migration is explicit.
5. Sprint-flow discipline: follow the phase order (plan → implement → review → qa → ops-validate → ship → retro).

## Working Rules

- Prefer targeted edits with tests where possible.
- For risky edits, add guardrails and fail-safe behavior.
- Keep docs in sync when changing behavior that impacts operators.
- Keep workflows and scripts idempotent for unattended runs.

## Tech Stack

- TypeScript + Node.js (ESM — `"type": "module"`)
- Discord.js for bot interaction
- Supabase for database
- Vitest for testing
- Render for deployment

## Sprint Skills

Available in sprint order: `/plan`, `/implement`, `/review`, `/qa`, `/security-audit`, `/ops-validate`, `/ship`, `/retro`

Each skill has a SKILL.md in `.github/skills/{name}/` with:

- When to use, process steps, input/output contract
- HITL decision guide (when to ask vs. act)
- `references/` folder for domain detail (loaded on demand, not upfront)
- Runtime action mapping and next skill transitions

Detailed routing: see `instructions/multi-agent-routing.instructions.md`
Autonomy policy: see `instructions/autonomy-policy.instructions.md`
Naming boundary: see `instructions/naming-boundary.instructions.md`

## Release Gate Checklist

- Startup/auth/scheduler safety not degraded
- Obsidian graph-first retrieval behavior preserved
- Discord output sanitization verified for deliverable wrappers
- Workflow/script idempotency and rollback path documented
- Sprint changed file cap not exceeded
- All sprint phases passed before ship

## Repo-Specific Notes

- Runtime sprint state persists to Supabase table `sprint_pipelines`.
- Sprint pipeline uses existing `actionRunner` with governance gates, FinOps budgets, and circuit breakers.
- Sanitize user-facing Discord outputs, including wrapped deliverable sections.
- Keep Obsidian CLI and headless roles explicit in docs and release gates.

## Context Acquisition Policy

- MCP-first is the default for shared knowledge, shared code intelligence, and operator-visible state.
- `gcpCompute` / shared MCP is a team-shared and company-internal surface, not just a repo helper. Treat it as the first candidate for internal knowledge, operator docs, internal runbooks, and intranet-adjacent context when those may exist there.
- Obsidian-first in this repository means **MCP-mediated Obsidian-first**: prefer shared Obsidian tools through `gcpCompute` (or the canonical shared MCP ingress) over local markdown/file archaeology.
- For plans, requirements, retros, operator docs, and shared memory, query the shared Obsidian surface first. Use local file reads only when MCP does not expose the artifact, when MCP is unavailable, or when exact local workspace text must be patched or verified.
- For team-shared or company-internal knowledge questions, prefer shared MCP-exposed knowledge and runtime surfaces before assuming the answer must be rediscovered from local repository files.
- For repository understanding, prefer shared MCP code-index/context surfaces first; use local search (`grep`, `read_file`, local indexing) as overlay for dirty changes or exact-text verification.
- Treat `grep_search`, `read_file`, and broad file archaeology as fallback tools, not the default discovery path, when an equivalent MCP route exists.

## Knowledge Persistence Policy

- Shared Obsidian via the shared MCP surface is the canonical semantic owner for durable repo memory, architecture deltas, development archaeology, and operator-facing change knowledge.
- `/memories/repo` is a bootstrap and overlay aid for the IDE agent, not the final semantic owner of durable team knowledge.
- `docs/CHANGELOG-ARCH.md` remains a repo-visible compatibility mirror for architecture-significant changes, but those changes should also map to shared wiki objects such as decisions, development slices, service profiles, or improvements.
- When a stable repository fact, lesson, or architecture change becomes team-relevant, prefer promoting it into shared Obsidian or a backfillable repo source doc rather than leaving it only in repo memory.
- When adding new canonical planning, architecture, or MCP guidance that should exist in the shared wiki, update `config/runtime/knowledge-backfill-catalog.json` so it can be externalized to the shared vault.

## Domain Boundary Contracts

Cross-domain data flow rules live in `docs/contracts/`. Read the relevant contract before implementing features that cross domain boundaries:

- `DISCORD_TO_MEMORY.md` — channel metadata resolution, tag format, thread context
- `MEMORY_TO_OBSIDIAN.md` — sanitization gate, frontmatter, adapter routing
- `OBSIDIAN_READ_LOOP.md` — graph-first retrieval strategy
- `DISCORD_SOCIAL_GRAPH.md` — community graph, private thread exclusion
- `SPRINT_DATA_FLOW.md` — phase transitions, action scoping, retro writes

Domain-scoped instruction files auto-load when editing relevant directories:

- `instructions/discord-data.instructions.md` → `src/discord/**`, `src/services/discord-support/**`
- `instructions/obsidian-write.instructions.md` → `src/services/obsidian/**`
- `instructions/memory-domain.instructions.md` → `src/services/memory/**`

## Live System State (IDE Agents)

Before making implementation decisions that touch observer, intent, sprint, or scheduler code, check `.state/system-snapshot.json` (auto-generated by the observer every scan cycle, git-ignored). It contains:

- `recentObservations` — what the observer has detected (errors, gaps, drift)
- `recentIntents` — pending/failed intents from the intent formation engine
- `observerStats` — scan count, observation count, last scan time

Use this to answer: "What's currently broken?", "What was already tried?", "What patterns keep recurring?" before writing code.
