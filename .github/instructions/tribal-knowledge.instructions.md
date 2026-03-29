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

## Adding a New Action (8-step checklist)

1. Define export in a new file under `src/services/skills/actions/` (implement `ActionDefinition`).
2. Add `category` and `parameters` metadata using `ActionCategory` and `ActionParameterSpec` types.
3. Register in `src/services/skills/actions/registry.ts` — add import and insert into `ACTION_REGISTRY`.
4. If the action should be available during specific sprint phases, verify `PHASE_TOOL_CATEGORIES` in `src/services/sprint/sprintPreamble.ts` includes its category.
5. If the action should be blocked in certain phases, check `PHASE_BLOCKED_CATEGORIES`.
6. Register any lifecycle hooks in `src/services/sprint/sprintHooks.ts` if the action needs pre/post processing.
7. Add tests in `src/services/skills/actions/<name>.test.ts`.
8. Update `docs/ROUTES_INVENTORY.md` if the action exposes an API endpoint.

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
