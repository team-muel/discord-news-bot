import { Router } from 'express';
import type { TradeStatus } from '../contracts/trade';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { executeAiTradingOrder, isAiTradingConfigured } from '../services/aiTradingClient';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { createTrade, listTrades } from '../services/tradesStore';
import { isOneOf, toBoundedInt, toStringParam } from '../utils/validation';

const TRADE_STATUS_VALUES = ['open', 'closed', 'canceled', 'error'] as const;
const TRADE_SIDE_VALUES = ['long', 'short'] as const;

const toNumericField = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function createTradesRouter(): Router {
  const router = Router();

  router.use((_, res, next) => {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'CONFIG', message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing' });
    }

    next();
  });

  router.get('/', requireAuth, async (req, res) => {
    try {
      const rawStatus = toStringParam(req.query.status);
      const status = isOneOf(rawStatus, TRADE_STATUS_VALUES) ? (rawStatus as TradeStatus) : undefined;
      const rows = await listTrades({
        symbol: toStringParam(req.query.symbol) || undefined,
        status,
        limit: toBoundedInt(req.query.limit, 50, { min: 1, max: 200 }),
      });

      return res.json({ trades: rows });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return res.status(500).json({ error: 'INTERNAL', message });
    }
  });

  router.post('/', requireAdmin, async (req, res) => {
    const symbol = toStringParam(req.body?.symbol).toUpperCase();
    const side = toStringParam(req.body?.side).toLowerCase();
    const entryTs = toStringParam(req.body?.entryTs);
    const entryPrice = toNumericField(req.body?.entryPrice);
    const qty = toNumericField(req.body?.qty);
    const tpPrice = toNumericField(req.body?.tpPrice);
    const slPrice = toNumericField(req.body?.slPrice);
    const statusRaw = toStringParam(req.body?.status).toLowerCase();
    const executeOrder = req.body?.executeOrder === true;

    if (!symbol || !isOneOf(side, TRADE_SIDE_VALUES) || !entryTs || entryPrice === null || qty === null) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD' });
    }

    if (statusRaw && !isOneOf(statusRaw, TRADE_STATUS_VALUES)) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'status is invalid' });
    }

    if (executeOrder && !isAiTradingConfigured()) {
      return res.status(503).json({ error: 'CONFIG', message: 'AI_TRADING is not configured (set proxy or local mode)' });
    }

    try {
      let orderResult: Record<string, unknown> | undefined;
      let mergedOrderIds: Record<string, unknown> | undefined;

      if (executeOrder) {
        const execution = await executeAiTradingOrder({
          symbol,
          side,
          qty,
          entryPrice,
          tpPrice: tpPrice ?? undefined,
          slPrice: slPrice ?? undefined,
          leverage: Number.isFinite(Number(req.body?.leverage)) ? Number(req.body?.leverage) : undefined,
        });

        mergedOrderIds = execution.orderIds;
        orderResult = execution.raw;
      }

      const inputOrderIds =
        req.body?.exchangeOrderIds && typeof req.body.exchangeOrderIds === 'object'
          ? (req.body.exchangeOrderIds as Record<string, unknown>)
          : undefined;
      const exchangeOrderIds = mergedOrderIds ? { ...(inputOrderIds || {}), ...mergedOrderIds } : inputOrderIds;

      const inputMeta = req.body?.meta && typeof req.body.meta === 'object' ? (req.body.meta as Record<string, unknown>) : undefined;
      const meta = executeOrder
        ? {
            ...(inputMeta || {}),
            executionSource: 'ai-trading-managed',
            executionRaw: orderResult,
          }
        : inputMeta;

      const trade = await createTrade({
        exchange: toStringParam(req.body?.exchange) || undefined,
        symbol,
        timeframe: toStringParam(req.body?.timeframe) || undefined,
        side,
        entryTs,
        entryPrice,
        qty,
        tpPrice: tpPrice ?? undefined,
        slPrice: slPrice ?? undefined,
        status: statusRaw ? (statusRaw as TradeStatus) : undefined,
        exchangeOrderIds,
        meta,
      });

      return res.status(201).json({ trade });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      return res.status(500).json({ error: 'INTERNAL', message });
    }
  });

  return router;
}

export default createTradesRouter;
