import type { ScrapedYouTubePost } from './types';

const fetchWithTimeout = async (input: string, timeoutMs = Number(process.env.YOUTUBE_FETCH_TIMEOUT_MS || 12000)) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3000, timeoutMs));
  try {
    return await fetch(input, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const extractByRegex = (html: string, regex: RegExp) => {
  const match = html.match(regex);
  return match?.[1] || '';
};

const normalizeHeadline = (rawTitle: string) => {
  const titleNoSiteSuffix = rawTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();
  const titleNoVendorTag = titleNoSiteSuffix.replace(/^\s*\[Google Finance\]\s*/i, '').trim();

  const metaMatch = titleNoVendorTag.match(
    /^(?<source>[^\d\[\]]{2,50}?)\s+(?<age>(?:\d+\s*)?(?:분|시간|일|주|개월|년)\s*전|(?:\d+\s*)?(?:minute|hour|day|week|month|year)s?\s+ago)\s+(?<headline>.+)$/i,
  );

  if (!metaMatch?.groups) {
    return {
      content: titleNoVendorTag,
    };
  }

  return {
    content: metaMatch.groups.headline.trim(),
    sourceLabel: metaMatch.groups.source.trim(),
    publishedLabel: metaMatch.groups.age.trim(),
  };
};

export async function scrapeYouTubePost(url: string): Promise<ScrapedYouTubePost> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`유튜브 페이지 응답 오류: HTTP ${response.status}`);
  }

  const html = await response.text();
  const title = extractByRegex(html, /<title>(.*?)<\/title>/i);
  const normalized = normalizeHeadline(title);

  const imageUrl = extractByRegex(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const author = extractByRegex(html, /<meta\s+name="author"\s+content="([^"]+)"/i) || '유튜브 채널';

  return {
    content: normalized.content || 'YouTube 콘텐츠',
    imageUrl,
    author,
    sourceLabel: normalized.sourceLabel,
    publishedLabel: normalized.publishedLabel,
  };
}
