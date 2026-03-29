import { Router } from 'express';
import type { TradeStatus } from '../contracts/trade';
import { MAX_MANUAL_TRADE_ENTRY_PRICE, MAX_MANUAL_TRADE_LEVERAGE, MAX_MANUAL_TRADE_QTY } from '../config';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { executeAiTradingOrder, isAiTradingConfigured } from '../services/aiTradingClient';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { createTrade, listTrades } from '../services/tradesStore';
import { isOneOf, sanitizeRecord, toBoundedInt, toStringParam } from '../utils/validation';

const TRADE_STATUS_VALUES = ['open', 'closed', 'canceled', 'error'] as const;
const TRADE_SIDE_VALUES = ['long', 'short'] as const;

const POST_RATE_WINDOW_MS = 60_000;
const POST_RATE_MAX = 30;
const EXEC_RATE_WINDOW_MS = 60_000;
const EXEC_RATE_MAX = 8;
const MAX_RATE_KEYS = 2_000;
const userPostTimestamps = new Map<string, number[]>();
const userExecTimestamps = new Map<string, number[]>();

const allowWithinRate = (store: Map<string, number[]>, key: string, limit: number, windowMs: number): boolean => {
  const now = Date.now();
  const next = (store.get(key) || []).filter((ts) => now - ts < windowMs);
  if (next.length === 0) {
    store.delete(key);
  }
  if (next.length >= limit) {
    store.set(key, next);
    return false;
  }

  if (store.size >= MAX_RATE_KEYS && !store.has(key)) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  next.push(now);
  store.set(key, next);
  return true;
};

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
    const leverage = Number.isFinite(Number(req.body?.leverage)) ? Number(req.body?.leverage) : undefined;
    const statusRaw = toStringParam(req.body?.status).toLowerCase();
    const executeOrder = req.body?.executeOrder === true;

    if (!symbol || !isOneOf(side, TRADE_SIDE_VALUES) || !entryTs || entryPrice === null || qty === null) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD' });
    }

    if (entryPrice <= 0 || qty <= 0) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'entryPrice and qty must be positive numbers' });
    }

    if (tpPrice !== null && tpPrice <= 0) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'tpPrice must be a positive number when provided' });
    }

    if (slPrice !== null && slPrice <= 0) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'slPrice must be a positive number when provided' });
    }

    if (qty > MAX_MANUAL_TRADE_QTY) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: `qty exceeds MAX_MANUAL_TRADE_QTY (${MAX_MANUAL_TRADE_QTY})` });
    }

    if (entryPrice > MAX_MANUAL_TRADE_ENTRY_PRICE) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: `entryPrice exceeds MAX_MANUAL_TRADE_ENTRY_PRICE (${MAX_MANUAL_TRADE_ENTRY_PRICE})` });
    }

    if (leverage !== undefined && (leverage <= 0 || leverage > MAX_MANUAL_TRADE_LEVERAGE)) {
      return res.status(422).json({
        error: 'INVALID_PAYLOAD',
        message: `leverage must be > 0 and <= MAX_MANUAL_TRADE_LEVERAGE (${MAX_MANUAL_TRADE_LEVERAGE})`,
      });
    }

    if (statusRaw && !isOneOf(statusRaw, TRADE_STATUS_VALUES)) {
      return res.status(422).json({ error: 'INVALID_PAYLOAD', message: 'status is invalid' });
    }

    if (executeOrder && !isAiTradingConfigured()) {
      return res.status(503).json({ error: 'CONFIG', message: 'AI_TRADING is not configured (set proxy or local mode)' });
    }

    const requesterKey = req.user?.id || 'unknown';
    if (!allowWithinRate(userPostTimestamps, requesterKey, POST_RATE_MAX, POST_RATE_WINDOW_MS)) {
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many trade requests. Please retry shortly.' });
    }

    if (executeOrder && !allowWithinRate(userExecTimestamps, requesterKey, EXEC_RATE_MAX, EXEC_RATE_WINDOW_MS)) {
      return res.status(429).json({ error: 'RATE_LIMIT', message: 'Too many executeOrder requests. Please retry shortly.' });
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
          leverage,
        });

        mergedOrderIds = execution.orderIds;
        orderResult = execution.raw;
      }

      const inputOrderIds = sanitizeRecord(req.body?.exchangeOrderIds) || undefined;
      const exchangeOrderIds = mergedOrderIds ? { ...(inputOrderIds || {}), ...mergedOrderIds } : inputOrderIds;

      const inputMeta = sanitizeRecord(req.body?.meta) || undefined;
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
      return res.status(500).json({ error: 'INTERNAL', message: 'Trade operation failed.' });
    }
  });

  return router;
}

export default createTradesRouter;
