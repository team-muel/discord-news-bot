import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { doc } from './obsidianDocBuilder';
import { writeObsidianNoteWithAdapter } from './router';
import { getToolCatalog } from '../tools/externalAdapterRegistry';
import type { ObsidianKnowledgeReflectionBundle } from './knowledgeCompilerService';

const sanitizeGuildId = (value: unknown): string => {
  const candidate = String(value || '').trim();
  if (!/^\d{6,30}$/.test(candidate)) {
    return '';
  }
  return candidate;
};

const sanitizeFileName = (value: unknown): string => {
  const candidate = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return candidate || 'Untitled';
};

export const stripMarkdownExtension = (value: string): string => {
  return String(value || '').trim().replace(/\.md$/i, '');
};

const canonicalizeLoreDocName = (rawName: string): string => {
  const normalized = stripMarkdownExtension(rawName)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .trim();

  if (normalized === 'guild_lore' || normalized === 'lore') {
    return 'Guild_Lore';
  }
  if (normalized === 'server_history' || normalized === 'history') {
    return 'Server_History';
  }
  if (normalized === 'decision_log' || normalized === 'decisions' || normalized === 'decision') {
    return 'Decision_Log';
  }

  return sanitizeFileName(stripMarkdownExtension(rawName));
};

const normalizeNestedRelativePath = (rawPath: string): string => {
  const normalized = stripMarkdownExtension(rawPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  const segments = normalized
    .split('/')
    .map((segment) => sanitizeFileName(segment))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

  return segments.join('/');
};

const toGuildRelativePath = (guildId: string, fileName: string): string => {
  const nested = normalizeNestedRelativePath(fileName);
  if (nested.includes('/')) {
    return `guilds/${guildId}/${nested}.md`;
  }

  const baseName = canonicalizeLoreDocName(nested || fileName);
  return `guilds/${guildId}/${baseName}.md`;
};

const normalizeTags = (tags?: string[]): string[] => {
  return (tags || [])
    .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, 40);
};

type ReflectionBundleBuilder = (value: string) => ObsidianKnowledgeReflectionBundle | null;

export type ObsidianAuthoringWriteResult = {
  ok: boolean;
  path: string | null;
  reason?: string;
  reflectionBundle?: ObsidianKnowledgeReflectionBundle | null;
};

export type ObsidianReflectionBundleSummary = {
  plane: string;
  concern: string;
  nextPath: string;
  customerImpact: boolean;
};

let reflectionBundleBuilderPromise: Promise<ReflectionBundleBuilder> | null = null;

const loadReflectionBundleBuilder = async (): Promise<ReflectionBundleBuilder> => {
  if (!reflectionBundleBuilderPromise) {
    reflectionBundleBuilderPromise = import('./knowledgeCompilerService')
      .then((module) => module.buildObsidianKnowledgeReflectionBundle);
  }
  return reflectionBundleBuilderPromise;
};

const resolveReflectionBundle = async (path: string): Promise<ObsidianKnowledgeReflectionBundle | null> => {
  const targetPath = String(path || '').trim();
  if (!targetPath) {
    return null;
  }

  try {
    const buildReflectionBundle = await loadReflectionBundleBuilder();
    return buildReflectionBundle(targetPath);
  } catch (error) {
    logger.warn('[OBSIDIAN-AUTHORING] reflection bundle resolve failed path=%s error=%s', targetPath, getErrorMessage(error));
    return null;
  }
};

export const summarizeReflectionBundle = (bundle: ObsidianKnowledgeReflectionBundle | null | undefined): ObsidianReflectionBundleSummary => {
  return {
    plane: bundle?.plane || 'none',
    concern: bundle?.concern || 'none',
    nextPath: bundle?.suggestedPaths[0] || bundle?.gatePaths[0] || 'none',
    customerImpact: Boolean(bundle?.customerImpact),
  };
};

const buildWriteSuccess = async (path: string): Promise<ObsidianAuthoringWriteResult> => {
  const reflectionBundle = await resolveReflectionBundle(path);
  const reflection = summarizeReflectionBundle(reflectionBundle);

  if (reflectionBundle) {
    logger.info(
      '[OBSIDIAN-AUTHORING] reflection bundle plane=%s concern=%s next=%s target=%s',
      reflection.plane,
      reflection.concern,
      reflection.nextPath,
      reflectionBundle.targetPath,
    );
  }

  return {
    ok: true,
    path,
    reflectionBundle,
  };
};

export const upsertObsidianSystemDocument = async (params: {
  vaultPath: string;
  fileName: string;
  content: string;
  tags?: string[];
  properties?: Record<string, string | number | boolean | null>;
  allowHighLinkDensity?: boolean;
}): Promise<ObsidianAuthoringWriteResult> => {
  const vaultPath = String(params.vaultPath || '').trim();
  if (!vaultPath) {
    return { ok: false, path: null, reason: 'VAULT_PATH_REQUIRED', reflectionBundle: null };
  }

  const content = String(params.content || '').trim();
  if (!content) {
    return { ok: false, path: null, reason: 'EMPTY_CONTENT', reflectionBundle: null };
  }

  const relativePath = normalizeNestedRelativePath(params.fileName) + '.md';

  const result = await writeObsidianNoteWithAdapter({
    guildId: '',
    vaultPath,
    fileName: relativePath,
    content,
    tags: normalizeTags(params.tags),
    properties: params.properties || {},
    trustedSource: true,
    allowHighLinkDensity: Boolean(params.allowHighLinkDensity),
  });

  if (!result?.path) {
    logger.warn('[OBSIDIAN-AUTHORING] system write failed file=%s', params.fileName);
    return { ok: false, path: null, reason: 'WRITE_FAILED', reflectionBundle: null };
  }

  return buildWriteSuccess(result.path);
};

export const upsertObsidianGuildDocument = async (params: {
  guildId: string;
  vaultPath: string;
  fileName: string;
  content: string;
  tags?: string[];
  properties?: Record<string, string | number | boolean | null>;
}): Promise<ObsidianAuthoringWriteResult> => {
  const guildId = sanitizeGuildId(params.guildId);
  if (!guildId) {
    return { ok: false, path: null, reason: 'INVALID_GUILD_ID', reflectionBundle: null };
  }

  const vaultPath = String(params.vaultPath || '').trim();
  if (!vaultPath) {
    return { ok: false, path: null, reason: 'VAULT_PATH_REQUIRED', reflectionBundle: null };
  }

  const content = String(params.content || '').trim();
  if (!content) {
    return { ok: false, path: null, reason: 'EMPTY_CONTENT', reflectionBundle: null };
  }

  const result = await writeObsidianNoteWithAdapter({
    guildId,
    vaultPath,
    fileName: toGuildRelativePath(guildId, params.fileName),
    content,
    tags: normalizeTags(params.tags),
    properties: params.properties || {},
    trustedSource: true,
  });

  if (!result?.path) {
    logger.warn('[OBSIDIAN-AUTHORING] write failed for guild=%s file=%s', guildId, params.fileName);
    return { ok: false, path: null, reason: 'WRITE_FAILED', reflectionBundle: null };
  }

  return buildWriteSuccess(result.path);
};

/* ---------- Vault Schema Emitter ---------- */

const VAULT_PATH_REGISTRY = [
  { pattern: 'guilds/{guildId}/Guild_Lore.md', writer: 'lore authoring', description: 'Core guild knowledge hub' },
  { pattern: 'guilds/{guildId}/Server_History.md', writer: 'lore authoring', description: 'Server event timeline' },
  { pattern: 'guilds/{guildId}/Decision_Log.md', writer: 'lore authoring', description: 'Decision records' },
  { pattern: 'guilds/{guildId}/events/ingest/channel_activity_{hourKey}.md', writer: 'discordChannelTelemetryService', description: 'Hourly channel activity snapshots' },
  { pattern: 'guilds/{guildId}/events/reward/reaction_reward_{hourKey}.md', writer: 'discordReactionRewardService', description: 'Hourly reaction reward signals' },
  { pattern: 'guilds/{guildId}/events/topology/discord_topology_{guildId}.md', writer: 'discordTopologySyncService', description: 'Channel/role/thread structure map' },
  { pattern: 'guilds/{guildId}/sprint-journal/{date}_{slug}.md', writer: 'sprintLearningJournal', description: 'Sprint learning entries' },
  { pattern: 'guilds/{guildId}/retros/{date}_retro_{slug}.md', writer: 'obsidianRagService', description: 'Sprint retrospectives' },
  { pattern: 'guilds/{guildId}/memory/{slug}.md', writer: 'memoryConsolidationService', description: 'Consolidated memory notes' },
  { pattern: 'guilds/{guildId}/events/subscriptions/{date}_{mode}_{slug}.md', writer: 'subscriptionNoteWriter', description: 'YouTube subscription content snapshots' },
  { pattern: 'ops/knowledge-control/INDEX.md', writer: 'knowledgeCompilerService', description: 'Auto-generated knowledge index' },
  { pattern: 'ops/knowledge-control/LOG.md', writer: 'knowledgeCompilerService', description: 'Auto-generated knowledge event log' },
  { pattern: 'ops/knowledge-control/LINT.md', writer: 'knowledgeCompilerService', description: 'Auto-generated knowledge lint summary' },
  { pattern: 'ops/knowledge-control/topics/{topic}.md', writer: 'knowledgeCompilerService', description: 'Topic rollup pages' },
  { pattern: 'ops/knowledge-control/entities/{entityKey}.md', writer: 'knowledgeCompilerService', description: 'Entity rollup pages' },
  { pattern: 'ops/control-tower/BLUEPRINT.md', writer: 'control-tower', description: '4-plane operating blueprint' },
  { pattern: 'ops/control-tower/CANONICAL_MAP.md', writer: 'control-tower', description: 'Canonical truth precedence map' },
  { pattern: 'ops/control-tower/CADENCE.md', writer: 'control-tower', description: 'Operational review cadence' },
  { pattern: 'ops/control-tower/GATE_ENTRYPOINTS.md', writer: 'control-tower', description: 'Gate and runtime entrypoint checklist' },
  { pattern: 'ops/services/{service}/PROFILE.md', writer: 'service-memory', description: 'Operational service profile' },
  { pattern: 'ops/quality/METRICS_BASELINE.md', writer: 'quality-control', description: 'Quality metrics baseline' },
  { pattern: 'ops/quality/gates/{date}_{slug}.md', writer: 'quality-control', description: 'Quality gate snapshots and baselines' },
  { pattern: 'ops/incidents/{date}_{slug}.md', writer: 'incident-analysis', description: 'Incident timeline and blast radius record' },
  { pattern: 'ops/vulnerabilities/{slug}.md', writer: 'incident-analysis', description: 'Known vulnerability or weak point record' },
  { pattern: 'ops/improvement/rules/{slug}.md', writer: 'improvement', description: 'Operating rule updates and automation rules' },
  { pattern: 'ops/improvement/corrections/{date}_{slug}.md', writer: 'improvement', description: 'Operator corrections and rule clarifications' },
  { pattern: 'guilds/{guildId}/customer/{artifact}.md', writer: 'customer-memory', description: 'Customer requirements/issues/escalations ledger' },
  { pattern: 'ops/VAULT_SCHEMA.md', writer: 'authoring (system)', description: 'This schema document (auto-generated)' },
  { pattern: 'ops/TOOL_CATALOG.md', writer: 'authoring (system)', description: 'Available tool adapter catalog (auto-generated)' },
] as const;

export const emitVaultSchema = async (): Promise<{ ok: boolean; reason?: string }> => {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    return { ok: false, reason: 'VAULT_PATH_MISSING' };
  }

  const builder = doc()
    .title('Vault Schema')
    .tag('vault-schema', 'auto-generated', 'navigation')
    .property('schema', 'muel-note/v1')
    .property('source', 'vault-schema-emitter')
    .property('generated_at', new Date().toISOString());

  builder.section('Overview')
    .line('Auto-generated map of all vault write paths. Agents use this to navigate the vault.')
    .line('');

  builder.section('Path Registry')
    .table(
      ['Pattern', 'Writer', 'Description'],
      VAULT_PATH_REGISTRY.map((entry) => [
        `\`${entry.pattern}\``, entry.writer, entry.description,
      ]),
    );

  builder.section('Hub Nodes')
    .bullets([
      '[[Guild_Lore]] — primary knowledge hub per guild',
      '[[Server_History]] — event timeline per guild',
      '[[Decision_Log]] — decision records per guild',
    ]);

  builder.section('Layers')
    .bullets([
      '**Raw** (`events/`) — immutable ingested data (telemetry, rewards, topology)',
      '**Wiki** (`sprint-journal/`, `retros/`, `memory/`) — synthesized knowledge from raw sources',
      '**Compiler** (`ops/knowledge-control/`) — generated index/log/topic/entity surfaces over knowledge notes',
      '**Schema** (`ops/VAULT_SCHEMA.md`) — navigation index (this document)',
    ]);

  builder.section('Operating Planes')
    .bullets([
      '**Control Plane** (`ops/control-tower/`, `ops/quality/`) — canonical map, cadence, and gate standards',
      '**Runtime Plane** (`ops/services/`) — service profiles, dependencies, recovery, weak points',
      '**Record Plane** (`ops/knowledge-control/`, `ops/incidents/`, `ops/vulnerabilities/`, `guilds/*/customer/`) — visible evidence and user-facing operating memory',
      '**Learning Plane** (`ops/improvement/`, `retros/`) — corrections, rules, retros, validated practices',
    ]);

  const { markdown } = builder.buildWithFrontmatter();

  return upsertObsidianSystemDocument({
    vaultPath,
    fileName: 'ops/VAULT_SCHEMA',
    content: markdown,
    tags: ['vault-schema', 'auto-generated', 'navigation'],
    properties: {
      schema: 'muel-note/v1',
      source: 'vault-schema-emitter',
      generated_at: new Date().toISOString(),
    },
  });
};

/**
 * Emit a tool catalog note to the Obsidian vault.
 * Lists all available adapters with descriptions and capabilities
 * so agents can discover tools via graph-first retrieval.
 */
export const emitToolCatalog = async (): Promise<{ ok: boolean; reason?: string }> => {
  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath) {
    return { ok: false, reason: 'VAULT_PATH_MISSING' };
  }

  const catalog = await getToolCatalog();

  const builder = doc()
    .title('Tool Catalog')
    .tag('tool-catalog', 'auto-generated', 'navigation', 'adapter')
    .property('schema', 'muel-note/v1')
    .property('source', 'tool-catalog-emitter')
    .property('generated_at', new Date().toISOString())
    .property('adapter_count', catalog.length);

  builder.section('Overview')
    .line('Auto-generated catalog of all available external tool adapters.')
    .line('Agents use this to discover tool capabilities and determine which adapter to route actions to.')
    .line('');

  builder.section('Available Adapters')
    .table(
      ['Adapter', 'Description', 'Capabilities'],
      catalog.map((entry) => [
        `\`${entry.id}\``,
        entry.description,
        entry.capabilities.join(', '),
      ]),
    );

  for (const entry of catalog) {
    builder.section(entry.id, 3)
      .line(entry.description)
      .line('')
      .bullets(entry.capabilities.map((c) => `\`${c}\``));
  }

  const { markdown } = builder.buildWithFrontmatter();

  return upsertObsidianSystemDocument({
    vaultPath,
    fileName: 'ops/TOOL_CATALOG',
    content: markdown,
    tags: ['tool-catalog', 'auto-generated', 'navigation', 'adapter'],
    properties: {
      schema: 'muel-note/v1',
      source: 'tool-catalog-emitter',
      generated_at: new Date().toISOString(),
      adapter_count: catalog.length,
    },
  });
};
