# Opencode Executor Minimum Spec

Status note:

- Reference specification for executor safety and rollout constraints.
- This document does not control current WIP priority; use `EXECUTION_BOARD.md` and `SPRINT_BACKLOG_MEMORY_AGENT.md` for active work.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

목표:

- 기존 액션 러너/승인 거버넌스 체인 안에서 터미널 실행형 도구를 안전하게 도입한다.
- 프레임워크 교체가 아니라 실행 capability(샌드박스 터미널)만 단계적으로 확장한다.

## 1) 현재 반영된 구성요소

- New action: `opencode.execute`
- Delegation path: MCP worker (`MCP_OPENCODE_WORKER_URL` + `MCP_OPENCODE_TOOL_NAME`)
- Planner fallback intent rule: 터미널/CLI/opencode 관련 요청 시 `opencode.execute` 후보화
- 기존 거버넌스 적용:
  - allowlist (`ACTION_ALLOWED_ACTIONS`)
  - tenant policy (`agent_action_policies`)
  - approval gate (`approval_required`)
  - execution logs (`agent_action_logs`)

## 2) 안전 모델 (핵심)

기본 원칙:

1. 액션 실행은 policy-first
2. 승인 없는 자동 배포/파괴 명령 금지
3. 위험 명령어 사전 차단

`opencode.execute`는 아래 가드레일을 가진다.

- 빈 task 차단
- task 길이 제한
- 파괴적 명령 패턴 차단
  - rm -rf
  - git reset --hard
  - git clean -fd
  - format, mkfs, shutdown 등

## 3) 운영 설정

필수/권장 env:

- `MCP_OPENCODE_WORKER_URL` (required to delegate)
- `MCP_OPENCODE_TOOL_NAME` (default: `opencode.run`)
- `ACTION_ALLOWED_ACTIONS` (권장: 필요한 액션만 명시)
- `ACTION_POLICY_DEFAULT_RUN_MODE=approval_required` (권장)
- `ACTION_MCP_STRICT_ROUTING=true` (운영 초기 권장)

권장 초기 allowlist 예:

- `rag.retrieve,web.search,web.fetch,db.supabase.read,code.generate,opencode.execute`

## 4) 롤아웃 단계

1. Shadow

- `ACTION_RUNNER_MODE=dry-run`
- `opencode.execute` 요청/계획/정책 차단 로그 수집

1. Guarded execution

- `ACTION_RUNNER_MODE=execute`
- `opencode.execute`는 `approval_required` 유지
- 승인 큐 처리 + 실패 패턴 수집

1. Controlled automation

- 특정 길드/액션 정책에서만 `run_mode=auto`
- 비용/품질/실패율 기준 미달 시 즉시 rollback

## 5) 운영 체크리스트

- `GET /api/bot/agent/actions/policies?guildId=<id>`로 `opencode.execute` 정책 확인
- `PUT /api/bot/agent/actions/policies`로 runMode 조정
- `GET /api/bot/agent/actions/approvals`로 승인 대기 모니터링
- `agent_action_logs`에서 실패 코드/재시도/지연 관측

## 6) 비목표 (이번 단계)

- 무제한 터미널 권한
- 승인 없는 자가 배포
- 동적 도구 즉시 영구 등록

이번 단계는 "실행 capability를 안전하게 연결"하는 최소 통합이다.
