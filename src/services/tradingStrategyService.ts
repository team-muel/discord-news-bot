import {
  TRADING_CANDLE_LOOKBACK,
  TRADING_CVD_LEN,
  TRADING_DELTA_COEF,
  TRADING_DRY_RUN,
  TRADING_EQUITY_SPLIT,
  TRADING_INITIAL_CAPITAL,
  TRADING_LEVERAGE,
  TRADING_POLL_SECONDS,
  TRADING_RISK_PCT,
  TRADING_SL_PCT,
  TRADING_SYMBOLS,
  TRADING_TICK_FETCH_LIMIT,
  TRADING_TICK_MAX_PAGES,
  TRADING_TIMEFRAME,
  TRADING_TP_PCT,
} from '../config';
import type { TradingStrategyConfig, TradingStrategyConfigPatch, TradingSignalMode } from '../contracts/tradingStrategy';
import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const CONFIG_TABLE = 'trading_engine_configs';
const CONFIG_ID = 'default';
const CACHE_TTL_MS = 5_000;

let cachedConfig: TradingStrategyConfig | null = null;
let cachedAtMs = 0;

const parseSymbols = (raw: string): string[] => {
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length ? parsed : ['BTC/USDT'];
};

const toPositiveNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return fallback;
};

const toSignalMode = (value: unknown, fallback: TradingSignalMode): TradingSignalMode => {
  return value === 'price_sma_cross' || value === 'cvd_sma_cross' ? value : fallback;
};

export function getDefaultTradingStrategyConfig(): TradingStrategyConfig {
  return {
    enabled: true,
    symbols: parseSymbols(TRADING_SYMBOLS),
    timeframe: TRADING_TIMEFRAME,
    signal: {
      mode: 'cvd_sma_cross',
      cvdLen: TRADING_CVD_LEN,
      deltaCoef: TRADING_DELTA_COEF,
      priceSmaLen: 20,
      allowLong: true,
      allowShort: true,
    },
    risk: {
      initialCapital: TRADING_INITIAL_CAPITAL,
      equitySplit: TRADING_EQUITY_SPLIT,
      riskPct: TRADING_RISK_PCT,
      leverage: TRADING_LEVERAGE,
      maxQty: 1_000_000,
    },
    exit: {
      tpPct: TRADING_TP_PCT,
      slPct: TRADING_SL_PCT,
      enableTp: true,
      enableSl: true,
    },
    runtime: {
      dryRun: TRADING_DRY_RUN,
      pollSeconds: TRADING_POLL_SECONDS,
      candleLookback: TRADING_CANDLE_LOOKBACK,
      tickFetchLimit: TRADING_TICK_FETCH_LIMIT,
      tickMaxPages: TRADING_TICK_MAX_PAGES,
    },
  };
}

export function normalizeTradingStrategyConfig(input: unknown, base?: TradingStrategyConfig): TradingStrategyConfig {
  const defaults = base || getDefaultTradingStrategyConfig();
  const row = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  const signalRaw = (row.signal && typeof row.signal === 'object' ? row.signal : {}) as Record<string, unknown>;
  const riskRaw = (row.risk && typeof row.risk === 'object' ? row.risk : {}) as Record<string, unknown>;
  const exitRaw = (row.exit && typeof row.exit === 'object' ? row.exit : {}) as Record<string, unknown>;
  const runtimeRaw = (row.runtime && typeof row.runtime === 'object' ? row.runtime : {}) as Record<string, unknown>;

  const symbols = Array.isArray(row.symbols)
    ? row.symbols.map((v) => String(v || '').trim()).filter(Boolean)
    : defaults.symbols;

  const timeframe = typeof row.timeframe === 'string' && row.timeframe.trim() ? row.timeframe.trim() : defaults.timeframe;

  return {
    enabled: toBoolean(row.enabled, defaults.enabled),
    symbols: symbols.length ? symbols : defaults.symbols,
    timeframe,
    signal: {
      mode: toSignalMode(signalRaw.mode, defaults.signal.mode),
      cvdLen: toPositiveInt(signalRaw.cvdLen, defaults.signal.cvdLen),
      deltaCoef: toPositiveNumber(signalRaw.deltaCoef, defaults.signal.deltaCoef),
      priceSmaLen: toPositiveInt(signalRaw.priceSmaLen, defaults.signal.priceSmaLen),
      allowLong: toBoolean(signalRaw.allowLong, defaults.signal.allowLong),
      allowShort: toBoolean(signalRaw.allowShort, defaults.signal.allowShort),
    },
    risk: {
      initialCapital: toPositiveNumber(riskRaw.initialCapital, defaults.risk.initialCapital),
      equitySplit: toBoolean(riskRaw.equitySplit, defaults.risk.equitySplit),
      riskPct: toPositiveNumber(riskRaw.riskPct, defaults.risk.riskPct),
      leverage: toPositiveNumber(riskRaw.leverage, defaults.risk.leverage),
      maxQty: toPositiveNumber(riskRaw.maxQty, defaults.risk.maxQty),
    },
    exit: {
      tpPct: toPositiveNumber(exitRaw.tpPct, defaults.exit.tpPct),
      slPct: toPositiveNumber(exitRaw.slPct, defaults.exit.slPct),
      enableTp: toBoolean(exitRaw.enableTp, defaults.exit.enableTp),
      enableSl: toBoolean(exitRaw.enableSl, defaults.exit.enableSl),
    },
    runtime: {
      dryRun: toBoolean(runtimeRaw.dryRun, defaults.runtime.dryRun),
      pollSeconds: toPositiveInt(runtimeRaw.pollSeconds, defaults.runtime.pollSeconds),
      candleLookback: toPositiveInt(runtimeRaw.candleLookback, defaults.runtime.candleLookback),
      tickFetchLimit: toPositiveInt(runtimeRaw.tickFetchLimit, defaults.runtime.tickFetchLimit),
      tickMaxPages: toPositiveInt(runtimeRaw.tickMaxPages, defaults.runtime.tickMaxPages),
    },
  };
}

function deepMerge(base: TradingStrategyConfig, patch: TradingStrategyConfigPatch): TradingStrategyConfig {
  return normalizeTradingStrategyConfig(
    {
      ...base,
      ...patch,
      signal: { ...base.signal, ...(patch.signal || {}) },
      risk: { ...base.risk, ...(patch.risk || {}) },
      exit: { ...base.exit, ...(patch.exit || {}) },
      runtime: { ...base.runtime, ...(patch.runtime || {}) },
    },
    base,
  );
}

export async function getTradingStrategyConfig(forceRefresh = false): Promise<TradingStrategyConfig> {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && now - cachedAtMs < CACHE_TTL_MS) {
    return normalizeTradingStrategyConfig(cachedConfig);
  }

  const defaults = getDefaultTradingStrategyConfig();
  if (!isSupabaseConfigured()) {
    cachedConfig = defaults;
    cachedAtMs = now;
    return defaults;
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(CONFIG_TABLE)
      .select('config')
      .eq('id', CONFIG_ID)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const normalized = normalizeTradingStrategyConfig(data?.config, defaults);
    cachedConfig = normalized;
    cachedAtMs = now;
    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[TRADING] Failed to load strategy config from %s: %s', CONFIG_TABLE, message);
    cachedConfig = defaults;
    cachedAtMs = now;
    return defaults;
  }
}

export async function updateTradingStrategyConfig(patch: TradingStrategyConfigPatch): Promise<TradingStrategyConfig> {
  const current = await getTradingStrategyConfig(true);
  const next = deepMerge(current, patch);

  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    const { error } = await client.from(CONFIG_TABLE).upsert(
      {
        id: CONFIG_ID,
        config: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw error;
    }
  }

  cachedConfig = next;
  cachedAtMs = Date.now();
  return next;
}

export async function resetTradingStrategyConfig(): Promise<TradingStrategyConfig> {
  const defaults = getDefaultTradingStrategyConfig();

  if (isSupabaseConfigured()) {
    const client = getSupabaseClient();
    const { error } = await client.from(CONFIG_TABLE).upsert(
      {
        id: CONFIG_ID,
        config: defaults,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw error;
    }
  }

  cachedConfig = defaults;
  cachedAtMs = Date.now();
  return defaults;
}
