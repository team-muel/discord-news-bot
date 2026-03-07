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
export const AI_TRADING_MODE = process.env.AI_TRADING_MODE || 'auto';
export const AI_TRADING_DRY_RUN = parseBooleanEnv(process.env.AI_TRADING_DRY_RUN, false);
export const AI_TRADING_BASE_URL = process.env.AI_TRADING_BASE_URL || '';
export const AI_TRADING_INTERNAL_TOKEN = process.env.AI_TRADING_INTERNAL_TOKEN || '';
export const AI_TRADING_ORDER_PATH = process.env.AI_TRADING_ORDER_PATH || '/internal/binance/order';
export const AI_TRADING_POSITION_PATH = process.env.AI_TRADING_POSITION_PATH || '/internal/binance/position';
export const AI_TRADING_TIMEOUT_MS = parseIntegerEnv(process.env.AI_TRADING_TIMEOUT_MS, 15000);
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
export const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET || '';
export const BINANCE_FUTURES = parseBooleanEnv(process.env.BINANCE_FUTURES, true);
export const BINANCE_HEDGE_MODE = parseBooleanEnv(process.env.BINANCE_HEDGE_MODE, false);
export const BINANCE_SPOT_MIN_BASE_QTY = Number(process.env.BINANCE_SPOT_MIN_BASE_QTY || 0.000001);

export const START_TRADING_BOT = parseBooleanEnv(process.env.START_TRADING_BOT, false);
export const TRADING_EXCHANGE = process.env.TRADING_EXCHANGE || 'binance';
export const TRADING_SYMBOLS = process.env.TRADING_SYMBOLS || process.env.SYMBOLS || process.env.TRADING_SYMBOL || process.env.SYMBOL || 'BTC/USDT';
export const TRADING_TIMEFRAME = process.env.TRADING_TIMEFRAME || process.env.TIMEFRAME || '30m';
export const TRADING_CVD_LEN = parseIntegerEnv(process.env.TRADING_CVD_LEN || process.env.CVD_LEN, 19);
export const TRADING_DELTA_COEF = Number(process.env.TRADING_DELTA_COEF || process.env.DELTA_COEF || 1.0);
export const TRADING_RISK_PCT = Number(process.env.TRADING_RISK_PCT || process.env.RISK_PCT || 2.0);
export const TRADING_TP_PCT = Number(process.env.TRADING_TP_PCT || process.env.TP_PCT || 4.0);
export const TRADING_SL_PCT = Number(process.env.TRADING_SL_PCT || process.env.SL_PCT || 2.0);
export const TRADING_LEVERAGE = Number(process.env.TRADING_LEVERAGE || process.env.LEVERAGE || 20);
export const TRADING_INITIAL_CAPITAL = Number(process.env.TRADING_INITIAL_CAPITAL || process.env.INITIAL_CAPITAL || 3000);
export const TRADING_EQUITY_SPLIT = parseBooleanEnv(process.env.TRADING_EQUITY_SPLIT ?? process.env.EQUITY_SPLIT, true);
export const TRADING_POLL_SECONDS = parseIntegerEnv(process.env.TRADING_POLL_SECONDS || process.env.POLL_SECONDS, 20);
export const TRADING_CANDLE_LOOKBACK = parseIntegerEnv(process.env.TRADING_CANDLE_LOOKBACK || process.env.CANDLE_LOOKBACK, 400);
export const TRADING_TICK_FETCH_LIMIT = parseIntegerEnv(process.env.TRADING_TICK_FETCH_LIMIT || process.env.TICK_FETCH_LIMIT, 1000);
export const TRADING_TICK_MAX_PAGES = parseIntegerEnv(process.env.TRADING_TICK_MAX_PAGES || process.env.TICK_MAX_PAGES, 3);
export const TRADING_DRY_RUN = parseBooleanEnv(process.env.TRADING_DRY_RUN ?? process.env.DRY_RUN, true);
export const TRADING_CANDLES_TABLE = process.env.TRADING_CANDLES_TABLE || 'candles';
export const TRADING_STATE_TABLE = process.env.TRADING_STATE_TABLE || 'bot_state';

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
  LOG_LEVEL,
  BOT_STATUS_VIEW_BENCHMARK_INTERVAL_MS,
};
