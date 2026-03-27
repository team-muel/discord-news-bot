# GCP OSS Integration Blueprint

Status: **ACTIVE**
Created: 2026-03-27
Owner: Architect

## Problem Statement

GCP VM(e2-micro, 1GB RAM)의 4개 role worker가 동명 OSS의 기능을 실제로 활용하지 못하는 "이름만 빌린" 상태.
External adapter(openjarvisAdapter, nemoclawCliAdapter 등)는 로컬 WSL에서만 작동하며, GCP 프로덕션에는 OSS 도구가 설치되지 않았다.

## Constraints

| 제약 | 세부 |
| --- | --- |
| **GCP e2-micro** | 1 vCPU, 1GB RAM. 4 Node.js worker + systemd 이미 400-600MB 사용 |
| **Docker 설치 불가** | RAM 부족으로 K3s/Docker 런타임 구동 불가 → sandbox 생성 불가 |
| **로컬 추론 불가** | Ollama(4GB+), vLLM(8GB+) 등 모델 서빙 불가 |
| **네트워크 가용** | LiteLLM proxy(Render), NVIDIA API, Cloud API 접근 가능 |
| **디스크** | SSD 30GB, Python/Node.js 설치 공간 가용 |

## Target Architecture

```
               ┌─────────────────────────────────────────┐
               │  Render (muel-service)                   │
               │  ┌────────────────────────────────────┐  │
               │  │ sprintOrchestrator                 │  │
               │  │   │                                │  │
               │  │   ├─ plan    → MCP :8791           │  │
               │  │   ├─ impl   → MCP :8787           │  │
               │  │   ├─ review → MCP :8792           │  │
               │  │   ├─ ops    → MCP :8793           │  │
               │  │   └─ qa/ship → fastPath (local)   │  │
               │  └────────────────────────────────────┘  │
               │  ┌────────────────────────────────────┐  │
               │  │ muel-litellm-proxy                 │  │
               │  │   6 models + fallback chain        │  │
               │  └────────────────────────────────────┘  │
               └──────────────┬───────────────────────────┘
                              │ HTTP
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  GCP VM (e2-micro, 1GB)                                      │
│                                                              │
│  ┌──────────────── Role Workers ──────────────────────────┐  │
│  │                                                        │  │
│  │  opencode (:8787)     opendev (:8791)                 │  │
│  │  ├ registry actions   ├ registry actions               │  │
│  │  └ implement.execute  └ architect.plan                 │  │
│  │                                                        │  │
│  │  nemoclaw (:8792)     openjarvis (:8793)              │  │
│  │  ├ registry actions   ├ registry actions               │  │
│  │  ├ code.review        ├ jarvis.ask ◄── OpenJarvis CLI │  │
│  │  │ (inference-only    ├ jarvis.trace                   │  │
│  │  │  via LiteLLM)      ├ jarvis.bench                  │  │
│  │  └ ▲ lite mode        └ jarvis.optimize                │  │
│  │                         ▲                              │  │
│  └─────────────────────────┼──────────────────────────────┘  │
│                            │                                  │
│  ┌──── OSS Installations ─┼──────────────────────────────┐  │
│  │                         │                              │  │
│  │  OpenJarvis CLI      ───┘                              │  │
│  │  (pip install openjarvis)                              │  │
│  │  engine: litellm → muel-litellm-proxy                  │  │
│  │  model: muel-balanced (gemini-2.5-flash)               │  │
│  │                                                        │  │
│  │  NemoClaw CLI: NOT INSTALLED (no Docker)               │  │
│  │  OpenShell CLI: NOT INSTALLED (no Docker)              │  │
│  │  OpenClaw CLI: NOT INSTALLED (gRPC blocked)            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──── Inference Routing ────────────────────────────────┐  │
│  │                                                        │  │
│  │  ALL inference → LiteLLM Proxy (Render)                │  │
│  │  ┌──────────────────────────────────────────────┐     │  │
│  │  │ jarvis.ask → jarvis serve (if running)       │     │  │
│  │  │           → jarvis CLI (litellm engine)      │     │  │
│  │  │           → LiteLLM proxy (direct HTTP)      │     │  │
│  │  │                                              │     │  │
│  │  │ code.review → LiteLLM proxy (direct HTTP)   │     │  │
│  │  │             → sandbox NOT available          │     │  │
│  │  └──────────────────────────────────────────────┘     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Adapter Lite Mode (code changes)

GCP에서 OSS CLI 없이도 추론 기능을 제공하는 "lite mode" 도입.

| 어댑터 | 변경 | 효과 |
| --- | --- | --- |
| `nemoclawCliAdapter` | `isAvailable()` — CLI 없어도 `LITELLM_BASE_URL` 있으면 true 반환. `code.review` 전용 lite mode | GCP review worker가 LiteLLM 경유 코드 리뷰 가능 |
| `openjarvisAdapter` | `jarvis.ask` — CLI 없을 때 LiteLLM proxy HTTP fallback 추가 | GCP operate worker가 jarvis.ask 실행 가능 (CLI 없이) |
| `agent-role-worker` | `/tools/discover` 엔드포인트 추가 — 사용 가능한 OSS 도구/capability 보고 | Render가 각 워커의 실제 역량을 파악 가능 |

### Phase 2: OpenJarvis on GCP (infra)

e2-micro에서 유일하게 설치 가능한 OSS = OpenJarvis CLI (Python, ~60MB).

```bash
# Install steps
pip install openjarvis
jarvis init --engine litellm
# Configure ~/.openjarvis/config.toml:
#   engine = "litellm"
#   litellm_base_url = "https://muel-litellm-proxy.onrender.com"
#   default_model = "muel-balanced"
```

효과:
- `operate` worker가 `jarvis ask`, `jarvis trace`, `jarvis bench`, `jarvis optimize` 실행 가능
- 추론은 모두 LiteLLM proxy 경유 (GCP에서 모델 로드 없음)
- Sprint retro → jarvis trace → optimize 피드백 루프 활성화

### Phase 3: Worker Tool Discovery (observability)

```
GET /tools/discover → {
  role: "review",
  osTools: {
    nemoclaw: { available: false, mode: "lite", capabilities: ["code.review"] },
    litellm: { available: true, url: "https://muel-litellm-proxy.onrender.com" }
  },
  resourceProfile: "micro"
}
```

### Phase 4: Future Scaling (not for e2-micro)

e2-micro를 벗어날 때의 확장 경로:

| VM 크기 | 추가 가능한 OSS | 효과 |
| --- | --- | --- |
| **e2-small** (2GB) | OpenJarvis serve (FastAPI) | HTTP API 직접 제공, trace 실시간 피드백 |
| **e2-medium** (4GB) | + Ollama (qwen2.5:0.5b) | 로컬 추론으로 레이턴시 절감, 비용 0 |
| **e2-standard-2** (8GB) | + OpenShell + NemoClaw sandbox | 완전한 sandbox 코드 리뷰/실행 |
| **n1-standard-4** (15GB) | + Ollama (qwen2.5:7b) + vLLM | 대형 모델 로컬 추론, 완전 자율 |

## OSS Feature Utilization Matrix

각 OSS가 제공하는 기능 vs 현재/목표 활용도:

### OpenJarvis (Stanford)

| Feature | GCP 현재 | GCP 목표 (Phase 2) | 로컬 현재 |
| --- | --- | --- | --- |
| `jarvis ask` (one-shot Q&A) | ❌ | ✅ via CLI + LiteLLM | ✅ via serve |
| `jarvis serve` (FastAPI API) | ❌ | ❌ (RAM 부족) | ✅ :8000 |
| `jarvis trace` (telemetry) | ❌ | ✅ via CLI | ✅ via serve |
| `jarvis bench` (benchmark) | ❌ | ✅ via CLI | ✅ via serve |
| `jarvis optimize` (self-learning) | ❌ | ✅ via CLI | ❌ (trace 부족) |
| Scheduler (cron tasks) | ❌ | ❌ (systemd 대체) | ✅ |
| MCP/A2A support | ❌ | Phase 4 | ❌ |
| Energy/cost telemetry | ❌ | ✅ (bench 포함) | ✅ |

### NemoClaw (NVIDIA)

| Feature | GCP 현재 | GCP 목표 (Phase 1) | 로컬 현재 |
| --- | --- | --- | --- |
| `code.review` (AI review) | ❌ | ✅ lite mode (LiteLLM) | ✅ sandbox + Ollama |
| Sandbox creation | ❌ | ❌ (no Docker) | ✅ muel-assistant |
| Network/FS policy | ❌ | ❌ | ✅ |
| Inference management | ❌ | via LiteLLM proxy | ✅ sandbox Ollama |

### OpenShell (NVIDIA)

| Feature | GCP 현재 | GCP 목표 | 로컬 현재 |
| --- | --- | --- | --- |
| Sandbox runtime | ❌ | ❌ (no Docker) | ✅ muel-ollama |
| Policy enforcement | ❌ | ❌ | ✅ |
| GPU inference | ❌ | ❌ | ❌ (no GPU) |

### Nemotron (NVIDIA)

| Feature | GCP 현재 | GCP 목표 | 로컬 현재 |
| --- | --- | --- | --- |
| 120B inference | ✅ via LiteLLM | ✅ | ✅ via LiteLLM |
| Cross-model review | ✅ | ✅ | ✅ |

## Risk Assessment

| 리스크 | 확률 | 영향 | 완화 |
| --- | --- | --- | --- |
| OpenJarvis 설치로 OOM | 중간 | 높음 | CLI-only 설치 (serve 미실행), 메모리 모니터링 |
| LiteLLM proxy 지연 → 타임아웃 | 낮음 | 중간 | 30s timeout, graceful fallback to LLM-only |
| lite mode 코드 리뷰 품질 저하 | 중간 | 낮음 | cross-model voice (Nemotron) 보완 |
| jarvis CLI 버전 호환성 | 낮음 | 낮음 | 고정 버전 설치, healthcheck |

## Decision Record

- **왜 OpenJarvis만 GCP에 설치하는가?**: Python CLI-only 모드가 ~60MB로 e2-micro에서 유일하게 실행 가능. NemoClaw/OpenShell은 Docker 필수.
- **왜 lite mode인가?**: OSS CLI 없이도 LiteLLM proxy를 통해 핵심 기능(코드 리뷰, Q&A)을 제공. 완전한 기능은 로컬 개발환경에서만 가능.
- **왜 inference를 GCP에서 하지 않는가?**: 1GB RAM으로는 0.5B 모델도 로드 불가. 모든 추론은 클라우드 API 경유.

## Related Documents

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` — canonical runtime surface
- `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md` — original OSS integration plan (CLOSED)
- `docs/ARCHITECTURE_INDEX.md` — repository architecture index
- `config/env/*.gcp.env.example` — GCP worker environment templates
