import { ChannelType, type Client } from 'discord.js';
import logger from '../logger';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type SubscriptionRow = {
  id: number;
  guild_id: string | null;
  url: string;
  channel_id: string | null;
  is_active: boolean | null;
  last_post_id: string | null;
  last_post_signature: string | null;
};

type FeedEntry = {
  id: string;
  title: string;
  link: string;
  published: string;
  author: string;
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

const MONITOR_INTERVAL_MS = Math.max(60_000, Number(process.env.YOUTUBE_MONITOR_INTERVAL_MS || 5 * 60_000));
const MONITOR_CONCURRENCY = Math.max(1, Number(process.env.YOUTUBE_MONITOR_CONCURRENCY || 5));
const LOCK_LEASE_MS = Math.max(30_000, Number(process.env.YOUTUBE_MONITOR_LOCK_LEASE_MS || 120_000));
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;
const CHANNEL_ID_RE = /\/channel\/(UC[0-9A-Za-z_-]{20,})/;

const parseMode = (url: string): 'videos' | 'posts' => {
  return url.endsWith('#posts') ? 'posts' : 'videos';
};

const parseChannelId = (url: string): string | null => {
  const base = url.split('#', 1)[0];
  const m = base.match(CHANNEL_ID_RE);
  return m?.[1] || null;
};

const textBetween = (source: string, start: string, end: string): string => {
  const s = source.indexOf(start);
  if (s < 0) return '';
  const i = s + start.length;
  const e = source.indexOf(end, i);
  if (e < 0) return '';
  return source.slice(i, e).trim();
};

const parseFirstEntry = (xml: string): FeedEntry | null => {
  const entryBlock = textBetween(xml, '<entry>', '</entry>');
  if (!entryBlock) return null;

  const id = textBetween(entryBlock, '<yt:videoId>', '</yt:videoId>')
    || textBetween(entryBlock, '<id>', '</id>')
    || '';
  const title = textBetween(entryBlock, '<title>', '</title>') || '(제목 없음)';
  const linkMatch = entryBlock.match(/<link[^>]*href="([^"]+)"/);
  const link = linkMatch?.[1] || '';
  const published = textBetween(entryBlock, '<published>', '</published>') || textBetween(entryBlock, '<updated>', '</updated>');
  const authorBlock = textBetween(entryBlock, '<author>', '</author>');
  const author = textBetween(authorBlock, '<name>', '</name>') || 'Unknown';

  if (!id || !link) return null;
  return { id, title, link, published, author };
};

const fetchLatestFromFeed = async (channelId: string, mode: 'videos' | 'posts'): Promise<FeedEntry | null> => {
  const feedUrl = mode === 'videos'
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    : `https://www.youtube.com/feeds/posts.xml?channel_id=${channelId}`;

  const res = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'MuelBot/1.0',
      'Accept-Language': 'ko,en;q=0.8',
    },
  });

  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status}`);
  }

  const xml = await res.text();
  return parseFirstEntry(xml);
};

const updateRowState = async (id: number, patch: Record<string, string | null>) => {
  const db = getSupabaseClient();
  const { error } = await db.from('sources').update({ ...patch, last_check_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    logger.warn('[YT-MONITOR] failed to update source=%s: %s', String(id), error.message);
  }
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
    logger.warn('[YT-MONITOR] lock claim failed source=%s: %s', String(id), error.message);
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
    logger.warn('[YT-MONITOR] lock release failed source=%s: %s', String(id), error.message);
  }
};

const processRow = async (client: Client, row: SubscriptionRow) => {
  if (!row.is_active) {
    return;
  }

  const claimed = await claimRowLock(row.id);
  if (!claimed) {
    return;
  }

  try {
  const mode = parseMode(row.url);
  const channelId = parseChannelId(row.url);
  if (!channelId || !row.channel_id) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Invalid subscription URL/channel' });
    return;
  }

  const channel = await client.channels.fetch(row.channel_id);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Target channel not found or not sendable channel' });
    return;
  }

  const latest = await fetchLatestFromFeed(channelId, mode);
  if (!latest) {
    await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
    return;
  }

  const previous = mode === 'videos' ? row.last_post_id : row.last_post_signature;
  if (previous === latest.id) {
    await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
    return;
  }

  if (mode === 'videos') {
    await channel.send({
      embeds: [{
        title: '신규 영상 업로드',
        description: `**${latest.title}**\n${latest.link}`,
        color: 0xE62117,
        url: latest.link,
      }],
    });

    await updateRowState(row.id, {
      last_check_status: 'success',
      last_check_error: null,
      last_post_id: latest.id,
    });
    return;
  }

  await channel.send({
    embeds: [{
      title: `${latest.author} 새 커뮤니티 게시글`,
      description: `${latest.title}\n\n${latest.link}`,
      color: 0xCC0000,
      url: latest.link,
    }],
  });

  await updateRowState(row.id, {
    last_check_status: 'success',
    last_check_error: null,
    last_post_signature: latest.id,
  });
  } finally {
    await releaseRowLock(row.id);
  }
};

const runWithConcurrency = async <T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number) => {
  if (items.length === 0) {
    return;
  }

  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      await worker(items[current]);
    }
  });

  await Promise.all(workers);
};

const runTick = async (client: Client, guildId?: string) => {
  if (!isSupabaseConfigured()) {
    return;
  }

  const db = getSupabaseClient();
  let query = db
    .from('sources')
    .select('id,guild_id,url,channel_id,is_active,last_post_id,last_post_signature')
    .eq('is_active', true)
    .ilike('url', '%youtube.com/channel/%#%');

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[YT-MONITOR] failed to load subscriptions: %s', error.message);
    return;
  }

  const rows = (data || []) as SubscriptionRow[];
  await runWithConcurrency(rows, async (row) => {
    try {
      await processRow(client, row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
      logger.warn('[YT-MONITOR] source=%s failed: %s', String(row.id), msg);
    }
  }, MONITOR_CONCURRENCY);
};

const executeTick = async (client: Client, guildId?: string) => {
  if (running) {
    return { ok: false, message: 'Monitor tick already running' as const };
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
    return { ok: true, message: 'Tick completed' as const };
  } catch (err) {
    failCount += 1;
    lastErrorAt = new Date().toISOString();
    lastError = err instanceof Error ? err.message : String(err);
    lastDurationMs = Date.now() - startMs;
    logger.warn('[YT-MONITOR] tick failed: %o', err);
    return { ok: false, message: lastError || 'Tick failed' as const };
  } finally {
    running = false;
  }
};

export const startYouTubeSubscriptionsMonitor = (client: Client) => {
  if (started) {
    return;
  }

  started = true;

  void executeTick(client);
  timer = setInterval(() => {
    void executeTick(client);
  }, MONITOR_INTERVAL_MS);

  logger.info('[YT-MONITOR] started (intervalMs=%d, concurrency=%d, instance=%s)', MONITOR_INTERVAL_MS, MONITOR_CONCURRENCY, INSTANCE_ID);
};

export const triggerYouTubeSubscriptionsMonitor = async (client: Client, guildId?: string) => {
  if (!started) {
    return { ok: false, message: 'Monitor is not started' };
  }

  return executeTick(client, guildId);
};

export const getYouTubeSubscriptionsMonitorSnapshot = () => ({
  started,
  running,
  intervalMs: MONITOR_INTERVAL_MS,
  runCount,
  successCount,
  failCount,
  lastRunAt,
  lastSuccessAt,
  lastErrorAt,
  lastError,
  lastDurationMs,
});

export const stopYouTubeSubscriptionsMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  running = false;
};
