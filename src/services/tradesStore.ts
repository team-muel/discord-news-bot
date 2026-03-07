import { SUPABASE_TRADES_TABLE } from '../config';
import type { TradeCreateInput, TradeListFilter, TradeRecord } from '../contracts/trade';
import { getSupabaseClient } from './supabaseClient';

type SupabaseTradeRow = {
  id: number;
  exchange: string;
  symbol: string;
  timeframe: string;
  side: 'long' | 'short';
  entry_ts: string;
  entry_price: number | string;
  qty: number | string;
  tp_price: number | string | null;
  sl_price: number | string | null;
  status: 'open' | 'closed' | 'canceled' | 'error';
  exchange_order_ids: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const mapTradeRow = (row: SupabaseTradeRow): TradeRecord => {
  return {
    id: row.id,
    exchange: row.exchange,
    symbol: row.symbol,
    timeframe: row.timeframe,
    side: row.side,
    entryTs: row.entry_ts,
    entryPrice: toFiniteNumber(row.entry_price),
    qty: toFiniteNumber(row.qty),
    tpPrice: row.tp_price === null ? null : toFiniteNumber(row.tp_price),
    slPrice: row.sl_price === null ? null : toFiniteNumber(row.sl_price),
    status: row.status,
    exchangeOrderIds: row.exchange_order_ids,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export async function listTrades(filter: TradeListFilter): Promise<TradeRecord[]> {
  const client = getSupabaseClient();

  let query = client
    .from(SUPABASE_TRADES_TABLE)
    .select(
      'id, exchange, symbol, timeframe, side, entry_ts, entry_price, qty, tp_price, sl_price, status, exchange_order_ids, meta, created_at, updated_at',
    )
    .order('entry_ts', { ascending: false })
    .limit(Math.max(1, Math.min(200, filter.limit ?? 50)));

  if (filter.symbol) {
    query = query.eq('symbol', filter.symbol);
  }
  if (filter.status) {
    query = query.eq('status', filter.status);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => mapTradeRow(row as SupabaseTradeRow));
}

export async function createTrade(input: TradeCreateInput): Promise<TradeRecord> {
  const client = getSupabaseClient();

  const payload = {
    exchange: input.exchange || 'binance',
    symbol: input.symbol,
    timeframe: input.timeframe || 'tick',
    side: input.side,
    entry_ts: input.entryTs,
    entry_price: input.entryPrice,
    qty: input.qty,
    tp_price: input.tpPrice ?? null,
    sl_price: input.slPrice ?? null,
    status: input.status ?? 'open',
    exchange_order_ids: input.exchangeOrderIds ?? null,
    meta: input.meta ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from(SUPABASE_TRADES_TABLE)
    .insert(payload)
    .select(
      'id, exchange, symbol, timeframe, side, entry_ts, entry_price, qty, tp_price, sl_price, status, exchange_order_ids, meta, created_at, updated_at',
    )
    .single();

  if (error) {
    throw error;
  }

  return mapTradeRow(data as SupabaseTradeRow);
}
