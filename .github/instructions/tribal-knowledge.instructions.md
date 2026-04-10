---
description: "Tribal knowledge — gotchas, multi-step wiring checklists, and lessons learned from repeated failures. Agents should proactively suggest additions when corrected or when a non-obvious pattern required reading many files to discover."
applyTo: "src/**"
---

# Tribal Knowledge

> If you had to be corrected, read many files to discover something, or hit a multi-step gotcha — record it here.

## TypeScript / ESM Gotchas

- This repo uses `"type": "module"` in package.json. `__dirname` is NOT available. Use:
  ```ts
  import { fileURLToPath } from "node:url";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  ```
- `vi.mock` factories are hoisted. Avoid referencing top-level `const` mocks inside factories. Use `vi.hoisted()` or `vi.doMock()`.
- `Number('')` returns `0` (not NaN), `Number(null)` returns `0`. Use a dedicated `resolveMetric` helper that checks for null/empty BEFORE calling `Number()`.
- `clamp01` in `multiAgentService` requires two args `(value, fallback)`. Missing fallback causes TS2554.
- `probeHttp` in `externalToolProbe.ts` takes 1 arg (url only). No timeout parameter.

## Environment Variables

- Hugging Face: `HF_TOKEN` vs `HF_API_KEY` / `HUGGINGFACE_API_KEY` — mismatches silently break provider resolution. Handle aliases.
- `litellm.config.yaml`: Korean (non-ASCII) comments cause `UnicodeDecodeError: 'cp949'` on Windows Python. Use ASCII/English only.
- OpenJarvis `/v1/chat/completions` requires `model` field (returns 422 if missing). Use actual Ollama model name, NOT `'default'`.

## Windows / Cross-Platform

- `winget` may report a CLI package as installed while the command is unavailable in PATH. Verify with `where`.
- Windows-created files have CRLF that breaks Linux systemd EnvironmentFile parsing. Always `sed -i 's/\r$//'` or use `.gitattributes` with `*.env text eol=lf`.

## Adding a New Action

1. Export an `ActionDefinition` from a file in `src/services/skills/actions/`. `category` is **required** — `tsc` will error if missing.
2. Import and call `registerActions()` in `registry.ts`.
3. Add tests in `src/services/skills/actions/<name>.test.ts`.

Phase filtering (`PHASE_TOOL_CATEGORIES`) and blocking (`PHASE_BLOCKED_CATEGORIES`) work automatically from `category`. No manual wiring needed unless adding a new phase.

## Adding a New Sprint Phase

1. Add the phase to `SprintPhase` union type in `src/services/sprint/sprintOrchestrator.ts`.
2. Add transition rule in `PHASE_TRANSITIONS`.
3. Create `SKILL.md` under `.github/skills/<phase>/`.
4. Add phase → action mapping in `src/services/sprint/skillPromptLoader.ts`.
5. Add category list in `PHASE_TOOL_CATEGORIES` (`sprintPreamble.ts`).
6. If restricted, add to `PHASE_BLOCKED_CATEGORIES`.
7. Register hooks in `sprintHooks.ts` for the new phase.
8. Update `copilot-instructions.md` sprint flow documentation.

## Adding a New Environment Variable

1. Add to `.env.example` with a comment describing purpose and default.
2. Parse in `src/config.ts` with appropriate type coercion and fallback.
3. Reference from the consuming service (never read `process.env` directly outside `config.ts`).
4. Document in `docs/SPRINT_ENV_VARS.md` if sprint-related.
5. Add to `docs/RENDER_AGENT_ENV_TEMPLATE.md` if needed for deployment.

## Fetch / HTTP Patterns

- Always use `fetchWithTimeout` from `src/utils/network.ts` — never redefine locally.
- The canonical wrapper merges caller's AbortSignal with the timeout signal via `AbortSignal.any()`.
- For domain-specific needs (structured error logging), extend via wrapper functions that call the canonical fetch, not by copy-pasting.

## File Write Safety

- Use `atomicWriteFileSync` / `atomicWriteFile` from `src/utils/atomicWrite.ts` for any state that must survive crashes.
- Pattern: write to `<path>.tmp` then rename. Rename is atomic on both POSIX and NTFS.
- Direct `writeFileSync` is acceptable only for best-effort diagnostics that tolerate data loss.

## Discord Output Safety

- Always sanitize user-facing Discord replies, including text wrapped in Deliverable blocks. Debug markers can leak.
- `tools.ts` has a known garbled description text (encoding issue). Quote descriptions carefully.

## New File Creation — Reuse-First Checklist

Agents (including IDE copilots) frequently create 10+ new files per sprint instead of extending existing services.
**Before creating any new `.ts` file**, answer ALL five questions. If any answer is "yes", extend existing code instead.

1. **Does a service in `src/services/` already handle 70%+ of this responsibility?** Search by keyword, domain, and function name.
2. **Can this logic be a new exported function in an existing file?** Adding 50 lines to an existing service beats a new 200-line file.
3. **Is this a new "layer" on top of something that already works?** observer→intent→synthesis layering is the anti-pattern. Flatten.
4. **Will the new file need its own barrel export, types file, and test file?** If yes, the blast radius is 4+ files for one feature — almost certainly too many.
5. **Am I creating this because I was inspired by an article/pattern rather than because existing code is insufficient?** Inspiration isn't justification.

**Hard cap**: `SPRINT_NEW_FILE_CAP` (default 3) is enforced by `scopeGuard.checkNewFileCreation()`. Test files for modified code are exempt.

## Harness Design Anti-Patterns

These mirror classic software anti-patterns but apply to agent/skill design. Catch them early.

| Anti-Pattern               | Classic Equivalent  | Symptom                                              | Fix                                                                                          |
| -------------------------- | ------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **God Skill**              | God Class           | One SKILL.md handles 300+ lines of mixed concerns    | Split into focused skill + `references/`                                                     |
| **Spaghetti Instructions** | Spaghetti Code      | All instructions mixed in one file without structure | Separate by concern, use `applyTo` scoping                                                   |
| **Hardcoded Tool Calls**   | Tight Coupling      | Direct API/curl calls without MCP abstraction        | Route through MCP or worker client                                                           |
| **Leaky Abstraction**      | Leaky Abstraction   | Sub-agent depends on MCP implementation details      | Keep skill ↔ MCP boundary clean                                                              |
| **Circular Skill Calls**   | Circular Dependency | A→B→C→A infinite loop risk                           | Cap loops (`SPRINT_MAX_IMPL_REVIEW_LOOPS`), define exit conditions                           |
| **Skill Explosion**        | Class Explosion     | 20+ tiny skills each loaded into system prompt       | Consolidate with Facade pattern: one entry SKILL.md + `references/`                          |
| **Feature Envy**           | Feature Envy        | One skill over-references another skill's data       | Move shared data to common reference or MCP                                                  |
| **Stale CLAUDE.md**        | Stale Config        | Dynamic info in static config file                   | Keep copilot-instructions.md static; pass dynamic info via conversation or instruction files |

### When to Create a New Skill vs. a Reference File

- **New Skill**: independent workflow with its own lead agent, input/output contract, and phase transition
- **Reference file**: domain-specific detail loaded on demand by an existing skill
- Rule of thumb: if it doesn't have a "Next Skills" routing table, it's a reference, not a skill

## Cross-Domain Rules

These rules enforce data transformation correctness at domain boundaries. Full specifications live in `docs/contracts/`.

### Discord → Memory

- **Always** use `resolveChannelMeta(channel)` from `src/utils/discordChannelMeta.ts` — never raw `channel.type` checks or `(channel as any).parentId`.
- Tags must use correct prefix: `channel:` for channels, `thread:` for threads/forum posts.
- Source references must be hierarchical URIs: `discord://guild/<id>/channel/<id>/thread/<id>`.
- Thread context columns (`is_thread`, `parent_channel_id`, `channel_type`) are mandatory for memory writes.

### Memory → Obsidian

- **All** Obsidian writes must go through `writeObsidianNoteWithAdapter()` in `src/services/obsidian/router.ts` — never call adapter `writeNote()` directly.
- Content is auto-sanitized by the centralized gate (`sanitizeForObsidianWrite()`). Do not bypass.
- Every note must include YAML frontmatter with `title`, `created`, `source`, `tags`, `guild_id`.
- `OBSIDIAN_VAULT_PATH` defaults to empty string — writes are silent no-ops without it. Do not assume vault is configured.

### Discord → Community Graph

- Private thread interactions must be **excluded** from the community graph (`isPrivateThread` → early return).
- Use `resolveChannelMeta()` for channel type — same utility as Discord → Memory.
- Thread messages create dual signals: thread presence + parent channel inherited presence.

### Sprint Pipeline

- Phase transitions must persist to Supabase — never store sprint state in local files.
- Actions are scoped to phases via `PHASE_TOOL_CATEGORIES` — do not execute out-of-scope actions.
- Retro phase must write to Obsidian vault via `writeRetroToVault()` (fire-and-forget).

### Obsidian Retrieval

- Default to graph-first retrieval (link graph traversal + tag filtering), NOT chunk-based RAG.
- Fall back to vector similarity only when graph results are insufficient (< 3 results).
- Strip wikilinks `[[note]]` before surfacing content in Discord responses.

## Pre-Implementation System State Checklist

Before writing code that creates new services, modifies observer/intent/memory systems, or changes infrastructure wiring, answer these 6 questions. Check `.state/system-snapshot.json` if it exists — it contains live data.

| #   | Question                         | Where to Check                                                                                                             |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **What's currently broken?**     | `.state/system-snapshot.json` → `recentObservations`, or `getRecentObservations({ unconsumedOnly: true })`                 |
| 2   | **What was already tried?**      | `.state/system-snapshot.json` → `recentIntents`, or `getIntents({ status: 'failed' })`                                     |
| 3   | **What patterns are recurring?** | `searchMemory({ tags: ['observer'], limit: 10 })` or Obsidian graph tags `obs/*`                                           |
| 4   | **Which tools are alive?**       | `.state/system-snapshot.json` → `workerHealth`, or MCP router status                                                       |
| 5   | **What depends on this code?**   | shared code-index (`gcpCompute`) → `symbol_references` / `context_bundle`; use `muelIndexing` only for local dirty overlay |
| 6   | **What must NOT be done?**       | This file (tribal-knowledge), anti-pattern table above                                                                     |

**If any of questions 1-4 reveal relevant context, incorporate it into the implementation plan BEFORE writing code.**

The cost of querying is near-zero. The cost of building on wrong assumptions is a wasted sprint.

## Knowledge Feedback Loop

This file is the **team's shared knowledge base**. It should grow from real experience, not speculation.

### When to Add Here

- You were corrected by a human and the correction applies to future work
- You read 3+ files to discover a non-obvious pattern
- A multi-step wiring checklist was needed and didn't exist
- A `/retro` found a recurring gotcha across sprints

### How to Propose Additions

During `/retro`, if a new gotcha is discovered:

1. Check if it's already documented here
2. If not, add it under the appropriate section with a one-line description
3. Keep entries actionable and specific — not vague warnings

### Relationship to IDE Agent Memory

- **This file** = team knowledge (shared, versioned in git, reviewed)
- **IDE agent memory** (`/memories/`) = personal experience (per-user, not versioned)
- Overlap is expected. When a personal memory proves universally useful, promote it here.
- When this file is updated, relevant IDE agent memory should be checked for staleness.
