import { createMemoryItem } from '../agent';
import { buildNewsFingerprint, isNewsFingerprinted, recordNewsFingerprint } from '../news';
import { getGuildActionPolicy, listGuildAllowedDomains } from './actionGovernanceStore';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  ACTION_NEWS_CAPTURE_ALLOW_GUILDS,
  ACTION_NEWS_CAPTURE_ALLOWED_DOMAINS,
  ACTION_NEWS_CAPTURE_DENY_GUILDS,
  ACTION_NEWS_CAPTURE_DENY_USERS,
  ACTION_NEWS_CAPTURE_ENABLED,
  ACTION_NEWS_CAPTURE_MAX_AGE_HOURS,
  ACTION_NEWS_CAPTURE_MAX_ITEMS,
  ACTION_NEWS_CAPTURE_MIN_ITEMS,
  ACTION_NEWS_CAPTURE_SOURCE,
  ACTION_NEWS_CAPTURE_TTL_MS,
} from './actionRunnerConfig';
import { parseNewsArtifact, type ParsedNewsArtifact } from './actionRunnerArtifacts';

export type ExternalNewsCaptureParams = {
  guildId: string;
  requestedBy: string;
  goal: string;
  artifacts: string[];
};

export type ExternalNewsCaptureDeps = {
  now?: () => number;
  getGuildActionPolicy?: typeof getGuildActionPolicy;
  listGuildAllowedDomains?: typeof listGuildAllowedDomains;
  createMemoryItem?: typeof createMemoryItem;
  buildNewsFingerprint?: typeof buildNewsFingerprint;
  isNewsFingerprinted?: typeof isNewsFingerprinted;
  recordNewsFingerprint?: typeof recordNewsFingerprint;
};

const extractRequestedUserId = (requestedBy: string): string => {
  const text = String(requestedBy || '').trim();
  if (/^\d{6,30}$/.test(text)) {
    return text;
  }
  const match = text.match(/(\d{6,30})/);
  return match?.[1] || '';
};

const isNewsCaptureAllowedByPolicy = async (
  params: Pick<ExternalNewsCaptureParams, 'guildId' | 'requestedBy'>,
  deps: Required<Pick<ExternalNewsCaptureDeps, 'getGuildActionPolicy'>>,
): Promise<boolean> => {
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
    const capturePolicy = await deps.getGuildActionPolicy(params.guildId, 'news.capture.external');
    if (!capturePolicy.enabled || capturePolicy.runMode === 'disabled' || capturePolicy.runMode === 'approval_required') {
      return false;
    }
  } catch (err) {
    logger.debug('[ACTION-RUNNER] capture-policy check failed guildId=%s: %s', params.guildId, getErrorMessage(err));
    return false;
  }

  return true;
};

export const captureExternalNewsMemory = async (
  params: ExternalNewsCaptureParams,
  deps: ExternalNewsCaptureDeps = {},
): Promise<void> => {
  if (!ACTION_NEWS_CAPTURE_ENABLED) {
    return;
  }

  const getGuildActionPolicyFn = deps.getGuildActionPolicy ?? getGuildActionPolicy;
  const listGuildAllowedDomainsFn = deps.listGuildAllowedDomains ?? listGuildAllowedDomains;
  const createMemoryItemFn = deps.createMemoryItem ?? createMemoryItem;
  const buildNewsFingerprintFn = deps.buildNewsFingerprint ?? buildNewsFingerprint;
  const isNewsFingerprintedFn = deps.isNewsFingerprinted ?? isNewsFingerprinted;
  const recordNewsFingerprintFn = deps.recordNewsFingerprint ?? recordNewsFingerprint;
  const now = deps.now ?? Date.now;

  if (!(await isNewsCaptureAllowedByPolicy(
    { guildId: params.guildId, requestedBy: params.requestedBy },
    { getGuildActionPolicy: getGuildActionPolicyFn },
  ))) {
    return;
  }

  const maxAgeMs = ACTION_NEWS_CAPTURE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const nowMs = now();

  let dbDomains: Set<string> = new Set();
  try {
    const dbDomainList = await listGuildAllowedDomainsFn(params.guildId);
    dbDomains = new Set(dbDomainList);
  } catch (err) {
    logger.debug('[ACTION-RUNNER] domains DB load failed guildId=%s: %s', params.guildId, getErrorMessage(err));
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

  const fingerprint = buildNewsFingerprintFn({
    guildId: params.guildId,
    goal: params.goal,
    canonicalUrls: links,
  });
  const digest = fingerprint.slice(0, 16);

  const alreadySeen = await isNewsFingerprintedFn({
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
    await createMemoryItemFn({
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
    await recordNewsFingerprintFn({
      guildId: params.guildId,
      fingerprint,
      goal: params.goal,
      ttlMs: ACTION_NEWS_CAPTURE_TTL_MS,
    });
  } catch (err) {
    logger.debug('[ACTION-RUNNER] news memory-persist failed: %s', getErrorMessage(err));
  }
};