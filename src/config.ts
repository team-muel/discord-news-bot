import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv, parseMinNumberEnv, parseNumberEnv, parseStringEnv, parseUrlEnv } from './utils/env';

const parsePositiveNumberEnv = (raw: string | undefined, fallback: number): number => {
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export const PORT = parseIntegerEnv(process.env.PORT, 3000);
export const FRONTEND_ORIGIN = parseStringEnv(process.env.CORS_ALLOWLIST ?? process.env.FRONTEND_ORIGIN ?? process.env.OAUTH_REDIRECT_ALLOWLIST, '');
export const NODE_ENV = parseStringEnv(process.env.NODE_ENV, 'development');
export const JSON_BODY_LIMIT = parseStringEnv(process.env.JSON_BODY_LIMIT, '2mb');
export const PUBLIC_BASE_URL = parseUrlEnv(process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? process.env.RENDER_PUBLIC_URL, '');

export const DISCORD_READY_TIMEOUT_MS = parseIntegerEnv(
  process.env.DISCORD_READY_TIMEOUT_MS || process.env.DISCORD_LOGIN_TIMEOUT_MS,
  45000,
);
export const DISCORD_START_RETRIES = parseIntegerEnv(process.env.DISCORD_START_RETRIES, 3);
export const DISCORD_COMMAND_GUILD_ID = parseStringEnv(process.env.DISCORD_COMMAND_GUILD_ID, '');
export const DISCORD_MESSAGE_CONTENT_INTENT_ENABLED = parseBooleanEnv(
  process.env.DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
  true,
);

export const START_BOT = parseBooleanEnv(process.env.START_BOT, false);
export const BOT_START_FAILURE_EXIT_ENABLED = parseBooleanEnv(
  process.env.BOT_START_FAILURE_EXIT_ENABLED,
  NODE_ENV === 'production',
);
export const DISCORD_BOT_TOKEN = parseStringEnv(process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN, '');
export const BOT_MANUAL_RECONNECT_COOLDOWN_MS = parseIntegerEnv(
  process.env.BOT_MANUAL_RECONNECT_COOLDOWN_MS || process.env.DISCORD_MANUAL_RECONNECT_COOLDOWN_MS,
  30_000,
);
export const DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS = parseMinIntEnv(process.env.DISCORD_LOGIN_RATE_LIMIT_BUFFER_MS, 5 * 60_000, 0);
export const DYNAMIC_WORKER_RESTORE_ON_BOOT = parseBooleanEnv(process.env.DYNAMIC_WORKER_RESTORE_ON_BOOT, true);
const JWT_SECRET_FALLBACK = 'dev-jwt-secret-change-in-production';
const jwtSecretRaw = parseStringEnv(process.env.JWT_SECRET ?? process.env.SESSION_SECRET, '');
if (NODE_ENV === 'production' && (!jwtSecretRaw || jwtSecretRaw === JWT_SECRET_FALLBACK)) {
  throw new Error('JWT_SECRET (or SESSION_SECRET) must be set to a non-default value in production');
}
export const JWT_SECRET = jwtSecretRaw || JWT_SECRET_FALLBACK;
export const AUTH_COOKIE_NAME = parseStringEnv(process.env.AUTH_COOKIE_NAME, 'muel_session');
export const AUTH_CSRF_COOKIE_NAME = parseStringEnv(process.env.AUTH_CSRF_COOKIE_NAME, 'muel_csrf');
export const AUTH_CSRF_HEADER_NAME = parseStringEnv(process.env.AUTH_CSRF_HEADER_NAME, 'x-csrf-token');
export const DEV_AUTH_ENABLED = parseBooleanEnv(process.env.DEV_AUTH_ENABLED, NODE_ENV !== 'production');
export const DISCORD_OAUTH_CLIENT_ID = parseStringEnv(process.env.DISCORD_OAUTH_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID, '');
export const DISCORD_OAUTH_CLIENT_SECRET = parseStringEnv(process.env.DISCORD_OAUTH_CLIENT_SECRET ?? process.env.DISCORD_CLIENT_SECRET, '');
export const DISCORD_OAUTH_REDIRECT_URI = process.env.DISCORD_OAUTH_REDIRECT_URI
  || (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/api/auth/callback` : '');
export const DISCORD_OAUTH_SCOPE = parseStringEnv(process.env.DISCORD_OAUTH_SCOPE, 'identify');
export const DISCORD_OAUTH_API_BASE = parseUrlEnv(process.env.DISCORD_OAUTH_API_BASE, 'https://discord.com/api');
export const DISCORD_INVITE_PERMISSIONS = parseStringEnv(process.env.DISCORD_INVITE_PERMISSIONS, '377957238784');
export const DISCORD_INVITE_SCOPES = parseStringEnv(process.env.DISCORD_INVITE_SCOPES, 'bot applications.commands');
export const DISCORD_OAUTH_STATE_COOKIE_NAME = parseStringEnv(process.env.DISCORD_OAUTH_STATE_COOKIE_NAME, 'muel_oauth_state');
export const DISCORD_OAUTH_STATE_TTL_SEC = parseIntegerEnv(process.env.DISCORD_OAUTH_STATE_TTL_SEC, 600);
export const RESEARCH_PRESET_ADMIN_USER_IDS = parseStringEnv(process.env.RESEARCH_PRESET_ADMIN_USER_IDS, '');
export const ADMIN_ALLOWLIST_TABLE = parseStringEnv(process.env.ADMIN_ALLOWLIST_TABLE, 'user_roles');
export const ADMIN_ALLOWLIST_ROLE_VALUE = parseStringEnv(process.env.ADMIN_ALLOWLIST_ROLE_VALUE, 'admin');
export const ADMIN_ALLOWLIST_CACHE_TTL_MS = parseIntegerEnv(process.env.ADMIN_ALLOWLIST_CACHE_TTL_MS, 300000);
export const SUPABASE_URL = parseStringEnv(process.env.SUPABASE_URL, '');
export const SUPABASE_SERVICE_ROLE_KEY = parseStringEnv(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY, '');
export const SUPABASE_TRADES_TABLE = parseStringEnv(process.env.SUPABASE_TRADES_TABLE, 'trades');

export const LOG_LEVEL = parseStringEnv(process.env.LOG_LEVEL, 'info');
export const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = parseIntegerEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000);

// ──── Obsidian Headless CLI (RAG Integration) ────
export const OBSIDIAN_HEADLESS_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_HEADLESS_ENABLED, false);
export const OBSIDIAN_LOCAL_FS_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_LOCAL_FS_ENABLED, false);
export const OBSIDIAN_VAULT_PATH = parseStringEnv(process.env.OBSIDIAN_VAULT_PATH, '');
export const OBSIDIAN_EMAIL = parseStringEnv(process.env.OBSIDIAN_EMAIL, '');
export const OBSIDIAN_PASSWORD = parseStringEnv(process.env.OBSIDIAN_PASSWORD, '');
export const OBSIDIAN_VAULT_NAME = parseStringEnv(process.env.OBSIDIAN_VAULT_NAME, 'docs');
export const OBSIDIAN_RAG_CACHE_TTL_MS = parseIntegerEnv(process.env.OBSIDIAN_RAG_CACHE_TTL_MS, 3600000);
export const OBSIDIAN_RAG_MAX_DOCS = parseIntegerEnv(process.env.OBSIDIAN_RAG_MAX_DOCS, 10);
export const OBSIDIAN_RAG_CACHE_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_RAG_CACHE_ENABLED, true);

// ──── Sprint Pipeline (Autonomous Agent) ────
export const SPRINT_ENABLED = parseBooleanEnv(process.env.SPRINT_ENABLED, true);
export type AutonomyLevelConfig = 'full-auto' | 'approve-ship' | 'approve-impl' | 'manual';
export const SPRINT_AUTONOMY_LEVEL = parseStringEnv(process.env.SPRINT_AUTONOMY_LEVEL, 'approve-ship') as AutonomyLevelConfig;
export const SPRINT_BUGFIX_AUTONOMY_LEVEL = parseStringEnv(process.env.SPRINT_BUGFIX_AUTONOMY_LEVEL, 'approve-ship') as AutonomyLevelConfig;
export const SPRINT_MAX_IMPL_REVIEW_LOOPS = parseIntegerEnv(process.env.SPRINT_MAX_IMPL_REVIEW_LOOPS, 3);
export const SPRINT_MAX_TOTAL_PHASES = parseIntegerEnv(process.env.SPRINT_MAX_TOTAL_PHASES, 12);
export const SPRINT_CHANGED_FILE_CAP = parseIntegerEnv(process.env.SPRINT_CHANGED_FILE_CAP, 10);
export const SPRINT_NEW_FILE_CAP = parseIntegerEnv(process.env.SPRINT_NEW_FILE_CAP, 3);
export const SPRINT_PHASE_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_PHASE_TIMEOUT_MS, 120_000);
export const SPRINT_TRIGGER_ERROR_THRESHOLD = parseIntegerEnv(process.env.SPRINT_TRIGGER_ERROR_THRESHOLD, 5);
export const SPRINT_TRIGGER_CS_CHANNEL_IDS = parseStringEnv(process.env.SPRINT_TRIGGER_CS_CHANNEL_IDS, '');
export const SPRINT_TRIGGER_CRON_SECURITY_AUDIT = parseStringEnv(process.env.SPRINT_TRIGGER_CRON_SECURITY_AUDIT, '');
export const SPRINT_TRIGGER_CRON_IMPROVEMENT = parseStringEnv(process.env.SPRINT_TRIGGER_CRON_IMPROVEMENT, '');
export const SPRINT_GIT_ENABLED = parseBooleanEnv(process.env.SPRINT_GIT_ENABLED, false);
export const SPRINT_GITHUB_TOKEN = parseStringEnv(process.env.SPRINT_GITHUB_TOKEN, '');
export const SPRINT_GITHUB_OWNER = parseStringEnv(process.env.SPRINT_GITHUB_OWNER, '');
export const SPRINT_GITHUB_REPO = parseStringEnv(process.env.SPRINT_GITHUB_REPO, '');
export const SPRINT_PIPELINES_TABLE = parseStringEnv(process.env.SPRINT_PIPELINES_TABLE, 'sprint_pipelines');
export const VENTYD_EVENTS_TABLE = parseStringEnv(process.env.VENTYD_EVENTS_TABLE, 'ventyd_events');
export const VENTYD_ENABLED = parseBooleanEnv(process.env.VENTYD_ENABLED, true);
export const SPRINT_DRY_RUN = parseBooleanEnv(process.env.SPRINT_DRY_RUN, false);
export const SPRINT_FAST_PATH_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_ENABLED, true);
export const SPRINT_FAST_PATH_VITEST_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_VITEST_TIMEOUT_MS, 60_000);
export const SPRINT_FAST_PATH_TSC_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_TSC_TIMEOUT_MS, 30_000);
export const SPRINT_FAST_PATH_SANDBOX_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_SANDBOX_ENABLED, false);
export const SPRINT_FAST_PATH_SANDBOX_ID = parseStringEnv(process.env.SPRINT_FAST_PATH_SANDBOX_ID, '');

// ──── Cross-Model Outside Voice ────
export const SPRINT_CROSS_MODEL_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_ENABLED, false);
export const SPRINT_CROSS_MODEL_PROVIDER = parseStringEnv(process.env.SPRINT_CROSS_MODEL_PROVIDER, '');
export const SPRINT_CROSS_MODEL_PHASES = parseStringEnv(process.env.SPRINT_CROSS_MODEL_PHASES, 'review,security-audit');
export const SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED, false);

// ──── Scope Guard (freeze/guard) ────
export const SPRINT_SCOPE_GUARD_ENABLED = parseBooleanEnv(process.env.SPRINT_SCOPE_GUARD_ENABLED, true);
export const SPRINT_SCOPE_GUARD_ALLOWED_DIRS = parseStringEnv(process.env.SPRINT_SCOPE_GUARD_ALLOWED_DIRS, 'src,scripts,tests,.github/skills');
export const SPRINT_SCOPE_GUARD_PROTECTED_FILES = parseStringEnv(process.env.SPRINT_SCOPE_GUARD_PROTECTED_FILES, 'package.json,.env,ecosystem.config.cjs,render.yaml');

// ──── LLM-as-Judge (Tier 3 eval) ────
export const SPRINT_LLM_JUDGE_ENABLED = parseBooleanEnv(process.env.SPRINT_LLM_JUDGE_ENABLED, false);
export const SPRINT_LLM_JUDGE_PHASES = parseStringEnv(process.env.SPRINT_LLM_JUDGE_PHASES, 'review,retro');

// ──── Autoplan Sub-Pipeline ────
export const SPRINT_AUTOPLAN_ENABLED = parseBooleanEnv(process.env.SPRINT_AUTOPLAN_ENABLED, false);
export const SPRINT_AUTOPLAN_LENSES = parseStringEnv(process.env.SPRINT_AUTOPLAN_LENSES, 'ceo,engineering,security');

// ──── Sprint Learning Journal ────
export const SPRINT_LEARNING_JOURNAL_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_ENABLED, true);
export const SPRINT_LEARNING_JOURNAL_GUILD_ID = parseStringEnv(process.env.SPRINT_LEARNING_JOURNAL_GUILD_ID, 'system');
export const SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW = parseMinIntEnv(process.env.SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW, 10, 3);
export const SPRINT_LEARNING_JOURNAL_LLM_RECONFIG_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_LLM_RECONFIG_ENABLED, true);
export const SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED, false);
// Accept 0-1 (e.g. 0.85) or 1-100 (e.g. 85) — normalize to 0-1 range, clamp to [0.5, 1]
const _rawMinConf = parseNumberEnv(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE, 75);
export const SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE = Math.max(0.5, Math.min(1, _rawMinConf > 1 ? _rawMinConf / 100 : _rawMinConf));

// ──── MCP Worker Fast-Fail ────
// Fast-fail must be strictly less than phase timeout; cap at 50% of phase timeout
const _phaseTimeoutMs = parseIntegerEnv(process.env.SPRINT_PHASE_TIMEOUT_MS, 120_000);
const _fastFailRaw = parseIntegerEnv(process.env.MCP_FAST_FAIL_TIMEOUT_MS, 10_000);
export const MCP_FAST_FAIL_TIMEOUT_MS = Math.max(3_000, Math.min(_fastFailRaw, Math.floor(_phaseTimeoutMs * 0.5)));

// ──── Recursive Self-Improvement Loop ────
export const SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED, true);
export const SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE = parseNumberEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE, 15);
export const SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT = parseIntegerEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT, 3);
export const SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED, true);
export const SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED, true);
export const SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS = parseIntegerEnv(process.env.SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS, 2);
export const SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED, true);
export const SELF_IMPROVEMENT_CONVERGENCE_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_CONVERGENCE_ENABLED, true);

// ──── Observer Layer (Phase F: Autonomous Agent Evolution) ────
export const OBSERVER_ENABLED = parseBooleanEnv(process.env.OBSERVER_ENABLED, false);
export const OBSERVER_SCAN_INTERVAL_MS = parseMinIntEnv(process.env.OBSERVER_SCAN_INTERVAL_MS, 5 * 60_000, 60_000);
export const OBSERVER_ERROR_PATTERN_ENABLED = parseBooleanEnv(process.env.OBSERVER_ERROR_PATTERN_ENABLED, true);
export const OBSERVER_ERROR_PATTERN_MIN_FREQUENCY = parseMinIntEnv(process.env.OBSERVER_ERROR_PATTERN_MIN_FREQUENCY, 3, 1);
export const OBSERVER_MEMORY_GAP_ENABLED = parseBooleanEnv(process.env.OBSERVER_MEMORY_GAP_ENABLED, true);
export const OBSERVER_MEMORY_GAP_STALE_HOURS = parseMinIntEnv(process.env.OBSERVER_MEMORY_GAP_STALE_HOURS, 48, 1);
export const OBSERVER_PERF_DRIFT_ENABLED = parseBooleanEnv(process.env.OBSERVER_PERF_DRIFT_ENABLED, true);
export const OBSERVER_PERF_DRIFT_THRESHOLD_PCT = parseMinNumberEnv(process.env.OBSERVER_PERF_DRIFT_THRESHOLD_PCT, 20, 1);
export const OBSERVER_CODE_HEALTH_ENABLED = parseBooleanEnv(process.env.OBSERVER_CODE_HEALTH_ENABLED, false);
export const OBSERVER_CONVERGENCE_DIGEST_ENABLED = parseBooleanEnv(process.env.OBSERVER_CONVERGENCE_DIGEST_ENABLED, true);
export const OBSERVER_DISCORD_PULSE_ENABLED = parseBooleanEnv(process.env.OBSERVER_DISCORD_PULSE_ENABLED, true);
export const OBSERVER_HARNESS_GATE_ENABLED = parseBooleanEnv(process.env.OBSERVER_HARNESS_GATE_ENABLED, true);

// ──── Community Voice — bot proactively speaks to Discord channels ──────────
export const COMMUNITY_VOICE_ENABLED = parseBooleanEnv(process.env.COMMUNITY_VOICE_ENABLED, true);
export const COMMUNITY_VOICE_CHANNEL_ID = parseStringEnv(process.env.COMMUNITY_VOICE_CHANNEL_ID, '');
export const COMMUNITY_VOICE_COOLDOWN_MS = parseMinIntEnv(process.env.COMMUNITY_VOICE_COOLDOWN_MS, 10 * 60_000, 60_000);
export const COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES = parseMinIntEnv(process.env.COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES, 120, 10);

// ──── Intent Formation (Phase G: Autonomous Agent Evolution) ────
export const INTENT_FORMATION_ENABLED = parseBooleanEnv(process.env.INTENT_FORMATION_ENABLED, true);
export const INTENT_MAX_PENDING = parseIntegerEnv(process.env.INTENT_MAX_PENDING, 10);
export const INTENT_COOLDOWN_MS = parseIntegerEnv(process.env.INTENT_COOLDOWN_MS, 30 * 60_000);
export const INTENT_DAILY_BUDGET_TOKENS = parseIntegerEnv(process.env.INTENT_DAILY_BUDGET_TOKENS, 100_000);

// ──── Progressive Trust Engine (Phase H) ────
export const TRUST_ENGINE_ENABLED = parseBooleanEnv(process.env.TRUST_ENGINE_ENABLED, false);
export const TRUST_MAX_AUTONOMY_LEVEL = parseStringEnv(process.env.TRUST_MAX_AUTONOMY_LEVEL, 'approve-ship') as AutonomyLevelConfig;
export const TRUST_BUGFIX_THRESHOLD = parseNumberEnv(process.env.TRUST_BUGFIX_THRESHOLD, 0.7);
export const TRUST_FEATURE_THRESHOLD = parseNumberEnv(process.env.TRUST_FEATURE_THRESHOLD, 0.85);
export const TRUST_DEFAULT_SCORE = parseNumberEnv(process.env.TRUST_DEFAULT_SCORE, 0.35);
export const TRUST_CACHE_TTL_MS = parseIntegerEnv(process.env.TRUST_CACHE_TTL_MS, 60 * 60_000);
export const TRUST_DECAY_DAILY_RATE = parseNumberEnv(process.env.TRUST_DECAY_DAILY_RATE, 0.01);
export const TRUST_DECAY_INACTIVE_DAYS = parseIntegerEnv(process.env.TRUST_DECAY_INACTIVE_DAYS, 7);
export const TRUST_LOOP_BREAKER_ENABLED = parseBooleanEnv(process.env.TRUST_LOOP_BREAKER_ENABLED, false);

// ──── Memory Consolidation Concept Tier ────
export const MEMORY_CONSOLIDATION_CONCEPT_ENABLED = parseBooleanEnv(process.env.MEMORY_CONSOLIDATION_CONCEPT_ENABLED, false);
export const MEMORY_CONSOLIDATION_CONCEPT_MIN_LINKS = parseIntegerEnv(process.env.MEMORY_CONSOLIDATION_CONCEPT_MIN_LINKS, 5);
export const MEMORY_CONSOLIDATION_CONCEPT_MIN_DENSITY = parseNumberEnv(process.env.MEMORY_CONSOLIDATION_CONCEPT_MIN_DENSITY, 0.4);

// ──── Traffic Routing (LangGraph Phase 2 Cutover) ────
export const TRAFFIC_ROUTING_ENABLED = parseBooleanEnv(process.env.TRAFFIC_ROUTING_ENABLED, false);
export const TRAFFIC_ROUTING_MODE = parseStringEnv(process.env.TRAFFIC_ROUTING_MODE, 'shadow') as 'main' | 'shadow' | 'langgraph';
export const TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD = parseNumberEnv(process.env.TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD, 0.3);
export const TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD = parseNumberEnv(process.env.TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD, -0.2);
export const TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES = parseIntegerEnv(process.env.TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES, 50);
export const TRAFFIC_ROUTING_STATS_WINDOW_HOURS = parseIntegerEnv(process.env.TRAFFIC_ROUTING_STATS_WINDOW_HOURS, 72);

// ──── Supabase Infrastructure (pg_cron, pgvector) ────
export const PG_CRON_BOOTSTRAP_ENABLED = parseBooleanEnv(process.env.PG_CRON_BOOTSTRAP_ENABLED, true);
export const PG_CRON_REPLACES_APP_LOOPS = parseBooleanEnv(process.env.PG_CRON_REPLACES_APP_LOOPS, false);
export const MEMORY_EMBEDDING_ENABLED = parseBooleanEnv(process.env.MEMORY_EMBEDDING_ENABLED, true);

export const memoryConfig = {
  consolidationEnabled: parseBooleanEnv(process.env.MEMORY_CONSOLIDATION_ENABLED, true),
  consolidationIntervalMs: parseMinIntEnv(process.env.MEMORY_CONSOLIDATION_INTERVAL_MS, 6 * 60 * 60_000, 60_000),
  consolidationMinGroupSize: parseMinIntEnv(process.env.MEMORY_CONSOLIDATION_MIN_GROUP_SIZE, 3, 2),
  consolidationMaxBatch: parseMinIntEnv(process.env.MEMORY_CONSOLIDATION_MAX_BATCH, 5, 1),
  consolidationRawAgeHours: parseMinIntEnv(process.env.MEMORY_CONSOLIDATION_RAW_AGE_HOURS, 6, 1),
  evolutionEnabled: parseBooleanEnv(process.env.MEMORY_EVOLUTION_ENABLED, true),
  evolutionMaxLinks: parseBoundedNumberEnv(process.env.MEMORY_EVOLUTION_MAX_LINKS, 5, 1, 10),
  evolutionMinSimilarity: parseBoundedNumberEnv(process.env.MEMORY_EVOLUTION_MIN_SIMILARITY, 0.25, 0, 1),
  evolutionConfidenceBoost: parseBoundedNumberEnv(process.env.MEMORY_EVOLUTION_CONFIDENCE_BOOST, 0.03, 0, 0.1),
  evolutionLlmClassify: parseBooleanEnv(process.env.MEMORY_EVOLUTION_LLM_CLASSIFY, false),
  embeddingEnabled: MEMORY_EMBEDDING_ENABLED,
  userEmbeddingEnabled: parseBooleanEnv(process.env.USER_EMBEDDING_ENABLED, true),
  userEmbeddingRefreshIntervalMs: parseMinIntEnv(process.env.USER_EMBEDDING_REFRESH_INTERVAL_MS, 24 * 60 * 60_000, 60_000),
  userEmbeddingMinItems: parseMinIntEnv(process.env.USER_EMBEDDING_MIN_ITEMS, 3, 1),
} as const;

// ──── LLM Provider Configuration ─────────────────────────────────────────────
// Extracted to configLlmProviders.ts; re-exported for backward compatibility.
export {
  AI_PROVIDER,
  LLM_API_TIMEOUT_MS, LLM_API_TIMEOUT_LARGE_MS, LLM_PROVIDER_TOTAL_TIMEOUT_MS,
  LLM_PROVIDER_MAX_ATTEMPTS, LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED, LLM_HEDGE_DELAY_MS,
  LLM_CALL_LOG_ENABLED, LLM_CALL_LOG_TABLE,
  LLM_EXPERIMENT_ENABLED, LLM_EXPERIMENT_NAME, LLM_EXPERIMENT_HF_PERCENT,
  LLM_EXPERIMENT_FAIL_OPEN, LLM_EXPERIMENT_GUILD_ALLOWLIST_RAW,
  LLM_COST_INPUT_PER_1K_CHARS_USD, LLM_COST_OUTPUT_PER_1K_CHARS_USD,
  LLM_RESPONSE_CACHE_ENABLED, LLM_RESPONSE_CACHE_TTL_MS, LLM_RESPONSE_CACHE_MAX_ENTRIES,
  LLM_PROVIDER_BASE_ORDER_RAW, LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW,
  LLM_PROVIDER_FALLBACK_CHAIN_RAW, LLM_PROVIDER_POLICY_ACTIONS_RAW,
  LLM_WORKFLOW_MODEL_BINDINGS_RAW, LLM_WORKFLOW_PROFILE_DEFAULTS_RAW,
  OPENAI_API_KEY, OPENAI_ANALYSIS_MODEL,
  GEMINI_API_KEY, GEMINI_MODEL,
  ANTHROPIC_API_KEY, ANTHROPIC_VERSION, ANTHROPIC_MODEL,
  HF_TOKEN, HUGGINGFACE_CHAT_COMPLETIONS_URL, HUGGINGFACE_MODEL,
  OPENCLAW_API_KEY, OPENCLAW_BASE_URL, OPENCLAW_MODEL, OPENCLAW_FALLBACK_MODELS_RAW,
  OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS, OPENCLAW_GATEWAY_URL, OPENCLAW_GATEWAY_TOKEN,
  OPENCLAW_GATEWAY_ENABLED, OPENCLAW_ENABLED, OPENCLAW_DISABLED, OPENCLAW_LACUNA_SKILL_CREATE_ENABLED,
  NEMOCLAW_ENABLED, NEMOCLAW_DISABLED, NEMOCLAW_SANDBOX_NAME, NEMOCLAW_INFERENCE_MODEL, NEMOCLAW_SANDBOX_OLLAMA_URL,
  OPENSHELL_ENABLED, OPENSHELL_DISABLED, OPENSHELL_REMOTE_GATEWAY,
  OPENSHELL_SANDBOX_DELEGATION, OPENSHELL_DEFAULT_SANDBOX_ID, OPENSHELL_DEFAULT_SANDBOX_IMAGE,
  WSL_DISTRO, MCP_OPENCODE_TOOL_NAME,
  OLLAMA_BASE_URL, OLLAMA_MODEL,
  OPENJARVIS_SERVE_URL, OPENJARVIS_ENABLED, OPENJARVIS_DISABLED, OPENJARVIS_MODEL,
  LITELLM_BASE_URL, LITELLM_MASTER_KEY, LITELLM_ENABLED, LITELLM_MODEL,
  KIMI_API_KEY, KIMI_BASE_URL, KIMI_MODEL,
} from './configLlmProviders';

// ── Vibe Auto Worker (bot.ts worker config) ──
export const VIBE_AUTO_WORKER_PROMOTION_ENABLED = parseBooleanEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_ENABLED, true);
export const VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_FREQUENCY, 5, 1);
export const VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_WINDOW_DAYS, 7, 1);
export const VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_DISTINCT_REQUESTERS, 3, 1);
export const VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE = parseBoundedNumberEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_MIN_OUTCOME_SCORE, 0.65, 0, 1);
export const VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE = parseBoundedNumberEnv(process.env.VIBE_AUTO_WORKER_PROMOTION_MAX_POLICY_BLOCK_RATE, 0.10, 0, 1);
export const VIBE_AUTO_WORKER_PROPOSAL_DAILY_CAP_PER_GUILD = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_DAILY_CAP_PER_GUILD, 10, 1);
export const VIBE_AUTO_WORKER_PROPOSAL_DUPLICATE_WINDOW_MS = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_DUPLICATE_WINDOW_MS, 24 * 60 * 60_000, 60_000);
export const VIBE_AUTO_WORKER_PROPOSAL_MIN_SUCCESS_RATE = parseBoundedNumberEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_MIN_SUCCESS_RATE, 0.45, 0, 1);
export const VIBE_AUTO_WORKER_PROPOSAL_MIN_SAMPLES = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_MIN_SAMPLES, 6, 3);
export const VIBE_MESSAGE_DEDUP_TTL_MS = parseMinIntEnv(process.env.VIBE_MESSAGE_DEDUP_TTL_MS, 5 * 60_000, 30_000);
export const VIBE_AUTO_WORKER_PROPOSAL_ENABLED = parseBooleanEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_ENABLED, false);
export const VIBE_AUTO_WORKER_PROPOSAL_COOLDOWN_MS = parseMinIntEnv(process.env.VIBE_AUTO_WORKER_PROPOSAL_COOLDOWN_MS, 15 * 60_000, 60_000);

// ── Action Governance Policy ──
export const ACTION_POLICY_DEFAULT_ENABLED = parseBooleanEnv(process.env.ACTION_POLICY_DEFAULT_ENABLED, true);
const _actionPolicyDefaultRunModeRaw = parseStringEnv(process.env.ACTION_POLICY_DEFAULT_RUN_MODE, 'approval_required');
// Cast to `readonly string[]` so `.includes()` accepts the runtime string; the ternary below enforces the fallback.
export const ACTION_POLICY_DEFAULT_RUN_MODE = (['auto', 'approval_required', 'disabled'] as readonly string[]).includes(
  _actionPolicyDefaultRunModeRaw,
) ? _actionPolicyDefaultRunModeRaw : 'approval_required';
export const ACTION_POLICY_FAIL_OPEN_ON_ERROR = parseBooleanEnv(process.env.ACTION_POLICY_FAIL_OPEN_ON_ERROR, false);
export const ACTION_ALLOWED_ACTIONS = parseStringEnv(process.env.ACTION_ALLOWED_ACTIONS, '*');

// ── FinOps Budget & Cost ──
export const FINOPS_ENABLED = parseBooleanEnv(process.env.FINOPS_ENABLED, true);
export const FINOPS_ACTION_BASE_COST_USD = parseMinNumberEnv(process.env.FINOPS_ACTION_BASE_COST_USD, 0.002, 0);
export const FINOPS_ACTION_RETRY_COST_USD = parseMinNumberEnv(process.env.FINOPS_ACTION_RETRY_COST_USD, 0.0008, 0);
export const FINOPS_ACTION_DURATION_MS_COST_USD = parseMinNumberEnv(process.env.FINOPS_ACTION_DURATION_MS_COST_USD, 0.0000015, 0);
export const FINOPS_ACTION_FAILURE_PENALTY_USD = parseMinNumberEnv(process.env.FINOPS_ACTION_FAILURE_PENALTY_USD, 0.0007, 0);
export const FINOPS_RETRIEVAL_QUERY_COST_USD = parseMinNumberEnv(process.env.FINOPS_RETRIEVAL_QUERY_COST_USD, 0.0006, 0);
export const FINOPS_MEMORY_JOB_COST_USD = parseMinNumberEnv(process.env.FINOPS_MEMORY_JOB_COST_USD, 0.0012, 0);
export const FINOPS_DAILY_BUDGET_USD = parseMinNumberEnv(process.env.FINOPS_DAILY_BUDGET_USD, 5, 0.01);
export const FINOPS_MONTHLY_BUDGET_USD = parseMinNumberEnv(process.env.FINOPS_MONTHLY_BUDGET_USD, 100, 0.1);
export const FINOPS_DEGRADE_THRESHOLD_PCT = parseBoundedNumberEnv(process.env.FINOPS_DEGRADE_THRESHOLD_PCT, 0.9, 0.1, 2);
export const FINOPS_HARD_BLOCK_THRESHOLD_PCT = Math.max(FINOPS_DEGRADE_THRESHOLD_PCT, parseBoundedNumberEnv(process.env.FINOPS_HARD_BLOCK_THRESHOLD_PCT, 1.0, 0.1, 3));
export const FINOPS_DEGRADE_ALLOWED_ACTIONS_RAW = parseStringEnv(process.env.FINOPS_DEGRADE_ALLOWED_ACTIONS, '');
export const FINOPS_HARD_BLOCK_EXEMPT_ACTIONS_RAW = parseStringEnv(process.env.FINOPS_HARD_BLOCK_EXEMPT_ACTIONS, '');
export const FINOPS_CACHE_TTL_MS = parseMinIntEnv(process.env.FINOPS_CACHE_TTL_MS, 60_000, 10_000);

// ── MCP Worker ──
export const MCP_WORKER_AUTH_TOKEN = parseStringEnv(
  process.env.MCP_WORKER_AUTH_TOKEN
  ?? process.env.AGENT_ROLE_WORKER_AUTH_TOKEN
  ?? process.env.MCP_OPENCODE_WORKER_AUTH_TOKEN,
  '',
);
export const MCP_OPENCODE_WORKER_URL = parseUrlEnv(process.env.MCP_OPENCODE_WORKER_URL, '');
export const OPENJARVIS_REQUIRE_OPENCODE_WORKER = parseBooleanEnv(process.env.OPENJARVIS_REQUIRE_OPENCODE_WORKER, true);
export const UNATTENDED_WORKER_HEALTH_TIMEOUT_MS = parseBoundedNumberEnv(process.env.UNATTENDED_WORKER_HEALTH_TIMEOUT_MS, 5000, 1000, 30_000);
export const OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED = parseBooleanEnv(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_ENABLED, true);
export const OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN = parseBooleanEnv(process.env.OPENCODE_PUBLISH_DISTRIBUTED_LOCK_FAIL_OPEN, false);

// ── OpenCode SDK (headless server) ──
export const OPENCODE_SDK_ENABLED = parseBooleanEnv(process.env.OPENCODE_SDK_ENABLED, false);
export const OPENCODE_SDK_BASE_URL = parseUrlEnv(process.env.OPENCODE_SDK_BASE_URL, '');
export const OPENCODE_SDK_TIMEOUT_MS = parseMinIntEnv(process.env.OPENCODE_SDK_TIMEOUT_MS, 90_000, 5_000);
export const OPENCODE_SDK_AUTH_TOKEN = parseStringEnv(process.env.OPENCODE_SDK_AUTH_TOKEN, '');

// ── API Idempotency ──
export const API_IDEMPOTENCY_TABLE = parseStringEnv(process.env.API_IDEMPOTENCY_TABLE, 'api_idempotency_keys');
export const API_IDEMPOTENCY_TTL_SEC = parseMinIntEnv(process.env.API_IDEMPOTENCY_TTL_SEC, 86_400, 60);
export const API_IDEMPOTENCY_REQUIRE_HEADER = parseBooleanEnv(process.env.API_IDEMPOTENCY_REQUIRE_HEADER, false);

// ── Discord Runtime Policy ──
export const DISCORD_CODING_INTENT_PATTERN_RAW = parseStringEnv(process.env.DISCORD_CODING_INTENT_PATTERN, '');
export const DISCORD_AUTOMATION_INTENT_PATTERN_RAW = parseStringEnv(process.env.DISCORD_AUTOMATION_INTENT_PATTERN, '');
export const DISCORD_EMBED_DESCRIPTION_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_EMBED_DESCRIPTION_LIMIT, 3900);
export const DISCORD_ADMIN_SUMMARY_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_ADMIN_SUMMARY_LIMIT, 2000);
export const DISCORD_ADMIN_DETAILS_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_ADMIN_DETAILS_LIMIT, 1000);
export const DISCORD_DOCS_MESSAGE_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_MESSAGE_LIMIT, 1900);
export const DISCORD_DOCS_CONTEXT_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_CONTEXT_LIMIT, 4000);
export const DISCORD_DOCS_ANSWER_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_ANSWER_LIMIT, 1400);
export const DISCORD_DOCS_ANSWER_TARGET_CHARS_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_ANSWER_TARGET_CHARS, 400);
export const DISCORD_DOCS_LLM_MAX_TOKENS_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_LLM_MAX_TOKENS, 700);
export const DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_DOCS_FALLBACK_CONTEXT_LIMIT, 600);
export const DISCORD_MARKET_ANALYSIS_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_MARKET_ANALYSIS_LIMIT, 3900);
export const DISCORD_AGENT_RESULT_PREVIEW_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_AGENT_RESULT_PREVIEW_LIMIT, 1200);
export const DISCORD_VIBE_WORKER_REQUEST_CLIP_RAW = parseIntegerEnv(process.env.DISCORD_VIBE_WORKER_REQUEST_CLIP, 200);
export const DISCORD_VIBE_DEDUP_MAX_ENTRIES_RAW = parseIntegerEnv(process.env.DISCORD_VIBE_DEDUP_MAX_ENTRIES, 500);
export const DISCORD_SIMPLE_COMMAND_ALLOWLIST_RAW = parseStringEnv(process.env.DISCORD_SIMPLE_COMMAND_ALLOWLIST, '');
export const DISCORD_SESSION_PROGRESS_TIMEOUT_MS_RAW = parseIntegerEnv(process.env.DISCORD_SESSION_PROGRESS_TIMEOUT_MS, 3 * 60 * 1000);
export const DISCORD_SESSION_PROGRESS_INTERVAL_MS_RAW = parseIntegerEnv(process.env.DISCORD_SESSION_PROGRESS_INTERVAL_MS, 2200);
export const DISCORD_SESSION_PROGRESS_UPDATE_BUCKET_MS_RAW = parseIntegerEnv(process.env.DISCORD_SESSION_PROGRESS_UPDATE_BUCKET_MS, 10_000);
export const DISCORD_SESSION_RESULT_CLIP_LIMIT_DEBUG_RAW = parseIntegerEnv(process.env.DISCORD_SESSION_RESULT_CLIP_LIMIT_DEBUG, 1700);
export const DISCORD_SESSION_RESULT_CLIP_LIMIT_USER_RAW = parseIntegerEnv(process.env.DISCORD_SESSION_RESULT_CLIP_LIMIT_USER, 1200);
export const DISCORD_AUTH_MAX_GUILDS_IN_CACHE_RAW = parseIntegerEnv(process.env.DISCORD_AUTH_MAX_GUILDS_IN_CACHE, 500);
export const DISCORD_AUTH_MAX_USERS_PER_GUILD_RAW = parseIntegerEnv(process.env.DISCORD_AUTH_MAX_USERS_PER_GUILD, 5000);
export const DISCORD_LEARNING_POLICY_TTL_MS_RAW = parseIntegerEnv(process.env.DISCORD_LEARNING_POLICY_TTL_MS, 30_000);
export const DISCORD_CO_PRESENCE_WINDOW_MS_RAW = parseIntegerEnv(process.env.DISCORD_CO_PRESENCE_WINDOW_MS, 30 * 60 * 1000);
export const DISCORD_CO_PRESENCE_MAX_TARGETS_RAW = parseIntegerEnv(process.env.DISCORD_CO_PRESENCE_MAX_TARGETS, 2);
export const DISCORD_PASSIVE_MEMORY_CONTENT_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_PASSIVE_MEMORY_CONTENT_LIMIT, 2000);
export const DISCORD_PASSIVE_MEMORY_EXCERPT_LIMIT_RAW = parseIntegerEnv(process.env.DISCORD_PASSIVE_MEMORY_EXCERPT_LIMIT, 300);
export const DISCORD_FEEDBACK_REACTION_SEED_ENABLED_RAW = parseBooleanEnv(process.env.DISCORD_FEEDBACK_REACTION_SEED_ENABLED, true);
export const DISCORD_FEEDBACK_REACTION_SEED_UP_RAW = parseStringEnv(process.env.DISCORD_FEEDBACK_REACTION_SEED_UP, '👍');
export const DISCORD_FEEDBACK_REACTION_SEED_DOWN_RAW = parseStringEnv(process.env.DISCORD_FEEDBACK_REACTION_SEED_DOWN, '👎');
export const DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES_RAW = parseIntegerEnv(process.env.DISCORD_VIBE_AUTO_PROPOSAL_MAX_ENTRIES, 500);

// ── Discord Auth / Session ──
export const DISCORD_LOGIN_SESSION_TTL_MS = parseMinIntEnv(process.env.DISCORD_LOGIN_SESSION_TTL_MS, 24 * 60 * 60 * 1000, 300_000);
export const DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS = parseMinIntEnv(process.env.DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS, 2 * 60 * 60 * 1000, 60_000);
export const DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS = parseMinIntEnv(process.env.DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS, 30 * 60 * 1000, 60_000);
export const DISCORD_LOGIN_SESSION_CLEANUP_OWNER = parseStringEnv(process.env.DISCORD_LOGIN_SESSION_CLEANUP_OWNER, 'db').toLowerCase() === 'app' ? 'app' as const : 'db' as const;
export const DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND = parseBooleanEnv(process.env.DISCORD_AUTO_LOGIN_ON_FIRST_COMMAND, true);
export const DISCORD_SIMPLE_COMMANDS_ENABLED = parseBooleanEnv(process.env.DISCORD_SIMPLE_COMMANDS_ENABLED, true);
export const CODE_THREAD_ENABLED = parseBooleanEnv(process.env.CODE_THREAD_ENABLED, true);
export const WORKER_APPROVAL_CHANNEL_ID = parseStringEnv(process.env.WORKER_APPROVAL_CHANNEL_ID, '');
export const DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC = parseBooleanEnv(process.env.DISCORD_CLEAR_GUILD_COMMANDS_ON_GLOBAL_SYNC, false);
export const DISCORD_ENABLE_FEEDBACK_PROMPT = parseBooleanEnv(process.env.DISCORD_ENABLE_FEEDBACK_PROMPT, true);
export const DISCORD_FEEDBACK_PROMPT_LINE = parseStringEnv(process.env.DISCORD_FEEDBACK_PROMPT_LINE, '-# 이 응답이 마음에 드셨나요? 반응으로 알려주세요.');

// ── Agent Reasoning Strategies ──
export const AGENT_SESSION_TIMEOUT_MS = parseMinIntEnv(process.env.AGENT_SESSION_TIMEOUT_MS, 120_000, 20_000);
export const AGENT_STEP_TIMEOUT_MS = parseMinIntEnv(process.env.AGENT_STEP_TIMEOUT_MS, 45_000, 5_000);
export const FINAL_SELF_CONSISTENCY_ENABLED = parseBooleanEnv(process.env.FINAL_SELF_CONSISTENCY_ENABLED, true);
export const FINAL_SELF_CONSISTENCY_SAMPLES = parseBoundedNumberEnv(process.env.FINAL_SELF_CONSISTENCY_SAMPLES, 3, 1, 5);
export const LEAST_TO_MOST_ENABLED = parseBooleanEnv(process.env.LEAST_TO_MOST_ENABLED, true);
export const LEAST_TO_MOST_MAX_SUBGOALS = parseBoundedNumberEnv(process.env.LEAST_TO_MOST_MAX_SUBGOALS, 4, 2, 8);
export const LEAST_TO_MOST_MIN_GOAL_LENGTH = parseMinIntEnv(process.env.LEAST_TO_MOST_MIN_GOAL_LENGTH, 40, 20);
export const SELF_REFINE_LITE_ENABLED = parseBooleanEnv(process.env.SELF_REFINE_LITE_ENABLED, true);
export const SELF_REFINE_LITE_MAX_PASSES = parseBoundedNumberEnv(process.env.SELF_REFINE_LITE_MAX_PASSES, 1, 1, 2);
export const SELF_REFINE_LITE_REQUIRE_ACTIONABLE = parseBooleanEnv(process.env.SELF_REFINE_LITE_REQUIRE_ACTIONABLE, true);
export const SELF_REFINE_LITE_MIN_SCORE_GAIN = parseBoundedNumberEnv(process.env.SELF_REFINE_LITE_MIN_SCORE_GAIN, 1, 0, 10);
export const ORM_RULE_PASS_THRESHOLD = parseBoundedNumberEnv(process.env.ORM_RULE_PASS_THRESHOLD, 75, 50, 95);
export const ORM_RULE_REVIEW_THRESHOLD = parseBoundedNumberEnv(process.env.ORM_RULE_REVIEW_THRESHOLD, 55, 35, 90);
export const TOT_SELF_EVAL_ENABLED = parseBooleanEnv(process.env.TOT_SELF_EVAL_ENABLED, true);
export const TOT_SELF_EVAL_TEMPERATURE = parseBoundedNumberEnv(process.env.TOT_SELF_EVAL_TEMPERATURE, 0.1, 0, 1);
export const TOT_PROVIDER_LOGPROB_ENABLED = parseBooleanEnv(process.env.TOT_PROVIDER_LOGPROB_ENABLED, true);
export const AGENT_DYNAMIC_REASONING_BUDGET_ENABLED = parseBooleanEnv(process.env.AGENT_DYNAMIC_REASONING_BUDGET_ENABLED, true);
export const AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH = parseMinIntEnv(process.env.AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH, 120, 30);
export const AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH = Math.max(AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH + 20, parseIntegerEnv(process.env.AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH, 320));

// ── Go/No-Go Gate Defaults ──
const _clampPct = (raw: string | undefined, fallback: number) => parseBoundedNumberEnv(raw, fallback, 0, 1);
export const GO_NO_GO_MIN_CITATION_RATE = _clampPct(process.env.GO_NO_GO_MIN_CITATION_RATE, 0.95);
export const GO_NO_GO_MAX_UNRESOLVED_CONFLICT_RATE = _clampPct(process.env.GO_NO_GO_MAX_UNRESOLVED_CONFLICT_RATE, 0.05);
export const GO_NO_GO_MAX_JOB_FAILURE_RATE = _clampPct(process.env.GO_NO_GO_MAX_JOB_FAILURE_RATE, 0.10);
export const GO_NO_GO_MIN_RECALL_AT_5 = _clampPct(process.env.GO_NO_GO_MIN_RECALL_AT_5, 0.60);
export const GO_NO_GO_MIN_PILOT_GUILDS = parseMinIntEnv(process.env.GO_NO_GO_MIN_PILOT_GUILDS, 3, 1);
export const GO_NO_GO_MAX_CORRECTION_SLA_P95_MIN = parseBoundedNumberEnv(process.env.GO_NO_GO_MAX_CORRECTION_SLA_P95_MIN, 5, 0.1, 1440);
export const GO_NO_GO_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL = parseIntegerEnv(process.env.GO_NO_GO_MAX_TELEMETRY_QUEUE_DROPPED_TOTAL, 0);
export const GO_NO_GO_MAX_TELEMETRY_QUEUE_DROP_RATE = _clampPct(process.env.GO_NO_GO_MAX_TELEMETRY_QUEUE_DROP_RATE, 0.02);

// ── Entity Nervous System ──
export const ENTITY_NERVOUS_SYSTEM_ENABLED = parseBooleanEnv(process.env.ENTITY_NERVOUS_SYSTEM_ENABLED, true);
export const ENTITY_MEMORY_PRECIPITATION_ENABLED = parseBooleanEnv(process.env.ENTITY_MEMORY_PRECIPITATION_ENABLED, true);
export const ENTITY_MEMORY_PRECIPITATION_MIN_STEPS = parseMinIntEnv(process.env.ENTITY_MEMORY_PRECIPITATION_MIN_STEPS, 2, 1);
export const ENTITY_REWARD_BEHAVIOR_ENABLED = parseBooleanEnv(process.env.ENTITY_REWARD_BEHAVIOR_ENABLED, true);
export const ENTITY_SELF_NOTES_ENABLED = parseBooleanEnv(process.env.ENTITY_SELF_NOTES_ENABLED, true);
export const ENTITY_SELF_NOTES_MAX_LENGTH = parseMinIntEnv(process.env.ENTITY_SELF_NOTES_MAX_LENGTH, 2000, 200);
export const ENTITY_SELF_NOTES_MAX_ITEMS = parseMinIntEnv(process.env.ENTITY_SELF_NOTES_MAX_ITEMS, 10, 3);

// ── Multi-Agent Service ──
export const AGENT_MAX_SESSION_HISTORY = parseMinIntEnv(process.env.AGENT_MAX_SESSION_HISTORY, 300, 50);
export const AGENT_MEMORY_HINT_TIMEOUT_MS = parseMinIntEnv(process.env.AGENT_MEMORY_HINT_TIMEOUT_MS, 5_000, 500);
export const AGENT_QUEUE_POLL_MS = parseMinIntEnv(process.env.AGENT_QUEUE_POLL_MS, 250, 100);
export const AGENT_MAX_QUEUE_SIZE = parseMinIntEnv(process.env.AGENT_MAX_QUEUE_SIZE, 300, 10);
export const AGENT_SESSION_MAX_ATTEMPTS = parseMinIntEnv(process.env.AGENT_SESSION_MAX_ATTEMPTS, 1, 1);
export const AGENT_DEADLETTER_MAX = parseMinIntEnv(process.env.AGENT_DEADLETTER_MAX, 300, 10);

// ── Bot Status / Admin Rate Limits ──
export const BOT_STATUS_CACHE_TTL_MS = parseMinIntEnv(process.env.BOT_STATUS_CACHE_TTL_MS, 5_000, 1_000);
export const BOT_STATUS_RATE_WINDOW_MS = parseMinIntEnv(process.env.BOT_STATUS_RATE_WINDOW_MS, 60_000, 1_000);
export const BOT_STATUS_RATE_MAX = parseMinIntEnv(process.env.BOT_STATUS_RATE_MAX, 60, 1);
export const BOT_ADMIN_ACTION_RATE_WINDOW_MS = parseMinIntEnv(process.env.BOT_ADMIN_ACTION_RATE_WINDOW_MS, 60_000, 1_000);
export const BOT_ADMIN_ACTION_RATE_MAX = parseMinIntEnv(process.env.BOT_ADMIN_ACTION_RATE_MAX, 20, 1);

// ── MCP Skill Router ──
export const MCP_SKILL_ROUTER_ENABLED = parseBooleanEnv(process.env.MCP_SKILL_ROUTER_ENABLED, true);
export const MCP_HEALTH_SWEEP_INTERVAL_MS = parseMinIntEnv(process.env.MCP_HEALTH_SWEEP_INTERVAL_MS, 30_000, 15_000);
export const MCP_PROBE_TIMEOUT_MS = parseMinIntEnv(process.env.MCP_PROBE_TIMEOUT_MS, 5_000, 2_000);
export const MCP_HEALTH_TTL_MS = parseMinIntEnv(process.env.MCP_HEALTH_TTL_MS, 60_000, 10_000);

// ── MCP Upstream Proxy ──
/** JSON array of UpstreamMcpServerConfig objects — parsed by proxyRegistry.ts */
export const MCP_UPSTREAM_SERVERS_RAW = parseStringEnv(process.env.MCP_UPSTREAM_SERVERS, '');
/** TTL in ms for upstream server tool catalog cache (default 5 minutes) */
export const MCP_UPSTREAM_TOOL_CACHE_TTL_MS = parseMinIntEnv(process.env.MCP_UPSTREAM_TOOL_CACHE_TTL_MS, 5 * 60_000, 10_000);

// ── Semantic Answer Cache ──
export const SEMANTIC_ANSWER_CACHE_ENABLED = parseBooleanEnv(process.env.SEMANTIC_ANSWER_CACHE_ENABLED, true);
export const SEMANTIC_ANSWER_CACHE_MIN_SIMILARITY = parseBoundedNumberEnv(process.env.SEMANTIC_ANSWER_CACHE_MIN_SIMILARITY, 0.82, 0, 1);
export const SEMANTIC_ANSWER_CACHE_LOOKBACK_DAYS = parseMinIntEnv(process.env.SEMANTIC_ANSWER_CACHE_LOOKBACK_DAYS, 14, 1);
export const SEMANTIC_ANSWER_CACHE_CANDIDATE_LIMIT = parseBoundedNumberEnv(process.env.SEMANTIC_ANSWER_CACHE_CANDIDATE_LIMIT, 120, 10, 500);

// ── Session Shadow (LangGraph) ──
export const LANGGRAPH_EXECUTOR_SHADOW_ENABLED = parseBooleanEnv(process.env.LANGGRAPH_EXECUTOR_SHADOW_ENABLED, false);
export const LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE = parseBoundedNumberEnv(process.env.LANGGRAPH_EXECUTOR_SHADOW_SAMPLE_RATE, 0.2, 0, 1);
export const LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS = parseBoundedNumberEnv(process.env.LANGGRAPH_EXECUTOR_SHADOW_MAX_STEPS, 60, 5, 200);

// ── Obsidian File Lock ──
export const OBSIDIAN_FILE_LOCK_TIMEOUT_MS = parseMinIntEnv(process.env.OBSIDIAN_FILE_LOCK_TIMEOUT_MS, 8_000, 1);
export const OBSIDIAN_FILE_LOCK_STALE_MS = parseMinIntEnv(process.env.OBSIDIAN_FILE_LOCK_STALE_MS, 60_000, 1);
export const OBSIDIAN_FILE_LOCK_RETRY_MS = parseMinIntEnv(process.env.OBSIDIAN_FILE_LOCK_RETRY_MS, 120, 1);

// ── Privacy (Forget) ──
export const FORGET_OBSIDIAN_ENABLED = parseBooleanEnv(process.env.FORGET_OBSIDIAN_ENABLED, true);
export const OBSIDIAN_SYNC_GUILD_MAP_JSON = parseStringEnv(process.env.OBSIDIAN_SYNC_GUILD_MAP_JSON, '');
export const OBSIDIAN_SYNC_GUILD_MAP_FILE = parseStringEnv(process.env.OBSIDIAN_SYNC_GUILD_MAP_FILE, '');

// ── Structured Error Logging ──
export const ERROR_LOG_DB_ENABLED = parseBooleanEnv(process.env.ERROR_LOG_DB_ENABLED, true);
export const ERROR_LOG_TABLE = parseStringEnv(process.env.ERROR_LOG_TABLE, 'system_error_events');

// ── Local State Cache ──
export const LOCAL_CACHE_DIR = parseStringEnv(process.env.LOCAL_CACHE_DIR, '');
export const LOCAL_CACHE_MAX_ENTRIES = parseMinIntEnv(process.env.LOCAL_CACHE_MAX_ENTRIES, 200, 10);

// ── Task Routing ──
export const TASK_ROUTING_LEARNING_RULE_CACHE_TTL_MS = parseMinIntEnv(process.env.TASK_ROUTING_LEARNING_RULE_CACHE_TTL_MS, 60_000, 5_000);
export const TASK_ROUTING_LEARNING_RULE_MIN_CONFIDENCE = parseBoundedNumberEnv(process.env.TASK_ROUTING_LEARNING_RULE_MIN_CONFIDENCE, 0.65, 0, 1);

// ── Community Graph ──
export const SOCIAL_RECENCY_HALF_LIFE_DAYS = parseMinIntEnv(process.env.SOCIAL_RECENCY_HALF_LIFE_DAYS, 21, 3);

// ── Obsidian Vault Path ──
export const OBSIDIAN_SYNC_VAULT_PATH = parseStringEnv(process.env.OBSIDIAN_SYNC_VAULT_PATH ?? process.env.OBSIDIAN_VAULT_PATH, '');

// ── Conversation Turn Service ──
export const AGENT_CONVERSATION_THREAD_IDLE_MS = parseMinIntEnv(process.env.AGENT_CONVERSATION_THREAD_IDLE_MS, 6 * 60 * 60_000, 300_000);

// ── Super Agent Service ──
export const SUPER_AGENT_PAYLOAD_CLIP_CHARS = parseMinIntEnv(process.env.SUPER_AGENT_PAYLOAD_CLIP_CHARS, 2_000, 400);
export const SUPER_AGENT_REVIEW_APPROVAL_ACTION = parseStringEnv(process.env.SUPER_AGENT_REVIEW_APPROVAL_ACTION, 'super.inference.review');

// ── Supabase Fetch ──
export const SUPABASE_FETCH_TIMEOUT_MS = parseMinIntEnv(process.env.SUPABASE_FETCH_TIMEOUT_MS, 12_000, 1_000);
