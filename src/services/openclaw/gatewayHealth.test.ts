import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../config', () => ({
  OPENCLAW_GATEWAY_URL: 'http://gw.test:4000',
  OPENCLAW_GATEWAY_TOKEN: 'tok-test',
  OPENCLAW_GATEWAY_ENABLED: true,
  OPENCLAW_MODEL: 'openclaw-main',
  OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS: 30_000,
}));

vi.mock('../../utils/network', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), debug: vi.fn() },
}));

const mockInsert = vi.fn().mockResolvedValue({ error: null });
vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: () => ({ insert: mockInsert }) }),
}));

// Dynamic import after mocks
const {
  checkOpenClawGatewayHealth,
  checkOpenClawGatewayChatSupport,
  __resetGatewayHealthStateForTests,
  markGatewayUnhealthy,
  isGatewayHealthy,
  getGatewayHeaders,
  sendGatewayChat,
  isModelOnCooldown,
  setModelCooldown,
  getModelCooldownUntil,
  parseRetryDelayMs,
  getModelCooldownSnapshot,
} = await import('./gatewayHealth');

const { fetchWithTimeout } = await import('../../utils/network');
const mockFetch = vi.mocked(fetchWithTimeout) as unknown as MockInstance;

// ── Helpers ──────────────────────────────────────────────────────────────────

const okResponse = (body: Record<string, unknown> = {}, contentType = 'application/json') => ({
  ok: true,
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
  json: async () => body,
});

const failResponse = (contentType = 'application/json') => ({
  ok: false,
  headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType : null },
  json: async () => ({}),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('gatewayHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    __resetGatewayHealthStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkOpenClawGatewayHealth', () => {
    it('returns true when gateway responds ok', async () => {
      mockFetch.mockResolvedValueOnce(okResponse());
      // Advance past TTL to force a fresh check
      vi.advanceTimersByTime(20_000);
      const result = await checkOpenClawGatewayHealth();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://gw.test:4000/healthz', {}, 3000);
    });

    it('returns false when gateway responds not-ok', async () => {
      mockFetch.mockResolvedValueOnce(failResponse());
      vi.advanceTimersByTime(20_000);
      const result = await checkOpenClawGatewayHealth();
      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network'));
      vi.advanceTimersByTime(20_000);
      const result = await checkOpenClawGatewayHealth();
      expect(result).toBe(false);
    });

    it('caches result within TTL', async () => {
      mockFetch.mockResolvedValueOnce(okResponse());
      vi.advanceTimersByTime(20_000);
      await checkOpenClawGatewayHealth();
      // Second call within TTL should not hit network
      const result = await checkOpenClawGatewayHealth();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('records health transition to Supabase observations', async () => {
      mockFetch.mockResolvedValueOnce(okResponse());
      vi.advanceTimersByTime(20_000);
      await checkOpenClawGatewayHealth();
      // Flush microtasks for the async insert
      await vi.advanceTimersByTimeAsync(0);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'openclaw',
          title: expect.stringMatching(/openclaw_gateway/),
        }),
      );
    });
  });

  describe('markGatewayUnhealthy', () => {
    it('sets health to false', () => {
      markGatewayUnhealthy();
      expect(isGatewayHealthy()).toBe(false);
    });
  });

  describe('checkOpenClawGatewayChatSupport', () => {
    it('returns true when models endpoint is json', async () => {
      mockFetch
        .mockResolvedValueOnce(okResponse())
        .mockResolvedValueOnce(okResponse({ data: [{ id: 'openclaw-main' }] }));

      vi.advanceTimersByTime(20_000);
      const result = await checkOpenClawGatewayChatSupport();
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://gw.test:4000/v1/models', {
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-test' }),
      }, 5000);
    });

    it('returns false when models endpoint returns html', async () => {
      mockFetch
        .mockResolvedValueOnce(okResponse())
        .mockResolvedValueOnce(okResponse({}, 'text/html; charset=utf-8'));

      vi.advanceTimersByTime(20_000);
      const result = await checkOpenClawGatewayChatSupport();
      expect(result).toBe(false);
    });
  });

  describe('getGatewayHeaders', () => {
    it('includes Content-Type and Authorization', () => {
      const headers = getGatewayHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer tok-test');
    });
  });

  describe('sendGatewayChat', () => {
    it('returns response text on success', async () => {
      // First: force health check to pass
      mockFetch.mockResolvedValueOnce(okResponse()); // healthz
      mockFetch.mockResolvedValueOnce(okResponse({ data: [{ id: 'openclaw-main' }] })); // /v1/models
      vi.advanceTimersByTime(20_000);
      mockFetch.mockResolvedValueOnce(okResponse({ choices: [{ message: { content: 'Hello world' } }] })); // /v1/chat/completions

      const result = await sendGatewayChat({ user: 'hi', system: 'test' });
      expect(result).toBe('Hello world');

      const call = mockFetch.mock.calls[2];
      const request = call?.[1] as { body?: string } | undefined;
      const payload = request?.body ? JSON.parse(request.body) as { model?: string } : null;
      expect(payload?.model).toBe('openclaw-main');
    });

    it('returns null when gateway is unhealthy', async () => {
      mockFetch.mockResolvedValueOnce(failResponse()); // healthz fails
      vi.advanceTimersByTime(20_000);
      const result = await sendGatewayChat({ user: 'hi', system: 'test' });
      expect(result).toBeNull();
    });

    it('returns null on empty response', async () => {
      mockFetch.mockResolvedValueOnce(okResponse()); // healthz
      mockFetch.mockResolvedValueOnce(okResponse({ data: [{ id: 'openclaw-main' }] })); // /v1/models
      vi.advanceTimersByTime(20_000);
      mockFetch.mockResolvedValueOnce(okResponse({ choices: [{ message: { content: '' } }] })); // /v1/chat/completions

      const result = await sendGatewayChat({ user: 'hi', system: 'test' });
      expect(result).toBeNull();
    });

    it('marks gateway unhealthy on fetch error', async () => {
      mockFetch.mockResolvedValueOnce(okResponse()); // healthz
      mockFetch.mockResolvedValueOnce(okResponse({ data: [{ id: 'openclaw-main' }] })); // /v1/models
      vi.advanceTimersByTime(20_000);
      mockFetch.mockRejectedValueOnce(new Error('timeout')); // /v1/chat/completions

      const result = await sendGatewayChat({ user: 'hi', system: 'test' });
      expect(result).toBeNull();
      expect(isGatewayHealthy()).toBe(false);
    });

    it('returns null when gateway is control-only html', async () => {
      mockFetch.mockResolvedValueOnce(okResponse()); // healthz
      mockFetch.mockResolvedValueOnce(okResponse({}, 'text/html; charset=utf-8')); // /v1/models
      vi.advanceTimersByTime(20_000);

      const result = await sendGatewayChat({ user: 'hi', system: 'test' });
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('model cooldown', () => {
    it('returns false when no cooldown set', () => {
      expect(isModelOnCooldown('gpt-4')).toBe(false);
      expect(getModelCooldownUntil('gpt-4')).toBe(0);
    });

    it('tracks cooldown correctly', () => {
      const future = Date.now() + 60_000;
      setModelCooldown('gpt-4', future);
      expect(isModelOnCooldown('gpt-4')).toBe(true);
      expect(getModelCooldownUntil('gpt-4')).toBe(future);
    });

    it('cooldown expires after time passes', () => {
      setModelCooldown('gpt-4', Date.now() + 5_000);
      vi.advanceTimersByTime(6_000);
      expect(isModelOnCooldown('gpt-4')).toBe(false);
    });

    it('snapshot returns only active cooldowns', () => {
      setModelCooldown('model-a', Date.now() + 60_000);
      setModelCooldown('model-b', Date.now() - 1_000); // expired
      const snap = getModelCooldownSnapshot();
      expect(snap).toHaveLength(1);
      expect(snap[0].model).toBe('model-a');
    });
  });

  describe('parseRetryDelayMs', () => {
    it('parses retryDelay JSON field', () => {
      expect(parseRetryDelayMs('{"retryDelay":"30s"}')).toBe(30_000);
    });

    it('parses "Please retry in Xs" text', () => {
      expect(parseRetryDelayMs('Rate limited. Please retry in 10.5s')).toBe(10_500);
    });

    it('returns default for unrecognized body', () => {
      expect(parseRetryDelayMs('unknown error')).toBe(30_000); // OPENCLAW_MODEL_COOLDOWN_DEFAULT_MS
    });

    it('enforces minimum 1s', () => {
      expect(parseRetryDelayMs('{"retryDelay":"0s"}')).toBe(1_000);
    });
  });
});
