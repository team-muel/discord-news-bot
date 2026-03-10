import logger from '../logger';
import type { TradeSide } from '../contracts/trade';
import type { TradingStrategyConfig } from '../contracts/tradingStrategy';
import {
  BINANCE_FUTURES,
  START_TRADING_BOT,
  TRADING_CANDLES_TABLE,
  TRADING_EXCHANGE,
  TRADING_STATE_TABLE,
} from '../config';
import { executeAiTradingOrder, getAiTradingPosition, isAiTradingConfigured } from './aiTradingClient';
import { buildBinanceClient, toBinanceSymbol } from './localAiTradingClient';
import {
  getDefaultTradingStrategyConfig,
  getTradingStrategyConfig,
} from './tradingStrategyService';
import { createTrade } from './tradesStore';
import { acquireDistributedLease, releaseDistributedLease } from './distributedLockService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

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
  closeSeries: number[];
  currentBar: TickBar | null;
  lastProcessedTradeMs: number;
  lastSignalKey?: string;
};

type TradingRuntimeSnapshot = {
  started: boolean;
  startedAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  symbols: string[];
  timeframe: string;
  dryRun: boolean;
  strategyMode: TradingStrategyConfig['signal']['mode'];
  enabled: boolean;
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
let stateTableRetryAtMs = 0;
let activeStrategyConfig = getDefaultTradingStrategyConfig();
let paused = false;
let pausedAt: string | null = null;
let pausedReason: string | null = null;

const STATE_TABLE_RETRY_COOLDOWN_MS = 60_000;
const ENGINE_LOCK_NAME = 'trading-engine-main-loop';
const ENGINE_LOCK_LEASE_MS = Math.max(15_000, Number(process.env.TRADING_ENGINE_LOCK_LEASE_MS || 90_000));
const ENGINE_LOCK_OWNER = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;

const yieldToEventLoop = async () => new Promise<void>((resolve) => setImmediate(resolve));

const getMemoryUsageMb = () => {
  const usage = process.memoryUsage();
  return {
    heapUsedMb: Math.round(usage.heapUsed / (1024 * 1024)),
    rssMb: Math.round(usage.rss / (1024 * 1024)),
  };
};

const maybePauseByMemory = (strategy: TradingStrategyConfig): { paused: boolean; reason?: string } => {
  const softLimitMb = Math.max(0, Number(strategy.runtime.memorySoftLimitMb || 0));
  if (softLimitMb <= 0) {
    return { paused: false };
  }

  const usage = getMemoryUsageMb();
  if (usage.heapUsedMb < softLimitMb) {
    return { paused: false };
  }

  paused = true;
  pausedAt = new Date().toISOString();
  pausedReason = `memory_guard(heapUsed=${usage.heapUsedMb}MB, rss=${usage.rssMb}MB, limit=${softLimitMb}MB)`;
  logger.error('[TRADING] Memory soft limit exceeded. %s', pausedReason);
  return { paused: true, reason: pausedReason };
};

const runWithConcurrency = async <T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number) => {
  if (items.length === 0) {
    return;
  }

  const laneCount = Math.min(Math.max(1, concurrency), items.length);
  let cursor = 0;

  const lanes = Array.from({ length: laneCount }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) {
        return;
      }

      await worker(items[idx]);
    }
  });

  await Promise.all(lanes);
};

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

function stateKey(symbol: string, timeframe: string): string {
  return [TRADING_EXCHANGE, symbol, timeframe].join('|');
}

function runtimeKey(symbol: string, timeframe: string): string {
  return `${symbol}|${timeframe}`;
}

async function fetchRecentCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from(TRADING_CANDLES_TABLE)
    .select('ts, open, close, volume')
    .eq('exchange', TRADING_EXCHANGE)
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
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

async function getLastProcessedTs(symbol: string, timeframe: string): Promise<string | undefined> {
  const key = stateKey(symbol, timeframe);

  if (!isSupabaseConfigured()) {
    return fallbackStateStore.get(key);
  }

  if (stateTableAvailable === false && Date.now() < stateTableRetryAtMs) {
    return fallbackStateStore.get(key);
  }

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(TRADING_STATE_TABLE)
      .select('last_ts')
      .eq('exchange', TRADING_EXCHANGE)
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .limit(1);

    if (error) {
      throw error;
    }

    stateTableAvailable = true;
    stateTableRetryAtMs = 0;
    return (data?.[0]?.last_ts as string | undefined) ?? fallbackStateStore.get(key);
  } catch (error) {
    stateTableAvailable = false;
    stateTableRetryAtMs = Date.now() + STATE_TABLE_RETRY_COOLDOWN_MS;
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[TRADING] Falling back to in-memory state store: %s', message);
    return fallbackStateStore.get(key);
  }
}

async function setLastProcessedTs(symbol: string, timeframe: string, ts: string): Promise<void> {
  const key = stateKey(symbol, timeframe);
  fallbackStateStore.set(key, ts);

  if (!isSupabaseConfigured()) {
    return;
  }

  if (stateTableAvailable === false && Date.now() < stateTableRetryAtMs) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.from(TRADING_STATE_TABLE).upsert(
      {
        exchange: TRADING_EXCHANGE,
        symbol,
        timeframe,
        last_ts: ts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'exchange,symbol,timeframe' },
    );

    if (error) {
      throw error;
    }

    stateTableAvailable = true;
    stateTableRetryAtMs = 0;
  } catch (error) {
    stateTableAvailable = false;
    stateTableRetryAtMs = Date.now() + STATE_TABLE_RETRY_COOLDOWN_MS;
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

function finalizeCurrentBar(state: SymbolRuntimeState, strategy: TradingStrategyConfig): void {
  if (!state.currentBar) return;

  const delta =
    (state.currentBar.close - state.currentBar.open) * state.currentBar.volume * strategy.signal.deltaCoef;

  state.cvdAccClosed += delta;
  state.cvdClosed.push(state.cvdAccClosed);
  state.closeSeries.push(state.currentBar.close);

  const keep = Math.max(strategy.runtime.candleLookback, strategy.signal.cvdLen + 5, strategy.signal.priceSmaLen + 5);

  if (state.cvdClosed.length > keep) {
    state.cvdClosed.splice(0, state.cvdClosed.length - keep);
  }
  if (state.closeSeries.length > keep) {
    state.closeSeries.splice(0, state.closeSeries.length - keep);
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

function buildSignalFromState(state: SymbolRuntimeState, strategy: TradingStrategyConfig) {
  if (!state.currentBar) return { longCond: false, shortCond: false };

  if (strategy.signal.mode === 'price_sma_cross') {
    const series = [...state.closeSeries, state.currentBar.close];
    if (series.length < strategy.signal.priceSmaLen + 2) return { longCond: false, shortCond: false };

    const ma = sma(series, strategy.signal.priceSmaLen);
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

  const curDelta =
    (state.currentBar.close - state.currentBar.open) * state.currentBar.volume * strategy.signal.deltaCoef;
  const curCvd = state.cvdAccClosed + curDelta;

  const series = [...state.cvdClosed, curCvd];
  if (series.length < strategy.signal.cvdLen + 2) return { longCond: false, shortCond: false };

  const ma = sma(series, strategy.signal.cvdLen);
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
  const position = await getAiTradingPosition(symbol);

  if (typeof (position as { open?: unknown }).open === 'boolean') {
    return Boolean((position as { open?: boolean }).open);
  }

  const qtyValue = Number((position as { qty?: unknown }).qty);
  if (Number.isFinite(qtyValue)) {
    return Math.abs(qtyValue) > 0;
  }

  const side = String((position as { side?: unknown }).side || '').toLowerCase();
  return side === 'long' || side === 'short';
}

async function getOrInitState(symbol: string, tfMs: number, strategy: TradingStrategyConfig): Promise<SymbolRuntimeState | null> {
  const key = runtimeKey(symbol, strategy.timeframe);
  const existing = runtime.get(key);
  if (existing) return existing;

  const candles = await fetchRecentCandles(symbol, strategy.timeframe, strategy.runtime.candleLookback);
  const need = Math.max(strategy.signal.cvdLen, strategy.signal.priceSmaLen) + 2;
  if (candles.length < need) {
    return null;
  }

  const cvdClosed = computeCvdSeries(candles, strategy.signal.deltaCoef);
  const cvdAccClosed = cvdClosed[cvdClosed.length - 1] ?? 0;

  const lastTs = await getLastProcessedTs(symbol, strategy.timeframe);
  const savedMs = lastTs ? Date.parse(lastTs) : Number.NaN;
  const nowBarStart = floorToTf(Date.now(), tfMs);
  const lastProcessedTradeMs = Number.isFinite(savedMs) ? Math.max(savedMs, nowBarStart - 1) : nowBarStart - 1;

  const state: SymbolRuntimeState = {
    cvdClosed,
    cvdAccClosed,
    closeSeries: candles.map((c) => c.close),
    currentBar: null,
    lastProcessedTradeMs,
  };

  runtime.set(key, state);
  return state;
}

async function insertTradeRecord(params: {
  symbol: string;
  timeframe: string;
  side: TradeSide;
  entryTs: string;
  entryPrice: number;
  qty: number;
  tpPrice: number | null;
  slPrice: number | null;
  status: 'open' | 'error';
  orderIds?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}) {
  await createTrade({
    exchange: TRADING_EXCHANGE,
    symbol: params.symbol,
    timeframe: params.timeframe,
    side: params.side,
    entryTs: params.entryTs,
    entryPrice: params.entryPrice,
    qty: params.qty,
    tpPrice: params.tpPrice ?? undefined,
    slPrice: params.slPrice ?? undefined,
    status: params.status,
    exchangeOrderIds: params.orderIds,
    meta: params.meta,
  });
}

async function runSymbolOnce(symbol: string, tfMs: number, strategy: TradingStrategyConfig): Promise<void> {
  const memoryGuard = maybePauseByMemory(strategy);
  if (memoryGuard.paused) {
    return;
  }

  const state = await getOrInitState(symbol, tfMs, strategy);
  if (!state) return;

  const ticks = await fetchTradesSince({
    symbol,
    sinceMs: state.lastProcessedTradeMs + 1,
    limit: strategy.runtime.tickFetchLimit,
    maxPages: strategy.runtime.tickMaxPages,
  });

  if (!ticks.length) return;

  const maxTicksPerCycle = Math.max(1, strategy.runtime.maxTicksPerCycle);
  const effectiveTicks = ticks.slice(0, maxTicksPerCycle);
  if (ticks.length > effectiveTicks.length) {
    logger.warn('[TRADING] %s tick batch capped: %d -> %d', symbol, ticks.length, effectiveTicks.length);
  }

  let openPos = await hasOpenPosition(symbol);
  const tickYieldEvery = Math.max(1, strategy.runtime.tickYieldEvery);

  for (let i = 0; i < effectiveTicks.length; i += 1) {
    const tick = effectiveTicks[i];
    if (i > 0 && i % tickYieldEvery === 0) {
      await yieldToEventLoop();
      const guard = maybePauseByMemory(strategy);
      if (guard.paused) {
        return;
      }
    }

    if (!state.currentBar) {
      state.currentBar = newBarFromTick(tick.tsMs, tick.price, tick.amount, tfMs);
    } else {
      const startMs = floorToTf(tick.tsMs, tfMs);
      if (startMs !== state.currentBar.startMs) {
        finalizeCurrentBar(state, strategy);
        state.currentBar = newBarFromTick(tick.tsMs, tick.price, tick.amount, tfMs);
        state.lastSignalKey = undefined;
      } else {
        state.currentBar.high = Math.max(state.currentBar.high, tick.price);
        state.currentBar.low = Math.min(state.currentBar.low, tick.price);
        state.currentBar.close = tick.price;
        state.currentBar.volume += tick.amount;
      }
    }

    const { longCond, shortCond } = buildSignalFromState(state, strategy);
    if (!longCond && !shortCond) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }

    const side: TradeSide = longCond ? 'long' : 'short';
    if ((side === 'long' && !strategy.signal.allowLong) || (side === 'short' && !strategy.signal.allowShort)) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }

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

    const symbols = strategy.symbols;
    const equityBase = strategy.risk.equitySplit ? strategy.risk.initialCapital / Math.max(1, symbols.length) : strategy.risk.initialCapital;
    const sized = sizeByExposure({
      equity: equityBase,
      riskPct: strategy.risk.riskPct,
      leverage: strategy.risk.leverage,
      price: tick.price,
    });

    const qty = Math.min(strategy.risk.maxQty, sized.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      state.lastProcessedTradeMs = tick.tsMs;
      continue;
    }

    const tpPrice = strategy.exit.enableTp
      ? (longCond ? tick.price * (1 + strategy.exit.tpPct / 100) : tick.price * (1 - strategy.exit.tpPct / 100))
      : null;
    const slPrice = strategy.exit.enableSl
      ? (longCond ? tick.price * (1 - strategy.exit.slPct / 100) : tick.price * (1 + strategy.exit.slPct / 100))
      : null;

    const entryTs = new Date(tick.tsMs).toISOString();

    try {
      if (strategy.runtime.dryRun) {
        await insertTradeRecord({
          symbol,
          timeframe: strategy.timeframe,
          side,
          entryTs,
          entryPrice: tick.price,
          qty,
          tpPrice,
          slPrice,
          status: 'open',
          meta: {
            kind: 'dry_run_signal',
            source: 'trading-engine',
            dryRun: true,
            strategy,
          },
        });
      } else {
        const execution = await executeAiTradingOrder({
          symbol,
          side,
          qty,
          entryPrice: tick.price,
          tpPrice: tpPrice ?? undefined,
          slPrice: slPrice ?? undefined,
          leverage: strategy.risk.leverage,
        });

        openPos = true;

        await insertTradeRecord({
          symbol,
          timeframe: strategy.timeframe,
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
            strategy,
            executionRaw: execution.raw,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertTradeRecord({
        symbol,
        timeframe: strategy.timeframe,
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
          dryRun: strategy.runtime.dryRun,
          strategy,
          error: message,
        },
      });
      logger.error('[TRADING] %s order failed: %s', symbol, message);
    }

    state.lastProcessedTradeMs = tick.tsMs;
  }

  await setLastProcessedTs(symbol, strategy.timeframe, new Date(state.lastProcessedTradeMs).toISOString());
}

async function runOnce(strategy: TradingStrategyConfig): Promise<void> {
  const memoryGuard = maybePauseByMemory(strategy);
  if (memoryGuard.paused) {
    return;
  }

  const tfMs = timeframeToMs(strategy.timeframe);
  const symbolConcurrency = Math.max(1, strategy.runtime.symbolConcurrency);

  await runWithConcurrency(strategy.symbols, async (symbol) => {
    try {
      await runSymbolOnce(symbol, tfMs, strategy);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[TRADING] %s loop error: %s', symbol, message);
    }
  }, symbolConcurrency);

  await yieldToEventLoop();
}

async function loop(): Promise<void> {
  while (started) {
    let lockAcquired = false;
    try {
      activeStrategyConfig = await getTradingStrategyConfig();

      if (paused) {
        lastLoopError = null;
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, activeStrategyConfig.runtime.pollSeconds) * 1000));
        continue;
      }

      if (!activeStrategyConfig.enabled) {
        lastLoopError = null;
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, activeStrategyConfig.runtime.pollSeconds) * 1000));
        continue;
      }

      if (!isAiTradingConfigured() && !activeStrategyConfig.runtime.dryRun) {
        lastLoopError = 'AI trading is not configured while strategy dryRun=false';
        logger.error('[TRADING] %s', lastLoopError);
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, activeStrategyConfig.runtime.pollSeconds) * 1000));
        continue;
      }

      const lock = await acquireDistributedLease({
        name: ENGINE_LOCK_NAME,
        owner: ENGINE_LOCK_OWNER,
        leaseMs: ENGINE_LOCK_LEASE_MS,
      });

      if (!lock.ok) {
        lastLoopError = lock.reason === 'LOCK_HELD'
          ? 'Another instance is running trading loop'
          : `Trading lock unavailable: ${lock.reason || 'unknown'}`;
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, activeStrategyConfig.runtime.pollSeconds) * 1000));
        continue;
      }

      lockAcquired = true;

      await runOnce(activeStrategyConfig);
      lastLoopAt = new Date().toISOString();
      lastLoopError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastLoopError = message;
      logger.error('[TRADING] loop failure: %s', message);
    } finally {
      if (lockAcquired) {
        await releaseDistributedLease({ name: ENGINE_LOCK_NAME, owner: ENGINE_LOCK_OWNER });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(1, activeStrategyConfig.runtime.pollSeconds) * 1000));
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

  started = true;
  startedAt = new Date().toISOString();

  logger.info('[TRADING] started exchange=%s', TRADING_EXCHANGE);

  void loop();
}

export async function runTradingEngineOnce(): Promise<{ ok: boolean; message: string }> {
  let lockAcquired = false;
  try {
    const strategy = await getTradingStrategyConfig(true);
    activeStrategyConfig = strategy;

    if (paused) {
      return { ok: false, message: 'Engine is paused' };
    }

    if (!strategy.enabled) {
      return { ok: false, message: 'Strategy is disabled' };
    }

    if (!isAiTradingConfigured() && !strategy.runtime.dryRun) {
      return { ok: false, message: 'AI trading is not configured while strategy dryRun=false' };
    }

    const lock = await acquireDistributedLease({
      name: ENGINE_LOCK_NAME,
      owner: ENGINE_LOCK_OWNER,
      leaseMs: ENGINE_LOCK_LEASE_MS,
    });

    if (!lock.ok) {
      return {
        ok: false,
        message: lock.reason === 'LOCK_HELD'
          ? 'Another instance is already running trading loop'
          : `Trading lock unavailable: ${lock.reason || 'unknown'}`,
      };
    }
    lockAcquired = true;

    await runOnce(strategy);
    lastLoopAt = new Date().toISOString();
    lastLoopError = null;
    return { ok: true, message: 'Completed one cycle' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastLoopError = message;
    return { ok: false, message };
  } finally {
    if (lockAcquired) {
      await releaseDistributedLease({ name: ENGINE_LOCK_NAME, owner: ENGINE_LOCK_OWNER });
    }
  }
}

export function pauseTradingEngine(reason = 'manual'): { ok: boolean; message: string } {
  if (!started) {
    return { ok: false, message: 'Engine is not started' };
  }

  paused = true;
  pausedAt = new Date().toISOString();
  pausedReason = reason;
  return { ok: true, message: 'Engine paused' };
}

export function resumeTradingEngine(): { ok: boolean; message: string } {
  if (!started) {
    return { ok: false, message: 'Engine is not started' };
  }

  paused = false;
  pausedAt = null;
  pausedReason = null;
  return { ok: true, message: 'Engine resumed' };
}

export function getTradingEngineRuntimeSnapshot(): TradingRuntimeSnapshot {
  return {
    started,
    startedAt,
    paused,
    pausedAt,
    pausedReason,
    symbols: activeStrategyConfig.symbols,
    timeframe: activeStrategyConfig.timeframe,
    dryRun: activeStrategyConfig.runtime.dryRun,
    strategyMode: activeStrategyConfig.signal.mode,
    enabled: activeStrategyConfig.enabled,
    lastLoopAt,
    lastLoopError,
  };
}
