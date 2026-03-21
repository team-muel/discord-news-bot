# OpenJarvis Routing Rules (Draft)

Status note:

- Draft reference only for routing and recovery heuristics.
- Current local IDE collaboration flow is governed by `LOCAL_COLLAB_AGENT_WORKFLOW.md` and `.github/instructions/multi-agent-routing.instructions.md`.
- This draft must not be used as a current execution board or active backlog.

목적:

- OpenJarvis가 작업을 OpenCode/NemoClaw/OpenDev로 일관되게 라우팅한다.
- 실패 시 재시도/롤백/승인 흐름을 기계적으로 결정한다.

원칙:

- `delivery` 모드(기능/코드 변경): OpenDev -> OpenCode -> NemoClaw -> OpenJarvis 고정 체인
- `operations` 모드(incident/release/recover): 분류 기반 동적 라우팅

## 1) 작업 분류 규칙

분류 라벨:

- `discover`: 탐색, 영향 범위, 원인 분석
- `implement`: 코드 변경, 테스트 추가
- `verify`: 타입/린트/테스트/보안 검증
- `release`: 배포/릴리스 실행
- `recover`: 장애 복구/롤백

우선순위:

1. recover
2. release
3. verify
4. implement
5. discover

## 2) 에이전트 할당 규칙

delivery 모드:

- OpenDev: 스코프/비목표/마일스톤 슬라이스 정의
- OpenCode: 최소 패치 구현
- NemoClaw: 회귀/보안/테스트 갭 리뷰
- OpenJarvis: 운영 게이트/롤백 준비도 검증

operations 모드:

- `discover` -> NemoClaw
- `implement` -> OpenCode
- `verify` -> OpenDev
- `release` -> OpenDev (승인 정책 필수)
- `recover` -> OpenDev(롤백) + OpenCode(핫픽스)

병렬 허용:

- NemoClaw 탐색과 OpenDev 사전 환경검증은 병렬 가능
- OpenCode 구현과 OpenDev 최종 검증은 직렬 고정

## 3) 리스크 기반 정책

리스크 등급:

- `low`: 자동 머지 가능, 배포는 정책에 따름
- `medium`: 수동 승인 1회 필요
- `high`: 2인 승인 + canary 필수 + rollback plan 필수

강제 규칙:

- high risk에서 evidence bundle 누락 시 즉시 `blocked`
- 승인 미완료 상태에서 release 요청 시 즉시 `denied`

## 4) 상태 전이 (State Machine)

`proposed -> classified -> routed -> executing -> verified -> approved -> released`

실패 전이:

- `executing -> failed -> reroute`
- `verified -> failed -> implement`
- `released -> incident -> recover`

## 5) 재시도와 폴백

재시도 정책:

- 동일 원인 실패: 최대 2회
- 원인 미분류 실패: 1회 후 human review

폴백 순서:

1. OpenDev 검증 실패 -> OpenCode 수정 루프
2. OpenCode 구현 실패 -> NemoClaw 재탐색 루프
3. release 실패 -> 즉시 rollback + incident 기록

## 6) 결정 출력 스키마

```json
{
  "task_id": "TASK-...",
  "classification": "implement",
  "risk_level": "medium",
  "routing": [
    {
      "agent": "NemoClaw",
      "purpose": "impact analysis",
      "blocking": true
    },
    {
      "agent": "OpenCode",
      "purpose": "minimal patch",
      "blocking": true
    },
    {
      "agent": "OpenDev",
      "purpose": "gate validation",
      "blocking": true
    }
  ],
  "approval": {
    "required": true,
    "policy": "medium-risk-single-approval"
  },
  "next_action": "run nemo discovery",
  "failure_path": "if gate fail then reroute to OpenCode"
}
```

## 7) 운영 알람 트리거

- 24시간 내 동일 태스크 3회 이상 실패
- high risk 태스크의 승인 지연 30분 초과
- release 후 10분 내 error rate 급증

## 8) 추적 지표

- 분류 정확도(`classification_correction_rate`)
- 재시도율(`retry_rate`)
- 무증거 성공 비율(`evidence_missing_success_rate`, 목표 0)
- 승인 리드타임(`approval_lead_time_p95`)
- 복구 시간(`mttr`)
