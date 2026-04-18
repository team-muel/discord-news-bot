import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripMarkdownExtension, upsertObsidianSystemDocument } from './authoring';
import {
  catalogEntryMatchesChangedPath,
  dedupeCatalogEntries,
  isCompatibilityStubCatalogEntry,
  loadKnowledgeBackfillCatalog,
  resolveCatalogVaultPath,
  targetVisibleInSharedVault,
} from './obsidianCatalogService';
import { normalizePath } from './obsidianPathUtils';
import { getObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';
import type {
  ObsidianKnowledgeBundleArtifact,
  ObsidianKnowledgeBundleGap,
  ObsidianKnowledgePromotionCandidate,
  ObsidianKnowledgePromotionKind,
  ObsidianKnowledgePromoteArtifactKind,
  ObsidianKnowledgePromoteResult,
  ObsidianRequirementCompileResult,
  ObsidianWikiChangeCaptureResult,
  ObsidianWikiChangeKind,
  ObsidianKnowledgeCatalogEntry,
} from './knowledgeCompilerService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const toText = (value: unknown): string => String(value || '').trim();

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }

  const single = String(value || '').trim();
  if (!single) {
    return [];
  }

  return single.split(',').map((entry) => entry.trim()).filter(Boolean);
};

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toSlug = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'change';
};

export const extractMarkdownSection = (content: string, sectionHeading: string): string => {
  const heading = String(sectionHeading || '').trim();
  if (!heading) {
    return content.trim();
  }

  const match = content.match(new RegExp(`(^${escapeRegExp(heading)}\\s*$[\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, 'm'));
  return match?.[1]?.trim() || content.trim();
};

export const renderCatalogSourceContent = (entry: ObsidianKnowledgeCatalogEntry, rawSource: string): string => {
  const sourceExtension = entry.sourcePath.toLowerCase().endsWith('.json') ? '.json' : '';
  const body = entry.sectionHeading && entry.sourcePath.toLowerCase().endsWith('.md')
    ? extractMarkdownSection(rawSource, entry.sectionHeading)
    : rawSource.trim();

  const lines = [
    `> Repository backfill source: ${entry.sourcePath}${entry.sectionHeading ? ` (${entry.sectionHeading})` : ''}`,
    `> Imported at: ${new Date().toISOString()}`,
    '',
  ];

  if (sourceExtension === '.json') {
    lines.push('```json', body, '```');
    return lines.join('\n');
  }

  lines.push(body);
  return lines.join('\n');
};

export const classifyPromotionKindForTargetPath = (targetPath: string): ObsidianKnowledgePromotionKind => {
  const normalized = normalizePath(targetPath).toLowerCase();
  if (normalized.includes('/decisions/') || normalized.includes('decision')) {
    return 'decision';
  }
  if (normalized.includes('/development/') || normalized.includes('changelog')) {
    return 'development_slice';
  }
  if (normalized.includes('/services/')) {
    return 'service_profile';
  }
  if (normalized.includes('/playbook') || normalized.includes('/runbook')) {
    return 'playbook';
  }
  if (normalized.includes('/improvement')) {
    return 'improvement';
  }
  if (normalized.includes('/contexts/repos/') || normalized.includes('repository_context')) {
    return 'repository_context';
  }
  if (normalized.includes('/_runtime/') || normalized.includes('runtime_snapshot')) {
    return 'runtime_snapshot';
  }
  return 'requirement';
};

export const classifyPromotionKindForChangeKind = (changeKind: ObsidianWikiChangeKind): ObsidianKnowledgePromotionKind => {
  switch (changeKind) {
    case 'repo-memory':
      return 'repository_context';
    case 'architecture-delta':
      return 'decision';
    case 'service-change':
      return 'service_profile';
    case 'ops-change':
      return 'playbook';
    case 'development-slice':
    case 'changelog-worthy':
      return 'development_slice';
    default:
      return 'requirement';
  }
};

const buildDefaultWikiTargets = (changeKind: ObsidianWikiChangeKind, summary: string): string[] => {
  const slug = toSlug(summary);
  const date = new Date().toISOString().slice(0, 10);
  switch (changeKind) {
    case 'repo-memory':
      return [`ops/contexts/repos/${slug}.md`];
    case 'architecture-delta':
      return [`plans/decisions/${slug}.md`];
    case 'service-change':
      return [`ops/services/${slug}/PROFILE.md`];
    case 'ops-change':
      return [`ops/playbooks/${slug}.md`];
    case 'development-slice':
    case 'changelog-worthy':
      return [`plans/development/${date}_${slug}.md`];
    default:
      return [`plans/requirements/${slug}.md`];
  }
};

const buildRequirementPromotionTitle = (objective: string, desiredArtifact: string): string => {
  const artifactLabel = toText(desiredArtifact) || 'Requirement';
  const normalizedLabel = artifactLabel.charAt(0).toUpperCase() + artifactLabel.slice(1);
  return `${normalizedLabel}: ${objective}`.slice(0, 160);
};

const buildRequirementPromotionContent = (params: {
  title: string;
  result: Omit<ObsidianRequirementCompileResult, 'promotion' | 'sourceArtifacts'>;
  sourceArtifacts: ObsidianKnowledgeBundleArtifact[];
}): string => {
  const sourceArtifacts = params.sourceArtifacts
    .map((artifact) => `- [${artifact.sourceRole || 'supporting'}] ${artifact.title} (${artifact.locator})`)
    .slice(0, 8);
  const lines = [
    `# ${params.title}`,
    '',
    '## Problem',
    params.result.problem,
    '',
    '## Constraints',
    ...(params.result.constraints.length > 0 ? params.result.constraints.map((value) => `- ${value}`) : ['- None captured yet.']),
    '',
    '## Entities',
    ...(params.result.entities.length > 0 ? params.result.entities.map((value) => `- ${value}`) : ['- None captured yet.']),
    '',
    '## Workflows',
    ...(params.result.workflows.length > 0 ? params.result.workflows.map((value) => `- ${value}`) : ['- Clarify downstream workflow ownership.']),
    '',
    '## Capability Gaps',
    ...(params.result.capabilityGaps.length > 0 ? params.result.capabilityGaps.map((value) => `- ${value}`) : ['- No explicit capability gaps.']),
    '',
    '## Open Questions',
    ...(params.result.openQuestions.length > 0 ? params.result.openQuestions.map((value) => `- ${value}`) : ['- No open questions.']),
    '',
    '## Recommended Next Artifacts',
    ...(params.result.recommendedNextArtifacts.length > 0 ? params.result.recommendedNextArtifacts.map((value) => `- ${value}`) : ['- No explicit follow-up artifacts.']),
    '',
    '## Bundle Summary',
    params.result.bundleSummary,
  ];

  if (sourceArtifacts.length > 0) {
    lines.push('', '## Source Artifacts', ...sourceArtifacts);
  }

  return lines.join('\n');
};

const buildKnowledgePromotionTarget = (artifactKind: ObsidianKnowledgePromoteArtifactKind, title: string): {
  targetPath: string;
  tags: string[];
} => {
  const slug = toSlug(title);
  const date = new Date().toISOString().slice(0, 10);
  switch (artifactKind) {
    case 'requirement':
      return {
        targetPath: `plans/requirements/${slug}.md`,
        tags: ['requirement', 'shared-object'],
      };
    case 'ops-note':
      return {
        targetPath: `ops/playbooks/${slug}.md`,
        tags: ['ops', 'playbook', 'shared-object'],
      };
    case 'contract':
      return {
        targetPath: `ops/contracts/${slug}.md`,
        tags: ['contract', 'shared-object'],
      };
    case 'retrofit':
      return {
        targetPath: `plans/development/${date}_${slug}.md`,
        tags: ['development-slice', 'shared-object'],
      };
    case 'lesson':
      return {
        targetPath: `ops/improvement/lessons/${slug}.md`,
        tags: ['improvement', 'lesson', 'shared-object'],
      };
    case 'note':
    default:
      return {
        targetPath: `ops/contexts/repos/${slug}.md`,
        tags: ['repository-context', 'shared-object'],
      };
  }
};

const buildKnowledgePromotionContent = (params: {
  title: string;
  content: string;
  sources: string[];
  confidence: number;
  nextAction: string;
  supersedes: string[];
}): string => {
  const lines = [
    `# ${params.title}`,
    '',
    params.content.trim(),
    '',
    '## Provenance',
    `- Confidence: ${params.confidence.toFixed(2)}`,
    ...(params.sources.length > 0 ? params.sources.map((source) => `- Source: ${source}`) : ['- Source: missing']),
  ];

  if (params.supersedes.length > 0) {
    lines.push('', '## Supersedes', ...params.supersedes.map((value) => `- ${value}`));
  }

  if (params.nextAction) {
    lines.push('', '## Next Action', `- ${params.nextAction}`);
  }

  return lines.join('\n');
};

export const promoteCompiledRequirement = async (params: {
  objective: string;
  desiredArtifact: string;
  result: Omit<ObsidianRequirementCompileResult, 'promotion' | 'sourceArtifacts'>;
  sourceArtifacts: ObsidianKnowledgeBundleArtifact[];
  promoteImmediately: boolean;
  allowOverwrite: boolean;
}): Promise<NonNullable<ObsidianRequirementCompileResult['promotion']>> => {
  const targetSlug = toSlug(params.desiredArtifact
    ? `${params.desiredArtifact}-${params.objective}`
    : params.objective);
  const targetPath = `plans/requirements/${targetSlug}.md`;
  const followUps: string[] = [];

  if (!params.promoteImmediately) {
    return {
      requested: false,
      targetPath,
      written: false,
      writtenPath: null,
      followUps,
    };
  }

  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';
  if (!vaultPath) {
    followUps.push('Shared vault visibility is required before requirement.compile can promote a durable requirement note.');
    return {
      requested: true,
      targetPath,
      written: false,
      writtenPath: null,
      followUps,
    };
  }

  const resolvedTargetPath = resolveCatalogVaultPath(vaultPath, targetPath);
  if (fs.existsSync(resolvedTargetPath) && !params.allowOverwrite) {
    followUps.push(`Requirement target ${targetPath} already exists. Re-run with overwrite if replacement is intended.`);
    return {
      requested: true,
      targetPath,
      written: false,
      writtenPath: null,
      followUps,
    };
  }

  const title = buildRequirementPromotionTitle(params.objective, params.desiredArtifact);
  const writeResult = await upsertObsidianSystemDocument({
    vaultPath,
    fileName: stripMarkdownExtension(targetPath),
    content: buildRequirementPromotionContent({
      title,
      result: params.result,
      sourceArtifacts: params.sourceArtifacts,
    }),
    tags: dedupeStrings([
      'requirement',
      'compiled',
      params.desiredArtifact || null,
    ]),
    allowHighLinkDensity: true,
    properties: {
      title,
      source_kind: 'compiled-requirement',
      desired_artifact: params.desiredArtifact || 'requirement',
      objective: params.objective,
      generated_by: 'requirement.compile',
    },
  });

  if (!writeResult.ok || !writeResult.path) {
    followUps.push('Requirement promotion failed through the Obsidian sanitization and routing path. Check vault health and selected write adapter.');
  }

  return {
    requested: true,
    targetPath,
    written: Boolean(writeResult.ok && writeResult.path),
    writtenPath: writeResult.path || null,
    followUps,
  };
};

export const promoteKnowledgeToObsidian = async (params: {
  artifactKind: ObsidianKnowledgePromoteArtifactKind;
  title: string;
  content: string;
  sources?: string[];
  confidence?: number;
  tags?: string[];
  owner?: string;
  canonicalKey?: string;
  nextAction?: string;
  supersedes?: string[];
  validAt?: string;
  allowOverwrite?: boolean;
}): Promise<ObsidianKnowledgePromoteResult> => {
  const title = toText(params.title);
  const content = toText(params.content);
  const sources = dedupeStrings(toStringArray(params.sources));
  const confidence = Number(Math.max(0, Math.min(1, Number(params.confidence ?? 0.8))).toFixed(2));
  const canonicalKey = toText(params.canonicalKey) || null;
  const supersedes = dedupeStrings(toStringArray(params.supersedes));
  const skippedReasons: string[] = [];

  if (!title) {
    skippedReasons.push('title is required');
  }
  if (content.length < 20) {
    skippedReasons.push('content must contain at least 20 characters after trimming');
  }
  if (sources.length === 0) {
    skippedReasons.push('at least one provenance source is required');
  }
  if (confidence < 0.5) {
    skippedReasons.push('confidence must be at least 0.50 before promotion');
  }

  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';
  if (!vaultPath) {
    skippedReasons.push('shared vault is not configured or not visible');
  }

  const target = title ? buildKnowledgePromotionTarget(params.artifactKind, title) : null;
  if (target && vaultPath) {
    const absoluteTargetPath = resolveCatalogVaultPath(vaultPath, target.targetPath);
    if (fs.existsSync(absoluteTargetPath) && params.allowOverwrite !== true) {
      skippedReasons.push(`target already exists: ${target.targetPath}`);
    }
  }

  if (skippedReasons.length > 0 || !target || !vaultPath) {
    return {
      status: 'skipped',
      writtenArtifacts: [],
      skippedReasons,
      targetPath: target?.targetPath || null,
      canonicalKey,
    };
  }

  const writeResult = await upsertObsidianSystemDocument({
    vaultPath,
    fileName: stripMarkdownExtension(target.targetPath),
    content: buildKnowledgePromotionContent({
      title,
      content,
      sources,
      confidence,
      nextAction: toText(params.nextAction),
      supersedes,
    }),
    tags: dedupeStrings([
      ...target.tags,
      ...toStringArray(params.tags),
      params.artifactKind,
    ]),
    allowHighLinkDensity: true,
    properties: {
      title,
      source: 'knowledge.promote',
      artifact_kind: params.artifactKind,
      confidence,
      owner: toText(params.owner) || null,
      canonical_key: canonicalKey,
      source_refs: sources,
      supersedes: supersedes.length > 0 ? supersedes : null,
      next_action: toText(params.nextAction) || null,
      valid_at: toText(params.validAt) || null,
      status: 'active',
    },
  });

  if (!writeResult.ok || !writeResult.path) {
    return {
      status: 'partial',
      writtenArtifacts: [],
      skippedReasons: ['promotion write failed through the Obsidian routing and sanitization path'],
      targetPath: target.targetPath,
      canonicalKey,
    };
  }

  return {
    status: 'written',
    writtenArtifacts: [writeResult.path],
    skippedReasons: [],
    targetPath: target.targetPath,
    canonicalKey,
  };
};

export const dedupePromotionCandidates = (candidates: ObsidianKnowledgePromotionCandidate[]): ObsidianKnowledgePromotionCandidate[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgePromotionCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.artifactKind}:${candidate.title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
};

export const captureObsidianWikiChange = async (params: {
  changeSummary: string;
  changedPaths?: string[];
  changeKind: ObsidianWikiChangeKind;
  validationRefs?: string[];
  mirrorTargets?: string[];
  promoteImmediately?: boolean;
  allowOverwrite?: boolean;
}): Promise<ObsidianWikiChangeCaptureResult> => {
  const changeSummary = toText(params.changeSummary);
  if (!changeSummary) {
    throw new Error('changeSummary is required');
  }

  const changedPaths = dedupeStrings(toStringArray(params.changedPaths));
  const mirrorTargets = dedupeStrings(toStringArray(params.mirrorTargets));
  const validationRefs = dedupeStrings(toStringArray(params.validationRefs));
  const catalog = loadKnowledgeBackfillCatalog();
  const matchedEntries = dedupeCatalogEntries(catalog.entries.filter((entry) => catalogEntryMatchesChangedPath(entry, changedPaths)));
  const classification = dedupeStrings([
    ...matchedEntries.map((entry) => classifyPromotionKindForTargetPath(entry.targetPath)),
    classifyPromotionKindForChangeKind(params.changeKind),
  ]) as ObsidianKnowledgePromotionKind[];
  const wikiTargets = dedupeStrings([
    ...matchedEntries.map((entry) => entry.targetPath),
    ...buildDefaultWikiTargets(params.changeKind, changeSummary),
  ]);
  const writtenArtifacts: string[] = [];
  const gaps: ObsidianKnowledgeBundleGap[] = [];
  const followUps: string[] = [];
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';

  if (matchedEntries.length === 0) {
    followUps.push('Add an explicit backfill catalog entry if this change should become a durable shared wiki object.');
  }
  if (mirrorTargets.length === 0 && (params.changeKind === 'architecture-delta' || params.changeKind === 'changelog-worthy')) {
    followUps.push('Update docs/CHANGELOG-ARCH.md after the wiki target is confirmed.');
  }
  if (validationRefs.length === 0) {
    followUps.push('Attach validation references before promoting the change as durable shared knowledge.');
  }

  if (params.promoteImmediately) {
    if (!vaultPath) {
      gaps.push({
        id: 'gap-access-vault-write',
        gapType: 'access',
        description: 'Shared vault write target is not configured, so immediate promotion cannot run.',
        severity: 'high',
        suggestedNextStep: 'Set OBSIDIAN_VAULT_PATH or OBSIDIAN_SYNC_VAULT_PATH and retry the capture.',
      });
    } else {
      for (const entry of matchedEntries) {
        const targetVisible = await targetVisibleInSharedVault(vaultPath, entry.targetPath);
        if (isCompatibilityStubCatalogEntry(entry)) {
          if (!targetVisible) {
            gaps.push({
              id: `gap-compatibility-stub-${entry.id}`,
              gapType: 'coverage',
              description: `${entry.targetPath} is missing while ${entry.sourcePath} is marked as a compatibility stub and cannot safely repopulate the shared target.`,
              severity: 'high',
              suggestedNextStep: 'Recover the shared wiki object from shared history or restore a full repo source before rerunning wiki change capture.',
            });
          } else {
            followUps.push(`Skipped compatibility-stub source ${entry.sourcePath}; keep ${entry.targetPath} as the semantic owner instead of overwriting from the reduced repo mirror.`);
          }
          continue;
        }

        if (targetVisible && params.allowOverwrite !== true) {
          followUps.push(`Skipped existing wiki target ${entry.targetPath}. Re-run with overwrite if replacement is intended.`);
          continue;
        }

        const sourcePath = path.resolve(REPO_ROOT, entry.sourcePath);
        if (!fs.existsSync(sourcePath)) {
          gaps.push({
            id: `gap-source-missing-${entry.id}`,
            gapType: 'missing',
            description: `${entry.sourcePath} is missing, so ${entry.targetPath} could not be promoted.`,
            severity: 'high',
            suggestedNextStep: 'Restore the repo source artifact or update the catalog entry.',
          });
          continue;
        }

        const rawSource = fs.readFileSync(sourcePath, 'utf8');
        const writeResult = await upsertObsidianSystemDocument({
          vaultPath,
          fileName: stripMarkdownExtension(entry.targetPath),
          content: renderCatalogSourceContent(entry, rawSource),
          tags: entry.tags,
          allowHighLinkDensity: true,
          properties: {
            title: entry.title,
            source_repo_path: entry.sourcePath,
            source_kind: 'repo-backfill',
            backfill_id: entry.id,
            plane: entry.plane,
            concern: entry.concern,
            change_kind: params.changeKind,
          },
        });

        if (!writeResult.ok || !writeResult.path) {
          gaps.push({
            id: `gap-write-failed-${entry.id}`,
            gapType: 'access',
            description: `${entry.targetPath} failed to write through the Obsidian sanitization and routing path.`,
            severity: 'high',
            suggestedNextStep: 'Check the selected write adapter and vault health before retrying the capture.',
          });
          continue;
        }

        writtenArtifacts.push(writeResult.path);
      }
    }
  }

  return {
    classification,
    wikiTargets,
    writtenArtifacts,
    mirrorUpdates: mirrorTargets,
    followUps,
    gaps,
    matchedCatalogEntries: matchedEntries.map((entry) => entry.id),
  };
};