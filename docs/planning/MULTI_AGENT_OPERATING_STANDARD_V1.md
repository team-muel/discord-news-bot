# Multi-Agent Operating Standard v1

목표:

- 충돌 없는 단일 실행 규칙으로 OpenCode, NemoClaw, OpenDev, OpenJarvis를 운영한다.
- 안정성, graph-first retrieval, 보안, 무인 운영 준비도를 동시에 보장한다.

## 1) Plane and Layer

### 1.1 Control Plane

- 정책, 라우팅, 승인, Go/No-Go를 관리한다.
- 기준 문서: `docs/planning/PLATFORM_CONTROL_TOWER.md`, `docs/OPERATOR_SOP_DECISION_TABLE.md`.

### 1.2 Execution Plane

- 에이전트 협업과 핸드오프를 수행한다.
- 기준 문서: `.github/copilot-instructions.md`, `.github/instructions/multi-agent-routing.instructions.md`.

### 1.3 Runtime/Data Plane

- Discord/API/Automation 런타임과 Supabase/Obsidian/MCP adapter 경계를 유지한다.
- 기준 문서: `docs/ARCHITECTURE_INDEX.md`, `.env.example`.

## 2) Routing Modes

### 2.1 Delivery Mode (feature or code change)

고정 체인:

1. OpenDev: target state, non-goals, milestone slice 정의
2. OpenCode: 최소 변경 구현
3. NemoClaw: 회귀/보안/테스트 갭 리뷰
4. OpenJarvis: 운영 게이트/롤백 준비도 검증

### 2.2 Operations Mode (incident/release/recover)

분류 기반 라우팅:

- discover -> NemoClaw
- implement -> OpenCode
- verify/release -> OpenDev
- recover -> OpenDev + OpenCode

## 3) Shared Payload Contract

모든 stage payload는 아래 필드를 포함해야 한다.

- task_id
- guild_id
- objective
- constraints
- risk_level
- acceptance_criteria
- inputs
- budget

누락 시 정책 위반으로 `blocked` 처리한다.

## 4) Hard Gates

- startup/auth/scheduler 안정성 저하 금지
- Obsidian graph-first retrieval 동작 보존
- Discord 사용자 노출 deliverable sanitization 보장
- workflow/script idempotency 유지
- evidence bundle 없는 성공 판정 금지

## 5) Handoff Contract

각 stage 출력 필수 항목:

- scope and non-goals
- changed files or touched surfaces
- validation commands and outcomes
- known risks and rollback path
- next owner

## 6) Environment Layering Rules

- Profile layer: deployment/runtime mode
- Provider layer: LLM selection/fallback/time budget
- Knowledge layer: Obsidian adapter order and graph search
- Action layer: MCP delegation, action policy, approval table
- Reliability layer: readiness, finops, go/no-go thresholds

환경값은 layer를 가로질러 중복 정의하지 않는다.

## 7) Release and Recovery

출시 전:

1. typecheck/test/security/ops-readiness gate 통과
2. 승인 정책 충족 (risk level 기반)
3. rollback rehearsal 증거 첨부

실패 시:

1. OpenJarvis가 No-Go 선언
2. rollback 즉시 실행
3. incident/comms/postmortem 문서 체인 연결
4. OpenCode 재수정 루프로 복귀

## 8) KPI

- classification_correction_rate
- retry_rate
- approval_lead_time_p95
- evidence_missing_success_rate (target 0)
- execution_success_rate
- fallback_success_rate
- mttr
