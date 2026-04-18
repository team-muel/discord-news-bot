import { parseBooleanEnv, parseBoundedNumberEnv, parseCsvList, parseMinIntEnv, parseStringEnv } from '../../utils/env';
import { getActionRunnerMode } from './actions/policy';
import { EXECUTOR_ACTION_CANONICAL_NAME, normalizeActionNameList } from './actions/types';

export const HIGH_RISK_APPROVAL_ACTIONS: ReadonlySet<string> = new Set(
  normalizeActionNameList(parseCsvList(process.env.HIGH_RISK_APPROVAL_ACTIONS || EXECUTOR_ACTION_CANONICAL_NAME)),
);

export const GATE_VERDICT_ENFORCEMENT_ENABLED = parseBooleanEnv(process.env.GATE_VERDICT_ENFORCEMENT_ENABLED, false);
export const GATE_VERDICT_CACHE_TTL_MS = parseMinIntEnv(process.env.GATE_VERDICT_CACHE_TTL_MS, 5 * 60_000, 30_000);

export const ACTION_RUNNER_ENABLED = parseBooleanEnv(process.env.ACTION_RUNNER_ENABLED, true);
export const ACTION_RETRY_MAX = parseMinIntEnv(process.env.ACTION_RETRY_MAX, 2, 0);
export const ACTION_TIMEOUT_MS = parseMinIntEnv(process.env.ACTION_TIMEOUT_MS, 15_000, 1000);
export const ACTION_CIRCUIT_BREAKER_ENABLED = parseBooleanEnv(process.env.ACTION_CIRCUIT_BREAKER_ENABLED, true);
export const ACTION_CIRCUIT_FAILURE_THRESHOLD = parseMinIntEnv(process.env.ACTION_CIRCUIT_FAILURE_THRESHOLD, 3, 1);
export const ACTION_CIRCUIT_OPEN_MS = parseMinIntEnv(process.env.ACTION_CIRCUIT_OPEN_MS, 60_000, 5_000);
export const ACTION_FINOPS_DEGRADED_RETRY_MAX = parseMinIntEnv(process.env.ACTION_FINOPS_DEGRADED_RETRY_MAX, 1, 0);
export const ACTION_FINOPS_DEGRADED_TIMEOUT_MS = parseMinIntEnv(process.env.ACTION_FINOPS_DEGRADED_TIMEOUT_MS, 8_000, 1000);
export const ACTION_RUNNER_MODE = getActionRunnerMode();
export const ACTION_CACHE_ENABLED = parseBooleanEnv(process.env.ACTION_CACHE_ENABLED, true);
export const ACTION_CACHE_TTL_MS = parseMinIntEnv(process.env.ACTION_CACHE_TTL_MS, 10 * 60_000, 1000);
export const ACTION_CACHE_MAX_ENTRIES = parseMinIntEnv(process.env.ACTION_CACHE_MAX_ENTRIES, 1000, 50);
export const ACTION_GOVERNANCE_FAST_PATH_ENABLED = parseBooleanEnv(process.env.ACTION_GOVERNANCE_FAST_PATH_ENABLED, true);

const defaultGovernanceFastPathActions = [
  'web.search',
  'web.fetch',
  'news.google.search',
  'news.verify',
  'rag.retrieve',
  'community.search',
  'youtube.search.first',
  'db.supabase.read',
];

const configuredGovernanceFastPathActions = parseCsvList(process.env.ACTION_GOVERNANCE_FAST_PATH_ACTIONS || '');

const GOVERNANCE_FAST_PATH_ACTIONS: ReadonlySet<string> = new Set(
  configuredGovernanceFastPathActions.length > 0
    ? configuredGovernanceFastPathActions
    : defaultGovernanceFastPathActions,
);

export const isGovernanceFastPathEligible = (actionName: string): boolean => {
  return ACTION_GOVERNANCE_FAST_PATH_ENABLED && GOVERNANCE_FAST_PATH_ACTIONS.has(actionName);
};

export const ACTION_NEWS_CAPTURE_ENABLED = parseBooleanEnv(process.env.ACTION_NEWS_CAPTURE_ENABLED, true);
export const ACTION_NEWS_CAPTURE_TTL_MS = parseMinIntEnv(process.env.ACTION_NEWS_CAPTURE_TTL_MS, 6 * 60 * 60_000, 60_000);
export const ACTION_NEWS_CAPTURE_MIN_ITEMS = parseBoundedNumberEnv(process.env.ACTION_NEWS_CAPTURE_MIN_ITEMS, 2, 1, 5);
export const ACTION_NEWS_CAPTURE_MAX_AGE_HOURS = parseBoundedNumberEnv(process.env.ACTION_NEWS_CAPTURE_MAX_AGE_HOURS, 72, 6, 720);
export const ACTION_NEWS_CAPTURE_MAX_ITEMS = parseBoundedNumberEnv(process.env.ACTION_NEWS_CAPTURE_MAX_ITEMS, 5, 1, 20);
export const ACTION_NEWS_CAPTURE_SOURCE = parseStringEnv(process.env.ACTION_NEWS_CAPTURE_SOURCE, 'google_news_rss') || 'google_news_rss';
export const FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS = parseMinIntEnv(process.env.FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS, 5 * 60_000, 30_000);

const defaultCacheableActions = [
  'code.generate',
  'rag.retrieve',
  'news.google.search',
  'news.verify',
  'community.search',
  'web.fetch',
  'web.search',
  'youtube.search.first',
  'db.supabase.read',
];

const ACTION_CACHEABLE_ACTION_SET = new Set(parseCsvList(process.env.ACTION_CACHEABLE_ACTIONS));
if (ACTION_CACHEABLE_ACTION_SET.size === 0) {
  for (const actionName of defaultCacheableActions) {
    ACTION_CACHEABLE_ACTION_SET.add(actionName);
  }
}

export const isActionCacheable = (actionName: string): boolean => ACTION_CACHEABLE_ACTION_SET.has(actionName);

export const ACTION_NEWS_CAPTURE_ALLOW_GUILDS: ReadonlySet<string> = new Set(parseCsvList(process.env.ACTION_NEWS_CAPTURE_ALLOW_GUILDS));
export const ACTION_NEWS_CAPTURE_DENY_GUILDS: ReadonlySet<string> = new Set(parseCsvList(process.env.ACTION_NEWS_CAPTURE_DENY_GUILDS));
export const ACTION_NEWS_CAPTURE_DENY_USERS: ReadonlySet<string> = new Set(parseCsvList(process.env.ACTION_NEWS_CAPTURE_DENY_USERS));
export const ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS: ReadonlySet<string> = new Set(
  Array.from(parseCsvList(process.env.ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS))
    .map((domain) => domain.toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''))
    .filter(Boolean),
);