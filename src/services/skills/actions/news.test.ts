import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunDelegatedAction, mockDelegateNewsRssFetch, mockShouldSkipInlineFallback } = vi.hoisted(() => ({
  mockRunDelegatedAction: vi.fn(),
  mockDelegateNewsRssFetch: vi.fn(),
  mockShouldSkipInlineFallback: vi.fn<(task: unknown) => boolean>(() => false),
}));

vi.mock('./mcpDelegatedAction', () => ({
  runDelegatedAction: (...args: unknown[]) => mockRunDelegatedAction(...args),
}));

vi.mock('../../automation/n8nDelegationService', () => ({
  delegateNewsRssFetch: (...args: unknown[]) => mockDelegateNewsRssFetch(...args),
  shouldSkipInlineFallback: (task: unknown) => mockShouldSkipInlineFallback(task),
}));

describe('newsGoogleSearchAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRunDelegatedAction.mockReset().mockResolvedValue(null);
    mockDelegateNewsRssFetch.mockReset();
    mockShouldSkipInlineFallback.mockReset().mockReturnValue(false);
  });

  it('keeps inline RSS fallback when delegation-first is disabled', async () => {
    mockDelegateNewsRssFetch.mockResolvedValue({ delegated: false, ok: false, data: null, durationMs: 0 });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<?xml version="1.0"?><rss><channel><item><title>AI headline</title><link>https://example.com/a</link></item></channel></rss>',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { newsGoogleSearchAction } = await import('./news');
    const result = await newsGoogleSearchAction.execute({ goal: 'AI 뉴스 검색' });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not run inline RSS fallback when delegation-first is enabled and n8n fails', async () => {
    mockShouldSkipInlineFallback.mockReturnValue(true);
    mockDelegateNewsRssFetch.mockResolvedValue({
      delegated: true,
      ok: false,
      data: null,
      error: 'HTTP_500',
      durationMs: 12,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { newsGoogleSearchAction } = await import('./news');
    const result = await newsGoogleSearchAction.execute({ goal: 'AI 뉴스 검색' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('N8N_DELEGATION_FAILED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats empty delegated RSS results as authoritative in delegation-first mode', async () => {
    mockShouldSkipInlineFallback.mockReturnValue(true);
    mockDelegateNewsRssFetch.mockResolvedValue({
      delegated: true,
      ok: true,
      data: { items: [] },
      durationMs: 8,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { newsGoogleSearchAction } = await import('./news');
    const result = await newsGoogleSearchAction.execute({ goal: 'AI 뉴스 검색' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('N8N_DELEGATION_EMPTY');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});