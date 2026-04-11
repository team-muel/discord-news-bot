# Domain Contract: Sprint Data Flow

> Defines data flow through the sprint pipeline: plan → implement → review → qa → ship → retro.

## Boundary

- **Orchestrator**: `src/services/sprint/sprintOrchestrator.ts`
- **State store**: Supabase `sprint_pipelines` table
- **Actions**: `src/services/skills/actions/` (registered in `registry.ts`)
- **Outputs**: Obsidian vault (retro notes), Discord (status updates), Supabase (metrics)

## Pipeline Architecture

```
/plan → /implement → /review → /qa → /security-audit → /ops-validate → /ship → /retro
  │         │           │        │          │                │            │        │
  │         │           │        │          │                │            │        └→ Obsidian retro note
  │         │           │        │          │                │            └→ git push / PR
  │         │           │        │          │                └→ rollback validation
  │         │           │        │          └→ OWASP/STRIDE findings
  │         │           │        └→ test results + regression tests
  │         │           └→ code review findings
  │         └→ code changes + test files
  └→ plan document (ADR or sprint spec)
```

## Required Transformations

### 1. Phase Transition Rules

Phase transitions are governed by `PHASE_TRANSITIONS` in `sprintOrchestrator.ts`:

- Each phase MUST complete its gate checks before advancing
- Backward transitions (e.g., review → implement) are allowed for rework
- Sprint state MUST be persisted to Supabase after every transition

### 2. Action → Phase Mapping

Actions are scoped to phases via `PHASE_TOOL_CATEGORIES` in `sprintPreamble.ts`:

| Phase | Allowed Action Categories |
|---|---|
| plan | research, document |
| implement | code, test, document |
| review | analysis, code (auto-fix only) |
| qa | test, analysis |
| security-audit | analysis, security |
| ops-validate | infrastructure, analysis |
| ship | deploy, document |
| retro | document, analysis |

**Forbidden**: Executing code-category actions during review phase (except auto-fix).

### 3. Sprint State Schema

```ts
{
  id: string;           // sprint UUID
  guild_id: string;
  phase: SprintPhase;
  objective: string;
  plan?: object;        // from /plan phase
  changed_files: string[];
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}
```

### 4. Retro → Obsidian Write

Sprint retro MUST write summary to Obsidian vault:

```ts
// agentCollab.ts — retroSummarizeAction
void writeRetroToVault({
  guildId,
  sprintId,
  summary,
  lessonsLearned,
}).catch(() => {}); // fire-and-forget, non-blocking
```

This is currently the only sprint phase that writes to Obsidian.

### 5. Changed File Cap

Sprint pipeline enforces a maximum changed file count per sprint to prevent scope creep. The cap is checked during `/ship` phase.

### 6. Governance Gates

- **Autonomy policy**: `instructions/autonomy-policy.instructions.md` defines HITL thresholds
- **FinOps budget**: LLM API cost tracked per sprint, circuit breaker on overspend
- **Review loops**: `SPRINT_MAX_IMPL_REVIEW_LOOPS` caps implement↔review cycles

## Forbidden Patterns

- Skipping phases (e.g., plan → ship without implement/review/qa)
- Executing actions outside their phase category scope
- Writing sprint state to local files instead of Supabase

## External Adapter Composite Execution

### Architecture

Each phase can have a **primary** and optional **secondary** external adapter defined in `PHASE_EXTERNAL_ADAPTER` (`sprintWorkerRouter.ts`):

```
Phase dispatch → MCP worker → External Adapter (primary) → External Adapter (secondary, optional) → Local action fallback
```

Type definition:

```ts
type PhaseAdapterMapping = {
  adapter: ExternalAdapterId;
  capability: string;
  secondary?: { adapter: ExternalAdapterId; capability: string };
};
```

### Execution Flow

1. **Primary adapter** executes first via `executeExternalAction()`
2. If primary succeeds AND a `secondary` mapping exists, secondary adapter runs with `buildSecondaryAdapterArgs()`
3. Secondary output is appended to primary output with `--- Secondary Analysis ---` separator
4. Secondary failure does NOT fail the phase — primary result is preserved (append-only safety)
5. Combined output stored in `PhaseResult.adapterMeta.secondary`

### Current Phase Mappings

| Phase | Primary Adapter | Secondary Adapter |
|---|---|---|
| plan | deepwiki (wiki.ask) | openjarvis (jarvis.research) |
| implement | openclaw (agent.chat) | — |
| review | nemoclaw (code.review) | deepwiki (wiki.diagnose) |
| qa | openjarvis (jarvis.ask) | openshell (sandbox.exec) |
| security-audit | nemoclaw (code.review) | openjarvis (jarvis.memory.search) |
| ops-validate | openjarvis (jarvis.telemetry) | openjarvis (jarvis.ask) |
| ship | — | — |
| retro | deepwiki (wiki.ask) | openjarvis (jarvis.digest) |

### Phase Enrichment

`PHASE_ENRICHMENT_MAP` in `sprintPreamble.ts` injects context from external adapters before phase execution:

- 34 enrichment actions across all 8 phases
- Each enrichment maps to an `ext.<adapterId>.<capability>` MCP tool call
- Enrichment failures are non-blocking (context injection is best-effort)
- DeepWiki enrichment is now used beyond plan/retro to surface repo-specific regression, QA, security, and operational diagnostic risks.

### OpenClaw Session Bootstrap

Before the `implement` phase, `bootstrapOpenClawSession()` registers all `ext.*` tools as OpenClaw session skills:

- Sends tool catalog as system message to OpenClaw session endpoint
- Idempotent per `sessionId` (tracked via `registeredSkills` Set)
- Requires `OPENCLAW_GATEWAY_URL` and `OPENCLAW_GATEWAY_TOKEN`

### ext.* MCP Bridge

`unifiedToolAdapter.ts` routes `ext.<adapterId>.<capability>` tool calls through `executeExternalAction()`:

- Namespace: `ext.` prefix isolates external tools from core MCP tools
- Example: `ext.openjarvis.jarvis.research` → openjarvis adapter, `jarvis.research` capability
- Self-routing excluded (e.g., openclaw adapter skips itself during bootstrap)
- Retro without writing to Obsidian vault (note: currently no-op if vault unconfigured)

## Test References

- `src/services/sprint/` — orchestrator and phase transition tests
- `src/services/skills/actions/` — individual action tests

## Related Contracts

- [DISCORD_SOCIAL_GRAPH.md](./DISCORD_SOCIAL_GRAPH.md) — retro reads community data
- [MEMORY_TO_OBSIDIAN.md](./MEMORY_TO_OBSIDIAN.md) — retro writes to vault via Obsidian contract
