# Agent Architecture and Evaluation Framework

문서 상태:

- Reference framework for evaluation design and interpretation.
- Use this to define how to evaluate, not to decide current execution priority.
- Live priority remains in `EXECUTION_BOARD.md`.

## 1) Target Architecture (Recommended)

현재 서비스 맥락에서 목표 아키텍처는 다음 하이브리드다.

1. 기본 경로: Vertical multi-agent
2. 보조 경로: 조건부 Horizontal consensus cell
3. 안전 경로: policy gate + action approval + finops guard
4. 학습 경로: memory job + retrieval eval + daily learning loop

핵심 원칙:

- 상시 Horizontal 토론을 기본으로 두지 않는다.
- 고모호/고위험 요청에서만 제한적으로 consensus를 호출한다.
- 운영 안정성(availability, safety)을 성능 최적화보다 우선한다.

## 2) Why This Is Best for This Repo

1. 현재 런타임은 중앙 오케스트레이션과 역할 분화(planner/researcher/critic)에 최적화되어 있다.
2. memory, policy, approval, eval, finops 데이터 모델이 이미 운영형으로 구축되어 있다.
3. 순수 Horizontal 전환은 잡음 증가, 비용 증가, 디버깅 난이도 상승 위험이 크다.

## 3) Empirical Evaluation Stack

표준 벤치마크를 그대로 이식하지 않고, 서비스 맥락으로 재해석해 병행 평가한다.

### A. AgentBench-style (Task Success)

목표: 다양한 실제 업무 태스크에서 성공률 정량화

- 대상: 디스코드 운영/온보딩/incident/webhook/정책 응답 시나리오
- 기본 지표:
  - task_success_rate
  - first_pass_success_rate
  - fallback_activation_rate

### B. OSWorld-style (Efficiency)

목표: 성공까지의 효율성 측정

- GUI 직접조작 대신, 현재 런타임에 맞춰 다음으로 대체
  - time_to_success_ms (P50, P95)
  - tokens_per_success
  - tool_steps_per_success
  - retry_count_per_success

### C. CA-Bench-style (Safety and Security)

목표: 악성 요청/인젝션/자체 오작동 내성 측정

- 테스트 군:
  - misuse requests
  - prompt injection attempts
  - policy bypass attempts
  - self-harmful automation attempts
- 기본 지표:
  - attack_block_rate
  - unsafe_allow_rate
  - false_block_rate
  - approval_enforcement_rate

## 4) Quant + Qual Co-Evaluation

정량 지표만 통과해도 배포하지 않는다. 정성 해석을 동시 적용한다.

정량:

1. success
2. latency
3. cost
4. safety
5. retrieval quality

정성:

1. 운영자 신뢰도
2. 결과 해석 가능성
3. 디버깅 용이성
4. 잡음 체감

배포 규칙:

- 정량 게이트 통과 + 정성 리뷰 통과 시에만 확대
- 한 축이라도 미달이면 baseline으로 롤백

## 5) Experiment Design (Default)

1. A군: 기존 Vertical baseline
2. B군: Vertical + conditional consensus
3. 기간: 2주 고정
4. 단위: guild cohort
5. 성공 기준:
   - success_rate 개선
   - unsafe_allow_rate 비악화
   - p95_latency/cost 예산 내 유지

## 6) Immediate Execution Plan

1. Baseline Lock
   - workflow/profile/policy/env를 기준선으로 고정
2. Benchmark Dataset Build
   - AgentBench-style 30~50 시나리오
   - CA-style 공격 20~30 시나리오
3. Metrics Pipeline Unification
   - agent_action_logs + memory_retrieval_logs + privacy_gate_samples 통합 집계
4. Go/No-Go Gate Upgrade
   - 효율/안전 게이트를 정식 체크리스트에 반영
5. Controlled Rollout
   - 10% -> 30% -> 100% 단계 승격

## 7) Guardrails

1. production에서 fail-open 금지
2. high-risk action은 approval_required 유지
3. blocked 모드 해제는 승인자 1인 이상 필요
4. drift 징후 발생 시 즉시 baseline 복귀
