/**
 * Shared OpenClaw Gateway health check, session-aware chat, and model cooldown state.
 * Used by both the LLM provider (providers.ts) and the tool adapter (openclawCliAdapter.ts).
 */
import {
  OPENCLAW_GATEWAY_URL,
  OPENCLAW_GATEWAY_TOKEN,
  OPENCLAW_GATEWAY_ENABLED,
  OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS,
} from '../../config';
import { fetchWithTimeout } from '../../utils/network';
import logger from '../../logger';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

// ──── Gateway Health ─────────────────────────────────────────────────────────

const HEALTH_CACHE_TTL_MS = 15_000;

let healthy: boolean | null = null;
let checkedAt = 0;

/** Record gateway health transition to Supabase observations (best-effort). */
const recordHealthTransition = (prev: boolean | null, next: boolean): void => {
  if (prev === next) return; // no transition
  const severity = next ? 'info' : 'warning';
  const title = next ? 'openclaw_gateway_recovered' : 'openclaw_gateway_unhealthy';
  logger.info('[OPENCLAW] gateway health: %s -> %s', prev, next);
  if (!isSupabaseConfigured()) return;
  const sb = getSupabaseClient();
  sb.from('observations').insert({
    channel: 'openclaw',
    severity,
    title,
    payload: { url: OPENCLAW_GATEWAY_URL, prev, next },
    detected_at: new Date().toISOString(),
  }).then(({ error }) => {
    if (error) logger.debug('[OPENCLAW] health observation write failed: %s', error.message);
  });
};

export const checkOpenClawGatewayHealth = async (): Promise<boolean> => {
  if (!OPENCLAW_GATEWAY_URL || !OPENCLAW_GATEWAY_ENABLED) return false;

  const now = Date.now();
  if (healthy === false && (now - checkedAt) < HEALTH_CACHE_TTL_MS) return false;
  if (healthy === true && (now - checkedAt) < HEALTH_CACHE_TTL_MS) return true;

  const prev = healthy;
  try {
    const resp = await fetchWithTimeout(`${OPENCLAW_GATEWAY_URL}/healthz`, {}, 3000);
    healthy = !!resp?.ok;
  } catch {
    healthy = false;
  }
  checkedAt = now;
  recordHealthTransition(prev, !!healthy);
  return !!healthy;
};

export const markGatewayUnhealthy = (): void => {
  const prev = healthy;
  healthy = false;
  checkedAt = Date.now();
  recordHealthTransition(prev, false);
};

export const isGatewayHealthy = (): boolean | null => healthy;

export const getGatewayHeaders = (): Record<string, string> => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OPENCLAW_GATEWAY_TOKEN) h['Authorization'] = `Bearer ${OPENCLAW_GATEWAY_TOKEN}`;
  return h;
};

// ──── Session-Aware Gateway Chat ─────────────────────────────────────────────

export type GatewayChatParams = {
  user: string;
  system: string;
  sessionId?: string;
  guildId?: string;
  actionName?: string;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Send a session-aware chat request via the OpenClaw Gateway's OpenAI-compatible endpoint.
 * Returns null if the gateway is unavailable or returns an error.
 */
export const sendGatewayChat = async (params: GatewayChatParams): Promise<string | null> => {
  const gatewayOk = await checkOpenClawGatewayHealth();
  if (!gatewayOk) return null;

  const headers = getGatewayHeaders();

  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.user });

    const resp = await fetchWithTimeout(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages,
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 1000,
      }),
    }, 30_000);

    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, any>;
    const text = String(data?.choices?.[0]?.message?.content || data?.response || '').trim();
    return text.length > 0 ? text : null;
  } catch {
    markGatewayUnhealthy();
    return null;
  }
};

// ──── Model Cooldown ─────────────────────────────────────────────────────────

const modelCooldownUntilMs = new Map<string, number>();

export const isModelOnCooldown = (model: string): boolean =>
  (modelCooldownUntilMs.get(model) || 0) > Date.now();

export const getModelCooldownUntil = (model: string): number =>
  modelCooldownUntilMs.get(model) || 0;

export const setModelCooldown = (model: string, untilMs: number): void => {
  modelCooldownUntilMs.set(model, untilMs);
};

export const parseRetryDelayMs = (body: string): number => {
  const text = String(body || '');
  const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (retryDelayMatch?.[1]) return Math.max(1_000, Number(retryDelayMatch[1]) * 1000);
  const pleaseRetryMatch = text.match(/Please retry in\s*([0-9.]+)s/i);
  if (pleaseRetryMatch?.[1]) return Math.max(1_000, Math.round(Number(pleaseRetryMatch[1]) * 1000));
  return OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS;
};

export const getModelCooldownSnapshot = (): Array<{ model: string; untilMs: number }> =>
  [...modelCooldownUntilMs.entries()]
    .filter(([, until]) => until > Date.now())
    .map(([model, untilMs]) => ({ model, untilMs }));

export const __resetGatewayHealthStateForTests = (): void => {
  healthy = null;
  checkedAt = 0;
  modelCooldownUntilMs.clear();
};
