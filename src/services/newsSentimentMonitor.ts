import { type Client } from 'discord.js';
import logger from '../logger';
import { fetchWithTimeout } from '../utils/network';
import { claimSourceLock, releaseSourceLock, updateSourceState } from './sourceMonitorStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type NewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  publisherName: string | null;
  publishedAtUnix: number | null;
  key: string;
  lexicalSignature: string;
};

type NewsChannelRow = {
  id: number;
  guild_id: string | null;
  name: string | null;
  url: string | null;
  channel_id: string | null;
  last_post_signature: string | null;
};

type NewsTickStats = {
  processed: number;
  failed: number;
  sent: number;
  skippedLocked: number;
  skippedDuplicate: number;
  skippedNoCandidate: number;
};

let timer: NodeJS.Timeout | null = null;
let started = false;
let running = false;
let runCount = 0;
let successCount = 0;
let failCount = 0;
let lastRunAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastErrorAt: string | null = null;
let lastError: string | null = null;
let lastDurationMs: number | null = null;
let lastTickProcessedSources = 0;
let lastTickFailedSources = 0;
let lastTickStatus: 'success' | 'partial_failure' | 'failed' | null = null;
let newsHistoryTableUnavailableLogged = false;

const INTERVAL_MS = Math.max(60_000, Number(process.env.NEWS_MONITOR_INTERVAL_MS || 10 * 60_000));
const GOOGLE_FINANCE_NEWS_URL = (process.env.GOOGLE_FINANCE_NEWS_URL || 'https://www.google.com/finance/markets?hl=ko').trim();
const LOCK_LEASE_MS = Math.max(30_000, Number(process.env.NEWS_MONITOR_LOCK_LEASE_MS || 120_000));
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.NEWS_MONITOR_FETCH_TIMEOUT_MS || 15_000));
const NEWS_CANDIDATE_LIMIT = Math.max(3, Number(process.env.NEWS_MONITOR_CANDIDATE_LIMIT || 12));
const NEWS_HISTORY_LOOKBACK_HOURS = Math.max(1, Number(process.env.NEWS_DEDUP_LOOKBACK_HOURS || 24));
const NEWS_HISTORY_MAX_ITEMS = Math.max(10, Number(process.env.NEWS_DEDUP_HISTORY_MAX_ITEMS || 60));
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_NEWS_DEDUP_MODEL = process.env.OPENAI_NEWS_DEDUP_MODEL || 'gpt-4o-mini';
const OPENAI_NEWS_SUMMARY_MODEL = process.env.OPENAI_NEWS_SUMMARY_MODEL || 'gpt-4o-mini';
const NEWS_AI_DEDUP_ENABLED = (process.env.NEWS_AI_DEDUP_ENABLED || 'true').toLowerCase() !== 'false';
const NEWS_KR_SUMMARY_ENABLED = (process.env.NEWS_KR_SUMMARY_ENABLED || 'true').toLowerCase() !== 'false';
const SUMMARY_FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.NEWS_SUMMARY_FETCH_TIMEOUT_MS || 12_000));
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;

const isGoogleFinanceSourceRow = (row: NewsChannelRow): boolean => {
  const name = String(row.name || '').toLowerCase();
  const url = String(row.url || '').toLowerCase();

  if (name === 'google-finance-news' || name === 'google-finance' || name === 'news') {
    return true;
  }

  return url.includes('google.com/finance');
};

type NewsHistoryRow = {
  guild_id: string | null;
  title: string;
  link: string;
  event_signature: string;
  created_at: string | null;
};

const isHistoryUnavailableError = (error: any): boolean => {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === 'PGRST205'
    || code === '42P01'
    || code === '42703'
    || code === 'PGRST204'
    || msg.includes('news_sentiment')
    || msg.includes('event_signature')
    || msg.includes('sentiment_score');
};

const textBetween = (source: string, start: string, end: string): string => {
  const s = source.indexOf(start);
  if (s < 0) return '';
  const i = s + start.length;
  const e = source.indexOf(end, i);
  if (e < 0) return '';
  return source.slice(i, e).trim();
};

const decodeXml = (text: string): string => {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
    return raw.trim();
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
  if (!m) {
    return null;
  }

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

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
  const m = text.toLowerCase().match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago/);
  if (!m) {
    return null;
  }

  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

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

const normalizeFinanceHeadline = (rawTitle: string): {
  headline: string;
  publisherName: string | null;
  publishedAtUnix: number | null;
} => {
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

  return { headline: title, publisherName: null, publishedAtUnix: null };
};

const stripHtmlBlocks = (html: string): string => {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const pickMetaContent = (html: string, key: string): string => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
  const m = html.match(re);
  return decodeXml(m?.[1] || '').trim();
};

const pickTitleTag = (html: string): string => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeXml(stripHtmlBlocks(m?.[1] || '')).trim();
};

const enforceTwoToThreeLines = (text: string): string => {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '';
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (lines.length >= 2) {
    return lines.join('\n');
  }

  const sentenceChunks = normalized
    .split(/(?<=[.!?다])\s+/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (sentenceChunks.length >= 2) {
    return sentenceChunks.join('\n');
  }

  return lines[0] || sentenceChunks[0] || normalized;
};

const loadArticleContext = async (link: string): Promise<{ title: string; description: string }> => {
  try {
    const response = await fetchWithTimeout(link, {
      headers: {
        'User-Agent': 'MuelBot/1.0',
        'Accept-Language': 'ko,en;q=0.8',
      },
      redirect: 'follow',
    }, SUMMARY_FETCH_TIMEOUT_MS);

    if (!response.ok) {
      return { title: '', description: '' };
    }

    const html = await response.text();
    const ogTitle = pickMetaContent(html, 'og:title');
    const metaDesc = pickMetaContent(html, 'description') || pickMetaContent(html, 'og:description');
    const title = ogTitle || pickTitleTag(html);
    const description = metaDesc || '';

    return { title: title.slice(0, 300), description: description.slice(0, 1200) };
  } catch {
    return { title: '', description: '' };
  }
};

const buildFallbackKoreanSummary = (item: NewsItem): string => {
  return [
    `핵심: ${item.title}`,
    `출처: ${item.sourceName || 'Google Finance'} 보도입니다.`,
  ].join('\n');
};

const buildTimeLabel = (publishedAtUnix: number | null): string => {
  if (!publishedAtUnix || !Number.isFinite(publishedAtUnix)) {
    return '';
  }

  return `시간: <t:${publishedAtUnix}:R> (<t:${publishedAtUnix}:f>)`;
};

const summarizeNewsInKorean = async (item: NewsItem): Promise<string> => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!NEWS_KR_SUMMARY_ENABLED || !apiKey) {
    return '';
  }

  const article = await loadArticleContext(item.link);
  const prompt = [
    '다음 금융 뉴스를 한국어로 2~3줄 요약하세요.',
    '조건:',
    '- 출력은 순수 텍스트 2~3줄만',
    '- 과장/추측 금지, 주어진 정보만 사용',
    '- 핵심 사실과 시장 영향 포인트를 포함',
    `원문 제목: ${item.title}`,
    `원문 링크: ${item.link}`,
    `기사 제목(메타): ${article.title || '(없음)'}`,
    `기사 설명(메타): ${article.description || '(없음)'}`,
  ].join('\n');

  try {
    const response = await fetchWithTimeout(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_NEWS_SUMMARY_MODEL,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: 'system', content: 'You are a precise Korean financial news summarizer.' },
          { role: 'user', content: prompt },
        ],
      }),
    }, Math.min(FETCH_TIMEOUT_MS, 12_000));

    if (!response.ok) {
      return '';
    }

    const payload = (await response.json()) as Record<string, any>;
    const content = String(payload?.choices?.[0]?.message?.content || '');
    return enforceTwoToThreeLines(content);
  } catch {
    return '';
  }
};

const stripTags = (html: string): string => {
  return decodeXml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
};

const isLikelyNavigationTitle = (title: string): boolean => {
  const normalized = String(title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  const blocked = [
    'finance_mode',
    'google finance',
    'home',
    '홈',
    'markets',
    '시장',
    'watchlist',
    '관심종목',
    'portfolio',
    '포트폴리오',
  ];

  return blocked.some((token) => normalized === token || normalized.startsWith(`${token} `));
};

const isInternalGoogleFinanceLink = (href: string): boolean => {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'google.com') {
      return false;
    }

    // Keep only external article targets. Internal finance pages are navigation/quote hubs.
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

const jaccardSimilarity = (a: string, b: string): number => {
  const setA = new Set(a.split('|').filter(Boolean));
  const setB = new Set(b.split('|').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const isHeuristicDuplicate = (candidate: NewsItem, recent: NewsHistoryRow): boolean => {
  if (!recent.event_signature) {
    return false;
  }

  if (candidate.lexicalSignature && candidate.lexicalSignature === recent.event_signature) {
    return true;
  }

  const score = jaccardSimilarity(candidate.lexicalSignature, recent.event_signature);
  return score >= 0.82;
};

const parseAiDuplicateDecision = (raw: string): boolean | null => {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as { duplicate?: boolean };
    if (typeof parsed.duplicate === 'boolean') {
      return parsed.duplicate;
    }
  } catch {
    // Ignore and continue with plain-text fallback.
  }

  const lowered = text.toLowerCase();
  if (lowered.includes('true')) {
    return true;
  }
  if (lowered.includes('false')) {
    return false;
  }

  return null;
};

const isSemanticDuplicateWithAi = async (candidate: NewsItem, recents: NewsHistoryRow[]): Promise<boolean> => {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!NEWS_AI_DEDUP_ENABLED || !apiKey || recents.length === 0) {
    return false;
  }

  const recentTitles = recents
    .slice(0, 8)
    .map((row, idx) => `${idx + 1}. ${row.title}`)
    .join('\n');

  const prompt = [
    '두 뉴스 제목이 같은 사건을 다루는지 판별하세요.',
    '반드시 JSON 한 줄로만 답하세요: {"duplicate":true|false}',
    `후보 제목: ${candidate.title}`,
    '최근 전송 제목 목록:',
    recentTitles,
  ].join('\n');

  try {
    const response = await fetchWithTimeout(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_NEWS_DEDUP_MODEL,
        temperature: 0,
        max_tokens: 30,
        messages: [
          { role: 'system', content: 'You are a strict duplicate detector for financial news titles.' },
          { role: 'user', content: prompt },
        ],
      }),
    }, Math.min(FETCH_TIMEOUT_MS, 12_000));

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as Record<string, any>;
    const content = String(payload?.choices?.[0]?.message?.content || '');
    const decision = parseAiDuplicateDecision(content);
    return decision === true;
  } catch {
    return false;
  }
};

const loadRecentNewsHistory = async (guildId: string | null): Promise<NewsHistoryRow[]> => {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const db = getSupabaseClient();
  const cutoffIso = new Date(Date.now() - NEWS_HISTORY_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  let query = db
    .from('news_sentiment')
    .select('guild_id,title,link,event_signature,created_at')
    .gte('created_at', cutoffIso)
    .order('created_at', { ascending: false })
    .limit(NEWS_HISTORY_MAX_ITEMS);

  query = guildId ? query.eq('guild_id', guildId) : query.is('guild_id', null);
  const { data, error } = await query;

  if (error) {
    if (!newsHistoryTableUnavailableLogged && isHistoryUnavailableError(error)) {
      newsHistoryTableUnavailableLogged = true;
      logger.warn('[NEWS-MONITOR] news_sentiment table unavailable, semantic history dedup will be limited');
      return [];
    }

    logger.warn('[NEWS-MONITOR] failed to load semantic dedup history: %s', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    guild_id: row.guild_id ? String(row.guild_id) : null,
    title: String(row.title || ''),
    link: String(row.link || ''),
    event_signature: String(row.event_signature || ''),
    created_at: row.created_at ? String(row.created_at) : null,
  }));
};

const storeNewsHistory = async (item: NewsItem, guildId: string | null) => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const db = getSupabaseClient();
  const { error } = await db.from('news_sentiment').insert([
    {
      guild_id: guildId,
      title: item.title,
      link: item.link,
      event_signature: item.lexicalSignature,
      sentiment_score: null,
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) {
    if (!newsHistoryTableUnavailableLogged && isHistoryUnavailableError(error)) {
      newsHistoryTableUnavailableLogged = true;
      logger.warn('[NEWS-MONITOR] news_sentiment table unavailable, semantic history persistence skipped');
      return;
    }

    logger.warn('[NEWS-MONITOR] failed to persist semantic dedup history: %s', error.message);
  }
};

const extractFinanceNewsItems = (html: string): NewsItem[] => {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const hrefRaw = decodeXml(match[1] || '');
    const title = stripTags(match[2] || '');
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
      const maybeGoogleRedirect = new URL(href);
      const q = maybeGoogleRedirect.searchParams.get('q');
      if (q && /^https?:\/\//.test(q)) {
        href = normalizeLink(q);
      }
    } catch {
      // Ignore parse failures and keep original href.
    }

    if (isInternalGoogleFinanceLink(href)) {
      continue;
    }

    const normalized = normalizeFinanceHeadline(title);
    const headline = normalized.headline || title;

    const key = `${href}|${headline}`.slice(0, 1000);
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
  }

  return items;
};

const fetchLatestGoogleFinanceNews = async (): Promise<NewsItem[]> => {
  const res = await fetchWithTimeout(GOOGLE_FINANCE_NEWS_URL, {
    headers: {
      'User-Agent': 'MuelBot/1.0',
      'Accept-Language': 'ko,en;q=0.8',
    },
  }, FETCH_TIMEOUT_MS);

  if (!res.ok) {
    throw new Error(`Google Finance request failed: ${res.status}`);
  }

  const html = await res.text();
  return extractFinanceNewsItems(html).slice(0, NEWS_CANDIDATE_LIMIT);
};

const pickBestCandidate = async (candidates: NewsItem[], recentHistory: NewsHistoryRow[]): Promise<NewsItem | null> => {
  for (const candidate of candidates) {
    const heuristicDuplicate = recentHistory.some((history) => isHeuristicDuplicate(candidate, history));
    if (heuristicDuplicate) {
      continue;
    }

    const aiDuplicate = await isSemanticDuplicateWithAi(candidate, recentHistory);
    if (aiDuplicate) {
      continue;
    }

    return candidate;
  }

  return null;
};

const claimRowLock = async (id: number): Promise<boolean> => {
  return claimSourceLock({
    id,
    instanceId: INSTANCE_ID,
    lockLeaseMs: LOCK_LEASE_MS,
    logPrefix: '[NEWS-MONITOR]',
  });
};

const releaseRowLock = async (id: number) => {
  await releaseSourceLock({ id, instanceId: INSTANCE_ID, logPrefix: '[NEWS-MONITOR]' });
};

const updateRowState = async (id: number, patch: Record<string, string | null>) => {
  await updateSourceState({ id, patch, logPrefix: '[NEWS-MONITOR]' });
};

const sendNews = async (client: Client, channelId: string, item: NewsItem, summary: string | null) => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error('Target news channel is not sendable');
  }

  const summaryBlock = enforceTwoToThreeLines(summary || '') || buildFallbackKoreanSummary(item);
  const timeLabel = buildTimeLabel(item.publishedAtUnix);
  const sourceLabel = item.publisherName || item.sourceName || 'Google Finance';
  const description = [summaryBlock, timeLabel, item.link].filter(Boolean).join('\n\n');

  await channel.send({
    embeds: [
      {
        title: item.title.slice(0, 250),
        description,
        color: 0x4285F4,
        footer: { text: `source: ${sourceLabel}` },
      },
    ],
  });
};

const runTick = async (client: Client, guildId?: string): Promise<NewsTickStats> => {
  if (!isSupabaseConfigured()) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  const db = getSupabaseClient();
  let query = db
    .from('sources')
    .select('id, guild_id, name, url, channel_id, last_post_signature')
    .eq('is_active', true);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[NEWS-MONITOR] failed to load news channels: %s', error.message);
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  const rows = ((data || []) as NewsChannelRow[]).filter(isGoogleFinanceSourceRow);
  if (rows.length === 0) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: 0 };
  }

  const candidates = await fetchLatestGoogleFinanceNews();
  if (candidates.length === 0) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoCandidate: rows.length };
  }

  const groupedRows = new Map<string, NewsChannelRow[]>();
  for (const row of rows) {
    const key = row.guild_id || '__NULL_GUILD__';
    const existing = groupedRows.get(key) || [];
    existing.push(row);
    groupedRows.set(key, existing);
  }

  const stats: NewsTickStats = {
    processed: 0,
    failed: 0,
    sent: 0,
    skippedLocked: 0,
    skippedDuplicate: 0,
    skippedNoCandidate: 0,
  };

  for (const [groupKey, group] of groupedRows.entries()) {
    const groupGuildId = groupKey === '__NULL_GUILD__' ? null : groupKey;
    const recentHistory = await loadRecentNewsHistory(groupGuildId);
    const latest = await pickBestCandidate(candidates, recentHistory);
    if (!latest) {
      logger.info('[NEWS-MONITOR] guild=%s all fetched candidates were deduplicated', groupGuildId || 'null');
      stats.skippedNoCandidate += group.length;
      continue;
    }

    const latestSummary = await summarizeNewsInKorean(latest);

    let sentAtLeastOnce = false;

    for (const row of group) {
      stats.processed += 1;

      if (!row.channel_id) {
        continue;
      }

      const locked = await claimRowLock(row.id);
      if (!locked) {
        stats.skippedLocked += 1;
        continue;
      }

      try {
        if (row.last_post_signature === latest.key) {
          stats.skippedDuplicate += 1;
          await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
          continue;
        }

        await sendNews(client, row.channel_id, latest, latestSummary);
        stats.sent += 1;
        sentAtLeastOnce = true;
        await updateRowState(row.id, {
          last_check_status: 'success',
          last_check_error: null,
          last_post_signature: latest.key,
        });
      } catch (err) {
        stats.failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
        logger.warn('[NEWS-MONITOR] source=%s failed: %s', String(row.id), msg);
      } finally {
        await releaseRowLock(row.id);
      }
    }

    if (sentAtLeastOnce) {
      await storeNewsHistory(latest, groupGuildId);
    }
  }

  return stats;
};

const executeTick = async (client: Client, guildId?: string) => {
  if (running) {
    return { ok: false, message: 'News monitor tick already running' as const };
  }

  running = true;
  runCount += 1;
  lastRunAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const tick = await runTick(client, guildId);
    lastTickProcessedSources = tick.processed;
    lastTickFailedSources = tick.failed;
    successCount += 1;
    lastSuccessAt = new Date().toISOString();
    if (tick.failed > 0) {
      lastTickStatus = 'partial_failure';
      lastErrorAt = new Date().toISOString();
      lastError = `Partial failure: ${tick.failed}/${tick.processed} sources failed`;
    } else {
      lastTickStatus = 'success';
      lastError = null;
    }
    lastDurationMs = Date.now() - startMs;
    if (tick.processed === 0) {
      return {
        ok: true,
        message: `News tick completed: processed=0 sent=0 failed=0 noCandidate=${tick.skippedNoCandidate} (no matching subscriptions for this guild)`,
      };
    }

    if (tick.failed > 0) {
      return {
        ok: true,
        message: `News tick partial: processed=${tick.processed} sent=${tick.sent} failed=${tick.failed} duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noCandidate=${tick.skippedNoCandidate}`,
      };
    }

    return {
      ok: true,
      message: `News tick completed: processed=${tick.processed} sent=${tick.sent} failed=0 duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noCandidate=${tick.skippedNoCandidate}`,
    };
  } catch (error) {
    failCount += 1;
    lastTickStatus = 'failed';
    lastTickProcessedSources = 0;
    lastTickFailedSources = 0;
    lastErrorAt = new Date().toISOString();
    lastError = error instanceof Error ? error.message : String(error);
    lastDurationMs = Date.now() - startMs;
    logger.warn('[NEWS-MONITOR] tick failed: %o', error);
    return { ok: false, message: lastError || 'News tick failed' as const };
  } finally {
    running = false;
  }
};

export const isNewsSentimentMonitorEnabled = () => (process.env.AUTOMATION_NEWS_ENABLED || 'true').toLowerCase() !== 'false';

export const startNewsSentimentMonitor = (client: Client) => {
  if (started || !isNewsSentimentMonitorEnabled()) {
    return;
  }

  started = true;
  void executeTick(client);
  timer = setInterval(() => {
    void executeTick(client);
  }, INTERVAL_MS);

  logger.info('[NEWS-MONITOR] started (intervalMs=%d, instance=%s)', INTERVAL_MS, INSTANCE_ID);
};

export const triggerNewsSentimentMonitor = async (client: Client, guildId?: string) => {
  if (!started) {
    return { ok: false, message: 'News monitor is not started' };
  }

  return executeTick(client, guildId);
};

export const getNewsSentimentMonitorSnapshot = () => ({
  started,
  running,
  intervalMs: INTERVAL_MS,
  runCount,
  successCount,
  failCount,
  lastRunAt,
  lastSuccessAt,
  lastErrorAt,
  lastError,
  lastDurationMs,
  lastTickProcessedSources,
  lastTickFailedSources,
  lastTickStatus,
});

export const stopNewsSentimentMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  running = false;
};
