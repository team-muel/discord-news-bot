import { parseBooleanEnv, parseMinIntEnv, parseUrlEnv } from '../../utils/env';
import { callMcpTool, parseMcpTextBlocks } from '../mcpWorkerClient';
import { fetchWithTimeout } from '../../utils/network';
import { scrapeLatestCommunityPostByUrl, scrapeLatestCommunityPostByInnerTube } from './youtubeCommunityScraper';
import { delegateYoutubeCommunityScrape, delegateYoutubeFeedFetch, shouldDelegate } from '../automation/n8nDelegationService';

export type YouTubeMonitorMode = 'videos' | 'posts';

export type YouTubeMonitorEntry = {
  id: string;
  title: string;
  content?: string;
  link: string;
  published: string;
  author: string;
};

export type YouTubeMonitorLatestResult = {
  found: boolean;
  channelId: string | null;
  entry?: YouTubeMonitorEntry;
};

const WORKER_URL = parseUrlEnv(process.env.YOUTUBE_MONITOR_MCP_WORKER_URL ?? process.env.MCP_YOUTUBE_WORKER_URL, '');
const WORKER_TIMEOUT_MS = parseMinIntEnv(process.env.YOUTUBE_MONITOR_MCP_TIMEOUT_MS, 12_000, 2_000);
const WORKER_STRICT = parseBooleanEnv(process.env.YOUTUBE_MONITOR_MCP_STRICT, true);
const LOCAL_FALLBACK_ENABLED = parseBooleanEnv(process.env.YOUTUBE_MONITOR_LOCAL_FALLBACK_ENABLED, true);
const LOCAL_TIMEOUT_MS = parseMinIntEnv(process.env.YOUTUBE_MONITOR_LOCAL_TIMEOUT_MS, 12_000, 2_000);

const CHANNEL_ID_RE = /\/channel\/(UC[0-9A-Za-z_-]{20,})/;
const CHANNEL_ID_ANY_RE = /(UC[0-9A-Za-z_-]{20,})/;

const parsePayloadText = (payload: any): string => parseMcpTextBlocks(payload)[0] || '';

const decodeXmlEntities = (input: string): string => {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

const textBetween = (source: string, start: string, end: string): string => {
  const s = source.indexOf(start);
  if (s < 0) return '';
  const i = s + start.length;
  const e = source.indexOf(end, i);
  if (e < 0) return '';
  return source.slice(i, e).trim();
};

const parseChannelId = (url: string): string | null => {
  const base = String(url || '').split('#', 1)[0];
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

const resolveChannelIdFromHandleUrl = async (url: string): Promise<string | null> => {
  const base = String(url || '').split('#', 1)[0];
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
    const response = await fetchWithTimeout(
      parsed.toString(),
      {
        redirect: 'follow',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'muel-youtube-monitor/1.0',
        },
      },
      Math.min(LOCAL_TIMEOUT_MS, 10_000),
    );

    if (!response.ok) {
      return null;
    }

    const fromFinalUrl = parseChannelId(response.url);
    if (fromFinalUrl) {
      return fromFinalUrl;
    }

    const html = await response.text();
    const match = html.match(/"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{20,})"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
};

const parseFirstFeedEntry = (xml: string): YouTubeMonitorEntry | null => {
  const entryBlock = textBetween(xml, '<entry>', '</entry>');
  if (!entryBlock) return null;

  const id = textBetween(entryBlock, '<yt:videoId>', '</yt:videoId>') || textBetween(entryBlock, '<id>', '</id>') || '';
  const title = decodeXmlEntities(textBetween(entryBlock, '<title>', '</title>')) || '(제목 없음)';
  const linkMatch = entryBlock.match(/<link[^>]*href="([^"]+)"/);
  const link = decodeXmlEntities(linkMatch?.[1] || '');
  const published = decodeXmlEntities(textBetween(entryBlock, '<published>', '</published>') || textBetween(entryBlock, '<updated>', '</updated>'));
  const authorBlock = textBetween(entryBlock, '<author>', '</author>');
  const author = decodeXmlEntities(textBetween(authorBlock, '<name>', '</name>')) || 'Unknown';

  if (!id || !link) return null;
  return {
    id,
    title,
    link,
    published,
    author,
    content: '',
  };
};

const fetchYouTubeLatestLocally = async (params: {
  sourceUrl: string;
  mode: YouTubeMonitorMode;
  aggressiveProbe?: boolean;
}): Promise<YouTubeMonitorLatestResult | null> => {
  // n8n delegation: try delegating feed/scrape to n8n
  if (params.mode === 'posts' && shouldDelegate('youtube-community-scrape')) {
    const n8n = await delegateYoutubeCommunityScrape(params.sourceUrl);
    if (n8n.delegated && n8n.ok && n8n.data) {
      const channelId = parseChannelId(params.sourceUrl) || null;
      return {
        found: true,
        channelId,
        entry: {
          id: String(n8n.data.id || ''),
          title: String(n8n.data.title || ''),
          content: String(n8n.data.content || ''),
          link: String(n8n.data.link || ''),
          published: String(n8n.data.published || ''),
          author: String(n8n.data.author || ''),
        },
      };
    }
  }

  if (params.mode === 'videos' && shouldDelegate('youtube-feed-fetch')) {
    const n8n = await delegateYoutubeFeedFetch(params.sourceUrl);
    if (n8n.delegated && n8n.ok && n8n.data?.entries?.length) {
      const entry = n8n.data.entries[0];
      const channelId = parseChannelId(params.sourceUrl) || null;
      return {
        found: true,
        channelId,
        entry: {
          id: String(entry.id || ''),
          title: String(entry.title || ''),
          link: String(entry.link || ''),
          published: String(entry.published || ''),
          author: String(entry.author || ''),
        },
      };
    }
  }

  const channelId = parseChannelId(params.sourceUrl) || await resolveChannelIdFromHandleUrl(params.sourceUrl);
  if (!channelId) {
    return { found: false, channelId: null };
  }

  // Posts mode: InnerTube API → HTML scraper fallback (no Atom feed exists for community posts)
  if (params.mode === 'posts') {
    // 1. InnerTube API (same endpoint yt-dlp uses)
    try {
      const innerTubeResult = await scrapeLatestCommunityPostByInnerTube(channelId, LOCAL_TIMEOUT_MS);
      if (innerTubeResult) {
        return {
          found: true,
          channelId,
          entry: {
            id: innerTubeResult.id,
            title: innerTubeResult.title,
            content: innerTubeResult.content,
            link: innerTubeResult.link,
            published: innerTubeResult.published,
            author: innerTubeResult.author,
          },
        };
      }
    } catch {
      // fall through to HTML scraper
    }

    // 2. HTML scraper fallback (legacy method)
    try {
      const scraped = await scrapeLatestCommunityPostByUrl(params.sourceUrl, LOCAL_TIMEOUT_MS);
      if (scraped) {
        return {
          found: true,
          channelId,
          entry: {
            id: scraped.id,
            title: scraped.title,
            content: scraped.content,
            link: scraped.link,
            published: scraped.published,
            author: scraped.author,
          },
        };
      }
    } catch {
      // no fallback left
    }

    return { found: false, channelId };
  }

  // Videos mode: Atom feed
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  try {
    const response = await fetchWithTimeout(
      feedUrl,
      {
        headers: {
          'accept-language': 'ko,en;q=0.8',
          accept: 'application/atom+xml,text/xml;q=0.9,*/*;q=0.8',
          'user-agent': 'muel-youtube-monitor/1.0',
        },
      },
      LOCAL_TIMEOUT_MS,
    );

    if (response.ok) {
      const xml = await response.text();
      const entry = parseFirstFeedEntry(xml);
      if (entry) {
        return { found: true, channelId, entry };
      }
    }
  } catch {
    // no fallback for videos
  }

  return { found: false, channelId };
};

const tryLocalFallback = async (params: {
  sourceUrl: string;
  mode: YouTubeMonitorMode;
  aggressiveProbe?: boolean;
}): Promise<YouTubeMonitorLatestResult | null> => {
  if (!LOCAL_FALLBACK_ENABLED) {
    return null;
  }
  return fetchYouTubeLatestLocally(params);
};

export const isYouTubeMonitorWorkerStrict = (): boolean => WORKER_STRICT;

export const fetchYouTubeLatestByWorker = async (params: {
  sourceUrl: string;
  mode: YouTubeMonitorMode;
  aggressiveProbe?: boolean;
}): Promise<YouTubeMonitorLatestResult | null> => {
  if (!WORKER_URL) {
    const fallback = await tryLocalFallback(params);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_NOT_CONFIGURED');
    }
    return null;
  }

  let payload: any;
  try {
    payload = await callMcpTool({
      workerUrl: WORKER_URL,
      toolName: 'youtube.monitor.latest',
      args: {
        sourceUrl: params.sourceUrl,
        mode: params.mode,
        aggressiveProbe: Boolean(params.aggressiveProbe),
      },
      timeoutMs: WORKER_TIMEOUT_MS,
    });
  } catch {
    const fallback = await tryLocalFallback(params);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_ERROR');
    }
    return null;
  }

  if (payload?.isError) {
    const message = parsePayloadText(payload) || 'YOUTUBE_MONITOR_WORKER_ERROR';
    const fallback = await tryLocalFallback(params);
    if (fallback) {
      return fallback;
    }
    throw new Error(message);
  }

  const text = parsePayloadText(payload);
  if (!text) {
    const fallback = await tryLocalFallback(params);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_EMPTY');
    }
    return null;
  }

  try {
    const parsed = JSON.parse(text) as YouTubeMonitorLatestResult;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid payload');
    }
    return parsed;
  } catch {
    const fallback = await tryLocalFallback(params);
    if (fallback) {
      return fallback;
    }
    if (WORKER_STRICT) {
      throw new Error('YOUTUBE_MONITOR_WORKER_INVALID_JSON');
    }
    return null;
  }
};
