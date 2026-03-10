import { ChannelType, type Client } from 'discord.js';
import logger from '../logger';
import { runWithConcurrency } from '../utils/async';
import { fetchWithTimeout } from '../utils/network';
import { scrapeLatestCommunityPostByChannelId } from './youtubeCommunityScraper';
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

const formatThreadDateLabel = (isoLike: string | undefined): string => {
  const date = isoLike ? new Date(isoLike) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '최근';
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const buildCommunityThreadBody = (latest: FeedEntry): string => {
  const content = String(latest.content || latest.title || '').trim();
  const summary = content.length > 1900 ? `${content.slice(0, 1900)}...` : content;

  return [
    '이제부터 해당 채널의 소식을 실시간으로 전달합니다.',
    '',
    '최신 게시글:',
    `[${latest.title}]`,
    '',
    summary || '(본문 추출 실패)',
    '',
    latest.link,
  ].join('\n');
};

const sendCommunityPostWithThread = async (channel: any, latest: FeedEntry) => {
  const starter = await channel.send({
    content: `⚠️ Muel 구독 시작:\n${latest.author}님이 새 커뮤니티 게시글 스레드를 시작하셨어요.(스레드 모두 보기)`,
  });

  const threadNameBase = `${latest.author} 게시글 알림 ${formatThreadDateLabel(latest.published)}`;
  const threadName = threadNameBase.slice(0, 90);
  const canCreateThread = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;

  if (canCreateThread && starter && typeof starter.startThread === 'function') {
    const thread = await starter.startThread({
      name: threadName,
      autoArchiveDuration: 60,
      reason: 'YouTube community post subscription update',
    });

    await thread.send({ content: buildCommunityThreadBody(latest) });
    return;
  }

  await channel.send({ content: buildCommunityThreadBody(latest) });
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

const processRow = async (client: Client, row: SubscriptionRow) => {
  if (!row.is_active) {
    return;
  }

  const claimed = await claimRowLock(row.id);
  if (!claimed) {
    return;
  }

  try {
  const mode = parseMode(row);
  const channelId = parseChannelId(row.url) || await resolveChannelIdFromHandleUrl(row.url);
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

  await sendCommunityPostWithThread(channel, latest);

  await updateRowState(row.id, {
    last_check_status: 'success',
    last_check_error: null,
    last_post_signature: latest.id,
  });
  } finally {
    await releaseRowLock(row.id);
  }
};

const runTick = async (client: Client, guildId?: string): Promise<{ processed: number; failed: number }> => {
  if (!isSupabaseConfigured()) {
    return { processed: 0, failed: 0 };
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
    return { processed: 0, failed: 0 };
  }

  const rows = ((data || []) as SubscriptionRow[]).filter(isYouTubeSourceRow);
  let processed = 0;
  let failed = 0;

  await runWithConcurrency(rows, async (row) => {
    processed += 1;
    try {
      await processRow(client, row);
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      await updateRowState(row.id, { last_check_status: 'error', last_check_error: msg });
      logger.warn('[YT-MONITOR] source=%s failed: %s', String(row.id), msg);
    }
  }, MONITOR_CONCURRENCY);

  return { processed, failed };
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
      return { ok: true, message: 'Tick completed: processed=0 failed=0 (no matching subscriptions for this guild)' };
    }

    if (tick.failed > 0) {
      return { ok: true, message: `Tick completed with partial failures: processed=${tick.processed} failed=${tick.failed}` };
    }

    return { ok: true, message: `Tick completed: processed=${tick.processed} failed=0` };
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
