# LangGraph StateGraph Blueprint (Prep)

이 문서는 현재 코드베이스를 LangGraph로 점진 전환할 때 필요한 최소 계약을 정의합니다.

## 1) Goal

- 내부 CoT를 노드 상태로 관리하고, 사용자 출력에는 중간 추론을 노출하지 않는다.
- 성공/강등/실패를 동일 계약으로 정규화해 재시도/게이트/관측성을 일관화한다.
- 기존 서비스(`multiAgentService`, `actionRunner`, `promptCompiler`)를 즉시 폐기하지 않고 어댑터로 감싼다.

## 2) Node Plan

1. ingest
2. compile_prompt
3. route_intent
4. hydrate_memory
5. plan_actions
6. execute_actions
7. critic_review
8. policy_gate
9. compose_response
10. persist_and_emit

## 3) Edge Policy

- intent route:
  - task -> hydrate_memory
  - casual_chat -> compose_response
  - uncertain -> compose_response
- execution route:
  - success -> critic_review
  - degraded -> critic_review
  - failure -> policy_gate
- gate route:
  - policy_block -> compose_response
  - success/degraded -> compose_response
  - failure -> persist_and_emit

## 4) State Contract

공통 상태 타입은 [src/services/langgraph/stateContract.ts](src/services/langgraph/stateContract.ts) 에 정의했다.

핵심 필드:

- originalGoal, executionGoal
- compiledPrompt
- intent
- memoryHints
- plans
- outcomes
- policyBlocked
- finalText
- errorCode
- trace

## 5) Current Mapping

- compile_prompt: `compilePromptGoal`
- route_intent: `classifyIntent` (multiAgentService 내부)
- plan_actions: `planActions` / `buildFallbackPlan`
- execute_actions: `runGoalActions`
- critic_review: `ops-critique` skill 경로
- compose_response: `formatCitationFirstResult`
- persist_and_emit: `persistAgentSession` + discord session stream

## 6) CoT Handling Rule

- 허용: 내부 노드 상태(trace, plan.reason, critic result)
- 금지: 사용자 최종 메시지에 단계별 추론 직접 노출
- 출력 정책: Deliverable 중심, Verification/Confidence는 필요한 범위만 유지

## 7) Migration Phases

1. Shadow phase

- 기존 실행 유지, 병렬로 graph state만 생성 및 로깅

2. Dual-run phase

- 선택 트래픽에 graph 실행, 기존 결과와 diff 비교

3. Cutover phase

- primary를 graph로 전환, 기존 파이프라인은 rollback path로 유지

## 8) Release Gates

- runtime gate fail-closed 확인
- degraded/failure 분류 일치율
- session timeout, step timeout 회귀 테스트 통과
- policy block 경로에서 우회 실행이 없는지 확인

## 9) Why This Is CoT-Compatible

- 현재 구조는 planner/researcher/critic 다단계 처리로 이미 CoT 방법론을 사용 중이다.
- 다만 CoT "텍스트"를 노출하지 않고, "상태 그래프"로 보존하는 방식으로 진화시키는 것이 목표다.

## 10) Next Action

- `multiAgentService.executeSession` 내부를 노드 단위 함수로 분리
- 각 노드 함수 시그니처를 `(state) => Promise<state>`로 통일
- 최종적으로 LangGraph `StateGraph` 어댑터를 추가
