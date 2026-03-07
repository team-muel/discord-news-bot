export type BotStatusGrade = 'healthy' | 'degraded' | 'offline';

export type JwtUser = {
  id: string;
  username: string;
  avatar: string | null;
};

export type ApiError = {
  status: number;
  error: string;
  message?: string;
  raw?: unknown;
};

export type AuthMeResponse = {
  user: JwtUser;
  csrfToken: null;
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  botStatusGrade: BotStatusGrade;
  uptimeSec: number;
  bot: Record<string, unknown>;
  automation: Record<string, unknown>;
};

export type QuantMetricId = 'position' | 'winRate' | 'cvd';
export type QuantTrend = 'up' | 'down' | 'flat';

export type QuantPanelMetric = {
  id: QuantMetricId;
  label: string;
  value: number;
  unit: string;
  change: number;
  trend: QuantTrend;
  updatedAt: string;
};

export type QuantPanelResponse = {
  source: 'backend';
  metrics: QuantPanelMetric[];
};

export type FredRange = '1Y' | '3Y' | '5Y' | '10Y';

export type FredCatalogItem = {
  id: string;
  label: string;
  unit: string;
  category: string;
};

export type FredSeriesPoint = {
  date: string;
  value: number;
};

export type FredSeries = {
  id: string;
  label: string;
  unit: string;
  points: FredSeriesPoint[];
};

export type FredPlaygroundResponse = {
  source: 'backend';
  catalog: FredCatalogItem[];
  series: FredSeries[];
};

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
  executeOrder?: boolean;
  leverage?: number;
};

export type TradesListResponse = {
  trades: TradeRecord[];
};

export type TradeCreateResponse = {
  trade: TradeRecord;
};

export type ResearchPresetKey = 'embedded' | 'studio';

export type ResearchPresetResponse = {
  preset: Record<string, unknown>;
};

export type ResearchPresetHistoryResponse = {
  history: Array<Record<string, unknown>>;
};
