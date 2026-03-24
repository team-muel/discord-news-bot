# 스프린트 백로그: 고맥락 장기기억 에이전트

문서 역할:

- Canonical for task-sized backlog units and completion criteria.
- Derive priorities from [docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md](docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md) and active focus from [docs/planning/EXECUTION_BOARD.md](docs/planning/EXECUTION_BOARD.md).
- Do not redefine roadmap direction or operator procedure here.

현재 활성 기준:

- 이 문서의 최상단 `Current Active Pack`만 현재 착수 대상으로 본다.
- 아래의 `Sprint 1~3` 섹션은 레거시 백로그로 유지하되 active priority로 취급하지 않는다.

## 운영 규칙

- 우선순위: P0 > P1 > P2
- 티켓 형식: 문제, 작업, 완료 기준, 리스크
- 기간: 2주 스프린트 기준
- Active WIP는 `EXECUTION_BOARD.md`의 `Active Now` 3개 축에 종속된다.

## Execution Board Binding

- `EXECUTION_BOARD.md`의 Active Now 1번은 `A-003`만 소유한다.
- `Queued Now` 항목은 아래 `A-001`~`A-003` owner map에 배정된 경우에만 승격 후보가 된다.

## Current Active Pack (Aligned to Active Now)

_없음 — 2026-03-24 기준 모든 로드맵/WIP 항목 종결._

### A-003 [M-04] [M-05] [M-06] Worker Gate + Approval + Model Binding Hardening

- 상태: **Closed on 2026-03-24**
- 종료 근거
  - worker quality gate (evidence ID + audit trail), approval_required 경화 (HIGH_RISK_APPROVAL_ACTIONS), model binding/fallback matrix (LLM_WORKFLOW_MODEL_BINDINGS + LLM_WORKFLOW_PROFILE_DEFAULTS) 일체 구현 완료
  - canonical runtime surface `/api/bot/agent/runtime/worker-approval-gates` 고정
  - 운영자 단일 체크 흐름으로 gate → approval → model fallback 상태 검증 가능
  - 전체 로드맵/WIP 종결에 따라 active pack에서 해제

## Recently Closed

### A-001 [M-01] [M-03] Control Tower + Core Decision Contract Convergence

- 상태: Closed on 2026-03-21
- 종료 근거
- canonical 실행 문서 세트가 4개로 고정됨
- Core Decision Engine, Event/Command envelope, evidence bundle canonical 참조점이 문서군에 고정됨
- 후속 작업은 active workstream이 아니라 historical/reference 유지로만 관리한다

### A-002 [M-02] [M-07] Social Graph + Quality Telemetry Consolidation

- 상태: Closed on 2026-03-21
- 종료 근거
- social + quality 통합 운영 판정 규칙이 문서화됨
- admin snapshot 진입점 `/agent/runtime/social-quality-snapshot?guildId=...&days=...` 이 canonical entry로 고정됨
- 후속 개선 항목은 active workstream이 아니라 historical/reference 유지로만 관리한다

## Active Queue Owner Map

### A-003 queued intake

- [M-04] 동적 worker 품질 게이트(정적/정책/샌드박스) 운영 규칙 고정
- [M-05] Opencode adapter 계약(입출력/승인흐름/감사로그) 명세 확정
- [M-04] [M-07] 단계별 go/no-go 게이트(신뢰성/품질/안전/거버넌스) 운영 강제
- [M-05] [M-04] OpenDev -> NemoClaw sandbox 강제 위임 경로 검증(미경유 실행 0건)
- [M-05] Opencode 고위험 액션 approval_required 강제 + 무증거 반영 차단
- [M-05] [M-06] workflow 슬롯별 모델 바인딩/폴백 매트릭스 운영 설정 고정

## Sprint 1 (P0): 기반 고정

상태: Legacy backlog reference. 현재 활성 우선순위는 `Current Active Pack`을 따른다.

### T-001 메모리 스키마 확장안 작성

- 문제: 장기기억 타입과 소스 추적 모델이 부족함
- 작업
- memory_items(type, confidence, status, source_count)
- memory_sources(source_message_id, channel_id, author_id)
- memory_feedback(pin/edit/deprecate)
- 완료 기준
- SQL 초안 + 마이그레이션 순서 + 롤백 계획 문서화

### T-002 메모리 회수 계약 정의

- 문제: 회수 결과 형식이 불안정함
- 작업
- request/response JSON schema 정의
- citation 필드와 score 필드 의무화
- 완료 기준
- 서비스 단위 테스트에서 계약 검증 통과

### T-003 맥락 압축 잡 설계

- 문제: 원문 중심 처리로 비용/지연이 증가함
- 작업
- short-window summary 잡
- topic synthesis 잡
- durable extraction 잡
- 완료 기준
- 샘플 길드 1곳에서 24시간 동작

### T-004 관리자 교정 API 설계

- 문제: 잘못된 기억 정정 루프가 없음
- 작업
- pin/edit/deprecate/resolve_conflict API 설계
- 권한 체크(requireAdmin) 추가
- 완료 기준
- 관리자 권한 없는 요청은 403 처리

### T-005 응답 규격 통일

- 문제: 답변 신뢰도와 근거 노출이 일관되지 않음
- 작업
- 결론/근거/신뢰도/다음행동 포맷터 구현
- 근거 부족시 안전 응답 템플릿 적용
- 완료 기준
- 시나리오 테스트 30건에서 포맷 준수율 100%

## Sprint 2 (P1): 품질/안정화

상태: Legacy backlog reference. 현재 활성 우선순위는 `Current Active Pack`을 따른다.

### T-006 회수 품질 측정 지표 도입

- 작업
- recall@k, citation_rate, correction_rate, unresolved_conflict_rate 측정
- 완료 기준
- 대시보드에서 일 단위 조회 가능

### T-007 기억 충돌 자동 탐지

- 작업
- 동일 key에 상반된 policy/semantic 기억 탐지
- 관리자 검토 큐 적재
- 완료 기준
- 충돌 이벤트 로그와 재현 케이스 확보

### T-008 실패 복구 체계

- 작업
- 압축/회수 잡 재시도 및 데드레터 큐
- 완료 기준
- 장애 주입 테스트에서 자동 복구율 90% 이상

### T-009 길드 온보딩 자동화

- 작업
- 봇 초대 이벤트 시 초기 맥락 스냅샷 생성
- 관리자 확인 메시지 전송
- 완료 기준
- 신규 길드 온보딩 평균 완료시간 10분 이내

### T-010 운영 런북 보강

- 작업
- 실패 유형별 대응 절차 문서화
- 완료 기준
- 운영자가 문서만으로 1차 대응 가능

## Sprint 3 (P1/P2): 파일럿 베타

상태: Legacy backlog reference. 현재 활성 우선순위는 `Current Active Pack`을 따른다.

### T-011 파일럿 길드 3곳 운영

- 완료 기준
- 길드별 주간 리포트 자동 생성

### T-012 품질 회고 및 정책 튜닝

- 완료 기준
- 오답 상위 10개 원인 제거 액션 도출

### T-013 관리자 UX 개선

- 완료 기준
- 교정 요청 -> 반영 -> 확인 플로우 단일 명령 체계 확정

## 우선순위 메모

- 이번 달 목표는 게임 기능이 아니라 고맥락 신뢰성 확보
- 새 기능 추가 전, citation_rate와 correction SLA를 먼저 안정화

## Current Cycle (P0): Roadmap Execution Pack

상태: 상세 후보 목록. 이 섹션의 항목은 `Current Active Pack` 3개 workstream 아래에서만 착수한다.

### R-001 Discord UX 이벤트 계측 고정

- 문제: 버튼/리액션/스레드 기반 UX 신호가 운영 지표로 충분히 고정되지 않음
- 작업
- 이벤트 수집 필드 표준화(길드/채널/유저/타임슬롯)
- 집계 문서와 운영 지표 연결
- 완료 기준
- 하루 1회 이상 활성 길드에서 이벤트 누락률 경고 없이 집계 기록 생성
- 검증 명령
- `npm run lint`

### R-002 반복 CS 20개 자동 분류/응답 템플릿 표준화

- 문제: 반복 문의 자동화 범위가 명확히 정의되지 않음
- 작업
- 빈도 높은 CS 시나리오 20개 선정
- 분류 라벨 + 응답 템플릿 + 이관 조건 정의
- 완료 기준
- 선정된 20개 시나리오에서 템플릿 매칭과 fallback 기준 문서화
- 검증 명령
- `npm run lint`

### R-003 ops-loop 안정성 대시보드 고정

- 문제: loop 안정성 지표를 한 화면에서 추적하기 어려움
- 작업
- failureRate/retryCount/timeout/lock 상태 지표를 단일 운영 뷰로 정리
- 임계치 초과 시 운영 조치 문구 연결
- 완료 기준
- 일일 점검 시 5분 내 이상 징후 파악 가능
- 검증 명령
- `npm run obsidian:ops-cycle -- --guild <guildId> --skip-sync`

### R-004 사용자 요청 -> 기능 제안 -> 구현 티켓화 루프 v1

- 문제: 요구사항이 코드 작업으로 변환되는 루프가 수작업 의존적임
- 작업
- 요청 분류 기준 정의
- 기능 제안 템플릿과 티켓 생성 포맷 고정
- 완료 기준
- 신규 요청이 1회 문서 입력으로 실행 보드 티켓까지 연결
- 검증 명령
- `npm run lint`

### R-005 Planner 자기개선용 학습 샘플 추출 v1

- 문제: 실행 로그가 planner 개선 데이터로 체계적으로 재사용되지 않음
- 작업
- 성공/실패/비용/지연 기반 샘플 추출 규칙 정의
- 우선순위 보정에 필요한 최소 필드 확정
- 완료 기준
- 주간 배치로 샘플 세트 1회 이상 생성 가능
- 검증 명령
- `npm run lint`

### R-006 Tool metadata 인덱스 + 오프라인 정답셋 평가 v1

- 문제: 툴 선택 정확도를 오프라인으로 꾸준히 측정하는 루프가 부족함
- 작업
- 도구 설명/입력 제약/실패 조건 메타데이터 인덱스 정의
- 요청-정답 액션 벤치셋 초안 구축
- 완료 기준
- 주기 평가에서 action selection 정확도 추세 비교 가능
- 검증 명령
- `npm run lint`

### R-007 Obsidian CLI/Headless 역할 분리 점검표 게이트 연동

- 문제: 역할 분리 원칙이 배포 승인 게이트와 완전히 연결되지 않음
- 작업
- CLI 전용/Headless 전용 작업 분류표 작성
- 배포 전 체크 항목으로 강제
- 완료 기준
- 점검표 미통과 시 no-go 처리 절차 문서화
- 검증 명령
- `npm run lint`

### R-008 Go/No-Go 체크리스트 운영 강제

- 문제: 기준 문서와 실제 배포 판단이 분리될 위험
- 작업
- 베타 체크리스트 기준을 배포 절차 순서에 포함
- 미충족 시 차단/재시도 루프 정의
- 완료 기준
- 배포마다 체크리스트 근거 로그 1건 이상 남음
- 검증 명령
- `npm run lint`

### R-009 장애 증거 수집 포맷 표준화

- 문제: 장애 대응 기록 형식이 케이스별로 들쭉날쭉할 수 있음
- 작업
- 원인/영향/완화/재발방지 필드 고정
- oncall 문서와 일치화
- 완료 기준
- 문서만으로 재현 가능한 장애 기록 3건 이상 확보
- 검증 명령
- `npm run lint`

### R-010 변경로그 누락 0 강제

- 문제: 아키텍처 의미 변화가 누락되면 의사결정 추적이 끊김
- 작업
- 아키텍처 의미 변경 시 CHANGELOG-ARCH 반영 규칙 강제
- 완료 기준
- 주간 리뷰 시 누락 0건
- 검증 명령
- `npm run lint`

### R-011 하드코딩 제거 1차(Discord 계층)

- 문제: 명령/의도/길이 제한/스트리밍 주기 등 운영 정책값이 코드에 분산되어 변경 리스크가 큼
- 작업
- 디스코드 계층 하드코딩 인벤토리 작성
- 중앙 정책/설정 계층으로 1차 이관(명령 allowlist, intent pattern, 출력 길이 제한, 진행 업데이트 주기)
- 완료 기준
- 하드코딩 체크리스트 1차 항목 완료율 100%
- 검증 명령
- `npm run lint`

### R-012 Graph-first 비청킹 회수 정책 고정

- 문제: 일반 RAG 습관대로 청킹 중심으로 회귀할 위험이 존재
- 작업
- 태그/백링크/링크 연결성을 우선 신호로 사용하는 정책 문서화
- 배포 게이트에 "기본 전략은 비청킹" 점검 항목 추가
- 완료 기준
- 배포 점검 문서에서 그래프 기반 정책 미충족 시 no-go 처리
- 검증 명령
- `npm run lint`

### R-013 Core Decision Engine 경계 고정

- 문제: Discord 계층과 코어 판단 로직 결합도가 높아 채널 독립 확장이 어려움
- 작업
- Core Decision Engine 인터페이스 정의
- Discord adapter -> core command 변환 경로 명세
- 완료 기준
- 핵심 명령 경로 1개 이상이 adapter/core 분리 구조로 이전
- 검증 명령
- `npm run lint`

### R-014 Event/Command Envelope 버전 계약 도입

- 문제: 이벤트와 명령 포맷이 경로별로 상이하면 점진 분리 시 회귀 위험이 증가
- 작업
- event envelope, command envelope 필수 필드 고정
- event_version 기반 호환성 규칙 문서화
- 완료 기준
- 신규 경로 100%가 버전 계약을 따르고, 예외 경로 0건
- 검증 명령
- `npm run lint`

### R-015 Memory Queue-first 전환 v1

- 문제: 장주기 memory 루프가 메인 런타임과 리소스를 공유해 장애 파급 가능성이 큼
- 작업
- enqueue/consume 분리
- retry/backoff/deadletter 정책 표준화
- 완료 기준
- memory 장주기 작업 70% 이상이 비동기 큐 경유
- 검증 명령
- `npm run memory:queue:report`
- `npm run lint`

### R-016 Go/No-Go 게이트 자동 판정 규칙

- 문제: 단계 전환 판단이 수동 해석에 의존하면 운영 일관성이 저하됨
- 작업
- reliability/quality/safety/governance 4게이트 임계치 고정
- 단계 전환 시 자동 판정 결과 기록
- 완료 기준
- 단계 전환 시점마다 근거 로그 1건 이상 자동 생성
- 검증 명령
- `npm run lint`

### R-017 Stage Rollback 시나리오 고정

- 문제: 점진 분리 중 장애 시 복귀 절차가 미고정이면 복구 시간이 길어짐
- 작업
- stage rollback, queue rollback, provider rollback 절차 문서화
- 10분 내 복귀 목표 기준 점검표 작성
- 리허설 결과를 md/json 증거 페어로 저장하는 자동화 스크립트 추가
- 리허설 결과를 주간 집계하여 Supabase에 적재 가능한 리포트 경로 추가
- 완료 기준
- canary 실패 시 10분 내 복귀 리허설 1회 이상 통과
- 검증 명령
- `npm run rehearsal:stage-rollback:record -- --maxRecoveryMinutes=10`
- `npm run gates:weekly-report:rollback`
- `npm run lint`
