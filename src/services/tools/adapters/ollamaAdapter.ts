/**
 * Ollama Tool Adapter — exposes local Ollama model management as a tool adapter.
 *
 * Capabilities:
 *   - model.list: list installed models
 *   - model.pull: pull a model by name
 *   - model.info: get model metadata
 *   - inference.generate: generate text with a model
 *
 * Environment:
 *   OLLAMA_BASE_URL — default http://127.0.0.1:11434
 *   OLLAMA_ADAPTER_DISABLED — set true to force-disable (opt-out)
 *   OLLAMA_ADAPTER_ENABLED — legacy flag (false = disabled, for backward compat)
 */

import { parseBooleanEnv } from '../../../utils/env';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.OLLAMA_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.OLLAMA_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => !EXPLICITLY_DISABLED && LEGACY_ENABLED_RAW !== 'false';

const BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
const TIMEOUT_MS = 15_000;

const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult => ({
  ok,
  adapterId: 'ollama' as ExternalAdapterId,
  action,
  summary,
  output,
  durationMs,
  ...(error ? { error } : {}),
});

const fetchOllama = async (path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
};

const listModels = async (): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  try {
    const { ok, body } = await fetchOllama('/api/tags');
    if (!ok) return makeResult(false, 'model.list', 'Ollama API error', [], Date.now() - start, 'API_ERROR');
    const models = ((body as Record<string, unknown>)?.models as Array<Record<string, unknown>>) || [];
    const names = models.map((m) => String(m.name || ''));
    return makeResult(true, 'model.list', `${names.length} models installed`, names, Date.now() - start);
  } catch (err) {
    return makeResult(false, 'model.list', 'Ollama unreachable', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

const pullModel = async (name: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitized = String(name || '').replace(/[^a-zA-Z0-9:._/-]/g, '').slice(0, 100);
  if (!sanitized) return makeResult(false, 'model.pull', 'Invalid model name', [], 0, 'INVALID_NAME');
  try {
    const { ok, body } = await fetchOllama('/api/pull', {
      method: 'POST',
      body: JSON.stringify({ name: sanitized, stream: false }),
    });
    if (!ok) return makeResult(false, 'model.pull', 'Pull failed', [], Date.now() - start, 'PULL_FAILED');
    return makeResult(true, 'model.pull', `Pulled ${sanitized}`, [JSON.stringify(body)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'model.pull', 'Pull error', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

const modelInfo = async (name: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitized = String(name || '').replace(/[^a-zA-Z0-9:._/-]/g, '').slice(0, 100);
  if (!sanitized) return makeResult(false, 'model.info', 'Invalid model name', [], 0, 'INVALID_NAME');
  try {
    const { ok, body } = await fetchOllama('/api/show', {
      method: 'POST',
      body: JSON.stringify({ name: sanitized }),
    });
    if (!ok) return makeResult(false, 'model.info', 'Model not found', [], Date.now() - start, 'NOT_FOUND');
    const info = body as Record<string, unknown>;
    const details = info.details as Record<string, unknown> | undefined;
    const summary = details
      ? `${sanitized}: ${details.parameter_size || 'unknown'} params, ${details.quantization_level || 'unknown'} quant`
      : sanitized;
    return makeResult(true, 'model.info', summary, [JSON.stringify(info)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'model.info', 'Info error', [], Date.now() - start, err instanceof Error ? err.message : String(err));
  }
};

export const ollamaAdapter: ExternalToolAdapter = {
  id: 'ollama' as ExternalAdapterId,
  capabilities: ['model.list', 'model.pull', 'model.info', 'inference.generate'],
  liteCapabilities: ['model.list', 'model.info'],

  isAvailable: async () => {
    if (!isNotDisabled()) return false;
    try {
      const { ok } = await fetchOllama('/api/tags');
      return ok;
    } catch {
      return false;
    }
  },

  execute: async (action: string, args: Record<string, unknown>): Promise<ExternalAdapterResult> => {
    const name = String(args.name || args.model || '');
    switch (action) {
      case 'model.list': return listModels();
      case 'model.pull': return pullModel(name);
      case 'model.info': return modelInfo(name);
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
