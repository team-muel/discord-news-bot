// Context entrypoint: trading strategy and runtime controls.
export {
  getTradingEngineRuntimeSnapshot,
  pauseTradingEngine,
  resumeTradingEngine,
  runTradingEngineOnce,
  startTradingEngine,
} from '../services/trading/tradingEngine';

export {
  getDefaultTradingStrategyConfig,
  getTradingStrategyConfig,
  resetTradingStrategyConfig,
  updateTradingStrategyConfig,
  normalizeTradingStrategyConfig,
} from '../services/trading/tradingStrategyService';

export {
  closeAiTradingPosition,
  executeAiTradingOrder,
  getAiTradingPosition,
  isAiTradingConfigured,
} from '../services/trading/aiTradingClient';
