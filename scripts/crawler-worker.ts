/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';
import { listCommunityPlugins, searchCommunityWithPlugins } from './crawler-worker/plugins/registry';
import { toPositiveLimit } from './crawler-worker/plugins/utils';

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.CRAWLER_WORKER_PORT || 3810);

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();
const getStringArg = (args: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = args[key];
  if (typeof value === 'string') {
    const out = compact(value);
    return out || fallback;
  }
  return fallback;
};

const getLimitArg = (args: Record<string, unknown>, key: string, fallback: number, max: number): number => {
  const raw = Number(args[key]);
  if (raw > 0) {
    return Math.min(max, Math.trunc(raw));
  }
  return fallback;
};

const getBooleanArg = (args: Record<string, unknown>, key: string, fallback = false): boolean => {
  const value = args[key];
  if (value === true || value === false) {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
};

const WEB_ALLOWED_HOSTS = new Set(
  String(process.env.CRAWLER_WORKER_WEB_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const WORKER_FETCH_TIMEOUT_MS = Math.max(4_000, Number(process.env.CRAWLER_WORKER_FETCH_TIMEOUT_MS || 12_000));

type WorkerFeedEntry = {
  id: string;
  title: string;
  content?: string;
  link: string;
  published: string;
  author: string;
};

type WorkerNewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  publisherName: string | null;
  publishedAtUnix: number | null;
  key: string;
  lexicalSignature: string;
};

const CHANNEL_ID_RE = /\/channel\/(UC[0-9A-Za-z_-]{20,})/;
const CHANNEL_ID_ANY_RE = /(UC[0-9A-Za-z_-]{20,})/;

const parseChannelId = (url: string): string | null => {
  const base = url.split('#', 1)[0];
  const m = base.match(CHANNEL_ID_RE);
  if (m?.[1]) return m[1];

  const raw = base.match(CHANNEL_ID_ANY_RE);
  if (raw?.[1]) return raw[1];

  try {
    const parsed = new URL(base);
    const fromQuery = parsed.searchParams.get('channel_id');
    if (fromQuery && CHANNEL_ID_ANY_RE.test(fromQuery)) {
      return fromQuery;
    }
  } catch {
    // ignore
  }

  return null;
};

const fetchWithTimeout = async (url: string, init?: RequestInit, timeoutMs = WORKER_FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const resolveChannelIdFromHandleUrl = async (url: string): Promise<string | null> => {
  const base = url.split('#', 1)[0];

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }

  if (!parsed.pathname.includes('/@')) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(parsed.toString(), {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'muel-crawler-worker/1.0',
      },
    }, Math.min(WORKER_FETCH_TIMEOUT_MS, 10_000));

    if (!response.ok) return null;

    const fromFinalUrl = parseChannelId(response.url);
    if (fromFinalUrl) return fromFinalUrl;

    const html = await response.text();
    const match = html.match(/"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{20,})"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
};

const textBetween = (source: string, start: string, end: string): string => {
  const s = source.indexOf(start);
  if (s < 0) return '';
  const i = s + start.length;
  const e = source.indexOf(end, i);
  if (e < 0) return '';
  return source.slice(i, e).trim();
};

const parseFirstFeedEntry = (xml: string): WorkerFeedEntry | null => {
  const entryBlock = textBetween(xml, '<entry>', '</entry>');
  if (!entryBlock) return null;

  const id = textBetween(entryBlock, '<yt:videoId>', '</yt:videoId>') || textBetween(entryBlock, '<id>', '</id>') || '';
  const title = textBetween(entryBlock, '<title>', '</title>') || '(제목 없음)';
  const linkMatch = entryBlock.match(/<link[^>]*href="([^"]+)"/);
  const link = linkMatch?.[1] || '';
  const published = textBetween(entryBlock, '<published>', '</published>') || textBetween(entryBlock, '<updated>', '</updated>');
  const authorBlock = textBetween(entryBlock, '<author>', '</author>');
  const author = textBetween(authorBlock, '<name>', '</name>') || 'Unknown';

  if (!id || !link) return null;
  return { id, title, link, published, author };
};

const buildAggressivePostProbeUrls = (sourceUrl: string): string[] => {
  const urls: string[] = [];
  const base = sourceUrl.split('#', 1)[0].trim();
  if (!base) {
    return urls;
  }

  try {
    const parsed = new URL(base);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'youtube.com') {
      return urls;
    }

    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (path.endsWith('/posts') || path.endsWith('/community')) {
      urls.push(`${parsed.origin}${path}`);
    } else {
      urls.push(`${parsed.origin}${path}/posts`);
      urls.push(`${parsed.origin}${path}/community`);
    }
  } catch {
    return urls;
  }

  return Array.from(new Set(urls));
};

const parseLatestCommunityFromHtml = (html: string): WorkerFeedEntry | null => {
  const postUrlMatch = html.match(/https:\/\/www\.youtube\.com\/post\/([A-Za-z0-9_-]+)/);
  const postId = postUrlMatch?.[1] || '';
  if (!postId) {
    return null;
  }

  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);
  const title = compact(titleMatch?.[1] || '커뮤니티 게시글');
  const authorMatch = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/);
  const author = compact(authorMatch?.[1] || 'Unknown');

  return {
    id: postId,
    title,
    link: `https://www.youtube.com/post/${postId}`,
    published: '',
    author,
  };
};

const fetchLatestCommunityAggressive = async (sourceUrl: string): Promise<WorkerFeedEntry | null> => {
  const probeUrls = buildAggressivePostProbeUrls(sourceUrl);
  for (const url of probeUrls) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          'user-agent': 'muel-crawler-worker/1.0',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        continue;
      }
      const html = await response.text();
      const parsed = parseLatestCommunityFromHtml(html);
      if (parsed) {
        return parsed;
      }
    } catch {
      // continue next probe url
    }
  }
  return null;
};

const fetchLatestYouTubeFromSource = async (params: {
  sourceUrl: string;
  mode: 'videos' | 'posts';
  aggressiveProbe?: boolean;
}): Promise<{ found: boolean; channelId: string | null; entry?: WorkerFeedEntry }> => {
  const channelId = parseChannelId(params.sourceUrl) || await resolveChannelIdFromHandleUrl(params.sourceUrl);
  if (!channelId) {
    return { found: false, channelId: null };
  }

  const feedUrl = params.mode === 'videos'
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    : `https://www.youtube.com/feeds/posts.xml?channel_id=${channelId}`;

  try {
    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        'user-agent': 'muel-crawler-worker/1.0',
        'accept-language': 'ko,en;q=0.8',
      },
    });

    if (response.ok) {
      const xml = await response.text();
      const entry = parseFirstFeedEntry(xml);
      if (entry) {
        return { found: true, channelId, entry };
      }
    }
  } catch {
    // fallback below for posts mode
  }

  if (params.mode === 'posts' && params.aggressiveProbe) {
    const entry = await fetchLatestCommunityAggressive(params.sourceUrl);
    if (entry) {
      return { found: true, channelId, entry };
    }
  }

  return { found: false, channelId };
};

const isWorkerWebHostAllowed = (hostname: string): boolean => {
  if (WEB_ALLOWED_HOSTS.size === 0) {
    return false;
  }
  return WEB_ALLOWED_HOSTS.has(String(hostname || '').trim().toLowerCase());
};

const toTextPreview = (html: string): string => {
  return compact(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, 800);
};

const isDiscordWebhookUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'discordapp.com') {
      return false;
    }
    return /^\/api\/webhooks\//.test(parsed.pathname);
  } catch {
    return false;
  }
};

const sendDiscordWebhook = async (params: { webhookUrl: string; content: string }) => {
  const response = await fetch(params.webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'muel-crawler-worker/1.0',
    },
    body: JSON.stringify({ content: params.content }),
  });

  if (!response.ok) {
    throw new Error(`WEBHOOK_HTTP_${response.status}`);
  }
};

const extractYoutubeVideoUrls = async (query: string, limit = 3): Promise<string[]> => {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const response = await fetch(searchUrl, {
    headers: {
      'user-agent': 'muel-crawler-worker/1.0',
    },
  });
  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  const ids: string[] = [];
  const matches = html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g);
  for (const match of matches) {
    const id = match[1];
    if (!ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= limit) {
      break;
    }
  }

  return ids.map((id) => `https://www.youtube.com/watch?v=${id}`);
};

const parseGoogleNewsRss = (xml: string): Array<{ title: string; link: string }> => {
  const items: Array<{ title: string; link: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const titleRegex = /<title>([\s\S]*?)<\/title>/i;
  const linkRegex = /<link>([\s\S]*?)<\/link>/i;

  let matched: RegExpExecArray | null;
  while ((matched = itemRegex.exec(xml))) {
    const chunk = matched[1] || '';
    const titleMatch = chunk.match(titleRegex);
    const linkMatch = chunk.match(linkRegex);
    const title = compact((titleMatch?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
    const link = compact((linkMatch?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, ''));

    if (title && link) {
      items.push({ title, link });
    }
    if (items.length >= 5) {
      break;
    }
  }

  return items;
};

const decodeXml = (text: string): string => {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&bull;/g, '•')
    .replace(/&nbsp;/g, ' ')
    .trim();
};

const normalizeLink = (raw: string): string => {
  try {
    const u = new URL(raw);
    u.searchParams.delete('oc');
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    return u.toString();
  } catch {
    return String(raw || '').trim();
  }
};

const parseSourceName = (href: string): string | null => {
  try {
    const url = new URL(href);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

const parseRelativeKoreanAgo = (text: string): number | null => {
  const m = text.match(/(\d+)\s*(분|시간|일|주|달|개월|년)\s*전/);
  if (!m) return null;

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = m[2];
  const now = Date.now();
  let deltaMs = 0;
  if (unit === '분') deltaMs = amount * 60 * 1000;
  else if (unit === '시간') deltaMs = amount * 60 * 60 * 1000;
  else if (unit === '일') deltaMs = amount * 24 * 60 * 60 * 1000;
  else if (unit === '주') deltaMs = amount * 7 * 24 * 60 * 60 * 1000;
  else if (unit === '달' || unit === '개월') deltaMs = amount * 30 * 24 * 60 * 60 * 1000;
  else if (unit === '년') deltaMs = amount * 365 * 24 * 60 * 60 * 1000;

  return Math.floor((now - deltaMs) / 1000);
};

const parseRelativeEnglishAgo = (text: string): number | null => {
  const m = String(text || '').toLowerCase().match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago/);
  if (!m) return null;

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = m[2];
  const now = Date.now();
  let deltaMs = 0;
  if (unit.startsWith('minute')) deltaMs = amount * 60 * 1000;
  else if (unit.startsWith('hour')) deltaMs = amount * 60 * 60 * 1000;
  else if (unit.startsWith('day')) deltaMs = amount * 24 * 60 * 60 * 1000;
  else if (unit.startsWith('week')) deltaMs = amount * 7 * 24 * 60 * 60 * 1000;
  else if (unit.startsWith('month')) deltaMs = amount * 30 * 24 * 60 * 60 * 1000;
  else if (unit.startsWith('year')) deltaMs = amount * 365 * 24 * 60 * 60 * 1000;

  return Math.floor((now - deltaMs) / 1000);
};

const normalizeFinanceHeadline = (rawTitle: string): { headline: string; publisherName: string | null; publishedAtUnix: number | null } => {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) {
    return { headline: '', publisherName: null, publishedAtUnix: null };
  }

  const korean = title.match(/^(.+?)\s+(\d+\s*(?:분|시간|일|주|달|개월|년)\s*전)\s+(.+)$/);
  if (korean) {
    return {
      publisherName: korean[1].trim(),
      publishedAtUnix: parseRelativeKoreanAgo(korean[2]),
      headline: korean[3].trim(),
    };
  }

  const english = title.match(/^(.+?)\s+(\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago)\s+(.+)$/i);
  if (english) {
    return {
      publisherName: english[1].trim(),
      publishedAtUnix: parseRelativeEnglishAgo(english[2]),
      headline: english[3].trim(),
    };
  }

  const bulletParts = title
    .split(/\s*[•·|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (bulletParts.length >= 2) {
    const last = bulletParts[bulletParts.length - 1] || '';
    const publishedAtUnix = parseRelativeKoreanAgo(last) || parseRelativeEnglishAgo(last);
    if (publishedAtUnix) {
      const headline = bulletParts[0] || title;
      const publisherName = bulletParts.length >= 3 ? bulletParts[1] : null;
      return {
        headline: headline.trim(),
        publisherName: publisherName?.trim() || null,
        publishedAtUnix,
      };
    }
  }

  return { headline: title, publisherName: null, publishedAtUnix: null };
};

const stripTags = (html: string): string => decodeXml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

const isLikelyNavigationTitle = (title: string): boolean => {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return true;

  const blocked = ['finance_mode', 'google finance', 'home', '홈', 'markets', '시장', 'watchlist', '관심종목', 'portfolio', '포트폴리오'];
  return blocked.some((token) => normalized === token || normalized.startsWith(`${token} `));
};

const isInternalGoogleFinanceLink = (href: string): boolean => {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'google.com') return false;
    return url.pathname.startsWith('/finance');
  } catch {
    return true;
  }
};

const normalizeTitleForSignature = (title: string): string => {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildLexicalSignature = (title: string): string => {
  const tokens = normalizeTitleForSignature(title)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 20)
    .sort();
  return tokens.join('|');
};

const extractFinanceNewsItems = (html: string, limit: number): WorkerNewsItem[] => {
  const items: WorkerNewsItem[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const hrefRaw = decodeXml(match[1] || '');
    const title = stripTags(match[2] || '');
    if (!title || title.length < 12) continue;
    if (isLikelyNavigationTitle(title)) continue;

    let href = hrefRaw;
    if (href.startsWith('./')) {
      href = `https://www.google.com/finance/${href.slice(2)}`;
    } else if (href.startsWith('/')) {
      href = `https://www.google.com${href}`;
    }

    href = normalizeLink(href);
    if (!/^https?:\/\//.test(href)) continue;

    try {
      const maybeRedirect = new URL(href);
      const q = maybeRedirect.searchParams.get('q');
      if (q && /^https?:\/\//.test(q)) {
        href = normalizeLink(q);
      }
    } catch {
      // ignore
    }

    if (isInternalGoogleFinanceLink(href)) continue;

    const normalized = normalizeFinanceHeadline(title);
    const headline = normalized.headline || title;
    const key = href.slice(0, 1000);
    if (seen.has(key)) continue;

    seen.add(key);
    items.push({
      title: headline,
      link: href,
      sourceName: parseSourceName(href),
      publisherName: normalized.publisherName,
      publishedAtUnix: normalized.publishedAtUnix,
      key,
      lexicalSignature: buildLexicalSignature(headline),
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
};

const fetchGoogleFinanceNewsCandidates = async (limit: number): Promise<WorkerNewsItem[]> => {
  const url = String(process.env.GOOGLE_FINANCE_NEWS_URL || 'https://www.google.com/finance/markets?hl=ko').trim();
  const response = await fetchWithTimeout(url, {
    headers: {
      'user-agent': 'muel-crawler-worker/1.0',
      'accept-language': 'ko,en;q=0.8',
    },
  });

  if (!response.ok) {
    return [];
  }

  const html = await response.text();
  return extractFinanceNewsItems(html, Math.max(3, Math.min(20, limit)));
};

const searchGoogleNews = async (query: string, limit = 5): Promise<Array<{ title: string; link: string }>> => {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'muel-crawler-worker/1.0',
    },
  });

  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  return parseGoogleNewsRss(xml).slice(0, Math.max(1, Math.min(10, limit)));
};

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'crawler-worker', uptimeSec: Math.floor(process.uptime()) });
});

type ToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  isError: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;
type ToolDefinition = {
  description: string | (() => string);
  handler: ToolHandler;
};

const toolOkText = (lines: string[]): ToolResponse => ({
  content: lines.map((text) => ({ type: 'text', text })),
  isError: false,
});

const toolOkJson = (value: unknown): ToolResponse => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  isError: false,
});

const toolError = (message: string): ToolResponse => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  'youtube.search.first': {
    description: 'YouTube 상위 영상 URL 수집',
    handler: async (args) => {
    const query = getStringArg(args, 'query', '고양이 영상');
    const limit = getLimitArg(args, 'limit', 3, 5);
    const urls = await extractYoutubeVideoUrls(query, limit);
    if (urls.length === 0) {
      return toolError('youtube result not found');
    }
    return toolOkText(urls.map((url, index) => `${index + 1}. ${url}`));
  },
  },
  'youtube.search.webhook': {
    description: 'YouTube 상위 영상 URL 수집 후 Discord Webhook 전송',
    handler: async (args) => {
    const query = getStringArg(args, 'query', '시장 요약');
    const limit = getLimitArg(args, 'limit', 3, 5);
    const urls = await extractYoutubeVideoUrls(query, limit);
    if (urls.length === 0) {
      return toolError('youtube result not found');
    }

    const configuredWebhook = compact(process.env.MCP_YOUTUBE_DEFAULT_WEBHOOK_URL || '');
    const webhookUrl = getStringArg(args, 'webhookUrl', configuredWebhook);
    const dryRun = getBooleanArg(args, 'dryRun', false);
    const titlePrefix = getStringArg(args, 'titlePrefix', '[YouTube Watchlist]');

    if (!webhookUrl) {
      return toolError('webhookUrl is required (args.webhookUrl or MCP_YOUTUBE_DEFAULT_WEBHOOK_URL)');
    }
    if (!isDiscordWebhookUrl(webhookUrl)) {
      return toolError('webhookUrl must be a Discord webhook URL');
    }

    const body = [
      `${titlePrefix} query=${query}`,
      ...urls.map((url, index) => `${index + 1}. ${url}`),
    ].join('\n');

    if (!dryRun) {
      await sendDiscordWebhook({ webhookUrl, content: body.slice(0, 1800) });
    }

    return toolOkText([
      `query=${query}`,
      `urls=${urls.length}`,
      `webhookSent=${String(!dryRun)}`,
      ...urls.map((url, index) => `${index + 1}. ${url}`),
    ]);
  },
  },
  'youtube.monitor.latest': {
    description: '구독 source URL에서 최신 YouTube 항목 1건 조회(videos/posts)',
    handler: async (args) => {
    const sourceUrl = getStringArg(args, 'sourceUrl', getStringArg(args, 'url', ''));
    const mode = getStringArg(args, 'mode', 'videos') === 'posts' ? 'posts' : 'videos';
    const aggressiveProbe = getBooleanArg(args, 'aggressiveProbe', false);

    if (!sourceUrl) {
      return toolError('sourceUrl is required');
    }

    const latest = await fetchLatestYouTubeFromSource({ sourceUrl, mode, aggressiveProbe });
    return toolOkJson(latest);
  },
  },
  'news.google.search': {
    description: 'Google News RSS 조회',
    handler: async (args) => {
    const query = getStringArg(args, 'query', '시장 주요 뉴스');
    const limit = getLimitArg(args, 'limit', 5, 10);
    const rows = await searchGoogleNews(query, limit);
    if (rows.length === 0) {
      return toolError('news result not found');
    }
    return toolOkText(rows.map((row, index) => `${index + 1}. ${row.title} | ${row.link}`));
  },
  },
  'news.monitor.candidates': {
    description: 'Google Finance 뉴스 후보 목록 수집/파싱',
    handler: async (args) => {
    const limit = getLimitArg(args, 'limit', 12, 20);
    const rows = await fetchGoogleFinanceNewsCandidates(limit);
    return toolOkJson({ items: rows });
  },
  },
  'web.fetch': {
    description: '허용된 호스트 웹 페이지 조회 및 텍스트 추출',
    handler: async (args) => {
    const rawUrl = getStringArg(args, 'url', '');
    if (!rawUrl) {
      return toolError('url is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return toolError('invalid url');
    }

    if (!isWorkerWebHostAllowed(parsed.hostname)) {
      return toolError(`host not allowed: ${parsed.hostname}`);
    }

    const response = await fetch(parsed.toString(), {
      headers: {
        'user-agent': 'muel-crawler-worker/1.0',
      },
    });

    if (!response.ok) {
      return toolError(`web fetch failed status=${response.status}`);
    }

    const html = await response.text();
    const preview = toTextPreview(html);
    return toolOkText([parsed.toString(), preview || '(본문 요약 없음)']);
  },
  },
  'community.search': {
    description: () => `커뮤니티 검색 플러그인 워커 (${listCommunityPlugins().map((plugin) => plugin.id).join(', ')})`,
    handler: async (args) => {
    const query = getStringArg(args, 'query', '');
    const limit = toPositiveLimit(args.limit, 5, 10);
    const rows = await searchCommunityWithPlugins({ query, limit });

    if (rows.length === 0) {
      return toolError(`community.search returned no rows. query=${query || '(empty)'}`);
    }

    return toolOkText(rows.map((row, index) => `${index + 1}. [${row.source}] ${row.title} | ${row.url}${row.excerpt ? ` | ${row.excerpt}` : ''}`));
  },
  },
};

const getToolCatalog = (): Array<{ name: string; description: string }> => {
  return Object.entries(TOOL_REGISTRY).map(([name, definition]) => ({
    name,
    description: typeof definition.description === 'function' ? definition.description() : definition.description,
  }));
};

app.get('/tools/list', (_req, res) => {
  res.json({
    tools: getToolCatalog(),
  });
});

app.post('/tools/call', async (req, res) => {
  const name = compact(req.body?.name);
  const args = req.body?.arguments && typeof req.body.arguments === 'object' && !Array.isArray(req.body.arguments)
    ? req.body.arguments as Record<string, unknown>
    : {};

  if (!name) {
    return res.status(400).json({
      content: [{ type: 'text', text: 'name is required' }],
      isError: true,
    });
  }

  try {
    const definition = TOOL_REGISTRY[name];
    if (definition) {
      const payload = await definition.handler(args);
      return res.json(payload);
    }

    return res.status(404).json({
      content: [{ type: 'text', text: `unknown tool: ${name}` }],
      isError: true,
    });
  } catch (error) {
    return res.status(500).json({
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[crawler-worker] listening on :${PORT}`);
});
