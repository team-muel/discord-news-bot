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
// Single-service deployment default: execute via in-process/local trading path.
export const AI_TRADING_MODE = process.env.AI_TRADING_MODE || 'local';
export const AI_TRADING_DRY_RUN = parseBooleanEnv(process.env.AI_TRADING_DRY_RUN, false);
export const AI_TRADING_BASE_URL = process.env.AI_TRADING_BASE_URL || '';
export const AI_TRADING_INTERNAL_TOKEN = process.env.AI_TRADING_INTERNAL_TOKEN || '';
export const AI_TRADING_ORDER_PATH = process.env.AI_TRADING_ORDER_PATH || '/internal/binance/order';
export const AI_TRADING_POSITION_PATH = process.env.AI_TRADING_POSITION_PATH || '/internal/binance/position';
export const AI_TRADING_TIMEOUT_MS = parseIntegerEnv(process.env.AI_TRADING_TIMEOUT_MS, 15000);
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
export const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET || process.env.BINANCE_SECRET_KEY || process.env.BINANCE_SECRET || '';
export const BINANCE_FUTURES = parseBooleanEnv(process.env.BINANCE_FUTURES, true);
export const BINANCE_HEDGE_MODE = parseBooleanEnv(process.env.BINANCE_HEDGE_MODE, false);
export const BINANCE_SPOT_MIN_BASE_QTY = parseNumberEnv(process.env.BINANCE_SPOT_MIN_BASE_QTY, 0.000001);

export const START_TRADING_BOT = parseBooleanEnv(process.env.START_TRADING_BOT, false);
export const TRADING_EXCHANGE = process.env.TRADING_EXCHANGE || 'binance';
export const TRADING_SYMBOLS = process.env.TRADING_SYMBOLS || process.env.SYMBOLS || process.env.TRADING_SYMBOL || process.env.SYMBOL || 'BTC/USDT';
export const TRADING_TIMEFRAME = process.env.TRADING_TIMEFRAME || process.env.TIMEFRAME || '30m';
export const TRADING_CVD_LEN = parseIntegerEnv(process.env.TRADING_CVD_LEN || process.env.CVD_LEN, 19);
export const TRADING_DELTA_COEF = parseNumberEnv(process.env.TRADING_DELTA_COEF || process.env.DELTA_COEF, 1.0);
export const TRADING_RISK_PCT = parseNumberEnv(process.env.TRADING_RISK_PCT || process.env.RISK_PCT, 2.0);
export const TRADING_TP_PCT = parseNumberEnv(process.env.TRADING_TP_PCT || process.env.TP_PCT, 4.0);
export const TRADING_SL_PCT = parseNumberEnv(process.env.TRADING_SL_PCT || process.env.SL_PCT, 2.0);
export const TRADING_LEVERAGE = parseNumberEnv(process.env.TRADING_LEVERAGE || process.env.LEVERAGE, 20);
export const TRADING_INITIAL_CAPITAL = parseNumberEnv(process.env.TRADING_INITIAL_CAPITAL || process.env.INITIAL_CAPITAL, 3000);
export const TRADING_EQUITY_SPLIT = parseBooleanEnv(process.env.TRADING_EQUITY_SPLIT ?? process.env.EQUITY_SPLIT, true);
export const TRADING_POLL_SECONDS = parseIntegerEnv(process.env.TRADING_POLL_SECONDS || process.env.POLL_SECONDS, 20);
export const TRADING_CANDLE_LOOKBACK = parseIntegerEnv(process.env.TRADING_CANDLE_LOOKBACK || process.env.CANDLE_LOOKBACK, 400);
export const TRADING_TICK_FETCH_LIMIT = parseIntegerEnv(process.env.TRADING_TICK_FETCH_LIMIT || process.env.TICK_FETCH_LIMIT, 1000);
export const TRADING_TICK_MAX_PAGES = parseIntegerEnv(process.env.TRADING_TICK_MAX_PAGES || process.env.TICK_MAX_PAGES, 3);
export const TRADING_DRY_RUN = parseBooleanEnv(process.env.TRADING_DRY_RUN ?? process.env.DRY_RUN, true);
export const TRADING_CANDLES_TABLE = process.env.TRADING_CANDLES_TABLE || 'candles';
export const TRADING_STATE_TABLE = process.env.TRADING_STATE_TABLE || 'bot_state';
export const MAX_MANUAL_TRADE_QTY = parsePositiveNumberEnv(process.env.MAX_MANUAL_TRADE_QTY, 10_000);
export const MAX_MANUAL_TRADE_LEVERAGE = parsePositiveNumberEnv(process.env.MAX_MANUAL_TRADE_LEVERAGE, 125);
export const MAX_MANUAL_TRADE_ENTRY_PRICE = parsePositiveNumberEnv(process.env.MAX_MANUAL_TRADE_ENTRY_PRICE, 10_000_000);

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
  AI_TRADING_MODE,
  AI_TRADING_DRY_RUN,
  AI_TRADING_BASE_URL,
  AI_TRADING_INTERNAL_TOKEN,
  AI_TRADING_ORDER_PATH,
  AI_TRADING_POSITION_PATH,
  AI_TRADING_TIMEOUT_MS,
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_FUTURES,
  BINANCE_HEDGE_MODE,
  BINANCE_SPOT_MIN_BASE_QTY,
  START_TRADING_BOT,
  TRADING_EXCHANGE,
  TRADING_SYMBOLS,
  TRADING_TIMEFRAME,
  TRADING_CVD_LEN,
  TRADING_DELTA_COEF,
  TRADING_RISK_PCT,
  TRADING_TP_PCT,
  TRADING_SL_PCT,
  TRADING_LEVERAGE,
  TRADING_INITIAL_CAPITAL,
  TRADING_EQUITY_SPLIT,
  TRADING_POLL_SECONDS,
  TRADING_CANDLE_LOOKBACK,
  TRADING_TICK_FETCH_LIMIT,
  TRADING_TICK_MAX_PAGES,
  TRADING_DRY_RUN,
  TRADING_CANDLES_TABLE,
  TRADING_STATE_TABLE,
  MAX_MANUAL_TRADE_QTY,
  MAX_MANUAL_TRADE_LEVERAGE,
  MAX_MANUAL_TRADE_ENTRY_PRICE,
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

export const tradingConfig = {
  mode: AI_TRADING_MODE,
  dryRun: AI_TRADING_DRY_RUN,
  baseUrl: AI_TRADING_BASE_URL,
  internalToken: AI_TRADING_INTERNAL_TOKEN,
  orderPath: AI_TRADING_ORDER_PATH,
  positionPath: AI_TRADING_POSITION_PATH,
  timeoutMs: AI_TRADING_TIMEOUT_MS,
  exchange: TRADING_EXCHANGE,
  symbols: TRADING_SYMBOLS,
  timeframe: TRADING_TIMEFRAME,
  cvdLen: TRADING_CVD_LEN,
  deltaCoef: TRADING_DELTA_COEF,
  riskPct: TRADING_RISK_PCT,
  tpPct: TRADING_TP_PCT,
  slPct: TRADING_SL_PCT,
  leverage: TRADING_LEVERAGE,
  initialCapital: TRADING_INITIAL_CAPITAL,
  equitySplit: TRADING_EQUITY_SPLIT,
  pollSeconds: TRADING_POLL_SECONDS,
  candleLookback: TRADING_CANDLE_LOOKBACK,
  tickFetchLimit: TRADING_TICK_FETCH_LIMIT,
  tickMaxPages: TRADING_TICK_MAX_PAGES,
  tradingDryRun: TRADING_DRY_RUN,
  candlesTable: TRADING_CANDLES_TABLE,
  stateTable: TRADING_STATE_TABLE,
  startTradingBot: START_TRADING_BOT,
  binance: {
    apiKey: BINANCE_API_KEY,
    apiSecret: BINANCE_API_SECRET,
    futures: BINANCE_FUTURES,
    hedgeMode: BINANCE_HEDGE_MODE,
    spotMinBaseQty: BINANCE_SPOT_MIN_BASE_QTY,
  },
  limits: {
    maxManualTradeQty: MAX_MANUAL_TRADE_QTY,
    maxManualTradeLeverage: MAX_MANUAL_TRADE_LEVERAGE,
    maxManualTradeEntryPrice: MAX_MANUAL_TRADE_ENTRY_PRICE,
  },
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
