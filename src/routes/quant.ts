import { Router, Response, type RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../types';
import { isPresetAdmin } from '../backend/isPresetAdmin';

type QuantControlBody = {
  symbol?: string;
  strategy?: string;
  leverage?: number;
  riskLimitPct?: number;
  pollIntervalSec?: number;
};

type QuantRoutesDeps = {
  requireAuth: RequestHandler;
  requireAuthAndCsrf: RequestHandler;
};

type QuantSessionParams = {
  symbol: string;
  strategy: string;
  leverage: number;
  riskLimitPct: number;
  pollIntervalSec: number;
};

type QuantSessionState = {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  updatedAt: string;
  params: QuantSessionParams;
};

const DEFAULT_PARAMS: QuantSessionParams = {
  symbol: 'BTCUSDT',
  strategy: 'mean-reversion',
  leverage: 3,
  riskLimitPct: 1.5,
  pollIntervalSec: 15,
};

const quantSessionState: QuantSessionState = {
  running: false,
  startedAt: null,
  stoppedAt: null,
  updatedAt: new Date().toISOString(),
  params: { ...DEFAULT_PARAMS },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const applyParamsPatch = (body: QuantControlBody) => {
  if (typeof body.symbol === 'string' && body.symbol.trim()) {
    quantSessionState.params.symbol = body.symbol.trim().toUpperCase().slice(0, 24);
  }
  if (typeof body.strategy === 'string' && body.strategy.trim()) {
    quantSessionState.params.strategy = body.strategy.trim().slice(0, 64);
  }
  if (typeof body.leverage === 'number' && Number.isFinite(body.leverage)) {
    quantSessionState.params.leverage = clamp(body.leverage, 1, 50);
  }
  if (typeof body.riskLimitPct === 'number' && Number.isFinite(body.riskLimitPct)) {
    quantSessionState.params.riskLimitPct = clamp(body.riskLimitPct, 0.1, 25);
  }
  if (typeof body.pollIntervalSec === 'number' && Number.isFinite(body.pollIntervalSec)) {
    quantSessionState.params.pollIntervalSec = clamp(Math.round(body.pollIntervalSec), 1, 300);
  }

  quantSessionState.updatedAt = new Date().toISOString();
};

const buildQuantPanelPayload = () => {
  const now = new Date().toISOString();
  const runningBias = quantSessionState.running ? 1 : -1;
  const strategyBias = quantSessionState.params.strategy.toLowerCase().includes('momentum') ? 1 : -1;
  const leverageBias = quantSessionState.params.leverage / 10;
  const riskBias = quantSessionState.params.riskLimitPct / 10;

  const baseExposure = 18 + leverageBias * 7 + runningBias * 9;
  const baseWinRate = 51 + strategyBias * 2.6 + runningBias * 1.8 - riskBias * 1.2;
  const baseCvd = 8 + runningBias * 4 + leverageBias * 2.2;

  return {
    source: 'backend',
    session: quantSessionState,
    metrics: [
      {
        id: 'position',
        label: `${quantSessionState.params.symbol} Exposure`,
        value: Number(clamp(baseExposure, 0, 100).toFixed(2)),
        unit: '%',
        change: Number((runningBias * 1.5 + leverageBias).toFixed(2)),
        trend: runningBias >= 0 ? 'up' : 'down',
        updatedAt: now,
      },
      {
        id: 'winRate',
        label: 'Execution Quality',
        value: Number(clamp(baseWinRate, 0, 100).toFixed(2)),
        unit: '%',
        change: Number((strategyBias * 0.7 - riskBias * 0.5).toFixed(2)),
        trend: strategyBias >= 0 ? 'up' : 'down',
        updatedAt: now,
      },
      {
        id: 'cvd',
        label: 'Order Flow Delta',
        value: Number(clamp(baseCvd, -80, 80).toFixed(2)),
        unit: 'pts',
        change: Number((runningBias * 0.9 + leverageBias * 0.4).toFixed(2)),
        trend: quantSessionState.running ? 'up' : 'flat',
        updatedAt: now,
      },
    ],
  };
};

export const createQuantRouter = ({
  requireAuth,
  requireAuthAndCsrf,
}: QuantRoutesDeps) => {
  const router = Router();

  const requirePresetAdminAsync: RequestHandler = async (req, res, next) => {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId || !(await isPresetAdmin(userId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };

  router.get('/api/quant/panel', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    return res.status(200).json(buildQuantPanelPayload());
  });

  router.get('/api/quant/session', requireAuth, requirePresetAdminAsync, (_req: AuthenticatedRequest, res: Response) => {
    return res.status(200).json({
      session: quantSessionState,
    });
  });

  router.post('/api/quant/session/start', requireAuthAndCsrf, requirePresetAdminAsync, (req: AuthenticatedRequest, res: Response) => {
    const body = (req.body || {}) as QuantControlBody;
    applyParamsPatch(body);

    quantSessionState.running = true;
    quantSessionState.startedAt = new Date().toISOString();
    quantSessionState.updatedAt = quantSessionState.startedAt;

    return res.status(200).json({
      ok: true,
      action: 'start',
      session: quantSessionState,
    });
  });

  router.post('/api/quant/session/stop', requireAuthAndCsrf, requirePresetAdminAsync, (_req: AuthenticatedRequest, res: Response) => {
    quantSessionState.running = false;
    quantSessionState.stoppedAt = new Date().toISOString();
    quantSessionState.updatedAt = quantSessionState.stoppedAt;

    return res.status(200).json({
      ok: true,
      action: 'stop',
      session: quantSessionState,
    });
  });

  router.post('/api/quant/session/params', requireAuthAndCsrf, requirePresetAdminAsync, (req: AuthenticatedRequest, res: Response) => {
    const body = (req.body || {}) as QuantControlBody;
    applyParamsPatch(body);

    return res.status(200).json({
      ok: true,
      action: 'params',
      session: quantSessionState,
    });
  });

  router.get('/api/quant/routes', requireAuth, requirePresetAdminAsync, (_req: AuthenticatedRequest, res: Response) => {
    return res.status(200).json({
      frontendToBackendBase: '/api',
      quantEndpoints: {
        panel: '/api/quant/panel',
        session: '/api/quant/session',
        start: '/api/quant/session/start',
        stop: '/api/quant/session/stop',
        params: '/api/quant/session/params',
      },
      controls: {
        startMethod: 'POST',
        stopMethod: 'POST',
        paramsMethod: 'POST',
      },
    });
  });

  return router;
};
