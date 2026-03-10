import { fetchWithTimeout } from '../utils/network';

type ScrapedCommunityPost = {
  id: string;
  title: string;
  content: string;
  link: string;
  published: string;
  author: string;
};

const decodeHtml = (input: string): string => {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

const truncate = (input: string, maxLength: number): string => {
  const text = String(input || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxLength - 1))}...`;
};

const extractJsonObjectByBraceMatch = (text: string, startIndex: number): string | null => {
  const firstBrace = text.indexOf('{', startIndex);
  if (firstBrace < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, i + 1);
      }
    }
  }

  return null;
};

const extractYtInitialData = (html: string): Record<string, unknown> | null => {
  const markers = [
    'var ytInitialData =',
    'window["ytInitialData"] =',
    "window['ytInitialData'] =",
    'ytInitialData =',
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }

    const jsonText = extractJsonObjectByBraceMatch(html, markerIndex + marker.length);
    if (!jsonText) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next marker.
    }
  }

  return null;
};

const getNested = (source: unknown, path: string[]): unknown => {
  return path.reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, source);
};

const getRunsText = (value: unknown): string => {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as { runs?: Array<{ text?: string }>; simpleText?: string };
  if (typeof record.simpleText === 'string' && record.simpleText.trim()) {
    return record.simpleText.trim();
  }

  const runs = record.runs;
  if (!Array.isArray(runs)) {
    return '';
  }

  return runs.map((item) => String(item?.text || '')).join('').trim();
};

const findFirstPostRenderer = (root: unknown): Record<string, unknown> | null => {
  let found: Record<string, unknown> | null = null;

  const visit = (node: unknown) => {
    if (found || !node || typeof node !== 'object') {
      return;
    }

    const record = node as Record<string, unknown>;
    const backstage = record.backstagePostRenderer;
    if (backstage && typeof backstage === 'object') {
      found = backstage as Record<string, unknown>;
      return;
    }

    const shared = record.sharedPostRenderer;
    if (shared && typeof shared === 'object') {
      found = shared as Record<string, unknown>;
      return;
    }

    for (const value of Object.values(record)) {
      visit(value);
      if (found) {
        return;
      }
    }
  };

  visit(root);
  return found;
};

const extractPostId = (renderer: Record<string, unknown>, html: string): string | null => {
  const direct = getNested(renderer, ['postId']);
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const urlFromRenderer = getNested(renderer, ['navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url']);
  if (typeof urlFromRenderer === 'string') {
    const postMatch = urlFromRenderer.match(/\/post\/(Ug[0-9A-Za-z_-]+)/);
    if (postMatch?.[1]) {
      return postMatch[1];
    }
  }

  const htmlMatch = html.match(/"postId"\s*:\s*"(Ug[0-9A-Za-z_-]+)"/);
  if (htmlMatch?.[1]) {
    return htmlMatch[1];
  }

  const canonicalPostMatch = html.match(/https:\/\/www\.youtube\.com\/post\/(Ug[0-9A-Za-z_-]+)/);
  if (canonicalPostMatch?.[1]) {
    return canonicalPostMatch[1];
  }

  return null;
};

export const scrapeLatestCommunityPostByChannelId = async (
  channelId: string,
  timeoutMs: number,
): Promise<ScrapedCommunityPost | null> => {
  const communityUrl = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/community`;
  return scrapeLatestCommunityPostByUrl(communityUrl, timeoutMs);
};

export const scrapeLatestCommunityPostByUrl = async (
  pageUrl: string,
  timeoutMs: number,
): Promise<ScrapedCommunityPost | null> => {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'youtube.com') {
    return null;
  }

  const response = await fetchWithTimeout(
    parsed.toString(),
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    },
    timeoutMs,
  );

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const initialData = extractYtInitialData(html);
  if (!initialData) {
    return null;
  }

  const renderer = findFirstPostRenderer(initialData);
  if (!renderer) {
    return null;
  }

  const postId = extractPostId(renderer, html);
  if (!postId) {
    return null;
  }

  const rawContent = getRunsText(getNested(renderer, ['contentText']));
  const content = decodeHtml(rawContent || '');
  const title = truncate(content || '새 커뮤니티 게시글', 180);
  const author = decodeHtml(getRunsText(getNested(renderer, ['authorText'])) || 'YouTube Channel');
  const published = decodeHtml(getRunsText(getNested(renderer, ['publishedTimeText'])));

  return {
    id: postId,
    title: title || '새 커뮤니티 게시글',
    content,
    link: `https://www.youtube.com/post/${postId}`,
    published,
    author: author || 'YouTube Channel',
  };
};
