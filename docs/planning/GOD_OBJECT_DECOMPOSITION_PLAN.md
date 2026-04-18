# God Object Decomposition Plan

> Status: CLOSED FOR M-21 STRUCTURAL WAVE | Created: 2026-04-04 | Updated: 2026-04-18

## Target Files (>1000 lines, production code)

| File | Lines | Core Concern | Risk |
| ---- | ----- | ------------ | ---- |
| `sprintOrchestrator.ts` | 1559 | Sprint phase FSM + pipeline advancer | HIGH |
| `actionRunner.ts` | 1442 | Action execution + retry + governance | HIGH |
| `bot.ts` | 1376 | Discord client lifecycle + event wiring | MED |
| `llmClient.ts` | 1332 | LLM provider abstraction + hedging | HIGH |
| `memoryJobRunner.ts` | 1193 | Job consumption + deadletter recovery | MED |
| `multiAgentService.ts` | 1132 | Multi-agent session orchestration | MED |

## Phase 1: Safe Config/State Extraction (LOW risk)

Extract env-var configuration blocks and independent caches from each God Object into co-located config modules. No logic change, just separation of concerns.

### Config Candidates

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

### Persistence Candidates

- `sprintOrchestrator.ts` → `sprintPipelineStore.ts` (pipeline CRUD, ~200 lines)
- `memoryJobRunner.ts` → `memoryJobStore.ts` (job queue queries, ~300 lines)
- `actionRunner.ts` → `actionRunStore.ts` (action log persistence, ~150 lines)

## Phase 3: Snapshot/Serialization Extraction (LOW risk)

Extract runtime snapshot builders and API serializers.

### Snapshot Candidates

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

## 2026-04-18 Bounded Parallel Wave

최근 코드베이스 진단 기준으로 현재 가장 큰 구조 병목은 아래 3개다.

- `src/routes/bot-agent/runtimeRoutes.ts` — runtime admin/control-plane route 집중
- `src/services/obsidian/knowledgeCompilerService.ts` — compile/promotion/lint/supervision 책임 집중
- `src/config.ts` — 다도메인 flat export 집중

이번 wave의 목적은 기능 추가가 아니라 boundary collapse를 줄이는 것이다.

- 외부 route/API 계약은 바꾸지 않는다.
- 기존 import surface는 유지한다.
- 첫 wave는 low-risk extraction만 허용한다.
- 각 worker는 하나의 shard만 가진다.

### Parallel Worker Guardrails

`docs/planning/HERMES_GPT_DUAL_AGENT_RUNTIME_CONTRACT.md`의 bounded parallel worker rule을 그대로 따른다.

1. 한 wave는 하나의 objective만 가진다: `M-21 구조 복잡도 축소를 위한 low-risk extraction wave`
2. 병렬 worker는 최대 3개까지만 연다.
3. 각 worker는 하나의 shard와 하나의 artifact budget만 가진다.
4. code-writing worker는 가능하면 worktree를 분리한다.
5. merge 전에는 shard별 검증과 wave-level full validation을 모두 통과해야 한다.

### Wave 1 Shards

| Worker | Shard | First Slice | Artifact Budget | Exit Condition |
| ---- | ----- | ----------- | --------------- | -------------- |
| A | `runtimeRoutes.ts` | `runtime-builders/paramValidation.ts` + `runtime-subareas/workerHealthRoutes.ts` 추출 | 신규 파일 2개 + 기존 route 파일 1개 + 관련 테스트 보정 | route path/response contract 불변, targeted route tests + full suite green |
| B | `knowledgeCompilerService.ts` | `obsidianPathUtils.ts` 추출 | 신규 파일 1개 + 기존 service 파일 1개 + 신규 unit test 1개 | pure helper 분리만 수행, compiler/promote behavior 불변, targeted obsidian tests + full suite green |
| C | `config.ts` | `src/config/configCore.ts` + `src/config/index.ts` 도입, `src/config.ts` shim 유지 | 신규 파일 2개 + 기존 config shim 1개 + 기존 테스트 유지 | 기존 `../config` import 전부 유지, `tsc --noEmit` + config 관련 tests green |

### Wave 1 Merge Order

병렬로 착수하더라도 merge는 아래 순서를 권장한다.

1. Worker B `knowledgeCompilerService.ts` helper extraction
2. Worker A `runtimeRoutes.ts` route subarea extraction
3. Worker C `config.ts` barrel/shim extraction

이 순서는 conflict risk와 blast radius를 기준으로 정한다.

- Worker B는 pure helper extraction이라 회귀 위험이 가장 낮다.
- Worker A는 route registration 경계만 건드리므로 contract 검증이 비교적 명확하다.
- Worker C는 backward-compatible slice라도 import surface에 대한 신뢰가 필요하므로 마지막 merge가 안전하다.

### Phase Plan After Wave 1

Wave 1이 green이면 다음 bounded wave를 연다.

- `runtimeRoutes.ts`: `openjarvisRoutes.ts`, `snapshotRoutes.ts`, shared summarizer helpers
- `knowledgeCompilerService.ts`: `obsidianCatalogService.ts`, 이후 `obsidianPromotionService.ts` 검토
- `config.ts`: `configDiscord.ts`, `configSprint.ts`, 나머지 domain split

### Validation Contract

각 shard는 아래 기준을 충족해야 close 가능하다.

1. public API와 route path는 바뀌지 않는다.
2. 기존 root import surface 또는 original file export surface는 유지된다.
3. shard-local targeted test를 먼저 돌리고, merge 직전 full suite를 다시 돌린다.
4. extraction은 15-25% file size reduction 또는 명확한 boundary isolation을 만들어야 한다.
5. 서로 strongly coupled한 section은 같은 wave에서 억지로 분리하지 않는다.

### Wave 1 Closeout

Wave 1은 2026-04-18 기준으로 close했다.

- A: `runtime-builders/paramValidation.ts` + `runtime-subareas/workerHealthRoutes.ts`
- B: `obsidianPathUtils.ts`
- C: `src/config/configCore.ts` + `src/config/index.ts` + `src/config.ts` shim
- validation: focused tests green, `tsc --noEmit` green, full Vitest suite green (`2041 passed`)

Wave 1 종료 의미는 아래와 같다.

- `runtimeRoutes.ts`는 worker-health와 공통 param parsing이 분리된 상태다.
- `knowledgeCompilerService.ts`는 path/slug/path-classification 계열 pure helper가 분리된 상태다.
- `config.ts`는 shim + barrel 구조를 이미 도입했으므로 이후 domain split은 backward-compatible하게 이어갈 수 있다.

### Wave 2 Shards

Wave 2는 여전히 bounded parallel wave로 열 수 있지만, Wave 1보다 coupling이 올라간다.

| Worker | Shard | Wave 2 Slice | Artifact Budget | Exit Condition |
| ---- | ----- | ------------ | --------------- | -------------- |
| A | `runtimeRoutes.ts` | `runtime-subareas/openjarvisRoutes.ts` 추출 | 신규 파일 1개 + 기존 route 파일 1개 + 관련 route test 보정 | OpenJarvis/Hermes runtime endpoints의 path, body, response shape 불변 |
| B | `knowledgeCompilerService.ts` | `obsidianCatalogService.ts` 추출 | 신규 파일 1개 + 기존 service 파일 1개 + catalog unit test 1개 | catalog load/coverage/selection behavior 불변, bundle compiler caller contract 불변 |
| C | `config.ts` | `src/config/configDiscord.ts` 추출 + `src/config/index.ts` re-export 확장 | 신규 파일 1개 + 기존 config barrel/configCore 정리 + 기존 test 유지 | 기존 `../config` import surface 불변, Discord/runtimePolicy 관련 import 회귀 없음 |

### Wave 2 Merge Order

Wave 2 merge는 아래 순서를 권장한다.

1. Worker B `obsidianCatalogService.ts`
2. Worker A `openjarvisRoutes.ts`
3. Worker C `configDiscord.ts`

이 순서는 아래 이유로 고정한다.

- Worker B는 read-heavy catalog extraction이라 write-path coupling이 아직 낮다.
- Worker A는 route split이지만 OpenJarvis/Hermes admin surface가 넓어 route smoke coverage가 필요하다.
- Worker C는 import surface blast radius가 가장 넓으므로 마지막이 안전하다.

### Wave 2 Closeout

Wave 2는 2026-04-18 기준으로 close했다.

- A: `runtime-subareas/openjarvisRoutes.ts`
- B: `obsidianCatalogService.ts`
- C: `src/config/configDiscord.ts` + `src/config/index.ts` re-export 확장
- validation: route smoke + obsidian catalog + config focused tests green (`14 passed`), `tsc --noEmit` green, current lint gate green, full Vitest suite green (`2053 passed`)

Wave 2 종료 의미는 아래와 같다.

- `runtimeRoutes.ts`는 worker-health에 이어 OpenJarvis/Hermes runtime admin surface까지 subarea로 분리된 상태다.
- `knowledgeCompilerService.ts`는 path utils에 이어 catalog load/coverage/selection 경계가 service boundary로 분리된 상태다.
- `config.ts`는 shim을 유지한 채 Discord/runtimePolicy 계열 domain config를 별도 module로 분리한 상태다.

### Wave 3 Shards

Wave 3는 마지막 bounded parallel wave다. 목표는 M-21 structural baseline을 충족하되 `knowledgeCompilerService.ts`의 promotion 경계를 아직 열지 않는 것이다.

| Worker | Shard | Wave 3 Slice | Artifact Budget | Exit Condition |
| ---- | ----- | ------------ | --------------- | -------------- |
| A | `runtimeRoutes.ts` | `runtime-subareas/snapshotRoutes.ts` 추출 + shared snapshot/report helper 정리 | 신규 파일 1-2개 + 기존 route 파일 1개 + route smoke test 보정 | `/agent/runtime/loops`, `/agent/runtime/operator-snapshot`, `/agent/runtime/workset`, `/agent/runtime/knowledge-control-plane`, `/agent/runtime/readiness`, `/agent/runtime/slo/*`, `/agent/finops/*`, `/agent/llm/experiments/summary` contract 불변 |
| B | `config.ts` | `src/config/configSprint.ts` 추출 + `src/config/index.ts` re-export 확장 | 신규 파일 1개 + 기존 barrel 1개 + config test/typecheck 재검증 | 기존 `../config` import surface 불변, sprint/autonomy/guard/learning-journal env parse regression 없음 |

`configSprint.ts`에는 최소한 아래 영역을 우선 수용한다.

- `SPRINT_*`
- `VENTYD_*`
- sprint cross-model / scope guard / judge / autoplan / learning-journal 계열
- `MCP_FAST_FAIL_TIMEOUT_MS`

Wave 3에서 `knowledgeCompilerService.ts`는 stabilization only다.

- 허용: import/type cleanup, Wave 2 extraction fallout 정리, targeted test 보강
- 금지: `promotion`, `semantic lint`, `supervisor`, `control surface` 계열 신규 service extraction

### Wave 3 Merge Order

Wave 3 merge는 아래 순서를 권장한다.

1. Worker B `configSprint.ts`
2. Worker A `snapshotRoutes.ts`

이 순서는 아래 이유로 고정한다.

- Worker B는 export-domain move라 blast radius는 넓지만 검증면이 `tsc --noEmit`와 config tests로 비교적 명확하다.
- Worker A는 operator-facing runtime route surface를 건드리므로 smoke coverage와 registration 검증을 마지막에 잠그는 편이 안전하다.
- Wave 3는 마지막 병렬 wave이므로 runtime boundary는 config barrel 안정화 이후 닫는 것이 낫다.

### Wave 3 Closeout

Wave 3는 2026-04-18 기준으로 close했다.

- A: `runtime-subareas/snapshotRoutes.ts` + `runtime-builders/snapshotReports.ts`
- B: `src/config/configSprint.ts` + `src/config/index.ts` re-export 확장
- validation: route smoke + config focused tests green (`11 passed`), `tsc --noEmit` green, full Vitest suite green (`2034 passed`)

Wave 3 종료 의미는 아래와 같다.

- `runtimeRoutes.ts`는 `workerHealthRoutes.ts`, `openjarvisRoutes.ts`, `snapshotRoutes.ts`까지 최소 3개 subarea가 명시화된 상태다.
- `config.ts`는 shim을 유지한 채 실제 domain config가 `core`, `discord`, `sprint`로 분리된 상태다.
- `knowledgeCompilerService.ts`는 Wave 1-2 결과로 path utils와 catalog 경계가 이미 분리되어 있으므로, 이번 closeout 시점에 M-21 structural baseline은 충족됐다.

### Post-Wave-3 Process

Wave 3는 이미 close되었고 M-21의 structural baseline도 충족했다. 하지만 lane 자체가 종료되는 것은 아니다. 이제 공정의 목적은 parallel extraction이 아니라 serial hardening으로 전환된다.

추가 운영 규칙도 고정한다.

- 앞으로 남은 공정은 이 현재 Copilot 실행 lane에서만 처리한다.
- 별도 병렬 세션, 추가 worker 분기, 별도 planning lane 재개는 기본값이 아니다.
- 새 세션 분기나 병렬화는 사용자가 다시 명시적으로 요구할 때만 연다.

1. Wave 3 Exit Gate
   - `snapshotRoutes.ts` + `configSprint.ts` merge 완료
   - route smoke + config tests + `tsc --noEmit` + full Vitest green
   - `runtimeRoutes.ts` subarea가 최소 3개로 명시화됨 (`workerHealthRoutes.ts`, `openjarvisRoutes.ts`, `snapshotRoutes.ts`)
   - config domain이 최소 `core`, `discord`, `sprint`로 분리됨
   - 이 시점은 M-21 close가 아니라 serial cleanup lane 진입 신호다
2. Wave 4
   - single-worker 또는 serial merge 기본으로 close했다
   - `knowledgeCompilerService.ts`: `obsidianPromotionService.ts` extraction 완료
   - `runtimeRoutes.ts`: `runtime-subareas/infrastructureRoutes.ts`로 supabase/efficiency/channel-routing/sandbox-policy/self-improvement cluster를 분리했다
   - `config.ts`는 stabilization only를 유지했고, Wave 4에서는 새 config seam을 열지 않았다
3. Wave 5
   - `knowledgeCompilerService.ts`: `obsidianSemanticLintService.ts` extraction 완료
   - `knowledgeCompilerService.ts`: `obsidianKnowledgeSupervisorService.ts` extraction 완료
   - `knowledgeCompilerService.ts`의 promotion/lint/supervisor/control-surface export는 thin wrapper 형태로 유지했다
   - `runtimeRoutes.ts` residual registration glue는 `workerHealth`, `infrastructure`, `openjarvis`, `snapshot` subarea registration만 남는 상태로 닫았다
   - 구조 분해 lane의 primary objective는 이제 extraction 자체가 아니라 stale fallback pruning, circular dependency 해소, domain ownership 정리 같은 후속 hardening으로 전환된다

### Wave 4-5 Closeout

Wave 4와 Wave 5는 2026-04-18 기준으로 close했다.

- Wave 4: `runtime-subareas/infrastructureRoutes.ts`, `obsidianPromotionService.ts`
- Wave 5: `obsidianSemanticLintService.ts`, `obsidianKnowledgeSupervisorService.ts`
- validation: focused regression green (`87 passed`), `tsc --noEmit` green, full Vitest suite green (`2037 passed`)
- outcome: `runtimeRoutes.ts`는 infra cluster를 별도 subarea로 밀어냈고, `knowledgeCompilerService.ts`는 promotion/lint/supervisor/control-surface orchestration만 남긴 얇은 coordination layer가 되었다

### Parallelism Policy After Wave 2

Wave 2 이후 병렬 정책은 아래처럼 낮춘다.

1. Wave 1-2까지만 3 worker 병렬을 허용한다.
2. Wave 3만 2 worker cap을 기본으로 한다.
3. Wave 4부터는 single-worker 또는 serial merge를 기본으로 한다.
4. `knowledgeCompilerService.ts`의 promotion/lint/supervision/control-surface 경계는 Wave 3 이후 병렬로 열지 않는다.
5. shared helper를 2개 이상의 shard가 동시에 수정해야 하는 순간, bounded parallel wave를 중단하고 단일 coordinator lane으로 내린다.
6. 현재 override는 `single-lane here`다. 남은 공정은 이 세션의 단일 execution lane에서 끝까지 처리한다.

### Exit Criteria For M-21 Structural Wave

M-21의 이번 structural wave는 아래 조건이 모두 만족되면 종료한다.

1. `runtimeRoutes.ts`는 worker-health, OpenJarvis/Hermes, snapshot/report, infra/optimization 중 최소 3개 이상의 명시적 subarea로 분리된다.
2. `knowledgeCompilerService.ts`는 path utils, catalog, promotion 중 최소 2개 이상이 service boundary로 분리된다.
3. `config.ts`는 shim만 유지하고 실제 domain config가 최소 `core`, `discord`, `sprint`로 나뉜다.
4. full test suite와 typecheck가 green이다.
5. 이후 lane의 primary objective가 더 이상 extraction 자체가 아니라 residual coupling cleanup으로 전환된다.

위 조건은 2026-04-18 closeout 시점에 모두 충족됐다.
