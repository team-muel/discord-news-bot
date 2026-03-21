# Unified Roadmap: Social Mapping + Autonomous Ops (2026 Q2)

목적:

- 기존 기획 의도(단순 QA 봇이 아닌 사회관계 맵핑 + 자가확장 운영 에이전트)를 현재 코드 진도에 맞춰 단일 실행 로드맵으로 통합
- 운영 문서, 실행 보드, 백로그, Go/No-Go 체크를 하나의 기준선으로 정렬

이 문서는 정책/우선순위의 Canonical Roadmap이다.

문서 역할:

- Canonical for direction, priorities, milestone IDs, and phased rollout intent.
- Do not track day-to-day status here; status belongs in [docs/planning/EXECUTION_BOARD.md](docs/planning/EXECUTION_BOARD.md).
- Do not embed operator SOP here; execution procedure belongs in [docs/RUNBOOK_MUEL_PLATFORM.md](docs/RUNBOOK_MUEL_PLATFORM.md).

Boundary note:

- 이 로드맵의 Opencode, OpenDev, NemoClaw, OpenJarvis 관련 항목은 저장소 내부 실행 표면과 milestone 명칭을 뜻한다.
- 현재 구현 상태와 이름 충돌 해석은 `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`를 기준으로 확인한다.

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

1. 자가증식 루프의 완결성

- 현재는 동적 worker 생성/승인 파이프라인이 준비됨
- 필요: "요청 없음" 구간에서도 누락 기능 탐지 -> 제안 -> 승인 큐 자동 생성 강화

1. provider-agnostic 추론 품질 계측

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

1. 입력 계약:

- goal
- action constraints (policy, safety level, budget)
- context bundle (memory hints + social hints + citations)

1. 출력 계약:

- `ok`
- `summary`
- `artifacts[]`
- `verification[]`
- 실패 시 `error`와 재시도 힌트

1. 거버넌스:

- 기본 run_mode는 `approval_required`
- 관리자 승인 없는 자동 배포 금지
- 감사 로그/증거 번들 필수

## 8) Documentation Sync Rules

본 문서 변경 시 동시 갱신 대상:

1. `docs/planning/EXECUTION_BOARD.md`
2. `docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md`
3. `docs/RUNBOOK_MUEL_PLATFORM.md`
4. `docs/CHANGELOG-ARCH.md`

실행 보조 아티팩트:

1. `docs/planning/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md`
2. `docs/planning/GO_NO_GO_GATE_TEMPLATE.md`
3. `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`

동기화 원칙:

- 로드맵은 방향/우선순위만 정의
- 실행 보드는 상태(Now/Next/Later)만 정의
- 백로그는 작업 단위와 완료 기준만 정의
- 런북은 운영 절차만 정의
- 보조 아티팩트는 실행/판정/계약 검증의 단일 포맷을 제공한다

## 9) Progressive Autonomy Evolution Methodology

본 로드맵의 구현 방법론은 다음 4원칙을 따른다.

1. Strangler-first:

- 기존 경로를 즉시 폐기하지 않고, 경계 인터페이스를 먼저 도입한 뒤 점진적으로 트래픽을 이전한다.

1. Queue-first:

- 무거운 배치/루프 작업은 메인 요청 경로에서 분리하여 비동기 큐 소비 모델로 전환한다.

1. Contract-first:

- 이벤트/정책/증거 포맷을 선고정하고, 구현은 그 계약을 준수하는 방식으로 확장한다.

1. SLO-driven decomposition:

- 모듈 분리 우선순위는 체감 복잡도가 아니라 SLO 위반 빈도와 장애 파급도로 결정한다.

## 10) 30-Day Autonomous Migration Plan (Auto-Execution Frame)

## Week 1 (D1-D7): Interface and Contract Freeze

- Core Decision Engine 인터페이스 정의(Discord 어댑터와 코어 판단 경계 분리)
- Command/Event envelope 스키마 고정(versioned)
- Action evidence bundle(`ok`, `summary`, `artifacts[]`, `verification[]`, `error`) 표준화

완료 기준:

- 신규 기능 100%가 정의된 envelope를 사용
- 기존 핵심 경로 1개 이상이 어댑터-코어 경계로 이전

## Week 2 (D8-D14): Queue-first Worker Split v1

- memory job 계열을 enqueue/consume 구조로 전환
- retry/backoff/deadletter 정책 고정
- 운영 대시보드에 queue lag/retry rate/deadletter ingress 노출

완료 기준:

- memory 계열 장주기 작업의 70% 이상이 비동기 큐 경유
- deadletter 자동 복구 루프와 수동 재처리 절차 동시 확보

## Week 3 (D15-D21): Control Plane Stabilization

- bot status/control 경로를 Control Plane 정책으로 일원화
- read-heavy 운영 API 캐시 TTL 표준화
- 운영 명령의 idempotency/rate-limit 일관 적용

완료 기준:

- 상태 조회 API 급증 시에도 p95 지연이 목표 범위 내 유지
- 관리자 액션 API의 중복 실행 회귀 0건

## Week 4 (D22-D30): Trading Isolation Readiness

- trading runtime read/write 경계 분리 초안 확정
- distributed lock + kill switch + rollback 절차를 런북에 고정
- canary guild 기반 단계적 cutover 시나리오 검증

완료 기준:

- trading 독립 서비스 전환을 위한 계약/운영 절차가 문서와 코드에서 동일한 용어로 고정
- canary 단계 실패 시 10분 내 복귀 가능

## 11) Contract Set (Mandatory)

아래 계약은 점진적 자율 진화 아키텍처에서 필수다.

1. Event Envelope:

- `event_id`, `event_type`, `event_version`, `occurred_at`, `guild_id`, `actor_id`, `payload`, `trace_id`

1. Command Envelope:

- `command_id`, `command_type`, `requested_by`, `requested_at`, `idempotency_key`, `policy_context`, `payload`

1. Policy Decision Record:

- `decision`, `reasons[]`, `risk_score`, `budget_state`, `review_required`, `approved_by`

1. Evidence Bundle:

- `ok`, `summary`, `artifacts[]`, `verification[]`, `error`, `retry_hint`, `runtime_cost`

## 12) Go/No-Go Gates (Progressive Autonomy)

각 단계 전환은 아래 게이트를 동시에 만족해야 한다.

1. Reliability gate:

- p95 응답 지연, 실패 후 평균 복구 시간, queue lag 임계치 통과

1. Quality gate:

- citation_rate, retrieval_hit@k, hallucination_review_fail_rate 기준 통과

1. Safety gate:

- approval_required 정책 준수율 100%
- 관리자 승인 없는 자동 배포 0건

1. Governance gate:

- 실행 보드, 백로그, 런북, 변경로그 동기화 완료

## 13) Rollback Policy (Stage-based)

1. Stage rollback:

- 신규 경로에 장애가 발생하면 동일 기능의 기존 경로로 즉시 전환

1. Queue rollback:

- 큐 적체 또는 deadletter 급증 시 enqueue 중단 후 동기 경로로 제한 복귀

1. Provider rollback:

- 품질 게이트 미달 시 quality-optimized profile로 자동 회귀

1. Evidence-first incident logging:

- 롤백 실행 시점마다 원인/영향/완화/재발방지 근거를 표준 포맷으로 기록

## 14) Fit to "점진적 자율 진화 아키텍처" Framework

본 방법론의 프레임 부합도 평가는 다음과 같다.

- 점진성: 매우 높음 (Strangler-first + stage rollback)
- 자율성: 높음 (proposal/approval/execution/evidence feedback loop)
- 안정성: 매우 높음 (queue isolation + timeout + idempotency + lock)
- 관측성: 높음 (SLO + quality + governance 게이트)
- 확장성: 높음 (channel adapter + worker isolation + profile routing)

운영 원칙:

- 자율성의 속도보다 통제 가능한 진화 속도를 우선한다.
- 자동화율보다 회복 가능성을 우선한다.
