import path from 'node:path';
import type { WorkflowArtifactPlane, WorkflowArtifactRef, WorkflowArtifactRefKind, WorkflowGithubSettlementKind } from '../workflow';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import { parseActionReflectionArtifact } from './actions/types';

export type ParsedNewsArtifact = {
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  canonicalUrl: string;
  raw: string;
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

export const formatActionArtifactsForDisplay = (artifacts: string[]): {
  artifactLines: string[];
  reflectionLines: string[];
} => {
  const artifactLines: string[] = [];
  const reflectionLines: string[] = [];

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const reflection = parseActionReflectionArtifact(artifact);
    if (!reflection) {
      artifactLines.push(artifact);
      continue;
    }

    reflectionLines.push(`plane=${reflection.plane}`);
    reflectionLines.push(`concern=${reflection.concern}`);
    reflectionLines.push(`next_path=${reflection.nextPath}`);
    reflectionLines.push(`customer_impact=${reflection.customerImpact}`);
  }

  return {
    artifactLines,
    reflectionLines,
  };
};

const normalizeArtifactLocator = (value: string): string => String(value || '').trim().replace(/\\/g, '/');

const looksLikePathArtifact = (value: string): boolean => {
  const normalized = normalizeArtifactLocator(value);
  if (!normalized || /\r|\n/.test(normalized)) {
    return false;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return false;
  }
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) {
    return true;
  }
  return /^(src|docs|plans|ops|guilds|chat|retros|tmp|config|scripts)\/.+/.test(normalized)
    || /^[^\s]+\/(?:[^\s].*)\.[A-Za-z0-9]{1,10}$/.test(normalized);
};

const inferWorkflowArtifactRefKind = (locator: string): WorkflowArtifactRefKind => {
  const normalized = normalizeArtifactLocator(locator).toLowerCase();
  if (/^https?:\/\//.test(normalized)) {
    return 'url';
  }
  if (normalized.startsWith('workflow session:') || normalized.startsWith('supabase:') || normalized.startsWith('local-file:')) {
    return 'workflow-session';
  }
  if (normalized.endsWith('.log') || /(^|\/)(logs?|tmp)\//.test(normalized)) {
    return 'log';
  }
  if (normalized.endsWith('.md') && (/^\/vault\//.test(normalized) || /^(chat|guilds|ops|plans|retros)\//.test(normalized))) {
    return 'vault-note';
  }
  if (/^[0-9a-f]{7,40}$/i.test(normalized) || normalized.startsWith('branch:')) {
    return 'git-ref';
  }
  if (looksLikePathArtifact(normalized)) {
    return 'repo-file';
  }
  return 'other';
};

const inferWorkflowArtifactPlane = (locator: string, refKind: WorkflowArtifactRefKind): WorkflowArtifactPlane | undefined => {
  const normalized = normalizeArtifactLocator(locator).toLowerCase();
  if (refKind === 'repo-file' || refKind === 'git-ref') {
    return 'github';
  }
  if (refKind === 'vault-note') {
    return 'obsidian';
  }
  if (refKind === 'workflow-session' || refKind === 'log') {
    return 'hot-state';
  }
  if (refKind === 'url') {
    return /^https?:\/\/(www\.)?(github\.com|raw\.githubusercontent\.com)\//.test(normalized)
      ? 'github'
      : 'external';
  }
  return normalized ? 'other' : undefined;
};

const inferWorkflowGithubSettlementKind = (
  locator: string,
  refKind: WorkflowArtifactRefKind,
  artifactPlane?: WorkflowArtifactPlane,
): WorkflowGithubSettlementKind | undefined => {
  if (artifactPlane !== 'github') {
    return undefined;
  }

  const normalized = normalizeArtifactLocator(locator).toLowerCase();
  if (refKind === 'repo-file') {
    return 'repo-file';
  }
  if (refKind === 'git-ref') {
    if (normalized.startsWith('branch:')) {
      return 'branch';
    }
    if (/^[0-9a-f]{7,40}$/i.test(normalized)) {
      return 'commit';
    }
    return 'other';
  }
  if (refKind === 'url') {
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(normalized)) {
      return normalized.includes('pullrequestreview') ? 'review' : 'pull-request';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(normalized)) {
      return 'issue';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+/.test(normalized)) {
      return 'ci-run';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/(commit|commits)\/[0-9a-f]{7,40}/.test(normalized)) {
      return 'commit';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/tree\/[^/?#]+/.test(normalized)) {
      return 'branch';
    }
    if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/releases\/tag\/[^/?#]+/.test(normalized)) {
      return 'release';
    }
    if (/^https?:\/\/(www\.)?(github\.com\/[^/]+\/[^/]+\/blob\/|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)/.test(normalized)) {
      return 'repo-file';
    }
    return 'other';
  }

  return 'other';
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
    logger.debug('[ACTION-RUNNER] url-parse fallback: %s', getErrorMessage(err));
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

export const parseNewsArtifact = (artifact: string): ParsedNewsArtifact | null => {
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
    logger.debug('[ACTION-RUNNER] domain extraction failed url=%s: %s', url?.slice(0, 80), getErrorMessage(err));
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

export const extractWorkflowArtifactRefs = (artifacts: string[]): WorkflowArtifactRef[] => {
  const refs: WorkflowArtifactRef[] = [];
  const seen = new Set<string>();

  const pushRef = (ref: WorkflowArtifactRef | null) => {
    if (!ref || !ref.locator) {
      return;
    }
    const locator = normalizeArtifactLocator(ref.locator);
    if (!locator) {
      return;
    }
    const dedupeKey = `${ref.refKind}:${locator}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    const artifactPlane = ref.artifactPlane || inferWorkflowArtifactPlane(locator, ref.refKind);
    const githubSettlementKind = ref.githubSettlementKind || inferWorkflowGithubSettlementKind(locator, ref.refKind, artifactPlane);
    refs.push({
      locator,
      refKind: ref.refKind,
      title: ref.title ? String(ref.title).trim() || undefined : undefined,
      artifactPlane,
      githubSettlementKind,
    });
  };

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const text = String(artifact || '').trim();
    if (!text) {
      continue;
    }

    const reflection = parseActionReflectionArtifact(text);
    if (reflection) {
      pushRef({
        locator: reflection.nextPath,
        refKind: inferWorkflowArtifactRefKind(reflection.nextPath),
        title: `${reflection.concern} reflection target`,
      });
      continue;
    }

    const newsArtifact = parseNewsArtifact(text);
    if (newsArtifact) {
      pushRef({
        locator: newsArtifact.canonicalUrl,
        refKind: 'url',
        title: newsArtifact.title,
      });
      continue;
    }

    const branchMatch = text.match(/^branch:\s*(.+)$/i);
    if (branchMatch) {
      const branchName = branchMatch[1].trim();
      pushRef({ locator: `branch:${branchName}`, refKind: 'git-ref', title: branchName });
      continue;
    }

    const commitMatch = text.match(/^commit:\s*([0-9a-f]{7,40})$/i);
    if (commitMatch) {
      pushRef({ locator: commitMatch[1], refKind: 'git-ref', title: `commit ${commitMatch[1].slice(0, 12)}` });
      continue;
    }

    const workflowSessionMatch = text.match(/^workflow session:\s*(.+)$/i);
    if (workflowSessionMatch) {
      const locator = workflowSessionMatch[1].trim();
      pushRef({ locator, refKind: 'workflow-session', title: locator });
      continue;
    }

    const pathCandidate = text.split(/\r?\n/, 1)[0].trim();
    if (looksLikePathArtifact(pathCandidate)) {
      const locator = normalizeArtifactLocator(pathCandidate);
      pushRef({
        locator,
        refKind: inferWorkflowArtifactRefKind(locator),
        title: path.posix.basename(locator) || locator,
      });
      continue;
    }

    const url = extractUrlFromArtifact(text);
    if (url) {
      const canonicalUrl = canonicalizeUrl(url);
      pushRef({ locator: canonicalUrl, refKind: 'url' });
    }
  }

  return refs.slice(0, 8);
};