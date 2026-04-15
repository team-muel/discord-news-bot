/**
 * n8n Delegation Service — routes automation workloads to n8n webhooks
 * instead of executing them inline.
 *
 * Architecture: "body = n8n, brain = ours"
 *   - n8n handles external I/O (RSS, scraping, alert dispatch)
 *   - our code handles orchestration (dedup, judgment, routing)
 *
 * Features:
 *   - Dynamic env reading (no restart needed for on/off toggle)
 *   - Single gate: shouldDelegate() checks n8n availability cache internally
 *   - Delegation-first mode: N8N_DELEGATION_FIRST=true skips inline entirely
 *   - Boot-time availability caching with configurable TTL
 *   - Response schema validation per task
 */
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { executeExternalAction } from '../tools/externalAdapterRegistry';
import type { ExternalAdapterResult } from '../tools/externalAdapterTypes';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

// ─── Dynamic Configuration (re-read every call, no restart needed) ────────────

const readDelegationEnabled = (): boolean =>
  parseBooleanEnv(process.env.N8N_DELEGATION_ENABLED, false);

const readDelegationFirst = (): boolean =>
  parseBooleanEnv(process.env.N8N_DELEGATION_FIRST, false);

const WEBHOOK_ENV_MAP: Record<DelegatableTask, string> = {
  'news-rss-fetch': 'N8N_WEBHOOK_NEWS_RSS_FETCH',
  'news-summarize': 'N8N_WEBHOOK_NEWS_SUMMARIZE',
  'news-monitor-candidates': 'N8N_WEBHOOK_NEWS_MONITOR_CANDIDATES',
  'youtube-feed-fetch': 'N8N_WEBHOOK_YOUTUBE_FEED_FETCH',
  'youtube-community-scrape': 'N8N_WEBHOOK_YOUTUBE_COMMUNITY_SCRAPE',
  'alert-dispatch': 'N8N_WEBHOOK_ALERT_DISPATCH',
  'article-context-fetch': 'N8N_WEBHOOK_ARTICLE_CONTEXT_FETCH',
};

const readWebhookPath = (task: DelegatableTask): string =>
  String(process.env[WEBHOOK_ENV_MAP[task]] || '').trim();

// ─── n8n Availability Cache ───────────────────────────────────────────────────

const AVAILABILITY_CACHE_TTL_MS = Math.max(
  5_000,
  parseIntegerEnv(process.env.N8N_AVAILABILITY_CACHE_TTL_MS, 60_000),
);

let availabilityCache: { available: boolean; checkedAt: number } | null = null;

const checkN8nAvailability = async (): Promise<boolean> => {
  const now = Date.now();
  if (availabilityCache && now - availabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return availabilityCache.available;
  }

  try {
    // Lightweight probe: execute a no-op check via the adapter registry
    const result = await executeExternalAction('n8n', 'workflow.list', { limit: 1 });
    // ADAPTER_UNAVAILABLE means n8n is disabled or unreachable
    const available = result.error !== 'ADAPTER_UNAVAILABLE' && result.error !== 'ADAPTER_NOT_FOUND';
    availabilityCache = { available, checkedAt: now };
    if (!available) {
      logger.info('[N8N-DELEGATE] availability probe: n8n unavailable (cached for %dms)', AVAILABILITY_CACHE_TTL_MS);
    }
    return available;
  } catch {
    availabilityCache = { available: false, checkedAt: now };
    return false;
  }
};

/** Reset cache (for testing or after config change). */
export const resetAvailabilityCache = (): void => {
  availabilityCache = null;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type DelegatableTask =
  | 'news-rss-fetch'
  | 'news-summarize'
  | 'news-monitor-candidates'
  | 'youtube-feed-fetch'
  | 'youtube-community-scrape'
  | 'alert-dispatch'
  | 'article-context-fetch';

export type DelegationResult<T = unknown> = {
  delegated: boolean;
  ok: boolean;
  data: T | null;
  error?: string;
  durationMs: number;
};

// ─── Response Schema Validators ───────────────────────────────────────────────

type SchemaValidator = (data: unknown) => boolean;

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isArrayOf = (arr: unknown, check: (item: unknown) => boolean): boolean =>
  Array.isArray(arr) && arr.every(check);

const hasString = (obj: Record<string, unknown>, key: string): boolean =>
  typeof obj[key] === 'string';

const SCHEMA_VALIDATORS: Partial<Record<DelegatableTask, SchemaValidator>> = {
  'news-rss-fetch': (d) =>
    isObject(d) && isArrayOf(d.items, (i) => isObject(i) && hasString(i as Record<string, unknown>, 'title') && hasString(i as Record<string, unknown>, 'link')),
  'news-summarize': (d) =>
    isObject(d) && hasString(d, 'summary'),
  'news-monitor-candidates': (d) =>
    isObject(d) && isArrayOf(d.items, (i) => isObject(i) && hasString(i as Record<string, unknown>, 'title') && hasString(i as Record<string, unknown>, 'link') && hasString(i as Record<string, unknown>, 'key')),
  'youtube-feed-fetch': (d) =>
    isObject(d) && isArrayOf(d.entries, (i) => isObject(i) && hasString(i as Record<string, unknown>, 'id') && hasString(i as Record<string, unknown>, 'link')),
  'youtube-community-scrape': (d) =>
    isObject(d) && hasString(d, 'id') && hasString(d, 'link'),
  'alert-dispatch': () => true, // no response body expected
  'article-context-fetch': (d) =>
    isObject(d) && (hasString(d, 'title') || hasString(d, 'description')),
};

// ─── Core Delegation Logic ────────────────────────────────────────────────────

/**
 * Check whether a specific task should be delegated to n8n.
 * Single gate: checks both master switch AND webhook config AND availability cache.
 */
export const shouldDelegate = (task: DelegatableTask): boolean => {
  if (!readDelegationEnabled()) return false;
  const path = readWebhookPath(task);
  if (!path) return false;
  // Availability is checked asynchronously in delegateToN8n;
  // shouldDelegate is a synchronous fast-path for callers that
  // need a quick "is this task even configured?" check.
  return true;
};

/**
 * Whether delegation-first mode is active.
 * In this mode, when n8n returns a failure, callers should NOT fall
 * back to inline — the error should propagate.
 */
export const isDelegationFirst = (): boolean =>
  readDelegationEnabled() && readDelegationFirst();

/**
 * Whether a configured task should skip inline fallback after a failed
 * n8n attempt. Other delegated surfaces may still run, but the local
 * fetch/scrape/summary path should stay off.
 */
export const shouldSkipInlineFallback = (task: DelegatableTask): boolean =>
  shouldDelegate(task) && isDelegationFirst();

/**
 * Delegate a task to n8n via webhook trigger.
 * Returns { delegated: false } if delegation is not available,
 * allowing the caller to fall back to inline execution.
 *
 * Includes:
 * - Availability cache check (avoids healthz probe every tick)
 * - Response schema validation (rejects malformed n8n responses)
 */
export const delegateToN8n = async <T = unknown>(
  task: DelegatableTask,
  payload: Record<string, unknown>,
): Promise<DelegationResult<T>> => {
  const start = Date.now();

  if (!shouldDelegate(task)) {
    return { delegated: false, ok: false, data: null, durationMs: 0 };
  }

  // Check cached n8n availability before making the call
  const available = await checkN8nAvailability();
  if (!available) {
    return { delegated: false, ok: false, data: null, durationMs: Date.now() - start };
  }

  const webhookPath = readWebhookPath(task);

  try {
    const result: ExternalAdapterResult = await executeExternalAction(
      'n8n',
      'workflow.trigger',
      { webhookPath, data: payload, method: 'POST' },
    );

    if (!result.ok) {
      logger.warn('[N8N-DELEGATE] task=%s failed: %s', task, result.error || result.summary);
      // If adapter became unavailable, invalidate cache
      if (result.error === 'ADAPTER_UNAVAILABLE') {
        availabilityCache = { available: false, checkedAt: Date.now() };
      }
      return {
        delegated: true,
        ok: false,
        data: null,
        error: result.error || result.summary,
        durationMs: Date.now() - start,
      };
    }

    // Parse response data from n8n output
    let data: T | null = null;
    if (result.output.length > 0) {
      try {
        data = JSON.parse(result.output[0]) as T;
      } catch {
        // n8n may return non-JSON — treat raw text as data
        data = result.output[0] as unknown as T;
      }
    }

    // Schema validation
    const validator = SCHEMA_VALIDATORS[task];
    if (validator && data !== null && !validator(data)) {
      logger.warn('[N8N-DELEGATE] task=%s response schema mismatch', task);
      return {
        delegated: true,
        ok: false,
        data: null,
        error: 'RESPONSE_SCHEMA_MISMATCH',
        durationMs: Date.now() - start,
      };
    }

    logger.info('[N8N-DELEGATE] task=%s ok durationMs=%d', task, Date.now() - start);
    return {
      delegated: true,
      ok: true,
      data,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    logger.warn('[N8N-DELEGATE] task=%s exception: %s', task, msg);
    return {
      delegated: true,
      ok: false,
      data: null,
      error: msg,
      durationMs: Date.now() - start,
    };
  }
};

// ─── Task-Specific Delegation Wrappers ────────────────────────────────────────

export type N8nNewsRssResult = {
  items: Array<{
    title: string;
    link: string;
    source?: string;
    pubDate?: string;
  }>;
};

export const delegateNewsRssFetch = async (
  query: string,
  limit: number,
): Promise<DelegationResult<N8nNewsRssResult>> => {
  return delegateToN8n<N8nNewsRssResult>('news-rss-fetch', { query, limit });
};

export type N8nNewsSummaryResult = {
  summary: string;
};

export const delegateNewsSummarize = async (
  title: string,
  link: string,
  description: string,
): Promise<DelegationResult<N8nNewsSummaryResult>> => {
  return delegateToN8n<N8nNewsSummaryResult>('news-summarize', { title, link, description });
};

export type N8nNewsMonitorCandidatesResult = {
  items: Array<{
    title: string;
    link: string;
    sourceName?: string;
    publisherName?: string;
    publishedAtUnix?: number;
    key: string;
    lexicalSignature?: string;
  }>;
};

/**
 * Delegate news monitor candidate fetching to n8n.
 * This is the critical Tier-2 gap: without this, the news sentiment monitor
 * cannot function when MCP Worker is unavailable.
 *
 * Expected n8n workflow:
 *   1. Fetch Google Finance RSS
 *   2. Parse items with title, link, source, pubDate
 *   3. Generate a unique key per item
 *   4. Return { items: [...] }
 */
export const delegateNewsMonitorCandidates = async (
  limit: number,
): Promise<DelegationResult<N8nNewsMonitorCandidatesResult>> => {
  return delegateToN8n<N8nNewsMonitorCandidatesResult>('news-monitor-candidates', { limit });
};

export type N8nYoutubeFeedResult = {
  entries: Array<{
    id: string;
    title: string;
    link: string;
    published: string;
    author: string;
  }>;
};

export const delegateYoutubeFeedFetch = async (
  channelUrl: string,
): Promise<DelegationResult<N8nYoutubeFeedResult>> => {
  return delegateToN8n<N8nYoutubeFeedResult>('youtube-feed-fetch', { channelUrl });
};

export type N8nYoutubeScrapedPost = {
  id: string;
  title: string;
  content: string;
  link: string;
  published: string;
  author: string;
};

export const delegateYoutubeCommunityScrape = async (
  communityUrl: string,
): Promise<DelegationResult<N8nYoutubeScrapedPost>> => {
  return delegateToN8n<N8nYoutubeScrapedPost>('youtube-community-scrape', { communityUrl });
};

export const delegateAlertDispatch = async (
  title: string,
  message: string,
  tags: Record<string, string>,
): Promise<DelegationResult<void>> => {
  return delegateToN8n<void>('alert-dispatch', { title, message, tags });
};

export type N8nArticleContextResult = {
  title: string;
  description: string;
};

export const delegateArticleContextFetch = async (
  url: string,
): Promise<DelegationResult<N8nArticleContextResult>> => {
  return delegateToN8n<N8nArticleContextResult>('article-context-fetch', { url });
};

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export const getDelegationStatus = (): {
  enabled: boolean;
  delegationFirst: boolean;
  n8nCacheAvailable: boolean | null;
  tasks: Record<DelegatableTask, { configured: boolean; webhookPath: string }>;
} => {
  const allTasks = Object.keys(WEBHOOK_ENV_MAP) as DelegatableTask[];
  return {
    enabled: readDelegationEnabled(),
    delegationFirst: readDelegationFirst(),
    n8nCacheAvailable: availabilityCache?.available ?? null,
    tasks: Object.fromEntries(
      allTasks.map((task) => {
        const path = readWebhookPath(task);
        return [task, { configured: Boolean(path), webhookPath: path ? '***' : '' }];
      }),
    ) as Record<DelegatableTask, { configured: boolean; webhookPath: string }>,
  };
};

// ─── Response Schema Contracts (documentation export) ─────────────────────────

/**
 * Schema contracts for each delegatable task.
 * n8n workflow authors must return JSON matching these shapes.
 * Used by SCHEMA_VALIDATORS above for runtime validation.
 */
export const DELEGATION_SCHEMA_CONTRACTS: Record<DelegatableTask, { input: string; output: string }> = {
  'news-rss-fetch': {
    input: '{ query: string, limit: number }',
    output: '{ items: Array<{ title: string, link: string, source?: string, pubDate?: string }> }',
  },
  'news-summarize': {
    input: '{ title: string, link: string, description: string }',
    output: '{ summary: string }',
  },
  'news-monitor-candidates': {
    input: '{ limit: number }',
    output: '{ items: Array<{ title: string, link: string, key: string, sourceName?: string, publisherName?: string, publishedAtUnix?: number, lexicalSignature?: string }> }',
  },
  'youtube-feed-fetch': {
    input: '{ channelUrl: string }',
    output: '{ entries: Array<{ id: string, title: string, link: string, published: string, author: string }> }',
  },
  'youtube-community-scrape': {
    input: '{ communityUrl: string }',
    output: '{ id: string, title: string, content: string, link: string, published: string, author: string }',
  },
  'alert-dispatch': {
    input: '{ title: string, message: string, tags: Record<string, string> }',
    output: '(any — response body not validated)',
  },
  'article-context-fetch': {
    input: '{ url: string }',
    output: '{ title: string, description: string }',
  },
};
