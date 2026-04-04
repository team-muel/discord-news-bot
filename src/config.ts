import { parseBooleanEnv, parseIntegerEnv, parseNumberEnv } from './utils/env';

const parsePositiveNumberEnv = (raw: string | undefined, fallback: number): number => {
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

export const PORT = parseIntegerEnv(process.env.PORT, 3000);
export const FRONTEND_ORIGIN = process.env.CORS_ALLOWLIST || process.env.FRONTEND_ORIGIN || process.env.OAUTH_REDIRECT_ALLOWLIST || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
export const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_PUBLIC_URL || '').replace(/\/+$/, '');

export const DISCORD_READY_TIMEOUT_MS = parseIntegerEnv(
  process.env.DISCORD_READY_TIMEOUT_MS || process.env.DISCORD_LOGIN_TIMEOUT_MS,
  45000,
);
export const DISCORD_START_RETRIES = parseIntegerEnv(process.env.DISCORD_START_RETRIES, 3);
export const DISCORD_COMMAND_GUILD_ID = process.env.DISCORD_COMMAND_GUILD_ID || '';
export const DISCORD_MESSAGE_CONTENT_INTENT_ENABLED = parseBooleanEnv(
  process.env.DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
  true,
);

export const START_BOT = parseBooleanEnv(process.env.START_BOT, false);
export const BOT_START_FAILURE_EXIT_ENABLED = parseBooleanEnv(
  process.env.BOT_START_FAILURE_EXIT_ENABLED,
  NODE_ENV === 'production',
);
const JWT_SECRET_FALLBACK = 'dev-jwt-secret-change-in-production';
const JWT_SECRET_FROM_ENV = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
if (NODE_ENV === 'production' && (!JWT_SECRET_FROM_ENV || JWT_SECRET_FROM_ENV === JWT_SECRET_FALLBACK)) {
  throw new Error('JWT_SECRET (or SESSION_SECRET) must be set to a non-default value in production');
}
export const JWT_SECRET = JWT_SECRET_FROM_ENV || JWT_SECRET_FALLBACK;
export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'muel_session';
export const AUTH_CSRF_COOKIE_NAME = process.env.AUTH_CSRF_COOKIE_NAME || 'muel_csrf';
export const AUTH_CSRF_HEADER_NAME = process.env.AUTH_CSRF_HEADER_NAME || 'x-csrf-token';
export const DEV_AUTH_ENABLED = parseBooleanEnv(process.env.DEV_AUTH_ENABLED, NODE_ENV !== 'production');
export const DISCORD_OAUTH_CLIENT_ID = process.env.DISCORD_OAUTH_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
export const DISCORD_OAUTH_CLIENT_SECRET = process.env.DISCORD_OAUTH_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || '';
export const DISCORD_OAUTH_REDIRECT_URI = process.env.DISCORD_OAUTH_REDIRECT_URI
  || (PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}/api/auth/callback` : '');
export const DISCORD_OAUTH_SCOPE = process.env.DISCORD_OAUTH_SCOPE || 'identify';
export const DISCORD_OAUTH_API_BASE = process.env.DISCORD_OAUTH_API_BASE || 'https://discord.com/api';
export const DISCORD_INVITE_PERMISSIONS = process.env.DISCORD_INVITE_PERMISSIONS || '377957238784';
export const DISCORD_INVITE_SCOPES = process.env.DISCORD_INVITE_SCOPES || 'bot applications.commands';
export const DISCORD_OAUTH_STATE_COOKIE_NAME = process.env.DISCORD_OAUTH_STATE_COOKIE_NAME || 'muel_oauth_state';
export const DISCORD_OAUTH_STATE_TTL_SEC = parseIntegerEnv(process.env.DISCORD_OAUTH_STATE_TTL_SEC, 600);
export const RESEARCH_PRESET_ADMIN_USER_IDS = process.env.RESEARCH_PRESET_ADMIN_USER_IDS || '';
export const ADMIN_ALLOWLIST_TABLE = process.env.ADMIN_ALLOWLIST_TABLE || 'user_roles';
export const ADMIN_ALLOWLIST_ROLE_VALUE = process.env.ADMIN_ALLOWLIST_ROLE_VALUE || 'admin';
export const ADMIN_ALLOWLIST_CACHE_TTL_MS = parseIntegerEnv(process.env.ADMIN_ALLOWLIST_CACHE_TTL_MS, 300000);
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
export const SUPABASE_TRADES_TABLE = process.env.SUPABASE_TRADES_TABLE || 'trades';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = parseIntegerEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000);

// ──── Obsidian Headless CLI (RAG Integration) ────
export const OBSIDIAN_HEADLESS_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_HEADLESS_ENABLED, false);
export const OBSIDIAN_EMAIL = process.env.OBSIDIAN_EMAIL || '';
export const OBSIDIAN_PASSWORD = process.env.OBSIDIAN_PASSWORD || '';
export const OBSIDIAN_VAULT_NAME = process.env.OBSIDIAN_VAULT_NAME || 'docs';
export const OBSIDIAN_RAG_CACHE_TTL_MS = parseIntegerEnv(process.env.OBSIDIAN_RAG_CACHE_TTL_MS, 3600000);
export const OBSIDIAN_RAG_MAX_DOCS = parseIntegerEnv(process.env.OBSIDIAN_RAG_MAX_DOCS, 10);
export const OBSIDIAN_RAG_CACHE_ENABLED = parseBooleanEnv(process.env.OBSIDIAN_RAG_CACHE_ENABLED, true);

// ──── Sprint Pipeline (Autonomous Agent) ────
export const SPRINT_ENABLED = parseBooleanEnv(process.env.SPRINT_ENABLED, false);
export const SPRINT_AUTONOMY_LEVEL = (process.env.SPRINT_AUTONOMY_LEVEL || 'approve-ship') as
  | 'full-auto' | 'approve-ship' | 'approve-impl' | 'manual';
export const SPRINT_MAX_IMPL_REVIEW_LOOPS = parseIntegerEnv(process.env.SPRINT_MAX_IMPL_REVIEW_LOOPS, 3);
export const SPRINT_MAX_TOTAL_PHASES = parseIntegerEnv(process.env.SPRINT_MAX_TOTAL_PHASES, 12);
export const SPRINT_CHANGED_FILE_CAP = parseIntegerEnv(process.env.SPRINT_CHANGED_FILE_CAP, 10);
export const SPRINT_NEW_FILE_CAP = parseIntegerEnv(process.env.SPRINT_NEW_FILE_CAP, 3);
export const SPRINT_PHASE_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_PHASE_TIMEOUT_MS, 120_000);
export const SPRINT_TRIGGER_ERROR_THRESHOLD = parseIntegerEnv(process.env.SPRINT_TRIGGER_ERROR_THRESHOLD, 5);
export const SPRINT_TRIGGER_CS_CHANNEL_IDS = process.env.SPRINT_TRIGGER_CS_CHANNEL_IDS || '';
export const SPRINT_TRIGGER_CRON_SECURITY_AUDIT = process.env.SPRINT_TRIGGER_CRON_SECURITY_AUDIT || '';
export const SPRINT_TRIGGER_CRON_IMPROVEMENT = process.env.SPRINT_TRIGGER_CRON_IMPROVEMENT || '';
export const SPRINT_GIT_ENABLED = parseBooleanEnv(process.env.SPRINT_GIT_ENABLED, false);
export const SPRINT_GITHUB_TOKEN = process.env.SPRINT_GITHUB_TOKEN || '';
export const SPRINT_GITHUB_OWNER = process.env.SPRINT_GITHUB_OWNER || '';
export const SPRINT_GITHUB_REPO = process.env.SPRINT_GITHUB_REPO || '';
export const SPRINT_PIPELINES_TABLE = process.env.SPRINT_PIPELINES_TABLE || 'sprint_pipelines';
export const VENTYD_EVENTS_TABLE = process.env.VENTYD_EVENTS_TABLE || 'ventyd_events';
export const VENTYD_ENABLED = parseBooleanEnv(process.env.VENTYD_ENABLED, true);
export const SPRINT_DRY_RUN = parseBooleanEnv(process.env.SPRINT_DRY_RUN, false);
export const SPRINT_FAST_PATH_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_ENABLED, true);
export const SPRINT_FAST_PATH_VITEST_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_VITEST_TIMEOUT_MS, 60_000);
export const SPRINT_FAST_PATH_TSC_TIMEOUT_MS = parseIntegerEnv(process.env.SPRINT_FAST_PATH_TSC_TIMEOUT_MS, 30_000);
export const SPRINT_FAST_PATH_SANDBOX_ENABLED = parseBooleanEnv(process.env.SPRINT_FAST_PATH_SANDBOX_ENABLED, false);
export const SPRINT_FAST_PATH_SANDBOX_ID = process.env.SPRINT_FAST_PATH_SANDBOX_ID || '';

// ──── Cross-Model Outside Voice ────
export const SPRINT_CROSS_MODEL_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_ENABLED, false);
export const SPRINT_CROSS_MODEL_PROVIDER = process.env.SPRINT_CROSS_MODEL_PROVIDER || '';
export const SPRINT_CROSS_MODEL_PHASES = process.env.SPRINT_CROSS_MODEL_PHASES || 'review,security-audit';
export const SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED = parseBooleanEnv(process.env.SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED, false);

// ──── Scope Guard (freeze/guard) ────
export const SPRINT_SCOPE_GUARD_ENABLED = parseBooleanEnv(process.env.SPRINT_SCOPE_GUARD_ENABLED, true);
export const SPRINT_SCOPE_GUARD_ALLOWED_DIRS = process.env.SPRINT_SCOPE_GUARD_ALLOWED_DIRS || 'src,scripts,tests,.github/skills';
export const SPRINT_SCOPE_GUARD_PROTECTED_FILES = process.env.SPRINT_SCOPE_GUARD_PROTECTED_FILES || 'package.json,.env,ecosystem.config.cjs,render.yaml';

// ──── LLM-as-Judge (Tier 3 eval) ────
export const SPRINT_LLM_JUDGE_ENABLED = parseBooleanEnv(process.env.SPRINT_LLM_JUDGE_ENABLED, false);
export const SPRINT_LLM_JUDGE_PHASES = process.env.SPRINT_LLM_JUDGE_PHASES || 'review,retro';

// ──── Autoplan Sub-Pipeline ────
export const SPRINT_AUTOPLAN_ENABLED = parseBooleanEnv(process.env.SPRINT_AUTOPLAN_ENABLED, false);
export const SPRINT_AUTOPLAN_LENSES = process.env.SPRINT_AUTOPLAN_LENSES || 'ceo,engineering,security';

// ──── Sprint Learning Journal ────
export const SPRINT_LEARNING_JOURNAL_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_ENABLED, true);
export const SPRINT_LEARNING_JOURNAL_GUILD_ID = process.env.SPRINT_LEARNING_JOURNAL_GUILD_ID || 'system';
export const SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW = Math.max(3, parseIntegerEnv(process.env.SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW, 10));
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
export const SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_ENABLED, false);
export const SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE = parseNumberEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_SCORE, 15);
export const SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT = parseIntegerEnv(process.env.SELF_IMPROVEMENT_LACUNA_SPRINT_MIN_COUNT, 3);
export const SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_BUGFIX_TRIGGER_ENABLED, false);
export const SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_BENCH_REGRESSION_ENABLED, false);
export const SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS = parseIntegerEnv(process.env.SELF_IMPROVEMENT_BENCH_REGRESSION_WEEKS, 2);
export const SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_CROSS_LOOP_TRACKING_ENABLED, false);
export const SELF_IMPROVEMENT_CONVERGENCE_ENABLED = parseBooleanEnv(process.env.SELF_IMPROVEMENT_CONVERGENCE_ENABLED, false);

// ──── Observer Layer (Phase F: Autonomous Agent Evolution) ────
export const OBSERVER_ENABLED = parseBooleanEnv(process.env.OBSERVER_ENABLED, false);
export const OBSERVER_SCAN_INTERVAL_MS = Math.max(60_000, parseIntegerEnv(process.env.OBSERVER_SCAN_INTERVAL_MS, 5 * 60_000));
export const OBSERVER_ERROR_PATTERN_ENABLED = parseBooleanEnv(process.env.OBSERVER_ERROR_PATTERN_ENABLED, true);
export const OBSERVER_ERROR_PATTERN_MIN_FREQUENCY = Math.max(1, parseIntegerEnv(process.env.OBSERVER_ERROR_PATTERN_MIN_FREQUENCY, 3));
export const OBSERVER_MEMORY_GAP_ENABLED = parseBooleanEnv(process.env.OBSERVER_MEMORY_GAP_ENABLED, true);
export const OBSERVER_MEMORY_GAP_STALE_HOURS = Math.max(1, parseIntegerEnv(process.env.OBSERVER_MEMORY_GAP_STALE_HOURS, 48));
export const OBSERVER_PERF_DRIFT_ENABLED = parseBooleanEnv(process.env.OBSERVER_PERF_DRIFT_ENABLED, true);
export const OBSERVER_PERF_DRIFT_THRESHOLD_PCT = Math.max(1, parseNumberEnv(process.env.OBSERVER_PERF_DRIFT_THRESHOLD_PCT, 20));
export const OBSERVER_CODE_HEALTH_ENABLED = parseBooleanEnv(process.env.OBSERVER_CODE_HEALTH_ENABLED, false);
export const OBSERVER_CONVERGENCE_DIGEST_ENABLED = parseBooleanEnv(process.env.OBSERVER_CONVERGENCE_DIGEST_ENABLED, true);
export const OBSERVER_DISCORD_PULSE_ENABLED = parseBooleanEnv(process.env.OBSERVER_DISCORD_PULSE_ENABLED, false);



// ──── Traffic Routing (LangGraph Phase 2 Cutover) ────
export const TRAFFIC_ROUTING_ENABLED = parseBooleanEnv(process.env.TRAFFIC_ROUTING_ENABLED, false);
export const TRAFFIC_ROUTING_MODE = (process.env.TRAFFIC_ROUTING_MODE || 'shadow') as 'main' | 'shadow' | 'langgraph';
export const TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD = parseNumberEnv(process.env.TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD, 0.3);
export const TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD = parseNumberEnv(process.env.TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD, -0.2);
export const TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES = parseIntegerEnv(process.env.TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES, 50);
export const TRAFFIC_ROUTING_STATS_WINDOW_HOURS = parseIntegerEnv(process.env.TRAFFIC_ROUTING_STATS_WINDOW_HOURS, 72);

// ──── Supabase Infrastructure (pg_cron, pgvector) ────
export const PG_CRON_BOOTSTRAP_ENABLED = parseBooleanEnv(process.env.PG_CRON_BOOTSTRAP_ENABLED, true);
export const PG_CRON_REPLACES_APP_LOOPS = parseBooleanEnv(process.env.PG_CRON_REPLACES_APP_LOOPS, false);
export const MEMORY_EMBEDDING_ENABLED = parseBooleanEnv(process.env.MEMORY_EMBEDDING_ENABLED, true);

export default {
  PORT,
  FRONTEND_ORIGIN,
  NODE_ENV,
  JSON_BODY_LIMIT,
  PUBLIC_BASE_URL,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  DISCORD_COMMAND_GUILD_ID,
  DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
  START_BOT,
  BOT_START_FAILURE_EXIT_ENABLED,
  JWT_SECRET,
  AUTH_COOKIE_NAME,
  AUTH_CSRF_COOKIE_NAME,
  AUTH_CSRF_HEADER_NAME,
  DEV_AUTH_ENABLED,
  DISCORD_OAUTH_CLIENT_ID,
  DISCORD_OAUTH_CLIENT_SECRET,
  DISCORD_OAUTH_REDIRECT_URI,
  DISCORD_OAUTH_SCOPE,
  DISCORD_OAUTH_API_BASE,
  DISCORD_INVITE_PERMISSIONS,
  DISCORD_INVITE_SCOPES,
  DISCORD_OAUTH_STATE_COOKIE_NAME,
  DISCORD_OAUTH_STATE_TTL_SEC,
  RESEARCH_PRESET_ADMIN_USER_IDS,
  ADMIN_ALLOWLIST_TABLE,
  ADMIN_ALLOWLIST_ROLE_VALUE,
  ADMIN_ALLOWLIST_CACHE_TTL_MS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_TRADES_TABLE,
  LOG_LEVEL,
  BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS,
  OBSIDIAN_HEADLESS_ENABLED,
  OBSIDIAN_EMAIL,
  OBSIDIAN_PASSWORD,
  OBSIDIAN_VAULT_NAME,
  OBSIDIAN_RAG_CACHE_TTL_MS,
  OBSIDIAN_RAG_MAX_DOCS,
  OBSIDIAN_RAG_CACHE_ENABLED,
  SPRINT_ENABLED,
  SPRINT_AUTONOMY_LEVEL,
  SPRINT_MAX_IMPL_REVIEW_LOOPS,
  SPRINT_MAX_TOTAL_PHASES,
  SPRINT_CHANGED_FILE_CAP,
  SPRINT_NEW_FILE_CAP,
  SPRINT_PHASE_TIMEOUT_MS,
  SPRINT_TRIGGER_ERROR_THRESHOLD,
  SPRINT_TRIGGER_CS_CHANNEL_IDS,
  SPRINT_TRIGGER_CRON_SECURITY_AUDIT,
  SPRINT_TRIGGER_CRON_IMPROVEMENT,
  SPRINT_GIT_ENABLED,
  SPRINT_GITHUB_TOKEN,
  SPRINT_GITHUB_OWNER,
  SPRINT_GITHUB_REPO,
  SPRINT_PIPELINES_TABLE,
  SPRINT_FAST_PATH_ENABLED,
  SPRINT_FAST_PATH_VITEST_TIMEOUT_MS,
  SPRINT_FAST_PATH_TSC_TIMEOUT_MS,
  SPRINT_FAST_PATH_SANDBOX_ENABLED,
  SPRINT_FAST_PATH_SANDBOX_ID,
  SPRINT_CROSS_MODEL_ENABLED,
  SPRINT_CROSS_MODEL_PROVIDER,
  SPRINT_CROSS_MODEL_PHASES,
  SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED,
  SPRINT_SCOPE_GUARD_ENABLED,
  SPRINT_SCOPE_GUARD_ALLOWED_DIRS,
  SPRINT_SCOPE_GUARD_PROTECTED_FILES,
  SPRINT_LLM_JUDGE_ENABLED,
  SPRINT_LLM_JUDGE_PHASES,
  SPRINT_AUTOPLAN_ENABLED,
  SPRINT_AUTOPLAN_LENSES,
};

// ──── Namespaced Config Groups ────────────────────────────────────────────────
// These group related config vars for better discoverability.
// Consumers can import { discordConfig } from '../config' instead of 10+ flat vars.
// Flat exports above are preserved for backward compatibility.

export const discordConfig = {
  readyTimeoutMs: DISCORD_READY_TIMEOUT_MS,
  startRetries: DISCORD_START_RETRIES,
  commandGuildId: DISCORD_COMMAND_GUILD_ID,
  messageContentIntentEnabled: DISCORD_MESSAGE_CONTENT_INTENT_ENABLED,
  startBot: START_BOT,
  botStartFailureExitEnabled: BOT_START_FAILURE_EXIT_ENABLED,
  oauth: {
    clientId: DISCORD_OAUTH_CLIENT_ID,
    clientSecret: DISCORD_OAUTH_CLIENT_SECRET,
    redirectUri: DISCORD_OAUTH_REDIRECT_URI,
    scope: DISCORD_OAUTH_SCOPE,
    apiBase: DISCORD_OAUTH_API_BASE,
    stateCookieName: DISCORD_OAUTH_STATE_COOKIE_NAME,
    stateTtlSec: DISCORD_OAUTH_STATE_TTL_SEC,
  },
  invitePermissions: DISCORD_INVITE_PERMISSIONS,
  inviteScopes: DISCORD_INVITE_SCOPES,
} as const;

export const obsidianConfig = {
  headlessEnabled: OBSIDIAN_HEADLESS_ENABLED,
  email: OBSIDIAN_EMAIL,
  password: OBSIDIAN_PASSWORD,
  vaultName: OBSIDIAN_VAULT_NAME,
  ragCacheTtlMs: OBSIDIAN_RAG_CACHE_TTL_MS,
  ragMaxDocs: OBSIDIAN_RAG_MAX_DOCS,
  ragCacheEnabled: OBSIDIAN_RAG_CACHE_ENABLED,
} as const;

export const sprintConfig = {
  enabled: SPRINT_ENABLED,
  autonomyLevel: SPRINT_AUTONOMY_LEVEL,
  maxImplReviewLoops: SPRINT_MAX_IMPL_REVIEW_LOOPS,
  maxTotalPhases: SPRINT_MAX_TOTAL_PHASES,
  changedFileCap: SPRINT_CHANGED_FILE_CAP,
  newFileCap: SPRINT_NEW_FILE_CAP,
  phaseTimeoutMs: SPRINT_PHASE_TIMEOUT_MS,
  dryRun: SPRINT_DRY_RUN,
  pipelinesTable: SPRINT_PIPELINES_TABLE,
  triggers: {
    errorThreshold: SPRINT_TRIGGER_ERROR_THRESHOLD,
    csChannelIds: SPRINT_TRIGGER_CS_CHANNEL_IDS,
    cronSecurityAudit: SPRINT_TRIGGER_CRON_SECURITY_AUDIT,
    cronImprovement: SPRINT_TRIGGER_CRON_IMPROVEMENT,
  },
  git: {
    enabled: SPRINT_GIT_ENABLED,
    token: SPRINT_GITHUB_TOKEN,
    owner: SPRINT_GITHUB_OWNER,
    repo: SPRINT_GITHUB_REPO,
  },
  fastPath: {
    enabled: SPRINT_FAST_PATH_ENABLED,
    vitestTimeoutMs: SPRINT_FAST_PATH_VITEST_TIMEOUT_MS,
    tscTimeoutMs: SPRINT_FAST_PATH_TSC_TIMEOUT_MS,
    sandboxEnabled: SPRINT_FAST_PATH_SANDBOX_ENABLED,
    sandboxId: SPRINT_FAST_PATH_SANDBOX_ID,
  },
  crossModel: {
    enabled: SPRINT_CROSS_MODEL_ENABLED,
    provider: SPRINT_CROSS_MODEL_PROVIDER,
    phases: SPRINT_CROSS_MODEL_PHASES,
    nemoclawEnabled: SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED,
  },
  scopeGuard: {
    enabled: SPRINT_SCOPE_GUARD_ENABLED,
    allowedDirs: SPRINT_SCOPE_GUARD_ALLOWED_DIRS,
    protectedFiles: SPRINT_SCOPE_GUARD_PROTECTED_FILES,
  },
  llmJudge: {
    enabled: SPRINT_LLM_JUDGE_ENABLED,
    phases: SPRINT_LLM_JUDGE_PHASES,
  },
  autoplan: {
    enabled: SPRINT_AUTOPLAN_ENABLED,
    lenses: SPRINT_AUTOPLAN_LENSES,
  },
  trafficRouting: {
    enabled: TRAFFIC_ROUTING_ENABLED,
    mode: TRAFFIC_ROUTING_MODE,
    shadowDivergeThreshold: TRAFFIC_ROUTING_SHADOW_DIVERGE_THRESHOLD,
    qualityDeltaThreshold: TRAFFIC_ROUTING_QUALITY_DELTA_THRESHOLD,
    minShadowSamples: TRAFFIC_ROUTING_MIN_SHADOW_SAMPLES,
    statsWindowHours: TRAFFIC_ROUTING_STATS_WINDOW_HOURS,
  },
  observer: {
    enabled: OBSERVER_ENABLED,
    scanIntervalMs: OBSERVER_SCAN_INTERVAL_MS,
    errorPattern: { enabled: OBSERVER_ERROR_PATTERN_ENABLED, minFrequency: OBSERVER_ERROR_PATTERN_MIN_FREQUENCY },
    memoryGap: { enabled: OBSERVER_MEMORY_GAP_ENABLED, staleHours: OBSERVER_MEMORY_GAP_STALE_HOURS },
    perfDrift: { enabled: OBSERVER_PERF_DRIFT_ENABLED, thresholdPct: OBSERVER_PERF_DRIFT_THRESHOLD_PCT },
    codeHealth: { enabled: OBSERVER_CODE_HEALTH_ENABLED },
    convergenceDigest: { enabled: OBSERVER_CONVERGENCE_DIGEST_ENABLED },
    discordPulse: { enabled: OBSERVER_DISCORD_PULSE_ENABLED },
  },
} as const;

export const authConfig = {
  jwtSecret: JWT_SECRET,
  cookieName: AUTH_COOKIE_NAME,
  csrfCookieName: AUTH_CSRF_COOKIE_NAME,
  csrfHeaderName: AUTH_CSRF_HEADER_NAME,
  devAuthEnabled: DEV_AUTH_ENABLED,
} as const;

export const supabaseConfig = {
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  tradesTable: SUPABASE_TRADES_TABLE,
  adminAllowlistTable: ADMIN_ALLOWLIST_TABLE,
  adminAllowlistRoleValue: ADMIN_ALLOWLIST_ROLE_VALUE,
  adminAllowlistCacheTtlMs: ADMIN_ALLOWLIST_CACHE_TTL_MS,
} as const;

export const memoryConfig = {
  consolidationEnabled: parseBooleanEnv(process.env.MEMORY_CONSOLIDATION_ENABLED, true),
  consolidationIntervalMs: Math.max(60_000, parseIntegerEnv(process.env.MEMORY_CONSOLIDATION_INTERVAL_MS, 6 * 60 * 60_000)),
  consolidationMinGroupSize: Math.max(2, parseIntegerEnv(process.env.MEMORY_CONSOLIDATION_MIN_GROUP_SIZE, 3)),
  consolidationMaxBatch: Math.max(1, parseIntegerEnv(process.env.MEMORY_CONSOLIDATION_MAX_BATCH, 5)),
  consolidationRawAgeHours: Math.max(1, parseIntegerEnv(process.env.MEMORY_CONSOLIDATION_RAW_AGE_HOURS, 6)),
  evolutionEnabled: parseBooleanEnv(process.env.MEMORY_EVOLUTION_ENABLED, true),
  evolutionMaxLinks: Math.max(1, Math.min(10, parseIntegerEnv(process.env.MEMORY_EVOLUTION_MAX_LINKS, 5))),
  evolutionMinSimilarity: Math.max(0, Math.min(1, Number(process.env.MEMORY_EVOLUTION_MIN_SIMILARITY || 0.25))),
  evolutionConfidenceBoost: Math.max(0, Math.min(0.1, Number(process.env.MEMORY_EVOLUTION_CONFIDENCE_BOOST || 0.03))),
  evolutionLlmClassify: parseBooleanEnv(process.env.MEMORY_EVOLUTION_LLM_CLASSIFY, false),
  embeddingEnabled: MEMORY_EMBEDDING_ENABLED,
  userEmbeddingEnabled: parseBooleanEnv(process.env.USER_EMBEDDING_ENABLED, true),
  userEmbeddingRefreshIntervalMs: Math.max(60_000, parseIntegerEnv(process.env.USER_EMBEDDING_REFRESH_INTERVAL_MS, 24 * 60 * 60_000)),
  userEmbeddingMinItems: Math.max(1, parseIntegerEnv(process.env.USER_EMBEDDING_MIN_ITEMS, 3)),
} as const;

export const infraConfig = {
  pgCron: {
    bootstrapEnabled: PG_CRON_BOOTSTRAP_ENABLED,
    replacesAppLoops: PG_CRON_REPLACES_APP_LOOPS,
  },
  embedding: {
    enabled: MEMORY_EMBEDDING_ENABLED,
  },
} as const;
