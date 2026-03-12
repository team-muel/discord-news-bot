import { ChannelType, type Client } from 'discord.js';
import logger from '../logger';
import { runWithConcurrency } from '../utils/async';
import { claimSourceLock, releaseSourceLock, updateSourceState } from './sourceMonitorStore';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';
import { fetchYouTubeLatestByWorker } from './youtubeMonitorWorkerClient';

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
const INSTANCE_ID = process.env.RENDER_INSTANCE_ID || process.env.RENDER_SERVICE_ID || process.env.HOSTNAME || `local-${process.pid}`;

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

const fetchLatestWithOptions = async (
  row: SubscriptionRow,
  mode: 'videos' | 'posts',
  options?: TickOptions,
): Promise<FeedEntry | null> => {
  const latest = await fetchYouTubeLatestByWorker({
    sourceUrl: row.url,
    mode,
    aggressiveProbe: Boolean(options?.aggressiveProbe),
  });

  if (!latest || !latest.found || !latest.entry) {
    return null;
  }

  return latest.entry;
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
  if (!row.channel_id) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Invalid subscription URL/channel' });
    return 'error';
  }

  const channel = await client.channels.fetch(row.channel_id);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    await updateRowState(row.id, { last_check_status: 'error', last_check_error: 'Target channel not found or not sendable channel' });
    return 'error';
  }

  const latest = await fetchLatestWithOptions(row, mode, options);
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
