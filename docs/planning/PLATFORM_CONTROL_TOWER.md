# Platform Control Tower

목적: 기존 레거시 계획/런북/역할 문서를 "하나의 운영 체계"로 정렬한다.

이 문서는 새 정책을 추가하는 문서가 아니라, 어떤 문서가 최종 기준인지 결정하는 조정 레이어다.

## 1) Canonical 문서 계층 (Single Source of Truth)

아래 표에서 각 주제별 "단일 기준 문서"를 고정한다.

| 주제 | Canonical 문서 | 보조 문서 | 운영 규칙 |
| --- | --- | --- | --- |
| 플랫폼 전체 운영 | docs/RUNBOOK_MUEL_PLATFORM.md | docs/OPERATIONS_24_7.md | 운영 절차 변경은 Runbook 먼저 반영 |
| 24/7 런타임/배포 | docs/OPERATIONS_24_7.md | docs/RENDER_AGENT_ENV_TEMPLATE.md | 배포/환경 변경은 Ops 문서 우선 |
| 임계치 기반 의사결정 | docs/OPERATOR_SOP_DECISION_TABLE.md | docs/ONCALL_COMMS_PLAYBOOK.md, docs/ONCALL_INCIDENT_TEMPLATE.md | 임계치 충돌 시 SOP 우선 |
| 메모리 제품 로드맵 | docs/planning/LONG_TERM_MEMORY_AGENT_ROADMAP.md | docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md | 분기 목표는 Roadmap, 작업은 Backlog |
| 스프린트 실행 상태 | docs/planning/EXECUTION_BOARD.md | docs/planning/FRONTIER_2026_PROGRAM.md, docs/planning/BETA_GO_NO_GO_CHECKLIST.md | Now/Next/Later 외 상태값 금지 |
| 비용/품질 게이트 | docs/planning/FINOPS_PLAYBOOK.md, docs/planning/BETA_GO_NO_GO_CHECKLIST.md | docs/planning/MEMORY_RETRIEVAL_SCORING.md | 배포 전 Go/No-Go 필수 |
| 데이터/스키마 | docs/SUPABASE_SCHEMA.sql | docs/planning/MEMORY_SCHEMA_MIGRATION_PLAN.md | 스키마 변경 시 SQL + 계획 동시 갱신 |
| 아키텍처 변경 근거 | docs/adr/*.md | docs/CHANGELOG-ARCH.md | 설계 변경은 ADR 선행 |

## 2) 역할과 책임 (RACI 요약)

| 의사결정 | Driver (R) | Approver (A) | Consulted (C) | Informed (I) |
| --- | --- | --- | --- | --- |
| 운영 임계치 변경 | L2 Service Owner | Incident Commander | L2 Data Owner | L1 On-Call |
| 데이터 스키마 변경 | L2 Data Owner | Service Owner | Incident Commander | L1 On-Call |
| 스프린트 우선순위 | Product/Service Owner | Incident Commander | Data Owner | On-Call |
| 배포 Go/No-Go | Service Owner | Incident Commander | Data Owner | On-Call |
| 런북 개정 | L1 On-Call | Service Owner | Data Owner | 전체 운영자 |

## 3) 운영 Cadence

- 5분: Health/FinOps/Quality 신호 확인 (운영 감시)
- 30분: Incident 상황판 업데이트 (SEV-1/2)
- 일간: EXECUTION_BOARD Now 항목 진행/차단요인 기록
- 주간: Roadmap/Backlog/Runbook 동기화 회의 (60분)
- 월간: SOP 임계치 및 역할 정의 재검토

## 4) 변경 제안 Intake 규칙

모든 변경은 아래 분기로 접수한다.

1. 운영 절차/장애 대응 변경: RUNBOOK + SOP 변경안
2. 기능/제품 우선순위 변경: ROADMAP + BACKLOG 변경안
3. 데이터 모델/품질 정책 변경: ADR + SCHEMA/MIGRATION 변경안
4. 릴리즈 조건 변경: GO/NO-GO 체크리스트 변경안

규칙:

- 한 변경이 여러 영역에 걸치면 "대표 문서 1개"를 정하고 나머지는 링크만 남긴다.
- 동일 내용을 2개 문서에 중복 서술하지 않는다.
- 상태 문구는 EXECUTION_BOARD 기준(Now/Next/Later)으로 통일한다.

## 5) 중복 제거 원칙

중복 문서가 발견되면 다음 순서로 정리한다.

1. Canonical 문서에만 본문 유지
2. 중복 문서는 5~10줄 요약 + canonical 링크로 축소
3. 문서 상단에 "Deprecated by <path>" 표기
4. 2주 후 완전 아카이브

## 6) 30일 정렬 계획

### Week 1: 문서 맵 고정

- Canonical 표를 기준으로 각 문서 상단에 역할 라벨 추가
- EXECUTION_BOARD 항목을 로드맵 티켓 ID와 매핑

### Week 2: 중복 축소

- Runbook/Ops/SOP 간 중복 절차 제거
- Planning 문서 간 중복 KPI 정의 통합

### Week 3: 운영 연결

- On-call 템플릿에 FinOps/Quality 체크 결과 필수 입력
- Go/No-Go 결과를 EXECUTION_BOARD와 연결

### Week 4: 정착

- 월간 리뷰로 임계치/역할/문서 책임 재승인
- 오래된 문서 아카이브 처리

## 7) Done 정의

아래 5개가 충족되면 "전체 조정 완료"로 본다.

1. 운영 이슈 발생 시 조회 문서가 3개 이내로 축소됨
2. 같은 정책이 여러 문서에서 상충하지 않음
3. 배포 판단이 Go/No-Go 기준으로 일관됨
4. 역할별 승인 권한이 문서와 실제 운영에서 일치함
5. 월간 리뷰에서 문서 불일치 이슈가 0건
