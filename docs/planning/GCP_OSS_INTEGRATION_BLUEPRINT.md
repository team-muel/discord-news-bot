# GCP OSS Integration Blueprint

Status: **ACTIVE**
Created: 2026-03-27
Owner: Architect

Canonical runtime facts for the current deployment live in `config/runtime/operating-baseline.json`.

## Problem Statement

GCP VM(e2-medium, 4GB RAM)의 role worker와 OSS 통합 경계가 문서마다 다르게 적혀 있어 운영 truth가 흐려진 상태.
OpenJarvis는 GCP 운영면에서 사용 가능하지만, NemoClaw/OpenShell/OpenClaw는 여전히 lite mode 또는 별도 노드 전제가 강하다.

## Constraints

| 제약 | 세부 |
| --- | --- |
| **GCP e2-medium** | 1-2 vCPU, 4GB RAM. 4 role worker + jarvis serve + MCP 서비스 공존 가능 |
| **Docker / sandbox** | 설치 가능 여부는 별도 검증이 필요하며, 항상-온 운영 경로와 같은 VM에 묶는 것은 비권장 |
| **로컬 추론** | 소형 Ollama 실험은 가능하지만, 운영 필수 경로로 두면 메모리/복원력 리스크가 커짐 |
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
│  GCP VM (e2-medium, 4GB)                                     │
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

**UPDATE:** Stanford OpenJarvis is NOT published on PyPI (`openjarvis` package).
Installation requires `git clone + uv sync` and 운영 기준으로는 e2-medium(4GB)에서 CLI/serve 공존이 가능하다.
다만 항상-온 운영의 기준은 "로컬 추론이 떠 있다"가 아니라, 원격 worker + LiteLLM + remote-mcp 경로가 독립적으로 건강한지 여부다.

```bash
# LITE MODE (fallback):
# Set OPENJARVIS_ENABLED=true + LITELLM_BASE_URL in worker env
# Adapter provides jarvis.ask via LiteLLM proxy automatically

# FULL INSTALL (current, e2-medium/4GB):
git clone https://github.com/open-jarvis/OpenJarvis.git /opt/openjarvis
cd /opt/openjarvis && pip install --break-system-packages -e .
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
  resourceProfile: "medium"
}
```

### Phase 4: Future Scaling

e2-medium 기준에서 더 분리하고 싶을 때의 확장 경로:

| VM 크기 | 추가 가능한 OSS | 효과 |
| --- | --- | --- |
| **e2-medium** (4GB) | OpenJarvis serve + 제한적 Ollama 실험 | 단일 노드 운영은 가능하지만, 항상-온 경로와 실험 경로 분리 권장 |
| **e2-standard-2** (8GB) | + OpenShell + NemoClaw sandbox | 완전한 sandbox 코드 리뷰/실행 |
| **n1-standard-4** (15GB) | + Ollama (qwen2.5:7b) + vLLM | 대형 모델 로컬 추론, 완전 자율 |

## OSS Feature Utilization Matrix

각 OSS가 제공하는 기능 vs 현재/목표 활용도:

### OpenJarvis (Stanford)

| Feature | GCP 현재 | GCP 목표 (Phase 2) | 로컬 현재 |
| --- | --- | --- | --- |
| `jarvis ask` (one-shot Q&A) | ✅ via serve/CLI + LiteLLM | 유지 | ✅ via serve |
| `jarvis serve` (FastAPI API) | ✅ | 유지 | ✅ :8000 |
| `jarvis trace` (telemetry) | ✅ via CLI | 유지 | ✅ via serve |
| `jarvis bench` (benchmark) | ✅ via CLI | 유지 | ✅ via serve |
| `jarvis optimize` (self-learning) | ✅ via CLI | 유지 | ❌ (trace 부족) |
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
| 단일 e2-medium VM에 역할 과밀 탑재 | 중간 | 높음 | sandbox/로컬 추론은 별도 노드로 분리, always-on 경로는 worker+proxy 중심 유지 |
| LiteLLM proxy 지연 → 타임아웃 | 낮음 | 중간 | 30s timeout, graceful fallback to LLM-only |
| lite mode 코드 리뷰 품질 저하 | 중간 | 낮음 | cross-model voice (Nemotron) 보완 |
| jarvis CLI 버전 호환성 | 낮음 | 낮음 | 고정 버전 설치, healthcheck |

## Decision Record

- **왜 OpenJarvis를 GCP의 기본 운영 OSS로 두는가?**: e2-medium에서도 가장 가볍게 운영/평가/학습 loop를 담당할 수 있고 LiteLLM과 결합이 쉽다. NemoClaw/OpenShell은 sandbox 격리 가치가 크므로 별도 노드에 두는 편이 낫다.
- **왜 lite mode인가?**: OSS CLI 없이도 LiteLLM proxy를 통해 핵심 기능(코드 리뷰, Q&A)을 제공. 완전한 기능은 로컬 개발환경에서만 가능.
- **왜 local inference와 always-on 운영을 구분하는가?**: GCP e2-medium에서 소형 로컬 추론은 가능하지만, 그것이 항상-온 운영 보장을 의미하지는 않는다. 운영 truth는 원격 worker, LiteLLM, remote-mcp의 독립 건강성이다.

## Related Documents

- `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md` — canonical runtime surface
- `docs/planning/EXTERNAL_TOOL_INTEGRATION_PLAN.md` — original OSS integration plan (CLOSED)
- `docs/ARCHITECTURE_INDEX.md` — repository architecture index
- `config/env/*.gcp.env.example` — GCP worker environment templates
