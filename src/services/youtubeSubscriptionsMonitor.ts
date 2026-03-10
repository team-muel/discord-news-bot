import { ChannelType, type Client } from 'discord.js';
import logger from '../logger';
import { runWithConcurrency } from '../utils/async';
import { fetchWithTimeout } from '../utils/network';
import { scrapeLatestCommunityPostByChannelId, scrapeLatestCommunityPostByUrl } from './youtubeCommunityScraper';
import { claimSourceLock, releaseSourceLock, updateSourceState } from './sourceMonitorStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

type SubscriptionRow = {
  id: number;
  guild_id: string | null;
  url: string;
  name: string | null;
  channel_id: string | null;
  is_active: boolean | null;
  last_post_id: string | null;
  last_post_signature: string | null;
};

type FeedEntry = {
  id: string;
  title: string;
  content?: string;
  link: string;
  published: string;
  author: string;
};

type YouTubeTickStats = {
  processed: number;
  failed: number;
  sent: number;
  skippedLocked: number;
  skippedDuplicate: number;
  skippedNoLatest: number;
};

type ProcessRowOutcome = 'sent' | 'skipped_locked' | 'skipped_duplicate' | 'skipped_no_latest' | 'error';

type TickOptions = {
  aggressiveProbe?: boolean;
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

const MONITOR_INTERVAL_MS = Math.max(60_000, Number(process.env.YOUTUBE_MONITOR_INTERVAL_MS || 5 * 60_000));
const MONITOR_CONCURRENCY = Math.max(1, Number(process.env.YOUTUBE_MONITOR_CONCURRENCY || 5));
const LOCK_LEASE_MS = Math.max(30_000, Number(process.env.YOUTUBE_MONITOR_LOCK_LEASE_MS || 120_000));
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.YOUTUBE_MONITOR_FETCH_TIMEOUT_MS || 15_000));
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;
const CHANNEL_ID_RE = /\/channel\/(UC[0-9A-Za-z_-]{20,})/;
const CHANNEL_ID_ANY_RE = /(UC[0-9A-Za-z_-]{20,})/;

const parseMode = (row: SubscriptionRow): 'videos' | 'posts' => {
  if (row.url.endsWith('#posts')) {
    return 'posts';
  }

  const name = String(row.name || '').toLowerCase();
  if (name.includes('posts')) {
    return 'posts';
  }

  return 'videos';
};

const isYouTubeSourceRow = (row: SubscriptionRow): boolean => {
  const name = String(row.name || '').toLowerCase();
  const url = String(row.url || '').toLowerCase();

  if (name.startsWith('youtube-')) {
    return true;
  }

  return url.includes('youtube.com/') || url.includes('youtu.be/');
};

const parseChannelId = (url: string): string | null => {
  const base = url.split('#', 1)[0];
  const m = base.match(CHANNEL_ID_RE);
  if (m?.[1]) {
    return m[1];
  }

  const rawMatch = base.match(CHANNEL_ID_ANY_RE);
  if (rawMatch?.[1]) {
    return rawMatch[1];
  }

  try {
    const parsed = new URL(base);
    const queryChannelId = parsed.searchParams.get('channel_id');
    if (queryChannelId && CHANNEL_ID_ANY_RE.test(queryChannelId)) {
      return queryChannelId;
    }
  } catch {
    // Ignore parse errors.
  }

  return null;
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
        'user-agent': 'Mozilla/5.0 (compatible; MuelBot/1.0; +https://github.com)',
      },
    }, Math.min(FETCH_TIMEOUT_MS, 10_000));

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

const COMMUNITY_INITIAL_TITLE_PREFIX = process.env.YT_COMMUNITY_INITIAL_TITLE_PREFIX || '🔔 Muel 구독 시작';
const COMMUNITY_NEW_POST_TITLE_TEMPLATE = process.env.YT_COMMUNITY_NEW_POST_TITLE_TEMPLATE || '{author}님의 새 커뮤니티 게시글';
const COMMUNITY_THREAD_REASON = process.env.YT_COMMUNITY_THREAD_REASON || 'YouTube community post subscription update';
const COMMUNITY_AUTO_ARCHIVE_MIN = Math.max(60, Number(process.env.YT_COMMUNITY_THREAD_AUTO_ARCHIVE_MIN || 60));

const buildCommunityStarterTitle = (latest: FeedEntry, isFirstNotification: boolean) => {
  if (isFirstNotification) {
    return `${COMMUNITY_INITIAL_TITLE_PREFIX}: ${latest.author}`;
  }

  return COMMUNITY_NEW_POST_TITLE_TEMPLATE.replace('{author}', latest.author);
};

const sendCommunityPostWithThread = async (channel: any, latest: FeedEntry, isFirstNotification: boolean) => {
  const starter = await channel.send({
    content: buildCommunityStarterTitle(latest, isFirstNotification),
  });

  const threadName = (latest.title || latest.author).slice(0, 90);
  const canCreateThread = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;

  if (canCreateThread && starter && typeof starter.startThread === 'function') {
    await starter.startThread({
      name: threadName,
      autoArchiveDuration: COMMUNITY_AUTO_ARCHIVE_MIN,
      reason: COMMUNITY_THREAD_REASON,
    });
  }
};

const fetchLatestFromFeed = async (channelId: string, mode: 'videos' | 'posts'): Promise<FeedEntry | null> => {
  const feedUrl = mode === 'videos'
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    : `https://www.youtube.com/feeds/posts.xml?channel_id=${channelId}`;

  try {
    const res = await fetchWithTimeout(feedUrl, {
      headers: {
        'User-Agent': 'MuelBot/1.0',
        'Accept-Language': 'ko,en;q=0.8',
      },
    }, FETCH_TIMEOUT_MS);

    if (res.ok) {
      const xml = await res.text();
      const entry = parseFirstEntry(xml);
      if (entry) {
        return entry;
      }
    }
  } catch {
    // Fall through to community scraper fallback for posts mode.
  }

  if (mode === 'posts') {
    return scrapeLatestCommunityPostByChannelId(channelId, FETCH_TIMEOUT_MS);
  }

  throw new Error('Feed request failed');
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

const fetchLatestCommunityPostAggressively = async (
  _channelId: string,
  sourceUrl: string,
): Promise<FeedEntry | null> => {
  const probeUrls = buildAggressivePostProbeUrls(sourceUrl);
  for (const probeUrl of probeUrls) {
    const hit = await scrapeLatestCommunityPostByUrl(probeUrl, FETCH_TIMEOUT_MS);
    if (hit) {
      return hit;
    }
  }

  return null;
};

const fetchLatestWithOptions = async (
  row: SubscriptionRow,
  channelId: string,
  mode: 'videos' | 'posts',
  options?: TickOptions,
): Promise<FeedEntry | null> => {
  const latest = await fetchLatestFromFeed(channelId, mode);
  if (latest) {
    return latest;
  }

  if (mode !== 'posts' || !options?.aggressiveProbe) {
    return null;
  }

  return fetchLatestCommunityPostAggressively(channelId, row.url);
};

const updateRowState = async (id: number, patch: Record<string, string | null>) => {
  await updateSourceState({ id, patch, logPrefix: '[YT-MONITOR]' });
};

const claimRowLock = async (id: number): Promise<boolean> => {
  return claimSourceLock({
    id,
    instanceId: INSTANCE_ID,
    lockLeaseMs: LOCK_LEASE_MS,
    logPrefix: '[YT-MONITOR]',
  });
};

const releaseRowLock = async (id: number) => {
  await releaseSourceLock({ id, instanceId: INSTANCE_ID, logPrefix: '[YT-MONITOR]' });
};

const processRow = async (client: Client, row: SubscriptionRow, options?: TickOptions): Promise<ProcessRowOutcome> => {
  if (!row.is_active) {
    return 'skipped_no_latest';
  }

  const claimed = await claimRowLock(row.id);
  if (!claimed) {
    return 'skipped_locked';
  }

  try {
  const mode = parseMode(row);
  const channelId = parseChannelId(row.url) || await resolveChannelIdFromHandleUrl(row.url);
  if (!channelId || !row.channel_id) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Invalid subscription URL/channel' });
    return 'error';
  }

  const channel = await client.channels.fetch(row.channel_id);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Target channel not found or not sendable channel' });
    return 'error';
  }

  const latest = await fetchLatestWithOptions(row, channelId, mode, options);
  if (!latest) {
    await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
    return 'skipped_no_latest';
  }

  const previous = mode === 'videos' ? row.last_post_id : row.last_post_signature;
  if (previous === latest.id) {
    await updateRowState(row.id, { last_check_status: 'success', last_check_error: null });
    return 'skipped_duplicate';
  }

  if (mode === 'videos') {
    await channel.send({
      content: [
        `📌 ${latest.author} 신규 영상 업로드!`,
        latest.title,
        latest.link,
      ].join('\n'),
    });

    await updateRowState(row.id, {
      last_check_status: 'success',
      last_check_error: null,
      last_post_id: latest.id,
    });
    return 'sent';
  }

  const isFirstNotification = !previous;
  await sendCommunityPostWithThread(channel, latest, isFirstNotification);

  await updateRowState(row.id, {
    last_check_status: 'success',
    last_check_error: null,
    last_post_signature: latest.id,
  });
  return 'sent';
  } finally {
    await releaseRowLock(row.id);
  }
};

const runTick = async (client: Client, guildId?: string, options?: TickOptions): Promise<YouTubeTickStats> => {
  if (!isSupabaseConfigured()) {
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoLatest: 0 };
  }

  const db = getSupabaseClient();
  let query = db
    .from('sources')
    .select('id,guild_id,url,name,channel_id,is_active,last_post_id,last_post_signature')
    .eq('is_active', true);

  if (guildId) {
    query = query.eq('guild_id', guildId);
  }

  const { data, error } = await query;

  if (error) {
    logger.warn('[YT-MONITOR] failed to load subscriptions: %s', error.message);
    return { processed: 0, failed: 0, sent: 0, skippedLocked: 0, skippedDuplicate: 0, skippedNoLatest: 0 };
  }

  const rows = ((data || []) as SubscriptionRow[]).filter(isYouTubeSourceRow);
  const stats: YouTubeTickStats = {
    processed: 0,
    failed: 0,
    sent: 0,
    skippedLocked: 0,
    skippedDuplicate: 0,
    skippedNoLatest: 0,
  };

  await runWithConcurrency(rows, async (row) => {
    stats.processed += 1;
    try {
      const outcome = await processRow(client, row, options);
      if (outcome === 'sent') {
        stats.sent += 1;
      } else if (outcome === 'skipped_locked') {
        stats.skippedLocked += 1;
      } else if (outcome === 'skipped_duplicate') {
        stats.skippedDuplicate += 1;
      } else if (outcome === 'skipped_no_latest') {
        stats.skippedNoLatest += 1;
      } else if (outcome === 'error') {
        stats.failed += 1;
      }
    } catch (err) {
      stats.failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
      logger.warn('[YT-MONITOR] source=%s failed: %s', String(row.id), msg);
    }
  }, MONITOR_CONCURRENCY);

  return stats;
};

const executeTick = async (client: Client, guildId?: string, options?: TickOptions) => {
  if (running) {
    return { ok: false, message: 'Monitor tick already running' as const };
  }

  running = true;
  runCount += 1;
  lastRunAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const tick = await runTick(client, guildId, options);
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
      return { ok: true, message: 'Tick completed: processed=0 failed=0 sent=0 (no matching subscriptions for this guild)' };
    }

    if (tick.failed > 0) {
      return {
        ok: true,
        message: `Tick partial: processed=${tick.processed} sent=${tick.sent} failed=${tick.failed} duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noLatest=${tick.skippedNoLatest}`,
      };
    }

    return {
      ok: true,
      message: `Tick completed: processed=${tick.processed} sent=${tick.sent} failed=0 duplicate=${tick.skippedDuplicate} locked=${tick.skippedLocked} noLatest=${tick.skippedNoLatest}`,
    };
  } catch (err) {
    failCount += 1;
    lastTickStatus = 'failed';
    lastTickProcessedSources = 0;
    lastTickFailedSources = 0;
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

  return executeTick(client, guildId, { aggressiveProbe: true });
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
  lastTickProcessedSources,
  lastTickFailedSources,
  lastTickStatus,
});

export const stopYouTubeSubscriptionsMonitor = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
  running = false;
};
