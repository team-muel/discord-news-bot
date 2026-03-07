import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { getAiTradingPosition, isAiTradingConfigured } from '../services/aiTradingClient';
import { toStringParam } from '../utils/validation';

export function createTradingRouter(): Router {
  const router = Router();

  router.use((_, res, next) => {
    if (!isAiTradingConfigured()) {
      return res.status(503).json({ error: 'CONFIG', message: 'AI_TRADING proxy is not configured' });
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
      return res.json({ source: 'ai-trading', position: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return res.status(502).json({ error: 'UPSTREAM', message });
    }
  });

  return router;
}

export default createTradingRouter;
