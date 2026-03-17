import crypto from 'crypto';
import { logStructuredError } from './structuredErrorLogService';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const HUGGINGFACE_CHAT_COMPLETIONS_URL = String(process.env.HUGGINGFACE_CHAT_COMPLETIONS_URL || 'https://router.huggingface.co/v1/chat/completions').trim();
const LLM_API_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_API_TIMEOUT_MS || 15000));
const LLM_CALL_LOG_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LLM_CALL_LOG_ENABLED || 'true').trim());
const LLM_CALL_LOG_TABLE = String(process.env.LLM_CALL_LOG_TABLE || 'agent_llm_call_logs').trim();
const LLM_EXPERIMENT_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LLM_EXPERIMENT_ENABLED || 'false').trim());
const LLM_EXPERIMENT_NAME = String(process.env.LLM_EXPERIMENT_NAME || 'hf_ab_v1').trim();
const LLM_EXPERIMENT_HF_PERCENT = Math.max(0, Math.min(100, Number(process.env.LLM_EXPERIMENT_HF_PERCENT || 20) || 20));
const LLM_EXPERIMENT_FAIL_OPEN = !/^(0|false|off|no)$/i.test(String(process.env.LLM_EXPERIMENT_FAIL_OPEN || 'true').trim());
const LLM_EXPERIMENT_GUILD_ALLOWLIST = new Set(
  String(process.env.LLM_EXPERIMENT_GUILD_ALLOWLIST || '')
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean),
);
const LLM_COST_INPUT_PER_1K_CHARS_USD = Math.max(0, Number(process.env.LLM_COST_INPUT_PER_1K_CHARS_USD || 0.0005) || 0.0005);
const LLM_COST_OUTPUT_PER_1K_CHARS_USD = Math.max(0, Number(process.env.LLM_COST_OUTPUT_PER_1K_CHARS_USD || 0.0015) || 0.0015);

export type LlmProvider = 'openai' | 'gemini' | 'anthropic' | 'openclaw' | 'ollama' | 'huggingface';

export type LlmTextRequest = {
  system: string;
  user: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  provider?: LlmProvider;
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
};

type LlmExperimentDecision = {
  provider: LlmProvider | null;
  experiment: LlmTextWithMetaResponse['experiment'];
};

const getOpenAiKey = () => String(process.env.OPENAI_API_KEY || '').trim();
const getGeminiKey = () => String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const getAnthropicKey = () => String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
const getHuggingFaceKey = () => String(process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '').trim();
const getOpenClawApiKey = () => String(process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_KEY || '').trim();
const getOpenClawFallbackModels = () => String(process.env.OPENCLAW_FALLBACK_MODELS || 'muel-fast,muel-precise')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS = Math.max(1_000, Number(process.env.OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS || 45_000));
const openclawModelCooldownUntilMs = new Map<string, number>();
const getOpenClawBaseUrl = () => String(
  process.env.OPENCLAW_BASE_URL
    || process.env.OPENCLAW_API_BASE_URL
    || process.env.OPENCLAW_URL
    || '',
).trim().replace(/\/+$/, '');
const isOpenClawConfigured = () => Boolean(getOpenClawBaseUrl());
const getOllamaBaseUrl = () => String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/+$/, '');
const getOllamaModel = () => String(process.env.OLLAMA_MODEL || process.env.LOCAL_LLM_MODEL || '').trim();
const isOllamaConfigured = () => Boolean(getOllamaModel() || ['ollama', 'local'].includes(String(process.env.AI_PROVIDER || '').trim().toLowerCase()));
const isHuggingFaceConfigured = () => Boolean(getHuggingFaceKey());

const shortHash = (value: string): string => {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 16);
};

const estimateLlmCallCostUsd = (inputChars: number, outputChars: number): number => {
  const inCost = (Math.max(0, inputChars) / 1000) * LLM_COST_INPUT_PER_1K_CHARS_USD;
  const outCost = (Math.max(0, outputChars) / 1000) * LLM_COST_OUTPUT_PER_1K_CHARS_USD;
  return Number((inCost + outCost).toFixed(8));
};

const isExperimentGuildAllowed = (guildId?: string): boolean => {
  const safeGuildId = String(guildId || '').trim();
  if (!safeGuildId) {
    return false;
  }
  if (LLM_EXPERIMENT_GUILD_ALLOWLIST.size === 0) {
    return true;
  }
  return LLM_EXPERIMENT_GUILD_ALLOWLIST.has(safeGuildId);
};

const resolveProviderWithoutExperiment = (): LlmProvider | null => {
  const preferred = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (preferred === 'gemini' && getGeminiKey()) {
    return 'gemini';
  }
  if (preferred === 'openai' && getOpenAiKey()) {
    return 'openai';
  }
  if (preferred === 'anthropic' && getAnthropicKey()) {
    return 'anthropic';
  }
  if (preferred === 'claude' && getAnthropicKey()) {
    return 'anthropic';
  }
  if ((preferred === 'huggingface' || preferred === 'hf') && isHuggingFaceConfigured()) {
    return 'huggingface';
  }
  if (preferred === 'openclaw' && isOpenClawConfigured()) {
    return 'openclaw';
  }
  if ((preferred === 'ollama' || preferred === 'local') && isOllamaConfigured()) {
    return 'ollama';
  }

  if (getOpenAiKey()) {
    return 'openai';
  }

  if (getAnthropicKey()) {
    return 'anthropic';
  }

  if (getGeminiKey()) {
    return 'gemini';
  }

  if (isHuggingFaceConfigured()) {
    return 'huggingface';
  }

  if (isOpenClawConfigured()) {
    return 'openclaw';
  }

  if (isOllamaConfigured()) {
    return 'ollama';
  }

  return null;
};

const resolveProviderWithExperiment = (params: LlmTextRequest): LlmExperimentDecision => {
  if (params.provider) {
    return { provider: params.provider, experiment: null };
  }

  const baseProvider = resolveProviderWithoutExperiment();
  if (!baseProvider) {
    return { provider: null, experiment: null };
  }

  if (!LLM_EXPERIMENT_ENABLED || !isHuggingFaceConfigured() || !isExperimentGuildAllowed(params.guildId)) {
    return { provider: baseProvider, experiment: null };
  }

  if (baseProvider === 'huggingface') {
    return {
      provider: 'huggingface',
      experiment: {
        name: LLM_EXPERIMENT_NAME,
        arm: 'huggingface',
        keyHash: shortHash(params.experimentKey || params.guildId || params.user || ''),
      },
    };
  }

  const bucketSeed = [
    String(params.experimentKey || '').trim(),
    String(params.guildId || '').trim(),
    String(params.sessionId || '').trim(),
    String(params.requestedBy || '').trim(),
    String(params.user || '').slice(0, 120),
  ].filter(Boolean).join('|');
  const hashHex = crypto.createHash('sha256').update(bucketSeed || 'default', 'utf8').digest('hex').slice(0, 8);
  const bucket = parseInt(hashHex, 16) % 100;
  const useHfArm = bucket < LLM_EXPERIMENT_HF_PERCENT;
  return {
    provider: useHfArm ? 'huggingface' : baseProvider,
    experiment: {
      name: LLM_EXPERIMENT_NAME,
      arm: useHfArm ? 'huggingface' : 'control',
      keyHash: shortHash(bucketSeed || 'default'),
    },
  };
};

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
}): Promise<void> => {
  if (!LLM_CALL_LOG_ENABLED || !isSupabaseConfigured()) {
    return;
  }

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
      created_at: new Date().toISOString(),
    });
  } catch {
    // LLM observability logging is best-effort and must not block runtime flow.
  }
};

const fetchWithTimeout = async (input: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_API_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      await logStructuredError({
        code: 'API_TIMEOUT',
        source: 'llmClient.fetchWithTimeout',
        message: `LLM API timeout after ${LLM_API_TIMEOUT_MS}ms`,
        meta: { url: input },
      }, error);
      throw new Error('API_TIMEOUT');
    }
    await logStructuredError({
      code: 'LLM_NETWORK_ERROR',
      source: 'llmClient.fetchWithTimeout',
      message: `LLM network error: ${String(error?.message || 'unknown')}`,
      meta: {
        url: input,
        errorName: String(error?.name || ''),
      },
    }, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const isAnyLlmConfigured = (): boolean => Boolean(
  getOpenAiKey()
    || getGeminiKey()
    || getAnthropicKey()
    || isHuggingFaceConfigured()
    || isOpenClawConfigured()
    || isOllamaConfigured(),
);

export const resolveLlmProvider = (): LlmProvider | null => {
  return resolveProviderWithoutExperiment();
};

const requestOpenAiWithMeta = async (
  params: LlmTextRequest,
  includeLogprobs: boolean,
): Promise<LlmTextWithMetaResponse> => {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model || process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
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
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestOpenAi',
      message: `OPENAI_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'openai', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OPENAI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  const tokenLogprobs = Array.isArray(data?.choices?.[0]?.logprobs?.content)
    ? data.choices[0].logprobs.content
        .map((item: Record<string, unknown>) => Number(item?.logprob))
        .filter((n: number) => Number.isFinite(n))
    : [];
  const avgLogprob = tokenLogprobs.length > 0
    ? tokenLogprobs.reduce((acc: number, n: number) => acc + n, 0) / tokenLogprobs.length
    : undefined;

  return {
    text,
    provider: 'openai',
    avgLogprob,
  };
};

const requestGemini = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: params.user }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        topP: params.topP,
        maxOutputTokens: params.maxTokens ?? 1000,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestGemini',
      message: `GEMINI_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'gemini', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`GEMINI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text || '')).join('\n') || '';
  return text.trim();
};

const requestAnthropic = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetchWithTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model || process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest',
      temperature: params.temperature ?? 0.2,
      top_p: params.topP,
      max_tokens: params.maxTokens ?? 1000,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestAnthropic',
      message: `ANTHROPIC_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'anthropic', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`ANTHROPIC_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((block: any) => String(block?.type || '') === 'text')
    .map((block: any) => String(block?.text || ''))
    .join('\n')
    .trim();
  return text;
};

const requestHuggingFace = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getHuggingFaceKey();
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
  const response = await fetchWithTimeout(HUGGINGFACE_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestHuggingFace',
      message: `HUGGINGFACE_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'huggingface', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`HUGGINGFACE_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

const requestOpenClaw = async (params: LlmTextRequest): Promise<string> => {
  const baseUrl = getOpenClawBaseUrl();
  if (!baseUrl) {
    throw new Error('OPENCLAW_BASE_URL_NOT_CONFIGURED');
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    await logStructuredError({
      code: 'OPENCLAW_BASE_URL_INVALID',
      source: 'llmClient.requestOpenClaw',
      message: 'OPENCLAW_BASE_URL must start with http:// or https://',
      meta: {
        provider: 'openclaw',
        baseUrlPreview: baseUrl.slice(0, 120),
      },
    });
    throw new Error('OPENCLAW_BASE_URL_INVALID');
  }

  const apiKey = getOpenClawApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const primaryModel = params.model || process.env.OPENCLAW_MODEL || 'openclaw';
  const fallbackModels = getOpenClawFallbackModels().filter((model) => model !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackModels];

  const isRetryableQuotaError = (status: number, body: string): boolean => {
    if (status === 429) {
      return true;
    }
    const normalized = String(body || '').toLowerCase();
    return normalized.includes('quota')
      || normalized.includes('rate limit')
      || normalized.includes('resource_exhausted')
      || normalized.includes('exceeded your current quota');
  };

  const parseRetryDelayMs = (body: string): number => {
    const text = String(body || '');
    const retryDelayMatch = text.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (retryDelayMatch?.[1]) {
      return Math.max(1_000, Number(retryDelayMatch[1]) * 1000);
    }

    const pleaseRetryMatch = text.match(/Please retry in\s*([0-9.]+)s/i);
    if (pleaseRetryMatch?.[1]) {
      return Math.max(1_000, Math.round(Number(pleaseRetryMatch[1]) * 1000));
    }

    return OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS;
  };

  type FailedAttempt = {
    model: string;
    status: number;
    requestUrl: string;
    body: string;
  };

  const attempts: FailedAttempt[] = [];

  for (let index = 0; index < modelsToTry.length; index += 1) {
    const model = modelsToTry[index];
    const cooldownUntil = openclawModelCooldownUntilMs.get(model) || 0;
    if (cooldownUntil > Date.now()) {
      attempts.push({
        model,
        status: 429,
        requestUrl: `${baseUrl}/v1/chat/completions`,
        body: `MODEL_COOLDOWN_ACTIVE until=${new Date(cooldownUntil).toISOString()}`,
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

    let requestUrl = `${baseUrl}/v1/chat/completions`;
    let response = await fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (response.status === 404) {
      const firstBody = await response.text();
      const fallbackUrl = `${baseUrl}/chat/completions`;
      const fallbackResponse = await fetchWithTimeout(fallbackUrl, {
        method: 'POST',
        headers,
        body: payload,
      });

      if (fallbackResponse.ok) {
        const data = (await fallbackResponse.json()) as Record<string, any>;
        return String(data?.choices?.[0]?.message?.content || '').trim();
      }

      const fallbackBody = await fallbackResponse.text();
      attempts.push({
        model,
        status: fallbackResponse.status,
        requestUrl: fallbackUrl,
        body: `${firstBody.slice(0, 200)}\n${fallbackBody.slice(0, 200)}`,
      });

      if (isRetryableQuotaError(fallbackResponse.status, fallbackBody)) {
        openclawModelCooldownUntilMs.set(model, Date.now() + parseRetryDelayMs(fallbackBody));
      }

      const canRetry = index < modelsToTry.length - 1 && isRetryableQuotaError(fallbackResponse.status, fallbackBody);
      if (canRetry) {
        continue;
      }
      break;
    }

    if (!response.ok) {
      const body = await response.text();
      attempts.push({ model, status: response.status, requestUrl, body: body.slice(0, 300) });
      if (isRetryableQuotaError(response.status, body)) {
        openclawModelCooldownUntilMs.set(model, Date.now() + parseRetryDelayMs(body));
      }
      const canRetry = index < modelsToTry.length - 1 && isRetryableQuotaError(response.status, body);
      if (canRetry) {
        continue;
      }
      break;
    }

    const data = (await response.json()) as Record<string, any>;
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  const last = attempts[attempts.length - 1] || {
    model: primaryModel,
    status: 500,
    requestUrl: `${baseUrl}/v1/chat/completions`,
    body: 'unknown_error',
  };

  await logStructuredError({
    code: 'LLM_REQUEST_FAILED',
    source: 'llmClient.requestOpenClaw',
    message: `OPENCLAW_REQUEST_FAILED status=${last.status}`,
    meta: {
      provider: 'openclaw',
      status: last.status,
      requestUrl: last.requestUrl,
      model: last.model,
      attempts: attempts.map((item) => ({ model: item.model, status: item.status, requestUrl: item.requestUrl })),
      bodyPreview: String(last.body || '').slice(0, 300),
    },
  });
  throw new Error(`OPENCLAW_REQUEST_FAILED: ${String(last.body || '').slice(0, 300)}`);
};

const requestOllama = async (params: LlmTextRequest): Promise<string> => {
  const baseUrl = getOllamaBaseUrl();
  const model = params.model || getOllamaModel() || 'qwen2.5:3b-instruct';

  const response = await fetchWithTimeout(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.2,
        top_p: params.topP,
        num_predict: params.maxTokens ?? 1000,
      },
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    await logStructuredError({
      code: 'LLM_REQUEST_FAILED',
      source: 'llmClient.requestOllama',
      message: `OLLAMA_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'ollama', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OLLAMA_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.message?.content || '').trim();
};

export const generateText = async (params: LlmTextRequest): Promise<string> => {
  const response = await generateTextWithMeta(params);
  return response.text;
};

export const generateTextWithMeta = async (
  params: LlmTextRequest & { includeLogprobs?: boolean },
): Promise<LlmTextWithMetaResponse> => {
  const selection = resolveProviderWithExperiment(params);
  const provider = selection.provider || resolveLlmProvider();
  if (!provider) {
    throw new Error('LLM_PROVIDER_NOT_CONFIGURED');
  }

  const startedAt = Date.now();
  const requestInputChars = String(params.system || '').length + String(params.user || '').length;

  const resolveModel = (p: LlmProvider): string | undefined => {
    if (params.model) return params.model;
    if (p === 'openai') return process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini';
    if (p === 'gemini') return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    if (p === 'anthropic') return process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest';
    if (p === 'huggingface') return process.env.HUGGINGFACE_MODEL || process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
    if (p === 'openclaw') return process.env.OPENCLAW_MODEL || 'openclaw';
    if (p === 'ollama') return getOllamaModel() || 'qwen2.5:3b-instruct';
    return undefined;
  };

  const callProvider = async (targetProvider: LlmProvider): Promise<LlmTextWithMetaResponse> => {
    if (targetProvider === 'openai') {
      const response = await requestOpenAiWithMeta(params, Boolean(params.includeLogprobs));
      return { ...response, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'anthropic') {
      return { text: await requestAnthropic(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'huggingface') {
      return { text: await requestHuggingFace(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'openclaw') {
      return { text: await requestOpenClaw(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    if (targetProvider === 'ollama') {
      return { text: await requestOllama(params), provider: targetProvider, model: resolveModel(targetProvider) };
    }
    return { text: await requestGemini(params), provider: 'gemini', model: resolveModel('gemini') };
  };

  try {
    let response: LlmTextWithMetaResponse;
    try {
      response = await callProvider(provider);
    } catch (error) {
      const fallbackProvider = resolveProviderWithoutExperiment();
      const canFallback = LLM_EXPERIMENT_FAIL_OPEN
        && selection.experiment?.arm === 'huggingface'
        && provider === 'huggingface'
        && fallbackProvider
        && fallbackProvider !== 'huggingface';

      if (!canFallback) {
        throw error;
      }

      response = await callProvider(fallbackProvider);
      response.experiment = selection.experiment;
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const estimatedCostUsd = estimateLlmCallCostUsd(requestInputChars, String(response.text || '').length);
    const enriched: LlmTextWithMetaResponse = {
      ...response,
      latencyMs,
      estimatedCostUsd,
      experiment: selection.experiment || null,
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
    });

    return enriched;
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
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
