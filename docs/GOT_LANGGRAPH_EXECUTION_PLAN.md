# GoT + LangGraph Execution Plan

**Status: CLOSED (2026-03-24)** — State contract(스테이트 계약) 정의 완료, 런타임 수동 상태 머신 유지. LangGraph 전환은 로드맵 종결에 따라 보관. 재개 시 별도 실행 사이클에서 처리한다.

이 문서는 현재 멀티에이전트 런타임을 유지하면서 GoT(Graph of Thoughts) 추론을 도입하고,
그 실행 엔진을 LangGraph 스타일로 점진 전환하기 위한 실행 계획을 정의한다.

## 1. 개념 정리

- GoT: 추론 방법론
  - thought node, edge(지원/반박/병합), selection 이벤트를 통해 최종 결론을 선택한다.
- LangGraph: 실행 프레임워크
  - 노드별 상태 전이, 조건 분기, 재시도/타임아웃/관측성을 제공한다.

정리하면 GoT는 사고 전략, LangGraph는 오케스트레이션 계층이다.

## 2. 현재 코드 기준 상태

- 상태 계약은 이미 정의됨: `src/services/langgraph/stateContract.ts`
- 런타임은 수동 상태머신으로 동작: `src/services/multiAgentService.ts`
- ToT 정책/실험 로그는 이미 저장 중: `docs/SUPABASE_SCHEMA.sql`

이번 변경으로 GoT 실행 상태 저장 스키마가 추가되었다.

## 3. 새 DB 스키마(요약)

- `agent_got_runs`
  - 세션 단위 GoT 실행 메타 정보(상태, 노드/엣지 한도, 선택 결과)
- `agent_got_nodes`
  - thought 노드(유형, depth, score/confidence/novelty/risk)
- `agent_got_edges`
  - 노드 간 관계(expand/support/refute/merge/select/revise)
- `agent_got_selection_events`
  - 단계별 후보 선택/탈락 이벤트

모든 테이블은 guild_id 기준 RLS 정책이 포함된다.

## 4. 권장 롤아웃 순서

1. Shadow GoT

- 기존 최종 응답 경로 유지
- GoT 노드/엣지/selection만 기록
- 목표: 품질 및 latency 기준선 수집

2. Dual-run GoT

- 기존 결과와 GoT 결과를 병렬 생성
- diff 및 승격 조건을 실험 테이블에 저장
- 목표: 승격 정책 정교화

3. Controlled Cutover

- 길드 allowlist 기반으로 GoT 결과 승격 허용
- 실패/지연 시 즉시 baseline 경로로 폴백
- 목표: 운영 안정성 유지

## 5. LangGraph 노드 매핑 가이드

현재 노드 계약:

- ingest
- compile_prompt
- route_intent
- hydrate_memory
- plan_actions
- execute_actions
- critic_review
- policy_gate
- compose_response
- persist_and_emit

GoT 도입 시 execute_actions 내부를 하위 단계로 분해:

- thought_expand
- thought_score
- thought_merge
- thought_select
- thought_finalize

외부 공개 노드 계약은 유지하고 내부 하위 단계만 확장하는 것을 권장한다.

## 6. 운영 지표

필수 모니터링:

- got_run_success_rate
- got_node_count_p95
- got_latency_ms_p95
- got_selection_accept_rate
- baseline_vs_got_score_delta
- fallback_rate

품질 게이트 예시:

- p95 latency 증가율 <= 15%
- fallback_rate <= 10%
- score_delta 평균 > 0

## 7. 구현 시 주의사항

- 사용자 최종 응답에는 내부 추론 체인(CoT/GoT)을 노출하지 않는다.
- 정책 게이트 실패 시 GoT 결과를 승격하지 않는다.
- fast 우선순위는 노드 예산(max_nodes/max_edges)을 더 낮게 유지한다.
- guild 단위 feature flag 없이 전면 전환하지 않는다.
- 기록 경로는 메인 추론 루프에서 분리된 비동기 큐로 처리해, 저장소 지연/장애가 응답 경로를 막지 않도록 한다.

## 8. 다음 구현 항목

- GoT active 승격 경로를 운영 게이트(quality/latency)와 결합
- queue saturation 대비 드롭 정책 알림을 운영 대시보드로 연결
- 회귀 테스트: latency, 정책게이트, 취소/타임아웃, fallback 경로

## 9. 현재 반영 상태

- 완료: GoT shadow 기록 테이블 및 RLS 스키마
- 완료: `agentGotPolicyService`(길드 allowlist + priority 예산)
- 완료: GoT run/node/selection 조회 API
- 완료: 기록 작업 비동기 큐 분리(`agentTelemetryQueue`)
- 완료: GoT 성능 대시보드 확장(semantic cache 절감 지표 + cutover readiness 권고)
- 완료: GoT cutover readiness 권고 신호를 런타임 승격 게이트에 연결
- 완료: 운영 API `/agent/got/cutover-decision` 추가(캐시 기반 강제 재평가 지원)
- 완료: 세션 단위 점진 전환(rollout percentage) 적용
- 완료: human-labeled 품질 리뷰 수집/요약 API 및 cutover 반영(충분 표본 시)
- 진행중: GoT active 승격/cutover 자동화(정책·품질·지연·실험군을 포함한 단계적 자동 전환 고도화)
