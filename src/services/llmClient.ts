import { logStructuredError } from './structuredErrorLogService';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const LLM_API_TIMEOUT_MS = Math.max(1000, Number(process.env.LLM_API_TIMEOUT_MS || 15000));

export type LlmProvider = 'openai' | 'gemini' | 'anthropic' | 'openclaw' | 'ollama';

export type LlmTextRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  provider?: LlmProvider;
  model?: string;
};

const getOpenAiKey = () => String(process.env.OPENAI_API_KEY || '').trim();
const getGeminiKey = () => String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const getAnthropicKey = () => String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '').trim();
const getOpenClawApiKey = () => String(process.env.OPENCLAW_API_KEY || process.env.OPENCLAW_KEY || '').trim();
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
    || isOpenClawConfigured()
    || isOllamaConfigured(),
);

export const resolveLlmProvider = (): LlmProvider | null => {
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

  if (isOpenClawConfigured()) {
    return 'openclaw';
  }

  if (isOllamaConfigured()) {
    return 'ollama';
  }

  return null;
};

const requestOpenAi = async (params: LlmTextRequest): Promise<string> => {
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
      source: 'llmClient.requestOpenAi',
      message: `OPENAI_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'openai', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OPENAI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
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

  const response = await fetchWithTimeout(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model || process.env.OPENCLAW_MODEL || 'openclaw',
      temperature: params.temperature ?? 0.2,
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
      source: 'llmClient.requestOpenClaw',
      message: `OPENCLAW_REQUEST_FAILED status=${response.status}`,
      meta: { provider: 'openclaw', status: response.status, bodyPreview: body.slice(0, 300) },
    });
    throw new Error(`OPENCLAW_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
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
  const provider = params.provider || resolveLlmProvider();
  if (!provider) {
    throw new Error('LLM_PROVIDER_NOT_CONFIGURED');
  }

  if (provider === 'openai') {
    return requestOpenAi(params);
  }

  if (provider === 'anthropic') {
    return requestAnthropic(params);
  }

  if (provider === 'openclaw') {
    return requestOpenClaw(params);
  }

  if (provider === 'ollama') {
    return requestOllama(params);
  }

  return requestGemini(params);
};
