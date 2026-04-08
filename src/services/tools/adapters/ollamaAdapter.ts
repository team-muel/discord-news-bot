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

import { parseBooleanEnv, parseUrlEnv } from '../../../utils/env';
import { fetchWithTimeout } from '../../../utils/network';
import type { ExternalToolAdapter, ExternalAdapterId, ExternalAdapterResult } from '../externalAdapterTypes';
import { makeAdapterResult, isAdapterEnabled } from '../externalAdapterTypes';
import { getErrorMessage } from '../../../utils/errorMessage';

/** Opt-out: disabled only when explicitly turned off. */
const EXPLICITLY_DISABLED = parseBooleanEnv(process.env.OLLAMA_ADAPTER_DISABLED, false);
const LEGACY_ENABLED_RAW = process.env.OLLAMA_ADAPTER_ENABLED;
const isNotDisabled = (): boolean => isAdapterEnabled(EXPLICITLY_DISABLED, LEGACY_ENABLED_RAW);

const BASE_URL = parseUrlEnv(process.env.OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
const TIMEOUT_MS = 15_000;

const ADAPTER_ID = 'ollama' as ExternalAdapterId;
const makeResult = (ok: boolean, action: string, summary: string, output: string[], durationMs: number, error?: string): ExternalAdapterResult =>
  makeAdapterResult(ADAPTER_ID, ok, action, summary, output, durationMs, error);

const fetchOllama = async (path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> => {
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  }, TIMEOUT_MS);
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
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
    return makeResult(false, 'model.list', 'Ollama unreachable', [], Date.now() - start, getErrorMessage(err));
  }
};

const pullModel = async (name: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitized = String(name || '').replace(/[^a-zA-Z0-9:._/-]/g, '').slice(0, 100);
  if (!sanitized) return makeResult(false, 'model.pull', 'Invalid model name', [], 0, 'INVALID_NAME');
  try {
    const { ok, body } = await fetchOllama('/api/pull', {
      method: 'POST',
      body: JSON.stringify({ model: sanitized, stream: false }),
    });
    if (!ok) return makeResult(false, 'model.pull', 'Pull failed', [], Date.now() - start, 'PULL_FAILED');
    return makeResult(true, 'model.pull', `Pulled ${sanitized}`, [JSON.stringify(body)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'model.pull', 'Pull error', [], Date.now() - start, getErrorMessage(err));
  }
};

const modelInfo = async (name: string): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitized = String(name || '').replace(/[^a-zA-Z0-9:._/-]/g, '').slice(0, 100);
  if (!sanitized) return makeResult(false, 'model.info', 'Invalid model name', [], 0, 'INVALID_NAME');
  try {
    const { ok, body } = await fetchOllama('/api/show', {
      method: 'POST',
      body: JSON.stringify({ model: sanitized }),
    });
    if (!ok) return makeResult(false, 'model.info', 'Model not found', [], Date.now() - start, 'NOT_FOUND');
    const info = body as Record<string, unknown>;
    const details = info.details as Record<string, unknown> | undefined;
    const summary = details
      ? `${sanitized}: ${details.parameter_size || 'unknown'} params, ${details.quantization_level || 'unknown'} quant`
      : sanitized;
    return makeResult(true, 'model.info', summary, [JSON.stringify(info)], Date.now() - start);
  } catch (err) {
    return makeResult(false, 'model.info', 'Info error', [], Date.now() - start, getErrorMessage(err));
  }
};

/**
 * Generate text with a model via POST /api/generate.
 * See: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-completion
 */
const inferenceGenerate = async (name: string, prompt: string, options?: Record<string, unknown>): Promise<ExternalAdapterResult> => {
  const start = Date.now();
  const sanitized = String(name || '').replace(/[^a-zA-Z0-9:._/-]/g, '').slice(0, 100);
  if (!sanitized) return makeResult(false, 'inference.generate', 'Model name required', [], 0, 'INVALID_NAME');
  const sanitizedPrompt = String(prompt || '').slice(0, 10_000);
  if (!sanitizedPrompt) return makeResult(false, 'inference.generate', 'Prompt required', [], 0, 'MISSING_PROMPT');

  try {
    const body: Record<string, unknown> = { model: sanitized, prompt: sanitizedPrompt, stream: false };
    if (options?.system && typeof options.system === 'string') body.system = options.system.slice(0, 4000);
    if (options?.format) body.format = options.format;

    const { ok, body: resBody } = await fetchOllama('/api/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!ok) return makeResult(false, 'inference.generate', 'Generation failed', [], Date.now() - start, 'GENERATE_FAILED');

    const result = resBody as Record<string, unknown>;
    const response = typeof result?.response === 'string' ? result.response : JSON.stringify(result).slice(0, 8000);
    return makeResult(true, 'inference.generate', `Generated with ${sanitized}`, response.split('\n').slice(0, 50), Date.now() - start);
  } catch (err) {
    return makeResult(false, 'inference.generate', 'Generation error', [], Date.now() - start, getErrorMessage(err));
  }
};

export const ollamaAdapter: ExternalToolAdapter = {
  id: 'ollama' as ExternalAdapterId,
  description: 'Ollama local LLM — list/pull/inspect models and run local inference for text generation.',
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
      case 'inference.generate': return inferenceGenerate(name, String(args.prompt || ''), args.options as Record<string, unknown> | undefined);
      default:
        return makeResult(false, action, 'Unknown action', [], 0, `UNSUPPORTED_ACTION:${action}`);
    }
  },
};
