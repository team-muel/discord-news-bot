# Local-First Hybrid Autonomy

Status note:

- Reference design for the local-first runtime profile and fallback posture.
- Runtime availability must be validated through configured providers, worker endpoints, and health surfaces rather than this document alone.

목표:

- 개발자 로컬 머신이 켜져 있을 때는 Ollama 기반 추론을 우선 사용해 응답 품질과 실험 속도를 높인다.
- 운영 환경은 여전히 원격 worker + 원격 fallback provider를 유지해 OpenJarvis unattended autonomy를 끊지 않는다.

이 문서에서 나오는 역할 이름은 저장소 내부 런타임/협업 라벨이다.
이름 충돌 해석과 현재 구현된 runtime surface는 `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`를 기준으로 본다.

핵심 원칙:

1. 추론과 실행을 분리한다.
2. 로컬 LLM은 우선 경로이지 단일 장애점이 아니다.
3. unattended automation은 원격 worker fail-closed를 유지한다.
4. 운영 경로는 remote-only baseline을 훼손하지 않는다.

## 1) 적용 대상

로컬 강화 대상:

- OpenDev 설계/문서 초안
- NemoClaw 리뷰/비평
- OpenCode 코드 초안/리팩터링 제안
- 일반 `/해줘` 세션의 planner, critique, synthesis 경로

원격 유지 대상:

- `implement.execute` (legacy runtime id: `opencode.execute`)
- OpenJarvis unattended autonomy
- 승인/배포/rollback 경로

## 2) 프로필

로컬 강화 프로필:

- [config/env/local-first-hybrid.profile.env](config/env/local-first-hybrid.profile.env)

운영 자율 진화 프로필:

- [config/env/production.profile.env](config/env/production.profile.env)

로컬 적용:

- `npm run env:profile:local-first-hybrid`

운영 적용:

- `npm run env:profile:production`

## 3) 보장되는 동작

로컬 머신이 켜져 있고 Ollama가 응답 가능하면:

- `AI_PROVIDER=ollama`
- `LLM_PROVIDER_BASE_ORDER=ollama,...`
- skill/intent/TOT 관련 추론이 로컬 모델을 우선 사용
- `operate.ops`, `openjarvis.ops`, `eval.*`, `worker.*` 는 `LLM_WORKFLOW_MODEL_BINDINGS` 와 `LLM_WORKFLOW_PROFILE_DEFAULTS` 를 통해 OpenJarvis 상위 orchestration lane으로 고정할 수 있다.

로컬 Ollama가 중단되거나 사용할 수 없으면:

- `LLM_PROVIDER_FALLBACK_CHAIN`의 원격 provider로 폴백
- 세션은 계속 진행 가능

운영 unattended loop는 항상:

- `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
- `ACTION_MCP_STRICT_ROUTING=true`
- `MCP_IMPLEMENT_WORKER_URL` 필수 (`local-first-hybrid` 기본값은 `http://127.0.0.1:8787`; legacy alias `MCP_OPENCODE_WORKER_URL` 지원)

## 4) 권장 provider 구성

최소 권장:

- `AI_PROVIDER=ollama`
- `OLLAMA_MODEL=qwen2.5:7b-instruct` 또는 로컬에 실제 설치된 모델
- `LLM_PROVIDER_BASE_ORDER=ollama,openclaw,anthropic,openai,gemini,huggingface`
- `LLM_PROVIDER_FALLBACK_CHAIN=openclaw,anthropic,openai,gemini,huggingface`
- `LLM_WORKFLOW_MODEL_BINDINGS=operate.ops=openjarvis:<model>;openjarvis.ops=openjarvis:<model>;eval.*=openjarvis:<model>;worker.*=openjarvis:<model>`
- `LLM_WORKFLOW_PROFILE_DEFAULTS=operate.ops=quality-optimized;openjarvis.ops=quality-optimized;eval.*=quality-optimized;worker.*=quality-optimized;action.code.*=cost-optimized`
- `MCP_IMPLEMENT_WORKER_URL=http://127.0.0.1:8787`

권장 이유:

- 로컬 응답이 가장 싸고 빠르다.
- OpenClaw/LiteLLM 또는 상용 provider를 fallback으로 두면 로컬 장애 시 복원력이 높다.
- OpenJarvis는 일반 채팅 기본 provider가 아니라 operations/eval/worker 계층으로 고정하는 편이 역할 분리가 명확하다.

## 5) 운영 가드레일

필수:

- `MCP_IMPLEMENT_WORKER_URL`
- `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
- `ACTION_MCP_STRICT_ROUTING=true`

권장:

- `OPENCLAW_BASE_URL` 또는 상용 provider key 중 최소 1개 이상
- `LLM_PROVIDER_MAX_ATTEMPTS=2`
- `LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=false`

## 6) 검증 절차

로컬 강화 검증:

1. `npm run env:profile:local-first-hybrid:dry`
2. `npm run env:check`
3. `npm run env:check:local-hybrid`
4. `npm run worker:opencode:local`
5. `npm run lint`
6. `npx vitest run src/services/llmClient.test.ts`

운영 자율 진화 검증:

1. `npm run env:profile:production:dry`
2. `npm run env:check`
3. `npm run openjarvis:autonomy:run:dry`
4. `npm run gates:validate:strict`

## 7) 실패 시 우선 조치

로컬 Ollama 장애:

- 로컬 모델 health 확인
- `OLLAMA_BASE_URL` 점검
- fallback provider가 실제로 설정되었는지 확인

원격 worker 장애:

- `MCP_IMPLEMENT_WORKER_URL` health 확인
- strict routing 상태에서 fail-open 우회 금지
- unattended rerun 전 workflow summary 확인

## 8) 문서 동기화 대상

같은 PR에서 아래 문서를 함께 갱신한다.

1. [docs/RUNBOOK_MUEL_PLATFORM.md](docs/RUNBOOK_MUEL_PLATFORM.md)
2. [docs/ARCHITECTURE_INDEX.md](docs/ARCHITECTURE_INDEX.md)
3. [docs/RENDER_AGENT_ENV_TEMPLATE.md](docs/RENDER_AGENT_ENV_TEMPLATE.md)
4. [docs/CHANGELOG-ARCH.md](docs/CHANGELOG-ARCH.md)
