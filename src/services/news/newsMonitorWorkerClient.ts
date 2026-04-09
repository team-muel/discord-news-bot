import { parseBooleanEnv, parseMinIntEnv, parseStringEnv, parseUrlEnv } from '../../utils/env';
import { callMcpTool, parseMcpTextBlocks } from '../mcpWorkerClient';
import { delegateNewsMonitorCandidates, shouldDelegate } from '../automation/n8nDelegationService';
import { fetchWithTimeout } from '../../utils/network';

export type WorkerNewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  publisherName: string | null;
  publishedAtUnix: number | null;
  key: string;
  lexicalSignature: string;
};

export type NewsMonitorCandidateSourceStatus = {
  configured: boolean;
  mode: 'mcp-worker' | 'n8n' | 'local-fallback' | 'none';
};

const readWorkerUrl = (): string =>
  parseUrlEnv(process.env.NEWS_MONITOR_MCP_WORKER_URL ?? process.env.MCP_NEWS_WORKER_URL, '');

const WORKER_TIMEOUT_MS = parseMinIntEnv(process.env.NEWS_MONITOR_MCP_TIMEOUT_MS, 12_000, 2_000);
const WORKER_STRICT = parseBooleanEnv(process.env.NEWS_MONITOR_MCP_STRICT, true);
const LOCAL_FALLBACK_ENABLED = parseBooleanEnv(process.env.NEWS_MONITOR_LOCAL_FALLBACK_ENABLED, true);
const LOCAL_TIMEOUT_MS = parseMinIntEnv(process.env.NEWS_MONITOR_LOCAL_TIMEOUT_MS, 12_000, 2_000);
const GOOGLE_FINANCE_NEWS_URL = parseStringEnv(process.env.GOOGLE_FINANCE_NEWS_URL, 'https://www.google.com/finance/markets?hl=ko').trim();

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

const stripTags = (html: string): string =>
  decodeXml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

const normalizeLink = (raw: string): string => {
  try {
    const url = new URL(raw);
    url.searchParams.delete('oc');
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_medium');
    url.searchParams.delete('utm_campaign');
    return url.toString();
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
  const matched = String(text || '').match(/(\d+)\s*(분|시간|일|주|달|개월|년)\s*전/);
  if (!matched) {
    return null;
  }

  const amount = Number(matched[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const now = Date.now();
  const unit = matched[2];
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
  const matched = String(text || '').toLowerCase().match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago/);
  if (!matched) {
    return null;
  }

  const amount = Number(matched[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = matched[2];
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
      return {
        headline: (bulletParts[0] || title).trim(),
        publisherName: bulletParts.length >= 3 ? (bulletParts[1] || '').trim() || null : null,
        publishedAtUnix,
      };
    }
  }

  return { headline: title, publisherName: null, publishedAtUnix: null };
};

const isLikelyNavigationTitle = (title: string): boolean => {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  const blocked = ['finance_mode', 'google finance', 'home', '홈', 'markets', '시장', 'watchlist', '관심종목', 'portfolio', '포트폴리오'];
  return blocked.some((token) => normalized === token || normalized.startsWith(`${token} `));
};

const isInternalGoogleFinanceLink = (href: string): boolean => {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'google.com') {
      return false;
    }
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
  return normalizeTitleForSignature(title)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 20)
    .sort()
    .join('|');
};

const extractFinanceNewsItems = (html: string, limit: number): WorkerNewsItem[] => {
  const items: WorkerNewsItem[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let matched: RegExpExecArray | null;

  while ((matched = anchorRegex.exec(html)) !== null) {
    const hrefRaw = decodeXml(matched[1] || '');
    const title = stripTags(matched[2] || '');
    if (!title || title.length < 12) {
      continue;
    }
    if (isLikelyNavigationTitle(title)) {
      continue;
    }

    let href = hrefRaw;
    if (href.startsWith('./')) {
      href = `https://www.google.com/finance/${href.slice(2)}`;
    } else if (href.startsWith('/')) {
      href = `https://www.google.com${href}`;
    }

    href = normalizeLink(href);
    if (!/^https?:\/\//.test(href)) {
      continue;
    }

    try {
      const maybeRedirect = new URL(href);
      const targetUrl = maybeRedirect.searchParams.get('q');
      if (targetUrl && /^https?:\/\//.test(targetUrl)) {
        href = normalizeLink(targetUrl);
      }
    } catch {
      // ignore redirect parsing failure
    }

    if (isInternalGoogleFinanceLink(href)) {
      continue;
    }

    const normalized = normalizeFinanceHeadline(title);
    const headline = normalized.headline || title;
    const key = href.slice(0, 1000);
    if (seen.has(key)) {
      continue;
    }

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

const fetchNewsMonitorCandidatesLocally = async (limit: number): Promise<WorkerNewsItem[]> => {
  try {
    const response = await fetchWithTimeout(GOOGLE_FINANCE_NEWS_URL, {
      headers: {
        'user-agent': 'muel-news-monitor/1.0',
        'accept-language': 'ko,en;q=0.8',
      },
    }, LOCAL_TIMEOUT_MS);

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    return extractFinanceNewsItems(html, Math.max(3, Math.min(20, limit)));
  } catch {
    return [];
  }
};

const tryLocalFallback = async (limit: number): Promise<WorkerNewsItem[] | null> => {
  if (!LOCAL_FALLBACK_ENABLED) {
    return null;
  }

  return fetchNewsMonitorCandidatesLocally(limit);
};

const mapWorkerItems = (items: Array<{
  title?: unknown;
  link?: unknown;
  sourceName?: unknown;
  publisherName?: unknown;
  publishedAtUnix?: unknown;
  key?: unknown;
  lexicalSignature?: unknown;
}>): WorkerNewsItem[] =>
  items.map((item) => ({
    title: String(item.title || ''),
    link: String(item.link || ''),
    sourceName: item.sourceName ? String(item.sourceName) : null,
    publisherName: item.publisherName ? String(item.publisherName) : null,
    publishedAtUnix: Number.isFinite(Number(item.publishedAtUnix)) ? Number(item.publishedAtUnix) : null,
    key: String(item.key || ''),
    lexicalSignature: item.lexicalSignature ? String(item.lexicalSignature) : '',
  }));

export const getNewsMonitorCandidateSourceStatus = (): NewsMonitorCandidateSourceStatus => {
  if (shouldDelegate('news-monitor-candidates')) {
    return { configured: true, mode: 'n8n' };
  }

  if (readWorkerUrl()) {
    return { configured: true, mode: 'mcp-worker' };
  }

  if (LOCAL_FALLBACK_ENABLED) {
    return { configured: true, mode: 'local-fallback' };
  }

  return { configured: false, mode: 'none' };
};

export const fetchNewsMonitorCandidatesByWorker = async (limit: number): Promise<WorkerNewsItem[] | null> => {
  // n8n delegation: try fetching news candidates via n8n first
  if (shouldDelegate('news-monitor-candidates')) {
    const n8n = await delegateNewsMonitorCandidates(limit);
    if (n8n.delegated && n8n.ok && n8n.data?.items?.length) {
      return mapWorkerItems(n8n.data.items);
    }
    // Fall through to MCP worker
  }

  const workerUrl = readWorkerUrl();

  if (!workerUrl) {
    const fallback = await tryLocalFallback(limit);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_NOT_CONFIGURED');
    }
    return null;
  }

  let payload: any;
  try {
    payload = await callMcpTool({
      workerUrl,
      toolName: 'news.monitor.candidates',
      args: { limit },
      timeoutMs: WORKER_TIMEOUT_MS,
    });
  } catch {
    const fallback = await tryLocalFallback(limit);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_ERROR');
    }
    return null;
  }

  if (payload?.isError) {
    const fallback = await tryLocalFallback(limit);
    if (fallback) {
      return fallback;
    }
    const message = parseMcpTextBlocks(payload)[0] || 'NEWS_MONITOR_WORKER_ERROR';
    throw new Error(message);
  }

  const text = parseMcpTextBlocks(payload)[0] || '';
  if (!text) {
    const fallback = await tryLocalFallback(limit);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_EMPTY');
    }
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { items?: WorkerNewsItem[] };
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid payload');
    }
    const rows = Array.isArray(parsed.items) ? parsed.items : [];
    return mapWorkerItems(rows);
  } catch {
    const fallback = await tryLocalFallback(limit);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('NEWS_MONITOR_WORKER_INVALID_JSON');
    }
    return null;
  }
};
