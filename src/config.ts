export const PORT = parseInt(process.env.PORT || '3000', 10);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '';

export const DISCORD_READY_TIMEOUT_MS = parseInt(process.env.DISCORD_READY_TIMEOUT_MS || '15000', 10);
export const DISCORD_START_RETRIES = parseInt(process.env.DISCORD_START_RETRIES || '3', 10);

export const START_BOT = process.env.START_BOT === '1' || process.env.START_BOT === 'true';

export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export default {
  PORT,
  FRONTEND_ORIGIN,
  DISCORD_READY_TIMEOUT_MS,
  DISCORD_START_RETRIES,
  START_BOT,
  LOG_LEVEL,
};
