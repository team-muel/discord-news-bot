# Opencode + NemoClaw + OpenDev Execution Plan

목표:

- 창작/콘텐츠 모듈을 제외하고, Opencode/NemoClaw/OpenDev 3계층만 완성한다.
- 상위 통제권은 Opencode에 두고, 안전 실행은 NemoClaw, 병렬 지능 실행은 OpenDev에 위임한다.
- 2주 스프린트 단위로 12주 내 운영 가능한 v1을 만든다.

범위 제외:

- world-building, 콘텐츠 제작/배포, 커머스 자동화
- 팀원이 담당하는 외부 모듈의 내부 구현

## 1) 3계층 역할 고정

1. Opencode 계층 (Control + Evolution)

- 정책 기반 실행 오케스트레이션
- 실패/결손 감지 -> 패치 제안 -> 검증 게이트 -> 반영 루프
- 최종 병합 권한과 긴급 중단 권한 보유

2. NemoClaw 계층 (Secure Runtime)

- sandbox 강제 실행
- 네트워크/파일시스템/프로세스 정책 집행
- 정책 위반 이벤트를 상위 계층으로 리포트

3. OpenDev 계층 (Parallel Agent Fabric)

- 병렬 세션/서브에이전트 실행
- workflow 슬롯별 모델 바인딩
- 컨텍스트 압축/폴백/복구 자동화

## 2) 인터페이스 계약 (Contract-first)

### 2.1 Opencode -> OpenDev (Plan/Execute)

필수 입력:

- task_id
- objective
- workflow_profile (normal/thinking/compact/critique/vlm)
- policy_context (risk_level, budget_limit, timeout)
- evidence_context (citations, memory_hints)

필수 출력:

- run_id
- execution_summary
- artifacts[]
- verification[]
- error_code (실패 시)

### 2.2 OpenDev -> NemoClaw (Runtime Delegate)

필수 입력:

- run_id
- sandbox_profile
- requested_capabilities (network_hosts, file_paths, tools)
- command_bundle

필수 출력:

- sandbox_id
- allow_deny_decisions[]
- runtime_logs_ref
- policy_violation_events[]

### 2.3 NemoClaw -> Opencode (Governance Events)

필수 이벤트:

- policy_violation_detected
- capability_escalation_requested
- execution_blocked
- execution_terminated

공통 규칙:

- 모든 이벤트는 trace_id와 guild_id를 포함
- 반영 가능한 변경은 evidence bundle이 없으면 무효

## 3) Definition of Done (Layer-level)

### 3.1 Opencode DoD

- 단일 상태머신: proposed -> approved -> executing -> verified -> merged/rolled_back
- auto mode는 low-risk 액션만 허용
- 위험 액션은 approval_required 강제
- failure taxonomy와 retry policy 문서화 완료

### 3.2 NemoClaw DoD

- 기본 거부 정책(default deny) 동작 검증
- 미허용 host/file 접근 시 차단 + 이벤트 생성 검증
- sandbox별 감사 로그 추적 가능
- 긴급 kill switch 1분 내 작동

### 3.3 OpenDev DoD

- 병렬 세션 3개 이상 동시 실행 안정화
- 슬롯별 모델 바인딩 운영 설정 분리
- provider 장애 시 폴백 자동 전환
- 장시간 실행에서 컨텍스트 압축 회귀 없음

## 4) 12주 실행계획 (2주 스프린트 x 6)

## Sprint 1 (W1-W2): Contract Freeze

담당:

- Platform Lead (R), Service Owner (A), Security Owner (C)

산출물:

- 인터페이스 계약서 v1 (입출력, 이벤트, 오류코드)
- 권한 모델 표준 (risk tiers, capability classes)
- 공통 trace_id/operation_id 규칙

리스크:

- 팀별 용어 불일치로 계약 드리프트 발생

성공 지표:

- 신규 실행 경로 100%가 계약 필드 준수
- 오류코드 미분류 비율 5% 미만

## Sprint 2 (W3-W4): Secure Runtime Bind

담당:

- Runtime Owner (R), Security Owner (A), Platform Lead (C)

산출물:

- OpenDev 실행을 NemoClaw sandbox로 강제 위임
- default deny 정책 템플릿
- 정책 위반 이벤트 표준 발행

리스크:

- 과도한 deny로 정상 작업 차단

성공 지표:

- sandbox 미경유 실행 0건
- 정책 위반 탐지 누락 0건

## Sprint 3 (W5-W6): Parallel Workflow Hardening

담당:

- Agent Runtime Owner (R), Platform Lead (A), FinOps Owner (C)

산출물:

- workflow 슬롯별 모델 바인딩 운영화
- provider fallback 매트릭스
- context compaction 정책 고정

리스크:

- 모델 간 출력 품질 편차로 검증 실패율 상승

성공 지표:

- 병렬 세션 성공률 95% 이상
- fallback 전환 성공률 99% 이상

## Sprint 4 (W7-W8): Governance Gate v1

담당:

- Platform Lead (R), Service Owner (A), On-call Lead (C)

산출물:

- 고위험 액션 승인 플로우
- evidence bundle 검증기
- 머지 전 검증 게이트(테스트/정책/비용)

리스크:

- 승인 큐 적체로 리드타임 증가

성공 지표:

- 승인 리드타임 p95 목표 충족
- 무증거 반영 0건

## Sprint 5 (W9-W10): Self-Improvement Loop v1

담당:

- Platform Lead (R), QA Owner (A), Runtime Owner (C)

산출물:

- 실패 패턴 수집기
- 패치 제안 생성기
- 자동 회귀 검증 파이프라인

리스크:

- 잘못된 패치 제안의 반복 생성

성공 지표:

- 반복 실패 상위 20개 중 50% 자동 제안 연결
- 제안 대비 승인 전환율 목표 달성

## Sprint 6 (W11-W12): Ops Stabilization + Cutover

담당:

- Service Owner (R), Incident Commander (A), On-call Lead (C)

산출물:

- 런북/온콜 절차 업데이트
- canary cutover + rollback rehearsal
- go/no-go evidence 패키지

리스크:

- canary에서 잠복 회귀 발생

성공 지표:

- canary 연속 안정 운영
- rollback rehearsal 성공률 100%

## 5) 운영 정책 (필수)

- 실행은 자동화 가능, 반영은 통제 우선
- 결제/외부 배포/권한상승은 반드시 승인
- 위험 명령어는 사전 차단 + 감사 로그 강제
- run_mode 기본값은 approval_required
- 모든 변경은 evidence bundle 없으면 무효

## 6) KPI 대시보드 (공통)

신뢰성:

- execution_success_rate
- fallback_success_rate
- mean_time_to_recover

거버넌스:

- unapproved_high_risk_actions (목표 0)
- evidence_missing_rate (목표 0)
- policy_violation_detection_coverage

성능/비용:

- p95_latency_by_workflow_slot
- cost_per_successful_run
- compaction_effectiveness

## 7) Go/No-Go 기준

Go 조건:

- sandbox 미경유 실행 0건
- 무승인 고위험 액션 0건
- 증거 누락 반영 0건
- canary 안정화 지표 통과

No-Go 조건:

- policy 위반 누락 1건 이상
- rollback 실패 1건 이상
- 운영 리드타임이 합의 임계치 초과

## 8) 즉시 착수 체크리스트 (48시간)

1. 인터페이스 계약 owner 지정 및 리뷰 일정 확정
2. risk tier/capability class 표준 초안 확정
3. sandbox 강제 경로 점검 스크립트 실행
4. 승인 큐 SLA 임계치 합의
5. sprint 1 티켓 분해 및 담당자 할당
