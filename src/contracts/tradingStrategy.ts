export type TradingSignalMode = 'cvd_sma_cross' | 'price_sma_cross';

export type TradingStrategyConfig = {
  enabled: boolean;
  symbols: string[];
  timeframe: string;
  signal: {
    mode: TradingSignalMode;
    cvdLen: number;
    deltaCoef: number;
    priceSmaLen: number;
    allowLong: boolean;
    allowShort: boolean;
  };
  risk: {
    initialCapital: number;
    equitySplit: boolean;
    riskPct: number;
    leverage: number;
    maxQty: number;
  };
  exit: {
    tpPct: number;
    slPct: number;
    enableTp: boolean;
    enableSl: boolean;
  };
  runtime: {
    dryRun: boolean;
    pollSeconds: number;
    candleLookback: number;
    tickFetchLimit: number;
    tickMaxPages: number;
    symbolConcurrency: number;
    tickYieldEvery: number;
    maxTicksPerCycle: number;
    memorySoftLimitMb: number;
  };
};

export type TradingStrategyConfigPatch = Partial<{
  enabled: boolean;
  symbols: string[];
  timeframe: string;
  signal: Partial<TradingStrategyConfig['signal']>;
  risk: Partial<TradingStrategyConfig['risk']>;
  exit: Partial<TradingStrategyConfig['exit']>;
  runtime: Partial<TradingStrategyConfig['runtime']>;
}>;
