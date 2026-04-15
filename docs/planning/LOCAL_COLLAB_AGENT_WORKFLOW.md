# Local Collaborative Agent Workflow

## Purpose

이 문서는 로컬 IDE 환경에서 OpenCode, OpenDev, NemoClaw, OpenJarvis를 rigid sequential handoff 대신 lead + consult 방식으로 운영하는 표준을 정의한다.

범위 주의:

- 이 문서는 IDE 협업용 커스터마이징과 의사결정 규칙을 다룬다.
- 역할 이름은 저장소 내부의 협업 역할을 뜻하며, 외부 오픈소스 시스템의 직접 통합 여부를 보증하지 않는다.
- 실제 실행 가능 여부는 런타임 액션 등록, 워커 설정, MCP/HTTP transport 구성으로 판단한다.
- 이름 충돌 해석과 현재 구현된 runtime surface는 `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`를 먼저 본다.

기본 원칙:

- 로컬 개발 기본값은 `local-collab`이다.
- 한 번에 한 명만 lead agent가 된다.
- consult agent는 최대 2명까지 허용한다.
- consult는 ownership transfer가 아니라 decision-quality 향상을 위한 짧은 개입이다.
- release-sensitive 변경은 `delivery`로, incident/release/recovery는 `operations`로 승격한다.

팀 공용 채택 원칙:

- 이 workflow는 개인 프롬프트 요령이 아니라 repo-shared collaboration contract로 취급한다.
- 현재 작업 방식이 이 구조와 맞으면 `.github` instructions와 canonical planning docs에 그대로 등록해 팀 전체가 재사용하게 한다.
- 이 workflow를 읽고 수행하는 agent는 lead, consult, handoff, escalation 계약 안에서 동료처럼 동작하고, 이탈이 필요하면 이유를 명시한다.

## Modes

### local-collab

적합한 경우:

- 아키텍처와 구현이 동시에 얽힌 작업
- 구현 중 중간 검토가 필요한 작업
- 로컬에서 빠르게 반복해야 하는 IDE 중심 작업

흐름:

1. Local Orchestrator가 lead agent를 선택한다.
2. 필요 시 consult agent를 1~2명 붙인다.
3. consult 결과는 lead agent에게 되돌린다.
4. lead agent가 synthesis 후 다음 행동을 결정한다.
5. 형식적 게이트가 필요하면 `delivery` 또는 `operations`로 승격한다.

### delivery

적합한 경우:

- release-grade 구현
- PR-ready 변경
- formal stage gate가 필요한 변경

기본 순서:

1. OpenDev
2. OpenCode
3. NemoClaw
4. OpenJarvis

### operations

적합한 경우:

- incident
- release
- rollback
- unattended automation

기본 원칙:

- OpenJarvis가 먼저 분류하고 ownership을 결정한다.

## Prompt Set

로컬 협업용 prompt 세트:

- `.github/prompts/local-collab-route.prompt.md`
  - lead agent와 consult agent 선택
- `.github/prompts/local-collab-consult.prompt.md`
  - specialist consult 결과를 compact하게 반환
- `.github/prompts/local-collab-synthesize.prompt.md`
  - consult 결과를 하나의 next action으로 합성

형식적 파이프라인용 prompt:

- `.github/prompts/openjarvis-route.prompt.md`
- `.github/prompts/opencode-implement.prompt.md`
- `.github/prompts/nemoclaw-review.prompt.md`
- `.github/prompts/opendev-validate.prompt.md`

## Standard Handoff Fields

모든 prompt는 가능하면 아래 필드를 공통으로 유지한다.

- `lead_agent`
- `consult_agents`
- `required_gates`
- `handoff`
- `escalation`
- `next_action`

필드 의미:

- `lead_agent`: 현재 owner와 ownership reason
- `consult_agents`: specialist input 목록과 consult 시점
- `required_gates`: 다음 단계 전에 필요한 검증
- `handoff`: next owner, handoff reason, expected outcome
- `escalation`: mode 승격 필요 여부와 target mode
- `next_action`: 현재 owner가 바로 수행할 한 가지 행동

## Runtime Alignment

이 local-collab 구조는 customization/control-plane 계층이다.

현재 런타임 기준 연결 지점:

- `src/services/superAgentService.ts`
  - supervisor envelope를 정규화하고, 추천 및 세션 시작 요청을 현재 세션 런타임으로 위임한다.
  - local-collab는 이 facade 위에서 lead/consult/synthesis 의사결정을 정렬하기 위한 상위 orchestration 계약이다.
- `src/services/skills/actions/agentCollab.ts`
  - `local.orchestrator.route`, `local.orchestrator.all`, `opendev.plan`, `nemoclaw.review`, `openjarvis.ops` 같은 역할 기반 액션의 실제 실행 경로를 제공한다.
- `src/services/skills/actions/registry.ts`
  - 현재 런타임에 등록된 역할 액션의 정본이다.
- `src/services/skills/actionRunner.ts`
  - 정책 게이트, 비용/실패 처리, 실행 기록이 통과하는 실제 런타임 실행기다.
- `src/services/langgraph/stateContract.ts`
  - local-collab의 `next_action`, `required_gates`, `escalation` 판단은 최종적으로 node transition과 branch selection의 외부 설명 계층으로 대응된다.
- `src/services/skills/actions/types.ts`
  - action runtime은 이미 `ActionHandoff` 타입(`fromAgent`, `toAgent`, `reason`, `evidenceId`)을 갖고 있다.
  - prompt의 `handoff` 필드는 이 런타임 handoff 개념에 맞춘 상위 표현이며, 필요 시 `fromAgent/toAgent` 형태로 정규화할 수 있어야 한다.
- `src/services/skills/actionExecutionLogService.ts`
  - handoff는 verification 로그에 `handoff=from->to` 형식으로 남는다.
  - local-collab 계약을 실제 runtime에 연결할 경우, consult와 synthesis 결과도 이 verification 체계로 투영할 수 있다.

현재 비포함 범위:

- PATH 기반 로컬 CLI 자동 발견
- 임의의 외부 OSS CLI/서버를 범용 어댑터로 자동 래핑하는 런타임
- 동적 도구 등록

이 범위는 별도 설계 문서인 `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`에서 다룬다.

## Document Ownership

- 이 문서는 local-collab 규칙과 handoff 계약의 정본이다.
- 실제 런타임 경계는 `docs/ARCHITECTURE_INDEX.md`를 따른다.
- 운영 상태와 endpoint 해석은 `docs/OPERATIONS_24_7.md`를 따른다.
- 향후 외부 로컬 도구 통합은 `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`를 따른다.

즉, local-collab customization은 runtime을 교체하는 것이 아니라 다음 두 레벨을 연결한다.

1. IDE-level decision support
2. Runtime-level handoff and execution normalization

## Schema Source Of Truth

local-collab prompt 계약의 스키마 정본은 아래 파일에 추가되었다.

- `docs/planning/AUTONOMY_CONTRACT_SCHEMAS.json`

추가된 스키마:

- `localCollabTaskEnvelope`
- `localCollabRouteResponse`
- `localCollabConsultResponse`
- `localCollabSynthesizeResponse`

이 스키마는 다음 목적에 사용한다.

- prompt 출력 형식 고정
- 향후 supervisor service 입력/출력 계약 초안
- runtime handoff 정규화 규칙과의 정합성 점검

현재 runtime facade 기준 대응:

- `src/services/superAgentService.ts`
  - 입력은 `task_id`, `guild_id`, `objective`, `constraints`, `risk_level`, `acceptance_criteria`, `inputs`, `budget` 중심의 supervisor envelope로 정규화한다.
  - 출력은 `task`, `route`, `runtime_mapping`으로 분리해 prompt/control-plane 계약과 session runtime 매핑을 구분한다.
- `src/routes/bot-agent/coreRoutes.ts`
  - `/api/bot/agent/super/recommend`
  - `/api/bot/agent/super/sessions`
  - 두 엔드포인트 모두 snake_case supervisor 입력을 우선 지원하고, 기존 camelCase는 호환 입력으로만 유지한다.

## Recommended Patterns

### OpenCode lead

적합한 경우:

- 구현, 리팩터, 디버깅, 테스트

자주 붙는 consult:

- OpenDev: boundary, interface, rollout shape
- NemoClaw: failure-path, regression, test-gap
- OpenJarvis: runtime, rollback, workflow impact

### OpenDev lead

적합한 경우:

- architecture, roadmap, ADR, decomposition

자주 붙는 consult:

- OpenCode: implementation feasibility
- OpenJarvis: ops and rollback implications

### NemoClaw lead

적합한 경우:

- review-first, risk-first, security-first tasks

자주 붙는 consult:

- OpenCode: concrete fix path
- OpenJarvis: operational blast radius

### OpenJarvis lead

적합한 경우:

- scripts, automation, deploy, rollback, unattended execution

자주 붙는 consult:

- OpenCode: code change feasibility
- NemoClaw: risk confirmation
- OpenDev: boundary changes

현재 local tool slice 기준 추가 역할:

- `tools.run.cli` 같은 직접 로컬 도구 실행면의 owner
- 로컬 CLI 실행의 운영 안전성, timeout, rollback 관점 검토
- Local Orchestrator가 외부 로컬 도구 호출이 필요한 작업을 분류할 때 기본 lead 후보

## Four-Role Usage Baseline

지금 단계에서는 다음 네 역할만 이해하고 사용하면 충분하다.

- OpenJarvis: 로컬 도구 실행, 운영 자동화, rollback, unattended safety
- OpenCode: TypeScript/Node 구현, 테스트, 리팩터, 코드 수정
- NemoClaw: 리뷰, 회귀, 보안, 테스트 갭 확인
- OpenDev: 아키텍처, 경계 설계, 마일스톤, ADR

실무 규칙:

- 외부 로컬 CLI를 액션으로 붙이거나 실행 정책을 정할 때는 OpenJarvis 관점으로 본다.
- 그 도구를 실제 제품 코드 변경에 연결할 때는 OpenCode가 lead가 된다.
- 새 도구가 만드는 리스크와 회귀는 NemoClaw가 본다.
- 도구를 어떤 경계와 계약으로 노출할지는 OpenDev가 정리한다.

## Escalation Rules

다음 조건 중 하나라도 만족하면 `delivery` 또는 `operations`로 승격한다.

- formal release gate가 필요함
- rollback path가 필수임
- unattended execution 위험이 있음
- startup/auth/scheduler 영향이 있음
- 사용자 노출 동작 변경이 큼

## Hard Gates

- startup/auth/scheduler safety not degraded
- graph-first Obsidian retrieval preserved
- user-facing Discord output sanitization preserved
- workflow and script idempotency preserved

## Usage Notes

- local-collab는 빠른 iteration을 위한 기본값이다.
- specialist는 primary strength이지 hard isolation boundary가 아니다.
- consult는 짧고 high-signal이어야 한다.
- synthesis는 항상 하나의 owner에게 되돌아가야 한다.
