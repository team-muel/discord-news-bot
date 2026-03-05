export const PORT = parseInt(process.env.PORT || '3000', 10);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';

export const DISCORD_READY_TIMEOUT_MS = parseInt(process.env.DISCORD_READY_TIMEOUT_MS || '15000', 10);
export const DISCORD_START_RETRIES = parseInt(process.env.DISCORD_START_RETRIES || '3', 10);

export const START_BOT = process.env.START_BOT === '1' || process.env.START_BOT === 'true';
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
export const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'muel_session';
export const RESEARCH_PRESET_ADMIN_USER_IDS = process.env.RESEARCH_PRESET_ADMIN_USER_IDS || '';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export default {
  PORT,
  FRONTEND_ORIGIN,
  NODE_ENV,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  START_BOT,
  JWT_SECRET,
  AUTH_COOKIE_NAME,
  RESEARCH_PRESET_ADMIN_USER_IDS,
  LOG_LEVEL,
};
