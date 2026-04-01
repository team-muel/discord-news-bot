# GCP Opencode Worker VM Deploy

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

목표:

- GCP VM에 `opencode.execute` 전용 HTTP worker를 상주시킨다.
- 현재 local-first hybrid 구조의 `MCP_OPENCODE_WORKER_URL`을 GCP VM URL로 교체할 수 있게 한다.
- 운영 unattended autonomy가 로컬 PC 전원 상태와 분리되도록 한다.

현재 배포 상태:

- worker VM: `instance-20260319-223412` (`us-central1-c`)
- reserved static IP: `34.56.232.61`
- temporary TLS endpoint: `https://34.56.232.61.sslip.io`
- reverse proxy: Caddy -> `127.0.0.1:8787`

## 1) 배포 대상

- 실행 파일: [scripts/opencode-local-worker.mjs](scripts/opencode-local-worker.mjs)
- 컨테이너 이미지: [Dockerfile.opencode-worker](Dockerfile.opencode-worker)
- 예시 env: [config/env/opencode-worker.gcp.env.example](config/env/opencode-worker.gcp.env.example)
- systemd 예시: [config/systemd/opencode-local-worker.service.example](config/systemd/opencode-local-worker.service.example)

## 2) 권장 VM 최소 사양

- worker-only: e2-small 이상
- remote inference 동시 탑재: 별도 VM 권장, 현재 e2-micro 인스턴스와 분리
- Ubuntu 22.04 LTS
- 고정 외부 IP 권장
- 방화벽: 8787/tcp 허용 또는 reverse proxy 뒤에 배치

## 3) 가장 단순한 배포 방식

1. VM에 Node 22 설치
2. 저장소 클론
3. env 파일 복사
4. systemd로 worker 상시 실행

## 4) 서버 준비

예시:

```bash
sudo apt-get update
sudo apt-get install -y curl git ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo useradd -r -m -d /opt/muel -s /usr/sbin/nologin muel || true
sudo mkdir -p /opt/muel
sudo chown -R muel:muel /opt/muel
```

## 5) 앱 배치

예시:

```bash
cd /opt/muel
sudo -u muel git clone <your-repo-url> muel-platform
cd /opt/muel/muel-platform
sudo -u muel npm ci --omit=dev --no-audit --no-fund
sudo -u muel cp config/env/opencode-worker.gcp.env.example config/env/opencode-worker.gcp.env
```

필수 수정:

- `OPENCODE_LOCAL_WORKER_ROOT=/opt/muel/muel-platform`
- `OPENCODE_LOCAL_WORKER_ALLOW_WRITE=false` 유지 권장
- `OPENCODE_LOCAL_WORKER_AUTH_TOKEN=<long-random-token>` 설정 권장
- `OPENCODE_LOCAL_WORKER_REQUIRE_AUTH=true` 운영 권장

## 6) systemd 등록

예시:

```bash
sudo cp config/systemd/opencode-local-worker.service.example /etc/systemd/system/opencode-local-worker.service
sudo systemctl daemon-reload
sudo systemctl enable opencode-local-worker
sudo systemctl start opencode-local-worker
sudo systemctl status opencode-local-worker
```

로그 확인:

```bash
sudo journalctl -u opencode-local-worker -n 100 --no-pager
```

## 7) 헬스체크

예시:

```bash
curl http://127.0.0.1:8787/health
curl https://<vm-external-ip>.sslip.io/health
```

정상 응답 기준:

- `ok: true`
- `service: opencode-local-worker`

## 8) 현재 앱과 연결

현재 로컬 `.env`에서 아래 값을 교체한다.

- `MCP_OPENCODE_WORKER_URL=https://<gcp-vm-external-ip>.sslip.io`

Render 배포 정의도 동일하게 맞춘다.

- `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
- `ACTION_MCP_STRICT_ROUTING=true`
- `MCP_OPENCODE_WORKER_URL=https://34.56.232.61.sslip.io`
- `MCP_OPENCODE_TOOL_NAME=opencode.run`
- `MCP_OPENCODE_WORKER_AUTH_TOKEN=<same-token-as-worker>`

그리고 검증:

```bash
npm run env:check
npm run env:check:local-hybrid
npm run openjarvis:autonomy:run:dry
```

## 9) 보안 권장사항

- 8787 포트는 외부에 직접 공개하지 말고 localhost 바인딩 + reverse proxy만 사용한다.
- Caddy 또는 Nginx reverse proxy 뒤에 두고 TLS를 적용한다.
- `OPENCODE_LOCAL_WORKER_ALLOW_WRITE=false`를 기본값으로 유지한다.
- `OPENCODE_LOCAL_WORKER_REQUIRE_AUTH=true`와 worker/client 공용 토큰을 설정한다.
- 운영형에서는 worker를 전용 repo/workspace에만 연결한다.

## 10) 정식 도메인 전환

임시 `sslip.io` 대신 정식 도메인을 붙일 때 절차는 아래와 같다.

1. DNS 제공자에서 `worker.<your-domain>` A 레코드를 `34.56.232.61`로 지정한다.
2. VM의 `/etc/caddy/Caddyfile`를 아래처럼 교체한다.

```caddy
worker.<your-domain> {
  reverse_proxy 127.0.0.1:8787
}
```

1. `sudo systemctl reload caddy`를 실행한다.
2. `curl https://worker.<your-domain>/health`로 TLS/health를 확인한다.
3. `.env`, Render env, 관련 runbook의 `MCP_OPENCODE_WORKER_URL`을 새 도메인으로 교체한다.

## 11) Render 동기화 체크리스트

Render service가 원격 worker를 반드시 사용하게 하려면 아래 env가 배포 정의 또는 Render 대시보드에 있어야 한다.

- `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true`
- `ACTION_MCP_STRICT_ROUTING=true`
- `MCP_OPENCODE_WORKER_URL=https://34.56.232.61.sslip.io`
- `MCP_OPENCODE_TOOL_NAME=opencode.run`
- `MCP_OPENCODE_WORKER_AUTH_TOKEN=<same-token-as-worker>`

운영 반영 후 확인:

- Render deploy logs에서 env 반영 확인
- `GET /ready`
- `GET /api/bot/agent/runtime/unattended-health`
- `GET /api/bot/agent/runtime/unattended-health` 응답의 `workerHealth.reachable=true` 확인
- `npm run openjarvis:autonomy:run:dry`

## 12) 다음 단계

1. GCP VM worker 안정화
2. `sslip.io`를 정식 도메인으로 전환
3. local-first hybrid readiness 재검증
4. 필요 시 Ollama 또는 vLLM 원격 추론 노드를 별도 VM로 분리

## 13) 비용/헬스 자동 점검 명령

운영에서 권장하는 최소 자동 점검 명령:

- budget 알림 설정 드라이런: `npm run ops:gcp:budget:setup`
- budget 알림 실제 생성: `npm run ops:gcp:budget:setup:apply`
- 주간 리포트 생성: `npm run ops:gcp:report:weekly`
- 월간 리포트 생성: `npm run ops:gcp:report:monthly`

budget 생성이 `ADC quota project` 또는 `SERVICE_DISABLED`로 실패할 때 1회 선행 작업:

1. `gcloud auth application-default login`
2. `gcloud auth application-default set-quota-project gen-lang-client-0405212361`
3. `gcloud services enable billingbudgets.googleapis.com --project gen-lang-client-0405212361`
4. `npm run ops:gcp:budget:setup:apply`

산출물:

- `docs/planning/gate-runs/WEEKLY_GCP_WORKER_COST_HEALTH.md`
- `docs/planning/gate-runs/MONTHLY_GCP_WORKER_COST_HEALTH.md`

## 14) 로컬 추론 즉시 활성화 조건

로컬 추론 강화는 아래 조건이 충족되면 컴퓨터를 켜는 즉시 적용된다.

1. `.env`가 local-first-hybrid 기준으로 적용되어 있을 것
2. 로컬 Ollama가 실행 중일 것
3. `OLLAMA_MODEL`에 지정된 모델이 로컬에 pull 되어 있을 것
4. 실제 서비스 프로세스(`npm run dev:server` 또는 `npm run start`)가 실행 중일 것

검증 명령:

- `npm run env:check:local-hybrid`
- `curl http://127.0.0.1:11434/api/tags`
