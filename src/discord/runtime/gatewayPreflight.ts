import { fetchWithTimeout } from '../../utils/network';
import { getErrorMessage } from '../../utils/errorMessage';

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const SUCCESS_CACHE_TTL_MS = 10 * 60_000;
const FAILURE_CACHE_TTL_MS = 60_000;
const RATE_LIMIT_FALLBACK_MS = 5 * 60_000;

type ProbeResult = {
  ok: boolean;
  restOk: boolean;
  wsOk: boolean | null;
  gatewayUrl: string | null;
  botTag: string | null;
  error: string | null;
  statusCode: number | null;
  blocking: boolean;
  cached: boolean;
  cooldownMs: number;
};

const preflightCache = {
  token: '',
  expiresAt: 0,
  result: null as ProbeResult | null,
};

const normalizeGatewayUrl = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return 'wss://gateway.discord.gg';
  }
  return trimmed.replace(/\/+$/, '');
};

const parseRetryAfterMs = (response: Response): number => {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = Number(retryAfterHeader || '');
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.ceil(retryAfterSeconds * 1000);
  }

  const resetAfterHeader = response.headers.get('x-ratelimit-reset-after');
  const resetAfterSeconds = Number(resetAfterHeader || '');
  if (Number.isFinite(resetAfterSeconds) && resetAfterSeconds > 0) {
    return Math.ceil(resetAfterSeconds * 1000);
  }

  return RATE_LIMIT_FALLBACK_MS;
};

const buildResult = (overrides: Partial<ProbeResult>): ProbeResult => ({
  ok: false,
  restOk: false,
  wsOk: null,
  gatewayUrl: null,
  botTag: null,
  error: null,
  statusCode: null,
  blocking: false,
  cached: false,
  cooldownMs: 0,
  ...overrides,
});

const rememberResult = (token: string, result: ProbeResult, ttlMs: number): ProbeResult => {
  preflightCache.token = token;
  preflightCache.expiresAt = Date.now() + Math.max(1_000, ttlMs);
  preflightCache.result = result;
  return result;
};

const probeGatewayHello = async (gatewayUrl: string, timeoutMs: number): Promise<{ ok: boolean; error: string | null }> => {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => any }).WebSocket;
  if (typeof WebSocketCtor !== 'function') {
    return { ok: false, error: 'global WebSocket unavailable' };
  }

  const wsUrl = `${normalizeGatewayUrl(gatewayUrl)}/?v=10&encoding=json`;

  return await new Promise((resolve) => {
    let settled = false;
    let socket: any = null;
    const finish = (result: { ok: boolean; error: string | null }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close?.();
      } catch {
        // ignore close errors during diagnostics
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'gateway hello timeout' });
    }, timeoutMs);

    try {
      socket = new WebSocketCtor(wsUrl);
      socket.onmessage = (event: { data?: string }) => {
        try {
          const payload = JSON.parse(String(event.data || '{}')) as { op?: number };
          if (payload.op === 10) {
            finish({ ok: true, error: null });
          }
        } catch {
          // ignore non-json frames
        }
      };
      socket.onerror = () => {
        finish({ ok: false, error: 'gateway websocket error' });
      };
      socket.onclose = (event: { code?: number; reason?: string }) => {
        finish({ ok: false, error: `gateway closed code=${String(event.code ?? 'unknown')} reason=${String(event.reason || 'unknown')}` });
      };
    } catch (error) {
      finish({ ok: false, error: getErrorMessage(error) });
    }
  });
};

export async function probeDiscordGatewayConnectivity(token: string, timeoutMs: number): Promise<ProbeResult> {
  const safeTimeoutMs = Math.max(3_000, Number(timeoutMs) || 10_000);
  const normalizedToken = String(token || '').trim();
  if (preflightCache.result && preflightCache.token === normalizedToken && Date.now() < preflightCache.expiresAt) {
    return {
      ...preflightCache.result,
      cached: true,
    };
  }

  const headers = {
    Authorization: `Bot ${normalizedToken}`,
    'User-Agent': 'muel-backend discord preflight',
  };

  try {
    const gatewayResponse = await fetchWithTimeout(`${DISCORD_API_BASE}/gateway/bot`, { headers }, safeTimeoutMs);
    if (!gatewayResponse.ok) {
      if (gatewayResponse.status === 401 || gatewayResponse.status === 403) {
        return rememberResult(normalizedToken, buildResult({
          error: `discord gateway/bot failed status=${gatewayResponse.status}`,
          statusCode: gatewayResponse.status,
          blocking: true,
        }), FAILURE_CACHE_TTL_MS);
      }

      if (gatewayResponse.status === 429) {
        const cooldownMs = parseRetryAfterMs(gatewayResponse);
        return rememberResult(normalizedToken, buildResult({
          error: `discord gateway/bot rate limited status=429`,
          statusCode: 429,
          blocking: false,
          cooldownMs,
        }), cooldownMs);
      }

      return rememberResult(normalizedToken, buildResult({
        error: `discord gateway/bot failed status=${gatewayResponse.status}`,
        statusCode: gatewayResponse.status,
        blocking: false,
      }), FAILURE_CACHE_TTL_MS);
    }

    const gatewayPayload = await gatewayResponse.json() as { url?: string; shards?: number; session_start_limit?: { max_concurrency?: number } };
    const gatewayUrl = normalizeGatewayUrl(String(gatewayPayload.url || ''));
    const wsProbe = await probeGatewayHello(gatewayUrl, safeTimeoutMs);

    return rememberResult(normalizedToken, {
      ok: wsProbe.ok,
      restOk: true,
      wsOk: wsProbe.ok,
      gatewayUrl,
      botTag: null,
      error: wsProbe.error,
      statusCode: 200,
      blocking: false,
      cached: false,
      cooldownMs: wsProbe.ok ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS,
    }, wsProbe.ok ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS);
  } catch (error) {
    return rememberResult(normalizedToken, buildResult({
      error: getErrorMessage(error),
      blocking: false,
    }), FAILURE_CACHE_TTL_MS);
  }
}