import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const buildStrategy = (overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  symbols: [],
  timeframe: '30m',
  signal: {
    mode: 'cvd_sma_cross',
    deltaCoef: 1,
    cvdLen: 19,
    priceSmaLen: 20,
    allowLong: true,
    allowShort: true,
  },
  risk: {
    equitySplit: true,
    initialCapital: 3000,
    riskPct: 2,
    leverage: 20,
    maxQty: 100,
  },
  exit: {
    enableTp: true,
    enableSl: true,
    tpPct: 4,
    slPct: 2,
  },
  runtime: {
    dryRun: true,
    pollSeconds: 1,
    symbolConcurrency: 1,
    candleLookback: 400,
    tickFetchLimit: 1000,
    tickMaxPages: 3,
    maxTicksPerCycle: 1000,
    tickYieldEvery: 100,
    memorySoftLimitMb: 0,
  },
  ...overrides,
}) as any;

const loadTradingEngine = async (params?: {
  startTradingBot?: boolean;
  supabaseConfigured?: boolean;
  strategy?: Record<string, unknown>;
  lock?: { ok: boolean; reason?: string };
  aiConfigured?: boolean;
  nowMs?: number;
  candles?: Array<{ ts: string; open: number; close: number; volume: number }>;
  stateRows?: Array<{ last_ts: string }>;
  trades?: Array<{ id?: string | number; timestamp: number; price: number; amount: number }>;
}) => {
  vi.resetModules();

  const configState = {
    BINANCE_FUTURES: true,
    START_TRADING_BOT: params?.startTradingBot ?? false,
    TRADING_CANDLES_TABLE: 'candles',
    TRADING_EXCHANGE: 'binance',
    TRADING_STATE_TABLE: 'bot_state',
  };

  const isSupabaseConfigured = vi.fn(() => params?.supabaseConfigured ?? true);

  const strategy = buildStrategy(params?.strategy || {});
  const getTradingStrategyConfig = vi.fn(async () => strategy);
  const acquireDistributedLease = vi.fn(async () => params?.lock || { ok: true });
  const releaseDistributedLease = vi.fn(async () => undefined);
  const createTrade = vi.fn(async (_payload: Record<string, unknown>) => undefined);

  const nowMs = params?.nowMs ?? Date.now();
  const candles = params?.candles ?? [];
  const stateRows = params?.stateRows ?? [];
  const trades = params?.trades ?? [];

  const makeFilterBuilder = (table: string, rows: any[]) => {
    const builder: any = {
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({ data: rows, error: null })),
    };

    if (table === 'candles') {
      builder.limit = vi.fn(async () => ({ data: rows, error: null }));
    }

    if (table === 'bot_state') {
      builder.limit = vi.fn(async () => ({ data: rows, error: null }));
    }

    return builder;
  };

  const getSupabaseClient = vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'candles') {
        return {
          select: vi.fn(() => makeFilterBuilder(table, candles)),
        };
      }

      if (table === 'bot_state') {
        return {
          select: vi.fn(() => makeFilterBuilder(table, stateRows)),
          upsert: vi.fn(async () => ({ error: null })),
        };
      }

      return {
        select: vi.fn(() => makeFilterBuilder(table, [])),
        upsert: vi.fn(async () => ({ error: null })),
      };
    }),
  }));

  const fetchTrades = vi.fn(async (_symbol: string, since: number) => {
    const safeSince = Number.isFinite(since) ? since : nowMs - 1;
    return trades.filter((row) => row.timestamp >= safeSince);
  });

  vi.doMock('../logger', () => ({ default: logger }));
  vi.doMock('../config', () => configState);
  vi.doMock('./aiTradingClient', () => ({
    executeAiTradingOrder: vi.fn(),
    getAiTradingPosition: vi.fn(async () => ({ open: false })),
    isAiTradingConfigured: vi.fn(() => params?.aiConfigured ?? true),
  }));
  vi.doMock('./localAiTradingClient', () => ({
    buildBinanceClient: vi.fn(async () => ({ fetchTrades })),
    toBinanceSymbol: vi.fn((symbol: string) => symbol),
  }));
  vi.doMock('./tradingStrategyService', () => ({
    getDefaultTradingStrategyConfig: vi.fn(() => strategy),
    getTradingStrategyConfig,
  }));
  vi.doMock('./tradesStore', () => ({ createTrade }));
  vi.doMock('./distributedLockService', () => ({ acquireDistributedLease, releaseDistributedLease }));
  vi.doMock('./supabaseClient', () => ({ getSupabaseClient, isSupabaseConfigured }));
  vi.doMock('../utils/async', () => ({
    runWithConcurrency: vi.fn(async (items: string[], worker: (item: string) => Promise<void>) => {
      for (const item of items) {
        await worker(item);
      }
    }),
  }));

  const module = await import('./tradingEngine');
  return {
    module,
    acquireDistributedLease,
    releaseDistributedLease,
    getTradingStrategyConfig,
    createTrade,
  };
};

describe('tradingEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('START_TRADING_BOT=false이면 엔진을 시작하지 않는다', async () => {
    const { module } = await loadTradingEngine({ startTradingBot: false });
    module.startTradingEngine();

    const snapshot = module.getTradingEngineRuntimeSnapshot();
    expect(snapshot.started).toBe(false);
    expect(logger.info).toHaveBeenCalledWith('[TRADING] START_TRADING_BOT disabled');
  });

  it('Supabase 미설정이면 엔진 시작을 거부한다', async () => {
    const { module } = await loadTradingEngine({ startTradingBot: true, supabaseConfigured: false });
    module.startTradingEngine();

    const snapshot = module.getTradingEngineRuntimeSnapshot();
    expect(snapshot.started).toBe(false);
    expect(logger.error).toHaveBeenCalledWith('[TRADING] SUPABASE is required for trading engine (candles/trades)');
  });

  it('runTradingEngineOnce는 비활성 전략이면 실패를 반환한다', async () => {
    const { module } = await loadTradingEngine({ strategy: { enabled: false } });
    await expect(module.runTradingEngineOnce()).resolves.toEqual({
      ok: false,
      message: 'Strategy is disabled',
    });
  });

  it('runTradingEngineOnce는 잠금이 잡혀 있으면 lock held 메시지를 반환한다', async () => {
    const { module } = await loadTradingEngine({
      strategy: { enabled: true, runtime: { ...buildStrategy().runtime, dryRun: true } },
      lock: { ok: false, reason: 'LOCK_HELD' },
    });

    await expect(module.runTradingEngineOnce()).resolves.toEqual({
      ok: false,
      message: 'Another instance is already running trading loop',
    });
  });

  it('runTradingEngineOnce는 dryRun=false이고 AI 미설정이면 실패한다', async () => {
    const { module } = await loadTradingEngine({
      aiConfigured: false,
      strategy: {
        enabled: true,
        runtime: { ...buildStrategy().runtime, dryRun: false },
      },
    });

    await expect(module.runTradingEngineOnce()).resolves.toEqual({
      ok: false,
      message: 'AI trading is not configured while strategy dryRun=false',
    });
  });

  it('runTradingEngineOnce는 lock 오류 사유를 포함해 실패 메시지를 반환한다', async () => {
    const { module } = await loadTradingEngine({
      lock: { ok: false, reason: 'NETWORK_ERROR' },
    });

    await expect(module.runTradingEngineOnce()).resolves.toEqual({
      ok: false,
      message: 'Trading lock unavailable: NETWORK_ERROR',
    });
  });

  it('runTradingEngineOnce 성공 시 lock을 해제한다', async () => {
    const { module, acquireDistributedLease, releaseDistributedLease } = await loadTradingEngine({
      strategy: { symbols: [] },
      lock: { ok: true },
    });

    await expect(module.runTradingEngineOnce()).resolves.toEqual({ ok: true, message: 'Completed one cycle' });
    expect(acquireDistributedLease).toHaveBeenCalledTimes(1);
    expect(releaseDistributedLease).toHaveBeenCalledTimes(1);
  });

  it('runTradingEngineOnce는 틱 기반 신호가 발생하면 dry-run trade를 기록한다', async () => {
    const baseTs = Date.UTC(2026, 2, 20, 0, 0, 0);
    const candles = Array.from({ length: 6 }, (_, i) => {
      const ts = new Date(baseTs - (6 - i) * 30 * 60_000).toISOString();
      return { ts, open: 100, close: 100, volume: 1 };
    });

    const { module, createTrade } = await loadTradingEngine({
      nowMs: baseTs,
      strategy: {
        symbols: ['BTC/USDT'],
        signal: {
          mode: 'price_sma_cross',
          deltaCoef: 1,
          cvdLen: 3,
          priceSmaLen: 3,
          allowLong: true,
          allowShort: true,
        },
        runtime: {
          ...buildStrategy().runtime,
          dryRun: true,
          candleLookback: 6,
          tickFetchLimit: 10,
          tickMaxPages: 1,
          maxTicksPerCycle: 10,
        },
      },
      candles,
      stateRows: [],
      trades: [{ id: 't-1', timestamp: baseTs + 1_000, price: 110, amount: 1 }],
      lock: { ok: true },
    });

    await expect(module.runTradingEngineOnce()).resolves.toEqual({ ok: true, message: 'Completed one cycle' });
    expect(createTrade).toHaveBeenCalledTimes(1);
    const tradePayload = createTrade.mock.calls[0][0];
    expect(tradePayload).toMatchObject({
      symbol: 'BTC/USDT',
      side: 'long',
      status: 'open',
    });
    expect(Number(tradePayload.qty)).toBeGreaterThan(0);
  });

  it('pause/resume는 started=false 상태에서 실패를 반환한다', async () => {
    const { module } = await loadTradingEngine({ startTradingBot: false });
    expect(module.pauseTradingEngine()).toEqual({ ok: false, message: 'Engine is not started' });
    expect(module.resumeTradingEngine()).toEqual({ ok: false, message: 'Engine is not started' });
  });
});
