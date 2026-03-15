# Render Agent Env Template

Use this as a baseline for deploying Muel as a server-operations runtime.

## Required

- ERROR_LOG_DB_ENABLED=true
- ERROR_LOG_TABLE=system_error_events
- LLM_API_TIMEOUT_MS=15000

## LLM Provider (Harness)

- AI_PROVIDER=openai|gemini|anthropic|openclaw|ollama
- OPENAI_API_KEY=<secret> (if openai)
- GEMINI_API_KEY=<secret> (if gemini)
- ANTHROPIC_API_KEY=<secret> (if anthropic)
- OPENCLAW_BASE_URL=<url> (if openclaw)
- OPENCLAW_API_KEY=<secret> (optional)
- OLLAMA_MODEL=<model> (if ollama)
- OLLAMA_BASE_URL=http://127.0.0.1:11434 (optional)
- OPENAI_ANALYSIS_MODEL / GEMINI_MODEL / ANTHROPIC_MODEL (optional)

## Agent Runtime Controls

- OBSIDIAN_FILE_LOCK_STALE_MS=60000 (optional, stale lock auto-recovery)
- OBSIDIAN_FILE_LOCK_RETRY_MS=120 (optional, lock retry interval)
- MEMORY_POISON_BLOCK_THRESHOLD=0.85 (optional, block suspicious memory ingestion)
- MEMORY_POISON_REVIEW_THRESHOLD=0.55 (optional, downgrade confidence + tag for review)
- MEMORY_RETRIEVE_MIN_CONFIDENCE=0.35 (optional, retrieval floor for non-pinned memory)
- MEMORY_HINT_MIN_CONFIDENCE=0.35 (optional, LLM hint floor for non-pinned memory)
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
- OBSIDIAN_VAULT_NAME=<vault-name> (optional, headless 대상 vault 식별자)
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

## Automation Defaults

- START_AUTOMATION_JOBS=true (optional)
- AUTOMATION_YOUTUBE_ENABLED=true (optional)
- AUTOMATION_NEWS_ENABLED=false (optional)
- DYNAMIC_WORKER_RESTORE_ON_BOOT=true (optional, default true: restart 시 승인된 동적 워커 자동 복원)
- DYNAMIC_WORKER_RUNTIME_DIR=.runtime/dynamic-workers (optional, 동적 워커 코드 아티팩트 저장 경로)
- WORKER_APPROVAL_STORE_MODE=auto (optional: auto|supabase|file)
- WORKER_APPROVAL_DB_TABLE=worker_approvals (optional)
- WORKER_APPROVAL_STORE_PATH=.runtime/worker-approvals.json (optional, file 모드/폴백 경로)

## Web Search & Verification

- SERPER_API_KEY=<secret> (optional — Google 품질 검색; 없으면 DuckDuckGo HTML 폴백 자동 사용)
- WEB_SEARCH_MAX_RESULTS=5 (optional)
- NEWS_VERIFY_SOURCE_LIMIT=4 (optional)
- ACTION_NEWS_CAPTURE_ENABLED=true (optional)
- ACTION_NEWS_CAPTURE_TTL_MS=21600000 (optional, 6시간)
- ACTION_NEWS_CAPTURE_MIN_ITEMS=2 (optional)
- ACTION_NEWS_CAPTURE_MAX_ITEMS=5 (optional)
- ACTION_NEWS_CAPTURE_MAX_AGE_HOURS=72 (optional)
- ACTION_NEWS_CAPTURE_SOURCE=google_news_rss (optional)

## Trading Credentials

- BINANCE_API_KEY=<secret>
- BINANCE_API_SECRET=<secret>
- BINANCE_SECRET_KEY=<secret> (legacy alias, migrate to BINANCE_API_SECRET)

## Notes

- `AUTOMATION_NEWS_ENABLED=false` keeps non-essential news push opt-in.
- If multiple providers are configured, `AI_PROVIDER` selects priority.
- If no provider configuration exists, `/해줘` and `/시작` session creation fails by design.
- 비용 최소화가 목표라면 `AI_PROVIDER=ollama`와 소형 모델(예: qwen2.5:3b-instruct) 조합을 권장합니다.
- `DISCORD_SIMPLE_COMMANDS_ENABLED=true` keeps command surface minimal (`/구독`, `/로그인`, `/도움말`, `/설정`, `/ping`) and enables mention-first chat UX.
- `DISCORD_LOGIN_SESSION_TTL_MS` controls how long a non-admin login session stays active for subscription add/remove.
- `DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS` enables sliding expiration; sessions accessed near expiry are extended.
- `DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS` controls periodic cleanup of expired persisted sessions.
- Persistent login across bot restarts requires the `discord_login_sessions` table from `docs/SUPABASE_SCHEMA.sql`.
- If `OBSIDIAN_CLI_COMMAND` is set, the backend executes it at runtime to fetch memory hints and falls back to direct markdown reads only when CLI output is unavailable.
- 로컬 PC가 꺼져도 무인 운영하려면 read/search/graph는 `headless-cli` 우선, 쓰기는 Supabase(memory_items/guild_lore_docs) 경로를 기본으로 설계하세요.
- 현재 `headless-cli` adapter는 `read_lore/search_vault/read_file/graph_metadata` 중심이며, `write_note`는 local-fs/script-cli fallback 경로를 사용합니다.
- LiteLLM 프록시를 사용하려면 `AI_PROVIDER=openclaw` + `OPENCLAW_BASE_URL=<litellm-endpoint>` 조합으로 서버 측 provider 경로를 고정하세요.
- Untrusted chat input is sanitized before passing to Obsidian CLI (control chars, traversal tokens, shell metacharacters removed) and guild-scoped markdown path resolution is constrained under `OBSIDIAN_VAULT_PATH`.
- Obsidian markdown access is serialized with local file locks to reduce concurrent read/delete collisions when multiple Discord commands run at the same time.
- Memory ingest/retrieval uses poison-guard heuristics (prompt-injection/ad-spam/link-heavy patterns) to block or down-rank contaminated context before it reaches RAG/LLM prompts.
- A lightweight rule-based sanitization worker runs before memory persistence (future Obsidian writes included) and blocks malformed/injection-like text early.
