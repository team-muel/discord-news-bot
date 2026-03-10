import { type Client } from 'discord.js';
import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type NewsItem = {
  title: string;
  link: string;
  sourceName: string | null;
  key: string;
};

type NewsChannelRow = {
  id: number;
  guild_id: string | null;
  channel_id: string | null;
  last_post_signature: string | null;
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

const INTERVAL_MS = Math.max(60_000, Number(process.env.NEWS_MONITOR_INTERVAL_MS || 10 * 60_000));
const GOOGLE_FINANCE_NEWS_URL = (process.env.GOOGLE_FINANCE_NEWS_URL || 'https://www.google.com/finance/markets?hl=ko').trim();
const LOCK_LEASE_MS = Math.max(30_000, Number(process.env.NEWS_MONITOR_LOCK_LEASE_MS || 120_000));
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;

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

const stripTags = (html: string): string => {
  return decodeXml(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
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

    const key = `${href}|${title}`.slice(0, 1000);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push({
      title,
      link: href,
      sourceName: parseSourceName(href),
      key,
    });
  }

  return items;
};

const fetchLatestGoogleFinanceNews = async (): Promise<NewsItem | null> => {
  const res = await fetch(GOOGLE_FINANCE_NEWS_URL, {
    headers: {
      'User-Agent': 'MuelBot/1.0',
      'Accept-Language': 'ko,en;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`Google Finance request failed: ${res.status}`);
  }

  const html = await res.text();
  const items = extractFinanceNewsItems(html);
  return items.length > 0 ? items[0] : null;
};

const claimRowLock = async (id: number): Promise<boolean> => {
  const db = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const leaseUntilIso = new Date(Date.now() + LOCK_LEASE_MS).toISOString();

  const { data, error } = await db
    .from('sources')
    .update({ lock_token: INSTANCE_ID, lock_expires_at: leaseUntilIso })
    .eq('id', id)
    .eq('is_active', true)
    .or(`lock_token.is.null,lock_expires_at.lt.${nowIso},lock_token.eq.${INSTANCE_ID}`)
    .select('id')
    .limit(1);

  if (error) {
    logger.warn('[NEWS-MONITOR] lock claim failed source=%s: %s', String(id), error.message);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

const releaseRowLock = async (id: number) => {
  const db = getSupabaseClient();
  const { error } = await db
    .from('sources')
    .update({ lock_token: null, lock_expires_at: null })
    .eq('id', id)
    .eq('lock_token', INSTANCE_ID);

  if (error) {
    logger.warn('[NEWS-MONITOR] lock release failed source=%s: %s', String(id), error.message);
  }
};

const updateRowState = async (id: number, patch: Record<string, string | null>) => {
  const db = getSupabaseClient();
  const { error } = await db.from('sources').update({ ...patch, last_check_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    logger.warn('[NEWS-MONITOR] failed to update source=%s: %s', String(id), error.message);
  }
};

const sendNews = async (client: Client, channelId: string, item: NewsItem) => {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new Error('Target news channel is not sendable');
  }

  await channel.send({
    embeds: [
      {
        title: `[Google Finance] ${item.title}`.slice(0, 250),
        description: `${item.link}`,
        color: 0x4285F4,
        footer: { text: item.sourceName ? `source: ${item.sourceName}` : 'source: Google Finance' },
      },
    ],
  });
};

const runTick = async (client: Client, guildId?: string) => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const db = getSupabaseClient();
  let query = db
    .from('sources')
    .select('id, guild_id, channel_id, last_post_signature')
    .eq('is_active', true)
    .eq('name', 'google-finance-news');

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[NEWS-MONITOR] failed to load news channels: %s', error.message);
    return;
  }

  const rows = (data || []) as NewsChannelRow[];
  if (rows.length === 0) {
    return;
  }

  const latest = await fetchLatestGoogleFinanceNews();
  if (!latest) {
    return;
  }

  for (const row of rows) {
    if (!row.channel_id) {
      continue;
    }

    const locked = await claimRowLock(row.id);
    if (!locked) {
      continue;
    }

    try {
      if (row.last_post_signature === latest.key) {
        await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
        continue;
      }

      await sendNews(client, row.channel_id, latest);
      await updateRowState(row.id, {
        last_check_status: 'success',
        last_check_error: null,
        last_post_signature: latest.key,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
      logger.warn('[NEWS-MONITOR] source=%s failed: %s', String(row.id), msg);
    } finally {
      await releaseRowLock(row.id);
    }
  }
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
    await runTick(client, guildId);
    successCount += 1;
    lastSuccessAt = new Date().toISOString();
    lastError = null;
    lastDurationMs = Date.now() - startMs;
    return { ok: true, message: 'News tick completed' as const };
  } catch (error) {
    failCount += 1;
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
});

export const stopNewsSentimentMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  running = false;
};
