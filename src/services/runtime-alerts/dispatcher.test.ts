import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockShouldDelegate, mockDelegateAlertDispatch, mockFetch } = vi.hoisted(() => ({
  mockShouldDelegate: vi.fn(() => false),
  mockDelegateAlertDispatch: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock('../automation/n8nDelegationService', () => ({
  shouldDelegate: mockShouldDelegate,
  delegateAlertDispatch: mockDelegateAlertDispatch,
}));

vi.mock('./config', () => ({
  RUNTIME_ALERT_COOLDOWN_MS: 0, // disable cooldown for testing
  RUNTIME_ALERT_WEBHOOK_URL: 'https://hooks.test/alert',
}));

vi.mock('../../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@sentry/node', () => ({
  withScope: vi.fn((fn: any) => {
    const scope = { setLevel: vi.fn(), setTag: vi.fn(), setExtra: vi.fn() };
    fn(scope);
  }),
  captureMessage: vi.fn(),
}));

describe('alert dispatcher', () => {
  beforeEach(() => {
    mockShouldDelegate.mockReset().mockReturnValue(false);
    mockDelegateAlertDispatch.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('dispatches alert via n8n when delegation is available', async () => {
    mockShouldDelegate.mockReturnValue(true);
    mockDelegateAlertDispatch.mockResolvedValue({ delegated: true, ok: true, data: null });

    const { createAlertDispatcher } = await import('./dispatcher');
    const emit = createAlertDispatcher();
    await emit({ key: 'test-1', title: 'Bot Down', message: 'unreachable' });

    expect(mockDelegateAlertDispatch).toHaveBeenCalledWith('Bot Down', 'unreachable', {});
    // Should NOT fall through to inline webhook
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to inline webhook when n8n fails', async () => {
    mockShouldDelegate.mockReturnValue(true);
    mockDelegateAlertDispatch.mockResolvedValue({ delegated: true, ok: false, data: null });
    mockFetch.mockResolvedValue({ ok: true });

    const { createAlertDispatcher } = await import('./dispatcher');
    const emit = createAlertDispatcher();
    await emit({ key: 'test-2', title: 'Alert', message: 'test' });

    // n8n failed → fell through to inline webhook
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://hooks.test/alert');
    expect(JSON.parse(init.body)).toHaveProperty('text');
  });

  it('uses inline webhook when n8n delegation is disabled', async () => {
    mockShouldDelegate.mockReturnValue(false);
    mockFetch.mockResolvedValue({ ok: true });

    const { createAlertDispatcher } = await import('./dispatcher');
    const emit = createAlertDispatcher();
    await emit({ key: 'test-3', title: 'Alert', message: 'test', tags: { sev: '1' } });

    expect(mockDelegateAlertDispatch).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not throw when webhook fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { createAlertDispatcher } = await import('./dispatcher');
    const emit = createAlertDispatcher();
    await expect(emit({ key: 'test-4', title: 'Err', message: 'msg' })).resolves.not.toThrow();
  });

  it('passes tags to n8n delegation', async () => {
    mockShouldDelegate.mockReturnValue(true);
    mockDelegateAlertDispatch.mockResolvedValue({ delegated: true, ok: true, data: null });

    const { createAlertDispatcher } = await import('./dispatcher');
    const emit = createAlertDispatcher();
    await emit({ key: 'test-5', title: 'X', message: 'Y', tags: { env: 'prod' } });

    expect(mockDelegateAlertDispatch).toHaveBeenCalledWith('X', 'Y', { env: 'prod' });
  });
});
