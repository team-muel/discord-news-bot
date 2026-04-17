# GCP Remote Inference Node

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

목표:

- 로컬 PC가 꺼져 있어도 선택적으로 Ollama 또는 vLLM 기반 원격 추론 노드를 붙일 수 있게 한다.
- `opencode` 실행 worker와 추론 노드를 분리해 장애 반경과 자원 경쟁을 줄인다.
- 현재 GCP worker VM이 worker-only 용도라는 점을 운영 문서에 고정한다.

## 1) 현재 상태 판단

현재 worker VM은 `e2-medium`, 메모리 4GiB, CPU 1-2 vCPU 수준이다. (2026-04-10 baseline)

- 이 사양은 role worker + full jarvis serve + remote-mcp 상주에는 충분하다.
- Ollama 7B 계열이나 vLLM 추론 서버를 같은 VM에 항상-온 경로와 함께 동시 배치하기에는 여전히 부족하다.
- 따라서 원격 추론은 별도 VM 또는 별도 managed endpoint로 분리한다.

## 2) 권장 분리 원칙

1. worker VM과 inference VM은 분리한다.
2. worker VM은 low-cost, low-change, fail-closed 실행 노드로 유지한다.
3. inference VM은 모델, GPU, 디스크 캐시 요구사항에 맞춰 독립 스케일링한다.
4. Render 본 서비스는 inference endpoint 장애 시 fallback provider를 가질 수 있게 한다.

## 3) 최소 사양 가이드

CPU-only smoke test:

- `e2-standard-4`
- RAM 16GiB 이상
- pd-ssd 80GiB 이상
- 모델: `mistral:latest` 또는 동급 7B 1개

실사용 권장:

- GPU 노드 1대
- RAM 16~32GiB 이상
- 로컬 SSD 또는 pd-ssd 100GiB 이상
- Ollama 또는 vLLM 중 1개만 표준 경로로 선택

## 4) Ollama 분리 배치 예시

예시 순서:

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable ollama
sudo systemctl start ollama
ollama pull mistral:latest
curl http://127.0.0.1:11434/api/tags
```

reverse proxy 권장:

```caddy
llm.<your-domain> {
  reverse_proxy 127.0.0.1:11434
}
```

## 5) 앱 연결 방식

원격 Ollama를 canonical lane의 remote/local engine 경계 안에서 쓰려면 다음 env를 사용한다.

- `AI_PROVIDER=openjarvis`
- `OPENJARVIS_ENABLED=true`
- `OPENJARVIS_SERVE_URL=https://jarvis.<your-domain>`
- `OPENJARVIS_MODEL=mistral:latest`
- `OLLAMA_BASE_URL=https://llm.<your-domain>`
- `OLLAMA_MODEL=mistral:latest`
- `LLM_PROVIDER_BASE_ORDER=`
- `LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=true`
- `LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER=`

중요:

- 이 구성은 OpenJarvis control surface는 유지한 채 remote Ollama를 engine으로 대체한다. 로컬 PC 전원이 켜져 있을 때만 host-local Ollama를 우선 사용하려면 기존 `local-first-hybrid` 프로필을 유지한다.
- 운영 기본값을 remote Ollama로 바꾸는 경우에는 별도 production profile을 만들고 `openjarvis:autonomy:run:dry`를 다시 통과시켜야 한다.

## 6) 검증 절차

```bash
curl https://llm.<your-domain>/api/tags
npm run env:check
npm run env:check:local-hybrid
npm run openjarvis:autonomy:run:dry
```

검증 기준:

- inference endpoint health 응답 정상
- fallback provider가 최소 1개 이상 유지
- unattended autonomy dry-run pass

## 7) 권장 운영 정책

- worker URL과 inference URL은 서로 다른 도메인으로 분리한다.
- worker는 write 금지 기본값을 유지한다.
- inference 노드는 모델 캐시 용량과 재부팅 시간을 runbook에 별도 기록한다.
- 비용/지연이 맞지 않으면 inference는 remote provider(`openclaw`, `anthropic`, `openai`) fallback 체인으로 남긴다.
