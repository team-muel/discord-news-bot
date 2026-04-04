# God Object Decomposition Plan

> Status: PLANNING | Created: 2026-04-04

## Target Files (>1000 lines, production code)

| File | Lines | Core Concern | Risk |
|------|-------|-------------|------|
| `sprintOrchestrator.ts` | 1559 | Sprint phase FSM + pipeline advancer | HIGH |
| `actionRunner.ts` | 1442 | Action execution + retry + governance | HIGH |
| `bot.ts` | 1376 | Discord client lifecycle + event wiring | MED |
| `llmClient.ts` | 1332 | LLM provider abstraction + hedging | HIGH |
| `memoryJobRunner.ts` | 1193 | Job consumption + deadletter recovery | MED |
| `multiAgentService.ts` | 1132 | Multi-agent session orchestration | MED |

## Phase 1: Safe Config/State Extraction (LOW risk)

Extract env-var configuration blocks and independent caches from each God Object into co-located config modules. No logic change, just separation of concerns.

### Candidates

- `sprintOrchestrator.ts` → `sprintOrchestratorConfig.ts` (~80 lines of env vars)
- `actionRunner.ts` → `actionRunnerConfig.ts` (~60 lines of env vars)
- `bot.ts` → `botConfig.ts` (~90 lines of env vars, already partially in `config.ts`)
- `llmClient.ts` → `llmProviderConfig.ts` (~70 lines of provider constants)
- `memoryJobRunner.ts` → `memoryJobConfig.ts` (~50 lines of env vars)
- `multiAgentService.ts` → `multiAgentConfig.ts` (~75 lines of settings)

### Execution Pattern

```typescript
// Before (in God Object):
const MAX_RETRIES = parseInt(process.env.X || '3', 10);
const ENABLE_FEATURE = process.env.Y === 'true';

// After (extracted config):
// actionRunnerConfig.ts
export const ACTION_RUNNER_MAX_RETRIES = parseInt(process.env.X || '3', 10);
export const ACTION_RUNNER_ENABLE_FEATURE = process.env.Y === 'true';

// actionRunner.ts
import { ACTION_RUNNER_MAX_RETRIES, ACTION_RUNNER_ENABLE_FEATURE } from './actionRunnerConfig';
```

## Phase 2: Persistence Layer Extraction (MED risk)

Extract Supabase query functions into dedicated data-access modules.

### Candidates

- `sprintOrchestrator.ts` → `sprintPipelineStore.ts` (pipeline CRUD, ~200 lines)
- `memoryJobRunner.ts` → `memoryJobStore.ts` (job queue queries, ~300 lines)
- `actionRunner.ts` → `actionRunStore.ts` (action log persistence, ~150 lines)

## Phase 3: Snapshot/Serialization Extraction (LOW risk)

Extract runtime snapshot builders and API serializers.

### Candidates

- `bot.ts` → `botRuntimeSnapshot.ts` (getBotRuntimeSnapshot, ~100 lines)
- `multiAgentService.ts` → `multiAgentSnapshot.ts` (getMultiAgentRuntimeSnapshot, ~120 lines)
- `sprintOrchestrator.ts` → `sprintSnapshot.ts` (getSprintSummary/status, ~100 lines)

## Phase 4: Core Logic Decomposition (HIGH risk, requires careful planning)

Only after Phases 1-3 reduce file sizes:

- `sprintOrchestrator.ts`: Extract phase executor dispatch table
- `actionRunner.ts`: Extract goal runner loop
- `bot.ts`: Extract interaction handler registry
- `llmClient.ts`: Extract per-provider adapter implementations

## Execution Rules

1. One file per PR — never decompose 2 God Objects simultaneously
2. Re-export everything from original module to maintain public API
3. Run full test suite after each extraction
4. Each phase should reduce the target file by 15-25%
5. Never extract coupled sections — if two functions share mutable state, they stay together

## Priority Order

1. `memoryJobRunner.ts` — highest extraction maturity (8.5/10), clean section boundaries
2. `bot.ts` → `botRuntimeSnapshot.ts` — pure serialization, zero coupling
3. `sprintOrchestrator.ts` → config + snapshot extraction
4. `actionRunner.ts` → config extraction
5. `llmClient.ts` — last, highest coupling complexity
