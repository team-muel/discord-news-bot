import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';
import {
  INDEX_PATH,
  LINT_PATH,
  LOG_PATH,
  normalizeCatalogAudience,
  normalizeCatalogPath,
  normalizePath,
} from './obsidianPathUtils';
import { readObsidianFileWithAdapter } from './router';
import type {
  ObsidianKnowledgeAccessProfile,
  ObsidianKnowledgeCatalogCoverage,
  ObsidianKnowledgeCatalogDocument,
  ObsidianKnowledgeCatalogEntry,
  ObsidianKnowledgeCatalogPolicy,
} from './knowledgeCompilerService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_BACKFILL_CATALOG_PATH = path.resolve(__dirname, '../../../config/runtime/knowledge-backfill-catalog.json');

const DEFAULT_KNOWLEDGE_CATALOG_POLICY: ObsidianKnowledgeCatalogPolicy = {
  humanFirst: true,
  rules: [
    'Start with operator-primary canonical docs before generated knowledge-control artifacts.',
    'Treat generated ops/knowledge-control pages as navigation aids and evidence support, not as the first semantic source.',
    'When runtime, planning, or incident meaning conflicts, prefer control-tower docs and the operating baseline before convenience summaries.',
  ],
  avoidAsPrimary: [INDEX_PATH, LOG_PATH, LINT_PATH],
};

let cachedKnowledgeCatalogMtimeMs = -1;
let cachedKnowledgeCatalog: ObsidianKnowledgeCatalogDocument | null = null;

const dedupeCatalogStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizePath(String(value || ''));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

export const cloneCatalogPolicy = (value: ObsidianKnowledgeCatalogPolicy): ObsidianKnowledgeCatalogPolicy => ({
  humanFirst: Boolean(value.humanFirst),
  rules: [...value.rules],
  avoidAsPrimary: [...value.avoidAsPrimary],
});

export const cloneCatalogEntry = (value: ObsidianKnowledgeCatalogEntry): ObsidianKnowledgeCatalogEntry => ({
  ...value,
  tags: [...value.tags],
  queries: [...value.queries],
});

export const isCompatibilityStubCatalogEntry = (entry: ObsidianKnowledgeCatalogEntry): boolean => {
  return entry.sourceMode === 'compatibility-stub';
};

const normalizeKnowledgeCatalogEntry = (value: unknown): ObsidianKnowledgeCatalogEntry | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const id = String(entry.id || '').trim();
  const title = String(entry.title || '').trim();
  const sourcePath = normalizeCatalogPath(entry.sourcePath);
  const targetPath = normalizeCatalogPath(entry.targetPath);
  if (!id || !title || !sourcePath || !targetPath) {
    return null;
  }

  return {
    id,
    title,
    sourcePath,
    targetPath,
    sourceMode: entry.sourceMode === 'compatibility-stub' ? 'compatibility-stub' : 'full-source',
    sectionHeading: String(entry.sectionHeading || '').trim() || undefined,
    tags: dedupeCatalogStrings(Array.isArray(entry.tags) ? entry.tags.map((item) => String(item || '').trim()) : []),
    plane: String(entry.plane || '').trim() || 'record',
    concern: String(entry.concern || '').trim() || 'general-record',
    intent: String(entry.intent || '').trim() || 'memory',
    audience: normalizeCatalogAudience(entry.audience),
    canonical: Boolean(entry.canonical),
    startHere: Boolean(entry.startHere),
    agentReference: entry.agentReference !== false,
    queries: dedupeCatalogStrings(Array.isArray(entry.queries) ? entry.queries.map((item) => String(item || '').trim()) : []),
  };
};

const normalizeKnowledgeCatalogPolicy = (value: unknown): ObsidianKnowledgeCatalogPolicy => {
  if (!value || typeof value !== 'object') {
    return cloneCatalogPolicy(DEFAULT_KNOWLEDGE_CATALOG_POLICY);
  }

  const policy = value as Record<string, unknown>;
  return {
    humanFirst: policy.humanFirst !== false,
    rules: dedupeCatalogStrings(
      Array.isArray(policy.rules)
        ? policy.rules.map((item) => String(item || '').trim())
        : DEFAULT_KNOWLEDGE_CATALOG_POLICY.rules,
    ),
    avoidAsPrimary: dedupeCatalogStrings(
      Array.isArray(policy.avoidAsPrimary)
        ? policy.avoidAsPrimary.map((item) => normalizeCatalogPath(item))
        : DEFAULT_KNOWLEDGE_CATALOG_POLICY.avoidAsPrimary,
    ),
  };
};

export const loadKnowledgeBackfillCatalog = (): ObsidianKnowledgeCatalogDocument => {
  try {
    const stat = fs.statSync(KNOWLEDGE_BACKFILL_CATALOG_PATH);
    if (cachedKnowledgeCatalog && stat.mtimeMs === cachedKnowledgeCatalogMtimeMs) {
      return cachedKnowledgeCatalog;
    }

    const raw = fs.readFileSync(KNOWLEDGE_BACKFILL_CATALOG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
        .map((item) => normalizeKnowledgeCatalogEntry(item))
        .filter((item): item is ObsidianKnowledgeCatalogEntry => Boolean(item))
      : [];

    cachedKnowledgeCatalog = {
      schemaVersion: Number(parsed.schemaVersion || 1) || 1,
      updatedAt: String(parsed.updatedAt || '').trim() || '',
      description: String(parsed.description || '').trim() || '',
      policy: normalizeKnowledgeCatalogPolicy(parsed.policy),
      entries,
    };
    cachedKnowledgeCatalogMtimeMs = stat.mtimeMs;
    return cachedKnowledgeCatalog;
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: '',
      description: '',
      policy: cloneCatalogPolicy(DEFAULT_KNOWLEDGE_CATALOG_POLICY),
      entries: [],
    };
  }
};

export const resolveCatalogVaultPath = (vaultRoot: string, targetPath: string): string => {
  const normalized = normalizeCatalogPath(targetPath).replace(/\.md$/i, '');
  const segments = normalized.split('/').map((segment) => String(segment || '').trim()).filter(Boolean);
  return path.join(path.resolve(vaultRoot), ...segments) + '.md';
};

const resolveCatalogVaultRelativePath = (targetPath: string): string => {
  const normalized = normalizeCatalogPath(targetPath).replace(/^\/+/, '');
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
};

export const targetVisibleInSharedVault = async (vaultRoot: string, targetPath: string): Promise<boolean> => {
  if (!vaultRoot) {
    return false;
  }

  if (fs.existsSync(resolveCatalogVaultPath(vaultRoot, targetPath))) {
    return true;
  }

  const content = await readObsidianFileWithAdapter({
    vaultPath: vaultRoot,
    filePath: resolveCatalogVaultRelativePath(targetPath),
  });
  return content !== null;
};

export const buildKnowledgeCatalogCoverage = (
  entries: ObsidianKnowledgeCatalogEntry[],
): ObsidianKnowledgeCatalogCoverage => {
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultAvailable = Boolean(vaultRuntime.configured && vaultRuntime.exists && vaultRuntime.root);
  const missingTargetPaths: string[] = [];
  const operatorPrimaryMissingPaths: string[] = [];
  const startHereMissingPaths: string[] = [];
  let presentEntries = 0;
  let operatorPrimaryEntries = 0;
  let operatorPrimaryPresent = 0;
  let startHereEntries = 0;
  let startHerePresent = 0;

  for (const entry of entries) {
    const exists = vaultAvailable && fs.existsSync(resolveCatalogVaultPath(vaultRuntime.root, entry.targetPath));
    if (exists) {
      presentEntries += 1;
    } else {
      missingTargetPaths.push(entry.targetPath);
    }

    if (entry.audience === 'operator-primary') {
      operatorPrimaryEntries += 1;
      if (exists) {
        operatorPrimaryPresent += 1;
      } else {
        operatorPrimaryMissingPaths.push(entry.targetPath);
      }
    }

    if (entry.startHere) {
      startHereEntries += 1;
      if (exists) {
        startHerePresent += 1;
      } else {
        startHereMissingPaths.push(entry.targetPath);
      }
    }
  }

  return {
    vaultConfigured: vaultAvailable,
    vaultRoot: vaultRuntime.root,
    totalEntries: entries.length,
    presentEntries,
    missingEntries: entries.length - presentEntries,
    operatorPrimaryEntries,
    operatorPrimaryPresent,
    operatorPrimaryMissing: operatorPrimaryEntries - operatorPrimaryPresent,
    startHereEntries,
    startHerePresent,
    startHereMissing: startHereEntries - startHerePresent,
    missingTargetPaths,
    operatorPrimaryMissingPaths,
    startHereMissingPaths,
  };
};

export const buildKnowledgeCatalogCoverageAsync = async (
  entries: ObsidianKnowledgeCatalogEntry[],
): Promise<ObsidianKnowledgeCatalogCoverage> => {
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultAvailable = Boolean(vaultRuntime.configured && vaultRuntime.exists && vaultRuntime.root);
  const missingTargetPaths: string[] = [];
  const operatorPrimaryMissingPaths: string[] = [];
  const startHereMissingPaths: string[] = [];
  let presentEntries = 0;
  let operatorPrimaryEntries = 0;
  let operatorPrimaryPresent = 0;
  let startHereEntries = 0;
  let startHerePresent = 0;

  for (const entry of entries) {
    const exists = vaultAvailable && await targetVisibleInSharedVault(vaultRuntime.root, entry.targetPath);
    if (exists) {
      presentEntries += 1;
    } else {
      missingTargetPaths.push(entry.targetPath);
    }

    if (entry.audience === 'operator-primary') {
      operatorPrimaryEntries += 1;
      if (exists) {
        operatorPrimaryPresent += 1;
      } else {
        operatorPrimaryMissingPaths.push(entry.targetPath);
      }
    }

    if (entry.startHere) {
      startHereEntries += 1;
      if (exists) {
        startHerePresent += 1;
      } else {
        startHereMissingPaths.push(entry.targetPath);
      }
    }
  }

  return {
    vaultConfigured: vaultAvailable,
    vaultRoot: vaultRuntime.root,
    totalEntries: entries.length,
    presentEntries,
    missingEntries: entries.length - presentEntries,
    operatorPrimaryEntries,
    operatorPrimaryPresent,
    operatorPrimaryMissing: operatorPrimaryEntries - operatorPrimaryPresent,
    startHereEntries,
    startHerePresent,
    startHereMissing: startHereEntries - startHerePresent,
    missingTargetPaths,
    operatorPrimaryMissingPaths,
    startHereMissingPaths,
  };
};

export const buildKnowledgeAccessProfile = (
  catalog: ObsidianKnowledgeCatalogDocument,
): ObsidianKnowledgeAccessProfile => {
  const entries = catalog.entries.map(cloneCatalogEntry);
  return {
    humanFirst: catalog.policy.humanFirst,
    rules: [...catalog.policy.rules],
    avoidAsPrimary: [...catalog.policy.avoidAsPrimary],
    startHerePaths: dedupeCatalogStrings(entries.filter((entry) => entry.startHere).map((entry) => entry.targetPath)),
    operatorPrimaryPaths: dedupeCatalogStrings(entries.filter((entry) => entry.audience === 'operator-primary').map((entry) => entry.targetPath)),
    agentReferencePaths: dedupeCatalogStrings(entries.filter((entry) => entry.agentReference).map((entry) => entry.targetPath)),
    canonicalPaths: dedupeCatalogStrings(entries.filter((entry) => entry.canonical).map((entry) => entry.targetPath)),
    coverage: buildKnowledgeCatalogCoverage(entries),
  };
};

const tokenizeGoal = (value: string): string[] => {
  return [...new Set(String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))];
};

const buildCatalogMatchScore = (
  entry: ObsidianKnowledgeCatalogEntry,
  tokens: string[],
  domains: string[],
): number => {
  const haystack = [
    entry.id,
    entry.title,
    entry.sourcePath,
    entry.targetPath,
    entry.concern,
    entry.intent,
    entry.plane,
    ...entry.tags,
    ...entry.queries,
  ].join(' ').toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 3 : 1.5;
    }
  }
  if (domains.includes(entry.intent)) {
    score += 4;
  }
  if (entry.startHere) {
    score += 1.5;
  }
  if (entry.canonical) {
    score += 1;
  }
  if (entry.agentReference) {
    score += 0.5;
  }
  return score;
};

export const selectKnowledgeBundleEntries = (params: {
  catalog: ObsidianKnowledgeCatalogDocument;
  goal: string;
  domains: string[];
  maxArtifacts: number;
}): ObsidianKnowledgeCatalogEntry[] => {
  const tokens = tokenizeGoal(params.goal);
  const ranked = params.catalog.entries
    .map((entry) => ({
      entry,
      score: buildCatalogMatchScore(entry, tokens, params.domains),
    }))
    .sort((left, right) => right.score - left.score || Number(right.entry.startHere) - Number(left.entry.startHere));

  const selected = ranked
    .filter((item) => item.score > 0)
    .slice(0, params.maxArtifacts)
    .map((item) => item.entry);

  if (selected.length >= Math.min(params.maxArtifacts, 3)) {
    return selected;
  }

  return dedupeCatalogEntries([
    ...selected,
    ...params.catalog.entries.filter((entry) => entry.startHere),
    ...params.catalog.entries.filter((entry) => entry.canonical && entry.audience === 'operator-primary'),
  ]).slice(0, params.maxArtifacts);
};

export const dedupeCatalogEntries = (entries: ObsidianKnowledgeCatalogEntry[]): ObsidianKnowledgeCatalogEntry[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry?.id || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
};

export const catalogEntryMatchesChangedPath = (entry: ObsidianKnowledgeCatalogEntry, changedPaths: string[]): boolean => {
  const sourcePath = normalizeCatalogPath(entry.sourcePath);
  return changedPaths.some((changedPath) => normalizeCatalogPath(changedPath) === sourcePath);
};