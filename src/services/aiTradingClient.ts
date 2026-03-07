import {
  AI_TRADING_MODE,
  AI_TRADING_BASE_URL,
  AI_TRADING_INTERNAL_TOKEN,
  AI_TRADING_ORDER_PATH,
  AI_TRADING_POSITION_PATH,
  AI_TRADING_TIMEOUT_MS,
} from '../config';
import type { TradeExecutionRequest, TradeExecutionResult } from '../contracts/trade';
import { executeLocalAiTradingOrder, getLocalAiTradingPosition, isLocalAiTradingConfigured } from './localAiTradingClient';

const sanitizePath = (value: string) => (value.startsWith('/') ? value : `/${value}`);

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const requestWithTimeout = async (input: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export function isAiTradingConfigured(): boolean {
  return resolveTradingMode() !== 'none';
}

export function assertAiTradingConfigured(): void {
  if (!isAiTradingConfigured()) {
    throw new Error('AI_TRADING_NOT_CONFIGURED');
  }
}

function isProxyConfigured(): boolean {
  return Boolean(normalizeBaseUrl(AI_TRADING_BASE_URL) && AI_TRADING_INTERNAL_TOKEN);
}

type TradingMode = 'proxy' | 'local' | 'none';

function resolveTradingMode(): TradingMode {
  const requested = String(AI_TRADING_MODE || 'auto').toLowerCase();

  if (requested === 'proxy') {
    return isProxyConfigured() ? 'proxy' : 'none';
  }
  if (requested === 'local') {
    return isLocalAiTradingConfigured() ? 'local' : 'none';
  }

  if (isProxyConfigured()) return 'proxy';
  if (isLocalAiTradingConfigured()) return 'local';
  return 'none';
}

const buildUrl = (pathValue: string): string => {
  assertAiTradingConfigured();
  return `${normalizeBaseUrl(AI_TRADING_BASE_URL)}${sanitizePath(pathValue)}`;
};

const parseJsonObject = async (response: Response): Promise<Record<string, unknown>> => {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  return payload as Record<string, unknown>;
};

export async function executeAiTradingOrder(input: TradeExecutionRequest): Promise<TradeExecutionResult> {
  const mode = resolveTradingMode();
  if (mode === 'local') {
    return executeLocalAiTradingOrder(input);
  }

  const url = buildUrl(AI_TRADING_ORDER_PATH);
  const response = await requestWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${AI_TRADING_INTERNAL_TOKEN}`,
      },
      body: JSON.stringify(input),
    },
    AI_TRADING_TIMEOUT_MS,
  );

  const payload = await parseJsonObject(response);
  if (!response.ok) {
    const reason = typeof payload.message === 'string' ? payload.message : `HTTP_${response.status}`;
    throw new Error(`AI_TRADING_ORDER_FAILED:${reason}`);
  }

  const orderIds = payload.orderIds;
  return {
    orderIds: orderIds && typeof orderIds === 'object' ? (orderIds as Record<string, unknown>) : undefined,
    raw: payload,
  };
}

export async function getAiTradingPosition(symbol: string): Promise<Record<string, unknown>> {
  const mode = resolveTradingMode();
  if (mode === 'local') {
    return getLocalAiTradingPosition(symbol);
  }

  const url = `${buildUrl(AI_TRADING_POSITION_PATH)}?symbol=${encodeURIComponent(symbol)}`;
  const response = await requestWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${AI_TRADING_INTERNAL_TOKEN}`,
      },
    },
    AI_TRADING_TIMEOUT_MS,
  );

  const payload = await parseJsonObject(response);
  if (!response.ok) {
    const reason = typeof payload.message === 'string' ? payload.message : `HTTP_${response.status}`;
    throw new Error(`AI_TRADING_POSITION_FAILED:${reason}`);
  }

  return payload;
}
