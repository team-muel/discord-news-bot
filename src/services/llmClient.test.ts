import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./structuredErrorLogService', () => ({
  logStructuredError: vi.fn().mockResolvedValue(undefined),
}));

// Config values are read at module load time. Re-read from process.env on each access
// so vi.stubEnv() works in tests.
vi.mock('../config', async () => {
  const actual = await vi.importActual('../config') as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...actual };

  // Helper: define a getter that re-reads from process.env on each access
  const envGetter = (key: string, fallbacks: string[] = [], defaultVal = '') => ({
    get: () => {
      for (const k of [key, ...fallbacks]) {
        const v = process.env[k];
        if (v) return v.trim();
      }
      return defaultVal;
    },
    enumerable: true,
    configurable: true,
  });
  const envBool = (key: string, defaultVal: string) => ({
    get: () => !/^(0|false|off|no)$/i.test((process.env[key] || defaultVal).trim()),
    enumerable: true,
    configurable: true,
  });

  Object.defineProperties(copy, {
    OPENAI_API_KEY: envGetter('OPENAI_API_KEY'),
    GEMINI_API_KEY: envGetter('GEMINI_API_KEY', ['GOOGLE_API_KEY']),
    ANTHROPIC_API_KEY: envGetter('ANTHROPIC_API_KEY', ['CLAUDE_API_KEY']),
    HF_TOKEN: envGetter('HF_TOKEN', ['HF_API_KEY', 'HUGGINGFACE_API_KEY']),
    KIMI_API_KEY: envGetter('KIMI_API_KEY', ['MOONSHOT_API_KEY']),
    OPENCLAW_API_KEY: envGetter('OPENCLAW_API_KEY', ['OPENCLAW_KEY']),
    OPENCLAW_BASE_URL: { get: () => (process.env.OPENCLAW_BASE_URL || process.env.OPENCLAW_API_BASE_URL || process.env.OPENCLAW_URL || '').trim().replace(/\/+$/, ''), enumerable: true, configurable: true },
    OLLAMA_BASE_URL: envGetter('OLLAMA_BASE_URL', [], 'http://127.0.0.1:11434'),
    OLLAMA_MODEL: envGetter('OLLAMA_MODEL', ['LOCAL_LLM_MODEL']),
    AI_PROVIDER: { get: () => (process.env.AI_PROVIDER || '').trim().toLowerCase(), enumerable: true, configurable: true },
    OPENJARVIS_ENABLED: envBool('OPENJARVIS_ENABLED', 'false'),
    OPENJARVIS_SERVE_URL: envGetter('OPENJARVIS_SERVE_URL', [], 'http://127.0.0.1:8000'),
    LITELLM_ENABLED: envBool('LITELLM_ENABLED', 'false'),
    LITELLM_BASE_URL: envGetter('LITELLM_BASE_URL', [], 'http://127.0.0.1:4000'),
    LLM_PROVIDER_BASE_ORDER_RAW: envGetter('LLM_PROVIDER_BASE_ORDER'),
    LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER_RAW: envGetter('LLM_PROVIDER_AUTOMATIC_FALLBACK_ORDER'),
    LLM_PROVIDER_FALLBACK_CHAIN_RAW: envGetter('LLM_PROVIDER_FALLBACK_CHAIN'),
    LLM_PROVIDER_POLICY_ACTIONS_RAW: envGetter('LLM_PROVIDER_POLICY_ACTIONS'),
    LLM_WORKFLOW_MODEL_BINDINGS_RAW: envGetter('LLM_WORKFLOW_MODEL_BINDINGS'),
    LLM_WORKFLOW_PROFILE_DEFAULTS_RAW: envGetter('LLM_WORKFLOW_PROFILE_DEFAULTS'),
    LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED: envBool('LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED', 'true'),
    LLM_PROVIDER_MAX_ATTEMPTS: { get: () => Number(process.env.LLM_PROVIDER_MAX_ATTEMPTS || '3'), enumerable: true, configurable: true },
    OPENCLAW_GATEWAY_ENABLED: envBool('OPENCLAW_GATEWAY_ENABLED', 'true'),
    OPENCLAW_GATEWAY_URL: envGetter('OPENCLAW_GATEWAY_URL'),
    OPENCLAW_GATEWAY_TOKEN: envGetter('OPENCLAW_GATEWAY_TOKEN'),
  });
  return copy;
});

import { generateText, getLlmRuntimeSnapshot, isAnyLlmConfigured, resolveLlmProvider, resetGateProviderProfileOverride, setGateProviderProfileOverride } from './llmClient';
import { preflightProviderChain, resetProviderRuntimeReadiness } from './llm/providers';
import { resetLlmRoutingCaches, resolveProviderChain } from './llm/routing';

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
  vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
  vi.stubEnv('OLLAMA_MODEL', '');
  vi.stubEnv('LOCAL_LLM_MODEL', '');
  vi.stubEnv('AI_PROVIDER', '');
  vi.stubEnv('LLM_PROVIDER_BASE_ORDER', '');
  vi.stubEnv('LLM_PROVIDER_FALLBACK_CHAIN', '');
  vi.stubEnv('LLM_PROVIDER_POLICY_ACTIONS', '');
  vi.stubEnv('LLM_WORKFLOW_MODEL_BINDINGS', '');
  vi.stubEnv('LLM_WORKFLOW_PROFILE_DEFAULTS', '');
  vi.stubEnv('LLM_PROVIDER_MAX_ATTEMPTS', '3');
  vi.stubEnv('OPENJARVIS_SERVE_URL', 'http://127.0.0.1:8000');
  vi.stubEnv('LITELLM_BASE_URL', 'http://127.0.0.1:4000');
  vi.stubEnv('OPENJARVIS_ENABLED', '');
  vi.stubEnv('LITELLM_ENABLED', '');
};

// ──────────────────────────────────────────────────────────
describe('isAnyLlmConfigured', () => {
  beforeEach(() => {
    clearLlmEnv();
    resetProviderRuntimeReadiness();
    resetLlmRoutingCaches();
    resetGateProviderProfileOverride();
  });
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
  beforeEach(() => {
    clearLlmEnv();
    resetProviderRuntimeReadiness();
    resetLlmRoutingCaches();
  });
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

  it('OPENJARVIS_ENABLED가 켜져 있으면 기본 폴백은 openjarvis를 우선한다', () => {
    vi.stubEnv('OPENJARVIS_ENABLED', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'sk-primary');
    expect(resolveLlmProvider()).toBe('openjarvis');
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

  it('AI_PROVIDER=local + OLLAMA_MODEL → ollama', () => {
    vi.stubEnv('AI_PROVIDER', 'local');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    expect(resolveLlmProvider()).toBe('ollama');
  });

  it('LLM_PROVIDER_BASE_ORDER가 local-first이면 ollama를 우선 선택한다', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-primary');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'ollama,openai');
    expect(resolveLlmProvider()).toBe('ollama');
  });
});

// ──────────────────────────────────────────────────────────
describe('generateText', () => {
  beforeEach(() => {
    clearLlmEnv();
    resetProviderRuntimeReadiness();
    resetLlmRoutingCaches();
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

  it('code capability는 local ollama 이후 raw gateway보다 direct code-grade providers를 먼저 둔다', () => {
    vi.stubEnv('AI_PROVIDER', 'openclaw');
    vi.stubEnv('OPENCLAW_BASE_URL', 'http://gateway.example');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'openclaw,openai,ollama');

    const chain = resolveProviderChain(
      { system: 'sys', user: 'hello', actionName: 'action.code.write' },
      'openclaw',
      { provider: 'openclaw', experiment: null },
    );

    expect(chain.slice(0, 3)).toEqual(['ollama', 'openai', 'openclaw']);
  });

  it('operations capability는 openjarvis orchestration lane을 먼저 둔다', () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('OPENJARVIS_ENABLED', 'true');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'ollama,openjarvis');

    const chain = resolveProviderChain(
      { system: 'sys', user: 'hello', actionName: 'operate.ops' },
      'ollama',
      { provider: 'ollama', experiment: null },
    );

    expect(chain.slice(0, 2)).toEqual(['openjarvis', 'ollama']);
  });

  it('runtime snapshot은 workflow binding과 effective profile을 노출한다', async () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('OPENJARVIS_ENABLED', 'true');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'ollama,openjarvis');
    vi.stubEnv('LLM_PROVIDER_POLICY_ACTIONS', 'operate.ops=openjarvis,ollama');
    vi.stubEnv('LLM_WORKFLOW_MODEL_BINDINGS', 'operate.ops=openjarvis:qwen2.5:7b');
    vi.stubEnv('LLM_WORKFLOW_PROFILE_DEFAULTS', 'operate.ops=quality-optimized');

    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ models: [] }) };
      }
      if (url.endsWith('/health')) {
        return { ok: true, status: 200, text: async () => 'ok' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const snapshot = await getLlmRuntimeSnapshot({ actionName: 'operate.ops' });

    expect(snapshot.routingCapability).toBe('operations');
    expect(snapshot.actionPolicyProviders).toEqual(['openjarvis', 'ollama']);
    expect(snapshot.workflowBinding).toEqual({ provider: 'openjarvis', model: 'qwen2.5:7b' });
    expect(snapshot.workflowProfile).toBe('quality-optimized');
    expect(snapshot.gateProviderProfile).toBe(null);
    expect(snapshot.effectiveProviderProfile).toBe('quality-optimized');
    expect(snapshot.readyChain.slice(0, 2)).toEqual(['openjarvis', 'ollama']);
  });

  it('runtime snapshot은 활성 gate override profile을 별도 노출한다', async () => {
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('OPENJARVIS_ENABLED', 'true');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'ollama,openjarvis');
    vi.stubEnv('LLM_WORKFLOW_PROFILE_DEFAULTS', 'operate.ops=quality-optimized');

    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ models: [] }) };
      }
      if (url.endsWith('/health')) {
        return { ok: true, status: 200, text: async () => 'ok' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    setGateProviderProfileOverride('cost-optimized', 'guild-1');

    const snapshot = await getLlmRuntimeSnapshot({ actionName: 'operate.ops', guildId: 'guild-1' });

    expect(snapshot.workflowProfile).toBe('quality-optimized');
    expect(snapshot.gateProviderProfile).toBe('cost-optimized');
    expect(snapshot.effectiveProviderProfile).toBe('cost-optimized');
  });

  it('preflight는 죽은 litellm health endpoint를 체인에서 제외한다', async () => {
    vi.stubEnv('LITELLM_ENABLED', 'true');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'litellm,ollama');

    const mockFetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/health/liveliness')) {
        throw new Error('connect ECONNREFUSED');
      }
      return { ok: true, json: async () => ({ models: [] }) };
    });
    vi.stubGlobal('fetch', mockFetch);

    const ready = await preflightProviderChain(['litellm', 'ollama']);
    expect(ready).toEqual(['ollama']);
  });

  it('실패한 litellm provider는 다음 호출에서 cooldown 동안 건너뛴다', async () => {
    vi.stubEnv('AI_PROVIDER', 'litellm');
    vi.stubEnv('LITELLM_ENABLED', 'true');
    vi.stubEnv('LITELLM_BASE_URL', 'http://127.0.0.1:4000');
    vi.stubEnv('LITELLM_MODEL', 'muel-local');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5:7b');
    vi.stubEnv('LLM_PROVIDER_BASE_ORDER', 'litellm,ollama');
    vi.stubEnv('LLM_PROVIDER_FALLBACK_CHAIN', 'ollama');
    vi.stubEnv('LLM_PROVIDER_AUTOMATIC_FALLBACK_ENABLED', 'false');

    const mockFetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health/liveliness')) {
        return { ok: true, status: 200, text: async () => 'ok' };
      }
      if (url.endsWith('/api/tags')) {
        return { ok: true, status: 200, json: async () => ({ models: [] }) };
      }
      if (url.endsWith('/v1/chat/completions')) {
        throw new Error('socket hang up');
      }
      if (url.endsWith('/api/chat')) {
        return {
          ok: true,
          json: async () => ({ message: { content: 'ollama fallback ok' } }),
        };
      }
      throw new Error(`unexpected fetch: ${url} ${String(init?.method || 'GET')}`);
    });
    vi.stubGlobal('fetch', mockFetch);

    const first = await generateText({ system: 'sys', user: 'hello' });
    const second = await generateText({ system: 'sys', user: 'hello again' });

    expect(first).toBe('ollama fallback ok');
    expect(second).toBe('ollama fallback ok');
    const litellmCompletionsCalls = mockFetch.mock.calls.filter((call) => String(call[0]).endsWith('/v1/chat/completions'));
    expect(litellmCompletionsCalls).toHaveLength(1);
  });
});
