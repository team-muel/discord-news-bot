import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config', () => ({
  AI_PROVIDER: 'openai',
  ANTHROPIC_API_KEY: 'anthropic-test',
  ANTHROPIC_MODEL: 'claude-test',
  ANTHROPIC_VERSION: '2023-06-01',
  GEMINI_API_KEY: 'gemini-test',
  GEMINI_MODEL: 'gemini-test',
  HF_TOKEN: 'hf-test',
  HUGGINGFACE_CHAT_COMPLETIONS_URL: 'https://hf.example/v1/chat/completions',
  HUGGINGFACE_MODEL: 'hf-model',
  KIMI_API_KEY: '',
  KIMI_BASE_URL: 'https://kimi.example',
  KIMI_MODEL: 'kimi-model',
  LITELLM_BASE_URL: 'https://litellm.example',
  LITELLM_ENABLED: false,
  LITELLM_MASTER_KEY: '',
  LITELLM_MODEL: 'litellm-model',
  LLM_API_TIMEOUT_MS: 1000,
  LLM_API_TIMEOUT_LARGE_MS: 2000,
  OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OPENCLAW_API_KEY: '',
  OPENCLAW_BASE_URL: 'https://openclaw.example',
  OPENCLAW_FALLBACK_MODELS_RAW: '',
  OPENCLAW_MODEL: 'muel-balanced',
  OPENAI_ANALYSIS_MODEL: 'gpt-test',
  OPENAI_API_KEY: 'openai-test',
  OPENJARVIS_ENABLED: false,
  OPENJARVIS_MODEL: 'openjarvis-test',
  OPENJARVIS_SERVE_URL: 'http://127.0.0.1:8000',
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../structuredErrorLogService', () => ({
  logStructuredError: vi.fn(async () => undefined),
}));

vi.mock('../openclaw/gatewayHealth', () => ({
  sendGatewayChat: vi.fn(async () => null),
  isModelOnCooldown: vi.fn(() => false),
  setModelCooldown: vi.fn(),
  getModelCooldownUntil: vi.fn(() => 0),
  parseRetryDelayMs: vi.fn(() => 0),
}));

describe('llm providers normalization helpers', () => {
  beforeEach(async () => {
    const { resetProviderRuntimeReadiness } = await import('./providers');
    resetProviderRuntimeReadiness();
    vi.clearAllMocks();
  });

  it('extracts OpenAI-compatible text and numeric logprobs', async () => {
    const { extractOpenAiCompatibleText, extractOpenAiTokenLogprobs } = await import('./providers');

    const payload = {
      choices: [{
        message: { content: 'hello world' },
        logprobs: {
          content: [{ logprob: -0.1 }, { logprob: '-0.2' }, { logprob: 'NaN' }],
        },
      }],
    };

    expect(extractOpenAiCompatibleText(payload)).toBe('hello world');
    expect(extractOpenAiTokenLogprobs(payload)).toEqual([-0.1, -0.2]);
  });

  it('extracts Gemini text parts in order', async () => {
    const { extractGeminiResponseText } = await import('./providers');

    const payload = {
      candidates: [{
        content: {
          parts: [{ text: 'line one' }, { text: 'line two' }, { ignored: true }],
        },
      }],
    };

    expect(extractGeminiResponseText(payload)).toBe('line one\nline two');
  });

  it('extracts Anthropic text blocks only', async () => {
    const { extractAnthropicResponseText } = await import('./providers');

    const payload = {
      content: [
        { type: 'text', text: 'alpha' },
        { type: 'tool_use', name: 'search' },
        { type: 'text', text: 'beta' },
      ],
    };

    expect(extractAnthropicResponseText(payload)).toBe('alpha\nbeta');
  });

  it('marks openclaw unreachable when the configured base URL is control-only html', async () => {
    const { fetchWithTimeout } = await import('../../utils/network');
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null },
    } as Response);

    const { getProviderRuntimeReadiness } = await import('./providers');
    const readiness = await getProviderRuntimeReadiness('openclaw');

    expect(readiness.configured).toBe(true);
    expect(readiness.status).toBe('unreachable');
    expect(readiness.reason).toBe('OPENCLAW_CONTROL_UI_ONLY');
  });

  it('marks openclaw ready when the configured base URL returns json models', async () => {
    const { fetchWithTimeout } = await import('../../utils/network');
    const mockFetch = vi.mocked(fetchWithTimeout);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    } as Response);

    const { getProviderRuntimeReadiness } = await import('./providers');
    const readiness = await getProviderRuntimeReadiness('openclaw');

    expect(readiness.status).toBe('ready');
    expect(readiness.reason).toBeNull();
  });
});