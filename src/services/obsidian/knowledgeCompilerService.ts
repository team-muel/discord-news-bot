import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';
import { stripMarkdownExtension } from './authoring';
import { parseObsidianFrontmatter } from './obsidianCacheService';
import { doc } from './obsidianDocBuilder';
import { listObsidianFilesWithAdapter, readObsidianFileWithAdapter, writeObsidianNoteWithAdapter } from './router';
import type { ObsidianFileInfo, ObsidianFrontmatterValue } from './types';

const GENERATED_ROOT = 'ops/knowledge-control';
const INDEX_PATH = `${GENERATED_ROOT}/INDEX.md`;
const LOG_PATH = `${GENERATED_ROOT}/LOG.md`;
const LINT_PATH = `${GENERATED_ROOT}/LINT.md`;
const TOPIC_DIR = `${GENERATED_ROOT}/topics`;
const ENTITY_DIR = `${GENERATED_ROOT}/entities`;

const TRACKED_ROOTS = ['chat/answers', 'consolidated', 'retros', 'memory'];
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

const normalizePath = (value: string): string => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');

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

const stripFrontmatterBlock = (markdown: string): string => String(markdown || '').replace(/^---\n[\s\S]*?\n---\n?/m, '').trim();

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

const formatTimestamp = (value: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 'n/a';
  }
  return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
};

const buildTopicArtifactPath = (topic: string): string => `${TOPIC_DIR}/${slugify(topic)}.md`;

const buildEntityArtifactPath = (entityKey: string): string => `${ENTITY_DIR}/${slugify(entityKey)}.md`;

const isGeneratedArtifactPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized === INDEX_PATH.toLowerCase()
    || normalized === LOG_PATH.toLowerCase()
    || normalized.startsWith(`${TOPIC_DIR.toLowerCase()}/`)
    || normalized.startsWith(`${ENTITY_DIR.toLowerCase()}/`);
};

const isRawPath = (filePath: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  return normalized.startsWith('chat/inbox/')
    || normalized.startsWith('events/')
    || normalized.includes('/events/')
    || normalized.startsWith('ops/');
};

const isTrackedPath = (filePath: string, guildId: string): boolean => {
  const normalized = normalizePath(filePath).toLowerCase();
  if (TRACKED_ROOTS.some((root) => normalized.startsWith(`${root.toLowerCase()}/`) || normalized === `${root.toLowerCase()}.md`)) {
    return true;
  }
  if (!guildId) {
    return false;
  }
  return normalized.startsWith(`guilds/${guildId.toLowerCase()}/memory/`)
    || normalized.startsWith(`guilds/${guildId.toLowerCase()}/retros/`)
    || normalized.startsWith(`guilds/${guildId.toLowerCase()}/sprint-journal/`);
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

const collectCandidateRoots = (guildId: string): string[] => {
  const roots = new Set<string>(TRACKED_ROOTS);
  if (guildId) {
    roots.add(`guilds/${guildId}/chat/answers`);
    roots.add(`guilds/${guildId}/memory`);
    roots.add(`guilds/${guildId}/retros`);
    roots.add(`guilds/${guildId}/sprint-journal`);
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
  const roots = collectCandidateRoots(params.guildId);

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

export const getObsidianKnowledgeControlSurface = () => {
  const compiler = getObsidianKnowledgeCompilationStats();
  return {
    compiler,
    artifactPaths: listObsidianKnowledgeArtifactPaths(compiler),
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