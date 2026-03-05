export const PORT = parseInt(process.env.PORT || '3000', 10);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';
export const NODE_ENV = process.env.NODE_ENV || 'development';

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
};

export const DISCORD_READY_TIMEOUT_MS = parseInt(process.env.DISCORD_READY_TIMEOUT_MS || '15000', 10);
export const DISCORD_START_RETRIES = parseInt(process.env.DISCORD_START_RETRIES || '3', 10);

export const START_BOT = toBool(process.env.START_BOT, false);
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
