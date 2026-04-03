// Barrel export — Trading domain services
// Usage: import { startTradingEngine, fetchStockQuote } from './trading';

export { isAiTradingConfigured, assertAiTradingConfigured, executeAiTradingOrder, getAiTradingPosition, closeAiTradingPosition } from './aiTradingClient';

export { isInvestmentAnalysisEnabled, generateInvestmentAnalysis } from './investmentAnalysisService';

export { toBinanceSymbol, buildBinanceClient, isLocalAiTradingConfigured, executeLocalAiTradingOrder, getLocalAiTradingPosition } from './localAiTradingClient';

export { isStockFeatureEnabled, fetchStockQuote, fetchStockChartImageUrl } from './stockService';
export type { StockQuote } from './stockService';

export {
  startTradingEngine, stopTradingEngine, runTradingEngineOnce,
  pauseTradingEngine, resumeTradingEngine, getTradingEngineRuntimeSnapshot,
} from './tradingEngine';

export {
  getDefaultTradingStrategyConfig, normalizeTradingStrategyConfig,
  getTradingStrategyConfig, updateTradingStrategyConfig, resetTradingStrategyConfig,
} from './tradingStrategyService';

export { listTrades, createTrade } from './tradesStore';
