import { parseBooleanEnv, parseBoundedNumberEnv, parseIntegerEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../utils/env';
import { NODE_ENV, PUBLIC_BASE_URL } from './configCore';

// ──── Discord Bot Lifecycle / Ingress ────
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
export const DISCORD_CHAT_SDK_ENABLED = parseBooleanEnv(process.env.DISCORD_CHAT_SDK_ENABLED, true);
export const DISCORD_APPLICATION_ID = parseStringEnv(
  process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_OAUTH_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID,
  '',
);
export const DISCORD_PUBLIC_KEY = parseStringEnv(process.env.DISCORD_PUBLIC_KEY, '');
export const DISCORD_DOCS_INGRESS_ADAPTER = parseStringEnv(process.env.DISCORD_DOCS_INGRESS_ADAPTER, 'chat-sdk');
export const DISCORD_DOCS_INGRESS_HARD_DISABLE = parseBooleanEnv(process.env.DISCORD_DOCS_INGRESS_HARD_DISABLE, false);
export const DISCORD_DOCS_INGRESS_SHADOW_MODE = parseBooleanEnv(process.env.DISCORD_DOCS_INGRESS_SHADOW_MODE, false);
export const DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT = parseBoundedNumberEnv(
  process.env.DISCORD_DOCS_INGRESS_ROLLOUT_PERCENT,
  100,
  0,
  100,
);
export const DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER = parseStringEnv(process.env.DISCORD_MUEL_MESSAGE_INGRESS_ADAPTER, 'chat-sdk');
export const DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE = parseBooleanEnv(process.env.DISCORD_MUEL_MESSAGE_INGRESS_HARD_DISABLE, false);
export const DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE = parseBooleanEnv(process.env.DISCORD_MUEL_MESSAGE_INGRESS_SHADOW_MODE, false);
export const DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT = parseBoundedNumberEnv(
  process.env.DISCORD_MUEL_MESSAGE_INGRESS_ROLLOUT_PERCENT,
  100,
  0,
  100,
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
export const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = parseIntegerEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000);

// ──── Discord OAuth / Invite ────
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

// ──── Discord / Community Voice ────
export const OBSERVER_DISCORD_PULSE_ENABLED = parseBooleanEnv(process.env.OBSERVER_DISCORD_PULSE_ENABLED, true);
export const COMMUNITY_VOICE_ENABLED = parseBooleanEnv(process.env.COMMUNITY_VOICE_ENABLED, true);
export const COMMUNITY_VOICE_CHANNEL_ID = parseStringEnv(process.env.COMMUNITY_VOICE_CHANNEL_ID, '');
export const COMMUNITY_VOICE_COOLDOWN_MS = parseMinIntEnv(process.env.COMMUNITY_VOICE_COOLDOWN_MS, 10 * 60_000, 60_000);
export const COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES = parseMinIntEnv(process.env.COMMUNITY_VOICE_UNANSWERED_THRESHOLD_MINUTES, 120, 10);

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