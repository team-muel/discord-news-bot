/**
 * LLM Client entry point — generateText, cache, call logging, quality scoring.
 * Re-exports public types and helpers from providers and routing.
 */
import crypto from 'crypto';
import {
  ANTHROPIC_MODEL,
  GEMINI_MODEL,
  HUGGINGFACE_MODEL,
  KIMI_MODEL,
  LITELLM_MODEL,
  LLM_CALL_LOG_ENABLED,
  LLM_CALL_LOG_TABLE,
  LLM_COST_INPUT_PER_1K_CHARS_USD,
  LLM_COST_OUTPUT_PER_1K_CHARS_USD,
  LLM_HEDGE_DELAY_MS,
  LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED,
  LLM_PROVIDER_TOTAL_TIMEOUT_MS,
  LLM_RESPONSE_CACHE_ENABLED,
  LLM_RESPONSE_CACHE_MAX_ENTRIES,
  LLM_RESPONSE_CACHE_TTL_MS,
  OLLAMA_MODEL,
  OPENCLAW_MODEL,
  OPENAI_ANALYSIS_MODEL,
  OPENJARVIS_MODEL,
} from '../../config';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import {
  type LlmProvider,
  type LlmTextRequest,
  type LlmTextWithMetaResponse,
  requestOpenAiWithMeta,
  requestGemini,
  requestAnthropic,
  requestHuggingFace,
  requestOpenClaw,
  requestOllama,
  requestOpenJarvis,
  requestLiteLLM,
  requestKimi,
} from './providers';
import {
  type LlmExperimentDecision,
  resolveProviderWithExperiment,
  resolveProviderChain,
  resolveWorkflowModelBinding,
  resolveLlmProvider,
} from './routing';
import { getErrorMessage } from '../../utils/errorMessage';

// ──── Re-exports (public API) ────────────────────────────────────────────────

export type { LlmProvider, LlmProviderProfile, LlmTextRequest, LlmTextWithMetaResponse } from './providers';
export { isAnyLlmConfigured, isProviderConfigured } from './providers';
export { resolveLlmProvider, setGateProviderProfileOverride, getGateProviderProfileOverride, resetGateProviderProfileOverride } from './routing';

// ──── Response Cache ─────────────────────────────────────────────────────────

type CachedLlmResponse = {
  response: LlmTextWithMetaResponse;
  expiresAt: number;
};

const llmResponseCache = new Map<string, CachedLlmResponse>();

const buildCacheKey = (params: LlmTextRequest): string | null => {
  const temp = params.temperature ?? 0.7;
  if (temp > 0.1) return null;
  if (String(params.user || '').length > 8_000) return null;

  const raw = [
    params.system || '',
    params.user || '',
    String(temp),
    String(params.topP ?? ''),
    String(params.maxTokens ?? ''),
    params.provider || '',
    params.model || '',
  ].join('::');
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 24);
};

const getCachedResponse = (key: string): LlmTextWithMetaResponse | null => {
  const entry = llmResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    llmResponseCache.delete(key);
    return null;
  }
  return entry.response;
};

const setCachedResponse = (key: string, response: LlmTextWithMetaResponse): void => {
  if (llmResponseCache.size >= LLM_RESPONSE_CACHE_MAX_ENTRIES) {
    const firstKey = llmResponseCache.keys().next().value;
    if (firstKey) llmResponseCache.delete(firstKey);
  }
  llmResponseCache.set(key, { response, expiresAt: Date.now() + LLM_RESPONSE_CACHE_TTL_MS });
};

// ──── Cost & Quality ─────────────────────────────────────────────────────────

const estimateLlmCallCostUsd = (inputChars: number, outputChars: number): number => {
  const inCost = (Math.max(0, inputChars) / 1000) * LLM_COST_INPUT_PER_1K_CHARS_USD;
  const outCost = (Math.max(0, outputChars) / 1000) * LLM_COST_OUTPUT_PER_1K_CHARS_USD;
  return Number((inCost + outCost).toFixed(8));
};

const computeNormalizedQualityScore = (response: LlmTextWithMetaResponse, latencyMs: number): number => {
  const latencyScore = 1 / (1 + latencyMs / 5000);
  const logprobScore = typeof response.avgLogprob === 'number' && Number.isFinite(response.avgLogprob)
    ? Math.max(0, Math.min(1, (response.avgLogprob + 5) / 5))
    : 0.5;
  const outputLen = String(response.text || '').length;
  const completenessScore = outputLen >= 50 ? 1.0 : outputLen >= 10 ? 0.7 : outputLen > 0 ? 0.3 : 0;
  return Number((latencyScore * 0.25 + logprobScore * 0.50 + completenessScore * 0.25).toFixed(4));
};

// ──── Call Logging ───────────────────────────────────────────────────────────

const persistLlmCallLog = async (params: {
  request: LlmTextRequest;
  provider: LlmProvider;
  model?: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
  outputText?: string;
  avgLogprob?: number;
  experiment?: LlmTextWithMetaResponse['experiment'];
  estimatedCostUsd?: number;
  qualityScore?: number;
}): Promise<void> => {
  if (!LLM_CALL_LOG_ENABLED || !isSupabaseConfigured()) return;

  try {
    const inputChars = String(params.request.system || '').length + String(params.request.user || '').length;
    const outputChars = String(params.outputText || '').length;
    const client = getSupabaseClient();
    await client.from(LLM_CALL_LOG_TABLE).insert({
      guild_id: String(params.request.guildId || '').trim() || null,
      session_id: String(params.request.sessionId || '').trim() || null,
      requested_by: String(params.request.requestedBy || '').trim() || null,
      action_name: String(params.request.actionName || '').trim() || null,
      provider: params.provider,
      model: String(params.model || '').trim() || null,
      experiment_name: String(params.experiment?.name || '').trim() || null,
      experiment_arm: String(params.experiment?.arm || '').trim() || null,
      experiment_key_hash: String(params.experiment?.keyHash || '').trim() || null,
      latency_ms: Math.max(0, Math.trunc(params.latencyMs || 0)),
      success: params.success,
      error_code: String(params.errorCode || '').trim() || null,
      prompt_chars: inputChars,
      output_chars: outputChars,
      avg_logprob: params.avgLogprob ?? null,
      estimated_cost_usd: typeof params.estimatedCostUsd === 'number'
        ? Math.max(0, Number(params.estimatedCostUsd))
        : estimateLlmCallCostUsd(inputChars, outputChars),
      quality_score: typeof params.qualityScore === 'number' ? params.qualityScore : null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // LLM observability logging is best-effort and must not block runtime flow.
  }
};

// ──── Entry Points ───────────────────────────────────────────────────────────

export const generateText = async (params: LlmTextRequest): Promise<string> => {
  const response = await generateTextWithMeta(params);
  return response.text;
};

export const generateTextWithMeta = async (
  params: LlmTextRequest & { includeLogprobs?: boolean },
): Promise<LlmTextWithMetaResponse> => {
  const cacheKey = LLM_RESPONSE_CACHE_ENABLED ? buildCacheKey(params) : null;
  if (cacheKey) {
    const cached = getCachedResponse(cacheKey);
    if (cached) return { ...cached, latencyMs: 0, estimatedCostUsd: 0 };
  }

  const selection = resolveProviderWithExperiment(params);
  const provider = selection.provider || resolveLlmProvider();
  if (!provider) throw new Error('LLM_PROVIDER_NOT_CONFIGURED');

  const startedAt = Date.now();
  const requestInputChars = String(params.system || '').length + String(params.user || '').length;
  const providerChain = resolveProviderChain(params, provider, selection);
  const providerChainDeadlineMs = startedAt + LLM_PROVIDER_TOTAL_TIMEOUT_MS;

  const cachedWorkflowBinding = resolveWorkflowModelBinding(params.actionName);
  const resolveModel = (p: LlmProvider): string | undefined => {
    if (params.model) return params.model;
    if (cachedWorkflowBinding && cachedWorkflowBinding.provider === p) return cachedWorkflowBinding.model;
    if (p === 'openai') return OPENAI_ANALYSIS_MODEL;
    if (p === 'gemini') return GEMINI_MODEL;
    if (p === 'anthropic') return ANTHROPIC_MODEL;
    if (p === 'huggingface') return HUGGINGFACE_MODEL;
    if (p === 'openclaw') return OPENCLAW_MODEL;
    if (p === 'ollama') return OLLAMA_MODEL || 'qwen2.5:3b-instruct';
    if (p === 'openjarvis') return OPENJARVIS_MODEL || 'qwen2.5:7b-instruct';
    if (p === 'litellm') return LITELLM_MODEL;
    if (p === 'kimi') return KIMI_MODEL;
    return undefined;
  };

  const callProvider = async (targetProvider: LlmProvider): Promise<LlmTextWithMetaResponse> => {
    if (targetProvider === 'openai') {
      const response = await requestOpenAiWithMeta(params, Boolean(params.includeLogprobs));
      return { ...response, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'anthropic') return { text: await requestAnthropic(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'huggingface') return { text: await requestHuggingFace(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'openclaw') return { text: await requestOpenClaw(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'ollama') return { text: await requestOllama(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'openjarvis') return { text: await requestOpenJarvis(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'litellm') return { text: await requestLiteLLM(params), provider: targetProvider, model: resolveModel(targetProvider) };
    if (targetProvider === 'kimi') return { text: await requestKimi(params), provider: targetProvider, model: resolveModel(targetProvider) };
    return { text: await requestGemini(params), provider: 'gemini', model: resolveModel('gemini') };
  };

  try {
    let response: LlmTextWithMetaResponse | null = null;
    let lastError: unknown = null;
    let finalProvider: LlmProvider = provider;

    const canHedge = LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED
      && LLM_HEDGE_DELAY_MS > 0
      && providerChain.length >= 2;

    if (canHedge) {
      const [primary, secondary] = providerChain;
      const hedged = await new Promise<{ response: LlmTextWithMetaResponse; provider: LlmProvider }>((resolve, reject) => {
        let settled = false;
        let failures = 0;
        const settle = (res: LlmTextWithMetaResponse, p: LlmProvider) => {
          if (!settled) { settled = true; resolve({ response: res, provider: p }); }
        };
        const fail = (err: unknown) => {
          failures += 1;
          if (failures >= 2 || (failures >= 1 && !hedgeTimer)) {
            reject(err instanceof Error ? err : new Error('LLM_REQUEST_FAILED'));
          }
        };

        callProvider(primary).then((r) => settle(r, primary)).catch(fail);

        let hedgeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
          hedgeTimer = null;
          if (!settled && Date.now() <= providerChainDeadlineMs) {
            callProvider(secondary).then((r) => settle(r, secondary)).catch(fail);
          }
        }, LLM_HEDGE_DELAY_MS);

        setTimeout(() => {
          if (!settled) { settled = true; reject(new Error('LLM_PROVIDER_CHAIN_TIMEOUT')); }
        }, Math.max(0, providerChainDeadlineMs - Date.now()));
      });

      response = hedged.response;
      finalProvider = hedged.provider;
    } else {
      for (const targetProvider of providerChain) {
        if (Date.now() > providerChainDeadlineMs) {
          lastError = new Error('LLM_PROVIDER_CHAIN_TIMEOUT');
          break;
        }
        try {
          response = await callProvider(targetProvider);
          finalProvider = targetProvider;
          break;
        } catch (error) {
          lastError = error;
          finalProvider = targetProvider;
        }
      }
    }

    if (!response) throw (lastError instanceof Error ? lastError : new Error('LLM_REQUEST_FAILED'));

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const estimatedCostUsd = estimateLlmCallCostUsd(requestInputChars, String(response.text || '').length);
    const qualityScore = computeNormalizedQualityScore(response, latencyMs);
    const enriched: LlmTextWithMetaResponse = {
      ...response,
      provider: finalProvider,
      latencyMs,
      estimatedCostUsd,
      experiment: selection.experiment || null,
      normalizedQualityScore: qualityScore,
    };

    void persistLlmCallLog({
      request: params,
      provider: enriched.provider,
      model: enriched.model,
      latencyMs,
      success: true,
      outputText: enriched.text,
      avgLogprob: enriched.avgLogprob,
      experiment: enriched.experiment,
      estimatedCostUsd,
      qualityScore,
    });

    if (cacheKey && enriched.text) setCachedResponse(cacheKey, enriched);
    return enriched;
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message = getErrorMessage(error);
    void persistLlmCallLog({
      request: params,
      provider,
      model: resolveModel(provider),
      latencyMs,
      success: false,
      errorCode: message.split(':')[0] || 'UNKNOWN',
      experiment: selection.experiment || null,
    });
    throw error;
  }
};
