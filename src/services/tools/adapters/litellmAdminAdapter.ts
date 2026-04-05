/**
 * LiteLLM Admin Tool Adapter — exposes LiteLLM proxy admin API as a tool adapter.
 *
 * Capabilities:
 *   - proxy.health: check proxy health
 *   - proxy.models: list available models
 *   - proxy.usage: get usage statistics
 *
 * Environment:
 *   LITELLM_BASE_URL — proxy URL (required for reachability)
 *   LITELLM_MASTER_KEY — admin key (optional, for admin endpoints)
 *   LITELLM_ADMIN_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   LITELLM_ADMIN_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.LITELLM_ADMIN_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.LITELLM_ADMIN_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const BASE_URL = String(process.env.LITELLM_BASE_URL || '').trim().replace(/\/+$/, '');
const MASTER_KEY = String(process.env.LITELLM_MASTER_KEY || '').trim();
const TIMEOUT_MS = 10_000;

const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult => ({
  ok,
  adapterId: 'litellm-admin' as ExternalAdapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

const fetchProxy = async (path: string): Promise<{ ok: boolean; status: number; body: unknown }> => {
  if (!BASE_URL) throw new Error('LITELLM_BASE_URL not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (MASTER_KEY) headers['Authorization'] = `Bearer ${MASTER_KEY}`;
    const res = await fetch(`${BASE_URL}${path}`, { signal: controller.signal, headers });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

const checkHealth = async (): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  try {
    const { ok, body } = await fetchProxy('/health/liveliness');
    if (!ok) return makeResult(false, 'proxy.health', 'Proxy unhealthy', [], Date.now() - start, 'UNHEALTHY');
    return makeResult(true, 'proxy.health', 'Proxy healthy', [JSON.stringify(body)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'proxy.health', 'Proxy unreachable', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

const listModels = async (): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  try {
    const { ok, body } = await fetchProxy('/v1/models');
    if (!ok) return makeResult(false, 'proxy.models', 'Model list failed', [], Date.now() - start, 'API_ERROR');
    const data = (body as Record<string, unknown>)?.data;
    const models = Array.isArray(data) ? data.map((m: Record<string, unknown>) => String(m.id || '')) : [];
    return makeResult(true, 'proxy.models', `${models.length} models available`, models, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'proxy.models', 'Model list error', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

const getUsage = async (): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  try {
    // LiteLLM /spend/logs endpoint (requires master key)
    const { ok, body } = await fetchProxy('/global/spend/logs?limit=10');
    if (!ok) return makeResult(false, 'proxy.usage', 'Usage query failed', [], Date.now() - start, 'API_ERROR');
    const logs = Array.isArray(body) ? body.slice(0, 10) : [];
    return makeResult(true, 'proxy.usage', `${logs.length} recent spend entries`, logs.map((l) => JSON.stringify(l)), Date.now() - start);
  } catch (err) {
    return makeResult(false, 'proxy.usage', 'Usage query error', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

export const litellmAdminAdapter: ExternalToolAdapter = {
  id: 'litellm-admin' as ExternalAdapterId,
  capabilities: ['proxy.health', 'proxy.models', 'proxy.usage'],
  liteCapabilities: ['proxy.health', 'proxy.models'],

  isAvailable: async () => {
    if (!isNotDisabled() || !BASE_URL) return false;
    try {
      const { ok } = await fetchProxy('/health/liveliness');
      return ok;
    } catch {
      return false;
    }
  },

  execute: async (action: string, _args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    switch (action) {
      case 'proxy.health': return checkHealth();
      case 'proxy.models': return listModels();
      case 'proxy.usage': return getUsage();
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
