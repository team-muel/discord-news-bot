# Unified Roadmap: Social Mapping + Autonomous Ops (2026 Q2)

목적:

- 기존 기획 의도(단순 QA 봇이 아닌 사회관계 맵핑 + 자가확장 운영 에이전트)를 현재 코드 진도에 맞춰 단일 실행 로드맵으로 통합
- 운영 문서, 실행 보드, 백로그, Go/No-Go 체크를 하나의 기준선으로 정렬

이 문서는 정책/우선순위의 Canonical Roadmap이다.

## 1) North Star

Muel은 다음 4가지를 동시에 만족하는 길드 운영 에이전트로 진화한다.

1. 사회적 맥락 인지: 길드 내부 user-user 관계를 구조화하고 추론 입력으로 활용
2. 자가확장 운영: 반복 요청과 누락 액션을 감지해 기능 제안/생성/승인/배포 루프를 자동화
3. 근거 우선 추론: 메모리/문서/사회 신호 근거와 정책 게이트 기반으로 최종 응답을 구성
4. 비용-품질 동시 최적화: provider 라우팅, fallback, 품질 게이트를 통한 운영 안정화

## 2) Current Baseline (As-Is)

아래는 이미 구현되어 운영 가능한 기준선이다.

- Social graph data plane:
  - `community_interaction_events`
  - `community_relationship_edges`
  - `community_actor_profiles`
- Runtime social ingestion:
  - reply/mention/co_presence/reaction 수집 및 관계 엣지 집계
- Inference path:
  - requester 기반 social hint를 memory hint pipeline에 병합
- Privacy/forget:
  - user/guild forget 시 social graph 테이블까지 삭제 범위 확장
- Obsidian + Supabase ops loop:
  - guild bootstrap, daily learning, lore sync, failure-rate/lock 기반 운영 가드
- Reasoning framework:
  - planner/researcher/critic
  - policy gate
  - ToT shadow/active 조건부 경로
  - GoT cutover decision gate

## 3) Gap to Vision (To-Be)

기획 의도 대비 남은 핵심 갭:

1. 사회학적 구조화의 고도화

- 현재는 이벤트/엣지/프로필 중심의 1차 맵핑
- 필요: 커뮤니티 역할/클러스터/에스컬레이션 패턴의 운영 지표화

2. 자가증식 루프의 완결성

- 현재는 동적 worker 생성/승인 파이프라인이 준비됨
- 필요: "요청 없음" 구간에서도 누락 기능 탐지 -> 제안 -> 승인 큐 자동 생성 강화

3. provider-agnostic 추론 품질 계측

- 현재 provider마다 메타 신호(예: logprob) 가용성이 다름
- 필요: 동일 스코어링 계약으로 정규화하여 HF/Local/OpenAI/Anthropic 경로 비교 운영

## 4) 90-Day Execution Plan

## Phase A (D1-D30): Control Tower Lock

목표: 문서/운영/실행 기준을 단일 체계로 고정

- A1. 문서 일원화
  - 본 문서를 Canonical Roadmap으로 지정
  - 실행 보드는 본 문서 milestone ID만 참조
- A2. 운영 신호 고정
  - health/finops/memory-quality/go-no-go 4축 일일 점검 자동화
- A3. Social graph 운영 검증
  - co_presence/reaction 수집률과 hints 반영률을 대시보드 항목으로 고정

완료 기준:

- 운영자가 우선 열어야 할 문서가 3개 이하로 축소
- 실행 보드 항목 100%가 milestone ID를 가짐

## Phase B (D31-D60): Autonomous Expansion Loop

목표: "요청 -> 제안 -> 생성 -> 승인 -> 배포" 루프 자동성 강화

- B1. 기능 누락 감지기
  - 실패코드/재시도/승인 대기열 기반으로 worker proposal 자동 생성
- B2. 동적 worker 품질 게이트
  - 정적검증 + 정책검증 + 샌드박스 검증 통과 시에만 승인 후보 승격
- B3. Opencode 연동 준비
  - executor 계층에 opencode adapter slot 추가
  - artifact/verification 표준 포맷으로 결과 정규화

완료 기준:

- 반복 요청 상위 20개 중 60% 이상이 자동 제안 루프로 연결
- 승인 대기열의 mean lead time 30% 이상 단축

## Phase C (D61-D90): Frontier Hardening

목표: 멀티길드 확장 + 비용/품질 동시 최적화

- C1. provider profile 운영
  - cost-optimized(HF/Local 우선) vs quality-optimized(sonnet/gpt 우선) 이중 프로파일 운영
- C2. 추론 품질 게이트 강화
  - hallucination review + citation rate + retrieval hit + session success 통합 점수화
- C3. rollout governance
  - GoT/ToT 활성화는 guild별 cutover profile과 품질 기준 동시 충족 시만 허용

완료 기준:

- pilot guild 3+에서 연속 2주 blocked 상태 없이 운영
- quality gate 미충족 배포 0건

## 5) Milestone IDs (Execution Board Binding)

- M-01: Control Tower Lock
- M-02: Social Graph Reliability
- M-03: Autonomous Proposal Loop
- M-04: Worker Quality Gate
- M-05: Opencode Adapter Ready
- M-06: Provider Dual Profile
- M-07: Reasoning Quality Gate
- M-08: Multi-Guild Hardening

규칙:

- `docs/planning/EXECUTION_BOARD.md`의 모든 Now/Next/Later 항목은 위 ID 중 1개 이상을 반드시 포함한다.

## 6) Operational KPIs

필수 KPI:

- 사회 신호 수집 완전성: `social_events_ingested / candidate_social_events`
- 사회 힌트 활용률: `responses_with_social_hints / total_task_responses`
- 자동 제안 루프율: `auto_proposals_created / missing-action-incidents`
- 승인 전환율: `approved_workers / proposed_workers`
- 품질 지표:
  - citation_rate
  - retrieval_hit@k
  - hallucination_review_fail_rate
- 운영 지표:
  - p95 응답 지연
  - 실패 후 평균 복구 시간
  - provider별 비용/성능

## 7) Opencode Integration Contract (Roadmap-level)

Opencode 연동은 아래 계약을 따른다.

1. 위치:

- skill executor 계층에 `opencode` 실행기 추가

2. 입력 계약:

- goal
- action constraints (policy, safety level, budget)
- context bundle (memory hints + social hints + citations)

3. 출력 계약:

- `ok`
- `summary`
- `artifacts[]`
- `verification[]`
- 실패 시 `error`와 재시도 힌트

4. 거버넌스:

- 기본 run_mode는 `approval_required`
- 관리자 승인 없는 자동 배포 금지
- 감사 로그/증거 번들 필수

## 8) Documentation Sync Rules

본 문서 변경 시 동시 갱신 대상:

1. `docs/planning/EXECUTION_BOARD.md`
2. `docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md`
3. `docs/RUNBOOK_MUEL_PLATFORM.md`
4. `docs/CHANGELOG-ARCH.md`

동기화 원칙:

- 로드맵은 방향/우선순위만 정의
- 실행 보드는 상태(Now/Next/Later)만 정의
- 백로그는 작업 단위와 완료 기준만 정의
- 런북은 운영 절차만 정의
