# OpenJarvis Test/Deploy Gate Checklist

목적:

- OpenJarvis 경유 워크플로우에서 테스트/배포 게이트를 fail-open 없이 강제한다.

## 1) 사전 입력 체크 (Start Gate)

- [ ] `task_id` 존재
- [ ] `guild_id` 존재
- [ ] `risk_level` 지정
- [ ] `acceptance_criteria` 존재
- [ ] `rollback_plan` 존재 (medium/high 필수)
- [ ] 승인 요구 여부(`approval_required`) 명시

실패 처리:

- 하나라도 누락 시 `blocked:start-gate` 반환

## 2) 구현 완료 체크 (Implement Gate)

- [ ] 변경 파일 목록 제출
- [ ] 패치 요약 제출
- [ ] 테스트 수정/추가 내역 제출
- [ ] 알려진 리스크 제출

실패 처리:

- 증거 누락 시 NemoClaw 재탐색 또는 OpenCode 보완 요청

## 3) 검증 게이트 (Verify Gate)

필수 명령:

- [ ] typecheck (`npm run -s tsc -- --noEmit` 또는 프로젝트 표준 명령)
- [ ] lint (`npm run -s lint`)
- [ ] unit/integration test (`npm run -s test`)
- [ ] security scan (프로젝트 표준 명령)

판정 규칙:

- 모든 게이트 pass여야 다음 단계 진행
- 단일 fail도 release 불가

## 4) 배포 게이트 (Release Gate)

- [ ] risk=low: 정책상 자동 배포 허용 여부 확인
- [ ] risk=medium: 수동 승인 1회 확인
- [ ] risk=high: 2인 승인 + canary + rollback rehearsal 확인
- [ ] evidence bundle 첨부

배포 중단 조건:

- 승인 누락
- evidence 누락
- canary health check 실패

## 5) 사후 검증 (Post-Release Gate)

- [ ] 5분 health check pass
- [ ] error rate/latency 급증 없음
- [ ] 알람/incident 상태 확인
- [ ] 변경 사항 로그 기록 완료

실패 처리:

- 즉시 rollback
- incident template 기록
- recover 분류로 재라우팅

## 6) 롤백 게이트 (Recover Gate)

- [ ] rollback type 결정(stage|queue|provider)
- [ ] rollback 실행 명령/절차 확인
- [ ] 복구 후 검증 게이트 재실행
- [ ] 원인 분석과 재발 방지 항목 기록

## 7) 산출물 템플릿 (게이트 판정 로그)

```json
{
  "task_id": "TASK-...",
  "risk_level": "high",
  "start_gate": "pass",
  "implement_gate": "pass",
  "verify_gate": {
    "typecheck": "pass",
    "lint": "pass",
    "test": "pass",
    "security": "pass"
  },
  "release_gate": "blocked",
  "blocked_reason": "missing second approval",
  "next_action": "request second approval"
}
```
