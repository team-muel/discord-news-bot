const DISCORD_API_BASE = 'https://discord.com/api/v10';

type ProbeResult = {
  ok: boolean;
  restOk: boolean;
  wsOk: boolean | null;
  gatewayUrl: string | null;
  botTag: string | null;
  error: string | null;
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeGatewayUrl = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return 'wss://gateway.discord.gg';
  }
  return trimmed.replace(/\/+$/, '');
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
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
};

export async function probeDiscordGatewayConnectivity(token: string, timeoutMs: number): Promise<ProbeResult> {
  const safeTimeoutMs = Math.max(3_000, Number(timeoutMs) || 10_000);
  const headers = {
    Authorization: `Bot ${String(token || '').trim()}`,
    'User-Agent': 'muel-backend discord preflight',
  };

  try {
    const meResponse = await fetchWithTimeout(`${DISCORD_API_BASE}/users/@me`, { headers }, safeTimeoutMs);
    if (!meResponse.ok) {
      return {
        ok: false,
        restOk: false,
        wsOk: null,
        gatewayUrl: null,
        botTag: null,
        error: `discord users/@me failed status=${meResponse.status}`,
      };
    }

    const me = await meResponse.json() as { username?: string; discriminator?: string; id?: string };
    const botTag = me.username
      ? `${me.username}${me.discriminator && me.discriminator !== '0' ? `#${me.discriminator}` : ''} (${String(me.id || '').trim()})`
      : String(me.id || '').trim() || null;

    const gatewayResponse = await fetchWithTimeout(`${DISCORD_API_BASE}/gateway/bot`, { headers }, safeTimeoutMs);
    if (!gatewayResponse.ok) {
      return {
        ok: false,
        restOk: true,
        wsOk: null,
        gatewayUrl: null,
        botTag,
        error: `discord gateway/bot failed status=${gatewayResponse.status}`,
      };
    }

    const gatewayPayload = await gatewayResponse.json() as { url?: string };
    const gatewayUrl = normalizeGatewayUrl(String(gatewayPayload.url || ''));
    const wsProbe = await probeGatewayHello(gatewayUrl, safeTimeoutMs);

    return {
      ok: wsProbe.ok,
      restOk: true,
      wsOk: wsProbe.ok,
      gatewayUrl,
      botTag,
      error: wsProbe.error,
    };
  } catch (error) {
    return {
      ok: false,
      restOk: false,
      wsOk: null,
      gatewayUrl: null,
      botTag: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}