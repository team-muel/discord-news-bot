import crypto from 'crypto';
import {
  buildNewsFingerprint,
  isNewsFingerprinted,
  recordNewsFingerprint,
} from '../news/newsCaptureDedupService';
import { getAction } from './actions/registry';
import { getDynamicAction } from '../workerGeneration/dynamicWorkerRegistry';
import { planActions } from './actions/planner';
import { getActionRunnerMode, isActionAllowed } from './actions/policy';
import { createActionApprovalRequest, getGuildActionPolicy, listGuildAllowedDomains } from './actionGovernanceStore';
import { logActionExecutionEvent } from './actionExecutionLogService';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { TtlCache } from '../../utils/ttlCache';
import { CircuitBreaker } from '../../utils/circuitBreaker';
import { decideFinopsAction, estimateActionExecutionCostUsd, getFinopsBudgetStatus } from '../finopsService';
import { logStructuredError } from '../structuredErrorLogService';
import { normalizeActionInput, normalizeActionResult, toWorkerExecutionError } from '../workerExecution';
import { createMemoryItem } from '../agent/agentMemoryStore';
import { compilePromptGoal } from '../infra/promptCompiler';
import { buildWorkerApprovalGateSnapshot } from '../agent/agentWorkerApprovalGateSnapshotService';
import { setGateProviderProfileOverride } from '../llmClient';
import type { LlmProviderProfile } from '../llmClient';
import logger from '../../logger';
import {
  type FailureDiagnostics,
  type SkillActionResult,
  type ActionRunnerDiagnosticsSnapshot,
  createEmptyDiagnostics,
  classifyFailureCode,
  isExternalUnavailableError,
  updateActionRunnerDiagnostics,
  getActionRunnerDiagnosticsSnapshot,
  recordFailureCode,
} from './actionRunnerDiagnostics';

// Re-export for backward compatibility
export { getActionRunnerDiagnosticsSnapshot, type ActionRunnerDiagnosticsSnapshot } from './actionRunnerDiagnostics';
export type { SkillActionResult, FailureDiagnostics } from './actionRunnerDiagnostics';

/** Actions that require approval_required enforcement regardless of guild policy runMode. */
const HIGH_RISK_APPROVAL_ACTIONS: ReadonlySet<string> = new Set(
  String(process.env.HIGH_RISK_APPROVAL_ACTIONS || 'opencode.execute').split(',').map((s) => s.trim()).filter(Boolean),
);

/**
 * D-06: Sync HIGH_RISK_APPROVAL_ACTIONS to OpenShell network policy YAML.
 * Sends the current high-risk action list as deny-by-default rules to OpenShell policy.set.
 * Returns { synced, actions, error? }. Graceful no-op when OpenShell is unavailable.
 */
export const syncHighRiskActionsToSandboxPolicy = async (): Promise<{ synced: boolean; actions: string[]; error?: string }> => {
  const { executeExternalAction } = await import('../tools/externalAdapterRegistry');
  const actions = [...HIGH_RISK_APPROVAL_ACTIONS];
  if (actions.length === 0) {
    return { synced: false, actions, error: 'no high-risk actions configured' };
  }
  try {
    const policyYaml = [
      '# Auto-synced from HIGH_RISK_APPROVAL_ACTIONS',
      `# Generated: ${new Date().toISOString()}`,
      'network:',
      '  default: deny',
      '  rules:',
      ...actions.map((a) => `    - action: "${a}"\n      network: deny\n      approval_required: true`),
    ].join('\n');
    const result = await executeExternalAction('openshell', 'policy.set', { policy: policyYaml });
    if (result.ok) {
      logger.info('[ACTION-RUNNER] high-risk actions synced to OpenShell policy: %d actions', actions.length);
      return { synced: true, actions };
    }
    return { synced: false, actions, error: result.error || result.summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug('[ACTION-RUNNER] OpenShell policy sync skipped: %s', msg);
    return { synced: false, actions, error: msg };
  }
};

/** Gate verdict enforcement: block execution when latest gate-run overall = 'no-go'. */
const GATE_VERDICT_ENFORCEMENT_ENABLED = parseBooleanEnv(process.env.GATE_VERDICT_ENFORCEMENT_ENABLED, false);
const GATE_VERDICT_CACHE_TTL_MS = Math.max(30_000, parseIntegerEnv(process.env.GATE_VERDICT_CACHE_TTL_MS, 5 * 60_000));
let cachedGateVerdict: Map<string, { overall: string; providerProfileTarget: string | null; fetchedAt: number }> = new Map();

const getLatestGateVerdict = async (guildId: string): Promise<{ overall: string | null; providerProfileTarget: string | null }> => {
  const now = Date.now();
  const cached = cachedGateVerdict.get(guildId);
  if (cached && (now - cached.fetchedAt) < GATE_VERDICT_CACHE_TTL_MS) {
    return { overall: cached.overall, providerProfileTarget: cached.providerProfileTarget };
  }
  try {
    const snapshot = await buildWorkerApprovalGateSnapshot({ guildId });
    const gate = snapshot?.globalArtifacts?.latestGateDecision;
    const overall = gate?.overall || null;
    const providerProfileTarget = (gate as Record<string, unknown> | null)?.providerProfileTarget as string | null ?? null;
    cachedGateVerdict.set(guildId, { overall: overall || 'unknown', providerProfileTarget, fetchedAt: now });
    // Evict oldest entries if map grows too large
    if (cachedGateVerdict.size > 100) {
      const first = cachedGateVerdict.keys().next().value;
      if (first !== undefined) cachedGateVerdict.delete(first);
    }
    return { overall, providerProfileTarget };
  } catch (err) {
    logger.debug('[ACTION-RUNNER] guild-policy lookup failed guildId=%s: %s', guildId, err instanceof Error ? err.message : String(err));
    const cached = cachedGateVerdict.get(guildId);
    return { overall: cached?.overall || null, providerProfileTarget: cached?.providerProfileTarget || null };
  }
};

type GoalActionInput = {
  goal: string;
  guildId: string;
  requestedBy: string;
};

const ACTION_RUNNER_ENABLED = parseBooleanEnv(process.env.ACTION_RUNNER_ENABLED, true);
const ACTION_RETRY_MAX = Math.max(0, parseIntegerEnv(process.env.ACTION_RETRY_MAX, 2));
const ACTION_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_TIMEOUT_MS, 15_000));
const ACTION_CIRCUIT_BREAKER_ENABLED = parseBooleanEnv(process.env.ACTION_CIRCUIT_BREAKER_ENABLED, true);
const ACTION_CIRCUIT_FAILURE_THRESHOLD = Math.max(1, parseIntegerEnv(process.env.ACTION_CIRCUIT_FAILURE_THRESHOLD, 3));
const ACTION_CIRCUIT_OPEN_MS = Math.max(5_000, parseIntegerEnv(process.env.ACTION_CIRCUIT_OPEN_MS, 60_000));
const ACTION_FINOPS_DEGRADED_RETRY_MAX = Math.max(0, parseIntegerEnv(process.env.ACTION_FINOPS_DEGRADED_RETRY_MAX, 1));
const ACTION_FINOPS_DEGRADED_TIMEOUT_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_FINOPS_DEGRADED_TIMEOUT_MS, 8_000));
const ACTION_RUNNER_MODE = getActionRunnerMode();
const ACTION_CACHE_ENABLED = parseBooleanEnv(process.env.ACTION_CACHE_ENABLED, true);
const ACTION_CACHE_TTL_MS = Math.max(1000, parseIntegerEnv(process.env.ACTION_CACHE_TTL_MS, 10 * 60_000));
const ACTION_CACHE_MAX_ENTRIES = Math.max(50, parseIntegerEnv(process.env.ACTION_CACHE_MAX_ENTRIES, 1000));
const ACTION_GOVERNANCE_FAST_PATH_ENABLED = parseBooleanEnv(process.env.ACTION_GOVERNANCE_FAST_PATH_ENABLED, true);

/** Read-only actions that skip guild policy + FinOps + gate-verdict governance. */
const GOVERNANCE_FAST_PATH_ACTIONS: ReadonlySet<string> = new Set(
  String(process.env.ACTION_GOVERNANCE_FAST_PATH_ACTIONS || '').trim()
    ? String(process.env.ACTION_GOVERNANCE_FAST_PATH_ACTIONS).split(',').map((s) => s.trim()).filter(Boolean)
    : [
      'web.search',
      'web.fetch',
      'news.google.search',
      'news.verify',
      'rag.retrieve',
      'community.search',
      'stock.quote',
      'stock.chart',
      'youtube.search.first',
      'db.supabase.read',
      'investment.analysis',
    ],
);

const isGovernanceFastPathEligible = (actionName: string): boolean => {
  return ACTION_GOVERNANCE_FAST_PATH_ENABLED && GOVERNANCE_FAST_PATH_ACTIONS.has(actionName);
};

const ACTION_NEWS_CAPTURE_ENABLED = parseBooleanEnv(process.env.ACTION_NEWS_CAPTURE_ENABLED, true);
const ACTION_NEWS_CAPTURE_TTL_MS = Math.max(60_000, parseIntegerEnv(process.env.ACTION_NEWS_CAPTURE_TTL_MS, 6 * 60 * 60_000));
const ACTION_NEWS_CAPTURE_MIN_ITEMS = Math.max(1, Math.min(5, parseIntegerEnv(process.env.ACTION_NEWS_CAPTURE_MIN_ITEMS, 2)));
const ACTION_NEWS_CAPTURE_MAX_AGE_HOURS = Math.max(6, Math.min(24 * 30, parseIntegerEnv(process.env.ACTION_NEWS_CAPTURE_MAX_AGE_HOURS, 72)));
const ACTION_NEWS_CAPTURE_MAX_ITEMS = Math.max(1, Math.min(20, parseIntegerEnv(process.env.ACTION_NEWS_CAPTURE_MAX_ITEMS, 5)));
const ACTION_NEWS_CAPTURE_SOURCE = String(process.env.ACTION_NEWS_CAPTURE_SOURCE || 'google_news_rss').trim() || 'google_news_rss';
const FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS = Math.max(30_000, parseIntegerEnv(process.env.FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS, 5 * 60_000));
const DEFAULT_CACHEABLE_ACTIONS = [
  'code.generate',
  'rag.retrieve',
  'news.google.search',
  'news.verify',
  'community.search',
  'web.fetch',
  'web.search',
  'youtube.search.first',
  'stock.quote',
  'stock.chart',
  'db.supabase.read',
];
const ACTION_CACHEABLE_ACTION_SET = new Set(
  String(process.env.ACTION_CACHEABLE_ACTIONS || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);
if (ACTION_CACHEABLE_ACTION_SET.size === 0) {
  for (const actionName of DEFAULT_CACHEABLE_ACTIONS) {
    ACTION_CACHEABLE_ACTION_SET.add(actionName);
  }
}

const actionResultCache = new TtlCache<{
  name: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  agentRole?: 'operate' | 'implement' | 'review' | 'architect';
  handoff?: {
    fromAgent: 'operate' | 'implement' | 'review' | 'architect';
    toAgent: 'operate' | 'implement' | 'review' | 'architect';
    reason?: string;
    evidenceId?: string;
  };
}>(ACTION_CACHE_MAX_ENTRIES);

const actionCircuitBreaker = new CircuitBreaker({
  failureThreshold: ACTION_CIRCUIT_FAILURE_THRESHOLD,
  cooldownMs: ACTION_CIRCUIT_OPEN_MS,
  maxEntries: 500,
});

// Per-action utility scores: rolling success rate for planner feedback
const actionUtilityScores = new Map<string, { runs: number; successes: number; lastFailedAt: number }>();
const ACTION_UTILITY_MAX_ACTIONS = 100;

const updateActionUtility = (actionName: string, succeeded: boolean): void => {
  const current = actionUtilityScores.get(actionName) || { runs: 0, successes: 0, lastFailedAt: 0 };
  current.runs += 1;
  if (succeeded) {
    current.successes += 1;
  } else {
    current.lastFailedAt = Date.now();
  }
  actionUtilityScores.set(actionName, current);
  if (actionUtilityScores.size > ACTION_UTILITY_MAX_ACTIONS) {
    const first = actionUtilityScores.keys().next().value;
    if (first !== undefined) actionUtilityScores.delete(first);
  }
};

export const getActionUtilityScore = (actionName: string): { successRate: number; runs: number; recentlyFailed: boolean } => {
  const entry = actionUtilityScores.get(actionName);
  if (!entry || entry.runs === 0) return { successRate: 1, runs: 0, recentlyFailed: false };
  return {
    successRate: entry.successes / entry.runs,
    runs: entry.runs,
    recentlyFailed: (Date.now() - entry.lastFailedAt) < 60_000,
  };
};

let lastFinopsBudgetFetchErrorLogAt = 0;

const getFinopsBudgetStatusSafely = async (guildId: string) => {
  try {
    return await getFinopsBudgetStatus(guildId);
  } catch (error) {
    const now = Date.now();
    if (now - lastFinopsBudgetFetchErrorLogAt >= FINOPS_BUDGET_FETCH_LOG_THROTTLE_MS) {
      lastFinopsBudgetFetchErrorLogAt = now;
      logger.warn(
        '[ACTION-RUNNER] FinOps budget lookup failed; fallback to normal mode (throttled): %s',
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  }
};

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const csvToSet = (value: string): Set<string> => {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

const ACTION_NEWS_CAPTURE_ALLOW_GUILDS = csvToSet(process.env.ACTION_NEWS_CAPTURE_ALLOW_GUILDS || '');
const ACTION_NEWS_CAPTURE_DENY_GUILDS = csvToSet(process.env.ACTION_NEWS_CAPTURE_DENY_GUILDS || '');
const ACTION_NEWS_CAPTURE_DENY_USERS = csvToSet(process.env.ACTION_NEWS_CAPTURE_DENY_USERS || '');
const ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS = new Set(
  Array.from(csvToSet(process.env.ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS || ''))
    .map((domain) => domain.toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''))
    .filter(Boolean),
);

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const isActionCacheable = (actionName: string): boolean => ACTION_CACHEABLE_ACTION_SET.has(actionName);

const buildActionCacheKey = (params: {
  guildId: string;
  actionName: string;
  goal: string;
  args: Record<string, unknown>;
}): string => {
  const goal = compact(params.goal).toLowerCase().slice(0, 500);
  const args = stableStringify(params.args || {});
  return [params.guildId, params.actionName, goal, args].join('|');
};

const extractUrlFromArtifact = (artifact: string): string | null => {
  const lines = String(artifact || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) {
      return line;
    }
  }

  const inline = String(artifact || '').match(/https?:\/\/\S+/i);
  return inline?.[0] || null;
};

type ParsedNewsArtifact = {
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  canonicalUrl: string;
  raw: string;
};

const extractRequestedUserId = (requestedBy: string): string => {
  const text = String(requestedBy || '').trim();
  if (/^\d{6,30}$/.test(text)) {
    return text;
  }
  const match = text.match(/(\d{6,30})/);
  return match?.[1] || '';
};

const normalizeDomain = (hostname: string): string => {
  return String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
};

const canonicalizeUrl = (urlText: string): string => {
  try {
    const url = new URL(urlText);
    const trackingKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
    for (const key of trackingKeys) {
      url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch (err) {
    logger.debug('[ACTION-RUNNER] url-parse fallback: %s', err instanceof Error ? err.message : String(err));
    return urlText.trim();
  }
};

const parsePublishedAt = (metaText: string): string | null => {
  const normalized = String(metaText || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
};

const parseNewsArtifact = (artifact: string): ParsedNewsArtifact | null => {
  const lines = String(artifact || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const url = extractUrlFromArtifact(artifact);
  if (!url) {
    return null;
  }

  let domain = '';
  try {
    domain = normalizeDomain(new URL(url).hostname);
  } catch (err) {
    logger.debug('[ACTION-RUNNER] domain extraction failed url=%s: %s', url?.slice(0, 80), err instanceof Error ? err.message : String(err));
    return null;
  }

  const title = (lines[0] && !/^https?:\/\//i.test(lines[0])) ? lines[0] : `news@${domain}`;
  const metaLine = lines.length >= 3 ? lines[2] : '';
  const publishedAt = parsePublishedAt(metaLine.includes('|') ? metaLine.split('|').pop() || '' : metaLine);

  return {
    title,
    url,
    domain,
    publishedAt,
    canonicalUrl: canonicalizeUrl(url),
    raw: artifact,
  };
};

const isNewsCaptureAllowedByPolicy = async (params: {
  guildId: string;
  requestedBy: string;
}): Promise<boolean> => {
  if (ACTION_NEWS_CAPTURE_ALLOW_GUILDS.size > 0 && !ACTION_NEWS_CAPTURE_ALLOW_GUILDS.has(params.guildId)) {
    return false;
  }
  if (ACTION_NEWS_CAPTURE_DENY_GUILDS.has(params.guildId)) {
    return false;
  }

  const requestedUserId = extractRequestedUserId(params.requestedBy);
  if (requestedUserId && ACTION_NEWS_CAPTURE_DENY_USERS.has(requestedUserId)) {
    return false;
  }

  try {
    const capturePolicy = await getGuildActionPolicy(params.guildId, 'news.capture.external');
    if (!capturePolicy.enabled || capturePolicy.runMode === 'disabled' || capturePolicy.runMode === 'approval_required') {
      return false;
    }
  } catch (err) {
    logger.debug('[ACTION-RUNNER] capture-policy check failed guildId=%s: %s', params.guildId, err instanceof Error ? err.message : String(err));
    return false;
  }

  return true;
};

const captureExternalNewsMemory = async (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  artifacts: string[];
}) => {
  if (!ACTION_NEWS_CAPTURE_ENABLED) {
    return;
  }

  if (!(await isNewsCaptureAllowedByPolicy({ guildId: params.guildId, requestedBy: params.requestedBy }))) {
    return;
  }

  const maxAgeMs = ACTION_NEWS_CAPTURE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const nowMs = Date.now();

  let dbDomains: Set<string> = new Set();
  try {
    const dbDomainList = await listGuildAllowedDomains(params.guildId);
    dbDomains = new Set(dbDomainList);
  } catch (err) {
    logger.debug('[ACTION-RUNNER] domains DB load failed guildId=%s: %s', params.guildId, err instanceof Error ? err.message : String(err));
    return;
  }
  const effectiveDomainFilter = new Set([...ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS, ...dbDomains]);

  const parsed = params.artifacts
    .map((artifact) => parseNewsArtifact(artifact))
    .filter((item): item is ParsedNewsArtifact => Boolean(item))
    .filter((item) => {
      if (effectiveDomainFilter.size === 0) {
        return true;
      }
      for (const allowed of effectiveDomainFilter) {
        if (item.domain === allowed || item.domain.endsWith(`.${allowed}`)) {
          return true;
        }
      }
      return false;
    })
    .filter((item) => {
      if (!item.publishedAt) {
        return true;
      }
      const publishedMs = Date.parse(item.publishedAt);
      if (!Number.isFinite(publishedMs)) {
        return true;
      }
      return (nowMs - publishedMs) <= maxAgeMs;
    });

  const deduped: ParsedNewsArtifact[] = [];
  const seenUrl = new Set<string>();
  const seenTitle = new Set<string>();
  for (const item of parsed) {
    const titleKey = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenUrl.has(item.canonicalUrl) || seenTitle.has(titleKey)) {
      continue;
    }
    seenUrl.add(item.canonicalUrl);
    seenTitle.add(titleKey);
    deduped.push(item);
    if (deduped.length >= ACTION_NEWS_CAPTURE_MAX_ITEMS) {
      break;
    }
  }

  if (deduped.length < ACTION_NEWS_CAPTURE_MIN_ITEMS) {
    return;
  }

  const links = deduped.map((item) => item.canonicalUrl);

  if (links.length === 0) {
    return;
  }

  const fingerprint = buildNewsFingerprint({
    guildId: params.guildId,
    goal: params.goal,
    canonicalUrls: links,
  });
  const digest = fingerprint.slice(0, 16);

  const alreadySeen = await isNewsFingerprinted({
    guildId: params.guildId,
    fingerprint,
    ttlMs: ACTION_NEWS_CAPTURE_TTL_MS,
  });
  if (alreadySeen) {
    return;
  }

  const uniqueDomains = new Set(deduped.map((item) => item.domain)).size;
  const freshWithin24h = deduped.filter((item) => {
    if (!item.publishedAt) {
      return false;
    }
    const ts = Date.parse(item.publishedAt);
    return Number.isFinite(ts) && (nowMs - ts) <= 24 * 60 * 60 * 1000;
  }).length;
  const diversityScore = uniqueDomains / Math.max(1, deduped.length);
  const freshnessScore = freshWithin24h / Math.max(1, deduped.length);
  const coverageScore = Math.min(1, deduped.length / ACTION_NEWS_CAPTURE_MAX_ITEMS);
  const qualityScore = Math.max(0, Math.min(1, 0.4 * coverageScore + 0.35 * diversityScore + 0.25 * freshnessScore));
  const confidence = Math.max(0.45, Math.min(0.85, 0.5 + qualityScore * 0.3));

  const compactGoal = params.goal.replace(/\s+/g, ' ').trim().slice(0, 90) || '외부 뉴스';
  const content = [
    `query: ${compactGoal}`,
    `source: ${ACTION_NEWS_CAPTURE_SOURCE}`,
    `quality_score: ${qualityScore.toFixed(3)}`,
    `unique_domains: ${uniqueDomains}`,
    `fresh_within_24h: ${freshWithin24h}`,
    'items:',
    ...deduped.map((item) => `- ${item.raw.replace(/\r?\n/g, ' | ')}`),
  ].join('\n');

  try {
    await createMemoryItem({
      guildId: params.guildId,
      type: 'semantic',
      title: `외부뉴스: ${compactGoal}`,
      content,
      tags: [
        'external-news',
        'google-news',
        'auto-captured',
        `quality:${Math.round(qualityScore * 100)}`,
        `domains:${uniqueDomains}`,
        `dedupe:${digest}`,
      ],
      confidence,
      actorId: String(params.requestedBy || 'system:action-runner'),
      source: {
        sourceKind: 'system',
        sourceRef: links[0],
        excerpt: deduped[0]?.raw.slice(0, 500) || undefined,
      },
    });
    await recordNewsFingerprint({
      guildId: params.guildId,
      fingerprint,
      goal: params.goal,
      ttlMs: ACTION_NEWS_CAPTURE_TTL_MS,
    });
  } catch (err) {
    logger.debug('[ACTION-RUNNER] news memory-persist failed: %s', err instanceof Error ? err.message : String(err));
  }
};

const isCircuitOpen = (actionName: string): boolean => {
  if (!ACTION_CIRCUIT_BREAKER_ENABLED) return false;
  return actionCircuitBreaker.isOpen(actionName);
};

const recordSuccess = (actionName: string) => {
  updateActionUtility(actionName, true);
  if (ACTION_CIRCUIT_BREAKER_ENABLED) actionCircuitBreaker.recordSuccess(actionName);
};

const recordFailure = (actionName: string) => {
  updateActionUtility(actionName, false);
  if (ACTION_CIRCUIT_BREAKER_ENABLED) actionCircuitBreaker.recordFailure(actionName);
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('ACTION_TIMEOUT')), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const runGoalActions = async (input: GoalActionInput): Promise<SkillActionResult> => {
  const diagnostics = createEmptyDiagnostics();

  const finish = (result: SkillActionResult): SkillActionResult => {
    updateActionRunnerDiagnostics(result);
    return result;
  };

  const recordFailureCategory = (code: string | undefined) => {
    diagnostics.totalFailures += 1;
    const normalizedCode = String(code || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    recordFailureCode(normalizedCode);
    const key = classifyFailureCode(normalizedCode);
    diagnostics[key] += 1;
  };

  if (!ACTION_RUNNER_ENABLED) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  // M-04/M-07: Gate verdict enforcement — block execution when latest gate = no-go
  if (GATE_VERDICT_ENFORCEMENT_ENABLED) {
    const gate = await getLatestGateVerdict(input.guildId);
    if (gate.overall === 'no-go') {
      recordFailureCategory('GATE_VERDICT_NO_GO');
      logger.warn('[ACTION-RUNNER] execution blocked by no-go gate verdict guild=%s', input.guildId);
      return finish({
        handled: true,
        output: 'go/no-go 게이트 verdict가 no-go이므로 실행이 차단되었습니다. 게이트 통과 후 재시도하세요.',
        hasSuccess: false,
        externalUnavailable: false,
        diagnostics,
      });
    }
    // M-06/M-07: Auto-regression — apply gate-recommended provider profile
    const profileTarget = gate.providerProfileTarget;
    if (profileTarget === 'cost-optimized' || profileTarget === 'quality-optimized') {
      setGateProviderProfileOverride(profileTarget as LlmProviderProfile);
    }
  }

  const compiledPrompt = compilePromptGoal(input.goal);
  const planningGoal = compiledPrompt.compiledGoal || input.goal;
  const executionGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || input.goal;

  const chain = await planActions(planningGoal);
  if (!chain.actions || chain.actions.length === 0) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  const lines: string[] = ['요청 결과'];
  if (compiledPrompt.droppedNoise || compiledPrompt.intentTags.length > 0 || compiledPrompt.directives.length > 0) {
    lines.push([
      '[프롬프트 컴파일]',
      `- dropped_noise=${compiledPrompt.droppedNoise ? 'true' : 'false'}`,
      `- intent_tags=${compiledPrompt.intentTags.join(',') || 'none'}`,
      `- directives=${compiledPrompt.directives.join(',') || 'none'}`,
    ].join('\n'));
  }
  let handledAny = false;
  let hasSuccess = false;
  let externalUnavailable = false;
  const budget = await getFinopsBudgetStatusSafely(input.guildId);
  const finopsMode = budget?.mode || 'normal';
  if (budget?.enabled) {
    lines.push(`FinOps 모드: ${budget.mode} (daily=${budget.daily.spendUsd.toFixed(4)}/${budget.daily.budgetUsd.toFixed(2)}, monthly=${budget.monthly.spendUsd.toFixed(4)}/${budget.monthly.budgetUsd.toFixed(2)})`);
  }

  for (const planned of chain.actions) {
    if (budget?.enabled && !isGovernanceFastPathEligible(planned.actionName)) {
      const finopsDecision = decideFinopsAction({
        budget,
        actionName: planned.actionName,
      });

      if (!finopsDecision.allow) {
        recordFailureCategory(finopsDecision.reason);
        lines.push(`액션: ${planned.actionName}`);
        lines.push(`상태: 실패 (${finopsDecision.reason})`);
        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: planned.actionName,
          ok: false,
          summary: 'FinOps 예산 가드레일에 의해 실행이 차단되었습니다.',
          artifacts: [],
          verification: ['finops guardrail block'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          error: finopsDecision.reason,
          estimatedCostUsd: 0,
          finopsMode,
        });
        continue;
      }
    }

    if (!isActionAllowed(planned.actionName)) {
      recordFailureCategory('ACTION_NOT_ALLOWED');
      lines.push(`액션: ${planned.actionName}`);
      lines.push('상태: 실패 (ACTION_NOT_ALLOWED)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: planned.actionName,
        ok: false,
        summary: '정책 allowlist에 없는 액션입니다.',
        artifacts: [],
        verification: ['action allowlist policy block'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_NOT_ALLOWED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    const action = getAction(planned.actionName) ?? getDynamicAction(planned.actionName);
    if (!action) {
      recordFailureCategory('ACTION_NOT_IMPLEMENTED');
      lines.push(`액션: ${planned.actionName}`);
      lines.push('상태: 실패 (ACTION_NOT_IMPLEMENTED)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: planned.actionName,
        ok: false,
        summary: '요청된 액션이 아직 구현되지 않았습니다.',
        artifacts: [],
        verification: ['action registry lookup miss'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_NOT_IMPLEMENTED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      externalUnavailable = true;
      continue;
    }

    // Governance fast-path: read-only actions skip guild policy / FinOps / approval gates.
    const fastPath = isGovernanceFastPathEligible(action.name);

    if (!fastPath) {
    let governance;
    try {
      governance = await getGuildActionPolicy(input.guildId, action.name);
    } catch (err) {
      logger.warn('[ACTION-RUNNER] action-governance failed action=%s guildId=%s: %s', action.name, input.guildId, err instanceof Error ? err.message : String(err));
      recordFailureCategory('ACTION_POLICY_UNAVAILABLE');
      lines.push(`액션: ${action.name}`);
      lines.push('상태: 실패 (ACTION_POLICY_UNAVAILABLE)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '길드 액션 정책 조회 실패로 실행이 차단되었습니다.',
        artifacts: [],
        verification: ['tenant action policy unavailable'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_POLICY_UNAVAILABLE',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    if (!governance.enabled || governance.runMode === 'disabled') {
      recordFailureCategory('ACTION_DISABLED_BY_POLICY');
      lines.push(`액션: ${action.name}`);
      lines.push('상태: 실패 (ACTION_DISABLED_BY_POLICY)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '길드 액션 정책에서 비활성화된 액션입니다.',
        artifacts: [],
        verification: ['tenant action policy disabled'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_DISABLED_BY_POLICY',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    const autoApprovalRequired = action.name === 'privacy.forget.guild'
      && !String(input.requestedBy || '').startsWith('system:');
    const highRiskActionGuard = HIGH_RISK_APPROVAL_ACTIONS.has(action.name)
      && governance.runMode === 'auto';
    const effectiveRunMode = (autoApprovalRequired || highRiskActionGuard)
      ? 'approval_required'
      : governance.runMode;

    if (effectiveRunMode === 'approval_required') {
      recordFailureCategory('ACTION_APPROVAL_REQUIRED');
      handledAny = true;
      const request = await createActionApprovalRequest({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        actionArgs: planned.args || {},
        reason: autoApprovalRequired
          ? 'high-risk action guard: privacy.forget.guild'
          : highRiskActionGuard
            ? `high-risk action guard: ${action.name}`
            : 'action policy run_mode=approval_required',
      });

      lines.push(`액션: ${action.name}`);
      lines.push(`상태: 승인 대기 (requestId=${request.id})`);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '승인 게이트에 의해 실행이 보류되었습니다.',
        artifacts: [request.id],
        verification: ['tenant action policy approval_required'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_APPROVAL_REQUIRED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }
    } // end !fastPath governance block

    handledAny = true;

    if (ACTION_RUNNER_MODE === 'dry-run') {
      lines.push(`액션: ${action.name}`);
      lines.push('상태: DRY_RUN (실행 생략)');
      lines.push(`계획 인자: ${JSON.stringify(planned.args || {})}`);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: true,
        summary: 'dry-run 모드로 실제 실행은 생략되었습니다.',
        artifacts: [JSON.stringify(planned.args || {})],
        verification: ['runner dry-run mode'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        estimatedCostUsd: 0,
        finopsMode,
      });
      hasSuccess = true;
      continue;
    }

    if (isCircuitOpen(action.name)) {
      recordFailureCategory('CIRCUIT_OPEN');
      const message = `상태: 실패 (CIRCUIT_OPEN)`;
      lines.push(`액션: ${action.name}`);
      lines.push(message);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '회로차단기로 실행이 차단되었습니다.',
        artifacts: [],
        verification: ['circuit breaker open'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: true,
        error: 'CIRCUIT_OPEN',
        estimatedCostUsd: 0,
        finopsMode,
      });
      continue;
    }

    let attempt = 0;
    let final: {
      ok: boolean;
      name: string;
      summary: string;
      artifacts: string[];
      verification: string[];
      error?: string;
      durationMs?: number;
      agentRole?: 'operate' | 'implement' | 'review' | 'architect';
      handoff?: {
        fromAgent: 'operate' | 'implement' | 'review' | 'architect';
        toAgent: 'operate' | 'implement' | 'review' | 'architect';
        reason?: string;
        evidenceId?: string;
      };
    } | null = null;
    const startedAt = Date.now();

    const effectiveRetryMax = finopsMode === 'degraded'
      ? Math.min(ACTION_RETRY_MAX, ACTION_FINOPS_DEGRADED_RETRY_MAX)
      : ACTION_RETRY_MAX;
    const effectiveTimeoutMs = finopsMode === 'degraded'
      ? Math.min(ACTION_TIMEOUT_MS, ACTION_FINOPS_DEGRADED_TIMEOUT_MS)
      : ACTION_TIMEOUT_MS;

    const cacheEligible = ACTION_CACHE_ENABLED && isActionCacheable(action.name);
    const cacheKey = cacheEligible
      ? buildActionCacheKey({
        guildId: input.guildId,
        actionName: action.name,
        goal: executionGoal,
        args: planned.args || {},
      })
      : '';

    if (cacheEligible && cacheKey) {
      const cached = actionResultCache.get(cacheKey);
      if (cached) {
        lines.push(`액션: ${cached.name}`);
        lines.push(`${cached.summary} (cache hit)`);
        lines.push(cached.artifacts.length > 0 ? `산출물:\n${cached.artifacts.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
        lines.push(cached.verification.length > 0
          ? `검증:\n${[...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'].map((line) => `- ${line}`).join('\n')}`
          : `검증:\n- cache_ttl_ms=${ACTION_CACHE_TTL_MS}\n- cache_hit=true`);
        lines.push('재시도 횟수: 0');
        lines.push('소요시간(ms): 0');
        lines.push('상태: 성공');

        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: cached.name,
          ok: true,
          summary: `${cached.summary} (cache hit)`,
          artifacts: cached.artifacts,
          verification: [...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          estimatedCostUsd: 0,
          finopsMode,
          agentRole: cached.agentRole,
          handoff: cached.handoff,
        });

        hasSuccess = true;

        continue;
      }
    }

    while (attempt <= effectiveRetryMax) {
      attempt += 1;
      final = await withTimeout(Promise.resolve().then(() => {
        const executionInput = normalizeActionInput({
          actionName: action.name,
          input: {
            goal: executionGoal,
            args: planned.args,
            guildId: input.guildId,
            requestedBy: input.requestedBy,
          },
        });
        return action.execute(executionInput);
      }), effectiveTimeoutMs)
        .then((result) => normalizeActionResult({ actionName: action.name, result }))
        .catch(async (error) => {
          const normalized = toWorkerExecutionError(error, 'UNKNOWN_ERROR');
          await logStructuredError({
            code: normalized.code,
            source: 'skills.actionRunner.execute',
            message: normalized.message,
            guildId: input.guildId,
            actionName: action.name,
            meta: {
              retryable: normalized.retryable,
              attempt,
              retryMax: effectiveRetryMax,
              ...(normalized.meta || {}),
            },
            severity: normalized.retryable ? 'warn' : 'error',
          }, error);

          const message = normalized.code || normalized.message;
          const verification = [`error_code=${normalized.code}`];
          if (!normalized.retryable) {
            verification.push('retryable=false');
          }

        return {
          ok: false,
          name: action.name,
          summary: '액션 실행 실패',
          artifacts: [],
            verification,
          error: message,
        };
        });

      if (final.ok) {
        break;
      }

      const shouldStopRetry = final.error === 'ACTION_INPUT_INVALID'
        || final.error === 'ACTION_RESULT_INVALID';
      if (shouldStopRetry) {
        break;
      }
    }

    const durationMs = Date.now() - startedAt;
    if (!final) {
      continue;
    }
    final.durationMs = durationMs;

    if (final.ok) {
      recordSuccess(action.name);
      hasSuccess = true;
      if (final.name === 'news.google.search') {
        await captureExternalNewsMemory({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: executionGoal,
          artifacts: final.artifacts,
        });
      }
      if (cacheEligible && cacheKey) {
        actionResultCache.set(cacheKey, {
          name: final.name,
          summary: final.summary,
          artifacts: [...(final.artifacts || [])],
          verification: [...(final.verification || [])],
          agentRole: final.agentRole,
          handoff: final.handoff,
        }, ACTION_CACHE_TTL_MS);
      }
    } else {
      recordFailure(action.name);
      recordFailureCategory(final.error);
      if (isExternalUnavailableError(final.error)) {
        externalUnavailable = true;
      }
    }

    lines.push(`액션: ${final.name}`);
    lines.push(final.summary);
    lines.push(final.artifacts.length > 0 ? `산출물:\n${final.artifacts.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
    lines.push(final.verification.length > 0 ? `검증:\n${final.verification.map((line) => `- ${line}`).join('\n')}` : '검증: 없음');
    lines.push(`재시도 횟수: ${Math.max(0, attempt - 1)}`);
    lines.push(`소요시간(ms): ${durationMs}`);
    lines.push(final.ok ? '상태: 성공' : `상태: 실패 (${final.error || 'UNKNOWN'})`);

    const estimatedCostUsd = estimateActionExecutionCostUsd({
      ok: final.ok,
      retryCount: Math.max(0, attempt - 1),
      durationMs,
    });

    await logActionExecutionEvent({
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      goal: input.goal,
      actionName: final.name,
      ok: final.ok,
      summary: final.summary,
      artifacts: final.artifacts,
      verification: final.verification,
      durationMs,
      retryCount: Math.max(0, attempt - 1),
      circuitOpen: false,
      error: final.error,
      estimatedCostUsd,
      finopsMode,
      agentRole: final.agentRole,
      handoff: final.handoff,
    });
  }

  if (!handledAny) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  if (diagnostics.totalFailures > 0) {
    lines.push('[실패 진단]');
    lines.push(`total=${diagnostics.totalFailures}`);
    lines.push(`missing_action=${diagnostics.missingAction}`);
    lines.push(`policy_blocked=${diagnostics.policyBlocked}`);
    lines.push(`governance_unavailable=${diagnostics.governanceUnavailable}`);
    lines.push(`finops_blocked=${diagnostics.finopsBlocked}`);
    lines.push(`external_failures=${diagnostics.externalFailures}`);
    lines.push(`unknown_failures=${diagnostics.unknownFailures}`);
  }

  return finish({
    handled: true,
    output: lines.filter(Boolean).join('\n\n'),
    hasSuccess,
    externalUnavailable,
    diagnostics,
  });
};

// ─── Pipeline-aware Execution (Judgment Loop) ─────────────────────────────────

import {
  executePipeline,
  actionChainToPipelinePlan,
  createPipelineContext,
  type PipelineResult,
  type PipelineStep,
  type PipelineContext as PipelineCtx,
  type StepExecutor,
} from './pipelineEngine';
import {
  generateSessionId,
  createWorkflowSession,
  updateWorkflowSessionStatus,
  insertWorkflowStep,
  updateWorkflowStep,
  recordWorkflowEvent,
} from '../workflow/workflowPersistenceService';

const PIPELINE_MODE_ENABLED = parseBooleanEnv(process.env.PIPELINE_MODE_ENABLED, false);

/**
 * Pipeline-aware goal execution — upgrade of `runGoalActions` with:
 * - Inter-action data flow (A's output feeds B's input)
 * - Conditional branching based on intermediate results
 * - Mid-execution replanning on failure
 * - Parallel execution of independent actions
 * - Full workflow persistence to Supabase
 *
 * Falls back to `runGoalActions` when PIPELINE_MODE_ENABLED=false.
 */
export const runGoalPipeline = async (input: GoalActionInput): Promise<SkillActionResult> => {
  if (!PIPELINE_MODE_ENABLED) {
    return runGoalActions(input);
  }

  const diagnostics = createEmptyDiagnostics();

  if (!ACTION_RUNNER_ENABLED) {
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    };
  }

  const sessionId = generateSessionId();

  // Persist workflow session
  await createWorkflowSession({
    sessionId,
    workflowName: 'goal-pipeline',
    stage: 'planning',
    scope: input.guildId,
    status: 'proposed',
  });

  await recordWorkflowEvent({
    sessionId,
    eventType: 'session_start',
    toState: 'proposed',
    decisionReason: `Goal: ${input.goal.slice(0, 200)}`,
    payload: { guildId: input.guildId, requestedBy: input.requestedBy },
  });

  // Plan actions
  const compiledPrompt = compilePromptGoal(input.goal);
  const planningGoal = compiledPrompt.compiledGoal || input.goal;
  const executionGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || input.goal;

  const chain = await planActions(planningGoal);
  if (!chain.actions || chain.actions.length === 0) {
    await updateWorkflowSessionStatus(sessionId, 'failed', true);
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    };
  }

  await updateWorkflowSessionStatus(sessionId, 'executing');
  await recordWorkflowEvent({
    sessionId,
    eventType: 'state_transition',
    fromState: 'proposed',
    toState: 'executing',
    decisionReason: `Planned ${chain.actions.length} actions`,
  });

  // Convert planner output to pipeline plan
  const plan = actionChainToPipelinePlan(chain.actions);
  const ctx = createPipelineContext({
    goal: executionGoal,
    guildId: input.guildId,
    requestedBy: input.requestedBy,
  });

  // Step executor: bridges pipeline engine to existing action execution logic
  const stepExecutor: StepExecutor = async (actionName, args, pipeCtx) => {
    const action = getAction(actionName) ?? getDynamicAction(actionName);
    if (!action) {
      return {
        ok: false,
        name: actionName,
        summary: 'ACTION_NOT_IMPLEMENTED',
        artifacts: [],
        verification: [],
        error: 'ACTION_NOT_IMPLEMENTED',
      };
    }

    if (!isActionAllowed(actionName)) {
      return {
        ok: false,
        name: actionName,
        summary: 'ACTION_NOT_ALLOWED',
        artifacts: [],
        verification: [],
        error: 'ACTION_NOT_ALLOWED',
      };
    }

    if (isCircuitOpen(actionName)) {
      return {
        ok: false,
        name: actionName,
        summary: 'CIRCUIT_OPEN',
        artifacts: [],
        verification: [],
        error: 'CIRCUIT_OPEN',
      };
    }

    const executionInput = normalizeActionInput({
      actionName: action.name,
      input: {
        goal: pipeCtx.goal,
        args,
        guildId: pipeCtx.guildId,
        requestedBy: pipeCtx.requestedBy,
      },
    });

    const effectiveTimeoutMs = ACTION_TIMEOUT_MS;

    try {
      const result = await withTimeout(
        Promise.resolve(action.execute(executionInput)),
        effectiveTimeoutMs,
      ).then((r) => normalizeActionResult({ actionName: action.name, result: r }));

      if (result.ok) {
        recordSuccess(action.name);
      } else {
        recordFailure(action.name);
      }
      return result;
    } catch (error) {
      recordFailure(action.name);
      const normalized = toWorkerExecutionError(error, 'UNKNOWN_ERROR');
      return {
        ok: false,
        name: action.name,
        summary: 'Action execution failed',
        artifacts: [],
        verification: [`error_code=${normalized.code}`],
        error: normalized.code || normalized.message,
      };
    }
  };

  // Replanner: re-invokes the LLM planner with context about what failed
  const replanner = async (replanGoal: string, _pipeCtx: PipelineCtx): Promise<PipelineStep[]> => {
    try {
      const replanChain = await planActions(replanGoal);
      if (!replanChain.actions || replanChain.actions.length === 0) return [];

      await recordWorkflowEvent({
        sessionId,
        eventType: 'replan',
        decisionReason: replanGoal.slice(0, 500),
        payload: { newActionCount: replanChain.actions.length },
      });

      return replanChain.actions.map((a, i) => ({
        name: `replan-step-${i + 1}-${a.actionName}`,
        type: 'action' as const,
        actionName: a.actionName,
        args: a.args,
        reason: a.reason,
        pipeOutput: true,
      }));
    } catch (err) {
      logger.debug('[ACTION-RUNNER] pipeline-build replan failed: %s', err instanceof Error ? err.message : String(err));
      return [];
    }
  };

  // Execute pipeline
  const pipelineResult = await executePipeline(plan, stepExecutor, replanner, ctx);

  // Persist each step result
  for (let i = 0; i < pipelineResult.steps.length; i++) {
    const step = pipelineResult.steps[i];
    await insertWorkflowStep({
      sessionId,
      stepOrder: i + 1,
      stepName: step.stepName,
      agentRole: step.agentRole,
      status: step.ok ? 'passed' : 'failed',
      durationMs: step.durationMs,
      details: {
        type: step.stepType,
        error: step.error,
        outputCount: step.output.length,
        artifactCount: step.artifacts.length,
      },
    });

    // Log to execution log for continuity with existing diagnostics
    await logActionExecutionEvent({
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      goal: input.goal,
      actionName: step.stepName,
      ok: step.ok,
      summary: step.ok ? 'Pipeline step passed' : `Pipeline step failed: ${step.error || 'unknown'}`,
      artifacts: step.artifacts,
      verification: [`pipeline_session=${sessionId}`, `step_type=${step.stepType}`],
      durationMs: step.durationMs,
      retryCount: 0,
      circuitOpen: false,
      error: step.error,
      estimatedCostUsd: 0,
      finopsMode: 'normal',
      agentRole: step.agentRole,
    });
  }

  // Finalize session
  const finalStatus = pipelineResult.ok ? 'released' : 'failed';
  await updateWorkflowSessionStatus(sessionId, finalStatus, true);
  await recordWorkflowEvent({
    sessionId,
    eventType: 'session_complete',
    fromState: 'executing',
    toState: finalStatus,
    decisionReason: pipelineResult.ok
      ? `Pipeline completed: ${pipelineResult.steps.length} steps`
      : `Pipeline failed: ${pipelineResult.steps.filter((s) => !s.ok).length} failed steps`,
    payload: {
      totalDurationMs: pipelineResult.totalDurationMs,
      replanned: pipelineResult.replanned,
      replanCount: pipelineResult.replanCount,
    },
  });

  // Build output
  const lines: string[] = ['파이프라인 실행 결과'];
  lines.push(`세션: ${sessionId}`);
  lines.push(`총 단계: ${pipelineResult.steps.length}`);
  lines.push(`소요시간: ${pipelineResult.totalDurationMs}ms`);
  if (pipelineResult.replanned) {
    lines.push(`재계획: ${pipelineResult.replanCount}회`);
  }

  for (const step of pipelineResult.steps) {
    lines.push(`\n[${step.stepName}] ${step.ok ? '성공' : '실패'} (${step.durationMs}ms)`);
    if (step.artifacts.length > 0) {
      lines.push(`산출물:\n${step.artifacts.map((a) => `- ${a}`).join('\n')}`);
    }
    if (step.error) {
      lines.push(`오류: ${step.error}`);
    }
  }

  const hasSuccess = pipelineResult.steps.some((s) => s.ok);
  const failedSteps = pipelineResult.steps.filter((s) => !s.ok);
  for (const f of failedSteps) {
    diagnostics.totalFailures += 1;
    const key = classifyFailureCode(f.error);
    diagnostics[key] += 1;
  }

  const result: SkillActionResult = {
    handled: true,
    output: lines.filter(Boolean).join('\n'),
    hasSuccess,
    externalUnavailable: failedSteps.some((s) => isExternalUnavailableError(s.error)),
    diagnostics,
  };

  updateActionRunnerDiagnostics(result);
  return result;
};
