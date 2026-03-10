// Context entrypoint: trading strategy and runtime controls.
export {
  getTradingEngineRuntimeSnapshot,
  pauseTradingEngine,
  resumeTradingEngine,
  runTradingEngineOnce,
  startTradingEngine,
} from '../services/tradingEngine';

export {
  getDefaultTradingStrategyConfig,
  getTradingStrategyConfig,
  resetTradingStrategyConfig,
  updateTradingStrategyConfig,
  normalizeTradingStrategyConfig,
} from '../services/tradingStrategyService';

export {
  closeAiTradingPosition,
  executeAiTradingOrder,
  getAiTradingPosition,
  isAiTradingConfigured,
} from '../services/aiTradingClient';
