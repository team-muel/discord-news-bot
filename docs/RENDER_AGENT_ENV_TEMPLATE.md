# Render Agent Env Template

Use this as a baseline for deploying Muel as a server-operations runtime.

Boundary note:

- role-related env vars in this file configure repository-local runtime actions and advisory workers
- they do not automatically discover or wrap arbitrary local external OSS CLIs or servers
- broader local tool adapter design is documented separately in `docs/planning/LOCAL_TOOL_ADAPTER_ARCHITECTURE.md`
- name collision interpretation and current runtime availability are tracked in `docs/RUNTIME_NAME_AND_SURFACE_MATRIX.md`

Current first slice note:

- the repository now includes a first local CLI tool slice exposed as `tools.run.cli`
- this slice is intentionally narrow: one explicitly configured CLI tool, no PATH auto-discovery, no dynamic registration
- in the current four-role model, direct local tool execution is treated as an OpenJarvis-owned runtime surface and can be invoked directly or through Local Orchestrator

## Runtime Artifact VCS Policy

- Runtime artifacts are operational outputs and are not tracked in VCS by default.
- Incident evidence or test fixture commits are allowed only with minimal scope.
- Exception commits include purpose, time window, and retention or removal plan in the same change set.

## Required

- ERROR_LOG_DB_ENABLED=true
- ERROR_LOG_TABLE=system_error_events
- LLM_API_TIMEOUT_MS=15000

## LLM Provider (Harness)

- AI_PROVIDER=openai|gemini|anthropic|huggingface|openclaw|ollama
- OPENAI_API_KEY=[secret] (if openai)
- GEMINI_API_KEY=[secret] (if gemini)
- ANTHROPIC_API_KEY=[secret] (if anthropic)
- HF_TOKEN=<secret> (if huggingface; primary key)
- HF_API_KEY=<secret> (huggingface alias)
- HUGGINGFACE_API_KEY=<secret> (huggingface alias)
- HUGGINGFACE_CHAT_COMPLETIONS_URL=`https://router.huggingface.co/v1/chat/completions` (optional)
- HUGGINGFACE_MODEL=[model-id] (optional)
- OPENCLAW_BASE_URL=[url] (if openclaw)
- OPENCLAW_API_KEY=[secret] (optional)
- OLLAMA_MODEL=[model] (if ollama)
- OLLAMA_BASE_URL=`http://127.0.0.1:11434` (optional)
- OPENAI_ANALYSIS_MODEL / GEMINI_MODEL / ANTHROPIC_MODEL (optional)

Provider fallback controls:

- LLM_PROVIDER_BASE_ORDER=openai,anthropic,gemini,huggingface,openclaw,ollama (optional, base provider selection order when AI_PROVIDER is unset)
- LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=false (optional)
- LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER=openclaw,openai,anthropic,gemini,huggingface,ollama (optional)
- LLM_PROVIDER_MAX_ATTEMPTS=2 (optional, 1~6)
- LLM_PROVIDER_FALLBACK_CHAIN=openclaw,openai,anthropic,gemini,huggingface,ollama (optional)
- LLM_PROVIDER_POLICY_ACTIONS=rag.retrieve=openclaw,openai;code.generate=openclaw,anthropic (optional)

## Agent Runtime Controls

- OBSIDIAN_FILE_LOCK_STALE_MS=60000 (optional, stale lock auto-recovery)
- OBSIDIAN_FILE_LOCK_RETRY_MS=120 (optional, lock retry interval)
- MEMORY_POISON_BLOCK_THRESHOLD=0.85 (optional, block suspicious memory ingestion)
- MEMORY_POISON_REVIEW_THRESHOLD=0.55 (optional, downgrade confidence + tag for review)
- MEMORY_RETRIEVE_MIN_CONFIDENCE=0.35 (optional, retrieval floor for non-pinned memory)
- MEMORY_HINT_MIN_CONFIDENCE=0.35 (optional, LLM hint floor for non-pinned memory)
- MEMORY_HYBRID_SEARCH_ENABLED=false (optional, pg_trgm 기반 memory hybrid search RPC 사용)
- MEMORY_HYBRID_MIN_SIMILARITY=0.08 (optional, 0~1)
- OBSIDIAN_SANITIZER_ENABLED=true (optional)
- OBSIDIAN_SANITIZER_MAX_TEXT_LEN=12000 (optional)
- OBSIDIAN_SANITIZER_MIN_TEXT_LEN=20 (optional)
- OBSIDIAN_SANITIZER_MAX_LINKS=8 (optional)
- ACTION_RUNNER_ENABLED=true (optional)
- ACTION_RETRY_MAX=2 (optional)
- ACTION_TIMEOUT_MS=15000 (optional)
- ACTION_POLICY_DEFAULT_ENABLED=true (optional, no policy row fallback)
- ACTION_POLICY_DEFAULT_RUN_MODE=approval_required (optional: auto|approval_required|disabled)
- ACTION_POLICY_FAIL_OPEN_ON_ERROR=false (optional, keep false for fail-closed)
- ACTION_ALLOWED_ACTIONS=rag.retrieve,web.search,web.fetch,db.supabase.read,code.generate,opencode.execute,tools.run.cli (optional, 운영에서는 \* 대신 명시 allowlist 권장)
- ACTION_MCP_DELEGATION_ENABLED=true (optional)
- ACTION_MCP_STRICT_ROUTING=false (optional, true면 워커 오류 시 로컬 fallback 금지)
- ACTION_MCP_TIMEOUT_MS=8000 (optional)
- MCP_OPENCODE_WORKER_URL= (optional, opencode worker base url)
- MCP_OPENCODE_TOOL_NAME=opencode.run (optional)
- MCP_OPENDEV_WORKER_URL= (optional, OpenDev worker base url)
- MCP_NEMOCLAW_WORKER_URL= (optional, NemoClaw worker base url)
- MCP_OPENJARVIS_WORKER_URL= (optional, OpenJarvis worker base url)
- MCP_LOCAL_ORCHESTRATOR_WORKER_URL= (optional, local-orchestrator worker base url)
- LOCAL_CLI_TOOL_ENABLED=false (optional, true면 단일 명시적 CLI tool slice 활성화)
- LOCAL_CLI_TOOL_NAME=local.cli (optional, catalog/action에서 보일 tool name)
- LOCAL_CLI_TOOL_DESCRIPTION=Configured local CLI tool (optional)
- LOCAL_CLI_TOOL_COMMAND= (optional, 활성화 시 필수; execFile 대상 command)
- LOCAL_CLI_TOOL_ARGS_JSON=["{goal}"] (optional, JSON array; placeholder: {goal} {guildId} {requestedBy} {arg:key})
- LOCAL_CLI_TOOL_TIMEOUT_MS=15000 (optional)
- LOCAL_CLI_TOOL_MAX_OUTPUT_CHARS=2000 (optional)
- AGENT_ROLE_WORKER_REQUIRE_AUTH=true (optional, advisory role workers auth gate)
- AGENT_ROLE_WORKER_AUTH_TOKEN=[secret] (optional, advisory role workers shared token)
- OPENJARVIS_REQUIRE_OPENCODE_WORKER=false (optional, unattended/production에서는 true 권장)
- AGENT_CONVERSATION_THREAD_IDLE_MS=21600000 (optional, turn thread reuse idle window; default 6h)
- OPENCODE_PUBLISH_WORKER_ENABLED=false (optional, true면 queue 소비 + GitHub PR publish 루프 활성화)
- OPENCODE_PUBLISH_WORKER_INTERVAL_MS=5000 (optional)
- OPENCODE_PUBLISH_WORKER_BATCH_SIZE=2 (optional)
- OPENCODE_PUBLISH_MAX_ATTEMPTS=3 (optional)
- OPENCODE_PUBLISH_STALE_RUNNING_MS=900000 (optional)
- OPENCODE_PUBLISH_REQUIRE_EVIDENCE_FOR_HIGH_RISK=true (optional, high/critical 요청은 evidence_bundle_id 필수)
- OPENCODE_PUBLISH_MIN_SCORE_CARD_TOTAL=0 (optional, 0보다 크면 score_card 총점 임계치 적용)
- OPENCODE_PUBLISH_PATCH_MAX_FILES=120 (optional, diff_patch 파일 수 상한)
- OPENCODE_PUBLISH_PATCH_MAX_LINES=4000 (optional, diff_patch 총 라인 상한)
- OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED=true (optional, 멀티 인스턴스에서 단일 publish worker 리더 보장)
- OPENCODE_PUBLISH_DISTRIBUTED_LOCK_LEASE_MS=30000 (optional, distributed lock lease)
- OPENCODE_PUBLISH_DISTRIBUTED_LOCK_NAME=opencode.publish.worker (optional)
- OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN=false (optional, lock 획득 실패 시 fail-open 실행 허용 여부)
- OPENCODE_TARGET_REPO_OWNER=[owner] (optional, payload 미지정 시 기본값)
- OPENCODE_TARGET_REPO_NAME=[repo] (optional, payload 미지정 시 기본값)
- GITHUB_TOKEN=[secret] (optional, publish worker 사용 시 필수)
- PLANNER_SELF_CONSISTENCY_ENABLED=true (optional, planner 다중 샘플 합의 사용)
- PLANNER_SELF_CONSISTENCY_SAMPLES=3 (optional, 1~5 권장)
- PLANNER_SELF_CONSISTENCY_TEMPERATURE=0.35 (optional, 0~1)
- AGENT_PRIVACY_GUARDED_DEFAULT=true (optional, 개인정보 민감 운영에서 guarded 모드 기본 적용)
- AGENT_PRIVACY_REVIEW_SCORE=60 (optional, 이 점수 이상이면 fast/requested-skill 지름길을 건너뛰고 full review 경로로 실행)
- AGENT_PRIVACY_BLOCK_SCORE=80 (optional, 이 점수 이상이면 자동 실행 차단)
- AGENT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS=300000 (optional, policy cache refresh warn log throttle)
- AGENT_WORKFLOW_CACHE_ERROR_LOG_THROTTLE_MS=300000 (optional, workflow cache refresh warn log throttle)
- AGENT_SKILL_CATALOG_CACHE_ERROR_LOG_THROTTLE_MS=300000 (optional, skill catalog refresh warn log throttle)
- WORKER_APPROVAL_SAVE_ERROR_LOG_THROTTLE_MS=300000 (optional, approval store save warn log throttle)
- OBSIDIAN_HEADLESS_ENABLED=true (optional, 권장: read/search/graph headless 우선)
- OBSIDIAN_HEADLESS_COMMAND=ob (optional)
- OBSIDIAN_VAULT_NAME=[vault-name] (optional, headless 대상 vault 식별자)
- OBSIDIAN_HEADLESS_LORE_MAX_HINTS=6 (optional, headless lore 힌트 수)
- OBSIDIAN_HEADLESS_LORE_MAX_CHARS=220 (optional, 힌트 1개당 최대 문자)
- OBSIDIAN_ADAPTER_ORDER=headless-cli,script-cli,local-fs (optional)
- OBSIDIAN_ADAPTER_ORDER_READ_LORE=headless-cli,script-cli,local-fs (optional)
- OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=headless-cli,local-fs (optional)
- OBSIDIAN_ADAPTER_ORDER_READ_FILE=headless-cli,local-fs (optional)
- OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=headless-cli,local-fs (optional)
- OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=local-fs,script-cli (optional, write fallback 보장)
- OBSIDIAN_ADAPTER_STRICT=false (optional, true면 fallback 없이 1차 adapter 결과만 사용)
- ACTION_CACHE_ENABLED=true (optional)
- ACTION_CACHE_TTL_MS=600000 (optional, 10 minutes)
- ACTION_CACHE_MAX_ENTRIES=1000 (optional)
- ACTION_CACHEABLE_ACTIONS=rag.retrieve,news.google.search,community.search,web.fetch,web.search,youtube.search.first,stock.quote,stock.chart,db.supabase.read (optional)
- ACTION_RUNNER_TREND_WINDOW_RUNS=10 (optional, trend delta comparison window)
- ACTION_CIRCUIT_BREAKER_ENABLED=true (optional)
- ACTION_CIRCUIT_FAILURE_THRESHOLD=3 (optional)
- ACTION_CIRCUIT_OPEN_MS=60000 (optional)
- ACTION_YOUTUBE_USE_PLAYWRIGHT=false (optional)
- ACTION_YOUTUBE_PLAYWRIGHT_TIMEOUT_MS=8000 (optional)
- AGENT_MAX_QUEUE_SIZE=300 (optional)
- AGENT_SESSION_TIMEOUT_MS=180000 (optional)
- AGENT_STEP_TIMEOUT_MS=75000 (optional)
- AGENT_SESSION_MAX_ATTEMPTS=2 (optional)
- AGENT_DEADLETTER_MAX=300 (optional)
- AGENT_READINESS_FAIL_OPEN=false (optional, production에서는 true 금지)
- AGENT_READINESS_ALLOW_WARN=false (optional, warn 상태를 활성화 허용할지 여부)
- FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS=300000 (optional, FinOps budget lookup 실패 warn 로그 스로틀)
- MEMORY_JOBS_ENABLED=true (optional)
- MEMORY_JOBS_POLL_INTERVAL_MS=20000 (optional)
- MEMORY_JOBS_MAX_RETRIES=3 (optional)
- MEMORY_DEADLETTER_AUTO_RECOVERY_ENABLED=true (optional)
- MEMORY_DEADLETTER_RECOVERY_INTERVAL_MS=120000 (optional)
- MEMORY_DEADLETTER_RECOVERY_BATCH_SIZE=3 (optional)
- MEMORY_DEADLETTER_MAX_RECOVERY_ATTEMPTS=3 (optional)
- RETRIEVAL_AUTO_EVAL_ENABLED=false (optional, 자동 평가 루프)
- RETRIEVAL_AUTO_EVAL_INTERVAL_HOURS=24 (optional)
- RETRIEVAL_AUTO_EVAL_RUN_ON_START=false (optional)
- RETRIEVAL_AUTO_EVAL_APPLY_TUNING=false (optional)
- RETRIEVAL_AUTO_EVAL_MAX_GUILDS=30 (optional)
- RETRIEVAL_AUTO_EVAL_TOP_K=5 (optional)
- RETRIEVAL_AUTO_EVAL_SET_ID=<id|blank> (optional)
- AGENT_DAILY_LEARNING_ENABLED=true (optional)
- AGENT_DAILY_LEARNING_HOUR=4 (optional)
- AGENT_DAILY_MAX_GUILDS=30 (optional)
- FINAL_SELF_CONSISTENCY_ENABLED=true (optional, 최종 합성 단계 다중 샘플 합의)
- FINAL_SELF_CONSISTENCY_SAMPLES=3 (optional, 1~5 권장)
- LEAST_TO_MOST_ENABLED=true (optional, 목표 분해 + 하위목표 순차 실행)
- LEAST_TO_MOST_MAX_SUBGOALS=4 (optional, 2~8 권장)
- LEAST_TO_MOST_MIN_GOAL_LENGTH=40 (optional, 짧은 요청은 baseline 경로 사용)
- SELF_REFINE_LITE_ENABLED=true (optional, 초안->비평->재작성 경량 루프)
- SELF_REFINE_LITE_MAX_PASSES=1 (optional, 1~2 권장)
- SELF_REFINE_LITE_REQUIRE_ACTIONABLE=true (optional, 실행 가능한 비평 포인트가 없으면 재작성 스킵)
- SELF_REFINE_LITE_MIN_SCORE_GAIN=1 (optional, 재작성 수용 최소 ORM 점수 개선폭)
- ORM_RULE_PASS_THRESHOLD=75 (optional, 규칙형 ORM pass 임계치)
- ORM_RULE_REVIEW_THRESHOLD=55 (optional, 규칙형 ORM review 임계치)
- TOT_SHADOW_ENABLED=false (optional, Shadow ToT 탐색만 수행하고 최종 응답에는 미적용)
- TOT_SHADOW_STRATEGY=bfs (optional: bfs|dfs)
- TOT_SHADOW_MAX_BRANCHES=3 (optional, 2~6 권장)
- TOT_SHADOW_KEEP_TOP=1 (optional, 상위 보관 후보 수)
- TOT_SHADOW_BRANCH_ANGLES_JSON=["증거 보수성 관점","운영 안정성 관점","리스크 최소화 관점"] (optional, 분기 관점 외부화)
- TOT_SHADOW_BRANCH_ANGLES=증거 보수성 관점,운영 안정성 관점,리스크 최소화 관점 (optional, JSON 미사용 시 CSV 대안)
- TOT_ADAPTIVE_SAMPLING_ENABLED=true (optional, 분기별 동적 temperature/top-p 적용)
- TOT_SAMPLING_TEMP_MIN=0.12 (optional, 0~1)
- TOT_SAMPLING_TEMP_MAX=0.45 (optional, 0~1)
- TOT_SAMPLING_TOP_P_MIN=0.82 (optional, 0~1)
- TOT_SAMPLING_TOP_P_MAX=0.98 (optional, 0~1)
- TOT_LOCAL_SEARCH_ENABLED=true (optional, 후보 생성 후 local-search 변형 수행)
- TOT_LOCAL_SEARCH_MUTATIONS=1 (optional, 분기당 변형 횟수 0~3)
- TOT_REPLAY_ENABLED=true (optional, 과거 고보상 후보를 replay seed로 활용)
- TOT_REPLAY_TOP_K=2 (optional, replay seed 개수 0~5)
- TOT_ACTIVE_ENABLED=false (optional, ToT 후보를 실제 최종 응답 선택에 반영)
- TOT_ACTIVE_ALLOW_FAST=false (optional, fast 우선순위에도 ToT 반영 허용)
- TOT_ACTIVE_MIN_GOAL_LENGTH=60 (optional, 이 길이 이상 목표에서만 ToT 선택 게이트)
- TOT_ACTIVE_MIN_SCORE_GAIN=4 (optional, baseline 대비 최소 점수 개선폭)
- TOT_ACTIVE_MIN_BEAM_GAIN=0.03 (optional, Probability\*Correctness 기반 최소 개선폭)
- TOT_ACTIVE_REQUIRE_NON_PASS=false (optional, baseline이 pass면 ToT 승격 금지)
- TOT_SELF_EVAL_ENABLED=true (optional, Self-Evaluation Guided Beam Score 사용)
- TOT_SELF_EVAL_TEMPERATURE=0.1 (optional, 0~1)
- TOT_PROVIDER_LOGPROB_ENABLED=true (optional, 지원 provider에서 probability를 token logprob 기반으로 우선 추정)
- REACT_REFLECT_ON_ACTION_FAILURE_ENABLED=true (optional, action 실패 시 관측 기반 반성 응답 활성화)
- TOT_AUTO_TUNE_ENABLED=true (optional, 최근 7일 성능 기반 ToT 정책 자동 조정)
- TOT_AUTO_TUNE_INTERVAL_HOURS=24 (optional, 길드별 자동 조정 최소 간격)
- TOT_AUTO_TUNE_MIN_SAMPLES=40 (optional, 자동 조정 최소 표본 수)
- AGENT_TOT_POLICY_CACHE_TTL_MS=60000 (optional)
- AGENT_TOT_POLICY_CACHE_ERROR_LOG_THROTTLE_MS=300000 (optional)
- GOT_SHADOW_ENABLED=false (optional, GoT shadow 기록 활성화)
- GOT_ACTIVE_ENABLED=false (optional, GoT active 승격 경로 활성화)
- GOT_STRATEGY=got_v1 (optional)
- GOT_SHADOW_GUILD_ALLOWLIST=123456789012345678,987654321098765432 (optional, CSV)
- GOT_ACTIVE_GUILD_ALLOWLIST=123456789012345678 (optional, CSV)
- GOT_MAX_NODES_FAST=10 (optional, 2~200)
- GOT_MAX_NODES_BALANCED=24 (optional, 2~200)
- GOT_MAX_NODES_PRECISE=40 (optional, 2~200)
- GOT_MAX_EDGES_FAST=20 (optional, 1~800)
- GOT_MAX_EDGES_BALANCED=64 (optional, 1~800)
- GOT_MAX_EDGES_PRECISE=120 (optional, 1~800)
- GOT_MIN_SELECTED_SCORE=0.5 (optional, 0~1)
- AGENT_TELEMETRY_QUEUE_MAX_SIZE=1000 (optional, 기록 큐 최대 길이)
- AGENT_TELEMETRY_QUEUE_CONCURRENCY=2 (optional, 기록 큐 동시 처리 개수)
- AGENT_TELEMETRY_QUEUE_ERROR_LOG_THROTTLE_MS=60000 (optional, 오류 로그 쓰로틀)
- AGENT_TELEMETRY_QUEUE_SATURATION_MODE=drop (optional: drop|inline, 큐 포화 시 처리 전략)
- AGENT_TELEMETRY_DURABLE_QUEUE_ENABLED=true (optional, Supabase 기반 durable telemetry queue)
- AGENT_TELEMETRY_DURABLE_TABLE=agent_telemetry_queue_tasks (optional)
- AGENT_TELEMETRY_DURABLE_MAX_ATTEMPTS=5 (optional, durable 재시도 상한)
- AGENT_TELEMETRY_DURABLE_RETRY_BASE_MS=5000 (optional, 재시도 지수 백오프 시작값)
- AGENT_TELEMETRY_DURABLE_RETRY_MAX_MS=300000 (optional, 재시도 지수 백오프 상한)
- AGENT_TELEMETRY_DURABLE_RECOVERY_BATCH=200 (optional, 부팅 시 durable 큐 복구 개수)
- AGENT_TELEMETRY_DURABLE_STALE_RUNNING_MS=300000 (optional, running 상태 stale 복구 기준)
- API_IDEMPOTENCY_TABLE=api_idempotency_keys (optional)
- API_IDEMPOTENCY_TTL_SEC=86400 (optional, idempotency key TTL)
- API_IDEMPOTENCY_REQUIRE_HEADER=false (optional, true면 관리자 write API에 key 필수)
- AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL=0 (optional, readiness block 임계치)
- AGENT_READINESS_MAX_TELEMETRY_QUEUE_DROP_RATE=0.02 (optional, readiness block 임계치)
- GO_NO_GO_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL=0 (optional, go/no-go no-go 임계치)
- GO_NO_GO_MAX_TELEMETRY_QUEUE_DROP_RATE=0.02 (optional, go/no-go no-go 임계치)
- OBSIDIAN_RAG_CONTEXT_MODE=metadata_first (optional: metadata_first|full)
- OBSIDIAN_RAG_GUILD_SCOPE_MODE=prefer (optional: off|prefer|strict)
- SEMANTIC_ANSWER_CACHE_ENABLED=true (optional)
- SEMANTIC_ANSWER_CACHE_MIN_SIMILARITY=0.82 (optional, 0~1)
- SEMANTIC_ANSWER_CACHE_LOOKBACK_DAYS=14 (optional)
- SEMANTIC_ANSWER_CACHE_CANDIDATE_LIMIT=120 (optional)
- GOT_CUTOVER_MIN_RUNS=30 (optional, active 승격 권고 최소 GoT run 수)
- GOT_CUTOVER_MIN_SCORE_DELTA=0 (optional, got-vs-tot 평균 score delta 하한)
- GOT_CUTOVER_MIN_LATENCY_GAIN_MS=0 (optional, latency gain(ms) 하한)
- GOT_CUTOVER_MAX_HALLUCINATION_DELTA_PCT=0 (optional, hallucination delta% 상한)
- GOT_CUTOVER_DASHBOARD_WINDOW_DAYS=14 (optional, cutover 판단용 dashboard window)
- GOT_CUTOVER_CACHE_TTL_MS=60000 (optional, cutover decision 캐시 TTL)
- GOT_CUTOVER_FAIL_OPEN=false (optional, dashboard 오류 시 fail-open 여부)
- GOT_ACTIVE_ROLLOUT_PERCENT=100 (optional, cutover 통과 세션 중 실제 승격 비율)
- GOT_CUTOVER_MIN_LABELED_HALLUCINATION_SAMPLES=20 (optional, 라벨 기반 지표 사용 최소 표본)
- AGENT_GOT_CUTOVER_AUTOPILOT_ENABLED=true (optional, dashboard 권고를 cutover profile에 자동 반영)
- AGENT_GOT_CUTOVER_AUTOPILOT_INTERVAL_MIN=60 (optional, autopilot 실행 간격 분)
- AGENT_GOT_CUTOVER_AUTOPILOT_MAX_GUILDS=100 (optional, 1회 실행당 처리 길드 상한)
- AGENT_GOT_CUTOVER_AUTOPILOT_TARGET_ROLLOUT_PERCENT=100 (optional, readiness=true 길드 반영 rollout%)
- AGENT_GOT_CUTOVER_AUTOPILOT_MIN_REVIEW_SAMPLES=20 (optional, 자동 upsert 시 min_review_samples 값)
- LLM_CALL_LOG_ENABLED=true (optional, provider/model/latency/cost observability)
- LLM_CALL_LOG_TABLE=agent_llm_call_logs (optional)
- LLM_COST_INPUT_PER_1K_CHARS_USD=0.0005 (optional, rough estimation)
- LLM_COST_OUTPUT_PER_1K_CHARS_USD=0.0015 (optional, rough estimation)
- LLM_EXPERIMENT_ENABLED=false (optional, HF canary A/B)
- LLM_EXPERIMENT_NAME=hf_ab_v1 (optional)
- LLM_EXPERIMENT_HF_PERCENT=20 (optional, 0~100)
- LLM_EXPERIMENT_GUILD_ALLOWLIST=123456789012345678,987654321098765432 (optional, CSV)
- LLM_EXPERIMENT_FAIL_OPEN=true (optional, HF arm failure 시 base provider로 fallback)
- SUPABASE_MAINTENANCE_CRON_RETENTION_DAYS=30 (optional, cron maintenance 기본 retention)

## Remote Worker Baseline

운영형 Render baseline에서는 아래 값을 명시하는 편이 안전하다.

## Local CLI Tool Example

예시 목적:

- 로컬에 명시적으로 설치한 CLI 하나를 네 역할 체계 안에서 first-class action으로 노출

예시 값:

- `LOCAL_CLI_TOOL_ENABLED=true`
- `LOCAL_CLI_TOOL_NAME=ollama.tags`
- `LOCAL_CLI_TOOL_DESCRIPTION=Inspect locally available Ollama tags`
- `LOCAL_CLI_TOOL_COMMAND=ollama`
- `LOCAL_CLI_TOOL_ARGS_JSON=["list"]`

운영 확인 경로:

- `GET /api/bot/agent/tools/status`
- `GET /api/bot/agent/actions/catalog`
- `POST /api/bot/agent/actions/execute` with `actionName=tools.run.cli`

- OPENJARVIS_REQUIRE_OPENCODE_WORKER=true
- ACTION_MCP_STRICT_ROUTING=true
- MCP_OPENCODE_WORKER_URL=worker-url
- MCP_OPENCODE_TOOL_NAME=opencode.run

주의:

- 현재 임시 endpoint 예시는 [34.56.232.61.sslip.io](https://34.56.232.61.sslip.io) 이다.
- 장기 운영에서는 정식 도메인으로 교체하고 같은 값을 Render service env에도 반영한다.
- worker는 public `8787` 직접 노출 대신 `127.0.0.1:8787` + reverse proxy 구성을 유지한다.
- advisory role worker env가 설정되어 있어도 실제 callable 여부는 `GET /api/bot/agent/actions/catalog`와 `GET /api/bot/agent/runtime/role-workers`로 확인한다.

## Automation Defaults

- START_AUTOMATION_JOBS=true (optional)
- AUTOMATION_YOUTUBE_ENABLED=true (optional)
- AUTOMATION_NEWS_ENABLED=false (optional)
- DYNAMIC_WORKER_RESTORE_ON_BOOT=true (optional, default true: restart 시 승인된 동적 워커 자동 복원)
- DYNAMIC_WORKER_RUNTIME_DIR=.runtime/dynamic-workers (optional, 동적 워커 코드 아티팩트 저장 경로)
- WORKER_APPROVAL_STORE_MODE=auto (optional: auto|supabase|file)
- WORKER_APPROVAL_DB_TABLE=worker_approvals (optional)
- WORKER_APPROVAL_STORE_PATH=.runtime/worker-approvals.json (optional, file 모드/폴백 경로)
  - 런타임 산출물 경로이므로 일반 코드 커밋 대상에서 제외 권장
- VIBE_AUTO_WORKER_PROMOTION_ENABLED=true (optional, true면 자동 제안 전에 승격 임계치 평가)
- VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY=5 (optional, 최근 window 내 동일 목적 요청 최소 횟수 N)
- VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS=7 (optional, 승격 평가 기간)
- VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS=3 (optional, 최소 고유 요청자 수)
- VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE=0.65 (optional, 평균 outcome score 하한)
- VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE=0.10 (optional, 정책 차단률 상한)

## Web Search & Verification

- SERPER_API_KEY=[secret] (optional — Google 품질 검색; 없으면 DuckDuckGo HTML 폴백 자동 사용)
- WEB_SEARCH_MAX_RESULTS=5 (optional)
- NEWS_VERIFY_SOURCE_LIMIT=4 (optional)
- ACTION_NEWS_CAPTURE_ENABLED=true (optional)
- ACTION_NEWS_CAPTURE_TTL_MS=21600000 (optional, 6시간)
- ACTION_NEWS_CAPTURE_MIN_ITEMS=2 (optional)
- ACTION_NEWS_CAPTURE_MAX_ITEMS=5 (optional)
- ACTION_NEWS_CAPTURE_MAX_AGE_HOURS=72 (optional)
- ACTION_NEWS_CAPTURE_SOURCE=google_news_rss (optional)

## Trading Credentials

- BINANCE_API_KEY=[secret]
- BINANCE_API_SECRET=[secret]
- BINANCE_SECRET_KEY=[secret] (legacy alias, migrate to BINANCE_API_SECRET)

## Notes

- `AUTOMATION_NEWS_ENABLED=false` keeps non-essential news push opt-in.
- If multiple providers are configured, `AI_PROVIDER` selects priority.
- If no provider configuration exists, `/해줘` and `/시작` session creation fails by design.
- 비용 최소화가 목표라면 `AI_PROVIDER=ollama`와 소형 모델(예: qwen2.5:3b-instruct) 조합을 권장합니다.
- local-first hybrid가 목표라면 `AI_PROVIDER=ollama`, `LLM_PROVIDER_BASE_ORDER=ollama,openclaw,anthropic,openai,gemini,huggingface`, `OPENJARVIS_REQUIRE_OPENCODE_WORKER=true` 조합을 권장합니다.
- `DISCORD_SIMPLE_COMMANDS_ENABLED=true` keeps command surface minimal (`/구독`, `/로그인`, `/도움말`, `/설정`, `/ping`) and enables mention-first chat UX.
- `DISCORD_LOGIN_SESSION_TTL_MS` controls how long a non-admin login session stays active for subscription add/remove.
- `DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS` enables sliding expiration; sessions accessed near expiry are extended.
- `DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS` controls periodic cleanup of expired persisted sessions.
- Persistent login across bot restarts requires the `discord_login_sessions` table from `docs/SUPABASE_SCHEMA.sql`.
- If `OBSIDIAN_CLI_COMMAND` is set, the backend executes it at runtime to fetch memory hints and falls back to direct markdown reads only when CLI output is unavailable.
- 로컬 PC가 꺼져도 무인 운영하려면 read/search/graph는 `headless-cli` 우선, 쓰기는 Supabase(memory_items/guild_lore_docs) 경로를 기본으로 설계하세요.
- 현재 `headless-cli` adapter는 `read_lore/search_vault/read_file/graph_metadata` 중심이며, `write_note`는 local-fs/script-cli fallback 경로를 사용합니다.
- LiteLLM 프록시를 사용하려면 `AI_PROVIDER=openclaw` + `OPENCLAW_BASE_URL=[litellm-endpoint]` 조합으로 서버 측 provider 경로를 고정하세요.
- HF canary A/B를 운영하려면 `LLM_EXPERIMENT_ENABLED=true`, `LLM_EXPERIMENT_HF_PERCENT`, `LLM_EXPERIMENT_GUILD_ALLOWLIST`를 함께 설정하고 `/api/bot/agent/llm/experiments/summary`로 arm별 성공률/지연/비용을 확인하세요.
- 확장 유틸리티 점검: `/api/bot/agent/runtime/supabase/extensions`, `/api/bot/agent/runtime/supabase/cron-jobs`, `/api/bot/agent/runtime/supabase/hypopg/candidates`.
- Untrusted chat input is sanitized before passing to Obsidian CLI (control chars, traversal tokens, shell metacharacters removed) and guild-scoped markdown path resolution is constrained under `OBSIDIAN_VAULT_PATH`.
- Obsidian markdown access is serialized with local file locks to reduce concurrent read/delete collisions when multiple Discord commands run at the same time.
- Memory ingest/retrieval uses poison-guard heuristics (prompt-injection/ad-spam/link-heavy patterns) to block or down-rank contaminated context before it reaches RAG/LLM prompts.
- A lightweight rule-based sanitization worker runs before memory persistence (future Obsidian writes included) and blocks malformed/injection-like text early.

## Remote-Only Profile (No Local Dependency)

Use this profile when 운영 목표가 "로컬 의존 0"인 경우:

- AUTONOMY_STRICT=true
- OPENJARVIS_REQUIRE_OPENCODE_WORKER=true
- MCP_OPENCODE_WORKER_URL=[required]
- MCP_OPENCODE_TOOL_NAME=opencode.run
- ACTION_MCP_DELEGATION_ENABLED=true
- ACTION_MCP_STRICT_ROUTING=true
- ACTION_POLICY_FAIL_OPEN_ON_ERROR=false
- AGENT_READINESS_FAIL_OPEN=false
- OBSIDIAN_HEADLESS_ENABLED=true
- OBSIDIAN_HEADLESS_COMMAND=ob
- OBSIDIAN_ADAPTER_STRICT=true
- OBSIDIAN_ADAPTER_ORDER=headless-cli,script-cli
- OBSIDIAN_ADAPTER_ORDER_READ_LORE=headless-cli,script-cli
- OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=headless-cli
- OBSIDIAN_ADAPTER_ORDER_READ_FILE=headless-cli
- OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=headless-cli
- OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=script-cli

운영 규칙:

- 위 프로파일에서는 `local-fs`를 adapter order에서 제거한다.
- `MCP_OPENCODE_WORKER_URL` 누락 상태는 배포 불가 상태로 간주한다.

## Local-First Hybrid Profile (Local Reasoning + Remote Automation)

Use this profile when 로컬 머신이 켜져 있을 때는 Ollama를 우선 사용하되, 운영 unattended autonomy는 원격 worker로 유지하려는 경우:

- AI_PROVIDER=ollama
- OLLAMA_MODEL=[required]
- OLLAMA_BASE_URL=`http://127.0.0.1:11434`
- LLM_PROVIDER_BASE_ORDER=ollama,openclaw,anthropic,openai,gemini,huggingface
- LLM_PROVIDER_FALLBACK_CHAIN=openclaw,anthropic,openai,gemini,huggingface
- LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED=false
- OPENJARVIS_REQUIRE_OPENCODE_WORKER=true
- MCP_OPENCODE_WORKER_URL=`http://127.0.0.1:8787` (로컬 worker) 또는 실제 원격 worker URL
- MCP_OPENCODE_TOOL_NAME=opencode.run
- ACTION_MCP_DELEGATION_ENABLED=true
- ACTION_MCP_STRICT_ROUTING=true

운영 규칙:

- 로컬 Ollama는 추론 우선 경로이지만 단일 장애점으로 두지 않는다.
- 원격 fallback provider를 최소 1개 이상 유지한다.
- unattended automation은 worker fail-closed를 유지한다. 로컬 worker를 쓰는 경우 PC가 꺼지면 autonomy도 함께 중단된다.
