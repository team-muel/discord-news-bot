# Operator SOP Decision Table

목표: Runbook를 실제 운영 UX로 바로 실행 가능하게 만들기 위해, "누가/언제/어떤 임계치에서/어떤 조치"를 표준화한다.

> Role naming: `docs/ROLE_RENAME_MAP.md` | Runtime surface truth: `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

## 1) 역할 정의 (Who)

- L1 On-Call: 탐지, 1차 완화, 상태 업데이트, 증적 수집
- L2 Service Owner: 런타임 설정 변경, 기능 토글, 릴리즈 롤백/재배포 결정
- L2 Data Owner: Supabase 스키마/데이터 무결성 복구 결정
- Incident Commander: SEV-1/SEV-2 총괄, 의사결정 승인, 종료 선언

## 2) 자동 의사결정 입력 신호 (When)

- Health: `/health`, `/ready`, `/api/bot/status`
- Runtime control-plane: `/api/bot/agent/runtime/scheduler-policy`, `/api/bot/agent/runtime/loops`, `/api/bot/agent/runtime/unattended-health`
- 비용: `/api/bot/agent/finops/budget?guildId=...`
- 품질: `/api/bot/agent/memory/quality?guildId=...&days=...`
- 출시 게이트: `/api/bot/agent/memory/beta/go-no-go?guildId=...&days=...`

권장 평가 주기:

- 실시간 감시: 5분
- 운영 브리핑: 30분
- 일일 점검: 1일 1회

## 3) Incident 자동 의사결정표

| 신호          | 임계치                                      | 자동 판정  | 담당               | 자동 조치                                    | 수동 조치(SOP)                           | SLA          |
| ------------- | ------------------------------------------- | ---------- | ------------------ | -------------------------------------------- | ---------------------------------------- | ------------ |
| API 상태      | `/health` 연속 3회 실패(5분 내)             | SEV-1 후보 | L1 On-Call         | Incident 생성, Comms 시작, 15분 cadence 전환 | L2 호출, 최근 배포/환경변수/키 변경 비교 | 5분 내 착수  |
| Ready 상태    | `/ready` 연속 3회 실패(5분 내)              | SEV-2      | L1 On-Call         | 자동화 잡 일시 중지 권고 플래그              | bot-only/api-only/data-only 범위 분리    | 10분 내      |
| Discord Bot   | `/api/bot/status`에서 bot offline 10분 지속 | SEV-2      | L1 On-Call         | Bot runtime 재기동 절차 시작                 | 토큰/권한/게이트웨이 상태 검증           | 10분 내      |
| 인증 경로     | `/api/auth/me` 실패율 >= 20% (10분 윈도우)  | SEV-1      | Incident Commander | 사용자 영향 공지 템플릿 전환                 | OAuth 설정/쿠키/CSRF/CORS 드리프트 점검  | 15분 내 완화 |
| 데이터 무결성 | 핵심 테이블 쓰기 실패가 5분 이상 지속       | SEV-1      | L2 Data Owner      | 쓰기 경로 보호 모드(읽기 중심) 전환          | 스키마 재적용, 키/권한 복구              | 15분 내      |

Runtime control-plane 보조 규칙:

- `scheduler-policy`가 기대 소유 구조와 다르면 SEV-2 후보로 분류하고, L2 Service Owner가 15분 내에 `service-init`/`discord-ready`/`database` 소유 경계와 env 토글을 재검증한다.
- `unattended-health` 실패 또는 readiness 경고가 10분 이상 지속되면 SEV-2 후보로 분류하고, unattended 변경을 동결한 뒤 opencode publish worker, approval store fallback, 외부 큐 의존성을 점검한다.

Runtime loop 인벤토리(현재 코드 기준, `scheduler-policy` ID):

- `service-init`: `memory-job-runner`, `opencode-publish-worker`, `trading-engine`, `runtime-alerts`
- `discord-ready`: `automation-modules`, `agent-daily-learning`, `got-cutover-autopilot`, `login-session-cleanup`(app-owned), `obsidian-sync-loop`, `retrieval-eval-loop`, `agent-slo-alert-loop`
- `database`: `supabase-maintenance-cron`, `login-session-cleanup`(db-owned)

## 4) FinOps 자동 의사결정표

**외부 어댑터(External Adapter) 장애 의사결정 보조 규칙:**

| 신호 | 임계치 | 자동 판정 | 담당 | 자동 조치 | 수동 조치(SOP) | SLA |
| --- | --- | --- | --- | --- | --- | --- |
| Primary adapter circuit breaker trip | 5분 내 3회 연속 실패 (window-based) | SEV-3 | L1 On-Call | CB half-open → probe 재시도; primary 결과를 local action fallback으로 대체 | 어댑터 endpoint/token 유효성 점검, GCP VM 상태 확인 | 30분 내 |
| OpenClaw Gateway 비정상 | `/api/health` 3회 연속 실패 또는 bootstrapOpenClawSession 시간 초과 | SEV-2 | L2 Service Owner | implement phase에서 OpenClaw bootstrap skip, local action fallback 사용 | GCP VM Docker 컨테이너 재시작 (`docker restart openclaw-gateway`), 포트 18789 방화벽/네트워크 점검, `OPENCLAW_GATEWAY_TOKEN` 유효성 재확인 | 15분 내 |
| Secondary adapter 실패 | secondary adapter 출력 누락 (primary 성공, secondary 실패) | SEV-3 (품질 저하) | L1 On-Call | primary 결과만으로 phase 진행 (append-only 안전); `PhaseResult.adapterMeta.secondary` 미기록 | secondary adapter의 enable flag 및 endpoint 재확인, 로그에서 실패 원인 식별 | 1시간 내 |
| 다수 어댑터 동시 장애 | 3개 이상 어댑터 CB trip 동시 발생 | SEV-2 | L2 Service Owner | sprint pipeline을 local-only fallback 모드로 강제 전환 | 네트워크/DNS 공통 원인 점검, GCP VM 전체 상태 확인, Render→GCP 연결 검증 | 15분 내 |
| Enrichment 실패 | enrichment MCP tool call 실패율 > 50% (10분 윈도우) | SEV-3 | L1 On-Call | enrichment는 best-effort이므로 자동 skip | enrichment 대상 어댑터 상태 일괄 점검 | 30분 내 |

어댑터별 검증 경로:

- OpenClaw: `http://<OPENCLAW_GATEWAY_URL>/api/health`
- OpenJarvis: `<OPENJARVIS_SERVE_URL>/health`
- NemoClaw: `nemoclaw <name> status` (WSL/Docker)
- OpenShell: `openshell sandbox list` (WSL)
- DeepWiki: adapter probe via `DEEPWIKI_ADAPTER_ENABLED` flag
- n8n: `http://<N8N_BASE_URL>/api/v1/workflows` (health check)

## 4-1) FinOps 자동 의사결정표

| 신호            | 임계치                                                                    | 자동 판정   | 담당               | 자동 조치                                 | 수동 조치(SOP)                               | 리뷰 주기 |
| --------------- | ------------------------------------------------------------------------- | ----------- | ------------------ | ----------------------------------------- | -------------------------------------------- | --------- |
| utilization     | `< FINOPS_DEGRADE_THRESHOLD_PCT`                                          | normal      | L1 On-Call         | 없음                                      | 주간 Top action 비용 점검                    | 주 1회    |
| utilization     | `>= FINOPS_DEGRADE_THRESHOLD_PCT` and `< FINOPS_HARD_BLOCK_THRESHOLD_PCT` | degraded    | L2 Service Owner   | 비허용 액션 자동 skip, retry/timeout 축소 | 허용 액션 목록 재조정, 임시 단가/예산 재설정 | 24시간 내 |
| utilization     | `>= FINOPS_HARD_BLOCK_THRESHOLD_PCT`                                      | blocked     | Incident Commander | 기본 액션 차단, exempt만 허용             | 원인 액션 중지, budget/threshold 조정 승인   | 4시간 내  |
| hard block 지속 | blocked 24시간 초과                                                       | 운영 리스크 | Incident Commander | No-Go 후보 플래그                         | 기능 축소 릴리즈 또는 워크로드 분리 결정     | 당일      |

## 5) Memory 품질 자동 의사결정표

| 신호                       | 임계치   | 자동 판정         | 담당             | 자동 조치                               | 수동 조치(SOP)                                          |
| -------------------------- | -------- | ----------------- | ---------------- | --------------------------------------- | ------------------------------------------------------- |
| citation_rate              | `< 0.95` | 품질 저하         | L2 Service Owner | 고위험 답변 경로에서 citation 강화 모드 | 프롬프트/체인 재검토, 샘플 20건 수기 검증               |
| recall@5(proxy)            | `< 0.60` | 회수율 저하       | L2 Data Owner    | retrieval 우선 경로 강제                | 임베딩/검색 파라미터, source ingest 점검                |
| unresolved_conflict_rate   | `> 0.05` | 충돌 누적         | L2 Data Owner    | conflict 처리 우선 큐 플래그            | `/api/bot/agent/memory/conflicts/:id/resolve` 운영 처리 |
| correction_sla_p95_minutes | `> 5`    | 수정 지연         | L1 On-Call       | backlog 경고 플래그                     | correction 인력 재배치, 큐 정리                         |
| job_failure_rate           | `> 0.10` | 파이프라인 불안정 | L2 Service Owner | 실패 잡 재시도 정책 강화                | runner/lock/timeout 파라미터 재튜닝                     |

## 6) Go/No-Go 자동 의사결정표

| 신호                 | 임계치 | 자동 판정 | 담당               | 자동 조치             | 수동 조치                      |
| -------------------- | ------ | --------- | ------------------ | --------------------- | ------------------------------ |
| all core gates pass  | true   | Go        | Incident Commander | 배포 승인 상태로 마킹 | 제한적 점진 배포 시작          |
| any core gate fail   | true   | No-Go     | Incident Commander | 배포 차단 상태로 마킹 | 실패 게이트별 보완 작업 생성   |
| deadletter queue > 0 | true   | No-Go     | L2 Service Owner   | 배포 차단 유지        | deadletter 원인 제거 후 재평가 |

## 7) 실행 순서 (Operator UX)

1. 먼저 신호 4종(Health/FinOps/Quality/Go-No-Go)을 조회한다.
2. runtime control-plane 3종(`scheduler-policy`, `loops`, `unattended-health`)으로 실제 루프 소유/실행 상태를 확인한다.
3. 표의 임계치와 비교해 자동 판정을 확정한다.
4. 자동 조치를 즉시 실행한다.
5. 담당자별 수동 SOP를 SLA 내 완료한다.
6. `ONCALL_INCIDENT_TEMPLATE`와 `ONCALL_COMMS_PLAYBOOK`에 증적을 남긴다.

Runtime triage rule:

- `service-init` 루프 이상은 서버 프로세스 또는 env/profile 변경을 우선 의심한다.
- `discord-ready` 루프 이상은 Discord ready, OAuth, gateway, bot token 상태를 먼저 분리한다.
- `database` 소유 이상은 Supabase cron 설치 여부와 DB 자격 증명을 먼저 확인한다.
- `login-session-cleanup` 이상은 먼저 owner(`app|db`)를 확인한 뒤 app loop 문제인지 DB cron 문제인지 분기한다.

## 8) 운영 규칙

- 임계치 충돌 시 우선순위: SEV-1 > FinOps blocked > 품질 저하 > 운영 편의.
- 사용자가 체감하는 오류가 있으면 비용 절감보다 가용성/정확성을 우선한다.
- blocked 해제는 Incident Commander 승인 없이 수행하지 않는다.

## 9) 버전 정책

- 표 수정 주기: 월 1회 또는 SEV-1 이후 24시간 이내
- 변경 시 동시 업데이트 문서:
  - `docs/RUNBOOK_MUEL_PLATFORM.md`
  - `docs/planning/FINOPS_PLAYBOOK.md`
  - `docs/ONCALL_INCIDENT_TEMPLATE.md` (필요 시)
