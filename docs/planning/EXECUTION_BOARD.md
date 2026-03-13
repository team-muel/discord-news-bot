# 실행 보드 (Frontier 2026)

기준 문서: `docs/planning/FRONTIER_2026_PROGRAM.md`

## Now (D1-D30: Foundation Lock)

1. 승인 저장소/동적 워커 레지스트리 영속화
2. 토론 종료 감지 + durable_extraction 자동 enqueue v1
3. memory -> obsidian 역동기화 워커 추가
4. 운영 관측 대시보드 단일화(지연/토큰/품질/비용)
5. Runbook/SOP/Control Tower 상충 항목 정리 완료

## Next (D31-D60: Autonomous Loops)

1. user-topic/user-user/user-time 그래프 추출 파이프라인 v1
2. 개인화 추천 응답 템플릿 + 근거 로그 연결
3. 도구 부재 감지 기반 worker propose 자동 트리거
4. conflict resolve UX 명령/버튼 단일 플로우화
5. 라벨 기반 recall@k 품질 검증 도입

## Later (D61-D90: Frontier Hardening)

1. 멀티길드 스케일 테스트(파일럿 3+)
2. 실패 주입/보안 주입 테스트 운영화
3. go/no-go 연속 통과 + 베타 확장 승인
4. 월간 blocked 0 상태 유지 검증

## 운영 원칙

- 구현률 100%와 운영 무결성을 동시에 달성
- 가용성/정확성/보안을 비용보다 우선
- 배포 판단은 go/no-go 게이트로 일원화
