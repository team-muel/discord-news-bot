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
- Untrusted chat input is sanitized before passing to Obsidian CLI (control chars, traversal tokens, shell metacharacters removed) and guild-scoped markdown path resolution is constrained under `OBSIDIAN_VAULT_PATH`.
- Obsidian markdown access is serialized with local file locks to reduce concurrent read/delete collisions when multiple Discord commands run at the same time.
- Memory ingest/retrieval uses poison-guard heuristics (prompt-injection/ad-spam/link-heavy patterns) to block or down-rank contaminated context before it reaches RAG/LLM prompts.
- A lightweight rule-based sanitization worker runs before memory persistence (future Obsidian writes included) and blocks malformed/injection-like text early.
