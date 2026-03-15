import { describe, it, expect, vi, beforeEach } from 'vitest';

// policy 모듈을 모킹해 테스트 환경에서 웹 접근을 허용
vi.mock('./policy', () => ({
  isWebHostAllowed: () => true,
  isActionAllowed: () => true,
}));

import { newsVerifyAction } from './newsVerify';

const MOCK_RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>애플 주가 급등 - 실적 호조</title>
    <link>https://reuters.com/article/apple-1</link>
  </item>
  <item>
    <title>애플, 분기 매출 신기록</title>
    <link>https://bloomberg.com/article/apple-2</link>
  </item>
</channel></rss>`;

const MOCK_BODY = '<html><body><p>Apple stock surged after quarterly earnings beat expectations.</p></body></html>';

describe('newsVerifyAction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('주제가 없을 때 에러를 반환한다', async () => {
    const result = await newsVerifyAction.execute({ goal: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('QUERY_MISSING');
  });

  it('RSS 결과가 2건 미만이면 INSUFFICIENT_SOURCES를 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<rss><channel></channel></rss>',
    }));

    const result = await newsVerifyAction.execute({ goal: '애플 주가 검증해줘' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_SOURCES');
  });

  it('RSS 후보 2건 이상이면 ok=true를 반환하고 verdict를 포함한다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => MOCK_RSS }) // RSS fetch
      .mockResolvedValue({ ok: true, text: async () => MOCK_BODY }); // 각 소스 fetch

    vi.stubGlobal('fetch', fetchMock);

    const result = await newsVerifyAction.execute({ goal: '애플 주가 검증' });
    expect(result.ok).toBe(true);
    expect(result.name).toBe('news.verify');
    const hasVerdict = result.artifacts.some((line) =>
      line.includes('CONSISTENT') || line.includes('CONFLICT') || line.includes('UNVERIFIED'),
    );
    expect(hasVerdict).toBe(true);
  });

  it('fetch 실패로 UNVERIFIED가 되면 non-success와 에러 코드를 반환한다', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => MOCK_RSS }) // RSS ok
      .mockRejectedValue(new Error('source fetch failed')); // 소스 fetch 실패

    vi.stubGlobal('fetch', fetchMock);

    const result = await newsVerifyAction.execute({ goal: '애플 검증' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('UNVERIFIED_CONTENT');
    expect(result.artifacts.length).toBeGreaterThan(0);
  });
});
