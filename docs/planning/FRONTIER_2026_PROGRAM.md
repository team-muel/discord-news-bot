# Frontier 2026 Program

목표: 기존 레거시 계획/런북/로드맵을 모두 구현 완료 상태로 수렴시키고, 운영 중 문제를 구조적으로 제거한다.

비전 선언:

- 2026 기준 업계 최전선 수준의 Discord-native agent platform 구현
- 기능 구현 완료뿐 아니라 운영 무결성(가용성/비용/품질/보안) 동시 달성
- "실험 프로젝트"가 아니라 "지속 운영 가능한 표준 플랫폼"으로 전환
- 개인 개발자 1인이 최신 아키텍처를 실시간으로 검증/적용할 수 있는 AGI 테스트베드 구축
- AI가 유저를 위한 기능/서비스를 스스로 제안하고 구현하는 개발 루프 고도화
- Discord 기능을 UI/UX 채널로 활용한 서비스 경험 제공과 CS 자동화 달성
- Obsidian CLI + Headless를 결합한 실시간 맥락 흡수/저장/학습 루프 운영
- Graph-first memory intelligence: 청킹 우선이 아닌 태그/백링크/링크 그래프 기반 회수 최적화

## 1) Program KPI (최종 성공 기준)

- 기능 완결도: 모든 로드맵 항목 완료율 100%
- 운영 안정성: SEV-1 월 0건, SEV-2 주 1건 이하
- 품질: citation_rate >= 0.95, recall@5 >= 0.60 유지
- 비용: FinOps blocked 상태 월 0일
- 확장성: 동적 워커 승인 후 활성화 성공률 >= 99%
- 제품 전달력: 사용자 요청에서 서비스 기능 릴리스까지 리드타임 주간 개선
- 실시간성: 신규 맥락이 ingest -> 저장 -> 회수에 반영되는 end-to-end 지연 지속 단축
- 자동화: Discord 기반 CS 처리의 자동 완결 비율 주간 상승
- 그래프 무결성: unresolved/ambiguous/orphan/dead-end 지표가 운영 임계치 이내 유지

## 2) Workstream (5개)

핵심 과제 축(현재 선언 반영):

- C1. AI 서비스 개발 자동화
- C2. 실시간 맥락 흡수/저장/학습
- C3. Discord-native UI/UX 경험
- C4. CS 자동화
- C5. Hardcoding 제거 및 정책/설정 외부화

### WS-A Core Memory Autopilot

범위:

- 토론 종료 감지
- 자동 요약/추출/충돌해결
- memory -> obsidian 역동기화

출처 문서:

- LONG_TERM_MEMORY_AGENT_ROADMAP.md
- SPRINT_BACKLOG_MEMORY_AGENT.md
- MEMORY_RETRIEVAL_SCORING.md

완료 조건:

- 수동 명령 없이 지식 자산화 루프가 주간 기준 자동 유지
- 회수 정책은 그래프 관계 신호(태그/백링크/연결성) 기반으로 유지

### WS-B Hyper-Personalized Community Graph

범위:

- user-topic/user-user/user-time 엣지 모델
- 개인화 추천 응답 규칙
- 개인화 품질 계측

출처 문서:

- ADR-002-memory-retrieval-policy.md
- ADR-005-context-compression-pipeline.md

완료 조건:

- 추천 포함 응답 만족도 개선과 재질문율 감소가 지표로 검증

### WS-C Infinite Expansion Worker Loop

범위:

- 도구 부재 감지 -> worker propose 자동화
- harness 승인/반려/리팩토링 루프
- 동적 워커 영속화 + 재시작 복구

출처 문서:

- HARNESS_ENGINEERING_PLAYBOOK.md
- HARNESS_RELEASE_GATES.md

완료 조건:

- 신규 기능 요청의 절반 이상을 승인형 동적 워커로 흡수

### WS-D 24/7 Operations and Reliability

범위:

- runbook/sop/oncall 체계 일치
- 배포 후 자동 검증
- incident evidence 표준화

출처 문서:

- RUNBOOK_MUEL_PLATFORM.md
- OPERATIONS_24_7.md
- OPERATOR_SOP_DECISION_TABLE.md

완료 조건:

- 장애 대응이 문서 기반으로 재현 가능

### WS-F Discord UX and CS Automation

범위:

- 반응/버튼/스레드/폼 기반 사용자 흐름 표준화
- FAQ/운영 문의/설정 요청의 자동 분류 및 자동 응답
- 인간 개입이 필요한 케이스만 escalation

출처 문서:

- RUNBOOK_MUEL_PLATFORM.md
- OPERATIONS_24_7.md
- FRONTEND_INTEGRATION.md

완료 조건:

- 반복 CS 케이스의 자동 완결률이 운영 목표치를 지속 달성

### WS-E FinOps and Governance

범위:

- 예산 가드레일 자동화
- 정책 fail-closed 유지
- go/no-go 게이트 운영화

출처 문서:

- FINOPS_PLAYBOOK.md
- BETA_GO_NO_GO_CHECKLIST.md

완료 조건:

- blocked 장기 지속 0, no-go 발생 시 원인 제거 리드타임 단축

## 3) 90-Day Delivery Plan

### Phase 1 (D1-D30): Foundation Lock

- 컨트롤 타워 기준으로 canonical 문서 확정
- 승인 저장소/동적 워커 레지스트리 영속화
- 관측 지표(지연, 토큰, 품질, 비용) 단일 대시보드 연결
- Discord UX 이벤트(버튼/리액션/채널 구조) 수집 파이프라인 계측 고정
- Obsidian CLI/Headless 역할 분리 운영 정책 고정
- 디스코드 계층 하드코딩 상수/매직넘버 인벤토리 완성 및 우선순위화

Gate:

- 재시작 이후 상태 복원 100%
- 운영 문서 충돌 0건

### Phase 2 (D31-D60): Autonomous Loops

- 자가증식 지식 루프 완성
- 개인화 그래프 추출 v1
- 도구 부재 감지 기반 worker propose 자동 트리거
- 사용자 요청 -> 기능 제안 -> 구현 티켓화 루프 자동화 v1
- CS 자동 분류/응답/승격 라우팅 v1
- 하드코딩 제거 1차(명령/의도/응답길이/스트리밍 주기) 완료

Gate:

- 자동 지식화 비율 목표 달성
- 개인화 응답 효과 지표 유의미 개선

### Phase 3 (D61-D90): Frontier Hardening

- 멀티길드 스케일 검증
- 실패 모드/보안 모드 주입 테스트
- go/no-go 전항목 연속 통과
- 신기술/신모델을 개인 테스트베드에서 신속 검증하는 도입 템플릿 고정
- 하드코딩 제거 2차(정책/가드레일/운영 임계치) 완료

Gate:

- 프로덕션 배포 승인 가능 상태

## 4) Program Governance

- Daily 15m: 개인 운영 점검(상태/차단요인/다음 실행 3개)
- Weekly 60m: KPI 리뷰 + 백로그 재정렬
- Bi-weekly: 로드맵 대비 편차 분석 + 실행 보드 업데이트
- Monthly: Runbook/SOP/Threshold 재승인

운영 모델:

- 본 프로그램은 단일 개발자 운영을 기본 전제로 한다.
- "팀 커뮤니케이션 리스크"보다 "개인 컨텍스트 과부하"를 핵심 리스크로 관리한다.

의사결정 원칙:

1. 가용성/안전 > 비용
2. 품질 저하를 비용 절감으로 정당화하지 않음
3. 배포는 go/no-go 통과 기반

## 5) Definition of Done (Program)

아래 7개가 모두 충족되면 Program 완료:

1. 기존 로드맵 항목 100% 구현
2. 미해결 P0 이슈 0건
3. 운영 문서-실행 불일치 0건
4. 동적 확장 루프가 승인형으로 안정 동작
5. 개인화 응답 지표 개선이 통계적으로 확인
6. 비용 가드레일이 월간 안정 상태 유지
7. 파일럿 길드 운영 결과가 베타 확장 기준 충족
8. Discord UX/CS 자동화 루프가 인간 개입 최소화 상태로 운영 기준 충족
