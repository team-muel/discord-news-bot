// Barrel export — Trading domain services (stock analysis only; CVD auto-trading removed)

export { isInvestmentAnalysisEnabled, generateInvestmentAnalysis } from './investmentAnalysisService';

export { isStockFeatureEnabled, fetchStockQuote, fetchStockChartImageUrl } from './stockService';
export type { StockQuote } from './stockService';
