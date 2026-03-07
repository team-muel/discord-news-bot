export type TradeSide = 'long' | 'short';
export type TradeStatus = 'open' | 'closed' | 'canceled' | 'error';

export type TradeRecord = {
  id: number;
  exchange: string;
  symbol: string;
  timeframe: string;
  side: TradeSide;
  entryTs: string;
  entryPrice: number;
  qty: number;
  tpPrice: number | null;
  slPrice: number | null;
  status: TradeStatus;
  exchangeOrderIds: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type TradeCreateInput = {
  exchange?: string;
  symbol: string;
  timeframe?: string;
  side: TradeSide;
  entryTs: string;
  entryPrice: number;
  qty: number;
  tpPrice?: number;
  slPrice?: number;
  status?: TradeStatus;
  exchangeOrderIds?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

export type TradeExecutionRequest = {
  symbol: string;
  side: TradeSide;
  qty: number;
  entryPrice?: number;
  tpPrice?: number;
  slPrice?: number;
  leverage?: number;
};

export type TradeExecutionResult = {
  orderIds?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type TradeListFilter = {
  symbol?: string;
  status?: TradeStatus;
  limit?: number;
};
