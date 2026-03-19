# Multi-Agent Node Extraction Target State

## Purpose

이 문서는 [src/services/multiAgentService.ts](src/services/multiAgentService.ts) 를 LangGraph-style node runtime으로 분해할 때의 target state를 확정한다.

이번 단계의 목적은 구현이 아니라 경계 확정이다.

- 무엇을 `multiAgentService.ts` 에 남길지
- 무엇을 node runtime으로 추출할지
- 어떤 순서로 분해해도 외부 계약이 깨지지 않는지

## Scope

포함 범위:

- 세션 실행 코어의 node extraction target state
- `executeSession` 중심 제어 흐름의 책임 재배치
- rollout 시 rollback 가능한 경계와 단계 정의

비포함 범위:

- Discord command 계약 변경
- REST route 계약 변경
- skill 구현 변경
- ToT/GoT 정책 수치 변경
- Supabase 스키마 변경

## Current State Summary

현재 [src/services/multiAgentService.ts](src/services/multiAgentService.ts) 는 아래 네 역할을 한 파일에서 동시에 수행한다.

1. Public session facade

- `startAgentSession`
- `cancelAgentSession`
- `getAgentSession`
- `listGuildAgentSessions`
- `serializeAgentSessionForApi`
- `getMultiAgentRuntimeSnapshot`

1. Runtime orchestration

- `executeSession`
- `handleRequestedSkillBranch`
- `handleFastPriorityBranch`
- `handleBalancedOrPreciseBranch`
- `runStep`

1. Runtime infrastructure

- in-memory `sessions`
- `MultiAgentRuntimeQueue`
- timeout / queue drain / retry / prune 처리
- terminal transition 및 persistence trigger

1. Deliberation and quality logic

- least-to-most decomposition
- self-refine lite
- ToT shadow exploration
- self-consistency compose
- candidate promotion / telemetry

문제는 node contract가 이미 일부 존재하는데도 실제 실행의 주제별 경계가 아직 파일 기준으로 묶여 있다는 점이다.

이미 존재하는 node-aligned surface:

- `runCompilePromptNode`
- `runRouteIntentNode`
- `runPolicyGateNode`
- `runTaskPolicyGateTransitionNode`
- `runNonTaskIntentNode`
- `runHydrateMemoryNode`
- `runPersistAndEmitNode`

반대로 아직 `multiAgentService.ts` 안에 남아 있는 핵심 경계는 아래다.

- strategy selection
- requested-skill / fast / balanced-precise branch execution
- plan/research/critic execution trilogy
- final compose / refine / promote
- retry-safe terminalization contract

## Boundary Decision

### 1. What Stays In multiAgentService

`multiAgentService.ts` 는 최종적으로 session facade + runtime host 로 축소한다.

남겨야 하는 책임:

- public API export surface 유지
- session map ownership
- queue runtime ownership
- policy cache priming at session start
- queue drain scheduling
- retry and deadletter wiring
- test reset hook

즉, 이 파일은 앞으로 "세션을 받는다, 런타임을 시작한다, 상태를 노출한다" 까지만 책임진다.

### 2. What Moves To Node Runtime

실질적인 세션 처리 흐름은 node runner 계층으로 이동한다.

이동 대상 책임:

- compiled prompt 생성과 executionGoal 확정
- intent 분류와 privacy gate
- non-task short-circuit
- memory hydration
- execution strategy selection
- requested skill fast path 처리
- balanced/precise plan-research-critic 처리
- final compose / self-consistency / self-refine
- ToT/GoT candidate evaluation and promotion
- terminal result normalization

### 3. What Becomes Shared Runtime Support

아래는 node가 아니라 support contract로 분리하는 것이 맞다.

- timeout and budget helpers
- step transition writer
- terminal session writer
- shadow trace append helper
- candidate evaluation helper
- deliverable sanitization / final formatting helper

이 영역은 "재사용 가능한 런타임 프리미티브" 이며 노드 자체가 아니다.

## Target State Architecture

목표 구조는 아래 3층이다.

1. Session facade layer

- 위치: `multiAgentService.ts`
- 역할: start/cancel/get/list/snapshot/serialize

1. Session runtime layer

- 위치: `src/services/langgraph/sessionRuntime/*` 또는 동등한 전용 폴더
- 역할: session execution graph 구성, node 연결, branch transition

1. Runtime support layer

- 위치: `src/services/langgraph/runtimeSupport/*` 또는 동등한 전용 폴더
- 역할: time budget, step writer, result formatter, evaluation, terminalization

## Canonical Node Extraction Set

target state에서 세션 실행은 아래 canonical node set을 기준으로 본다.

### Stage A. Ingress And Safety

1. `compile_prompt`
2. `route_intent`
3. `task_policy_gate`
4. `non_task_exit`
5. `hydrate_memory`
6. `select_execution_strategy`

### Stage B. Strategy Nodes

1. `execute_requested_skill`
2. `execute_fast_path`
3. `plan_task`
4. `research_task`
5. `critic_review`

### Stage C. Deliberation And Promotion

1. `tot_shadow_explore`
2. `compose_final`
3. `final_self_consistency`
4. `final_self_refine`
5. `promote_best_candidate`

### Stage D. Terminalization

1. `finalize_session_result`
2. `persist_and_emit`

## Edge Policy

필수 분기 규칙은 아래와 같이 고정한다.

1. `task_policy_gate`

- `block` -> `finalize_session_result` -> `persist_and_emit`
- `allow|review` -> 다음 단계 진행

1. `non_task_exit`

- `casual_chat|uncertain` short-circuit -> `finalize_session_result` -> `persist_and_emit`
- `task` -> `hydrate_memory`

1. `select_execution_strategy`

- `requested_skill` -> `execute_requested_skill`
- `fast_path` -> `execute_fast_path`
- `full_review` -> `plan_task`

1. `critic_review`

- always -> `tot_shadow_explore`

1. `promote_best_candidate`

- selected candidate -> `finalize_session_result`

## Explicit Non-Goals For Extraction

이번 분해에서 하지 말아야 할 것:

- step 개수 자체를 현재보다 더 세분화해서 외부 progress contract를 바꾸는 것
- queue 구현을 교체하는 것
- `AgentSession` 저장 형식을 바꾸는 것
- Discord 응답 렌더링 포맷을 바꾸는 것
- Obsidian graph-first retrieval 기본 전략을 chunk-first로 바꾸는 것

## Stable Contracts During Migration

분해 이후에도 아래 계약은 동일해야 한다.

### Public API Contract

- `startAgentSession(...)`
- `cancelAgentSession(...)`
- `getAgentSession(...)`
- `listGuildAgentSessions(...)`
- `listAgentDeadletters(...)`
- `serializeAgentSessionForApi(...)`
- `getMultiAgentRuntimeSnapshot()`

### Runtime Safety Contract

- session timeout fail-closed 유지
- step timeout fail-closed 유지
- cancel request 즉시 반영 유지
- retry/deadletter 경로 유지
- privacy block 결과가 fast/requested-skill shortcut을 우회하지 않음

### Output Contract

- user-facing deliverable에서 debug marker 노출 금지
- wrapped deliverable도 sanitize 유지
- final result는 현재 citation-first / confidence summary 규칙과 호환 유지

## Milestones

### Milestone 1. Contract Freeze

Entry:

- 현재 `executeSession` 분기와 external API 목록이 문서 기준으로 확정됨

Exit:

- node set, edge policy, non-goals, stable contract가 문서화됨
- OpenCode는 이 문서를 기준으로만 분해 시작 가능

### Milestone 2. Support Primitive Extraction

Entry:

- formatting / evaluation / timeout / terminalization helper를 런타임 프리미티브로 분리할 준비가 됨

Exit:

- `multiAgentService.ts` 에서 pure helper와 side-effect helper가 분리됨
- session facade public API는 unchanged

### Milestone 3. Runtime Graph Composition

Entry:

- branch helper가 node runner로 감싸질 수 있음

Exit:

- `executeSession` 는 graph compose + transition dispatch 수준으로 축소됨
- requested-skill / fast / full-review 경로가 node edge로 표현됨

### Milestone 4. Facade-Only multiAgentService

Entry:

- node runtime이 production-equivalent behavior를 재현함

Exit:

- `multiAgentService.ts` 는 session facade + queue host + snapshot serialization만 보유
- rollback은 기존 facade를 유지한 채 runtime implementation switch 로 가능

## Risks And Mitigations

1. Risk: extraction 과정에서 shortcut branch가 privacy review를 우회할 수 있음

Mitigation:

- `select_execution_strategy` 이전에 privacy gate를 고정
- review decision은 requested-skill/fast path 진입 차단 규칙으로 테스트 고정

1. Risk: final compose, self-refine, promotion이 서로 다른 위치로 흩어져 quality drift가 발생할 수 있음

Mitigation:

- `compose_final -> final_self_consistency -> final_self_refine -> promote_best_candidate` 순서를 canonical order로 고정

1. Risk: retry와 terminal persistence가 node 내부로 새어 들어가 side effect 중복이 발생할 수 있음

Mitigation:

- retry/deadletter/terminal persistence는 runtime host ownership 유지
- node는 outcome만 반환하고 terminal write는 host가 담당

1. Risk: progress summary와 API serialization이 내부 node granularity에 끌려 변경될 수 있음

Mitigation:

- external progress step contract는 현행 3-step planner/researcher/critic view 유지
- 내부 node 증가는 shadowGraph trace에서만 노출

## Acceptance Criteria

- OpenDev target state로 boundary와 non-goals가 명확하다.
- OpenCode는 새 파일 배치와 extraction 순서를 이 문서만으로 결정할 수 있다.
- NemoClaw는 review 시 public API drift와 runtime safety drift를 이 문서 기준으로 검사할 수 있다.
- OpenJarvis는 rollout 시 rollback point를 이 문서 기준으로 설명할 수 있다.

## Next Owner Handoff

다음 단계의 OpenCode 구현 범위는 아래에 한정한다.

1. support primitive extraction first
2. strategy selection node extraction second
3. balanced/precise execution chain extraction third
4. terminalization은 host ownership 유지

즉, 첫 구현 슬라이스에서 `multiAgentService.ts` 의 public facade와 queue ownership은 건드리지 않는다.
