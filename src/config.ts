import { parseBooleanEnv, parseIntegerEnv } from './utils/env';

export const PORT = parseIntegerEnv(process.env.PORT, 3000);
export const FRONTEND_ORIGIN = process.env.CORS_ALLOWLIST || process.env.FRONTEND_ORIGIN || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';

export const DISCORD_READY_TIMEOUT_MS = parseIntegerEnv(process.env.DISCORD_READY_TIMEOUT_MS, 15000);
export const DISCORD_START_RETRIES = parseIntegerEnv(process.env.DISCORD_START_RETRIES, 3);

export const START_BOT = parseBooleanEnv(process.env.START_BOT, false);
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'muel_session';
export const RESEARCH_PRESET_ADMIN_USER_IDS = process.env.RESEARCH_PRESET_ADMIN_USER_IDS || '';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS = parseIntegerEnv(process.env.BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS, 60000);

export default {
  PORT,
  FRONTEND_ORIGIN,
  NODE_ENV,
  JSON_BODY_LIMIT,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  START_BOT,
  JWT_SECRET,
  AUTH_COOKIE_NAME,
  RESEARCH_PRESET_ADMIN_USER_IDS,
  LOG_LEVEL,
  BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS,
};
