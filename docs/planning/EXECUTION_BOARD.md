# 실행 보드 (Frontier 2026)

기준 문서: `docs/planning/FRONTIER_2026_PROGRAM.md`

마일스톤 기준 문서: `docs/planning/UNIFIED_ROADMAP_SOCIAL_OPS_2026Q2.md`

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

## Next (D31-D60: Autonomous Loops)

1. [M-03] 요청 없음 구간에서도 누락 기능 탐지 -> 제안 큐 자동 생성 강화
2. [M-05] Opencode executor 파일럿(approval_required 고정)
3. [M-06] provider dual profile(cost-optimized vs quality-optimized) 운영
4. [M-07] ToT/GoT + provider별 품질 정규화 계측 도입
5. [M-07] 라벨 기반 recall@k 및 hallucination review 자동 리포트

## Later (D61-D90: Frontier Hardening)

1. [M-08] 멀티길드 스케일 테스트(파일럿 3+) 및 안정화
2. [M-08] 실패 주입/보안 주입 테스트 운영화
3. [M-08] Go/No-Go 연속 통과 + 베타 확장 승인
4. [M-08] 월간 blocked 0 상태 유지 검증
5. [M-06] 신모델/신도구(Opencode 포함) 도입 템플릿 운영 고정

## 운영 원칙

- 구현률 100%와 운영 무결성을 동시에 달성
- 가용성/정확성/보안을 비용보다 우선
- 배포 판단은 go/no-go 게이트로 일원화
- 단일 개발자 운영에서 컨텍스트 과부하를 핵심 리스크로 관리
