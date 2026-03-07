import logger from '../logger';
import type { TradeSide } from '../contracts/trade';
import {
  BINANCE_FUTURES,
  START_TRADING_BOT,
  TRADING_CANDLE_LOOKBACK,
  TRADING_CANDLES_TABLE,
  TRADING_CVD_LEN,
  TRADING_DELTA_COEF,
  TRADING_DRY_RUN,
  TRADING_EQUITY_SPLIT,
  TRADING_EXCHANGE,
  TRADING_INITIAL_CAPITAL,
  TRADING_LEVERAGE,
  TRADING_POLL_SECONDS,
  TRADING_RISK_PCT,
  TRADING_SL_PCT,
  TRADING_STATE_TABLE,
  TRADING_SYMBOLS,
  TRADING_TICK_FETCH_LIMIT,
  TRADING_TICK_MAX_PAGES,
  TRADING_TIMEFRAME,
  TRADING_TP_PCT,
} from '../config';
import { createTrade } from './tradesStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { buildBinanceClient, executeLocalAiTradingOrder, getLocalAiTradingPosition, isLocalAiTradingConfigured, toBinanceSymbol } from './localAiTradingClient';

type Candle = {
  ts: string;
  open: number;
  close: number;
  volume: number;
};

type Tick = {
  tradeId?: string;
  tsMs: number;
  price: number;
  amount: number;
};

type TickBar = {
  startMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SymbolRuntimeState = {
  cvdClosed: number[];
  cvdAccClosed: number;
  currentBar: TickBar | null;
  lastProcessedTradeMs: number;
  lastSignalKey?: string;
};

type TradingRuntimeSnapshot = {
  started: boolean;
  startedAt: string | null;
  symbols: string[];
  timeframe: string;
  dryRun: boolean;
  lastLoopAt: string | null;
  lastLoopError: string | null;
};

const runtime = new Map<string, SymbolRuntimeState>();
const fallbackStateStore = new Map<string, string>();

let started = false;
let startedAt: string | null = null;
let lastLoopAt: string | null = null;
let lastLoopError: string | null = null;
let stateTableAvailable: boolean | null = null;

function parseSymbols(raw: string): string[] {
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return parsed.length ? parsed : ['BTC/USDT'];
}

function computeDelta(c: Candle, deltaCoef: number) {
  return (c.close - c.open) * c.volume * deltaCoef;
}

function computeCvdSeries(candles: Candle[], deltaCoef: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of candles) {
    acc += computeDelta(c, deltaCoef);
    out.push(acc);
  }
  return out;
}

function sma(series: number[], len: number): number[] {
  const out: number[] = new Array(series.length).fill(Number.NaN);
  let sum = 0;

  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= len) sum -= series[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }

  return out;
}

function crossedOver(prevA: number, prevB: number, curA: number, curB: number): boolean {
  return prevA <= prevB && curA > curB;
}

function crossedUnder(prevA: number, prevB: number, curA: number, curB: number): boolean {
  return prevA >= prevB && curA < curB;
}

function timeframeToMs(tf: string): number {
  const m = tf.match(/^(\d+)([mhdw])$/i);
  if (!m) throw new Error(`Unsupported timeframe: ${tf}`);

  const n = Number(m[1]);
  const u = m[2].toLowerCase();

  const unitMs =
    u === 'm'
      ? 60_000
      : u === 'h'
        ? 3_600_000
        : u === 'd'
          ? 86_400_000
          : u === 'w'
            ? 604_800_000
            : 0;

  return n * unitMs;
}

function floorToTf(ms: number, tfMs: number): number {
  return Math.floor(ms / tfMs) * tfMs;
}

function sizeByExposure(params: { equity: number; riskPct: number; leverage: number; price: number }) {
  const exposure = params.equity * (params.riskPct / 100) * params.leverage;
  return { qty: exposure / params.price, exposure };
}

function stateKey(symbol: string): string {
  return [TRADING_EXCHANGE, symbol, TRADING_TIMEFRAME].join('|');
}

async function fetchRecentCandles(symbol: string, limit: number): Promise<Candle[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(TRADING_CANDLES_TABLE)
    .select('ts, open, close, volume')
    .eq('exchange', TRADING_EXCHANGE)
    .eq('symbol', symbol)
    .eq('timeframe', TRADING_TIMEFRAME)
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const rows = [...(data ?? [])].reverse();
  return rows.map((row) => ({
    ts: String((row as any).ts),
    open: Number((row as any).open),
    close: Number((row as any).close),
    volume: Number((row as any).volume),
  }));
}

async function getLastProcessedTs(symbol: string): Promise<string | undefined> {
  const key = stateKey(symbol);

  if (!isSupabaseConfigured() || stateTableAvailable === false) {
    return fallbackStateStore.get(key);
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(TRADING_STATE_TABLE)
      .select('last_ts')
      .eq('exchange', TRADING_EXCHANGE)
      .eq('symbol', symbol)
      .eq('timeframe', TRADING_TIMEFRAME)
      .limit(1);

    if (error) {
      throw error;
    }

    stateTableAvailable = true;
    return (data?.[0]?.last_ts as string | undefined) ?? fallbackStateStore.get(key);
  } catch (error) {
    stateTableAvailable = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[TRADING] Falling back to in-memory state store: %s', message);
    return fallbackStateStore.get(key);
  }
}

async function setLastProcessedTs(symbol: string, ts: string): Promise<void> {
  const key = stateKey(symbol);
  fallbackStateStore.set(key, ts);

  if (!isSupabaseConfigured() || stateTableAvailable === false) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.from(TRADING_STATE_TABLE).upsert(
      {
        exchange: TRADING_EXCHANGE,
        symbol,
        timeframe: TRADING_TIMEFRAME,
        last_ts: ts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'exchange,symbol,timeframe' },
    );

    if (error) {
      throw error;
    }

    stateTableAvailable = true;
  } catch (error) {
    stateTableAvailable = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[TRADING] Failed to persist bot state, using in-memory fallback: %s', message);
  }
}

async function fetchTradesSince(params: {
  symbol: string;
  sinceMs: number;
  limit: number;
  maxPages: number;
}): Promise<Tick[]> {
  const ex: any = await buildBinanceClient();
  const apiSymbol = toBinanceSymbol(params.symbol, BINANCE_FUTURES);

  let since = params.sinceMs;
  let lastTradeId: number | null = null;
  let pages = 0;
  const all: Tick[] = [];
  const dedup = new Map<string, Tick>();

  while (pages < params.maxPages) {
    pages += 1;

    const fetchParams: Record<string, string> | undefined =
      lastTradeId !== null ? { fromId: String(lastTradeId + 1) } : undefined;

    const rows: any[] = await ex.fetchTrades(apiSymbol, Math.max(0, since - 1000), params.limit, fetchParams);
    if (!rows.length) break;

    for (const row of rows) {
      const tradeIdRaw: unknown = row?.id;
      const tradeId = tradeIdRaw == null ? undefined : String(tradeIdRaw);
      const tsMs = Number(row?.timestamp ?? 0);
      const price = Number(row?.price);
      const amount = Number(row?.amount ?? 0);

      if (!Number.isFinite(tsMs) || !Number.isFinite(price) || !Number.isFinite(amount)) continue;
      if (tsMs < since) continue;

      const key = tradeId ?? `${tsMs}:${price}:${amount}`;
      if (!dedup.has(key)) {
        const tick = { tradeId, tsMs, price, amount };
        dedup.set(key, tick);
        all.push(tick);
      }

      if (tradeId) {
        const n = Number(tradeId);
        if (Number.isFinite(n)) {
          lastTradeId = lastTradeId === null ? n : Math.max(lastTradeId, n);
        }
      }
    }

    const lastTs = Number(rows[rows.length - 1]?.timestamp ?? 0);
    if (!Number.isFinite(lastTs) || lastTs <= 0) break;

    since = lastTs + 1;
    if (rows.length < params.limit) break;
  }

  all.sort((a, b) => a.tsMs - b.tsMs);
  return all;
}

function finalizeCurrentBar(state: SymbolRuntimeState): void {
  if (!state.currentBar) return;

  const delta =
    (state.currentBar.close - state.currentBar.open) * state.currentBar.volume * TRADING_DELTA_COEF;

  state.cvdAccClosed += delta;
  state.cvdClosed.push(state.cvdAccClosed);

  if (state.cvdClosed.length > TRADING_CANDLE_LOOKBACK) {
    state.cvdClosed.splice(0, state.cvdClosed.length - TRADING_CANDLE_LOOKBACK);
  }
}

function newBarFromTick(tsMs: number, price: number, amount: number, tfMs: number): TickBar {
  return {
    startMs: floorToTf(tsMs, tfMs),
    open: price,
    high: price,
    low: price,
    close: price,
    volume: amount,
  };
}

function buildSignalFromState(state: SymbolRuntimeState) {
  if (!state.currentBar) return { longCond: false, shortCond: false };

  const curDelta =
    (state.currentBar.close - state.currentBar.open) * state.currentBar.volume * TRADING_DELTA_COEF;
  const curCvd = state.cvdAccClosed + curDelta;

  const series = [...state.cvdClosed, curCvd];
  if (series.length < TRADING_CVD_LEN + 2) return { longCond: false, shortCond: false };

  const ma = sma(series, TRADING_CVD_LEN);
  const i = series.length - 1;
  const prev = i - 1;
  if (!Number.isFinite(ma[prev]) || !Number.isFinite(ma[i])) {
    return { longCond: false, shortCond: false };
  }

  return {
    longCond: crossedOver(series[prev], ma[prev], series[i], ma[i]),
    shortCond: crossedUnder(series[prev], ma[prev], series[i], ma[i]),
  };
}

async function hasOpenPosition(symbol: string): Promise<boolean> {
  const position = await getLocalAiTradingPosition(symbol);
  return Boolean(position.open);
}

async function getOrInitState(symbol: string, tfMs: number): Promise<SymbolRuntimeState | null> {
  const existing = runtime.get(symbol);
  if (existing) return existing;

  const candles = await fetchRecentCandles(symbol, TRADING_CANDLE_LOOKBACK);
  if (candles.length < TRADING_CVD_LEN + 2) {
    return null;
  }

  const cvdClosed = computeCvdSeries(candles, TRADING_DELTA_COEF);
  const cvdAccClosed = cvdClosed[cvdClosed.length - 1] ?? 0;

  const lastTs = await getLastProcessedTs(symbol);
  const savedMs = lastTs ? Date.parse(lastTs) : Number.NaN;
  const nowBarStart = floorToTf(Date.now(), tfMs);
  const lastProcessedTradeMs = Number.isFinite(savedMs) ? Math.max(savedMs, nowBarStart - 1) : nowBarStart - 1;

  const state: SymbolRuntimeState = {
    cvdClosed,
    cvdAccClosed,
    currentBar: null,
    lastProcessedTradeMs,
  };

  runtime.set(symbol, state);
  return state;
}

async function insertTradeRecord(params: {
  symbol: string;
  side: TradeSide;
  entryTs: string;
  entryPrice: number;
  qty: number;
  tpPrice: number;
  slPrice: number;
  status: 'open' | 'error';
  orderIds?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  await createTrade({
    exchange: TRADING_EXCHANGE,
    symbol: params.symbol,
    timeframe: TRADING_TIMEFRAME,
    side: params.side,
    entryTs: params.entryTs,
    entryPrice: params.entryPrice,
    qty: params.qty,
    tpPrice: params.tpPrice,
    slPrice: params.slPrice,
    status: params.status,
    exchangeOrderIds: params.orderIds,
    meta: params.meta,
  });
}

async function runSymbolOnce(symbol: string, tfMs: number): Promise<void> {
  const state = await getOrInitState(symbol, tfMs);
  if (!state) return;

  const ticks = await fetchTradesSince({
    symbol,
    sinceMs: state.lastProcessedTradeMs + 1,
    limit: TRADING_TICK_FETCH_LIMIT,
    maxPages: TRADING_TICK_MAX_PAGES,
  });

  if (!ticks.length) return;

  let openPos = await hasOpenPosition(symbol);

  for (const tick of ticks) {
    if (!state.currentBar) {
      state.currentBar = newBarFromTick(tick.tsMs, tick.price, tick.amount, tfMs);
    } else {
      const startMs = floorToTf(tick.tsMs, tfMs);
      if (startMs !== state.currentBar.startMs) {
        finalizeCurrentBar(state);
        state.currentBar = newBarFromTick(tick.tsMs, tick.price, tick.amount, tfMs);
        state.lastSignalKey = undefined;
      } else {
        state.currentBar.high = Math.max(state.currentBar.high, tick.price);
        state.currentBar.low = Math.min(state.currentBar.low, tick.price);
        state.currentBar.close = tick.price;
        state.currentBar.volume += tick.amount;
      }
    }

    const { longCond, shortCond } = buildSignalFromState(state);
    if (!longCond && !shortCond) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }

    const side: TradeSide = longCond ? 'long' : 'short';
    const signalKey = `${state.currentBar!.startMs}:${side}`;
    if (state.lastSignalKey === signalKey) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }
    state.lastSignalKey = signalKey;

    openPos = await hasOpenPosition(symbol);
    if (openPos) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }

    const symbols = parseSymbols(TRADING_SYMBOLS);
    const equityBase = TRADING_EQUITY_SPLIT ? TRADING_INITIAL_CAPITAL / symbols.length : TRADING_INITIAL_CAPITAL;
    const { qty } = sizeByExposure({
      equity: equityBase,
      riskPct: TRADING_RISK_PCT,
      leverage: TRADING_LEVERAGE,
      price: tick.price,
    });

    const tpPrice = longCond ? tick.price * (1 + TRADING_TP_PCT / 100) : tick.price * (1 - TRADING_TP_PCT / 100);
    const slPrice = longCond ? tick.price * (1 - TRADING_SL_PCT / 100) : tick.price * (1 + TRADING_SL_PCT / 100);

    const entryTs = new Date(tick.tsMs).toISOString();

    await insertTradeRecord({
      symbol,
      side,
      entryTs,
      entryPrice: tick.price,
      qty,
      tpPrice,
      slPrice,
      status: 'open',
      meta: {
        kind: 'signal',
        source: 'trading-engine',
        dryRun: TRADING_DRY_RUN,
        params: {
          timeframe: TRADING_TIMEFRAME,
          cvdLen: TRADING_CVD_LEN,
          deltaCoef: TRADING_DELTA_COEF,
          leverage: TRADING_LEVERAGE,
        },
      },
    });

    try {
      if (!TRADING_DRY_RUN) {
        const execution = await executeLocalAiTradingOrder({
          symbol,
          side,
          qty,
          entryPrice: tick.price,
          tpPrice,
          slPrice,
          leverage: TRADING_LEVERAGE,
        });

        openPos = true;

        await insertTradeRecord({
          symbol,
          side,
          entryTs,
          entryPrice: tick.price,
          qty,
          tpPrice,
          slPrice,
          status: 'open',
          orderIds: execution.orderIds,
          meta: {
            kind: 'order_placed',
            source: 'trading-engine',
            dryRun: false,
            executionRaw: execution.raw,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertTradeRecord({
        symbol,
        side,
        entryTs,
        entryPrice: tick.price,
        qty,
        tpPrice,
        slPrice,
        status: 'error',
        meta: {
          kind: 'order_failed',
          source: 'trading-engine',
          dryRun: TRADING_DRY_RUN,
          error: message,
        },
      });
      logger.error('[TRADING] %s order failed: %s', symbol, message);
    }

    state.lastProcessedTradeMs = tick.tsMs;
  }

  await setLastProcessedTs(symbol, new Date(state.lastProcessedTradeMs).toISOString());
}

async function runOnce(): Promise<void> {
  const tfMs = timeframeToMs(TRADING_TIMEFRAME);
  const symbols = parseSymbols(TRADING_SYMBOLS);

  for (const symbol of symbols) {
    try {
      await runSymbolOnce(symbol, tfMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TRADING] %s loop error: %s', symbol, message);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function loop(): Promise<void> {
  while (started) {
    try {
      await runOnce();
      lastLoopAt = new Date().toISOString();
      lastLoopError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastLoopError = message;
      logger.error('[TRADING] loop failure: %s', message);
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(1, TRADING_POLL_SECONDS) * 1000));
  }
}

export function startTradingEngine(): void {
  if (started) {
    return;
  }

  if (!START_TRADING_BOT) {
    logger.info('[TRADING] START_TRADING_BOT disabled');
    return;
  }

  if (!isSupabaseConfigured()) {
    logger.error('[TRADING] SUPABASE is required for trading engine (candles/trades)');
    return;
  }

  if (!isLocalAiTradingConfigured() && !TRADING_DRY_RUN) {
    logger.error('[TRADING] BINANCE_API_KEY/BINANCE_API_SECRET missing while TRADING_DRY_RUN=false');
    return;
  }

  started = true;
  startedAt = new Date().toISOString();

  logger.info(
    '[TRADING] started exchange=%s symbols=%s timeframe=%s dryRun=%s',
    TRADING_EXCHANGE,
    TRADING_SYMBOLS,
    TRADING_TIMEFRAME,
    String(TRADING_DRY_RUN),
  );

  void loop();
}

export function getTradingEngineRuntimeSnapshot(): TradingRuntimeSnapshot {
  return {
    started,
    startedAt,
    symbols: parseSymbols(TRADING_SYMBOLS),
    timeframe: TRADING_TIMEFRAME,
    dryRun: TRADING_DRY_RUN,
    lastLoopAt,
    lastLoopError,
  };
}
