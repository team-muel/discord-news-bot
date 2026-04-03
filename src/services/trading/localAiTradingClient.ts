import ccxt from 'ccxt';
import {
  AI_TRADING_DRY_RUN,
  BINANCE_API_KEY,
  BINANCE_API_SECRET,
  BINANCE_FUTURES,
  BINANCE_HEDGE_MODE,
  BINANCE_SPOT_MIN_BASE_QTY,
} from '../../config';
import type { TradeExecutionRequest, TradeExecutionResult } from '../../contracts/trade';

export const toBinanceSymbol = (input: string, futures: boolean): string => {
  const raw = input.trim().toUpperCase();
  if (!raw) return raw;

  let normalized = raw;
  if (!normalized.includes('/') && !normalized.includes(':') && normalized.endsWith('USDT') && normalized.length > 4) {
    normalized = `${normalized.slice(0, -4)}/USDT`;
  }

  if (futures) {
    if (normalized.includes(':')) return normalized;
    const [base, quote] = normalized.split('/');
    if (base && quote === 'USDT') {
      return `${base}/${quote}:USDT`;
    }
    return normalized;
  }

  if (!normalized.includes(':')) return normalized;
  return normalized.split(':')[0];
};

const getBaseAsset = (symbol: string): string => {
  const pair = symbol.split(':')[0];
  return pair.split('/')[0] || '';
};

export const buildBinanceClient = async () => {
  const ex: any = new ccxt.binance({
    apiKey: BINANCE_API_KEY,
    secret: BINANCE_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: BINANCE_FUTURES ? 'future' : 'spot',
    },
  });

  await ex.loadMarkets();
  return ex;
};

export function isLocalAiTradingConfigured(): boolean {
  return Boolean(BINANCE_API_KEY && BINANCE_API_SECRET);
}

export async function executeLocalAiTradingOrder(input: TradeExecutionRequest): Promise<TradeExecutionResult> {
  if (!isLocalAiTradingConfigured()) {
    throw new Error('LOCAL_AI_TRADING_NOT_CONFIGURED');
  }

  if (AI_TRADING_DRY_RUN) {
    return {
      orderIds: {
        entryId: null,
        tpId: null,
        slId: null,
      },
      raw: {
        mode: 'local',
        dryRun: true,
        params: input,
      },
    };
  }

  const ex = await buildBinanceClient();
  const symbol = toBinanceSymbol(input.symbol, BINANCE_FUTURES);
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('INVALID_QTY');
  }

  const isLong = input.side === 'long';
  const entrySide = isLong ? 'buy' : 'sell';
  const exitSide = isLong ? 'sell' : 'buy';

  const orderIds: Record<string, unknown> = {};
  const raw: Record<string, unknown> = {
    mode: 'local',
    marketType: BINANCE_FUTURES ? 'futures' : 'spot',
  };

  if (BINANCE_FUTURES && Number.isFinite(Number(input.leverage)) && Number(input.leverage) > 0) {
    try {
      const marketId = ex.market(symbol)?.id;
      if (marketId && typeof ex.fapiPrivatePostLeverage === 'function') {
        await ex.fapiPrivatePostLeverage({ symbol: marketId, leverage: Number(input.leverage) });
      }
    } catch {
      // Leverage set failure should not block order placement.
    }
  }

  const posSide = BINANCE_FUTURES && BINANCE_HEDGE_MODE ? { positionSide: isLong ? 'LONG' : 'SHORT' } : {};

  const entry = await ex.createOrder(symbol, 'market', entrySide, qty, undefined, posSide);
  orderIds.entryId = entry?.id ?? null;
  raw.entry = entry;

  if (BINANCE_FUTURES && Number.isFinite(Number(input.tpPrice))) {
    const tp = await ex.createOrder(symbol, 'take_profit_market', exitSide, qty, undefined, {
      stopPrice: Number(input.tpPrice),
      reduceOnly: true,
      ...(BINANCE_HEDGE_MODE ? { positionSide: isLong ? 'LONG' : 'SHORT' } : {}),
    });
    orderIds.tpId = tp?.id ?? null;
    raw.tp = tp;
  }

  if (BINANCE_FUTURES && Number.isFinite(Number(input.slPrice))) {
    const sl = await ex.createOrder(symbol, 'stop_market', exitSide, qty, undefined, {
      stopPrice: Number(input.slPrice),
      reduceOnly: true,
      ...(BINANCE_HEDGE_MODE ? { positionSide: isLong ? 'LONG' : 'SHORT' } : {}),
    });
    orderIds.slId = sl?.id ?? null;
    raw.sl = sl;
  }

  return { orderIds, raw };
}

export async function getLocalAiTradingPosition(symbolInput: string): Promise<Record<string, unknown>> {
  if (!isLocalAiTradingConfigured()) {
    throw new Error('LOCAL_AI_TRADING_NOT_CONFIGURED');
  }

  const ex = await buildBinanceClient();
  const symbol = toBinanceSymbol(symbolInput, BINANCE_FUTURES);

  if (!BINANCE_FUTURES) {
    const base = getBaseAsset(symbol);
    const bal = await ex.fetchBalance();
    const qty = Number(bal?.total?.[base] ?? 0);
    const open = Number.isFinite(qty) && qty > BINANCE_SPOT_MIN_BASE_QTY;

    return {
      source: 'local',
      marketType: 'spot',
      symbol: symbolInput,
      exchangeSymbol: symbol,
      side: open ? 'long' : 'flat',
      qty: Number.isFinite(qty) ? qty : 0,
      open,
    };
  }

  const positions = await ex.fetchPositions([symbol]);
  const marketId = ex.market(symbol)?.id;
  const candidates = new Set([symbol, symbolInput, marketId].filter(Boolean));
  const p = positions?.find((x: any) => candidates.has(x?.symbol) || candidates.has(x?.info?.symbol));

  const amt = Number(p?.info?.positionAmt ?? p?.contracts ?? 0);
  const absAmt = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const open = absAmt > 0;

  return {
    source: 'local',
    marketType: 'futures',
    symbol: symbolInput,
    exchangeSymbol: symbol,
    side: !open ? 'flat' : amt > 0 ? 'long' : 'short',
    qty: absAmt,
    open,
    entryPrice: Number(p?.info?.entryPrice ?? p?.entryPrice ?? 0) || null,
    markPrice: Number(p?.info?.markPrice ?? p?.markPrice ?? 0) || null,
    raw: p?.info ?? null,
  };
}
