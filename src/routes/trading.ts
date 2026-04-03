import { Router } from 'express';
import type { TradingStrategyConfigPatch } from '../contracts/tradingStrategy';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { closeAiTradingPosition, getAiTradingPosition, isAiTradingConfigured } from '../services/trading/aiTradingClient';
import {
  getTradingEngineRuntimeSnapshot,
  pauseTradingEngine,
  resumeTradingEngine,
  runTradingEngineOnce,
} from '../services/trading/tradingEngine';
import {
  getDefaultTradingStrategyConfig,
  getTradingStrategyConfig,
  resetTradingStrategyConfig,
  updateTradingStrategyConfig,
} from '../services/trading/tradingStrategyService';
import { toStringParam } from '../utils/validation';

export function createTradingRouter(): Router {
  const router = Router();
  const tradingControlRateLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 20,
    keyPrefix: 'trading-control',
    store: 'supabase',
  });

  router.get('/strategy', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const strategy = await getTradingStrategyConfig();
      return res.json({ strategy, defaults: getDefaultTradingStrategyConfig() });
    } catch (error) {
      return res.status(500).json({ error: 'INTERNAL', message: 'Failed to load strategy.' });
    }
  });

  router.put('/strategy', requireAuth, requireAdmin, tradingControlRateLimiter, async (req, res) => {
    const patch = (req.body?.strategy || req.body || {}) as TradingStrategyConfigPatch;
    try {
      const strategy = await updateTradingStrategyConfig(patch);
      return res.json({ ok: true, strategy });
    } catch (error) {
      return res.status(500).json({ error: 'INTERNAL', message: 'Failed to update strategy.' });
    }
  });

  router.post('/strategy/reset', requireAuth, requireAdmin, tradingControlRateLimiter, async (_req, res) => {
    try {
      const strategy = await resetTradingStrategyConfig();
      return res.json({ ok: true, strategy });
    } catch (error) {
      return res.status(500).json({ error: 'INTERNAL', message: 'Failed to reset strategy.' });
    }
  });

  router.get('/runtime', requireAuth, requireAdmin, async (_req, res) => {
    const runtime = getTradingEngineRuntimeSnapshot();
    const strategy = await getTradingStrategyConfig();
    return res.json({ runtime, strategy });
  });

  router.post('/runtime/run-once', requireAuth, requireAdmin, tradingControlRateLimiter, async (_req, res) => {
    const result = await runTradingEngineOnce();
    if (!result.ok) {
      return res.status(409).json(result);
    }
    return res.json(result);
  });

  router.post('/runtime/pause', requireAuth, requireAdmin, tradingControlRateLimiter, async (req, res) => {
    const reason = toStringParam(req.body?.reason) || 'manual';
    const result = pauseTradingEngine(reason);
    if (!result.ok) {
      return res.status(409).json(result);
    }
    return res.json(result);
  });

  router.post('/runtime/resume', requireAuth, requireAdmin, tradingControlRateLimiter, async (_req, res) => {
    const result = resumeTradingEngine();
    if (!result.ok) {
      return res.status(409).json(result);
    }
    return res.json(result);
  });

  router.use((_, res, next) => {
    if (!isAiTradingConfigured()) {
      return res.status(503).json({ error: 'CONFIG', message: 'AI_TRADING is not configured (set proxy or local mode)' });
    }

    next();
  });

  router.get('/position', requireAuth, requireAdmin, async (req, res) => {
    const symbol = toStringParam(req.query.symbol).toUpperCase();
    if (!symbol) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'symbol is required' });
    }

    try {
      const payload = await getAiTradingPosition(symbol);
      const source = typeof payload.source === 'string' ? payload.source : 'ai-trading';
      return res.json({ source, position: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return res.status(502).json({ error: 'UPSTREAM', message });
    }
  });

  router.post('/position/close', requireAuth, requireAdmin, tradingControlRateLimiter, async (req, res) => {
    const symbol = toStringParam(req.body?.symbol || req.query.symbol).toUpperCase();
    if (!symbol) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'symbol is required' });
    }

    try {
      const result = await closeAiTradingPosition(symbol);
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return res.status(502).json({ error: 'UPSTREAM', message });
    }
  });

  return router;
}

export default createTradingRouter;
