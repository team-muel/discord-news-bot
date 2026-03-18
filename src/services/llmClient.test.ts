import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./structuredErrorLogService', () => ({
  logStructuredError: vi.fn().mockResolvedValue(undefined),
}));

import { generateText, isAnyLlmConfigured, resolveLlmProvider } from './llmClient';

// ──────────────────────────────────────────────────────────
// 헬퍼: 모든 LLM 관련 환경변수를 지운다
// ──────────────────────────────────────────────────────────
const clearLlmEnv = () => {
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GOOGLE_API_KEY', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CLAUDE_API_KEY', '');
  vi.stubEnv('HF_TOKEN', '');
  vi.stubEnv('HF_API_KEY', '');
  vi.stubEnv('HUGGINGFACE_API_KEY', '');
  vi.stubEnv('OPENCLAW_BASE_URL', '');
  vi.stubEnv('OPENCLAW_API_BASE_URL', '');
  vi.stubEnv('OPENCLAW_URL', '');
  vi.stubEnv('OLLAMA_MODEL', '');
  vi.stubEnv('LOCAL_LLM_MODEL', '');
  vi.stubEnv('AI_PROVIDER', '');
};

// ──────────────────────────────────────────────────────────
describe('isAnyLlmConfigured', () => {
  beforeEach(() => clearLlmEnv());
  afterEach(() => vi.unstubAllEnvs());

  it('아무 API 키도 없으면 false를 반환한다', () => {
    expect(isAnyLlmConfigured()).toBe(false);
  });

  it('OPENAI_API_KEY가 설정되면 true를 반환한다', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test123');
    expect(isAnyLlmConfigured()).toBe(true);
  });

  it('GEMINI_API_KEY가 설정되면 true를 반환한다', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key');
    expect(isAnyLlmConfigured()).toBe(true);
  });

  it('ANTHROPIC_API_KEY가 설정되면 true를 반환한다', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(isAnyLlmConfigured()).toBe(true);
  });

  it('HF_API_KEY가 설정되면 true를 반환한다', () => {
    vi.stubEnv('HF_API_KEY', 'hf_test_key');
    expect(isAnyLlmConfigured()).toBe(true);
  });

  it('HF_TOKEN이 설정되면 true를 반환한다', () => {
    vi.stubEnv('HF_TOKEN', 'hf_token_value');
    expect(isAnyLlmConfigured()).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
describe('resolveLlmProvider', () => {
  beforeEach(() => clearLlmEnv());
  afterEach(() => vi.unstubAllEnvs());

  it('아무 것도 설정 안 되면 null을 반환한다', () => {
    expect(resolveLlmProvider()).toBeNull();
  });

  it('AI_PROVIDER=openai + OPENAI_API_KEY → openai', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('AI_PROVIDER', 'openai');
    expect(resolveLlmProvider()).toBe('openai');
  });

  it('AI_PROVIDER=anthropic + ANTHROPIC_API_KEY → anthropic', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    expect(resolveLlmProvider()).toBe('anthropic');
  });

  it('AI_PROVIDER=claude + ANTHROPIC_API_KEY → anthropic (alias)', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.stubEnv('AI_PROVIDER', 'claude');
    expect(resolveLlmProvider()).toBe('anthropic');
  });

  it('AI_PROVIDER 없이 OPENAI_API_KEY만 있으면 openai 폴백', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-primary');
    expect(resolveLlmProvider()).toBe('openai');
  });

  it('OPENAI 없이 ANTHROPIC만 있으면 anthropic 폴백', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-fallback');
    expect(resolveLlmProvider()).toBe('anthropic');
  });

  it('GEMINI만 있으면 gemini 폴백', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gm-key');
    expect(resolveLlmProvider()).toBe('gemini');
  });

  it('AI_PROVIDER=hf + HF_API_KEY → huggingface', () => {
    vi.stubEnv('HF_API_KEY', 'hf_test_key');
    vi.stubEnv('AI_PROVIDER', 'hf');
    expect(resolveLlmProvider()).toBe('huggingface');
  });

  it('AI_PROVIDER=huggingface + HF_TOKEN → huggingface', () => {
    vi.stubEnv('HF_TOKEN', 'hf_token_value');
    vi.stubEnv('AI_PROVIDER', 'huggingface');
    expect(resolveLlmProvider()).toBe('huggingface');
  });
});

// ──────────────────────────────────────────────────────────
describe('generateText', () => {
  beforeEach(() => {
    clearLlmEnv();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('provider 미설정 → LLM_PROVIDER_NOT_CONFIGURED 에러', async () => {
    await expect(
      generateText({ system: 'sys', user: 'hi' }),
    ).rejects.toThrow('LLM_PROVIDER_NOT_CONFIGURED');
  });

  it('openai provider — 성공 응답 파싱', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '안녕하세요!' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await generateText({ system: 'sys', user: 'hello', provider: 'openai' });
    expect(result).toBe('안녕하세요!');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('openai provider — HTTP 에러 → OPENAI_REQUEST_FAILED', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      generateText({ system: 'sys', user: 'hello', provider: 'openai' }),
    ).rejects.toThrow('OPENAI_REQUEST_FAILED');
  });

  it('anthropic provider — 성공 응답 파싱', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '안녕!' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await generateText({ system: 'sys', user: 'hello', provider: 'anthropic' });
    expect(result).toBe('안녕!');
  });

  it('anthropic provider — HTTP 에러 → ANTHROPIC_REQUEST_FAILED', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit',
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      generateText({ system: 'sys', user: 'hello', provider: 'anthropic' }),
    ).rejects.toThrow('ANTHROPIC_REQUEST_FAILED');
  });

  it('OPENAI_API_KEY가 없으면 requestOpenAi에서 OPENAI_API_KEY_NOT_CONFIGURED 에러', async () => {
    // No key set, but force provider=openai to skip resolveLlmProvider fallback
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(
      generateText({ system: 'sys', user: 'hello', provider: 'openai' }),
    ).rejects.toThrow('OPENAI_API_KEY_NOT_CONFIGURED');
  });
});
