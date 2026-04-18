export const GENERATED_ROOT = 'ops/knowledge-control';
export const INDEX_PATH = `${GENERATED_ROOT}/INDEX.md`;
export const LOG_PATH = `${GENERATED_ROOT}/LOG.md`;
export const LINT_PATH = `${GENERATED_ROOT}/LINT.md`;
export const SUPERVISOR_PATH = `${GENERATED_ROOT}/SUPERVISOR.md`;
export const TOPIC_DIR = `${GENERATED_ROOT}/topics`;
export const ENTITY_DIR = `${GENERATED_ROOT}/entities`;
export const CONTROL_TOWER_DIR = 'ops/control-tower';
export const BLUEPRINT_PATH = `${CONTROL_TOWER_DIR}/BLUEPRINT.md`;
export const CANONICAL_MAP_PATH = `${CONTROL_TOWER_DIR}/CANONICAL_MAP.md`;
export const CADENCE_PATH = `${CONTROL_TOWER_DIR}/CADENCE.md`;
export const GATE_ENTRYPOINTS_PATH = `${CONTROL_TOWER_DIR}/GATE_ENTRYPOINTS.md`;
export const CONTROL_TOWER_PATHS = [BLUEPRINT_PATH, CANONICAL_MAP_PATH, CADENCE_PATH, GATE_ENTRYPOINTS_PATH] as const;
export const QUALITY_RUBRIC_PATH = 'ops/quality/RUBRIC.md';
export const QUALITY_METRICS_BASELINE_PATH = 'ops/quality/METRICS_BASELINE.md';
export const VISIBLE_REFLECTION_GATE_PATH = 'ops/quality/gates/2026-04-10_visible-reflection-gate.md';
export const VISIBLE_REFLECTION_CORRECTION_PATH = 'ops/improvement/corrections/2026-04-10_visible-reflection-definition.md';
export const KNOWLEDGE_REFLECTION_RULE_PATH = 'ops/improvement/rules/knowledge-reflection-pipeline.md';

export const TRACKED_ROOTS = ['chat/answers', 'consolidated', 'retros', 'memory'];
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
export const GUILD_TRACKED_ROOT_SUFFIXES = ['chat/answers', 'memory', 'retros', 'sprint-journal', 'customer', 'events'];
const GUILD_CORE_FILE_NAMES = ['Guild_Lore.md', 'Server_History.md', 'Decision_Log.md'];

export const normalizePath = (value: string): string => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');

export const matchesPathPrefix = (candidate: string, root: string): boolean => {
  const normalizedCandidate = normalizePath(candidate).toLowerCase();
  const normalizedRoot = normalizePath(root).toLowerCase();
  if (!normalizedCandidate || !normalizedRoot) {
    return false;
  }
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
};

export const getPathParent = (value: string, levels = 1): string => {
  const segments = normalizePath(value).split('/').filter(Boolean);
  if (segments.length <= levels) {
    return '';
  }
  return segments.slice(0, segments.length - levels).join('/');
};

export const addCandidateRoot = (roots: Set<string>, value: string | null | undefined): void => {
  const normalized = normalizePath(String(value || '')).replace(/\.md$/i, '');
  if (!normalized) {
    return;
  }
  roots.add(normalized);
};

export const normalizeCatalogPath = (value: unknown): string => normalizePath(String(value || ''));

export const normalizeCatalogAudience = (value: unknown): 'operator-primary' | 'shared' | 'agent-support' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'operator-primary' || normalized === 'agent-support') {
    return normalized;
  }
  return 'shared';
};

export const stripKnownSourcePrefix = (value: string): string => String(value || '').trim().replace(/^(repo|vault|obsidian):/i, '');

export const slugify = (value: string, fallback = 'note'): string => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || fallback;
};

export const buildTopicArtifactPath = (topic: string): string => `${TOPIC_DIR}/${slugify(topic)}.md`;

export const buildEntityArtifactPath = (entityKey: string): string => `${ENTITY_DIR}/${slugify(entityKey)}.md`;

export const describeKnowledgePath = (
  filePath: string,
): {
  plane: 'control' | 'runtime' | 'record' | 'learning';
  concern: string;
} => {
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

export const buildKnowledgePathIndex = (
  paths: Array<{ path: string; generated: boolean }>,
): Array<{ path: string; plane: 'control' | 'runtime' | 'record' | 'learning'; concern: string; generated: boolean }> => {
  const seen = new Set<string>();
  const result: Array<{ path: string; plane: 'control' | 'runtime' | 'record' | 'learning'; concern: string; generated: boolean }> = [];

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

export const extractGuildIdFromPath = (value: string): string | null => {
  const match = normalizePath(value).match(/^guilds\/([^/]+)\//i);
  return match?.[1] || null;
};

export const extractServiceSlugFromPath = (value: string): string | null => {
  const match = normalizePath(value).match(/^ops\/services\/([^/]+)\//i);
  return match?.[1] || null;
};

export const isGeneratedArtifactPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith(`${GENERATED_ROOT.toLowerCase()}/`);
};

export const isRawPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith('chat/inbox/')
    || normalized.startsWith('events/raw/')
    || normalized.includes('/events/raw/');
};

export const isTrackedPath = (filePath: string, guildId: string): boolean => {
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

export const resolveKnowledgeArtifactPath = (value: string): string | null => {
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

const stripMarkdownPathExtension = (value: string): string => String(value || '').trim().replace(/\.md$/i, '');

export const toKnowledgeWikilink = (filePath: string, alias?: string): string => {
  const target = stripMarkdownPathExtension(normalizePath(filePath));
  if (!target) {
    return alias || '';
  }
  return alias ? `[[${target}|${alias}]]` : `[[${target}]]`;
};