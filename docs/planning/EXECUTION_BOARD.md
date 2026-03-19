# 실행 보드 (Frontier 2026)

기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md` (canonical)

프로그램 보조 문서: `docs/planning/FRONTIER_2026_PROGRAM.md`

마일스톤 기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`

문서 역할:

- Canonical for current execution state only (`Now`, `Next`, `Later`).
- Every item must bind to roadmap milestone IDs from the unified roadmap.
- Detailed ticket breakdown belongs in [docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md](docs/planning/SPRINT_BACKLOG_MEMORY_AGENT.md).

표기 규칙:

- 각 항목은 `M-xx` milestone ID를 반드시 포함한다.

## Now (D1-D30: Foundation Lock)

1. [M-01] Runbook/SOP/Control Tower/Execution Board 통합 기준 동기화 완료
2. [M-02] social graph 신호 수집 안정화(reply/mention/co_presence/reaction) 및 누락 복구 지표 고정
3. [M-02] social hint 활용률/영향도 운영 지표 대시보드 반영
4. [M-03] 도구 부재 감지 -> worker proposal 자동 트리거 v1
5. [M-04] 동적 worker 품질 게이트(정적/정책/샌드박스) 운영 규칙 고정
6. [M-05] Opencode adapter 계약(입출력/승인흐름/감사로그) 명세 확정
7. [M-07] 품질 지표(citation/retrieval/hallucination) 통합 점수화
8. [M-01] [M-03] Core Decision Engine 인터페이스 고정 + Discord 어댑터 경계 분리(인프로세스)
9. [M-03] Event/Command envelope 버전 계약 고정 및 evidence bundle 표준화
10. [M-04] [M-07] 단계별 go/no-go 게이트(신뢰성/품질/안전/거버넌스) 운영 강제
11. [M-05] [M-04] OpenDev -> NemoClaw sandbox 강제 위임 경로 검증(미경유 실행 0건)
12. [M-05] Opencode 고위험 액션 approval_required 강제 + 무증거 반영 차단
13. [M-05] [M-06] workflow 슬롯별 모델 바인딩/폴백 매트릭스 운영 설정 고정

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
- 동시 진행 WIP 최대 3개
- 신규 기능 파일 추가 금지(기존 워크플로우 강화만 허용)
- 각 항목 완료 증거는 gate-runs 또는 runbook 링크로 남긴다
