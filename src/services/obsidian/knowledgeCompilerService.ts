import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import { stripMarkdownExtension, upsertObsidianSystemDocument } from './authoring';
import { stripFrontmatterBlock } from './obsidianMetadataUtils';
import { parseObsidianFrontmatter } from './obsidianCacheService';
import { doc } from './obsidianDocBuilder';
import {
  getObsidianAdapterRuntimeStatus,
  listObsidianFilesWithAdapter,
  readObsidianFileWithAdapter,
  searchObsidianVaultWithAdapter,
  writeObsidianNoteWithAdapter,
} from './router';
import { getLatestObsidianGraphAuditSnapshot } from './obsidianQualityService';
import type { ObsidianFileInfo, ObsidianFrontmatterValue } from './types';
import { getObsidianVaultRuntimeInfo } from '../../utils/obsidianEnv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const GENERATED_ROOT = 'ops/knowledge-control';
const INDEX_PATH = `${GENERATED_ROOT}/INDEX.md`;
const LOG_PATH = `${GENERATED_ROOT}/LOG.md`;
const LINT_PATH = `${GENERATED_ROOT}/LINT.md`;
const SUPERVISOR_PATH = `${GENERATED_ROOT}/SUPERVISOR.md`;
const TOPIC_DIR = `${GENERATED_ROOT}/topics`;
const ENTITY_DIR = `${GENERATED_ROOT}/entities`;
const CONTROL_TOWER_DIR = 'ops/control-tower';
const BLUEPRINT_PATH = `${CONTROL_TOWER_DIR}/BLUEPRINT.md`;
const CANONICAL_MAP_PATH = `${CONTROL_TOWER_DIR}/CANONICAL_MAP.md`;
const CADENCE_PATH = `${CONTROL_TOWER_DIR}/CADENCE.md`;
const GATE_ENTRYPOINTS_PATH = `${CONTROL_TOWER_DIR}/GATE_ENTRYPOINTS.md`;
const CONTROL_TOWER_PATHS = [BLUEPRINT_PATH, CANONICAL_MAP_PATH, CADENCE_PATH, GATE_ENTRYPOINTS_PATH] as const;
const QUALITY_RUBRIC_PATH = 'ops/quality/RUBRIC.md';
const QUALITY_METRICS_BASELINE_PATH = 'ops/quality/METRICS_BASELINE.md';
const VISIBLE_REFLECTION_GATE_PATH = 'ops/quality/gates/2026-04-10_visible-reflection-gate.md';
const VISIBLE_REFLECTION_CORRECTION_PATH = 'ops/improvement/corrections/2026-04-10_visible-reflection-definition.md';
const KNOWLEDGE_REFLECTION_RULE_PATH = 'ops/improvement/rules/knowledge-reflection-pipeline.md';
const SEMANTIC_LINT_NEGATIVE_KNOWLEDGE_ROOT = 'ops/improvement/negative-knowledge/semantic-lint';
const SEMANTIC_LINT_CURRENT_PATH = `${SEMANTIC_LINT_NEGATIVE_KNOWLEDGE_ROOT}/CURRENT.md`;
const KNOWLEDGE_BACKFILL_CATALOG_PATH = path.resolve(__dirname, '../../../config/runtime/knowledge-backfill-catalog.json');

const TRACKED_ROOTS = ['chat/answers', 'consolidated', 'retros', 'memory'];
const DURABLE_SHARED_ROOTS = [
  'plans/decisions',
  'plans/development',
  'plans/execution',
  'plans/requirements',
  'ops/control-tower',
  'ops/quality',
  'ops/services',
  'ops/playbooks',
  'ops/contracts',
  'ops/incidents',
  'ops/vulnerabilities',
  'ops/improvement',
  'ops/contexts',
  'ops/postmortems',
  'ops/mitigations',
];
const GUILD_TRACKED_ROOT_SUFFIXES = ['chat/answers', 'memory', 'retros', 'sprint-journal', 'customer', 'events'];
const GUILD_CORE_FILE_NAMES = ['Guild_Lore.md', 'Server_History.md', 'Decision_Log.md'];
const SYSTEM_TAGS = new Set([
  'answer',
  'auto-generated',
  'chat',
  'compiled',
  'consolidated',
  'external-query',
  'inbox',
  'knowledge-control',
  'navigation',
]);

const MAX_INDEX_ROWS = 24;
const MAX_LOG_ROWS = 40;
const MAX_TOPIC_ROWS = 20;
const MAX_ENTITY_ROWS = 16;
const MAX_SNAPSHOT_NOTES = 80;
const STALE_ACTIVE_NOTE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type KnowledgeSnapshotNote = {
  filePath: string;
  title: string;
  schema: string;
  source: string;
  status: string;
  created: string;
  observedAt: string;
  validAt: string;
  invalidAt: string;
  canonicalKey: string;
  entityKey: string;
  tags: string[];
  topics: string[];
  sourceRefs: string[];
  summary: string;
  timestampMs: number;
  modifiedAt: number;
};

type CompilationDecision = {
  shouldCompile: boolean;
  reason: string | null;
  entityKey: string | null;
  topics: string[];
};

export type ObsidianKnowledgeCompilationResult = {
  compiled: boolean;
  reason: string | null;
  indexedNotes: number;
  artifacts: string[];
  topics: string[];
  entityKey: string | null;
};

export type ObsidianKnowledgeLintIssue = {
  kind: 'missing_source_refs' | 'stale_active_note' | 'invalid_lifecycle' | 'canonical_collision';
  severity: 'warning';
  message: string;
  entityKey: string | null;
  filePaths: string[];
};

export type ObsidianKnowledgeLintSummary = {
  generatedAt: string | null;
  issueCount: number;
  missingSourceRefs: number;
  staleActiveNotes: number;
  invalidLifecycleNotes: number;
  canonicalCollisions: number;
  issues: ObsidianKnowledgeLintIssue[];
};

export type ObsidianKnowledgeCompilationStats = {
  enabled: boolean;
  runs: number;
  skipped: number;
  failures: number;
  lastTriggeredAt: string | null;
  lastCompiledAt: string | null;
  lastNotePath: string | null;
  lastReason: string | null;
  lastArtifacts: string[];
  lastTopics: string[];
  lastEntityKey: string | null;
  lastIndexedNotes: number;
  lastLintSummary: ObsidianKnowledgeLintSummary | null;
};

export type ObsidianKnowledgePlaneId = 'control' | 'runtime' | 'record' | 'learning';

export type ObsidianKnowledgePlaneDefinition = {
  id: ObsidianKnowledgePlaneId;
  label: string;
  description: string;
  pathPatterns: string[];
  primaryQuestions: string[];
};

export type ObsidianKnowledgeControlBlueprint = {
  model: '4-plane-control-tower';
  controlPaths: string[];
  reflectionChecklist: string[];
  planes: ObsidianKnowledgePlaneDefinition[];
};

export type ObsidianKnowledgePathDescriptor = {
  path: string;
  plane: ObsidianKnowledgePlaneId;
  concern: string;
  generated: boolean;
};

export type ObsidianKnowledgeCatalogAudience = 'operator-primary' | 'shared' | 'agent-support';

export type ObsidianKnowledgeCatalogEntry = {
  id: string;
  title: string;
  sourcePath: string;
  targetPath: string;
  sourceMode?: 'full-source' | 'compatibility-stub';
  sectionHeading?: string;
  tags: string[];
  plane: string;
  concern: string;
  intent: string;
  audience: ObsidianKnowledgeCatalogAudience;
  canonical: boolean;
  startHere: boolean;
  agentReference: boolean;
  queries: string[];
};

export type ObsidianKnowledgeCatalogPolicy = {
  humanFirst: boolean;
  rules: string[];
  avoidAsPrimary: string[];
};

export type ObsidianKnowledgeCatalogDocument = {
  schemaVersion: number;
  updatedAt: string;
  description: string;
  policy: ObsidianKnowledgeCatalogPolicy;
  entries: ObsidianKnowledgeCatalogEntry[];
};

export type ObsidianKnowledgeCatalogCoverage = {
  vaultConfigured: boolean;
  vaultRoot: string;
  totalEntries: number;
  presentEntries: number;
  missingEntries: number;
  operatorPrimaryEntries: number;
  operatorPrimaryPresent: number;
  operatorPrimaryMissing: number;
  startHereEntries: number;
  startHerePresent: number;
  startHereMissing: number;
  missingTargetPaths: string[];
  operatorPrimaryMissingPaths: string[];
  startHereMissingPaths: string[];
};

export type ObsidianKnowledgeAccessProfile = {
  humanFirst: boolean;
  rules: string[];
  avoidAsPrimary: string[];
  startHerePaths: string[];
  operatorPrimaryPaths: string[];
  agentReferencePaths: string[];
  canonicalPaths: string[];
  coverage: ObsidianKnowledgeCatalogCoverage;
};

export type ObsidianKnowledgeReflectionBundle = {
  targetPath: string;
  plane: ObsidianKnowledgePlaneId;
  concern: string;
  requiredPaths: string[];
  suggestedPaths: string[];
  suggestedPatterns: string[];
  verificationChecklist: string[];
  gatePaths: string[];
  customerImpact: boolean;
  notes: string[];
};

export type ObsidianKnowledgeBundleFactType = 'runtime' | 'decision' | 'plan' | 'requirement' | 'relationship' | 'constraint' | 'gap-derived';

export type ObsidianKnowledgeBundleArtifactType = 'obsidian-note' | 'repo-doc' | 'runtime-snapshot' | 'code-bundle' | 'local-overlay' | 'internal-doc';

export type ObsidianKnowledgeBundleArtifactSourceRole = 'trigger' | 'supporting' | 'derived';

export type ObsidianKnowledgeBundleGapType = 'missing' | 'stale' | 'conflict' | 'access' | 'coverage' | 'promotion-needed';

export type ObsidianKnowledgePromotionKind = 'decision' | 'development_slice' | 'service_profile' | 'playbook' | 'improvement' | 'repository_context' | 'runtime_snapshot' | 'requirement';

export type ObsidianKnowledgeBundleFact = {
  id: string;
  statement: string;
  confidence: number;
  sourceRefs: string[];
  freshness: string;
  factType: ObsidianKnowledgeBundleFactType;
};

export type ObsidianKnowledgeBundleArtifact = {
  id: string;
  artifactType: ObsidianKnowledgeBundleArtifactType;
  title: string;
  locator: string;
  whyIncluded: string;
  confidence: number;
  preview: string;
  sourceRole?: ObsidianKnowledgeBundleArtifactSourceRole;
};

export type ObsidianKnowledgeBundleGap = {
  id: string;
  gapType: ObsidianKnowledgeBundleGapType;
  description: string;
  severity: 'low' | 'medium' | 'high';
  suggestedNextStep: string;
};

export type ObsidianKnowledgePromotionCandidate = {
  artifactKind: ObsidianKnowledgePromotionKind;
  title: string;
  reason: string;
  sourceRefs: string[];
};

export type ObsidianKnowledgeBundleResult = {
  summary: string;
  facts: ObsidianKnowledgeBundleFact[];
  artifacts: ObsidianKnowledgeBundleArtifact[];
  gaps: ObsidianKnowledgeBundleGap[];
  recommendedPromotions: ObsidianKnowledgePromotionCandidate[];
  resolutionTrace: string[];
  confidence: number;
  inputs: {
    goal: string;
    domains: string[];
    sourceHints: string[];
    explicitSources: string[];
    includeLocalOverlay: boolean;
    audience: string;
  };
};

export type ObsidianInternalKnowledgeResolveResult = {
  summary: string;
  facts: ObsidianKnowledgeBundleFact[];
  artifacts: ObsidianKnowledgeBundleArtifact[];
  redactions: string[];
  accessNotes: string[];
  gaps: ObsidianKnowledgeBundleGap[];
  preferredPath: 'shared-mcp-internal' | 'shared-obsidian' | 'repo-fallback';
  confidence: number;
};

export type ObsidianRequirementCompileResult = {
  problem: string;
  constraints: string[];
  entities: string[];
  workflows: string[];
  capabilityGaps: string[];
  openQuestions: string[];
  recommendedNextArtifacts: string[];
  sourceArtifacts: ObsidianKnowledgeBundleArtifact[];
  confidence: number;
  bundleSummary: string;
  promotion?: {
    requested: boolean;
    targetPath: string | null;
    written: boolean;
    writtenPath: string | null;
    followUps: string[];
  };
};

export type ObsidianDecisionTraceStep = {
  id: string;
  stepKind: 'artifact' | 'contradiction' | 'supersedes';
  title: string;
  locator: string | null;
  reason: string;
  sourceRole?: ObsidianKnowledgeBundleArtifactSourceRole;
  sourceRefs?: string[];
};

export type ObsidianDecisionTraceResult = {
  subject: string;
  summary: string;
  facts: ObsidianKnowledgeBundleFact[];
  artifacts: ObsidianKnowledgeBundleArtifact[];
  gaps: ObsidianKnowledgeBundleGap[];
  trace: ObsidianDecisionTraceStep[];
  contradictions: ObsidianSemanticLintAuditIssue[];
  supersedes: string[];
  confidence: number;
};

export type ObsidianIncidentGraphResult = {
  incident: string;
  summary: string;
  facts: ObsidianKnowledgeBundleFact[];
  artifacts: ObsidianKnowledgeBundleArtifact[];
  gaps: ObsidianKnowledgeBundleGap[];
  contradictions: ObsidianSemanticLintAuditIssue[];
  affectedServices: string[];
  relatedIncidents: string[];
  relatedPlaybooks: string[];
  relatedImprovements: string[];
  blockers: string[];
  nextActions: string[];
  customerImpactLikely: boolean;
  confidence: number;
};

export type ObsidianKnowledgePromoteArtifactKind = 'note' | 'requirement' | 'ops-note' | 'contract' | 'retrofit' | 'lesson';

export type ObsidianKnowledgePromoteResult = {
  status: 'written' | 'partial' | 'skipped';
  writtenArtifacts: string[];
  skippedReasons: string[];
  targetPath: string | null;
  canonicalKey: string | null;
};

export type ObsidianSemanticLintAuditIssue = {
  id: string;
  kind: 'compiler-lint' | 'coverage-gap' | 'graph-quality' | 'runtime-doc-mismatch';
  severity: 'low' | 'medium' | 'high';
  message: string;
  evidenceRefs: string[];
  suggestedNextStep: string;
};

export type ObsidianSemanticLintPersistenceResult = {
  attempted: boolean;
  summaryPath: string | null;
  issuePaths: string[];
  writtenArtifacts: string[];
  skippedReasons: string[];
};

export type ObsidianSemanticLintAuditResult = {
  summary: string;
  healthy: boolean;
  issueCount: number;
  issues: ObsidianSemanticLintAuditIssue[];
  followUps: string[];
  coverage: {
    totalEntries: number;
    presentEntries: number;
    missingEntries: number;
  };
  persistence?: ObsidianSemanticLintPersistenceResult;
};

export type ObsidianWikiChangeKind = 'repo-memory' | 'architecture-delta' | 'service-change' | 'ops-change' | 'development-slice' | 'changelog-worthy';

export type ObsidianWikiChangeCaptureResult = {
  classification: ObsidianKnowledgePromotionKind[];
  wikiTargets: string[];
  writtenArtifacts: string[];
  mirrorUpdates: string[];
  followUps: string[];
  gaps: ObsidianKnowledgeBundleGap[];
  matchedCatalogEntries: string[];
};

type ObsidianKnowledgeSupervisorAction = {
  kind: 'refresh-grounding' | 'repair-lifecycle' | 'resolve-canonical-collision' | 'backfill-shared-coverage' | 'repair-graph-quality' | 'resolve-runtime-mismatch';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  targetPaths: string[];
  suggestedNextStep: string;
};

type ObsidianKnowledgeSupervisorReport = {
  healthy: boolean;
  summary: string;
  actionCount: number;
  focusPaths: string[];
  actions: ObsidianKnowledgeSupervisorAction[];
};

const state: ObsidianKnowledgeCompilationStats = {
  enabled: true,
  runs: 0,
  skipped: 0,
  failures: 0,
  lastTriggeredAt: null,
  lastCompiledAt: null,
  lastNotePath: null,
  lastReason: null,
  lastArtifacts: [],
  lastTopics: [],
  lastEntityKey: null,
  lastIndexedNotes: 0,
  lastLintSummary: null,
};

const CONTROL_TOWER_BLUEPRINT: ObsidianKnowledgeControlBlueprint = {
  model: '4-plane-control-tower',
  controlPaths: [...CONTROL_TOWER_PATHS],
  reflectionChecklist: [
    'source note or incident evidence captured',
    'topic or operating artifact updated',
    'index and log updated',
    'search visibility verified in the user-visible vault',
    'served vault root matches the intended workspace when remote serving is involved',
  ],
  planes: [
    {
      id: 'control',
      label: 'Control Plane',
      description: 'Canonical policy, cadence, and gate standards that decide what is true.',
      pathPatterns: ['ops/control-tower/**', 'ops/quality/**'],
      primaryQuestions: ['What is canonical?', 'What gate applies?', 'What cadence should run?'],
    },
    {
      id: 'runtime',
      label: 'Runtime Plane',
      description: 'Service memory and live execution boundaries for running systems.',
      pathPatterns: ['ops/services/**'],
      primaryQuestions: ['What is running?', 'What depends on it?', 'How is it recovered?'],
    },
    {
      id: 'record',
      label: 'Record Plane',
      description: 'Visible evidence of what happened, what changed, and who was affected.',
      pathPatterns: ['ops/knowledge-control/**', 'ops/incidents/**', 'ops/vulnerabilities/**', 'guilds/**'],
      primaryQuestions: ['What happened?', 'What evidence exists?', 'Who was affected?'],
    },
    {
      id: 'learning',
      label: 'Learning Plane',
      description: 'Corrections, rules, retros, and validated practices for future behavior.',
      pathPatterns: ['ops/improvement/**', 'retros/**'],
      primaryQuestions: ['What changed in the rules?', 'What should we repeat?', 'What should we stop doing?'],
    },
  ],
};

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

const cloneLintSummary = (value: ObsidianKnowledgeLintSummary | null): ObsidianKnowledgeLintSummary | null => {
  if (!value) {
    return null;
  }

  return {
    ...value,
    issues: value.issues.map((issue) => ({
      ...issue,
      filePaths: [...issue.filePaths],
    })),
  };
};

const cloneBlueprint = (value: ObsidianKnowledgeControlBlueprint): ObsidianKnowledgeControlBlueprint => ({
  ...value,
  controlPaths: [...value.controlPaths],
  reflectionChecklist: [...value.reflectionChecklist],
  planes: value.planes.map((plane) => ({
    ...plane,
    pathPatterns: [...plane.pathPatterns],
    primaryQuestions: [...plane.primaryQuestions],
  })),
});

const cloneCatalogPolicy = (value: ObsidianKnowledgeCatalogPolicy): ObsidianKnowledgeCatalogPolicy => ({
  humanFirst: Boolean(value.humanFirst),
  rules: [...value.rules],
  avoidAsPrimary: [...value.avoidAsPrimary],
});

const cloneCatalogEntry = (value: ObsidianKnowledgeCatalogEntry): ObsidianKnowledgeCatalogEntry => ({
  ...value,
  tags: [...value.tags],
  queries: [...value.queries],
});

const normalizePath = (value: string): string => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');

const matchesPathPrefix = (candidate: string, root: string): boolean => {
  const normalizedCandidate = normalizePath(candidate).toLowerCase();
  const normalizedRoot = normalizePath(root).toLowerCase();
  if (!normalizedCandidate || !normalizedRoot) {
    return false;
  }
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
};

const getPathParent = (value: string, levels = 1): string => {
  const segments = normalizePath(value).split('/').filter(Boolean);
  if (segments.length <= levels) {
    return '';
  }
  return segments.slice(0, segments.length - levels).join('/');
};

const addCandidateRoot = (roots: Set<string>, value: string | null | undefined): void => {
  const normalized = normalizePath(String(value || '')).replace(/\.md$/i, '');
  if (!normalized) {
    return;
  }
  roots.add(normalized);
};

const normalizeCatalogPath = (value: unknown): string => normalizePath(String(value || ''));

const normalizeCatalogAudience = (value: unknown): ObsidianKnowledgeCatalogAudience => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'operator-primary' || normalized === 'agent-support') {
    return normalized;
  }
  return 'shared';
};

const isCompatibilityStubCatalogEntry = (entry: ObsidianKnowledgeCatalogEntry): boolean => {
  return entry.sourceMode === 'compatibility-stub';
};

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
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
    tags: dedupeStrings(Array.isArray(entry.tags) ? entry.tags.map((item) => String(item || '').trim()) : []),
    plane: String(entry.plane || '').trim() || 'record',
    concern: String(entry.concern || '').trim() || 'general-record',
    intent: String(entry.intent || '').trim() || 'memory',
    audience: normalizeCatalogAudience(entry.audience),
    canonical: Boolean(entry.canonical),
    startHere: Boolean(entry.startHere),
    agentReference: entry.agentReference !== false,
    queries: dedupeStrings(Array.isArray(entry.queries) ? entry.queries.map((item) => String(item || '').trim()) : []),
  };
};

const normalizeKnowledgeCatalogPolicy = (value: unknown): ObsidianKnowledgeCatalogPolicy => {
  if (!value || typeof value !== 'object') {
    return cloneCatalogPolicy(DEFAULT_KNOWLEDGE_CATALOG_POLICY);
  }

  const policy = value as Record<string, unknown>;
  return {
    humanFirst: policy.humanFirst !== false,
    rules: dedupeStrings(Array.isArray(policy.rules) ? policy.rules.map((item) => String(item || '').trim()) : DEFAULT_KNOWLEDGE_CATALOG_POLICY.rules),
    avoidAsPrimary: dedupeStrings(Array.isArray(policy.avoidAsPrimary) ? policy.avoidAsPrimary.map((item) => normalizeCatalogPath(item)) : DEFAULT_KNOWLEDGE_CATALOG_POLICY.avoidAsPrimary),
  };
};

const loadKnowledgeBackfillCatalog = (): ObsidianKnowledgeCatalogDocument => {
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

const resolveCatalogVaultPath = (vaultRoot: string, targetPath: string): string => {
  const normalized = normalizeCatalogPath(targetPath).replace(/\.md$/i, '');
  const segments = normalized.split('/').map((segment) => String(segment || '').trim()).filter(Boolean);
  return path.join(path.resolve(vaultRoot), ...segments) + '.md';
};

const resolveCatalogVaultRelativePath = (targetPath: string): string => {
  const normalized = normalizeCatalogPath(targetPath).replace(/^\/+/, '');
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
};

const targetVisibleInSharedVault = async (vaultRoot: string, targetPath: string): Promise<boolean> => {
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

const buildKnowledgeCatalogCoverage = (
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

const buildKnowledgeCatalogCoverageAsync = async (
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

const buildKnowledgeAccessProfile = (
  catalog: ObsidianKnowledgeCatalogDocument,
): ObsidianKnowledgeAccessProfile => {
  const entries = catalog.entries.map(cloneCatalogEntry);
  return {
    humanFirst: catalog.policy.humanFirst,
    rules: [...catalog.policy.rules],
    avoidAsPrimary: [...catalog.policy.avoidAsPrimary],
    startHerePaths: dedupeStrings(entries.filter((entry) => entry.startHere).map((entry) => entry.targetPath)),
    operatorPrimaryPaths: dedupeStrings(entries.filter((entry) => entry.audience === 'operator-primary').map((entry) => entry.targetPath)),
    agentReferencePaths: dedupeStrings(entries.filter((entry) => entry.agentReference).map((entry) => entry.targetPath)),
    canonicalPaths: dedupeStrings(entries.filter((entry) => entry.canonical).map((entry) => entry.targetPath)),
    coverage: buildKnowledgeCatalogCoverage(entries),
  };
};

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(numeric)));
};

const tokenizeGoal = (value: string): string[] => {
  return [...new Set(String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))];
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractMarkdownSection = (content: string, sectionHeading: string): string => {
  const heading = String(sectionHeading || '').trim();
  if (!heading) {
    return content.trim();
  }

  const match = content.match(new RegExp(`(^${escapeRegExp(heading)}\\s*$[\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, 'm'));
  return match?.[1]?.trim() || content.trim();
};

const renderCatalogSourceContent = (entry: ObsidianKnowledgeCatalogEntry, rawSource: string): string => {
  const sourceExtension = path.extname(entry.sourcePath).toLowerCase();
  const body = entry.sectionHeading && sourceExtension === '.md'
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

const classifyPromotionKindForTargetPath = (targetPath: string): ObsidianKnowledgePromotionKind => {
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

const classifyPromotionKindForChangeKind = (changeKind: ObsidianWikiChangeKind): ObsidianKnowledgePromotionKind => {
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

const toSlug = (value: string): string => {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'change';
};

const stripKnownSourcePrefix = (value: string): string => String(value || '').trim().replace(/^(repo|vault|obsidian):/i, '');

const tryParseUrl = (value: string): URL | null => {
  try {
    return /^https?:\/\//i.test(value) ? new URL(value) : null;
  } catch {
    return null;
  }
};

const classifyExplicitSourceArtifactType = (value: string): ObsidianKnowledgeBundleArtifactType => {
  const trimmed = String(value || '').trim();
  const normalized = stripKnownSourcePrefix(trimmed).toLowerCase();
  if (/^(vault|obsidian):/i.test(trimmed)) {
    return 'obsidian-note';
  }
  if (tryParseUrl(trimmed)) {
    return 'internal-doc';
  }
  if (/^(docs|config|scripts|src|\.github)\//i.test(normalized) || /\.(md|json|ya?ml|sql)$/i.test(normalized)) {
    return 'repo-doc';
  }
  if (/^(ops|plans|guilds|chat|retros|contexts|development)\//i.test(normalized)) {
    return 'obsidian-note';
  }
  return 'internal-doc';
};

const buildExplicitSourceTitle = (value: string): string => {
  const trimmed = String(value || '').trim();
  const parsedUrl = tryParseUrl(trimmed);
  if (parsedUrl) {
    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    const hostname = parsedUrl.hostname.replace(/^www\./i, '');
    return `${hostname}${pathname || ''}`;
  }

  const locator = stripKnownSourcePrefix(trimmed);
  return stripMarkdownExtension(path.posix.basename(locator)) || locator || 'explicit-source';
};

const buildExplicitSourceArtifact = (value: string, index: number): ObsidianKnowledgeBundleArtifact => {
  const trimmed = String(value || '').trim();
  const artifactType = classifyExplicitSourceArtifactType(trimmed);
  const locator = artifactType === 'internal-doc'
    ? trimmed
    : normalizeCatalogPath(stripKnownSourcePrefix(trimmed));

  return {
    id: `explicit-source-${index + 1}-${toSlug(buildExplicitSourceTitle(trimmed))}`,
    artifactType,
    title: buildExplicitSourceTitle(trimmed),
    locator,
    whyIncluded: 'explicit trigger source supplied by the caller',
    confidence: 0.68,
    preview: `Explicit trigger source preserved for human-visible provenance.\n${trimmed}`,
    sourceRole: 'trigger',
  };
};

const buildExplicitSourceRef = (artifact: ObsidianKnowledgeBundleArtifact): string => {
  if (artifact.artifactType === 'repo-doc') {
    return `repo:${artifact.locator}`;
  }
  if (artifact.artifactType === 'obsidian-note') {
    return `vault:${artifact.locator}`;
  }
  return artifact.locator;
};

const getArtifactSourceRolePriority = (artifact: ObsidianKnowledgeBundleArtifact): number => {
  switch (artifact.sourceRole) {
    case 'trigger':
      return 0;
    case 'derived':
      return 2;
    case 'supporting':
    default:
      return 1;
  }
};

const sortBundleArtifactsBySourceRole = (artifacts: ObsidianKnowledgeBundleArtifact[]): ObsidianKnowledgeBundleArtifact[] => {
  return [...artifacts].sort((left, right) => getArtifactSourceRolePriority(left) - getArtifactSourceRolePriority(right));
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

const selectKnowledgeBundleEntries = (params: {
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

const dedupeCatalogEntries = (entries: ObsidianKnowledgeCatalogEntry[]): ObsidianKnowledgeCatalogEntry[] => {
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

const mapCatalogIntentToFactType = (intent: string): ObsidianKnowledgeBundleFactType => {
  switch (String(intent || '').trim().toLowerCase()) {
    case 'operations':
      return 'runtime';
    case 'architecture':
      return 'decision';
    case 'memory':
      return 'relationship';
    default:
      return 'plan';
  }
};

const resolveCatalogEntryArtifact = async (entry: ObsidianKnowledgeCatalogEntry): Promise<{
  artifactType: ObsidianKnowledgeBundleArtifactType;
  locator: string;
  preview: string;
  confidence: number;
  sourceRef: string;
  layer: string;
} | null> => {
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';
  const targetPath = normalizeCatalogPath(entry.targetPath);

  if (vaultPath) {
    const vaultContent = await readObsidianFileWithAdapter({
      vaultPath,
      filePath: targetPath,
    });
    if (vaultContent) {
      return {
        artifactType: 'obsidian-note',
        locator: targetPath,
        preview: vaultContent.slice(0, 1600),
        confidence: 0.95,
        sourceRef: `vault:${targetPath}`,
        layer: 'shared-obsidian',
      };
    }
  }

  const sourcePath = path.resolve(REPO_ROOT, entry.sourcePath);
  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  const rawSource = fs.readFileSync(sourcePath, 'utf8');
  const repoFallbackConfidence = isCompatibilityStubCatalogEntry(entry) ? 0.48 : 0.72;
  return {
    artifactType: 'repo-doc',
    locator: normalizeCatalogPath(entry.sourcePath),
    preview: renderCatalogSourceContent(entry, rawSource).slice(0, 1600),
    confidence: repoFallbackConfidence,
    sourceRef: `repo:${entry.sourcePath}`,
    layer: 'repo-docs',
  };
};

const buildKnowledgeBundleSummary = (params: {
  goal: string;
  artifacts: ObsidianKnowledgeBundleArtifact[];
  gaps: ObsidianKnowledgeBundleGap[];
}): string => {
  if (params.artifacts.length === 0) {
    return `No compiled artifacts were found for "${params.goal}".`;
  }

  const titles = params.artifacts.slice(0, 3).map((artifact) => artifact.title).join(', ');
  return `Compiled ${params.artifacts.length} artifacts for "${params.goal}" from ${titles}${params.gaps.length > 0 ? ` with ${params.gaps.length} explicit gaps.` : '.'}`;
};

const buildKnowledgeBundleConfidence = (
  artifacts: ObsidianKnowledgeBundleArtifact[],
  gaps: ObsidianKnowledgeBundleGap[],
): number => {
  const artifactAverage = artifacts.length > 0
    ? artifacts.reduce((sum, artifact) => sum + artifact.confidence, 0) / artifacts.length
    : 0.3;
  const highPenalty = gaps.filter((gap) => gap.severity === 'high').length * 0.15;
  const mediumPenalty = gaps.filter((gap) => gap.severity === 'medium').length * 0.05;
  const lowPenalty = gaps.filter((gap) => gap.severity === 'low').length * 0.02;
  return Number(Math.max(0.05, Math.min(0.99, artifactAverage - highPenalty - mediumPenalty - lowPenalty)).toFixed(2));
};

const catalogEntryMatchesChangedPath = (entry: ObsidianKnowledgeCatalogEntry, changedPaths: string[]): boolean => {
  const sourcePath = normalizeCatalogPath(entry.sourcePath);
  return changedPaths.some((changedPath) => normalizeCatalogPath(changedPath) === sourcePath);
};

export const compileObsidianKnowledgeBundle = async (params: {
  goal: string;
  domains?: string[];
  sourceHints?: string[];
  explicitSources?: string[];
  includeLocalOverlay?: boolean;
  maxArtifacts?: number;
  maxFacts?: number;
  audience?: string;
}): Promise<ObsidianKnowledgeBundleResult> => {
  const goal = toText(params.goal);
  if (!goal) {
    throw new Error('goal is required');
  }

  const domains = toStringArray(params.domains).map((value) => value.toLowerCase()).slice(0, 8);
  const sourceHints = toStringArray(params.sourceHints).map((value) => value.toLowerCase()).slice(0, 8);
  const explicitSources = dedupeStrings(toStringArray(params.explicitSources));
  const includeLocalOverlay = params.includeLocalOverlay === true;
  const maxArtifacts = clampInt(params.maxArtifacts, 8, 1, 12);
  const maxFacts = clampInt(params.maxFacts, 12, 1, 20);
  const audience = toText(params.audience) || 'engineering';
  const explicitSourceArtifacts = explicitSources.slice(0, maxArtifacts).map((source, index) => buildExplicitSourceArtifact(source, index));
  const remainingArtifactSlots = Math.max(0, maxArtifacts - explicitSourceArtifacts.length);

  const catalog = loadKnowledgeBackfillCatalog();
  const surface = getObsidianKnowledgeControlSurface();
  const selectedEntries = remainingArtifactSlots > 0
    ? selectKnowledgeBundleEntries({
      catalog,
      goal,
      domains,
      maxArtifacts: remainingArtifactSlots,
    })
    : [];

  const artifacts: ObsidianKnowledgeBundleArtifact[] = [];
  const facts: ObsidianKnowledgeBundleFact[] = [];
  const gaps: ObsidianKnowledgeBundleGap[] = [];
  const recommendedPromotions: ObsidianKnowledgePromotionCandidate[] = [];
  const resolutionTrace = new Set<string>();

  if (explicitSourceArtifacts.length > 0) {
    artifacts.push(...explicitSourceArtifacts);
    resolutionTrace.add('explicit-source');
    if (facts.length < maxFacts) {
      facts.push({
        id: 'fact-explicit-trigger-sources',
        statement: `Preserved ${explicitSourceArtifacts.length} explicit trigger source${explicitSourceArtifacts.length === 1 ? '' : 's'} for human-visible provenance before implementation work proceeds.`,
        confidence: 0.84,
        sourceRefs: explicitSourceArtifacts.map((artifact) => buildExplicitSourceRef(artifact)).slice(0, 8),
        freshness: 'caller-supplied',
        factType: 'requirement',
      });
    }
  }

  if (surface.accessProfile.coverage.vaultConfigured) {
    resolutionTrace.add('shared-obsidian');
  } else {
    gaps.push({
      id: 'gap-access-shared-obsidian',
      gapType: 'access',
      description: 'Shared Obsidian vault is not configured or not currently visible from this runtime.',
      severity: 'high',
      suggestedNextStep: 'Restore shared vault visibility or rely on repo-doc fallback temporarily.',
    });
  }

  if (domains.includes('company-context') || sourceHints.includes('internal-docs')) {
    gaps.push({
      id: 'gap-access-internal-knowledge',
      gapType: 'access',
      description: 'Company-internal knowledge resolution is not yet compiled directly from the local repository runtime.',
      severity: 'medium',
      suggestedNextStep: 'Route this query through the shared MCP internal knowledge surface before assuming the repository is complete.',
    });
  }

  for (const entry of selectedEntries) {
    const resolvedArtifact = await resolveCatalogEntryArtifact(entry);
    if (!resolvedArtifact) {
      gaps.push({
        id: `gap-missing-${entry.id}`,
        gapType: 'missing',
        description: `${entry.title} could not be loaded from either the shared vault target or the repository source path.`,
        severity: 'high',
        suggestedNextStep: `Verify ${entry.sourcePath} and ${entry.targetPath} are both valid and backfilled.`,
      });
      continue;
    }

    resolutionTrace.add(resolvedArtifact.layer);
    artifacts.push({
      id: entry.id,
      artifactType: resolvedArtifact.artifactType,
      title: entry.title,
      locator: resolvedArtifact.locator,
      whyIncluded: entry.startHere ? 'start-here canonical artifact' : `${entry.concern} artifact matched to the goal`,
      confidence: resolvedArtifact.confidence,
      preview: resolvedArtifact.preview,
      sourceRole: 'supporting',
    });

    if (facts.length < maxFacts) {
      facts.push({
        id: `fact-${entry.id}`,
        statement: `${entry.title} is ${entry.canonical ? 'a canonical' : 'a supporting'} ${entry.concern} artifact for ${entry.intent}.`,
        confidence: resolvedArtifact.confidence,
        sourceRefs: [resolvedArtifact.sourceRef],
        freshness: resolvedArtifact.artifactType === 'obsidian-note' ? 'shared-vault' : 'repo-fallback',
        factType: mapCatalogIntentToFactType(entry.intent),
      });
    }

    if (resolvedArtifact.layer !== 'shared-obsidian') {
      gaps.push({
        id: `gap-promotion-${entry.id}`,
        gapType: 'promotion-needed',
        description: `${entry.title} was resolved from repo source instead of the shared vault target.`,
        severity: 'medium',
        suggestedNextStep: `Backfill ${entry.targetPath} into the shared vault.`,
      });
      recommendedPromotions.push({
        artifactKind: classifyPromotionKindForTargetPath(entry.targetPath),
        title: entry.title,
        reason: 'resolved from repo source fallback instead of shared vault content',
        sourceRefs: [resolvedArtifact.sourceRef],
      });
    }
  }

  if (facts.length < maxFacts) {
    facts.push({
      id: 'fact-human-first-policy',
      statement: 'Operator-primary canonical docs should be preferred over generated knowledge-control artifacts.',
      confidence: 0.96,
      sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'],
      freshness: 'current',
      factType: 'constraint',
    });
  }

  if (facts.length < maxFacts) {
    facts.push({
      id: 'fact-catalog-coverage',
      statement: `${surface.accessProfile.coverage.presentEntries}/${surface.accessProfile.coverage.totalEntries} backfill targets are currently visible in the shared vault.`,
      confidence: 0.9,
      sourceRefs: ['repo:config/runtime/knowledge-backfill-catalog.json'],
      freshness: 'current',
      factType: 'runtime',
    });
  }

  if (explicitSourceArtifacts.length > 0 && artifacts.every((artifact) => artifact.sourceRole === 'trigger')) {
    gaps.push({
      id: 'gap-coverage-explicit-sources-only',
      gapType: 'coverage',
      description: `Only explicit trigger sources were attached for "${goal}"; no supporting shared or repo artifacts were compiled yet.`,
      severity: 'medium',
      suggestedNextStep: 'Seed or resolve supporting shared knowledge before treating this bundle as implementation-ready.',
    });
  }

  if (artifacts.length === 0) {
    gaps.push({
      id: 'gap-coverage-empty-bundle',
      gapType: 'coverage',
      description: `No sufficiently relevant artifacts were compiled for "${goal}".`,
      severity: 'high',
      suggestedNextStep: 'Broaden the goal, add explicit domains, or seed the missing shared wiki objects first.',
    });
  }

  const finalArtifacts = sortBundleArtifactsBySourceRole(dedupeBundleArtifacts(artifacts));
  const finalFacts = dedupeBundleFacts(facts).slice(0, maxFacts);
  const finalGaps = dedupeBundleGaps(gaps);

  return {
    summary: buildKnowledgeBundleSummary({ goal, artifacts: finalArtifacts, gaps: finalGaps }),
    facts: finalFacts,
    artifacts: finalArtifacts,
    gaps: finalGaps,
    recommendedPromotions: dedupePromotionCandidates(recommendedPromotions),
    resolutionTrace: [...resolutionTrace],
    confidence: buildKnowledgeBundleConfidence(finalArtifacts, finalGaps),
    inputs: {
      goal,
      domains,
      sourceHints,
      explicitSources,
      includeLocalOverlay,
      audience,
    },
  };
};

const extractConstraintFragments = (value: string): string[] => {
  return value
    .split(/[\r\n]+|[;]+/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
    .filter((fragment) => /(?:must|should|avoid|preserve|required|need to|필수|반드시|유지|금지|안전|회귀)/i.test(fragment));
};

const buildBundleArtifactLabel = (artifact: ObsidianKnowledgeBundleArtifact): string => {
  const locator = normalizeCatalogPath(artifact.locator);
  const basename = stripMarkdownExtension(path.posix.basename(locator));
  return artifact.title || basename;
};

const inferRequirementWorkflows = (values: string[]): string[] => {
  const joined = values.join(' ').toLowerCase();
  const workflows: Array<[string, boolean]> = [
    ['shared MCP routing and internal knowledge resolution', /(shared mcp|internal knowledge|company-context|internal-docs|mcp)/i.test(joined)],
    ['shared Obsidian wikiization and backfill', /(obsidian|wiki|vault|backfill|promotion|mirror|changelog)/i.test(joined)],
    ['runtime operator snapshot and readiness validation', /(runtime|operator snapshot|scheduler|worker|loop|health|readiness)/i.test(joined)],
    ['requirement compilation and implementation planning', /(requirement|plan|brief|constraint|objective|deliverable)/i.test(joined)],
    ['service or route implementation', /(route|service|tool|adapter|api|endpoint)/i.test(joined)],
  ];

  const resolved = workflows.filter(([, matched]) => matched).map(([label]) => label);
  return resolved.length > 0 ? resolved : ['Clarify the canonical workflow and downstream owners'];
};

const toOpenQuestion = (gap: ObsidianKnowledgeBundleGap): string => {
  if (gap.gapType === 'access') {
    return `Which shared MCP or internal surface should answer this access gap: ${gap.description}`;
  }
  if (gap.gapType === 'missing' || gap.gapType === 'coverage') {
    return `Which missing artifact should be seeded first to cover this gap: ${gap.description}`;
  }
  if (gap.gapType === 'promotion-needed') {
    return `Should this repo fallback be promoted into shared Obsidian now: ${gap.description}`;
  }
  return `How should this gap be resolved: ${gap.description}`;
};

const buildRequirementRecommendations = (params: {
  bundle: ObsidianKnowledgeBundleResult;
  desiredArtifact: string;
}): string[] => {
  const desiredArtifact = toText(params.desiredArtifact);
  return dedupeStrings([
    desiredArtifact ? `${desiredArtifact}: Author or update the canonical artifact for this requirement.` : null,
    ...params.bundle.recommendedPromotions.map((candidate) => `${candidate.artifactKind}: ${candidate.title}`),
    ...params.bundle.gaps
      .filter((gap) => gap.gapType === 'missing' || gap.gapType === 'promotion-needed')
      .map((gap) => gap.suggestedNextStep),
  ]).slice(0, 8);
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

const readRemoteVaultRuntime = (adapterRuntime: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  const remoteMcp = adapterRuntime?.remoteMcp;
  if (!remoteMcp || typeof remoteMcp !== 'object') {
    return null;
  }

  const remoteAdapterRuntime = (remoteMcp as Record<string, unknown>).remoteAdapterRuntime;
  if (!remoteAdapterRuntime || typeof remoteAdapterRuntime !== 'object') {
    return null;
  }

  const vaultRuntime = (remoteAdapterRuntime as Record<string, unknown>).vaultRuntime;
  if (!vaultRuntime || typeof vaultRuntime !== 'object') {
    return null;
  }

  return vaultRuntime as Record<string, unknown>;
};

const buildSemanticLintSummary = (issues: ObsidianSemanticLintAuditIssue[]): string => {
  if (issues.length === 0) {
    return 'No semantic lint issues detected across compiler lint, graph quality, shared coverage, or runtime-vs-doc alignment.';
  }
  return `Detected ${issues.length} semantic lint issues across compiler lint, graph quality, shared coverage, or runtime-vs-doc alignment.`;
};

const buildSemanticLintIssueTargetPath = (issue: ObsidianSemanticLintAuditIssue): string => {
  return `${SEMANTIC_LINT_NEGATIVE_KNOWLEDGE_ROOT}/issues/${issue.kind}-${toSlug(`${issue.id}-${issue.message}`)}.md`;
};

const buildSemanticLintIssueContent = (params: {
  generatedAt: string;
  issue: ObsidianSemanticLintAuditIssue;
  summaryPath: string;
}): string => {
  const title = `${params.issue.kind}: ${params.issue.message}`.slice(0, 160);
  return [
    `# ${title}`,
    '',
    '## Classification',
    `- Kind: ${params.issue.kind}`,
    `- Severity: ${params.issue.severity}`,
    `- Observed At: ${params.generatedAt}`,
    '',
    '## Observation',
    params.issue.message,
    '',
    '## Evidence',
    ...(params.issue.evidenceRefs.length > 0
      ? params.issue.evidenceRefs.map((value) => `- ${value}`)
      : ['- No explicit evidence refs captured.']),
    '',
    '## Suggested Next Step',
    `- ${params.issue.suggestedNextStep}`,
    '',
    '## Control Plane Backlinks',
    `- Current summary: ${params.summaryPath}`,
    '- Generated by: semantic.lint.audit',
  ].join('\n');
};

const buildSemanticLintCurrentContent = (params: {
  generatedAt: string;
  summary: string;
  issues: ObsidianSemanticLintAuditIssue[];
  followUps: string[];
  coverage: ObsidianSemanticLintAuditResult['coverage'];
  issuePaths: string[];
}): string => {
  const openIssueLines = params.issues.length > 0
    ? params.issues.map((issue, index) => {
      const issuePath = params.issuePaths[index] || 'unwritten';
      return [`- [${issue.severity}] ${issue.kind}: ${issue.message}`, `  - Object: ${issuePath}`, `  - Next: ${issue.suggestedNextStep}`].join('\n');
    })
    : ['- No open semantic lint issues.'];

  return [
    '# Semantic Lint Current State',
    '',
    params.summary,
    '',
    '## Snapshot',
    `- Generated At: ${params.generatedAt}`,
    `- Healthy: ${String(params.issues.length === 0)}`,
    `- Issue Count: ${params.issues.length}`,
    `- Coverage: ${params.coverage.presentEntries}/${params.coverage.totalEntries} visible in shared vault`,
    '',
    '## Open Issues',
    ...openIssueLines,
    '',
    '## Follow Ups',
    ...(params.followUps.length > 0 ? params.followUps.map((value) => `- ${value}`) : ['- No explicit follow-ups.']),
  ].join('\n');
};

const persistSemanticLintAuditResult = async (params: {
  generatedAt: string;
  summary: string;
  issues: ObsidianSemanticLintAuditIssue[];
  followUps: string[];
  coverage: ObsidianSemanticLintAuditResult['coverage'];
}): Promise<ObsidianSemanticLintPersistenceResult> => {
  const issuePaths = params.issues.map((issue) => buildSemanticLintIssueTargetPath(issue));
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';
  if (!vaultPath) {
    return {
      attempted: false,
      summaryPath: SEMANTIC_LINT_CURRENT_PATH,
      issuePaths,
      writtenArtifacts: [],
      skippedReasons: ['shared vault is not configured or not visible'],
    };
  }

  const writtenArtifacts: string[] = [];
  const skippedReasons: string[] = [];

  for (const issue of params.issues) {
    const issuePath = buildSemanticLintIssueTargetPath(issue);
    const writeResult = await upsertObsidianSystemDocument({
      vaultPath,
      fileName: stripMarkdownExtension(issuePath),
      content: buildSemanticLintIssueContent({
        generatedAt: params.generatedAt,
        issue,
        summaryPath: SEMANTIC_LINT_CURRENT_PATH,
      }),
      tags: ['semantic-lint', 'negative-knowledge', issue.kind, issue.severity],
      allowHighLinkDensity: true,
      skipKnowledgeCompilation: true,
      properties: {
        title: `${issue.kind}: ${issue.message}`.slice(0, 160),
        source_kind: 'semantic-lint-issue',
        generated_by: 'semantic.lint.audit',
        canonical_key: `semantic-lint/${issue.kind}/${toSlug(issue.id || issue.message)}`,
        issue_kind: issue.kind,
        severity: issue.severity,
        observed_at: params.generatedAt,
      },
    });

    if (writeResult.ok && writeResult.path) {
      writtenArtifacts.push(writeResult.path);
      continue;
    }

    skippedReasons.push(`failed to write ${issuePath}`);
  }

  const summaryWrite = await upsertObsidianSystemDocument({
    vaultPath,
    fileName: stripMarkdownExtension(SEMANTIC_LINT_CURRENT_PATH),
    content: buildSemanticLintCurrentContent({
      generatedAt: params.generatedAt,
      summary: params.summary,
      issues: params.issues,
      followUps: params.followUps,
      coverage: params.coverage,
      issuePaths,
    }),
    tags: ['semantic-lint', 'negative-knowledge', 'current'],
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
    properties: {
      title: 'Semantic Lint Current State',
      source_kind: 'semantic-lint-current',
      generated_by: 'semantic.lint.audit',
      canonical_key: 'semantic-lint/current',
      issue_count: params.issues.length,
      observed_at: params.generatedAt,
      healthy: params.issues.length === 0,
    },
  });

  if (summaryWrite.ok && summaryWrite.path) {
    writtenArtifacts.push(summaryWrite.path);
  } else {
    skippedReasons.push(`failed to write ${SEMANTIC_LINT_CURRENT_PATH}`);
  }

  return {
    attempted: true,
    summaryPath: SEMANTIC_LINT_CURRENT_PATH,
    issuePaths,
    writtenArtifacts,
    skippedReasons,
  };
};

const mapVaultPathToFactType = (filePath: string): ObsidianKnowledgeBundleFactType => {
  const normalized = normalizeCatalogPath(filePath).toLowerCase();
  if (normalized.includes('/decisions/') || normalized.includes('decision')) {
    return 'decision';
  }
  if (normalized.includes('/requirements/') || normalized.includes('requirement')) {
    return 'requirement';
  }
  if (normalized.includes('/services/') || normalized.includes('/runtime/')) {
    return 'runtime';
  }
  if (normalized.includes('/playbook') || normalized.includes('/runbook') || normalized.includes('/ops/')) {
    return 'relationship';
  }
  return 'plan';
};

const buildInternalSearchQueries = (goal: string, targets: string[], sourceHints: string[]): string[] => {
  const compactGoal = toText(goal).replace(/\s+/g, ' ').slice(0, 180);
  return dedupeStrings([
    targets.length > 0 ? `${targets.join(' ')} ${compactGoal}`.trim() : compactGoal,
    compactGoal,
    ...targets,
    ...sourceHints
      .filter((hint) => hint !== 'internal-docs' && hint !== 'obsidian')
      .map((hint) => `${hint} ${compactGoal}`.trim()),
  ]).slice(0, 4);
};

const dedupeBundleArtifacts = (artifacts: ObsidianKnowledgeBundleArtifact[]): ObsidianKnowledgeBundleArtifact[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeBundleArtifact[] = [];
  for (const artifact of artifacts) {
    const key = `${normalizeCatalogPath(artifact.locator)}:${artifact.title}`;
    if (!artifact.locator || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(artifact);
  }
  return result;
};

const dedupeBundleFacts = (facts: ObsidianKnowledgeBundleFact[]): ObsidianKnowledgeBundleFact[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeBundleFact[] = [];
  for (const fact of facts) {
    const key = `${fact.statement}:${fact.factType}`;
    if (!fact.statement || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(fact);
  }
  return result;
};

const dedupeBundleGaps = (gaps: ObsidianKnowledgeBundleGap[]): ObsidianKnowledgeBundleGap[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeBundleGap[] = [];
  for (const gap of gaps) {
    const key = gap.id || `${gap.gapType}:${gap.description}`;
    if (!gap.description || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(gap);
  }
  return result;
};

const buildSharedArtifactFactStatement = (params: {
  title: string;
  filePath: string;
  goal: string;
  frontmatter?: Record<string, unknown>;
}): string => {
  const canonicalKey = toText(params.frontmatter?.canonical_key);
  const status = toText(params.frontmatter?.status);
  const artifactKind = mapVaultPathToFactType(params.filePath);
  const qualifiers = dedupeStrings([
    canonicalKey ? `canonical: ${canonicalKey}` : null,
    status ? `status: ${status}` : null,
  ]);
  const qualifierSuffix = qualifiers.length > 0 ? ` (${qualifiers.join(', ')})` : '';
  return `${params.title} is a shared ${artifactKind} artifact relevant to "${params.goal}"${qualifierSuffix}.`;
};

const resolveDirectInternalArtifacts = async (params: {
  goal: string;
  targets: string[];
  sourceHints: string[];
  maxArtifacts: number;
  maxFacts: number;
}): Promise<{
  artifacts: ObsidianKnowledgeBundleArtifact[];
  facts: ObsidianKnowledgeBundleFact[];
  gaps: ObsidianKnowledgeBundleGap[];
  accessNotes: string[];
  preferredPath: 'shared-mcp-internal' | 'shared-obsidian' | 'repo-fallback';
  confidence: number;
}> => {
  const vaultRuntime = getObsidianVaultRuntimeInfo();
  const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';

  if (!vaultPath) {
    return {
      artifacts: [],
      facts: [],
      gaps: [{
        id: 'gap-access-shared-internal-vault',
        gapType: 'access',
        description: 'Shared Obsidian vault is not configured or not currently visible from this runtime.',
        severity: 'high',
        suggestedNextStep: 'Restore shared vault visibility before treating repo-local fallback as complete.',
      }],
      accessNotes: [],
      preferredPath: 'repo-fallback',
      confidence: 0.28,
    };
  }

  const adapterStatus = getObsidianAdapterRuntimeStatus();
  const selectedSearchAdapter = toText(adapterStatus.selectedByCapability?.search_vault);
  const selectedReadAdapter = toText(adapterStatus.selectedByCapability?.read_file);
  const preferredPath = selectedSearchAdapter === 'remote-mcp' || selectedReadAdapter === 'remote-mcp'
    ? 'shared-mcp-internal'
    : 'shared-obsidian';

  const accessNotes = dedupeStrings([
    preferredPath === 'shared-mcp-internal'
      ? 'Resolved internal knowledge through the shared MCP-backed Obsidian adapter.'
      : 'Resolved internal knowledge from the shared Obsidian vault through the active adapter chain.',
    selectedSearchAdapter ? `search_vault adapter selected: ${selectedSearchAdapter}.` : null,
    selectedReadAdapter && selectedReadAdapter !== selectedSearchAdapter ? `read_file adapter selected: ${selectedReadAdapter}.` : null,
    'Prefer the shared MCP internal knowledge surface before assuming repo-local context is complete.',
  ]);

  const rankedResults = new Map<string, { title: string; score: number; matchedBy: string[] }>();
  for (const query of buildInternalSearchQueries(params.goal, params.targets, params.sourceHints)) {
    const searchResults = await searchObsidianVaultWithAdapter({
      vaultPath,
      query,
      limit: Math.min(16, Math.max(params.maxArtifacts * 2, 6)),
    });

    for (const result of searchResults) {
      const locator = normalizeCatalogPath(result.filePath);
      if (!locator) {
        continue;
      }
      const current = rankedResults.get(locator);
      if (!current || result.score > current.score) {
        rankedResults.set(locator, {
          title: result.title,
          score: Number(result.score || 0),
          matchedBy: current ? dedupeStrings([...current.matchedBy, query]) : [query],
        });
        continue;
      }
      current.matchedBy = dedupeStrings([...current.matchedBy, query]);
    }
  }

  const selectedResults = [...rankedResults.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, params.maxArtifacts);

  if (selectedResults.length === 0) {
    return {
      artifacts: [],
      facts: [],
      gaps: [{
        id: 'gap-coverage-shared-internal-search',
        gapType: 'coverage',
        description: `No directly matched shared vault artifacts were found for "${params.goal}".`,
        severity: 'medium',
        suggestedNextStep: 'Seed or retitle the relevant shared wiki object so internal retrieval can resolve it directly.',
      }],
      accessNotes,
      preferredPath,
      confidence: 0.46,
    };
  }

  const artifacts: ObsidianKnowledgeBundleArtifact[] = [];
  const facts: ObsidianKnowledgeBundleFact[] = [];

  for (const [filePath, result] of selectedResults) {
    const rawContent = await readObsidianFileWithAdapter({ vaultPath, filePath });
    const frontmatter = rawContent ? parseObsidianFrontmatter(rawContent) : undefined;
    const title = toText(frontmatter?.title) || toText(result.title) || stripMarkdownExtension(path.posix.basename(filePath));
    const preview = (rawContent ? stripFrontmatterBlock(rawContent) : '').slice(0, 1600) || title;
    const confidence = Number(Math.max(0.66, Math.min(0.98, 0.68 + Math.min(result.score, 1) * 0.24)).toFixed(2));
    const sourceRefs = dedupeStrings([
      `vault:${filePath}`,
      ...toStringArray(frontmatter?.source_refs),
    ]);

    artifacts.push({
      id: `shared-${toSlug(filePath)}`,
      artifactType: 'obsidian-note',
      title,
      locator: filePath,
      whyIncluded: `direct shared retrieval matched ${result.matchedBy.join(' | ')}`,
      confidence,
      preview,
    });

    facts.push({
      id: `fact-shared-${toSlug(filePath)}`,
      statement: buildSharedArtifactFactStatement({
        title,
        filePath,
        goal: params.goal,
        frontmatter,
      }),
      confidence,
      sourceRefs,
      freshness: 'shared-vault',
      factType: mapVaultPathToFactType(filePath),
    });
  }

  return {
    artifacts,
    facts: facts.slice(0, params.maxFacts),
    gaps: [],
    accessNotes,
    preferredPath,
    confidence: buildKnowledgeBundleConfidence(artifacts, []),
  };
};

const resolveInternalKnowledgeFromBundle = async (params: {
  goal: string;
  targets: string[];
  sourceHints: string[];
  includeRelatedArtifacts: boolean;
  maxArtifacts: number;
  maxFacts: number;
  bundle: ObsidianKnowledgeBundleResult;
}): Promise<ObsidianInternalKnowledgeResolveResult> => {
  const direct = await resolveDirectInternalArtifacts({
    goal: params.goal,
    targets: params.targets,
    sourceHints: params.sourceHints,
    maxArtifacts: Math.min(params.maxArtifacts, params.includeRelatedArtifacts ? params.maxArtifacts : Math.max(2, params.maxArtifacts - 1)),
    maxFacts: params.maxFacts,
  });

  const directResolutionSucceeded = direct.artifacts.length > 0;
  const filteredBundleGaps = params.bundle.gaps.filter((gap) => {
    if (!directResolutionSucceeded) {
      return true;
    }
    return gap.id !== 'gap-access-internal-knowledge';
  });

  const supportingArtifacts = params.includeRelatedArtifacts
    ? params.bundle.artifacts
    : params.bundle.artifacts.slice(0, Math.max(0, params.maxArtifacts - direct.artifacts.length));
  const combinedArtifacts = dedupeBundleArtifacts([
    ...direct.artifacts,
    ...supportingArtifacts,
  ]).slice(0, params.maxArtifacts);
  const combinedFacts = dedupeBundleFacts([
    ...direct.facts,
    ...params.bundle.facts,
  ]).slice(0, params.maxFacts);
  const combinedGaps = dedupeBundleGaps([
    ...direct.gaps,
    ...filteredBundleGaps,
  ]);
  const accessNotes = dedupeStrings([
    ...direct.accessNotes,
    directResolutionSucceeded && params.bundle.resolutionTrace.includes('repo-docs')
      ? 'Repo fallback artifacts were retained only as supporting context after direct shared retrieval.'
      : null,
    !directResolutionSucceeded && filteredBundleGaps.some((gap) => gap.id === 'gap-access-internal-knowledge')
      ? 'Direct shared retrieval did not fully resolve the company-context gap; keep treating repo-local context as incomplete.'
      : null,
  ]);

  const preferredPath = directResolutionSucceeded
    ? direct.preferredPath
    : filteredBundleGaps.some((gap) => gap.id === 'gap-access-internal-knowledge')
      ? 'shared-mcp-internal'
      : params.bundle.resolutionTrace.includes('shared-obsidian')
        ? 'shared-obsidian'
        : 'repo-fallback';
  const confidence = Number(Math.max(
    directResolutionSucceeded ? direct.confidence : 0,
    buildKnowledgeBundleConfidence(combinedArtifacts, combinedGaps),
    params.bundle.confidence,
  ).toFixed(2));

  return {
    summary: directResolutionSucceeded
      ? `Resolved ${direct.artifacts.length} direct shared artifacts and ${Math.max(0, combinedArtifacts.length - direct.artifacts.length)} supporting artifacts for "${params.goal}" via ${preferredPath}.`
      : combinedArtifacts.length > 0
        ? `Resolved ${combinedArtifacts.length} supporting internal knowledge artifacts for "${params.goal}" via ${preferredPath}.`
        : `No direct internal knowledge artifacts were resolved for "${params.goal}".`,
    facts: combinedFacts,
    artifacts: combinedArtifacts,
    redactions: [],
    accessNotes,
    gaps: combinedGaps,
    preferredPath,
    confidence,
  };
};

const readArtifactSourceDocument = async (artifact: ObsidianKnowledgeBundleArtifact): Promise<{
  locator: string;
  content: string;
  frontmatter: Record<string, unknown>;
} | null> => {
  const locator = normalizeCatalogPath(stripKnownSourcePrefix(artifact.locator));
  if (!locator) {
    return null;
  }

  if (artifact.artifactType === 'obsidian-note') {
    const vaultRuntime = getObsidianVaultRuntimeInfo();
    const vaultPath = vaultRuntime.configured && vaultRuntime.exists ? vaultRuntime.root : '';
    if (!vaultPath) {
      return null;
    }

    const content = await readObsidianFileWithAdapter({
      vaultPath,
      filePath: locator,
    });
    if (!content) {
      return null;
    }

    return {
      locator,
      content,
      frontmatter: parseObsidianFrontmatter(content) || {},
    };
  }

  if (artifact.artifactType === 'repo-doc' || artifact.artifactType === 'code-bundle' || artifact.artifactType === 'local-overlay' || artifact.artifactType === 'runtime-snapshot') {
    const resolvedPath = path.resolve(REPO_ROOT, locator);
    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    const content = fs.readFileSync(resolvedPath, 'utf8');
    return {
      locator,
      content,
      frontmatter: parseObsidianFrontmatter(content) || {},
    };
  }

  return null;
};

const buildKnowledgeReferenceSet = (artifacts: ObsidianKnowledgeBundleArtifact[], facts: ObsidianKnowledgeBundleFact[]): Set<string> => {
  const refs = new Set<string>();
  for (const artifact of artifacts) {
    const locator = normalizeCatalogPath(stripKnownSourcePrefix(artifact.locator));
    if (locator) {
      refs.add(locator);
    }
  }
  for (const fact of facts) {
    for (const sourceRef of fact.sourceRefs) {
      const normalized = normalizeCatalogPath(stripKnownSourcePrefix(sourceRef));
      if (normalized) {
        refs.add(normalized);
      }
    }
  }
  return refs;
};

const selectRelevantSemanticIssues = (issues: ObsidianSemanticLintAuditIssue[], references: Set<string>, maxIssues: number): ObsidianSemanticLintAuditIssue[] => {
  return issues.filter((issue) => {
    if (issue.kind === 'runtime-doc-mismatch') {
      return true;
    }
    return issue.evidenceRefs.some((value) => references.has(normalizeCatalogPath(stripKnownSourcePrefix(value))));
  }).slice(0, maxIssues);
};

const extractAffectedServicesFromLocators = (values: string[]): string[] => {
  return dedupeStrings(values.map((value) => {
    const normalized = normalizeCatalogPath(value);
    return normalized.match(/ops\/services\/([^/]+)/)?.[1] || null;
  })).slice(0, 8);
};

const collectArtifactSupersedes = async (artifacts: ObsidianKnowledgeBundleArtifact[]): Promise<string[]> => {
  const supersedes = new Set<string>();
  for (const artifact of artifacts) {
    const document = await readArtifactSourceDocument(artifact);
    for (const value of toStringArray(document?.frontmatter?.supersedes)) {
      const normalized = normalizeCatalogPath(stripKnownSourcePrefix(value));
      if (normalized) {
        supersedes.add(normalized);
      }
    }
  }
  return [...supersedes].slice(0, 12);
};

const buildDecisionTraceSteps = (params: {
  artifacts: ObsidianKnowledgeBundleArtifact[];
  contradictions: ObsidianSemanticLintAuditIssue[];
  supersedes: string[];
}): ObsidianDecisionTraceStep[] => {
  return [
    ...params.artifacts.map((artifact, index) => ({
      id: `trace-artifact-${index + 1}`,
      stepKind: 'artifact' as const,
      title: artifact.title,
      locator: artifact.locator,
      reason: artifact.whyIncluded,
      sourceRole: artifact.sourceRole,
    })),
    ...params.contradictions.map((issue, index) => ({
      id: `trace-contradiction-${index + 1}`,
      stepKind: 'contradiction' as const,
      title: issue.message,
      locator: issue.evidenceRefs[0] || null,
      reason: issue.suggestedNextStep,
      sourceRefs: issue.evidenceRefs,
    })),
    ...params.supersedes.map((value, index) => ({
      id: `trace-supersedes-${index + 1}`,
      stepKind: 'supersedes' as const,
      title: value,
      locator: value,
      reason: 'Referenced as a superseded or replaced prior object in the traced material.',
    })),
  ].slice(0, 18);
};

export const traceObsidianDecision = async (params: {
  subject: string;
  targets?: string[];
  sourceHints?: string[];
  explicitSources?: string[];
  maxArtifacts?: number;
  maxFacts?: number;
  audience?: string;
}): Promise<ObsidianDecisionTraceResult> => {
  const subject = toText(params.subject);
  if (!subject) {
    throw new Error('subject is required');
  }

  const targets = dedupeStrings(toStringArray(params.targets));
  const sourceHints = dedupeStrings(['obsidian', 'internal-docs', ...toStringArray(params.sourceHints).map((value) => value.toLowerCase())]);
  const explicitSources = dedupeStrings(toStringArray(params.explicitSources));
  const maxArtifacts = clampInt(params.maxArtifacts, 6, 1, 12);
  const maxFacts = clampInt(params.maxFacts, 10, 1, 16);

  const bundle = await compileObsidianKnowledgeBundle({
    goal: targets.length > 0 ? `${subject} | targets: ${targets.join(', ')}` : subject,
    domains: ['architecture', 'requirements', 'ops'],
    sourceHints,
    explicitSources,
    maxArtifacts,
    maxFacts,
    audience: toText(params.audience) || 'engineering',
  });
  const internalKnowledge = await resolveInternalKnowledgeFromBundle({
    goal: subject,
    targets: dedupeStrings([subject, ...targets]),
    sourceHints,
    includeRelatedArtifacts: true,
    maxArtifacts,
    maxFacts,
    bundle,
  });
  const artifacts = sortBundleArtifactsBySourceRole(dedupeBundleArtifacts([
    ...internalKnowledge.artifacts,
    ...bundle.artifacts,
  ])).slice(0, maxArtifacts);
  const facts = dedupeBundleFacts([
    ...internalKnowledge.facts,
    ...bundle.facts,
  ]).slice(0, maxFacts);
  const gaps = dedupeBundleGaps([
    ...bundle.gaps,
    ...internalKnowledge.gaps,
  ]);
  const lint = await runObsidianSemanticLintAudit({
    maxIssues: 6,
    includeGraphAudit: false,
    persistFindings: false,
  });
  const contradictions = selectRelevantSemanticIssues(lint.issues, buildKnowledgeReferenceSet(artifacts, facts), 6);
  const supersedes = await collectArtifactSupersedes(artifacts);
  const confidence = Number(Math.max(
    0.05,
    Math.min(0.99, ((bundle.confidence + internalKnowledge.confidence) / 2) - (contradictions.length * 0.03)),
  ).toFixed(2));

  return {
    subject,
    summary: `Traced "${subject}" through ${artifacts.length} artifacts, ${contradictions.length} contradiction signals, and ${gaps.length} explicit gaps.`,
    facts,
    artifacts,
    gaps,
    trace: buildDecisionTraceSteps({ artifacts, contradictions, supersedes }),
    contradictions,
    supersedes,
    confidence,
  };
};

export const resolveObsidianIncidentGraph = async (params: {
  incident: string;
  serviceHints?: string[];
  sourceHints?: string[];
  explicitSources?: string[];
  maxArtifacts?: number;
  maxFacts?: number;
  includeImprovements?: boolean;
  audience?: string;
}): Promise<ObsidianIncidentGraphResult> => {
  const incident = toText(params.incident);
  if (!incident) {
    throw new Error('incident is required');
  }

  const serviceHints = dedupeStrings(toStringArray(params.serviceHints));
  const sourceHints = dedupeStrings(['obsidian', 'internal-docs', 'runtime', ...toStringArray(params.sourceHints).map((value) => value.toLowerCase())]);
  const explicitSources = dedupeStrings(toStringArray(params.explicitSources));
  const includeImprovements = params.includeImprovements !== false;
  const maxArtifacts = clampInt(params.maxArtifacts, 8, 1, 12);
  const maxFacts = clampInt(params.maxFacts, 10, 1, 16);
  const targets = dedupeStrings([
    incident,
    ...serviceHints,
    'incident',
    'runbook',
    'playbook',
    'postmortem',
    'rollback',
    'recovery',
    includeImprovements ? 'improvement' : null,
  ]);

  const bundle = await compileObsidianKnowledgeBundle({
    goal: `incident graph: ${incident}${serviceHints.length > 0 ? ` | services: ${serviceHints.join(', ')}` : ''}`,
    domains: ['ops', 'runtime', 'requirements'],
    sourceHints,
    explicitSources,
    maxArtifacts,
    maxFacts,
    audience: toText(params.audience) || 'ops',
  });
  const internalKnowledge = await resolveInternalKnowledgeFromBundle({
    goal: `incident graph ${incident}`,
    targets,
    sourceHints,
    includeRelatedArtifacts: true,
    maxArtifacts,
    maxFacts,
    bundle,
  });
  const artifacts = sortBundleArtifactsBySourceRole(dedupeBundleArtifacts([
    ...internalKnowledge.artifacts,
    ...bundle.artifacts,
  ])).slice(0, maxArtifacts);
  const facts = dedupeBundleFacts([
    ...internalKnowledge.facts,
    ...bundle.facts,
  ]).slice(0, maxFacts);
  const gaps = dedupeBundleGaps([
    ...bundle.gaps,
    ...internalKnowledge.gaps,
  ]);
  const lint = await runObsidianSemanticLintAudit({
    maxIssues: 6,
    includeGraphAudit: false,
    persistFindings: false,
  });
  const contradictions = selectRelevantSemanticIssues(lint.issues, buildKnowledgeReferenceSet(artifacts, facts), 6);
  const artifactLocators = artifacts.map((artifact) => artifact.locator);
  const relationshipArtifacts = dedupeBundleArtifacts([
    ...internalKnowledge.artifacts,
    ...artifacts,
  ]);
  const relatedIncidents = dedupeStrings(relationshipArtifacts
    .filter((artifact) => /ops\/incidents\/|incident|postmortem/i.test(`${artifact.locator} ${artifact.title}`))
    .map((artifact) => artifact.locator)).slice(0, 8);
  const relatedPlaybooks = dedupeStrings(relationshipArtifacts
    .filter((artifact) => /playbook|runbook/i.test(`${artifact.locator} ${artifact.title}`))
    .map((artifact) => artifact.locator)).slice(0, 8);
  const relatedImprovements = includeImprovements
    ? dedupeStrings(relationshipArtifacts
      .filter((artifact) => /improvement|lesson|retro/i.test(`${artifact.locator} ${artifact.title}`))
      .map((artifact) => artifact.locator)).slice(0, 8)
    : [];
  const affectedServices = dedupeStrings([
    ...serviceHints,
    ...extractAffectedServicesFromLocators(artifactLocators),
  ]).slice(0, 8);
  const blockers = dedupeStrings([
    ...gaps.map((gap) => gap.description),
    ...contradictions.filter((issue) => issue.severity !== 'low').map((issue) => issue.message),
  ]).slice(0, 8);
  const nextActions = dedupeStrings([
    ...gaps.map((gap) => gap.suggestedNextStep),
    ...contradictions.map((issue) => issue.suggestedNextStep),
  ]).slice(0, 8);
  const customerImpactLikely = artifacts.some((artifact) => /guild|customer|user|incident/i.test(`${artifact.locator} ${artifact.title}`)) || blockers.length > 0;
  const confidence = Number(Math.max(
    0.05,
    Math.min(0.99, ((bundle.confidence + internalKnowledge.confidence) / 2) - (contradictions.length * 0.03)),
  ).toFixed(2));

  return {
    incident,
    summary: `Resolved incident graph for "${incident}" from ${artifacts.length} artifacts across ${affectedServices.length} services with ${blockers.length} blockers and ${nextActions.length} next actions.`,
    facts,
    artifacts,
    gaps,
    contradictions,
    affectedServices,
    relatedIncidents,
    relatedPlaybooks,
    relatedImprovements,
    blockers,
    nextActions,
    customerImpactLikely,
    confidence,
  };
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

const promoteCompiledRequirement = async (params: {
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

export const runObsidianSemanticLintAudit = async (params?: {
  maxIssues?: number;
  includeGraphAudit?: boolean;
  persistFindings?: boolean;
}): Promise<ObsidianSemanticLintAuditResult> => {
  const maxIssues = clampInt(params?.maxIssues, 12, 1, 30);
  const issues: ObsidianSemanticLintAuditIssue[] = [];
  const compiler = getObsidianKnowledgeCompilationStats();
  const coverage = await buildKnowledgeCatalogCoverageAsync(loadKnowledgeBackfillCatalog().entries);
  const graphAudit = params?.includeGraphAudit === false
    ? null
    : await getLatestObsidianGraphAuditSnapshot().catch(() => null);
  const localVault = getObsidianVaultRuntimeInfo();
  const adapterRuntime = getObsidianAdapterRuntimeStatus() as Record<string, unknown>;

  for (const issue of compiler.lastLintSummary?.issues || []) {
    issues.push({
      id: `compiler-${issue.kind}-${toSlug(issue.message)}`,
      kind: 'compiler-lint',
      severity: issue.kind === 'canonical_collision' || issue.kind === 'invalid_lifecycle' ? 'medium' : 'low',
      message: issue.message,
      evidenceRefs: issue.filePaths,
      suggestedNextStep: 'Refresh the corresponding knowledge-control artifact and source refs so the semantic owner remains current.',
    });
  }

  if (coverage.missingEntries > 0) {
    issues.push({
      id: 'coverage-missing-shared-targets',
      kind: 'coverage-gap',
      severity: coverage.operatorPrimaryMissing > 0 || coverage.startHereMissing > 0 ? 'high' : 'medium',
      message: `${coverage.missingEntries} shared wiki targets are still missing from the verified shared-vault view.`,
      evidenceRefs: coverage.missingTargetPaths.slice(0, 6),
      suggestedNextStep: 'Backfill missing shared wiki targets before treating repo mirrors as canonical.',
    });
  }

  if (graphAudit) {
    if (graphAudit.totals.unresolvedLinks > 0) {
      issues.push({
        id: 'graph-unresolved-links',
        kind: 'graph-quality',
        severity: graphAudit.totals.unresolvedLinks > graphAudit.thresholds.unresolvedLinks ? 'high' : 'medium',
        message: `${graphAudit.totals.unresolvedLinks} unresolved links are present in the shared graph.`,
        evidenceRefs: [LINT_PATH],
        suggestedNextStep: 'Resolve or retarget unresolved links so object pages stay traversable.',
      });
    }
    if (graphAudit.totals.orphanFiles > 0) {
      issues.push({
        id: 'graph-orphan-files',
        kind: 'graph-quality',
        severity: graphAudit.totals.orphanFiles > graphAudit.thresholds.orphanFiles ? 'high' : 'medium',
        message: `${graphAudit.totals.orphanFiles} orphan files are disconnected from the current semantic graph.`,
        evidenceRefs: [LINT_PATH],
        suggestedNextStep: 'Add backlinks or hub references so active objects do not become dead ends.',
      });
    }
    if (graphAudit.totals.missingRequiredPropertyFiles > 0) {
      issues.push({
        id: 'graph-missing-required-properties',
        kind: 'graph-quality',
        severity: 'medium',
        message: `${graphAudit.totals.missingRequiredPropertyFiles} files are missing required metadata properties.`,
        evidenceRefs: [LINT_PATH],
        suggestedNextStep: 'Normalize frontmatter so canonical key, freshness, and provenance remain machine-readable.',
      });
    }
  }

  const selectedByCapability = adapterRuntime.selectedByCapability as Record<string, unknown> | undefined;
  const remoteSelectedForWrite = selectedByCapability?.write_note === 'remote-mcp';
  const remoteVaultRuntime = readRemoteVaultRuntime(adapterRuntime);
  if (remoteSelectedForWrite && !remoteVaultRuntime) {
    issues.push({
      id: 'runtime-remote-vault-missing',
      kind: 'runtime-doc-mismatch',
      severity: 'high',
      message: 'remote-mcp is selected for writes but remote vault runtime details are unavailable.',
      evidenceRefs: ['obsidian.adapter.status'],
      suggestedNextStep: 'Re-probe the shared MCP adapter and verify remote vault parity before trusting write success.',
    });
  }
  if (remoteSelectedForWrite && remoteVaultRuntime) {
    const localName = toText(localVault.resolvedName);
    const remoteName = toText(remoteVaultRuntime.resolvedName);
    const localDesktop = Boolean(localVault.looksLikeDesktopVault);
    const remoteDesktop = Boolean(remoteVaultRuntime.looksLikeDesktopVault);
    const sharedTopLevel = ['chat', 'guilds', 'ops'].filter((dir) =>
      (localVault.topLevelDirectories || []).includes(dir)
      && Array.isArray(remoteVaultRuntime.topLevelDirectories)
      && remoteVaultRuntime.topLevelDirectories.includes(dir),
    );
    if ((localName && remoteName && localName !== remoteName) || !localDesktop || !remoteDesktop || sharedTopLevel.length < 3) {
      issues.push({
        id: 'runtime-vault-parity-mismatch',
        kind: 'runtime-doc-mismatch',
        severity: 'high',
        message: 'Shared write routing is active but local and remote vault shapes are not fully aligned.',
        evidenceRefs: ['obsidian.adapter.status', 'operator.snapshot'],
        suggestedNextStep: 'Align remote vault shape and resolved vault identity before relying on semantic owner writes.',
      });
    }
  }

  const uniqueIssues = dedupeSemanticLintIssues(issues).slice(0, maxIssues);
  const summary = buildSemanticLintSummary(uniqueIssues);
  const followUps = dedupeStrings(uniqueIssues.map((issue) => issue.suggestedNextStep));
  const coverageSummary = {
    totalEntries: coverage.totalEntries,
    presentEntries: coverage.presentEntries,
    missingEntries: coverage.missingEntries,
  };
  const persistence = params?.persistFindings === false
    ? undefined
    : await persistSemanticLintAuditResult({
      generatedAt: new Date().toISOString(),
      summary,
      issues: uniqueIssues,
      followUps,
      coverage: coverageSummary,
    });
  return {
    summary,
    healthy: uniqueIssues.length === 0,
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    followUps,
    coverage: coverageSummary,
    persistence,
  };
};

export const resolveInternalKnowledge = async (params: {
  goal: string;
  targets?: string[];
  sourceHints?: string[];
  includeRelatedArtifacts?: boolean;
  maxArtifacts?: number;
  maxFacts?: number;
  audience?: string;
}): Promise<ObsidianInternalKnowledgeResolveResult> => {
  const goal = toText(params.goal);
  if (!goal) {
    throw new Error('goal is required');
  }

  const targets = dedupeStrings(toStringArray(params.targets));
  const sourceHints = dedupeStrings(['internal-docs', ...toStringArray(params.sourceHints).map((value) => value.toLowerCase())]);
  const includeRelatedArtifacts = params.includeRelatedArtifacts === true;
  const maxArtifacts = includeRelatedArtifacts
    ? clampInt(params.maxArtifacts, 8, 1, 12)
    : clampInt(params.maxArtifacts, 4, 1, 8);
  const maxFacts = clampInt(params.maxFacts, 10, 1, 16);
  const bundle = await compileObsidianKnowledgeBundle({
    goal: targets.length > 0 ? `${goal} | targets: ${targets.join(', ')}` : goal,
    domains: ['company-context', 'requirements'],
    sourceHints,
    maxArtifacts,
    maxFacts,
    audience: toText(params.audience) || 'engineering',
  });

  return resolveInternalKnowledgeFromBundle({
    goal,
    targets,
    sourceHints,
    includeRelatedArtifacts,
    maxArtifacts,
    maxFacts,
    bundle,
  });
};

export const compileObsidianRequirement = async (params: {
  objective: string;
  targets?: string[];
  sourceHints?: string[];
  explicitSources?: string[];
  maxArtifacts?: number;
  maxFacts?: number;
  audience?: string;
  desiredArtifact?: string;
  promoteImmediately?: boolean;
  allowOverwrite?: boolean;
}): Promise<ObsidianRequirementCompileResult> => {
  const objective = toText(params.objective);
  if (!objective) {
    throw new Error('objective is required');
  }

  const targets = dedupeStrings(toStringArray(params.targets));
  const explicitSources = dedupeStrings(toStringArray(params.explicitSources));
  const desiredArtifact = toText(params.desiredArtifact);
  const useCompanyContext = /(company|internal|shared mcp|obsidian|vault|wiki)/i.test(`${objective} ${targets.join(' ')} ${explicitSources.join(' ')}`);
  const maxArtifacts = clampInt(params.maxArtifacts, 6, 1, 12);
  const maxFacts = clampInt(params.maxFacts, 10, 1, 16);
  const bundle = await compileObsidianKnowledgeBundle({
    goal: targets.length > 0 ? `${objective} | targets: ${targets.join(', ')}` : objective,
    domains: dedupeStrings(['requirements', useCompanyContext ? 'company-context' : null]),
    sourceHints: dedupeStrings(['obsidian', ...toStringArray(params.sourceHints).map((value) => value.toLowerCase())]),
    explicitSources,
    maxArtifacts,
    maxFacts,
    audience: toText(params.audience) || 'engineering',
  });
  const internalKnowledge = useCompanyContext
    ? await resolveInternalKnowledgeFromBundle({
      goal: objective,
      targets,
      sourceHints: dedupeStrings(['internal-docs', 'obsidian', ...toStringArray(params.sourceHints).map((value) => value.toLowerCase())]),
      includeRelatedArtifacts: true,
      maxArtifacts,
      maxFacts,
      bundle,
    })
    : null;
  const mergedArtifacts = sortBundleArtifactsBySourceRole(dedupeBundleArtifacts([
    ...bundle.artifacts,
    ...(internalKnowledge?.artifacts || []),
  ]));
  const mergedGaps = dedupeBundleGaps([
    ...(internalKnowledge?.gaps || []),
    ...bundle.gaps,
  ]);
  const mergedFacts = dedupeBundleFacts([
    ...(internalKnowledge?.facts || []),
    ...bundle.facts,
  ]);

  const constraints = dedupeStrings([
    ...extractConstraintFragments(objective),
    ...mergedFacts.filter((fact) => fact.factType === 'constraint').map((fact) => fact.statement),
  ]).slice(0, 8);
  const entities = dedupeStrings([
    ...targets,
    ...mergedArtifacts.map((artifact) => buildBundleArtifactLabel(artifact)),
  ]).slice(0, 10);
  const workflows = inferRequirementWorkflows([
    objective,
    ...targets,
    ...mergedArtifacts.map((artifact) => artifact.title),
    ...mergedArtifacts.map((artifact) => artifact.locator),
    ...(internalKnowledge?.accessNotes || []),
  ]).slice(0, 6);
  const capabilityGaps = dedupeStrings(mergedGaps.map((gap) => gap.description)).slice(0, 8);
  const openQuestions = dedupeStrings(mergedGaps.map((gap) => toOpenQuestion(gap))).slice(0, 6);
  const recommendationBundle: ObsidianKnowledgeBundleResult = {
    ...bundle,
    artifacts: mergedArtifacts,
    facts: mergedFacts,
    gaps: mergedGaps,
  };
  const baseResult: Omit<ObsidianRequirementCompileResult, 'promotion'> = {
    problem: objective,
    constraints,
    entities,
    workflows,
    capabilityGaps,
    openQuestions,
    recommendedNextArtifacts: buildRequirementRecommendations({ bundle: recommendationBundle, desiredArtifact }),
    sourceArtifacts: mergedArtifacts.slice(0, 8),
    confidence: internalKnowledge
      ? Number(((bundle.confidence + internalKnowledge.confidence) / 2).toFixed(2))
      : bundle.confidence,
    bundleSummary: internalKnowledge
      ? `${bundle.summary} ${internalKnowledge.summary}`
      : bundle.summary,
  };
  const promotion = await promoteCompiledRequirement({
    objective,
    desiredArtifact: desiredArtifact || 'requirement',
    result: baseResult,
    sourceArtifacts: baseResult.sourceArtifacts,
    promoteImmediately: params.promoteImmediately === true,
    allowOverwrite: params.allowOverwrite === true,
  });

  return {
    ...baseResult,
    promotion,
  };
};

const dedupePromotionCandidates = (candidates: ObsidianKnowledgePromotionCandidate[]): ObsidianKnowledgePromotionCandidate[] => {
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

const dedupeSemanticLintIssues = (issues: ObsidianSemanticLintAuditIssue[]): ObsidianSemanticLintAuditIssue[] => {
  const seen = new Set<string>();
  const result: ObsidianSemanticLintAuditIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(issue);
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

const slugify = (value: string, fallback = 'note'): string => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
};

const parseDateMs = (...values: Array<unknown>): number => {
  for (const value of values) {
    const timestamp = Date.parse(String(value || ''));
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return 0;
};

const extractTitle = (content: string, filePath: string, frontmatter: Record<string, unknown>): string => {
  const frontmatterTitle = toText(frontmatter.title);
  if (frontmatterTitle) {
    return frontmatterTitle;
  }

  const heading = stripFrontmatterBlock(content)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('#'));

  if (heading) {
    return heading.replace(/^#+\s*/, '').trim();
  }

  return stripMarkdownExtension(filePath.split('/').pop() || 'Knowledge Note');
};

const extractSummary = (content: string): string => {
  const body = stripFrontmatterBlock(content)
    .replace(/^#+\s+.+$/gm, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return body.slice(0, 220);
};

const toWikilink = (filePath: string, alias?: string): string => {
  const target = stripMarkdownExtension(normalizePath(filePath));
  if (!target) {
    return alias || '';
  }
  return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
};

const isLikelyKnowledgePath = (value: string): boolean => {
  const normalized = normalizePath(stripKnownSourcePrefix(value));
  return normalized.includes('/') || normalized.toLowerCase().endsWith('.md');
};

const renderKnowledgeReference = (value: string): string => {
  const normalized = normalizePath(stripKnownSourcePrefix(value));
  if (!normalized) {
    return 'n/a';
  }
  return isLikelyKnowledgePath(normalized) ? toWikilink(normalized) : normalized;
};

const formatTimestamp = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 'n/a';
  }
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
};

const buildTopicArtifactPath = (topic: string): string => `${TOPIC_DIR}/${slugify(topic)}.md`;

const buildEntityArtifactPath = (entityKey: string): string => `${ENTITY_DIR}/${slugify(entityKey)}.md`;

const describeKnowledgePath = (filePath: string): Omit<ObsidianKnowledgePathDescriptor, 'path' | 'generated'> => {
  const normalized = normalizePath(filePath).toLowerCase();

  if (normalized.startsWith(`${CONTROL_TOWER_DIR.toLowerCase()}/`) || normalized.startsWith('ops/quality/')) {
    return {
      plane: 'control',
      concern: normalized.startsWith('ops/quality/') ? 'quality-control' : 'control-tower',
    };
  }

  if (normalized.startsWith('ops/services/')) {
    return {
      plane: 'runtime',
      concern: 'service-memory',
    };
  }

  if (normalized.startsWith('ops/improvement/') || normalized.startsWith('retros/')) {
    return {
      plane: 'learning',
      concern: 'recursive-improvement',
    };
  }

  if (normalized.startsWith('ops/incidents/') || normalized.startsWith('ops/vulnerabilities/')) {
    return {
      plane: 'record',
      concern: 'vulnerability-and-incident-analysis',
    };
  }

  if (/^guilds\/[^/]+\/sprint-journal\//.test(normalized)) {
    return {
      plane: 'learning',
      concern: 'recursive-improvement',
    };
  }

  if (normalized.startsWith('guilds/')) {
    return {
      plane: 'record',
      concern: normalized.includes('/customer/') ? 'customer-operating-memory' : 'guild-memory',
    };
  }

  if (normalized.startsWith(`${GENERATED_ROOT.toLowerCase()}/`)) {
    return {
      plane: 'record',
      concern: 'knowledge-control',
    };
  }

  return {
    plane: 'record',
    concern: 'general-record',
  };
};

const buildKnowledgePathIndex = (paths: Array<{ path: string; generated: boolean }>): ObsidianKnowledgePathDescriptor[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgePathDescriptor[] = [];

  for (const entry of paths) {
    const normalized = normalizePath(entry.path);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push({
      path: normalized,
      generated: entry.generated,
      ...describeKnowledgePath(normalized),
    });
  }

  return result;
};

const extractGuildIdFromPath = (value: string): string | null => {
  const match = normalizePath(value).match(/^guilds\/([^/]+)\//i);
  return match?.[1] || null;
};

const extractServiceSlugFromPath = (value: string): string | null => {
  const match = normalizePath(value).match(/^ops\/services\/([^/]+)\//i);
  return match?.[1] || null;
};

const buildCustomerLedgerPaths = (guildId: string | null): string[] => {
  if (!guildId) {
    return [];
  }

  return [
    `guilds/${guildId}/customer/PROFILE.md`,
    `guilds/${guildId}/customer/REQUIREMENTS.md`,
    `guilds/${guildId}/customer/ISSUES.md`,
    `guilds/${guildId}/customer/ESCALATIONS.md`,
  ];
};

const buildGuildCorePaths = (guildId: string | null): string[] => {
  if (!guildId) {
    return [];
  }

  return [
    `guilds/${guildId}/Guild_Lore.md`,
    `guilds/${guildId}/Server_History.md`,
    `guilds/${guildId}/Decision_Log.md`,
  ];
};

const isGeneratedArtifactPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith(`${GENERATED_ROOT.toLowerCase()}/`);
};

const isRawPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith('chat/inbox/')
    || normalized.startsWith('events/raw/')
    || normalized.includes('/events/raw/');
};

const isTrackedPath = (filePath: string, guildId: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  if (TRACKED_ROOTS.some((root) => matchesPathPrefix(normalized, root))) {
    return true;
  }
  if (DURABLE_SHARED_ROOTS.some((root) => matchesPathPrefix(normalized, root))) {
    return true;
  }
  if (!guildId) {
    return false;
  }

  const guildPrefix = `guilds/${guildId.toLowerCase()}`;
  if (GUILD_TRACKED_ROOT_SUFFIXES.some((suffix) => matchesPathPrefix(normalized, `${guildPrefix}/${suffix}`))) {
    return true;
  }

  return GUILD_CORE_FILE_NAMES.some((fileName) => normalized === `${guildPrefix}/${fileName.toLowerCase()}`);
};

const deriveTopics = (frontmatter: Record<string, unknown>): string[] => {
  const tags = toStringArray(frontmatter.tags)
    .map((tag) => tag.replace(/^#/, '').trim().toLowerCase())
    .filter((tag) => tag.length > 0 && !SYSTEM_TAGS.has(tag));
  const retrievalIntent = slugify(toText(frontmatter.retrieval_intent), '');
  const sourceTopic = slugify(toText(frontmatter.source), '');

  const topics = dedupeStrings([
    retrievalIntent || null,
    ...tags,
    tags.length === 0 && !retrievalIntent && sourceTopic ? sourceTopic : null,
  ]).map((topic) => topic.toLowerCase());

  return topics.slice(0, 6);
};

const deriveEntityKey = (filePath: string, frontmatter: Record<string, unknown>): string => {
  const canonicalKey = normalizePath(toText(frontmatter.canonical_key));
  if (canonicalKey) {
    return stripMarkdownExtension(canonicalKey);
  }
  return stripMarkdownExtension(normalizePath(filePath));
};

const isKnowledgeBearing = (filePath: string, frontmatter: Record<string, unknown>, guildId: string): boolean => {
  if (isGeneratedArtifactPath(filePath) || isRawPath(filePath)) {
    return false;
  }

  const status = toText(frontmatter.status).toLowerCase();
  if (status === 'open') {
    return false;
  }

  const schema = toText(frontmatter.schema).toLowerCase();
  const sourceRefs = toStringArray(frontmatter.source_refs);
  const canonicalKey = toText(frontmatter.canonical_key);

  return isTrackedPath(filePath, guildId)
    || Boolean(schema)
    || sourceRefs.length > 0
    || Boolean(canonicalKey)
    || ['active', 'answered', 'superseded', 'invalid'].includes(status);
};

const buildSnapshotNote = (params: {
  filePath: string;
  content: string;
  modifiedAt?: number;
  guildId: string;
}): KnowledgeSnapshotNote | null => {
  const frontmatter = parseObsidianFrontmatter(params.content);
  if (!isKnowledgeBearing(params.filePath, frontmatter, params.guildId)) {
    return null;
  }

  const title = extractTitle(params.content, params.filePath, frontmatter);
  const created = toText(frontmatter.created);
  const observedAt = toText(frontmatter.observed_at) || created;
  const validAt = toText(frontmatter.valid_at);
  const invalidAt = toText(frontmatter.invalid_at);
  const entityKey = deriveEntityKey(params.filePath, frontmatter);

  return {
    filePath: normalizePath(params.filePath),
    title,
    schema: toText(frontmatter.schema) || 'knowledge-note/v1',
    source: toText(frontmatter.source) || 'unknown',
    status: toText(frontmatter.status) || 'active',
    created,
    observedAt,
    validAt,
    invalidAt,
    canonicalKey: toText(frontmatter.canonical_key) || entityKey,
    entityKey,
    tags: toStringArray(frontmatter.tags),
    topics: deriveTopics(frontmatter),
    sourceRefs: dedupeStrings(toStringArray(frontmatter.source_refs)),
    summary: extractSummary(params.content),
    timestampMs: parseDateMs(observedAt, validAt, created),
    modifiedAt: params.modifiedAt ?? 0,
  };
};

const recordState = (patch: Partial<ObsidianKnowledgeCompilationStats>): void => {
  Object.assign(state, patch);
};

const buildDecision = (params: {
  filePath: string;
  content: string;
  guildId: string;
}): CompilationDecision => {
  if (!normalizePath(params.filePath).toLowerCase().endsWith('.md')) {
    return { shouldCompile: false, reason: 'not_markdown', entityKey: null, topics: [] };
  }
  if (isGeneratedArtifactPath(params.filePath)) {
    return { shouldCompile: false, reason: 'generated_artifact', entityKey: null, topics: [] };
  }
  if (isRawPath(params.filePath)) {
    return { shouldCompile: false, reason: 'raw_or_ops_path', entityKey: null, topics: [] };
  }

  const frontmatter = parseObsidianFrontmatter(params.content);
  if (!isKnowledgeBearing(params.filePath, frontmatter, params.guildId)) {
    return { shouldCompile: false, reason: 'not_knowledge_bearing', entityKey: null, topics: [] };
  }

  return {
    shouldCompile: true,
    reason: null,
    entityKey: deriveEntityKey(params.filePath, frontmatter),
    topics: deriveTopics(frontmatter),
  };
};

const collectCandidateRoots = (params: {
  guildId: string;
  filePath: string;
}): string[] => {
  const roots = new Set<string>(TRACKED_ROOTS);
  const normalizedFilePath = normalizePath(params.filePath);
  const descriptor = describeKnowledgePath(normalizedFilePath);
  const parentRoot = getPathParent(normalizedFilePath);
  const grandparentRoot = getPathParent(normalizedFilePath, 2);

  addCandidateRoot(roots, parentRoot);
  if (!['ops', 'plans', 'guilds'].includes(grandparentRoot.toLowerCase())) {
    addCandidateRoot(roots, grandparentRoot);
  }

  if (params.guildId) {
    addCandidateRoot(roots, `guilds/${params.guildId}`);
    for (const suffix of GUILD_TRACKED_ROOT_SUFFIXES) {
      addCandidateRoot(roots, `guilds/${params.guildId}/${suffix}`);
    }
  }

  switch (descriptor.concern) {
    case 'control-tower':
      addCandidateRoot(roots, 'ops/control-tower');
      addCandidateRoot(roots, 'ops/quality');
      addCandidateRoot(roots, 'plans/decisions');
      addCandidateRoot(roots, 'plans/requirements');
      break;
    case 'quality-control':
      addCandidateRoot(roots, 'ops/quality');
      addCandidateRoot(roots, 'ops/control-tower');
      addCandidateRoot(roots, 'ops/improvement');
      addCandidateRoot(roots, 'plans/development');
      break;
    case 'service-memory': {
      addCandidateRoot(roots, 'ops/services');
      const serviceSlug = extractServiceSlugFromPath(normalizedFilePath);
      if (serviceSlug) {
        addCandidateRoot(roots, `ops/services/${serviceSlug}`);
      }
      addCandidateRoot(roots, 'ops/control-tower');
      addCandidateRoot(roots, 'ops/quality');
      addCandidateRoot(roots, 'ops/playbooks');
      addCandidateRoot(roots, 'ops/incidents');
      addCandidateRoot(roots, 'ops/improvement');
      break;
    }
    case 'vulnerability-and-incident-analysis':
      addCandidateRoot(roots, 'ops/incidents');
      addCandidateRoot(roots, 'ops/vulnerabilities');
      addCandidateRoot(roots, 'ops/playbooks');
      addCandidateRoot(roots, 'ops/mitigations');
      addCandidateRoot(roots, 'ops/services');
      addCandidateRoot(roots, 'ops/improvement');
      break;
    case 'recursive-improvement':
      addCandidateRoot(roots, 'ops/improvement');
      addCandidateRoot(roots, 'retros');
      addCandidateRoot(roots, 'plans/development');
      addCandidateRoot(roots, 'plans/execution');
      break;
    case 'customer-operating-memory':
      if (params.guildId) {
        addCandidateRoot(roots, `guilds/${params.guildId}`);
        addCandidateRoot(roots, `guilds/${params.guildId}/customer`);
      }
      addCandidateRoot(roots, 'ops/playbooks');
      addCandidateRoot(roots, 'ops/incidents');
      break;
    case 'guild-memory':
      if (params.guildId) {
        addCandidateRoot(roots, `guilds/${params.guildId}`);
        addCandidateRoot(roots, `guilds/${params.guildId}/events`);
        addCandidateRoot(roots, `guilds/${params.guildId}/memory`);
        addCandidateRoot(roots, `guilds/${params.guildId}/retros`);
        addCandidateRoot(roots, `guilds/${params.guildId}/sprint-journal`);
      }
      break;
    default:
      break;
  }

  if (matchesPathPrefix(normalizedFilePath, 'plans')) {
    const topLevelPlanRoot = normalizedFilePath.split('/').slice(0, 2).join('/');
    addCandidateRoot(roots, topLevelPlanRoot);
    addCandidateRoot(roots, 'ops/control-tower');
    addCandidateRoot(roots, 'ops/improvement');
  }
  return [...roots];
};

const collectSnapshot = async (params: {
  guildId: string;
  vaultPath: string;
  filePath: string;
  content: string;
}): Promise<KnowledgeSnapshotNote[]> => {
  const fileInfos = new Map<string, ObsidianFileInfo>();
  const roots = collectCandidateRoots({
    guildId: params.guildId,
    filePath: params.filePath,
  });

  await Promise.all(roots.map(async (root) => {
    const files = await listObsidianFilesWithAdapter(params.vaultPath, root, 'md');
    for (const file of files) {
      fileInfos.set(normalizePath(file.filePath), file);
    }
  }));

  const candidatePaths = dedupeStrings([...fileInfos.keys(), params.filePath]);
    
  const orderedPaths = candidatePaths
    .sort((left, right) => {
      const leftInfo = fileInfos.get(left);
      const rightInfo = fileInfos.get(right);
      return (rightInfo?.modifiedAt || 0) - (leftInfo?.modifiedAt || 0);
    })
    .slice(0, MAX_SNAPSHOT_NOTES * 2);

  const notes = await Promise.all(orderedPaths.map(async (filePath) => {
    const modifiedAt = fileInfos.get(filePath)?.modifiedAt || 0;
    if (filePath === normalizePath(params.filePath)) {
      return buildSnapshotNote({ filePath, content: params.content, modifiedAt, guildId: params.guildId });
    }
    const content = await readObsidianFileWithAdapter({ vaultPath: params.vaultPath, filePath });
    if (!content) {
      return null;
    }
    return buildSnapshotNote({ filePath, content, modifiedAt, guildId: params.guildId });
  }));

  return notes
    .filter((note): note is KnowledgeSnapshotNote => Boolean(note))
    .sort((left, right) => (right.timestampMs || right.modifiedAt) - (left.timestampMs || left.modifiedAt))
    .slice(0, MAX_SNAPSHOT_NOTES);
};

const buildIndexArtifact = (notes: KnowledgeSnapshotNote[], generatedAt: string) => {
  const statusCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  for (const note of notes) {
    statusCounts.set(note.status, (statusCounts.get(note.status) || 0) + 1);
    for (const topic of note.topics) {
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    }
  }

  const builder = doc()
    .title('Knowledge Control Index')
    .tag('knowledge-control', 'auto-generated', 'navigation')
    .property('schema', 'knowledge-index/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', generatedAt)
    .property('compiled_note_count', notes.length);

  builder.section('Overview')
    .line('Auto-generated index across knowledge-bearing Obsidian notes.')
    .line(`Generated at: ${generatedAt}`)
    .line(`Indexed notes: ${notes.length}`)
    .line(`Statuses: ${[...statusCounts.entries()].map(([status, count]) => `${status}=${count}`).join(' | ') || 'n/a'}`);

  const hotTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([topic, count]) => [toWikilink(`${TOPIC_DIR}/${slugify(topic)}`, topic), count]);

  if (hotTopics.length > 0) {
    builder.section('Hot Topics').table(['Topic', 'Notes'], hotTopics);
  }

  builder.section('Recent Notes').table(
    ['When', 'Note', 'Status', 'Sources'],
    notes.slice(0, MAX_INDEX_ROWS).map((note) => [
      formatTimestamp(note.observedAt || note.created || generatedAt),
      toWikilink(note.filePath, note.title),
      note.status,
      note.sourceRefs.length,
    ]),
  );

  builder.section('Compiler Artifacts').bullets([
    `Log: ${toWikilink(LOG_PATH, 'Knowledge Log')}`,
    `Lint: ${toWikilink(LINT_PATH, 'Knowledge Lint')}`,
    `Supervisor: ${toWikilink(SUPERVISOR_PATH, 'Knowledge Supervisor')}`,
    `Topic pages: ${TOPIC_DIR}/<topic>.md`,
    `Entity pages: ${ENTITY_DIR}/<entity>.md`,
  ]);

  return builder.buildWithFrontmatter();
};

const buildLogArtifact = (notes: KnowledgeSnapshotNote[], generatedAt: string) => {
  const builder = doc()
    .title('Knowledge Control Log')
    .tag('knowledge-control', 'auto-generated', 'log')
    .property('schema', 'knowledge-log/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', generatedAt)
    .property('event_count', Math.min(notes.length, MAX_LOG_ROWS));

  builder.section('Overview')
    .line('Recent knowledge-bearing writes sorted by observed time.')
    .line(`Generated at: ${generatedAt}`);

  builder.section('Events').table(
    ['Observed', 'Note', 'Schema', 'Status', 'Entity'],
    notes.slice(0, MAX_LOG_ROWS).map((note) => [
      formatTimestamp(note.observedAt || note.created || generatedAt),
      toWikilink(note.filePath, note.title),
      note.schema,
      note.status,
      toWikilink(`${ENTITY_DIR}/${slugify(note.entityKey)}`, note.entityKey.split('/').pop() || 'entity'),
    ]),
  );

  return builder.buildWithFrontmatter();
};

const buildLintSummary = (notes: KnowledgeSnapshotNote[], generatedAt: string): ObsidianKnowledgeLintSummary => {
  const issues: ObsidianKnowledgeLintIssue[] = [];
  let missingSourceRefs = 0;
  let staleActiveNotes = 0;
  let invalidLifecycleNotes = 0;
  let canonicalCollisions = 0;
  const activeByEntity = new Map<string, KnowledgeSnapshotNote[]>();
  const now = Date.now();

  for (const note of notes) {
    const observedMs = note.timestampMs || note.modifiedAt;
    const validAtMs = parseDateMs(note.validAt);
    const invalidAtMs = parseDateMs(note.invalidAt);
    const requiresGrounding = ['active', 'answered', 'superseded'].includes(note.status);

    if (requiresGrounding && note.sourceRefs.length === 0) {
      missingSourceRefs += 1;
      issues.push({
        kind: 'missing_source_refs',
        severity: 'warning',
        message: 'Knowledge-bearing note has no source_refs grounding.',
        entityKey: note.entityKey,
        filePaths: [note.filePath],
      });
    }

    if (note.status === 'active' && observedMs > 0 && now - observedMs >= STALE_ACTIVE_NOTE_AGE_MS && !note.invalidAt) {
      staleActiveNotes += 1;
      issues.push({
        kind: 'stale_active_note',
        severity: 'warning',
        message: 'Active note looks stale and should be refreshed, invalidated, or superseded.',
        entityKey: note.entityKey,
        filePaths: [note.filePath],
      });
    }

    if ((note.status === 'active' && invalidAtMs > 0) || (validAtMs > 0 && invalidAtMs > 0 && validAtMs > invalidAtMs)) {
      invalidLifecycleNotes += 1;
      issues.push({
        kind: 'invalid_lifecycle',
        severity: 'warning',
        message: 'Lifecycle metadata is inconsistent (status, valid_at, invalid_at).',
        entityKey: note.entityKey,
        filePaths: [note.filePath],
      });
    }

    if (note.status === 'active' && note.entityKey) {
      const bucket = activeByEntity.get(note.entityKey) || [];
      bucket.push(note);
      activeByEntity.set(note.entityKey, bucket);
    }
  }

  for (const [entityKey, entityNotes] of activeByEntity.entries()) {
    if (entityNotes.length < 2) {
      continue;
    }

    canonicalCollisions += 1;
    issues.push({
      kind: 'canonical_collision',
      severity: 'warning',
      message: 'Multiple active notes share the same canonical entity without supersession.',
      entityKey,
      filePaths: entityNotes.map((note) => note.filePath),
    });
  }

  return {
    generatedAt,
    issueCount: issues.length,
    missingSourceRefs,
    staleActiveNotes,
    invalidLifecycleNotes,
    canonicalCollisions,
    issues: issues.slice(0, 25),
  };
};

const buildLintArtifact = (summary: ObsidianKnowledgeLintSummary, generatedAt: string) => {
  const builder = doc()
    .title('Knowledge Control Lint')
    .tag('knowledge-control', 'auto-generated', 'lint')
    .property('schema', 'knowledge-lint/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', generatedAt)
    .property('issue_count', summary.issueCount)
    .property('missing_source_refs', summary.missingSourceRefs)
    .property('stale_active_notes', summary.staleActiveNotes)
    .property('invalid_lifecycle_notes', summary.invalidLifecycleNotes)
    .property('canonical_collisions', summary.canonicalCollisions);

  builder.section('Summary')
    .line(`Generated at: ${generatedAt}`)
    .line(`Issues: ${summary.issueCount}`)
    .line(`missing_source_refs=${summary.missingSourceRefs} | stale_active_notes=${summary.staleActiveNotes} | invalid_lifecycle_notes=${summary.invalidLifecycleNotes} | canonical_collisions=${summary.canonicalCollisions}`);

  if (summary.issues.length === 0) {
    builder.section('Findings').line('No lint issues detected.');
  } else {
    builder.section('Findings').table(
      ['Kind', 'Entity', 'Files', 'Message'],
      summary.issues.map((issue) => [
        issue.kind,
        issue.entityKey || 'n/a',
        issue.filePaths.map((filePath) => toWikilink(filePath)).join(', '),
        issue.message,
      ]),
    );
  }

  return builder.buildWithFrontmatter();
};

const buildTopicArtifact = (topic: string, notes: KnowledgeSnapshotNote[], generatedAt: string) => {
  const topicNotes = notes.filter((note) => note.topics.includes(topic)).slice(0, MAX_TOPIC_ROWS);
  const groundedCount = topicNotes.reduce((count, note) => count + (note.sourceRefs.length > 0 ? 1 : 0), 0);

  const builder = doc()
    .title(`Topic: ${topic}`)
    .tag('knowledge-control', 'auto-generated', 'topic', topic)
    .property('schema', 'knowledge-topic/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', generatedAt)
    .property('topic', topic)
    .property('note_count', topicNotes.length)
    .property('grounded_count', groundedCount);

  builder.section('Summary')
    .line(`Generated at: ${generatedAt}`)
    .line(`Notes in topic: ${topicNotes.length}`)
    .line(`Grounded notes: ${groundedCount}`);

  builder.section('Recent Notes').table(
    ['When', 'Note', 'Status', 'Summary'],
    topicNotes.map((note) => [
      formatTimestamp(note.observedAt || note.created || generatedAt),
      toWikilink(note.filePath, note.title),
      note.status,
      note.summary || 'n/a',
    ]),
  );

  return builder.buildWithFrontmatter();
};

const buildEntityArtifact = (entityKey: string, notes: KnowledgeSnapshotNote[], generatedAt: string) => {
  const entityNotes = notes.filter((note) => note.entityKey === entityKey).slice(0, MAX_ENTITY_ROWS);
  const latest = entityNotes[0];
  const groundedSources = dedupeStrings(entityNotes.flatMap((note) => note.sourceRefs));

  const builder = doc()
    .title(`Entity: ${latest?.title || entityKey}`)
    .tag('knowledge-control', 'auto-generated', 'entity')
    .property('schema', 'knowledge-entity/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', generatedAt)
    .property('entity_key', entityKey)
    .property('note_count', entityNotes.length)
    .property('grounding_count', groundedSources.length);

  builder.section('Current View')
    .line(`Entity key: ${entityKey}`)
    .line(`Latest note: ${latest ? toWikilink(latest.filePath, latest.title) : 'n/a'}`)
    .line(`Latest status: ${latest?.status || 'n/a'}`)
    .line(`Latest summary: ${latest?.summary || 'n/a'}`);

  builder.section('Timeline').table(
    ['When', 'Note', 'Status', 'Schema'],
    entityNotes.map((note) => [
      formatTimestamp(note.observedAt || note.created || generatedAt),
      toWikilink(note.filePath, note.title),
      note.status,
      note.schema,
    ]),
  );

  if (groundedSources.length > 0) {
    builder.section('Grounding').bullets(groundedSources.slice(0, 20).map((sourcePath) => toWikilink(sourcePath)));
  }

  return builder.buildWithFrontmatter();
};

const getHighestSeverity = (values: Array<'low' | 'medium' | 'high'>): 'low' | 'medium' | 'high' => {
  if (values.includes('high')) {
    return 'high';
  }
  if (values.includes('medium')) {
    return 'medium';
  }
  return 'low';
};

const dedupeSupervisorActions = (actions: ObsidianKnowledgeSupervisorAction[]): ObsidianKnowledgeSupervisorAction[] => {
  const seen = new Set<string>();
  const result: ObsidianKnowledgeSupervisorAction[] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.summary}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({
      ...action,
      targetPaths: dedupeStrings(action.targetPaths),
    });
  }
  return result;
};

const buildSupervisorActionsFromLintSummary = (summary: ObsidianKnowledgeLintSummary): ObsidianKnowledgeSupervisorAction[] => {
  const actions: ObsidianKnowledgeSupervisorAction[] = [];
  const issuesByKind = (kind: ObsidianKnowledgeLintIssue['kind']) => summary.issues.filter((issue) => issue.kind === kind);

  if (summary.missingSourceRefs > 0) {
    actions.push({
      kind: 'refresh-grounding',
      severity: 'medium',
      summary: `${summary.missingSourceRefs} knowledge notes still lack source_refs grounding.`,
      targetPaths: issuesByKind('missing_source_refs').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Refresh source_refs before treating the note as durable semantic memory.',
    });
  }

  if (summary.invalidLifecycleNotes > 0) {
    actions.push({
      kind: 'repair-lifecycle',
      severity: 'medium',
      summary: `${summary.invalidLifecycleNotes} knowledge notes have inconsistent lifecycle metadata.`,
      targetPaths: issuesByKind('invalid_lifecycle').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Normalize status, valid_at, invalid_at, and supersession metadata so lifecycle stays machine-readable.',
    });
  }

  if (summary.canonicalCollisions > 0) {
    actions.push({
      kind: 'resolve-canonical-collision',
      severity: 'high',
      summary: `${summary.canonicalCollisions} canonical entities still have multiple active notes.`,
      targetPaths: issuesByKind('canonical_collision').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Close the collision with supersedes, invalid_at, or an explicit canonical winner.',
    });
  }

  if (summary.staleActiveNotes > 0) {
    actions.push({
      kind: 'repair-lifecycle',
      severity: 'medium',
      summary: `${summary.staleActiveNotes} active knowledge notes look stale enough to refresh or supersede.`,
      targetPaths: issuesByKind('stale_active_note').flatMap((issue) => issue.filePaths),
      suggestedNextStep: 'Refresh, invalidate, or supersede stale active notes so the graph stops advertising outdated truth.',
    });
  }

  return actions;
};

const buildSupervisorActionsFromSemanticIssues = (issues: ObsidianSemanticLintAuditIssue[]): ObsidianKnowledgeSupervisorAction[] => {
  const actions: ObsidianKnowledgeSupervisorAction[] = [];

  const groupedIssues = {
    coverage: issues.filter((issue) => issue.kind === 'coverage-gap'),
    graph: issues.filter((issue) => issue.kind === 'graph-quality'),
    runtime: issues.filter((issue) => issue.kind === 'runtime-doc-mismatch'),
  };

  if (groupedIssues.coverage.length > 0) {
    actions.push({
      kind: 'backfill-shared-coverage',
      severity: getHighestSeverity(groupedIssues.coverage.map((issue) => issue.severity)),
      summary: `${groupedIssues.coverage.length} shared coverage gaps are still open in the semantic owner surface.`,
      targetPaths: groupedIssues.coverage.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Backfill missing shared wiki targets before repo mirrors become the only visible truth.',
    });
  }

  if (groupedIssues.graph.length > 0) {
    actions.push({
      kind: 'repair-graph-quality',
      severity: getHighestSeverity(groupedIssues.graph.map((issue) => issue.severity)),
      summary: `${groupedIssues.graph.length} graph-quality issues are still blocking clean traversal.`,
      targetPaths: groupedIssues.graph.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Repair unresolved links, orphans, or missing required properties before widening downstream automation.',
    });
  }

  if (groupedIssues.runtime.length > 0) {
    actions.push({
      kind: 'resolve-runtime-mismatch',
      severity: getHighestSeverity(groupedIssues.runtime.map((issue) => issue.severity)),
      summary: `${groupedIssues.runtime.length} runtime-vs-doc mismatches are still visible in the active write/read path.`,
      targetPaths: groupedIssues.runtime.flatMap((issue) => issue.evidenceRefs),
      suggestedNextStep: 'Align runtime routing, adapter selection, and vault parity with the documented semantic-owner path.',
    });
  }

  return actions;
};

const buildKnowledgeSupervisorReport = async (params: {
  triggeredPath: string;
  entityKey: string | null;
  topics: string[];
  lintSummary: ObsidianKnowledgeLintSummary;
}): Promise<ObsidianKnowledgeSupervisorReport> => {
  const semanticAudit = await runObsidianSemanticLintAudit({
    maxIssues: 8,
    includeGraphAudit: true,
    persistFindings: false,
  });
  const actions = dedupeSupervisorActions([
    ...buildSupervisorActionsFromLintSummary(params.lintSummary),
    ...buildSupervisorActionsFromSemanticIssues(semanticAudit.issues.filter((issue) => issue.kind !== 'compiler-lint')),
  ]);
  const focusPaths = dedupeStrings([
    params.triggeredPath,
    params.entityKey ? buildEntityArtifactPath(params.entityKey) : null,
    ...params.topics.map((topic) => buildTopicArtifactPath(topic)),
    ...actions.flatMap((action) => action.targetPaths.filter((value) => isLikelyKnowledgePath(value))),
  ]).slice(0, 12);
  const highestSeverity = actions.length > 0
    ? getHighestSeverity(actions.map((action) => action.severity))
    : 'low';

  return {
    healthy: actions.length === 0,
    summary: actions.length === 0
      ? `Supervisor sees no blocking follow-up actions after compiling ${toWikilink(params.triggeredPath)}.`
      : `Supervisor flagged ${actions.length} follow-up action${actions.length === 1 ? '' : 's'} after compiling ${toWikilink(params.triggeredPath)}. Highest severity: ${highestSeverity}.`,
    actionCount: actions.length,
    focusPaths,
    actions,
  };
};

const buildSupervisorArtifact = (params: {
  generatedAt: string;
  triggeredPath: string;
  entityKey: string | null;
  topics: string[];
  report: ObsidianKnowledgeSupervisorReport;
}) => {
  const descriptor = describeKnowledgePath(params.triggeredPath);
  const builder = doc()
    .title('Knowledge Control Supervisor')
    .tag('knowledge-control', 'auto-generated', 'supervisor')
    .property('schema', 'knowledge-supervisor/v1')
    .property('source', 'knowledge-compiler')
    .property('generated_at', params.generatedAt)
    .property('action_count', params.report.actionCount)
    .property('healthy', params.report.healthy)
    .property('trigger_path', params.triggeredPath)
    .property('plane', descriptor.plane)
    .property('concern', descriptor.concern);

  if (params.entityKey) {
    builder.property('entity_key', params.entityKey);
  }

  builder.section('Summary')
    .line(params.report.summary)
    .line(`Generated at: ${params.generatedAt}`)
    .line(`Trigger: ${toWikilink(params.triggeredPath)}`)
    .line(`Plane: ${descriptor.plane} | Concern: ${descriptor.concern}`)
    .line(`Topics: ${params.topics.length > 0 ? params.topics.join(', ') : 'none'}`);

  if (params.report.focusPaths.length > 0) {
    builder.section('Focus Paths').bullets(params.report.focusPaths.map((value) => renderKnowledgeReference(value)));
  }

  if (params.report.actions.length === 0) {
    builder.section('Priority Actions').line('No immediate supervisor actions. Keep monitoring index, log, and semantic lint drift.');
  } else {
    builder.section('Priority Actions').table(
      ['Severity', 'Kind', 'Targets', 'Next'],
      params.report.actions.map((action) => [
        action.severity,
        action.kind,
        action.targetPaths.length > 0 ? action.targetPaths.slice(0, 3).map((value) => renderKnowledgeReference(value)).join(', ') : 'n/a',
        action.suggestedNextStep,
      ]),
    );
  }

  builder.section('Verification Checklist').bullets([...CONTROL_TOWER_BLUEPRINT.reflectionChecklist]);

  return builder.buildWithFrontmatter();
};

const writeArtifact = async (params: {
  guildId: string;
  vaultPath: string;
  filePath: string;
  markdown: string;
  tags: string[];
  properties: Record<string, ObsidianFrontmatterValue>;
}): Promise<string | null> => {
  const result = await writeObsidianNoteWithAdapter({
    guildId: params.guildId,
    vaultPath: params.vaultPath,
    fileName: params.filePath,
    content: params.markdown,
    tags: params.tags,
    properties: params.properties,
    allowHighLinkDensity: true,
    skipKnowledgeCompilation: true,
  });

  return result?.path || null;
};

export const getObsidianKnowledgeCompilationStats = (): ObsidianKnowledgeCompilationStats => ({
  ...state,
  lastArtifacts: [...state.lastArtifacts],
  lastTopics: [...state.lastTopics],
  lastLintSummary: cloneLintSummary(state.lastLintSummary),
});

export const listObsidianKnowledgeArtifactPaths = (stats = getObsidianKnowledgeCompilationStats()): string[] => {
  return dedupeStrings([
    INDEX_PATH,
    LOG_PATH,
    LINT_PATH,
    SUPERVISOR_PATH,
    ...stats.lastArtifacts,
    ...stats.lastTopics.map((topic) => buildTopicArtifactPath(topic)),
    stats.lastEntityKey ? buildEntityArtifactPath(stats.lastEntityKey) : null,
  ]);
};

export const resolveObsidianKnowledgeArtifactPath = (value: string): string | null => {
  const raw = normalizePath(value);
  const normalized = raw.toLowerCase();
  if (!normalized || normalized.includes('..')) {
    return null;
  }

  if (normalized === 'index' || normalized === INDEX_PATH.toLowerCase()) {
    return INDEX_PATH;
  }
  if (normalized === 'log' || normalized === LOG_PATH.toLowerCase()) {
    return LOG_PATH;
  }
  if (normalized === 'lint' || normalized === LINT_PATH.toLowerCase()) {
    return LINT_PATH;
  }
  if (normalized === 'supervisor' || normalized === SUPERVISOR_PATH.toLowerCase()) {
    return SUPERVISOR_PATH;
  }
  if (normalized === 'blueprint' || normalized === BLUEPRINT_PATH.toLowerCase()) {
    return BLUEPRINT_PATH;
  }
  if (normalized === 'canonical-map' || normalized === CANONICAL_MAP_PATH.toLowerCase()) {
    return CANONICAL_MAP_PATH;
  }
  if (normalized === 'cadence' || normalized === CADENCE_PATH.toLowerCase()) {
    return CADENCE_PATH;
  }
  if (normalized === 'gate-entrypoints' || normalized === GATE_ENTRYPOINTS_PATH.toLowerCase()) {
    return GATE_ENTRYPOINTS_PATH;
  }

  const topicMatch = raw.match(/^topic:(.+)$/i);
  if (topicMatch?.[1]) {
    return buildTopicArtifactPath(topicMatch[1]);
  }

  const entityMatch = raw.match(/^entity:(.+)$/i);
  if (entityMatch?.[1]) {
    return buildEntityArtifactPath(entityMatch[1]);
  }

  if (normalized.startsWith(`${TOPIC_DIR.toLowerCase()}/`)) {
    return buildTopicArtifactPath(raw.slice(TOPIC_DIR.length + 1).replace(/\.md$/i, ''));
  }

  if (normalized.startsWith(`${ENTITY_DIR.toLowerCase()}/`)) {
    return buildEntityArtifactPath(raw.slice(ENTITY_DIR.length + 1).replace(/\.md$/i, ''));
  }

  return null;
};

export const buildObsidianKnowledgeReflectionBundle = (value: string): ObsidianKnowledgeReflectionBundle | null => {
  const raw = normalizePath(value);
  if (!raw || raw.includes('..')) {
    return null;
  }

  const targetPath = resolveObsidianKnowledgeArtifactPath(raw) || raw;
  const { plane, concern } = describeKnowledgePath(targetPath);
  const guildId = extractGuildIdFromPath(targetPath);
  const serviceSlug = extractServiceSlugFromPath(targetPath);
  const requiredPaths = dedupeStrings([targetPath, INDEX_PATH, LOG_PATH]);
  const gatePaths = dedupeStrings([GATE_ENTRYPOINTS_PATH, VISIBLE_REFLECTION_GATE_PATH]);
  let suggestedPaths: string[] = [];
  let suggestedPatterns: string[] = [];
  let notes: string[] = [];
  let customerImpact = false;

  switch (concern) {
    case 'control-tower':
      suggestedPaths = [...CONTROL_TOWER_PATHS, QUALITY_RUBRIC_PATH, QUALITY_METRICS_BASELINE_PATH, VISIBLE_REFLECTION_GATE_PATH];
      notes = [
        'Control-plane changes should update canonical precedence, cadence, and gate entrypoints before downstream runtime notes drift.',
      ];
      break;
    case 'service-memory':
      suggestedPaths = [CANONICAL_MAP_PATH, GATE_ENTRYPOINTS_PATH, KNOWLEDGE_REFLECTION_RULE_PATH];
      suggestedPatterns = serviceSlug
        ? [
            `ops/services/${serviceSlug}/DEPENDENCY_MAP.md`,
            `ops/services/${serviceSlug}/RECOVERY.md`,
            `ops/services/${serviceSlug}/WEAK_POINTS.md`,
          ]
        : ['ops/services/<service>/DEPENDENCY_MAP.md', 'ops/services/<service>/RECOVERY.md', 'ops/services/<service>/WEAK_POINTS.md'];
      notes = [
        'Runtime-plane service work should pair a profile update with dependency and recovery follow-up artifacts.',
      ];
      break;
    case 'quality-control':
      suggestedPaths = [QUALITY_RUBRIC_PATH, QUALITY_METRICS_BASELINE_PATH, VISIBLE_REFLECTION_GATE_PATH, GATE_ENTRYPOINTS_PATH];
      suggestedPatterns = ['ops/quality/gates/<date>_<slug>.md', 'ops/quality/regressions/<slug>.md', 'ops/quality/retrieval/<date>_<slug>.md'];
      notes = [
        'Quality-facing work is incomplete until a metric or gate artifact captures the decision and evidence.',
      ];
      break;
    case 'customer-operating-memory':
      customerImpact = true;
      suggestedPaths = [...buildCustomerLedgerPaths(guildId), KNOWLEDGE_REFLECTION_RULE_PATH];
      suggestedPatterns = guildId
        ? [`guilds/${guildId}/customer/SUCCESS_FAILURE_NARRATIVE.md`]
        : ['guilds/<guildId>/customer/SUCCESS_FAILURE_NARRATIVE.md'];
      notes = [
        'Customer-visible trust changes should update issues or escalations, not only the profile.',
      ];
      break;
    case 'vulnerability-and-incident-analysis':
      customerImpact = true;
      suggestedPaths = [VISIBLE_REFLECTION_GATE_PATH, KNOWLEDGE_REFLECTION_RULE_PATH, VISIBLE_REFLECTION_CORRECTION_PATH];
      suggestedPatterns = ['ops/postmortems/<date>_<slug>.md', 'ops/mitigations/<slug>.md'];
      notes = [
        'Record the event and the countermeasure separately so recurrence is easier to detect and gate.',
      ];
      break;
    case 'recursive-improvement':
      suggestedPaths = [KNOWLEDGE_REFLECTION_RULE_PATH, VISIBLE_REFLECTION_CORRECTION_PATH, GATE_ENTRYPOINTS_PATH];
      suggestedPatterns = ['ops/improvement/patterns/<slug>.md', 'ops/improvement/validated-practices/<slug>.md'];
      notes = [
        'Learning-plane updates should leave both a rule artifact and a reusable practice or failure pattern.',
      ];
      break;
    case 'knowledge-control':
      suggestedPaths = [BLUEPRINT_PATH, CANONICAL_MAP_PATH, KNOWLEDGE_REFLECTION_RULE_PATH];
      suggestedPatterns = ['ops/knowledge-control/topics/<topic>.md', 'ops/knowledge-control/entities/<entityKey>.md'];
      notes = [
        'Navigation-layer updates should preserve index/log coherence and topic/entity coverage.',
      ];
      break;
    case 'guild-memory':
      suggestedPaths = [...buildGuildCorePaths(guildId), KNOWLEDGE_REFLECTION_RULE_PATH];
      suggestedPatterns = guildId
        ? [`guilds/${guildId}/events/ingest/<artifact>.md`, `guilds/${guildId}/events/subscriptions/<date>_<mode>_<slug>.md`]
        : ['guilds/<guildId>/events/ingest/<artifact>.md'];
      notes = [
        'Guild-scoped records should update lore, history, or decision hubs before escalating into customer ledgers.',
      ];
      break;
    default:
      suggestedPaths = [BLUEPRINT_PATH, CANONICAL_MAP_PATH, KNOWLEDGE_REFLECTION_RULE_PATH];
      suggestedPatterns = ['ops/knowledge-control/topics/<topic>.md'];
      notes = [
        'General record updates should still close the loop through index, log, and visible search verification.',
      ];
      break;
  }

  return {
    targetPath,
    plane,
    concern,
    requiredPaths,
    suggestedPaths: dedupeStrings(suggestedPaths),
    suggestedPatterns,
    verificationChecklist: [...CONTROL_TOWER_BLUEPRINT.reflectionChecklist],
    gatePaths,
    customerImpact,
    notes,
  };
};

export const getObsidianKnowledgeControlSurface = () => {
  const compiler = getObsidianKnowledgeCompilationStats();
  const artifactPaths = listObsidianKnowledgeArtifactPaths(compiler);
  const controlPaths = [...CONTROL_TOWER_PATHS];
  const backfillCatalog = loadKnowledgeBackfillCatalog();
  const supervisorAvailable = artifactPaths.includes(SUPERVISOR_PATH);
  return {
    compiler,
    artifactPaths,
    artifactSupport: {
      enabled: true,
      queryParam: 'artifact',
      acceptedAliases: [
        'index',
        'log',
        'lint',
        'supervisor',
        'blueprint',
        'canonical-map',
        'cadence',
        'gate-entrypoints',
        'topic:<slug>',
        'entity:<slug>',
      ],
    },
    supervisor: {
      alias: 'supervisor',
      path: SUPERVISOR_PATH,
      available: supervisorAvailable,
      includedInLastRun: supervisorAvailable && compiler.lastArtifacts.includes(SUPERVISOR_PATH),
      lastCompiledAt: compiler.lastCompiledAt,
    },
    controlPaths,
    blueprint: cloneBlueprint(CONTROL_TOWER_BLUEPRINT),
    backfillCatalog: {
      schemaVersion: backfillCatalog.schemaVersion,
      updatedAt: backfillCatalog.updatedAt,
      description: backfillCatalog.description,
      policy: cloneCatalogPolicy(backfillCatalog.policy),
      entries: backfillCatalog.entries.map(cloneCatalogEntry),
    },
    accessProfile: buildKnowledgeAccessProfile(backfillCatalog),
    bundleSupport: {
      enabled: true,
      queryParam: 'bundleFor',
      acceptedAliases: ['blueprint', 'canonical-map', 'cadence', 'gate-entrypoints'],
    },
    pathIndex: buildKnowledgePathIndex([
      ...controlPaths.map((path) => ({ path, generated: false })),
      ...artifactPaths.map((path) => ({ path, generated: true })),
    ]),
  };
};

export const runKnowledgeCompilationForNote = async (params: {
  guildId: string;
  vaultPath: string;
  filePath: string;
  content: string;
  properties?: Record<string, ObsidianFrontmatterValue | null>;
}): Promise<ObsidianKnowledgeCompilationResult> => {
  const triggeredAt = new Date().toISOString();
  recordState({
    lastTriggeredAt: triggeredAt,
    lastNotePath: normalizePath(params.filePath),
  });

  const decision = buildDecision({
    filePath: params.filePath,
    content: params.content,
    guildId: params.guildId,
  });

  if (!decision.shouldCompile) {
    recordState({
      skipped: state.skipped + 1,
      lastReason: decision.reason,
      lastTopics: [],
      lastEntityKey: null,
      lastArtifacts: [],
      lastIndexedNotes: 0,
      lastLintSummary: null,
    });
    return {
      compiled: false,
      reason: decision.reason,
      indexedNotes: 0,
      artifacts: [],
      topics: [],
      entityKey: null,
    };
  }

  try {
    const snapshot = await collectSnapshot(params);
    const generatedAt = new Date().toISOString();
    const artifacts: string[] = [];
    const topicSet = new Set<string>(decision.topics);
    const lintSummary = buildLintSummary(snapshot, generatedAt);

    for (const note of snapshot) {
      if (note.entityKey === decision.entityKey) {
        note.topics.forEach((topic) => topicSet.add(topic));
      }
    }

    const indexDoc = buildIndexArtifact(snapshot, generatedAt);
    const indexPath = await writeArtifact({
      guildId: params.guildId,
      vaultPath: params.vaultPath,
      filePath: INDEX_PATH,
      markdown: indexDoc.markdown,
      tags: indexDoc.tags,
      properties: indexDoc.properties,
    });
    if (indexPath) {
      artifacts.push(indexPath);
    }

    const logDoc = buildLogArtifact(snapshot, generatedAt);
    const logPath = await writeArtifact({
      guildId: params.guildId,
      vaultPath: params.vaultPath,
      filePath: LOG_PATH,
      markdown: logDoc.markdown,
      tags: logDoc.tags,
      properties: logDoc.properties,
    });
    if (logPath) {
      artifacts.push(logPath);
    }

    const lintDoc = buildLintArtifact(lintSummary, generatedAt);
    const lintPath = await writeArtifact({
      guildId: params.guildId,
      vaultPath: params.vaultPath,
      filePath: LINT_PATH,
      markdown: lintDoc.markdown,
      tags: lintDoc.tags,
      properties: lintDoc.properties,
    });
    if (lintPath) {
      artifacts.push(lintPath);
    }

    const topics = [...topicSet].slice(0, 6);
    for (const topic of topics) {
      const topicDoc = buildTopicArtifact(topic, snapshot, generatedAt);
      const topicPath = await writeArtifact({
        guildId: params.guildId,
        vaultPath: params.vaultPath,
        filePath: buildTopicArtifactPath(topic),
        markdown: topicDoc.markdown,
        tags: topicDoc.tags,
        properties: topicDoc.properties,
      });
      if (topicPath) {
        artifacts.push(topicPath);
      }
    }

    if (decision.entityKey) {
      const entityDoc = buildEntityArtifact(decision.entityKey, snapshot, generatedAt);
      const entityPath = await writeArtifact({
        guildId: params.guildId,
        vaultPath: params.vaultPath,
        filePath: buildEntityArtifactPath(decision.entityKey),
        markdown: entityDoc.markdown,
        tags: entityDoc.tags,
        properties: entityDoc.properties,
      });
      if (entityPath) {
        artifacts.push(entityPath);
      }
    }

    try {
      const supervisorReport = await buildKnowledgeSupervisorReport({
        triggeredPath: normalizePath(params.filePath),
        entityKey: decision.entityKey,
        topics,
        lintSummary,
      });
      const supervisorDoc = buildSupervisorArtifact({
        generatedAt,
        triggeredPath: normalizePath(params.filePath),
        entityKey: decision.entityKey,
        topics,
        report: supervisorReport,
      });
      const supervisorPath = await writeArtifact({
        guildId: params.guildId,
        vaultPath: params.vaultPath,
        filePath: SUPERVISOR_PATH,
        markdown: supervisorDoc.markdown,
        tags: supervisorDoc.tags,
        properties: supervisorDoc.properties,
      });
      if (supervisorPath) {
        artifacts.push(supervisorPath);
      }
    } catch (error) {
      logger.warn('[OBSIDIAN-KNOWLEDGE] supervisor artifact failed file=%s error=%s', params.filePath, getErrorMessage(error));
    }

    recordState({
      runs: state.runs + 1,
      lastCompiledAt: generatedAt,
      lastReason: null,
      lastArtifacts: artifacts,
      lastTopics: topics,
      lastEntityKey: decision.entityKey,
      lastIndexedNotes: snapshot.length,
      lastLintSummary: lintSummary,
    });

    return {
      compiled: true,
      reason: null,
      indexedNotes: snapshot.length,
      artifacts,
      topics,
      entityKey: decision.entityKey,
    };
  } catch (error) {
    const reason = getErrorMessage(error);
    logger.warn('[OBSIDIAN-KNOWLEDGE] compilation failed file=%s error=%s', params.filePath, reason);
    recordState({
      failures: state.failures + 1,
      lastReason: reason,
      lastArtifacts: [],
      lastTopics: [],
      lastEntityKey: decision.entityKey,
      lastIndexedNotes: 0,
      lastLintSummary: null,
    });
    return {
      compiled: false,
      reason,
      indexedNotes: 0,
      artifacts: [],
      topics: [],
      entityKey: decision.entityKey,
    };
  }
};