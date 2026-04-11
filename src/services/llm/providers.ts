/**
 * LLM Provider HTTP implementations.
 * Each provider's HTTP request function + configuration helpers.
 */
import {
  AI_PROVIDER,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL,
  ANTHROPIC_VERSION,
  GEMINI_API_KEY,
  GEMINI_MODEL,
  HF_TOKEN,
  HUGGINGFACE_CHAT_COMPLETIONS_URL,
  HUGGINGFACE_MODEL,
  KIMI_API_KEY,
  KIMI_BASE_URL,
  KIMI_MODEL,
  LITELLM_BASE_URL,
  LITELLM_ENABLED,
  LITELLM_MASTER_KEY,
  LITELLM_MODEL,
  LLM_API_TIMEOUT_MS,
  LLM_API_TIMEOUT_LARGE_MS,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  OPENCLAW_API_KEY,
  OPENCLAW_BASE_URL,
  OPENCLAW_FALLBACK_MODELS_RAW,
  OPENCLAW_MODEL,
  OPENAI_ANALYSIS_MODEL,
  OPENAI_API_KEY,
  OPENJARVIS_ENABLED,
  OPENJARVIS_MODEL,
  OPENJARVIS_SERVE_URL,
} from '../../config';
import { getErrorMessage } from '../../utils/errorMessage';
import { parseCsvList } from '../../utils/env';
import { fetchWithTimeout as baseFetchWithTimeout } from '../../utils/network';
import { logStructuredError } from '../structuredErrorLogService';
import { sendGatewayChat, isModelOnCooldown, setModelCooldown, getModelCooldownUntil, parseRetryDelayMs } from '../openclaw/gatewayHealth';

// ──── Shared Types ───────────────────────────────────────────────────────────

export type LlmProvider = 'openai' | 'gemini' | 'anthropic' | 'openclaw' | 'ollama' | 'huggingface' | 'openjarvis' | 'litellm' | 'kimi';
const ALL_LLM_PROVIDERS: readonly LlmProvider[] = ['openai', 'gemini', 'anthropic', 'openclaw', 'ollama', 'huggingface', 'openjarvis', 'litellm', 'kimi'];

export type LlmProviderProfile = 'cost-optimized' | 'quality-optimized';

export type LlmTextRequest = {
  system: string;
  user: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  provider?: LlmProvider;
  providerProfile?: LlmProviderProfile;
  model?: string;
  guildId?: string;
  sessionId?: string;
  requestedBy?: string;
  experimentKey?: string;
  actionName?: string;
};

export type LlmTextWithMetaResponse = {
  text: string;
  provider: LlmProvider;
  model?: string;
  latencyMs?: number;
  estimatedCostUsd?: number;
  experiment?: {
    name: string;
    arm: 'control' | 'huggingface';
    keyHash: string;
  } | null;
  avgLogprob?: number;
  normalizedQualityScore?: number;
};

export type LlmProviderRuntimeStatus = 'ready' | 'unknown' | 'cooldown' | 'unreachable';

export type LlmProviderRuntimeReadiness = {
  provider: LlmProvider;
  configured: boolean;
  status: LlmProviderRuntimeStatus;
  checkedAt: number;
  reason: string | null;
  cooldownUntil: number | null;
  consecutiveFailures: number;
};

// ──── Provider Configuration Helpers ─────────────────────────────────────────

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export const getOpenClawFallbackModels = (): string[] => parseCsvList(OPENCLAW_FALLBACK_MODELS_RAW);

export const isOpenClawConfigured = () => Boolean(OPENCLAW_BASE_URL);
export const isOllamaConfigured = () => Boolean(OLLAMA_MODEL || ['ollama', 'local'].includes(AI_PROVIDER));
export const isHuggingFaceConfigured = () => Boolean(HF_TOKEN);
export const isKimiConfigured = () => Boolean(KIMI_API_KEY);

export const isProviderConfigured = (provider: LlmProvider): boolean => {
  if (provider === 'openai') return Boolean(OPENAI_API_KEY);
  if (provider === 'gemini') return Boolean(GEMINI_API_KEY);
  if (provider === 'anthropic') return Boolean(ANTHROPIC_API_KEY);
  if (provider === 'huggingface') return isHuggingFaceConfigured();
  if (provider === 'openclaw') return isOpenClawConfigured();
  if (provider === 'ollama') return isOllamaConfigured();
  if (provider === 'openjarvis') return OPENJARVIS_ENABLED;
  if (provider === 'litellm') return LITELLM_ENABLED;
  if (provider === 'kimi') return isKimiConfigured();
  return false;
};

export const isAnyLlmConfigured = (): boolean => Boolean(
  OPENAI_API_KEY
    || GEMINI_API_KEY
    || ANTHROPIC_API_KEY
    || isKimiConfigured()
    || isHuggingFaceConfigured()
    || isOpenClawConfigured()
    || isOllamaConfigured()
    || OPENJARVIS_ENABLED
    || LITELLM_ENABLED,
);

type ProviderRuntimeState = {
  checkedAt: number;
  probeStatus: LlmProviderRuntimeStatus;
  probeReason: string | null;
  cooldownUntil: number;
  consecutiveFailures: number;
  lastSuccessAt: number;
  lastFailureAt: number;
};

const providerRuntimeState = new Map<LlmProvider, ProviderRuntimeState>();
const PROVIDER_READINESS_CACHE_TTL_MS = 15_000;
const PROVIDER_READINESS_PROBE_TIMEOUT_MS = 3_500;
const PROVIDER_FAILURE_COOLDOWN_MS = 45_000;

const ensureProviderRuntimeState = (provider: LlmProvider): ProviderRuntimeState => {
  const existing = providerRuntimeState.get(provider);
  if (existing) return existing;
  const created: ProviderRuntimeState = {
    checkedAt: 0,
    probeStatus: 'unknown',
    probeReason: null,
    cooldownUntil: 0,
    consecutiveFailures: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
  };
  providerRuntimeState.set(provider, created);
  return created;
};

const joinHealthUrl = (baseUrl: string, suffix: string): string => `${baseUrl.replace(/\/+$/g, '')}${suffix}`;

const getProviderProbeUrl = (provider: LlmProvider): string | null => {
  if (provider === 'ollama') return joinHealthUrl(OLLAMA_BASE_URL, '/api/tags');
  if (provider === 'openjarvis') return joinHealthUrl(OPENJARVIS_SERVE_URL, '/health');
  if (provider === 'litellm') return joinHealthUrl(LITELLM_BASE_URL, '/health/liveliness');
  return null;
};

const buildProviderReadiness = (provider: LlmProvider, now = Date.now()): LlmProviderRuntimeReadiness => {
  const configured = isProviderConfigured(provider);
  const state = ensureProviderRuntimeState(provider);

  let status: LlmProviderRuntimeStatus = 'unknown';
  if (!configured) {
    status = 'unreachable';
  } else if (state.cooldownUntil > now) {
    status = 'cooldown';
  } else if (state.probeStatus === 'ready' || state.lastSuccessAt > 0) {
    status = 'ready';
  } else if (state.probeStatus === 'unreachable') {
    status = 'unreachable';
  }

  return {
    provider,
    configured,
    status,
    checkedAt: state.checkedAt,
    reason: state.probeReason,
    cooldownUntil: state.cooldownUntil > 0 ? state.cooldownUntil : null,
    consecutiveFailures: state.consecutiveFailures,
  };
};

export const resetProviderRuntimeReadiness = (): void => {
  providerRuntimeState.clear();
};

export const recordProviderCallSuccess = (provider: LlmProvider): void => {
  const state = ensureProviderRuntimeState(provider);
  const now = Date.now();
  state.checkedAt = now;
  state.probeStatus = 'ready';
  state.probeReason = null;
  state.cooldownUntil = 0;
  state.consecutiveFailures = 0;
  state.lastSuccessAt = now;
};

export const recordProviderCallFailure = (provider: LlmProvider, error: unknown): void => {
  const state = ensureProviderRuntimeState(provider);
  const now = Date.now();
  const failureMessage = getErrorMessage(error);
  const cooldownMs = Math.min(PROVIDER_FAILURE_COOLDOWN_MS * Math.max(1, state.consecutiveFailures + 1), PROVIDER_FAILURE_COOLDOWN_MS * 4);

  state.checkedAt = now;
  state.probeStatus = 'unreachable';
  state.probeReason = failureMessage;
  state.cooldownUntil = now + cooldownMs;
  state.consecutiveFailures += 1;
  state.lastFailureAt = now;
};

export const getProviderRuntimeReadiness = async (provider: LlmProvider): Promise<LlmProviderRuntimeReadiness> => {
  const now = Date.now();
  const state = ensureProviderRuntimeState(provider);
  const configured = isProviderConfigured(provider);

  if (!configured) {
    state.checkedAt = now;
    state.probeStatus = 'unreachable';
    state.probeReason = 'NOT_CONFIGURED';
    state.cooldownUntil = 0;
    state.consecutiveFailures = 0;
    return buildProviderReadiness(provider, now);
  }

  if (state.cooldownUntil > now) {
    return buildProviderReadiness(provider, now);
  }

  const probeUrl = getProviderProbeUrl(provider);
  if (!probeUrl) {
    return buildProviderReadiness(provider, now);
  }

  if (state.checkedAt > 0 && (now - state.checkedAt) < PROVIDER_READINESS_CACHE_TTL_MS) {
    return buildProviderReadiness(provider, now);
  }

  try {
    const response = await baseFetchWithTimeout(probeUrl, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
    }, PROVIDER_READINESS_PROBE_TIMEOUT_MS);

    state.checkedAt = now;
    if (response.ok) {
      state.probeStatus = 'ready';
      state.probeReason = null;
      return buildProviderReadiness(provider, now);
    }

    state.probeStatus = 'unreachable';
    state.probeReason = `PROBE_HTTP_${response.status}`;
    state.cooldownUntil = now + PROVIDER_READINESS_CACHE_TTL_MS;
    return buildProviderReadiness(provider, now);
  } catch (error) {
    state.checkedAt = now;
    state.probeStatus = 'unreachable';
    state.probeReason = getErrorMessage(error);
    state.cooldownUntil = now + PROVIDER_READINESS_CACHE_TTL_MS;
    return buildProviderReadiness(provider, now);
  }
};

export const preflightProviderChain = async (providers: LlmProvider[]): Promise<LlmProvider[]> => {
  if (providers.length <= 1) return providers;

  const readiness = await Promise.all(providers.map((provider) => getProviderRuntimeReadiness(provider)));
  const preferred = readiness
    .filter((entry) => entry.status === 'ready' || entry.status === 'unknown')
    .map((entry) => entry.provider);

  return preferred.length > 0 ? preferred : providers;
};

export const listLlmProviders = (): LlmProvider[] => [...ALL_LLM_PROVIDERS];

export const getLlmRuntimeReadinessSnapshot = async (): Promise<LlmProviderRuntimeReadiness[]> => {
  return Promise.all(listLlmProviders().map((provider) => getProviderRuntimeReadiness(provider)));
};

// ──── Fetch Helper ───────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

export const extractOpenAiCompatibleText = (payload: unknown): string => {
  const firstChoice = asRecord(asArray(asRecord(payload).choices)[0]);
  const message = asRecord(firstChoice.message);
  return asString(message.content).trim();
};

export const extractOpenAiTokenLogprobs = (payload: unknown): number[] => {
  const firstChoice = asRecord(asArray(asRecord(payload).choices)[0]);
  const logprobs = asRecord(firstChoice.logprobs);
  return asArray(logprobs.content)
    .map((item) => Number(asRecord(item).logprob))
    .filter((value) => Number.isFinite(value));
};

export const extractGeminiResponseText = (payload: unknown): string => {
  const firstCandidate = asRecord(asArray(asRecord(payload).candidates)[0]);
  const content = asRecord(firstCandidate.content);
  return asArray(content.parts)
    .map((part) => asString(asRecord(part).text))
    .filter(Boolean)
    .join('\n')
    .trim();
};

export const extractAnthropicResponseText = (payload: unknown): string => {
  return asArray(asRecord(payload).content)
    .map((block) => asRecord(block))
    .filter((block) => asString(block.type) === 'text')
    .map((block) => asString(block.text))
    .filter(Boolean)
    .join('\n')
    .trim();
};

const isAbortErrorLike = (error: unknown): boolean => asString(asRecord(error).name) === 'AbortError';

const redactUrlParams = (url: string): string => {
  try { const u = new URL(url); u.search = ''; return u.toString(); } catch { return url.split('?')[0] || url; }
};

const fetchWithTimeout = async (input: string, init: RequestInit, timeoutMs?: number): Promise<Response> => {
  const effectiveTimeout = timeoutMs ?? LLM_API_TIMEOUT_MS;
  try {
    return await baseFetchWithTimeout(input, init, effectiveTimeout);
  } catch (error: unknown) {
    const safeUrl = redactUrlParams(input);
    if (isAbortErrorLike(error)) {
      await logStructuredError({
        code: 'API_TIMEOUT',
        source: 'llmClient.fetchWithTimeout',
        message: `LLM API timeout after ${effectiveTimeout}ms`,
        meta: { url: safeUrl },
      }, error);
      throw new Error('API_TIMEOUT');
    }
    await logStructuredError({
      code: 'LLM_NETWORK_ERROR',
      source: 'llmClient.fetchWithTimeout',
      message: `LLM network error: ${asString(asRecord(error).message || 'unknown')}`,
      meta: { url: safeUrl, errorName: asString(asRecord(error).name) },
    }, error);
    throw error;
  }
};

const throwProviderError = async (source: string, provider: string, response: Response): Promise<never> => {
  const body = await response.text();
  await logStructuredError({
    code: 'LLM_REQUEST_FAILED',
    source,
    message: `${provider.toUpperCase()}_REQUEST_FAILED status=${response.status}`,
    meta: { provider: provider.toLowerCase(), status: response.status, bodyPreview: body.slice(0, 300) },
  });
  throw new Error(`${provider.toUpperCase()}_REQUEST_FAILED: ${body.slice(0, 300)}`);
};

// ──── OpenClaw State ─────────────────────────────────────────────────────────

let openclawResolvedPathSuffix: string | null = null;

/** Reset mutable path suffix cache — for testing only. */
export const resetOpenclawResolvedPathSuffix = (): void => {
  openclawResolvedPathSuffix = null;
};

// ──── Provider Request Implementations ───────────────────────────────────────

export const requestOpenAiWithMeta = async (
  params: LlmTextRequest,
  includeLogprobs: boolean,
): Promise<LlmTextWithMetaResponse> => {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model || OPENAI_ANALYSIS_MODEL,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      ...(includeLogprobs ? { logprobs: true } : {}),
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    await throwProviderError('llmClient.requestOpenAi', 'openai', response);
  }

  const data = await response.json();
  const text = extractOpenAiCompatibleText(data);
  const tokenLogprobs = extractOpenAiTokenLogprobs(data);
  const avgLogprob = tokenLogprobs.length > 0
    ? tokenLogprobs.reduce((acc: number, n: number) => acc + n, 0) / tokenLogprobs.length
    : undefined;

  return { text, provider: 'openai', avgLogprob };
};

export const requestGemini = async (params: LlmTextRequest): Promise<string> => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: params.system }] },
      contents: [{ role: 'user', parts: [{ text: params.user }] }],
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        topP: params.topP,
        maxOutputTokens: params.maxTokens ?? 1000,
      },
    }),
  });

  if (!response.ok) {
    await throwProviderError('llmClient.requestGemini', 'gemini', response);
  }

  const data = await response.json();
  return extractGeminiResponseText(data);
};

export const requestAnthropic = async (params: LlmTextRequest): Promise<string> => {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: params.model || ANTHROPIC_MODEL,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });

  if (!response.ok) {
    await throwProviderError('llmClient.requestAnthropic', 'anthropic', response);
  }

  const data = await response.json();
  return extractAnthropicResponseText(data);
};

export const requestHuggingFace = async (params: LlmTextRequest): Promise<string> => {
  if (!HF_TOKEN) {
    throw new Error('HUGGINGFACE_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || HUGGINGFACE_MODEL;
  const response = await fetchWithTimeout(HUGGINGFACE_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${HF_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    await throwProviderError('llmClient.requestHuggingFace', 'huggingface', response);
  }

  const data = await response.json();
  return extractOpenAiCompatibleText(data);
};

/**
 * Try the OpenClaw Gateway's OpenAI-compatible /v1/chat/completions endpoint.
 * This routes through the Gateway with session context. Only attempted when
 * the Gateway is healthy and session/action context is present.
 *
 * Returns null if the gateway is unavailable, unhealthy, or returns an error,
 * allowing the caller to fall through to the standard completions API.
 */
export const tryOpenClawGateway = async (params: LlmTextRequest): Promise<string | null> => {
  // Only use Gateway when session or action context makes it valuable
  if (!params.sessionId && !params.actionName && !params.guildId) return null;

  return sendGatewayChat({
    user: params.user,
    system: params.system,
    sessionId: params.sessionId,
    guildId: params.guildId,
    actionName: params.actionName,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
  });
};

/**
 * OpenClaw LLM provider — standard /v1/chat/completions interface.
 * When session/action context is present, tries the Gateway /v1/chat/completions first.
 * Falls back to direct completions API with model cooldown and quota retry.
 */
export const requestOpenClaw = async (params: LlmTextRequest): Promise<string> => {
  // Session-aware gateway path (only when context makes it valuable)
  const gatewayResult = await tryOpenClawGateway(params);
  if (gatewayResult) return gatewayResult;

  // Standard completions API path
  if (!OPENCLAW_BASE_URL) {
    throw new Error('OPENCLAW_BASE_URL_NOT_CONFIGURED');
  }
  if (!/^https?:\/\//i.test(OPENCLAW_BASE_URL)) {
    await logStructuredError({
      code: 'OPENCLAW_BASE_URL_INVALID',
      source: 'llmClient.requestOpenClaw',
      message: 'OPENCLAW_BASE_URL must start with http:// or https://',
      meta: { provider: 'openclaw', baseUrlPreview: OPENCLAW_BASE_URL.slice(0, 120) },
    });
    throw new Error('OPENCLAW_BASE_URL_INVALID');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OPENCLAW_API_KEY) {
    headers.Authorization = `Bearer ${OPENCLAW_API_KEY}`;
  }

  const primaryModel = params.model || OPENCLAW_MODEL;
  const fallbackModels = getOpenClawFallbackModels().filter((model) => model !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackModels];

  const isRetryableQuotaError = (status: number, body: string): boolean => {
    if (status === 429) return true;
    const normalized = String(body || '').toLowerCase();
    return normalized.includes('quota')
      || normalized.includes('rate limit')
      || normalized.includes('resource_exhausted')
      || normalized.includes('exceeded your current quota');
  };

  type FailedAttempt = { model: string; status: number; requestUrl: string; body: string };
  const attempts: FailedAttempt[] = [];

  for (let index = 0; index < modelsToTry.length; index += 1) {
    const model = modelsToTry[index];
    if (isModelOnCooldown(model)) {
      attempts.push({
        model, status: 429,
        requestUrl: `${OPENCLAW_BASE_URL}/v1/chat/completions`,
        body: `MODEL_COOLDOWN_ACTIVE until=${new Date(getModelCooldownUntil(model)).toISOString()}`,
      });
      continue;
    }

    const payload = JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    });

    let requestUrl = `${OPENCLAW_BASE_URL}${openclawResolvedPathSuffix || '/v1/chat/completions'}`;
    let response = await fetchWithTimeout(requestUrl, { method: 'POST', headers, body: payload });

    if (response.status === 404 && !openclawResolvedPathSuffix) {
      const firstBody = await response.text();
      const fallbackSuffix = '/chat/completions';
      const fallbackUrl = `${OPENCLAW_BASE_URL}${fallbackSuffix}`;
      const fallbackResponse = await fetchWithTimeout(fallbackUrl, { method: 'POST', headers, body: payload });

      if (fallbackResponse.ok) {
        openclawResolvedPathSuffix = fallbackSuffix;
        const data = (await fallbackResponse.json()) as Record<string, any>;
        return String(data?.choices?.[0]?.message?.content || '').trim();
      }

      const fallbackBody = await fallbackResponse.text();
      attempts.push({
        model, status: fallbackResponse.status, requestUrl: fallbackUrl,
        body: `${firstBody.slice(0, 200)}\n${fallbackBody.slice(0, 200)}`,
      });
      if (isRetryableQuotaError(fallbackResponse.status, fallbackBody)) {
        setModelCooldown(model, Date.now() + parseRetryDelayMs(fallbackBody));
      }
      if (index < modelsToTry.length - 1 && isRetryableQuotaError(fallbackResponse.status, fallbackBody)) continue;
      break;
    }

    if (!response.ok) {
      const body = await response.text();
      attempts.push({ model, status: response.status, requestUrl, body: body.slice(0, 300) });
      if (isRetryableQuotaError(response.status, body)) {
        setModelCooldown(model, Date.now() + parseRetryDelayMs(body));
      }
      if (index < modelsToTry.length - 1 && isRetryableQuotaError(response.status, body)) continue;
      break;
    }

    const data = (await response.json()) as Record<string, any>;
    if (!openclawResolvedPathSuffix) openclawResolvedPathSuffix = '/v1/chat/completions';
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  const last = attempts[attempts.length - 1] || {
    model: primaryModel, status: 500,
    requestUrl: `${OPENCLAW_BASE_URL}/v1/chat/completions`, body: 'unknown_error',
  };

  await logStructuredError({
    code: 'LLM_REQUEST_FAILED',
    source: 'llmClient.requestOpenClaw',
    message: `OPENCLAW_REQUEST_FAILED status=${last.status}`,
    meta: {
      provider: 'openclaw', status: last.status, requestUrl: last.requestUrl, model: last.model,
      attempts: attempts.map((item) => ({ model: item.model, status: item.status, requestUrl: item.requestUrl })),
      bodyPreview: String(last.body || '').slice(0, 300),
    },
  });
  throw new Error(`OPENCLAW_REQUEST_FAILED: ${String(last.body || '').slice(0, 300)}`);
};

export const requestOllama = async (params: LlmTextRequest): Promise<string> => {
  const model = params.model || OLLAMA_MODEL || 'qwen2.5:3b-instruct';

  const response = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false,
      options: { temperature: params.temperature ?? 0.2, top_p: params.topP, num_predict: params.maxTokens ?? 1000 },
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  }, LLM_API_TIMEOUT_LARGE_MS);

  if (!response.ok) {
    await throwProviderError('llmClient.requestOllama', 'ollama', response);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.message?.content || '').trim();
};

const requestOpenAiCompatible = async (
  params: LlmTextRequest,
  baseUrl: string,
  model: string,
  providerName: string,
  apiKey?: string,
): Promise<string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  }, LLM_API_TIMEOUT_LARGE_MS);

  if (!response.ok) {
    await throwProviderError(`llmClient.request${providerName}`, providerName, response);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

export const requestOpenJarvis = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, OPENJARVIS_SERVE_URL, params.model || OPENJARVIS_MODEL || 'qwen2.5:7b-instruct', 'OpenJarvis');

export const requestLiteLLM = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, LITELLM_BASE_URL, params.model || LITELLM_MODEL, 'LiteLLM', LITELLM_MASTER_KEY || undefined);

export const requestKimi = (params: LlmTextRequest): Promise<string> =>
  requestOpenAiCompatible(params, KIMI_BASE_URL, params.model || KIMI_MODEL, 'Kimi', KIMI_API_KEY);
