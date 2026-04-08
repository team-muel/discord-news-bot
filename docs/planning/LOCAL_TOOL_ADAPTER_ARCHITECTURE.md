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
- `src/services/obsidian/adapters/remoteMcpAdapter.ts`
- `src/services/obsidian/adapters/scriptCliAdapter.ts`

이 계층은 capability 기반 어댑터 선택, 실행 가능 여부 확인, CLI wrapper / HTTP 패턴을 이미 보여준다.

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

## Concrete External Tool Adapters

다음 어댑터는 `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md`의 Phase 1-4에 따라 구현한다.

### OpenShell CLI Adapter

위치: `src/services/tools/adapters/openshellCliAdapter.ts`

```typescript
interface OpenShellAdapter {
  isAvailable(): Promise<boolean>;        // `openshell --version` 실행 확인
  listSandboxes(): Promise<Sandbox[]>;    // `openshell sandbox list` 파싱
  createSandbox(opts: { agent: string; from?: string; gpu?: boolean }): Promise<Sandbox>;
  connectSandbox(name: string): Promise<void>;
  setSandboxPolicy(name: string, policyPath: string): Promise<void>;
  setInference(opts: { provider: string; model: string }): Promise<void>;
}
```

발견 방식:

- `OPENSHELL_BIN_PATH` env var 또는 `openshell` in PATH
- `openshell --version` exit code 0 확인

Capability 목록:

- `sandbox.create` — 에이전트 샌드박스 생성
- `sandbox.connect` — 실행 중인 샌드박스에 연결
- `sandbox.list` — 샌드박스 상태 조회
- `policy.set` — 네트워크/파일시스템 정책 적용
- `inference.set` — 추론 엔드포인트 설정

### NemoClaw CLI Adapter

위치: `src/services/tools/adapters/nemoclawCliAdapter.ts`

```typescript
interface NemoClawAdapter {
  isAvailable(): Promise<boolean>;        // `nemoclaw --version` 또는 npm global 확인
  onboard(opts: { name: string; apiKey?: string }): Promise<OnboardResult>;
  getStatus(name: string): Promise<SandboxStatus>;
  connect(name: string): Promise<void>;
  getLogs(name: string, follow?: boolean): Promise<string>;
  execInSandbox(name: string, command: string): Promise<ExecResult>;
}
```

발견 방식:

- `NEMOCLAW_BIN_PATH` env var 또는 `nemoclaw` in PATH
- `which nemoclaw` / `where nemoclaw` exit code 0 확인

Capability 목록:

- `agent.onboard` — 새 OpenClaw 에이전트 + 샌드박스 설정
- `agent.status` — 샌드박스 상태 조회
- `agent.connect` — 에이전트 셸 연결
- `agent.logs` — 실시간 로그 스트림
- `agent.exec` — 샌드박스 내부 명령 실행 (리뷰, 테스트 등)

### OpenClaw CLI Adapter

위치: `src/services/tools/adapters/openclawCliAdapter.ts`

```typescript
interface OpenClawAdapter {
  isAvailable(): Promise<boolean>;        // `openclaw --version` 확인
  sendMessage(opts: { agent: string; message: string; sessionId: string }): Promise<string>;
  listSkills(): Promise<Skill[]>;
  createSkill(opts: { name: string; description: string }): Promise<Skill>;
}
```

발견 방식:

- `OPENCLAW_BIN_PATH` env var 또는 `openclaw` in PATH
- NemoClaw 샌드박스 내부에서 자동 사용 가능

Capability 목록:

- `agent.chat` — 에이전트에 메시지 전송
- `skill.list` — 등록된 스킬 목록
- `skill.create` — 새 스킬 생성 (자기 개선 파이프라인)

### OpenJarvis CLI/HTTP Adapter

위치: `src/services/tools/adapters/openjarvisAdapter.ts`

```typescript
interface OpenJarvisAdapter {
  isAvailable(): Promise<boolean>;        // `jarvis doctor` 실행 확인
  ask(message: string): Promise<string>;  // `jarvis ask "..."` CLI 호출
  serve(): Promise<{ url: string }>;      // `jarvis serve` FastAPI 서버 시작
  optimize(): Promise<OptimizeResult>;    // `jarvis optimize` trace 기반 self-learning
  bench(): Promise<BenchResult>;          // `jarvis bench` 에너지/레이턴시 벤치마크
  listAgents(): Promise<Agent[]>;         // 등록된 에이전트 유형 목록
  scheduleJob(cron: string, task: string): Promise<void>; // cron 스케줄러
}
```

발견 방식:

- `OPENJARVIS_BIN_PATH` env var 또는 `jarvis` in PATH
- `jarvis doctor` exit code 0 확인
- `OPENJARVIS_SERVE_URL` env var로 HTTP 모드 우선 (FastAPI 서버)

Capability 목록:

- `jarvis.ask` — 단일 질의 (CLI)
- `jarvis.chat` — 대화형 세션
- `jarvis.serve` — OpenAI-호환 API 서버 (llmClient provider로 직접 연결)
- `jarvis.optimize` — trace 기반 모델/에이전트/프롬프트 자동 최적화
- `jarvis.bench` — 에너지/비용/레이턴시 벤치마크
- `jarvis.schedule` — cron 기반 자동화 ops

HTTP 모드 (권장):

- `jarvis serve` 실행 시 `http://localhost:8000`에서 OpenAI-호환 API 제공
- `src/services/llmClient.ts`의 OpenAI-호환 provider로 직접 연결 가능
- SSE 스트리밍 지원

### Action Routing Update

기존 내부 액션과 외부 도구 매핑:

| 기존 액션 | adapter 호출 | 조건 |
| --- | --- | --- |
| `nemoclaw.review` | `NemoClawAdapter.execInSandbox(name, 'openclaw agent --agent review ...')` | NemoClaw 사용 가능 시 |
| `nemoclaw.review` (fallback) | 기존 in-process LLM review | NemoClaw 미설치 시 |
| `opencode.execute` | `OpenShellAdapter.createSandbox({ agent: 'opencode' })` | OpenShell 사용 가능 시 |
| `opencode.execute` (fallback) | 기존 MCP worker delegation | OpenShell 미설치 시 |
| `openjarvis.ops` | `OpenJarvisAdapter.scheduleJob(cron, task)` + `ask(message)` | OpenJarvis 사용 가능 시 (우선) |
| `openjarvis.ops` | `OpenClawAdapter.sendMessage({ message: '...' })` | OpenClaw 사용 가능 시 (보조) |
| `openjarvis.ops` (fallback) | 기존 in-process ops execution | OpenJarvis 미설치 시 |

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
- `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md`
- `.github/instructions/multi-agent-routing.instructions.md`
