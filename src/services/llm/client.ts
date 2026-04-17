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
  getLlmRuntimeReadinessSnapshot,
  type LlmProvider,
  type LlmTextRequest,
  type LlmTextWithMetaResponse,
  preflightProviderChain,
  recordProviderCallFailure,
  recordProviderCallSuccess,
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
  getActionPolicyProviders,
  getGateProviderProfileOverride,
  resolveProviderWithExperiment,
  resolveProviderChain,
  resolveRoutingCapability,
  resolveLlmProvider,
  resolveWorkflowModelBinding,
  resolveWorkflowProfile,
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

const createProviderDeadlineSignal = (deadlineMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} => {
  const controller = new AbortController();
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
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

export const getLlmRuntimeSnapshot = async (params?: {
  actionName?: string;
  guildId?: string;
}): Promise<{
  selectedProvider: LlmProvider | null;
  actionName: string | null;
  routingCapability: ReturnType<typeof resolveRoutingCapability>;
  actionPolicyProviders: LlmProvider[];
  workflowBinding: ReturnType<typeof resolveWorkflowModelBinding>;
  workflowProfile: ReturnType<typeof resolveWorkflowProfile> | null;
  gateProviderProfile: ReturnType<typeof resolveWorkflowProfile> | null;
  effectiveProviderProfile: ReturnType<typeof resolveWorkflowProfile> | null;
  configuredProviders: LlmProvider[];
  resolvedChain: LlmProvider[];
  readyChain: LlmProvider[];
  providers: Awaited<ReturnType<typeof getLlmRuntimeReadinessSnapshot>>;
}> => {
  const actionName = String(params?.actionName || '').trim() || null;
  const selectedProvider = resolveLlmProvider();
  const routingCapability = resolveRoutingCapability(actionName || undefined);
  const actionPolicyProviders = getActionPolicyProviders(actionName || undefined);
  const workflowBinding = resolveWorkflowModelBinding(actionName || undefined);
  const workflowProfile = resolveWorkflowProfile(actionName || undefined) || null;
  const gateProviderProfile = getGateProviderProfileOverride(params?.guildId) || null;
  const effectiveProviderProfile = gateProviderProfile || workflowProfile;
  const providers = await getLlmRuntimeReadinessSnapshot();
  const configuredProviders = providers.filter((provider) => provider.configured).map((provider) => provider.provider);

  const resolvedChain = selectedProvider
    ? resolveProviderChain(
      {
        system: '',
        user: '',
        actionName: actionName || undefined,
        guildId: params?.guildId,
      },
      selectedProvider,
      { provider: selectedProvider, experiment: null },
    )
    : [];
  const readyChain = await preflightProviderChain(resolvedChain);

  return {
    selectedProvider,
    actionName,
    routingCapability,
    actionPolicyProviders,
    workflowBinding,
    workflowProfile,
    gateProviderProfile,
    effectiveProviderProfile,
    configuredProviders,
    resolvedChain,
    readyChain,
    providers,
  };
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
  const resolvedProviderChain = resolveProviderChain(params, provider, selection);
  const providerChain = await preflightProviderChain(resolvedProviderChain);
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
    if (p === 'openjarvis') return OPENJARVIS_MODEL || 'qwen2.5:7b';
    if (p === 'litellm') return LITELLM_MODEL;
    if (p === 'kimi') return KIMI_MODEL;
    return undefined;
  };

  const callProvider = async (targetProvider: LlmProvider): Promise<LlmTextWithMetaResponse> => {
    const model = resolveModel(targetProvider);
    const { signal, dispose } = createProviderDeadlineSignal(providerChainDeadlineMs);
    const requestParams: LlmTextRequest = {
      ...params,
      ...(model ? { model } : {}),
      signal,
    };

    try {
      let response: LlmTextWithMetaResponse;
      if (targetProvider === 'openai') {
        response = { ...(await requestOpenAiWithMeta(requestParams, Boolean(params.includeLogprobs))), model };
      } else if (targetProvider === 'anthropic') {
        response = { text: await requestAnthropic(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'huggingface') {
        response = { text: await requestHuggingFace(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'openclaw') {
        response = { text: await requestOpenClaw(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'ollama') {
        response = { text: await requestOllama(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'openjarvis') {
        response = { text: await requestOpenJarvis(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'litellm') {
        response = { text: await requestLiteLLM(requestParams), provider: targetProvider, model };
      } else if (targetProvider === 'kimi') {
        response = { text: await requestKimi(requestParams), provider: targetProvider, model };
      } else {
        response = { text: await requestGemini(requestParams), provider: 'gemini', model: resolveModel('gemini') };
      }

      recordProviderCallSuccess(targetProvider);
      return response;
    } catch (error) {
      recordProviderCallFailure(targetProvider, error);
      throw error;
    } finally {
      dispose();
    }
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
      let hedgeError: unknown = null;
      const hedgeResult = await new Promise<{ response: LlmTextWithMetaResponse; provider: LlmProvider } | null>((resolve) => {
        let settled = false;
        let failures = 0;
        let secondaryStarted = false;
        let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
        let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
        const finalize = (value: { response: LlmTextWithMetaResponse; provider: LlmProvider } | null) => {
          if (settled) return;
          settled = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          if (deadlineTimer) clearTimeout(deadlineTimer);
          resolve(value);
        };
        const settle = (res: LlmTextWithMetaResponse, p: LlmProvider) => {
          finalize({ response: res, provider: p });
        };
        const fail = (err: unknown) => {
          failures += 1;
          hedgeError = err;
          if (failures >= 2 || (!secondaryStarted && !hedgeTimer)) {
            finalize(null);
          }
        };

        callProvider(primary).then((r) => settle(r, primary)).catch(fail);

        hedgeTimer = setTimeout(() => {
          hedgeTimer = null;
          if (!settled && Date.now() <= providerChainDeadlineMs) {
            secondaryStarted = true;
            callProvider(secondary).then((r) => settle(r, secondary)).catch(fail);
          }
        }, LLM_HEDGE_DELAY_MS);

        deadlineTimer = setTimeout(() => {
          finalize(null);
        }, Math.max(0, providerChainDeadlineMs - Date.now()));
      });

      if (hedgeResult) {
        response = hedgeResult.response;
        finalProvider = hedgeResult.provider;
      } else {
        if (hedgeError) {
          lastError = hedgeError;
        }
        // Hedge failed — continue with remaining providers sequentially
        const remainingProviders = providerChain.slice(2);
        for (const targetProvider of remainingProviders) {
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
