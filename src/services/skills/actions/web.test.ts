import { beforeEach, describe, expect, it, vi } from 'vitest';

const runDelegatedActionMock = vi.fn();

vi.mock('./mcpDelegatedAction', () => ({
  runDelegatedAction: runDelegatedActionMock,
}));

describe('webFetchAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.stubEnv('ACTION_WEB_FETCH_ALLOWED_HOSTS', 'pytorch.kr,example.com');
    runDelegatedActionMock.mockReset().mockResolvedValue(null);
  });

  const loadAction = async () => (await import('./web')).webFetchAction;

  it('Discourse 토픽 URL은 JSON 엔드포인트에서 본문을 추출한다', async () => {
    const webFetchAction = await loadAction();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: 'Bayesian Teaching for LLMs',
        excerpt: '<p>LLM을 더 효율적으로 가르치는 Google Research 글입니다.</p>',
        post_stream: {
          posts: [
            {
              cooked: '<p>핵심은 모델이 더 적은 예시로도 일반화하도록 teaching set을 찾는 것입니다.</p>',
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await webFetchAction.execute({
      goal: 'https://discuss.pytorch.kr/t/bayesian-teaching-llm-google-research/9404',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://discuss.pytorch.kr/t/bayesian-teaching-llm-google-research/9404.json');
    expect(result.artifacts[1]).toContain('Bayesian Teaching for LLMs');
    expect(result.artifacts[1]).toContain('teaching set');
    expect(result.verification).toContain('Discourse topic JSON 추출');
  });

  it('Discourse JSON 추출이 실패하면 일반 HTML fetch로 폴백한다', async () => {
    const webFetchAction = await loadAction();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('json failed'))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body><article>Fallback HTML 본문입니다.</article></body></html>',
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await webFetchAction.execute({
      goal: 'https://discuss.pytorch.kr/t/bayesian-teaching-llm-google-research/9404',
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://discuss.pytorch.kr/t/bayesian-teaching-llm-google-research/9404');
    expect(result.artifacts[1]).toContain('Fallback HTML 본문입니다.');
    expect(result.verification).toContain('본문 텍스트 추출');
  });
});
