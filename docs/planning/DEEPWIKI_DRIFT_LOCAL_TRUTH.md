# DeepWiki Drift Local Truth

DeepWiki coverage is still useful for broad architecture recall, but its repository index is known to lag current code after 2026-04-11. This file records recurring mismatches so maintainability reviews can start from local truth instead of rediscovering the same drift.

## Usage Rule

- Use DeepWiki first for topology and historical intent.
- Verify runtime behavior, routes, worker mappings, and generated inventories from local code before treating DeepWiki output as authoritative.
- Prefer the local canonical source listed below when DeepWiki and the workspace disagree.

## Known Drift

| Surface | DeepWiki stale assumption | Local truth | Canonical local source |
| --- | --- | --- | --- |
| Runtime admin routes | Runtime route set predates requester-personalization and OpenJarvis memory-sync admin surfaces. | Current runtime exposes personalization and memory-sync admin endpoints. | `src/routes/bot-agent/runtimeRoutes.ts`, regenerated `docs/ROUTES_INVENTORY.md` |
| Personalization workflow | Workflow summary can be read as requested-priority only. | Runtime may switch balanced requests to an effective personalized priority; workflow snapshots should reflect the effective priority. | `src/services/agent/agentPersonalizationService.ts`, `src/services/multiAgentService.ts` |
| OpenJarvis memory sync trigger | A `202` trigger can be interpreted as synchronous completion. | Runtime trigger is queue-oriented; freshness is checked from `tmp/openjarvis-memory-feed/summary.json`. | `src/services/openjarvis/openjarvisMemorySyncStatusService.ts` |
| Retrieval variant vocabulary | Variant names appear in multiple drift-prone places. | Retrieval variants are centralized for runtime and weekly scripts. | `config/runtime/retrievalVariants.js` |
| Sprint phase adapters | `implement` may still appear mapped to OpenClaw in older docs/indexes. | `implement` and `ship` currently have no phase-level external adapter mapping. | `src/services/sprint/sprintWorkerRouter.ts`, `src/services/sprint/sprintOrchestrator.test.ts`, `docs/contracts/SPRINT_DATA_FLOW.md` |

## Review Checklist

When a future audit starts from DeepWiki, verify these local surfaces immediately:

1. Regenerate generated docs with `npm run docs:build` before trusting route or dependency inventories.
2. Compare runtime routes against `runtimeRoutes.ts`, not only prior generated markdown.
3. Compare sprint adapter claims against `sprintWorkerRouter.ts` and its tests.
4. Compare personalization behavior against both snapshot generation and session-application code paths.
5. Treat `tmp/openjarvis-memory-feed/summary.json` as the freshness contract for OpenJarvis memory projection status.
