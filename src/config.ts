import { parseBooleanEnv, parseIntegerEnv } from './utils/env';

export const PORT = parseIntegerEnv(process.env.PORT, 3000);
export const FRONTEND_ORIGIN = process.env.CORS_ALLOWLIST || process.env.FRONTEND_ORIGIN || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';

export const DISCORD_READY_TIMEOUT_MS = parseIntegerEnv(
  process.env.DISCORD_READY_TIMEOUT_MS || process.env.DISCORD_LOGIN_TIMEOUT_MS,
  15000,
);
export const DISCORD_START_RETRIES = parseIntegerEnv(process.env.DISCORD_START_RETRIES, 3);
export const DISCORD_COMMAND_GUILD_ID = process.env.DISCORD_COMMAND_GUILD_ID || '';

export const START_BOT = parseBooleanEnv(process.env.START_BOT, false);
export const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-jwt-secret-change-in-production';
export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'muel_session';
export const RESEARCH_PRESET_ADMIN_USER_IDS = process.env.RESEARCH_PRESET_ADMIN_USER_IDS || '';
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
export const SUPABASE_TRADES_TABLE = process.env.SUPABASE_TRADES_TABLE || 'trades';
export const AI_TRADING_BASE_URL = process.env.AI_TRADING_BASE_URL || '';
export const AI_TRADING_INTERNAL_TOKEN = process.env.AI_TRADING_INTERNAL_TOKEN || '';
export const AI_TRADING_ORDER_PATH = process.env.AI_TRADING_ORDER_PATH || '/internal/binance/order';
export const AI_TRADING_POSITION_PATH = process.env.AI_TRADING_POSITION_PATH || '/internal/binance/position';
export const AI_TRADING_TIMEOUT_MS = parseIntegerEnv(process.env.AI_TRADING_TIMEOUT_MS, 15000);

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = parseIntegerEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000);

export default {
  PORT,
  FRONTEND_ORIGIN,
  NODE_ENV,
  JSON_BODY_LIMIT,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  DISCORD_COMMAND_GUILD_ID,
  START_BOT,
  JWT_SECRET,
  AUTH_COOKIE_NAME,
  RESEARCH_PRESET_ADMIN_USER_IDS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_TRADES_TABLE,
  AI_TRADING_BASE_URL,
  AI_TRADING_INTERNAL_TOKEN,
  AI_TRADING_ORDER_PATH,
  AI_TRADING_POSITION_PATH,
  AI_TRADING_TIMEOUT_MS,
  LOG_LEVEL,
  BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS,
};
