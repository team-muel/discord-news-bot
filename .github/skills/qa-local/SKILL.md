---
description: "Agent Skill: Local QA — domain-targeted test execution, impact-scoped validation, and fast feedback loops in the IDE."
applyTo: "src/**"
---

# /qa-local

> Run the right tests for what changed. Skip what didn't.

## When to Use

- After editing source files, to validate only the affected domain
- When `/implement` finishes and you need fast local verification before `/review`
- When a single domain's tests fail and you want to isolate re-runs
- When you want smoke vs unit separation

## Domain → Project Map

| Project      | Covers                                          | Files (~) |
| ------------ | ----------------------------------------------- | --------- |
| `sprint`     | Sprint pipeline, orchestrator, learning journal | 18        |
| `skills`     | Action runner, planner, skill actions, pipeline | 16        |
| `langgraph`  | Graph executor, session runtime, nodes          | 15        |
| `agent`      | Agent services, session, consent, classifiers   | 9         |
| `news`       | News/YouTube monitors, sentiment, scraper       | 7         |
| `obsidian`   | Adapters, authoring, RAG, doc builder           | 7         |
| `discord`    | Discord entry, auth, support services           | 9         |
| `runtime`    | Bootstrap, scheduler, recovery, signal bus      | 6         |
| `eval`       | Reward signal, auto-promote, eval loops         | 4         |
| `infra`      | Tools, adapters, automation, opencode, workflow  | 13        |
| `routes`     | HTTP routes, middleware, MCP adapters            | 6         |
| `core`       | Config, utils, LLM client, memory, trading      | 21        |
| `smoke`      | Integration/smoke tests (longer timeout)         | 1+        |

## Process

### 1. Identify Affected Domains

Map changed files to projects:

```
src/services/sprint/**     → sprint
src/services/skills/**     → skills
src/services/langgraph/**  → langgraph
src/services/agent/**      → agent
src/services/news/**       → news
src/services/obsidian/**   → obsidian
src/discord/**             → discord
src/services/discord-support/** → discord
src/services/runtime/**    → runtime
src/services/runtime-alerts/** → runtime
src/services/eval/**       → eval
src/services/tools/**      → infra
src/services/infra/**      → infra
src/services/automation/** → infra
src/services/opencode/**   → infra
src/services/workflow/**   → infra
src/services/workerGeneration/** → infra
src/routes/**              → routes
src/middleware/**           → routes
src/mcp/**                 → routes
src/services/*.ts (root)   → core
src/utils/**               → core
src/config.ts              → core
src/services/memory/**     → core
src/services/trading/**    → core
```

### 2. Run Targeted Tests

```bash
# Single domain
npx vitest run --project sprint

# Multiple domains (e.g., after cross-cutting change)
npx vitest run --project sprint --project skills

# Fast: everything except smoke
npm run test:fast

# Full suite (same as before)
npm run test
```

### 3. Validation Ladder

For any change, follow this escalation:

1. **Domain test** — `npx vitest run --project <domain>` for changed domains only
2. **Type check** — `tsc --noEmit` (always, regardless of domain)
3. **Full suite** — `npx vitest run` (before handoff to /review or /ship)

If step 1 passes but step 3 fails, you found a cross-domain regression. Investigate imports and shared types.

### 4. Interpret Failures

- **Timeout** → likely I/O mock missing or real network call leaking. Check `vi.mock` coverage.
- **Import error** → ESM path issue. Remember `"type": "module"` and no `__dirname`.
- **vi.mock reference error** → hoisting issue. Use `vi.hoisted()`.
- **Flaky pass/fail** → check for shared mutable state between tests. `pool: 'forks'` should isolate, but module-level singletons can leak within a file.

## Commands Quick Reference

| Command                | What it does                    |
| ---------------------- | ------------------------------- |
| `npm run test:sprint`  | Sprint domain only              |
| `npm run test:skills`  | Skills domain only              |
| `npm run test:agent`   | Agent domain only               |
| `npm run test:langgraph` | LangGraph domain only         |
| `npm run test:discord` | Discord domain only             |
| `npm run test:obsidian`| Obsidian domain only            |
| `npm run test:news`    | News domain only                |
| `npm run test:runtime` | Runtime domain only             |
| `npm run test:eval`    | Eval domain only                |
| `npm run test:infra`   | Infra/tools domain only         |
| `npm run test:routes`  | Routes/middleware/MCP only      |
| `npm run test:core`    | Core services/utils/config      |
| `npm run test:smoke`   | Smoke tests only (30s timeout)  |
| `npm run test:fast`    | All except smoke tests          |
| `npm run test`         | Full suite (all 137+ files)     |

## Guardrails

- Always run `tsc --noEmit` alongside domain tests — type errors cross domain boundaries.
- Never skip full suite before `/ship`.
- If editing `vitest.config.ts` projects, verify no test file is orphaned (not in any project).
- Smoke tests use 30s timeout; unit tests use 10s. Don't mix conventions.

## Next Skills

| Condition                        | Next              |
| -------------------------------- | ----------------- |
| Domain tests + typecheck pass    | `/review`         |
| Cross-domain regression found    | `/implement` fix  |
| Flaky tests need investigation   | `/qa` (full)      |
| Ready to ship                    | `/ship`           |
