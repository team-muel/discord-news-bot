import { describe, it, expect, vi, beforeEach } from 'vitest';

// fetch를 모킹해 네트워크 호출 없이 테스트
const mockDdgHtml = `
<a class="result__a" href="/l/?uddg=https%3A%2F%2Freuters.com%2Farticle%2F1">Reuters 기사 제목</a>
<a class="result__a" href="/l/?uddg=https%3A%2F%2Fbloomberg.com%2Farticle%2F2">Bloomberg 기사 제목</a>
<a class="result__snippet">애플 주가가 상승했습니다.</a>
<a class="result__snippet">애플의 실적 발표가 있었습니다.</a>
`;

describe('webSearchAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.stubEnv('ACTION_WEB_FETCH_ALLOWED_HOSTS', 'reuters.com,bloomberg.com');
  });

  const loadAction = async () => (await import('./webSearch')).webSearchAction;

  it('질의어가 없을 때 에러를 반환한다', async () => {
    const webSearchAction = await loadAction();
    const result = await webSearchAction.execute({ goal: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('QUERY_MISSING');
  });

  it('검색 성공 시 ok=true를 반환한다', async () => {
    const webSearchAction = await loadAction();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockDdgHtml,
    }));

    const result = await webSearchAction.execute({ goal: '애플 주가 검색해줘' });
    expect(result.ok).toBe(true);
    expect(result.name).toBe('web.search');
    expect(result.artifacts.length).toBeGreaterThan(0);
  });

  it('fetch 실패 시 에러를 반환한다', async () => {
    const webSearchAction = await loadAction();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await webSearchAction.execute({ goal: '삼성전자 검색' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('SEARCH_FAILED');
  });

  it('검색 결과가 없을 때 NO_RESULTS를 반환한다', async () => {
    const webSearchAction = await loadAction();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><body>no results</body></html>',
    }));

    const result = await webSearchAction.execute({ goal: 'zzzznonexistent12345xyz' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('NO_RESULTS');
  });
});
