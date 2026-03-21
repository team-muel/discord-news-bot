# Local Tool Adapter Architecture

## Purpose

이 문서는 저장소가 현재 지원하는 로컬 런타임 통합과, 아직 구현되지 않은 로컬 외부 도구 어댑터 계층을 분리해서 설명한다.

이름 충돌 해석과 현재 구현된 runtime surface의 정본은 `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`에 있다.
이 문서는 그중에서도 future generalized local tool layer만 따로 다룬다.

이 문서의 목표는 두 가지다.

- 현재 가능한 것과 불가능한 것을 운영자/개발자가 같은 기준으로 이해하게 한다.
- 향후 로컬 외부 OSS CLI 또는 서버를 first-class tool로 붙일 때 재사용할 설계 기준을 제공한다.

## Out Of Scope

이 문서는 다음을 보장하지 않는다.

- PATH 기반 임의 CLI 자동 발견
- 임의의 외부 OSS 서버 자동 등록
- 범용 도구 스키마 자동 추론
- 동적 런타임 도구 등록 구현 완료

위 기능은 아직 구현 대상이지 현재 기능이 아니다.

## Current Runtime Facts

현재 저장소에서 이미 지원하는 로컬 실행면은 다음과 같다.

### First Local CLI Tool Slice

- `src/services/tools/toolRegistry.ts`
- `src/services/tools/toolExecutor.ts`
- `src/services/tools/toolRouter.ts`
- `src/services/tools/adapters/scriptCliToolAdapter.ts`
- `src/services/skills/actions/tools.ts`
- `src/routes/bot-agent/toolsRoutes.ts`

현재 저장소는 첫 수직 슬라이스로 다음을 지원한다.

- 명시적 env 기반 단일 CLI tool 등록
- `execFile` 기반 비셸 실행
- `tools.run.cli` 액션 노출
- `GET /api/bot/agent/tools/status` 상태 surface

현재도 지원하지 않는 것:

- PATH 기반 자동 발견
- 다중 tool registry
- 동적 tool/action 등록
- 임의 명령 문자열 직접 실행

### Local LLM Provider Support

- `src/services/llmClient.ts`
- `ollama` provider 지원
- provider alias `local -> ollama`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AI_PROVIDER` 기반 설정

### HTTP and MCP-style Delegated Workers

- `src/services/mcpWorkerClient.ts`
- `src/services/skills/actions/mcpDelegatedAction.ts`
- `scripts/agent-role-worker.ts`

현재 구조는 등록된 액션을 HTTP/MCP 스타일 transport로 위임할 수 있다.

### Runtime-backed Collaboration Actions

- `src/services/skills/actions/agentCollab.ts`
- `src/services/skills/actions/registry.ts`

현재 role-backed action은 다음과 같다.

- `local.orchestrator.route`
- `local.orchestrator.all`
- `opencode.execute`
- `opendev.plan`
- `nemoclaw.review`
- `openjarvis.ops`

### Existing Adapter Pattern To Reuse

- `src/services/obsidian/router.ts`
- `src/services/obsidian/types.ts`
- `src/services/obsidian/adapters/scriptCliAdapter.ts`
- `src/services/obsidian/adapters/headlessCliAdapter.ts`

이 계층은 capability 기반 어댑터 선택, 실행 가능 여부 확인, CLI wrapper 패턴을 이미 보여준다.

## Missing Layer

현재 저장소에는 다음 계층이 없다.

- 설치된 로컬 OSS CLI/서버 자동 발견기
- 범용 다중 CLI adapter registry
- tool schema/argument contract 자동 생성기
- worker/action registry에 연결되는 동적 tool registration

즉, 현재는 일부 provider와 일부 role worker, 그리고 단일 명시적 CLI tool slice는 존재하지만, 임의 로컬 도구를 일괄적으로 first-class tool로 승격하는 일반 레이어는 없다.

## Proposed Architecture

권장 구조는 기존 role runtime 위에 일반화된 tool adapter 레이어를 추가하는 것이다.

### Layering

1. discovery layer
2. adapter registry layer
3. execution transport layer
4. action exposure layer

### Discovery Layer

책임:

- PATH, env var, 명시적 config를 기준으로 사용 가능한 로컬 도구 탐지
- 실행 파일 존재 여부와 기본 health probe 수행

후보 위치:

- `src/services/tools/discovery/`

### Adapter Registry Layer

책임:

- 도구별 capability 선언
- `isAvailable()` 체크
- 입력 인자 정규화
- timeout/retry 정책 정의

후보 위치:

- `src/services/tools/adapters/`
- `src/services/tools/toolRouter.ts`

권장 인터페이스는 `src/services/obsidian/types.ts`의 adapter 계약을 일반화하는 방식이다.

### Execution Transport Layer

책임:

- 로컬 프로세스 실행
- HTTP/MCP worker 호출
- 결과 정규화 및 오류 표준화

재사용 대상:

- `src/services/mcpWorkerClient.ts`
- `src/services/skills/actions/mcpDelegatedAction.ts`
- `src/services/obsidian/adapters/scriptCliAdapter.ts`

### Action Exposure Layer

책임:

- 발견된 도구 또는 등록된 adapter를 action catalog에 연결
- 운영자 endpoint에서 가시화
- 정책/권한/비용 게이트 통과

재사용 대상:

- `src/services/skills/actions/registry.ts`
- `src/services/skills/actionRunner.ts`
- `src/routes/bot-agent/governanceRoutes.ts`

## Design Rules

1. 커스터마이징 역할명과 도구 통합 레이어를 혼동하지 않는다.
2. 등록되지 않은 도구는 존재하더라도 action catalog에서 callable로 취급하지 않는다.
3. 로컬 CLI 호출은 timeout, exit code, stderr 표준화를 강제한다.
4. 정책 게이트 없이 도구를 직접 노출하지 않는다.
5. 운영자는 catalog, role-workers, readiness endpoint만으로 실제 가용성을 판단할 수 있어야 한다.

## First Increment

첫 구현 단위는 범용 전체가 아니라 작은 수직 슬라이스가 적절하다.

현재 상태:

1. 명시적 config 기반 local tool adapter registry 추가 완료
2. 단일 CLI adapter 인터페이스 정의 완료
3. health/status endpoint에 adapter 상태 노출 완료
4. action catalog에 adapter-backed action 연결 완료
5. 정책/timeout/로그 경로 검증의 추가 심화는 후속 과제

후속 권장 순서:

1. 다중 tool allowlist registry로 확장
2. tool별 capability 구분 도입
3. 실행 이력/비용/실패 사유 관측성 강화
4. worker delegation 또는 HTTP adapter 확장
5. 문서와 운영 템플릿의 예제 확장

## Verification Criteria

- 설치되지 않은 도구는 false positive 없이 unavailable로 보고된다.
- 설치된 도구는 catalog와 health surface에서 일관되게 보인다.
- 실행 결과는 action runner를 통해 공통 로그/정책 체계를 통과한다.
- `.github` 역할 문서가 도구 가용성을 대신 설명하지 않는다.

## Related Documents

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`
- `docs/ARCHITECTURE_INDEX.md`
- `docs/OPERATIONS_24_7.md`
- `docs/planning/LOCAL_COLLAB_AGENT_WORKFLOW.md`
- `.github/instructions/multi-agent-routing.instructions.md`
