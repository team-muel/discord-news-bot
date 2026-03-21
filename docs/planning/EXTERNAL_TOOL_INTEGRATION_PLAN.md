# External Tool Integration Plan

Status: Active — Phase 1 complete, Phase 2-4 partial, Phase 5.1 complete
Created: 2026-03-21
Last Updated: 2026-03-21

## Objective

내부 역할 라벨(nemoclaw, openjarvis 등)을 실제 외부 OSS 도구로 연결하는 Tool Layer 통합 계획.
목표는 로컬 IDE 환경에서 recursive/self-learning 자율 에이전트 파이프라인을 구축하는 것이다.

## External Tool Inventory

### NVIDIA OpenShell

| 항목 | 내용 |
| --- | --- |
| Repository | [NVIDIA/OpenShell](https://github.com/NVIDIA/OpenShell) ★2.8k |
| 설명 | AI 에이전트를 위한 안전한 샌드박스 런타임. 선언적 YAML 정책으로 파일시스템, 네트워크, 프로세스, 추론 경로를 제어 |
| 언어 | Rust 88.7%, Python 6.2% |
| 설치 | `curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \| sh` 또는 `uv tool install -U openshell` |
| 핵심 명령어 | `openshell sandbox create -- <agent>`, `openshell sandbox connect`, `openshell policy set`, `openshell inference set`, `openshell term` |
| 지원 에이전트 | Claude Code, OpenCode, Codex, Copilot CLI, OpenClaw, Ollama |
| GPU | 실험적 `--gpu` 플래그로 로컬 추론 지원 |
| 내부 매핑 | `nemoclaw.review` 역할의 실제 실행 환경이 될 수 있음 |
| 상태 | Alpha (v0.0.12), Apache-2.0 |

### NVIDIA NemoClaw

| 항목 | 내용 |
| --- | --- |
| Repository | [NVIDIA/NemoClaw](https://github.com/NVIDIA/NemoClaw) ★14.5k |
| 설명 | OpenShell 위에서 OpenClaw를 안전하게 실행하는 레퍼런스 스택. 관리형 추론 포함 |
| 언어 | JavaScript 47.3%, Shell 36.5%, TypeScript 10.5% |
| 설치 | `curl -fsSL https://www.nvidia.com/nemoclaw.sh \| bash` |
| 핵심 명령어 | `nemoclaw onboard`, `nemoclaw <name> connect`, `nemoclaw <name> status`, `nemoclaw <name> logs --follow` |
| 보호 계층 | Network (hot-reload), Filesystem (locked), Process (locked), Inference (hot-reload) |
| 기본 모델 | nvidia/nemotron-3-super-120b-a12b (NVIDIA Endpoint API) |
| 로컬 추론 | Ollama, vLLM (실험적) |
| 플랫폼 | Linux primary, Windows WSL (Docker Desktop), macOS (Colima/Docker Desktop) |
| 내부 매핑 | `nemoclaw` 내부 역할의 실제 upstream 도구 |
| 상태 | Alpha preview (2026-03-16 출시), Apache-2.0 |

### OpenClaw

| 항목 | 내용 |
| --- | --- |
| Website | [openclaw.ai](https://openclaw.ai/) |
| Repository | [openclaw/openclaw](https://github.com/openclaw/openclaw) |
| 설명 | 24/7 always-on 개인 AI 비서. 자체 스킬 작성, 지속적 메모리, 브라우저 제어 |
| 설치 (Windows) | `powershell -c "irm https://openclaw.ai/install.ps1 \| iex"` |
| 채팅 통합 | Discord, WhatsApp, Telegram, Slack, Signal, iMessage |
| 핵심 기능 | Persistent memory, Skills/Plugins, Browser control, Shell access, Cron jobs |
| Obsidian 통합 | 공식 통합 목록에 포함 |
| 자기 개선 | 에이전트가 자체 스킬을 작성하고 hot-reload 가능 |
| 내부 매핑 | LiteLLM 프록시 `openclaw` provider의 upstream |
| 로컬 모델 | MiniMax, Ollama 등으로 완전 로컬 실행 가능 |

### NVIDIA Nemotron

| 항목 | 내용 |
| --- | --- |
| 모델 | nvidia/nemotron-3-super-120b-a12b |
| 접근 | [build.nvidia.com](https://build.nvidia.com/) API 키 |
| 용도 | NemoClaw 기본 추론 모델 |
| LiteLLM 통합 | `nvidia_nim/nemotron-3-super-120b-a12b` 모델명으로 등록 가능 |
| 내부 매핑 | `muel-nemotron` 모델 alias로 litellm.config.yaml에 추가 |

### OpenJarvis (Stanford)

| 항목 | 내용 |
| --- | --- |
| Repository | [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) ★1.6k |
| 설명 | Stanford Scaling Intelligence Lab의 로컬 우선 개인 AI 프레임워크. 5개 composable primitive: Intelligence, Engine, Agents, Tools & Memory, Learning |
| 연구 배경 | [Intelligence Per Watt](https://www.intelligence-per-watt.ai/) — Stanford Hazy Research + Scaling Intelligence Lab (Christopher Ré, John Hennessy, Azalia Mirhoseini) |
| 언어 | Python 77.8%, Rust 14.3%, TypeScript 7.5% |
| 설치 | `git clone https://github.com/open-jarvis/OpenJarvis.git && cd OpenJarvis && uv sync` 또는 `pip install openjarvis` |
| 핵심 명령어 | `jarvis init` (하드웨어 자동 감지), `jarvis doctor` (설정 검증), `jarvis ask`, `jarvis chat`, `jarvis serve` (OpenAI-호환 FastAPI), `jarvis bench`, `jarvis optimize` |
| 엔진 지원 | Ollama, vLLM, SGLang, llama.cpp, MLX, Exo, LiteLLM, cloud (OpenAI/Anthropic/Google/MiniMax) 등 10+ |
| 에이전트 유형 | Simple, React, Orchestrator, Operative, Monitor, OpenHands, Claude Code, RLM 등 7+ |
| 고유 기능 | 에너지/비용/FLOPs 텔레메트리, 로컬 trace 기반 self-learning (SFT, GRPO, DSPy, GEPA), cron 스케줄러, 30+ 벤치마크, MCP/A2A 지원 |
| 채널 통합 | Discord, Telegram, Slack, WhatsApp, iMessage, Teams, Email, Signal 등 26+ 채널 |
| 내부 매핑 | `openjarvis.ops` 내부 역할의 실제 upstream 프레임워크 |
| 상태 | desktop-v0.0.1-rc1, Apache-2.0 |

## Architecture Mapping

기존 4-layer 설계(`LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`)에 실제 도구를 매핑:

### Layer 1: Discovery

| 도구 | 발견 방식 | 확인 명령 |
| --- | --- | --- |
| OpenShell | `where openshell` / `openshell sandbox list` | `openshell --version` |
| NemoClaw | `where nemoclaw` / `nemoclaw <name> status` | `nemoclaw --version` (또는 npm global check) |
| OpenClaw | `where openclaw` / 프로세스 확인 | `openclaw --version` |
| OpenJarvis | `where jarvis` / `jarvis doctor` | `jarvis --version` 또는 `uv run jarvis doctor` |
| Ollama | 기존 구현 (`OLLAMA_BASE_URL` health probe) | `curl http://localhost:11434/api/tags` |
| Nemotron | NVIDIA API 키 유효성 확인 | LiteLLM 프록시를 통한 모델 호출 테스트 |

### Layer 2: Adapter Registry

| 도구 | Adapter 유형 | Capability |
| --- | --- | --- |
| OpenShell | CLI adapter (openshell) | sandbox.create, sandbox.connect, sandbox.list, policy.set, inference.set |
| NemoClaw | CLI adapter (nemoclaw) | agent.onboard, agent.connect, agent.status, agent.logs |
| OpenClaw | CLI adapter (openclaw) | agent.chat, agent.skill.create, agent.skill.list |
| OpenJarvis | CLI adapter (jarvis) + HTTP adapter (jarvis serve) | jarvis.ask, jarvis.chat, jarvis.serve, jarvis.optimize, jarvis.bench |
| Ollama | HTTP adapter (기존) | model.list, model.pull, chat.completions |
| Nemotron | LiteLLM HTTP adapter | chat.completions (nvidia_nim endpoint) |

### Layer 3: Execution Transport

| 도구 | Transport | 실행 방식 |
| --- | --- | --- |
| OpenShell | execFile (CLI) | `openshell sandbox create -- ollama`, `openshell policy set` |
| NemoClaw | execFile (CLI) | `nemoclaw <name> connect`, sandbox 내부에서 `openclaw agent` |
| OpenClaw | execFile (CLI) / HTTP | 직접 CLI 또는 NemoClaw sandbox 내부 실행 |
| OpenJarvis | execFile (CLI) / HTTP (FastAPI) | `jarvis serve` → OpenAI-호환 API 또는 직접 CLI 호출 |
| Ollama | HTTP | 기존 `src/services/llmClient.ts` 경로 |
| Nemotron | HTTP (via LiteLLM) | litellm.config.yaml `muel-nemotron` 모델 |

### Layer 4: Action Exposure

| 기존 내부 액션 | 실제 도구 매핑 | 설명 |
| --- | --- | --- |
| `nemoclaw.review` | OpenShell sandbox + OpenClaw agent | sandbox 환경에서 코드 리뷰 에이전트 실행 |
| `opencode.execute` | OpenShell sandbox + coding agent | sandbox 환경에서 코드 실행 에이전트 |
| `openjarvis.ops` | OpenJarvis Operative + Scheduler | OpenJarvis cron 스케줄러 + Operative 에이전트로 ops 자동화. self-learning loop 포함 |
| `opendev.plan` | OpenClaw + Nemotron inference | 대규모 모델로 아키텍처 계획 생성 |
| `tools.run.cli` | OpenShell/NemoClaw CLI wrapper | 기존 단일 CLI tool slice 확장 |

## Integration Phases

### Phase 1: Inference Layer ✅ COMPLETE

1. ✅ litellm.config.yaml에 Nemotron 모델 추가 (`muel-nemotron`)
2. ✅ local-first-hybrid 프로필에 nemotron 경로 추가
3. ✅ LiteLLM 1.82.5 proxy 가동 (port 4000, 6 models)
4. ✅ llmClient.ts에 `litellm` + `openjarvis` provider 추가 (총 8 providers)
5. ✅ LLM_API_TIMEOUT_LARGE_MS (90s) 추가 — Nemotron급 대형 모델 호출 지원
6. ✅ Nemotron E2E 검증: "The capital of South Korea is Seoul."

### Phase 2: OpenShell Runtime — COMPLETE

1. ✅ OpenShell v0.0.12 설치 (WSL Ubuntu-24.04, `/root/.local/bin/openshell`)
2. ✅ OpenShell adapter 구현 (`src/services/tools/adapters/openshellCliAdapter.ts`) — WSL routing
3. ✅ health probe 연결 (`probeWslCommand('openshell', ['--version'])`) — 프로브 통과
4. ✅ tool registry에 OpenShell capabilities 등록
5. ✅ Ollama sandbox 생성: `openshell sandbox create --from ollama --name muel-ollama`
   - Docker Desktop WSL Engine 29.2.1 확인, K3s gateway push 성공
   - sandbox Phase: Ready

### Phase 3: NemoClaw Stack — PARTIAL (sandbox Ready, 리뷰 라우팅 구현 완료, 네트워크 정책 미완)

1. ✅ NemoClaw 설치 (WSL Ubuntu-24.04, `/root/.nvm/versions/node/v22.22.1/bin/nemoclaw`)
2. ✅ `nemoclaw onboard` — sandbox `muel-assistant` 생성 완료 (Phase: Ready, UUID: b32802a8)
   - Docker 이미지 빌드 (33단계, tag `896c474187fe`) + K3s gateway push 성공
   - Port forwarding: 18789, Policies: filesystem + network 적용
3. ✅ NemoClaw adapter 구현 (`src/services/tools/adapters/nemoclawCliAdapter.ts`) — WSL routing + NVM sourcing
4. ✅ `code.review` capability 추가 + `nemoclaw.review` 액션에서 external adapter 경로 연결
   - SSH 경로 (`ssh openshell-muel-assistant`) 로 비대화형 sandbox 명령 실행 확인
   - MCP delegation → external adapter → static analysis → LLM synthesis 폴백 체인
5. ⬜ 네트워크 정책 YAML 커스터마이징 (현재 기본 정책 적용)

### Phase 4: OpenJarvis + OpenClaw Agent — PARTIAL (Jarvis scheduler 활성화, Claw blocked)

1. ✅ OpenJarvis v0.1.0 설치 (`C:\Muel_S\OpenJarvis`, uv sync --extra server)
2. ✅ `jarvis init` + `jarvis serve` — port 8000, OpenAI-호환 API 가동
3. ✅ `src/services/llmClient.ts` provider 연결 — `requestOpenJarvis()` E2E 검증
4. ✅ OpenJarvis adapter 구현 (`src/services/tools/adapters/openjarvisAdapter.ts`) — HTTP + CLI dual
5. ✅ OpenJarvis Scheduler 설정 — 주간 벤치마크 (월 03:00) + 일일 헬스체크 (매일 09:00)
   - task `37c0c5f501244e3b`: weekly inference benchmark
   - task `8ad57aba80cb42b2`: daily health check
6. ⬜ OpenJarvis Learning loop 활성화 — `jarvis optimize run` 자동 개선 (trace 데이터 축적 필요)
7. ✅ OpenClaw npm CLI 설치 (v2026.3.13 globally)
8. ✅ OpenClaw Python 패키지 임포트 수정 (`cmdop.exceptions.TimeoutError` alias 패치)
9. ⬜ OpenClaw agent.chat — cmdop gRPC 서버 미가동으로 실행 불가
   - **Blocker**: OpenClaw desktop app 또는 로컬 cmdop 서버 설치 필요
10. ⬜ Discord/Obsidian 통합 설정
11. ✅ `openjarvis.ops` 액션에서 external adapter `jarvis.ask` 경로 연결 (MCP → adapter → LLM 폴백 체인)

### Phase 5: Recursive Self-Learning Loop

1. ✅ Gate run 결과 → OpenJarvis trace store에 피드백 (`jarvis.trace` capability + auto-judge-go-no-go.mjs trace feed hook)
2. `jarvis optimize` — trace 기반 자동 개선 (모델 가중치, 프롬프트, 에이전트 로직, 추론 엔진 4-layer 최적화)
3. OpenJarvis Learning: SFT/GRPO/DPO (모델), DSPy (프롬프트), GEPA (에이전트)
4. NemoClaw sandbox에서 제안된 변경사항 안전하게 테스트
5. OpenClaw가 보조적으로 자체 스킬 생성/검증
6. 승인된 변경만 실제 배포 경로로 전달
7. `jarvis bench` 주간 에너지/비용/레이턴시 벤치마크 → 품질 메트릭 개선 루프 트리거

## Environment Variables (추가 예정)

```env
# NVIDIA OpenShell
OPENSHELL_ENABLED=true
OPENSHELL_BIN_PATH=openshell

# NVIDIA NemoClaw
NEMOCLAW_ENABLED=true
NEMOCLAW_BIN_PATH=nemoclaw
NEMOCLAW_SANDBOX_NAME=muel-assistant
NVIDIA_API_KEY=<secret>

# OpenClaw
OPENCLAW_LOCAL_ENABLED=true
OPENCLAW_BIN_PATH=openclaw

# OpenJarvis (Stanford)
OPENJARVIS_ENABLED=true
OPENJARVIS_BIN_PATH=jarvis
OPENJARVIS_SERVE_URL=http://127.0.0.1:8000

# NVIDIA Nemotron (via LiteLLM)
NVIDIA_NIM_API_KEY=<secret>
```

## Prerequisite Checklist

| 항목 | Windows 경로 | WSL 경로 |
| --- | --- | --- |
| Docker Desktop | 설치 + WSL backend 활성화 | Docker 자동 연결 |
| Node.js 20+ | nvm-windows | nvm |
| Ollama | `winget install Ollama.Ollama` | `curl -fsSL https://ollama.ai/install.sh \| sh` |
| OpenShell | N/A (WSL 필요) | `curl -LsSf .../install.sh \| sh` |
| NemoClaw | N/A (WSL 필요) | `curl -fsSL https://www.nvidia.com/nemoclaw.sh \| bash` |
| OpenClaw | `irm https://openclaw.ai/install.ps1 \| iex` | `curl -fsSL https://openclaw.ai/install.sh \| sh` |
| OpenJarvis | `git clone ... && uv sync` (Python 3.10+, uv) | 동일 |
| NVIDIA API Key | build.nvidia.com에서 발급 | 동일 |

## Risk and Rollback

| 위험 | 심각도 | 완화 |
| --- | --- | --- |
| OpenShell/NemoClaw Alpha 불안정 | 중 | 각 도구를 선택적 adapter로 구현. 실패 시 기존 내부 역할/Ollama로 폴백 |
| WSL 환경 의존 | 중 | Windows native 경로(OpenClaw)와 WSL 경로(OpenShell/NemoClaw) 분리 |
| NVIDIA API 키 비용 | 저 | 로컬 Ollama/vLLM 우선, Nemotron Endpoint를 폴백으로 사용 |
| Sandbox 네트워크 정책 충돌 | 중 | 최소 권한 정책 + 필요 시 운영자 승인 |

## Related Documents

- [LOCAL_TOOL_ADAPTER_ARCHITECTURE.md](LOCAL_TOOL_ADAPTER_ARCHITECTURE.md) — 4-layer 어댑터 설계
- [LOCAL_FIRST_HYBRID_AUTONOMY.md](LOCAL_FIRST_HYBRID_AUTONOMY.md) — 로컬 우선 런타임 프로필
- [docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md](../RUNTIME_NAME_AND_SURFACE_MATRIX.md) — 이름 충돌 해석 정본
