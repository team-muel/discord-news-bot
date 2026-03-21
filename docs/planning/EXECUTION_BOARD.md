# 실행 보드 (Frontier 2026)

기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` (canonical)

Boundary note:

- 이 보드의 OpenCode, OpenDev, NemoClaw, OpenJarvis, opencode 관련 항목은 저장소 내부 milestone 및 협업/실행 표면을 뜻한다.
- 이름 충돌 해석과 현재 구현된 runtime surface는 `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`를 기준으로 확인한다.

프로그램 보조 문서: `docs/planning/FRONTIER_2026_PROGRAM.md`

마일스톤 기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`

문서 역할:

- Canonical for current execution state only (`Now`, `Next`, `Later`).
- Every item must bind to roadmap milestone IDs from the unified roadmap.
- Detailed ticket breakdown belongs in [docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md](docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md).
- Active WIP must stay at 3 items or fewer; the rest remain queued even if approved.

표기 규칙:

- 각 항목은 `M-xx` milestone ID를 반드시 포함한다.

## Active Now (WIP <= 3)

1. [M-04] [M-05] [M-06] worker quality gate + Opencode approval 흐름 + model binding/fallback 운영 고정

Backlog binding:

- Active Now 1번 -> `SPRINT_BACKLOG_MEMORY_AGENT.md`의 `A-003`

Recently closed:

- 2026-03-21: [M-01] [M-03] Control Tower 기준 고정 + Core Decision Engine 인터페이스/이벤트 계약 수렴 (`A-001`)
- 2026-03-21: [M-02] [M-07] social graph 운영 지표 + quality telemetry 통합 점수화 (`A-002`)

운영 규칙:

- 아래 Active Now만 현재 진행 중으로 취급한다.
- 추가 항목은 `Queued Now`에서만 대기한다.
- 새 요청이 들어와도 기존 Active Now를 닫기 전에는 WIP를 늘리지 않는다.
- Queued 항목은 `A-001`~`A-003` backlog owner가 붙어 있지 않으면 Active Now로 승격하지 않는다.

## Queued Now (Approved, Not In Active WIP, Owner-Bound)

1. [A-003] [M-04] 동적 worker 품질 게이트(정적/정책/샌드박스) 운영 규칙 고정
2. [A-003] [M-05] Opencode adapter 계약(입출력/승인흐름/감사로그) 명세 확정
3. [A-003] [M-04] [M-07] 단계별 go/no-go 게이트(신뢰성/품질/안전/거버넌스) 운영 강제
4. [A-003] [M-05] [M-04] OpenDev -> NemoClaw sandbox 강제 위임 경로 검증(미경유 실행 0건)
5. [A-003] [M-05] Opencode 고위험 액션 approval_required 강제 + 무증거 반영 차단
6. [A-003] [M-05] [M-06] workflow 슬롯별 모델 바인딩/폴백 매트릭스 운영 설정 고정

## Next (D31-D60: Autonomous Loops)

1. [M-03] 요청 없음 구간에서도 누락 기능 탐지 -> 제안 큐 자동 생성 강화
2. [M-05] Opencode executor 파일럿(approval_required 고정)
3. [M-06] provider dual profile(cost-optimized vs quality-optimized) 운영
4. [M-07] ToT/GoT + provider별 품질 정규화 계측 도입
5. [M-07] 라벨 기반 recall@k 및 hallucination review 자동 리포트
6. [M-03] [M-08] memory job queue-first 분리 v1(enqueue/consume/retry/deadletter)
7. [M-08] queue lag/retry/deadletter 운영 SLO 알림 자동화
8. [M-06] [M-07] provider profile 자동 회귀 규칙(quality gate fail 시 fallback) 적용
9. [M-05] 실패 패턴 수집 -> 패치 제안 -> 회귀 검증 self-improvement loop v1

## Later (D61-D90: Frontier Hardening)

1. [M-08] 멀티길드 스케일 테스트(파일럿 3+) 및 안정화
2. [M-08] 실패 주입/보안 주입 테스트 운영화
3. [M-08] Go/No-Go 연속 통과 + 베타 확장 승인
4. [M-08] 월간 blocked 0 상태 유지 검증
5. [M-06] 신모델/신도구(Opencode 포함) 도입 템플릿 운영 고정
6. [M-08] trading runtime read/write 경계 분리 및 canary cutover 운영화
7. [M-08] stage rollback runbook 자동 점검 체크리스트 운영화

## 운영 원칙

- 구현률 100%와 운영 무결성을 동시에 달성
- 가용성/정확성/보안을 비용보다 우선
- 배포 판단은 go/no-go 게이트로 일원화
- 단일 개발자 운영에서 컨텍스트 과부하를 핵심 리스크로 관리

## 수렴 실행 규칙 (1~24 완주 모드)

- 기준 체크리스트: docs/planning/PROGRESSIVE_AUTONOMY_30D_CHECKLIST.md
- 1~24 항목을 순차 처리하며, 선행 항목 미완료 시 후행 항목 착수 금지
- 동시 진행 WIP 최대 3개, 기준 목록은 `Active Now`만 사용
- 신규 기능 파일 추가 금지(기존 워크플로우 강화만 허용)
- 각 항목 완료 증거는 gate-runs 또는 runbook 링크로 남긴다
