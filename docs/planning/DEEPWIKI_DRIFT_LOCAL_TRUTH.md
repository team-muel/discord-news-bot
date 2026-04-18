# DeepWiki Drift Local Truth

DeepWiki was reindexed for this repository on 2026-04-18 and should be used again for broad architecture recall, topology recovery, and historical intent. This file records the local verification points that still matter when runtime-exact behavior is important.

## Usage Rule

- Use DeepWiki first for topology, historical intent, and first-pass code archaeology.
- Verify runtime behavior, routes, worker mappings, and generated inventories from local code before treating DeepWiki output as authoritative for live behavior.
- Prefer the local canonical source listed below when DeepWiki, cached summaries, and the workspace disagree.

## Local Verification Points

| Surface | Why verify locally | Local truth | Canonical local source |
| --- | --- | --- | --- |
| Runtime admin routes | Route summaries can flatten recently added admin surfaces. | Current runtime exposes personalization and memory-sync admin endpoints. | `src/routes/bot-agent/runtimeRoutes.ts`, regenerated `docs/ROUTES_INVENTORY.md` |
| Personalization workflow | Workflow summaries can read as requested-priority only. | Runtime may switch balanced requests to an effective personalized priority; workflow snapshots should reflect the effective priority. | `src/services/agent/agentPersonalizationService.ts`, `src/services/multiAgentService.ts` |
| OpenJarvis memory sync trigger | A `202` trigger can still be misread as synchronous completion. | Runtime trigger is queue-oriented; freshness is checked from `tmp/openjarvis-memory-feed/summary.json`. | `src/services/openjarvis/openjarvisMemorySyncStatusService.ts` |
| Retrieval variant vocabulary | Variant names appear in multiple drift-prone places. | Retrieval variants are centralized for runtime and weekly scripts. | `config/runtime/retrievalVariants.js` |
| Sprint phase adapters | Cached explanations can still flatten current phase-adapter routing. | `implement` and `ship` currently have no phase-level external adapter mapping. | `src/services/sprint/sprintWorkerRouter.ts`, `src/services/sprint/sprintOrchestrator.test.ts`, `docs/contracts/SPRINT_DATA_FLOW.md` |

## Review Checklist

When a future audit starts from DeepWiki, verify these local surfaces immediately:

1. Regenerate generated docs with `npm run docs:build` before trusting route or dependency inventories.
2. Compare runtime routes against `runtimeRoutes.ts`, not only prior generated markdown.
3. Compare sprint adapter claims against `sprintWorkerRouter.ts` and its tests.
4. Compare personalization behavior against both snapshot generation and session-application code paths.
5. Treat `tmp/openjarvis-memory-feed/summary.json` as the freshness contract for OpenJarvis memory projection status.
