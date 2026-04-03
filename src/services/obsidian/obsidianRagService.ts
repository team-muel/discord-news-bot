/**
 * Obsidian-based RAG Service
 * 
 * Implements smart document retrieval using Obsidian's graph structure,
 * intent-based routing, and Supabase caching for low-latency responses.
 * 
 * Architecture:
 * 1. Intent Inference: Analyze question to determine relevant categories
 * 2. Graph Search: Query Obsidian structure for related documents
 * 3. Cache Lookup: Check Supabase cache before CLI access
 * 4. Context Assembly: Combine documents with metadata and relationships
 * 5. LLM Response: Provide full context to Claude for answer generation
 */

import { isAnyLlmConfigured } from '../llmClient';
import {
  initObsidianHeadless,
  searchObsidianVault,
  readObsidianFile,
  getObsidianGraphMetadata,
} from './obsidianHeadlessService';
import {
  initObsidianCache,
  loadDocumentsWithCache,
  getCacheStats,
  clearExpiredCache,
} from './obsidianCacheService';
import { writeObsidianNoteWithAdapter } from './router';
import { TtlCache } from '../../utils/ttlCache';
import logger from '../../logger';

// In-memory TTL cache for graph metadata (avoids reload every RAG query)
const GRAPH_META_CACHE_TTL_MS = Math.max(30_000, Number(process.env.OBSIDIAN_GRAPH_META_CACHE_TTL_MS || 120_000));
const graphMetaCache = new TtlCache<Record<string, any>>(4);
const GRAPH_META_CACHE_KEY = 'graph_metadata';

/** Category routing rules */
const INTENT_ROUTES = {
  trading: {
    tags: ['trading', 'api', 'strategy', 'market'],
    folders: ['docs/planning/', 'docs/adr/'],
    keywords: /trading|stock|price|chart|strategy|variance|cvd|binance|leverage/i,
  },
  architecture: {
    tags: ['architecture', 'design', 'pattern', 'adr'],
    folders: ['docs/adr/', 'docs/'],
    keywords: /architecture|design|pattern|structure|dataflow|integration|harness|layer/i,
  },
  operations: {
    tags: ['ops', 'runbook', 'operations', 'incident', 'monitoring'],
    folders: ['docs/', 'docs/planning/'],
    keywords: /operations|runbook|incident|failure|monitoring|sla|recovery|autoescape|oncall/i,
  },
  development: {
    tags: ['development', 'code', 'api', 'endpoint', 'service'],
    folders: ['src/', 'docs/', 'docs/front-uiux-handoff/'],
    keywords: /code|implement|endpoint|route|service|function|class|method/i,
  },
  memory: {
    tags: ['memory', 'rag', 'retrieval', 'context', 'embedding'],
    folders: ['docs/planning/', 'docs/adr/'],
    keywords: /memory|rag|retrieval|embedding|context|lore|narrative|poison|sanitization/i,
  },
};

export type IntentCategory = keyof typeof INTENT_ROUTES;

export interface RAGQueryResult {
  answer?: string;
  sourceFiles: string[];
  documentContext: string;
  intent: IntentCategory;
  contextMode: 'full' | 'metadata_first';
  documentCount: number;
  cacheStatus: { hits: number; misses: number };
  executionTimeMs: number;
  graphDensity?: { avgBacklinks: number; maxBacklinks: number; connectedRatio: number };
}

type GuildScopeMode = 'off' | 'prefer' | 'strict';

const DEFAULT_CONTEXT_MODE: 'full' | 'metadata_first' =
  String(process.env.OBSIDIAN_RAG_CONTEXT_MODE || 'metadata_first').trim().toLowerCase() === 'full'
    ? 'full'
    : 'metadata_first';

const DEFAULT_GUILD_SCOPE_MODE: GuildScopeMode = (() => {
  const raw = String(process.env.OBSIDIAN_RAG_GUILD_SCOPE_MODE || 'prefer').trim().toLowerCase();
  if (raw === 'off' || raw === 'strict') {
    return raw;
  }
  return 'prefer';
})();

let initialized = false;

/**
 * Initialize RAG system (call once on startup)
 */
export async function initObsidianRAG(): Promise<boolean> {
  if (initialized) return true;

  try {
    const headlessReady = await initObsidianHeadless();
    const cacheReady = await initObsidianCache();

    logger.info('[OBSIDIAN-RAG] Initialized (headless=%s cache=%s)', 
      String(headlessReady), String(cacheReady)
    );

    // Periodic cache cleanup (every hour)
    const cacheCleanupTimer = setInterval(() => {
      clearExpiredCache().catch(error =>
        logger.warn('[OBSIDIAN-RAG] Cache cleanup failed: %o', error)
      );
    }, 3600000);
    cacheCleanupTimer.unref();

    initialized = true;
    return true;
  } catch (error) {
    logger.error('[OBSIDIAN-RAG] Initialization failed: %o', error);
    return false;
  }
}

/**
 * Main RAG query function
 */
export async function queryObsidianRAG(
  question: string,
  options?: { maxDocs?: number; debug?: boolean; contextMode?: 'full' | 'metadata_first'; guildId?: string }
): Promise<RAGQueryResult> {
  const startTime = Date.now();
  const maxDocs = options?.maxDocs || 10;
  const contextMode = options?.contextMode || DEFAULT_CONTEXT_MODE;
  const cacheStatus = { hits: 0, misses: 0 };

  try {
    // 1. Infer intent from question
    const intent = inferIntent(question);
    logger.info('[OBSIDIAN-RAG] Query intent=%s question=%s', intent, question.slice(0, 50));

    // 2. Route to relevant documents
    const routes = INTENT_ROUTES[intent];
    const documentPaths = await findRelatedDocuments(question, routes, maxDocs, options?.guildId);

    if (documentPaths.length === 0) {
      logger.warn('[OBSIDIAN-RAG] No relevant documents found for intent=%s', intent);
      // Knowledge gap: record failed query
      recordKnowledgeGap(question, intent, options?.guildId);
      return {
        sourceFiles: [],
        documentContext: '(No relevant documents found)',
        intent,
        contextMode,
        documentCount: 0,
        cacheStatus,
        executionTimeMs: Date.now() - startTime,
      };
    }

    // 3. Load documents with cache
    logger.debug('[OBSIDIAN-RAG] Loading %d documents', documentPaths.length);
    const documents = await loadDocumentsWithCache(documentPaths, async (path) => {
      const content = await readObsidianFile(path);
      if (content) cacheStatus.hits++;
      else cacheStatus.misses++;
      return content;
    });

    // 4. Get graph metadata for relationship context (TTL-cached in memory)
    let graphMetadata = graphMetaCache.get(GRAPH_META_CACHE_KEY);
    if (!graphMetadata) {
      graphMetadata = await getObsidianGraphMetadata();
      graphMetaCache.set(GRAPH_META_CACHE_KEY, graphMetadata, GRAPH_META_CACHE_TTL_MS);
    }

    // 5. Assemble context
    const contextText = assembleContext(documents, graphMetadata, contextMode);

    // 6. Compute graph density metrics
    const graphDensity = computeGraphDensity(Array.from(documents.keys()), graphMetadata);

    // Log stats
    const stats = await getCacheStats();
    if (stats && options?.debug) {
      logger.debug('[OBSIDIAN-RAG] Cache stats: %o', stats);
    }

    logger.info(
      '[OBSIDIAN-RAG] Query complete intent=%s docs=%d time=%dms cache_hit=%d miss=%d',
      intent,
      documents.size,
      Date.now() - startTime,
      cacheStatus.hits,
      cacheStatus.misses
    );

    const result: RAGQueryResult = {
      sourceFiles: Array.from(documents.keys()),
      documentContext: contextText,
      intent,
      contextMode,
      documentCount: documents.size,
      cacheStatus,
      executionTimeMs: Date.now() - startTime,
      graphDensity,
    };

    // Reactive learning: fire-and-forget write of query insight to vault
    void writeQueryInsight({
      question,
      intent,
      sourceFiles: result.sourceFiles,
      documentCount: result.documentCount,
      executionTimeMs: result.executionTimeMs,
      guildId: options?.guildId,
    });

    return result;
  } catch (error) {
    logger.error('[OBSIDIAN-RAG] Query failed: %o', error);
    return {
      sourceFiles: [],
      documentContext: 'RAG query failed. Please try again later.',
      intent: 'development',
      contextMode,
      documentCount: 0,
      cacheStatus,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Infer intent category from question text using multi-match scoring
 */
export function inferIntent(question: string): IntentCategory {
  let bestCategory: IntentCategory = 'development';
  let bestScore = 0;

  for (const [category, route] of Object.entries(INTENT_ROUTES)) {
    const matches = question.match(route.keywords);
    if (matches) {
      // Score by number of keyword matches
      const allMatches = question.matchAll(new RegExp(route.keywords, 'gi'));
      let matchCount = 0;
      for (const _ of allMatches) matchCount++;
      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestCategory = category as IntentCategory;
      }
    }
  }

  return bestCategory;
}

/**
 * Find related documents based on intent and question
 */
async function findRelatedDocuments(
  question: string,
  routes: typeof INTENT_ROUTES[IntentCategory],
  limit: number,
  guildId?: string,
): Promise<string[]> {
  const scoredResults = new Map<string, number>();

  try {
    // Search by tag in parallel to reduce total query latency.
    const perTagLimit = Math.max(1, Math.ceil(limit / Math.max(1, routes.tags.length)));
    const searches = routes.tags.map((tag) => searchObsidianVault(`tag:${tag}`, perTagLimit));
    const tagResultsList = await Promise.all(searches);

    for (const tagResults of tagResultsList) {
      tagResults.forEach((r: { filePath: string; score?: number }) => {
        const normalizedPath = normalizeResultPath(r.filePath);
        if (!normalizedPath) {
          return;
        }
        const score = Number.isFinite(r.score) ? Number(r.score) : 0;
        const prev = scoredResults.get(normalizedPath);
        if (prev === undefined || score > prev) {
          scoredResults.set(normalizedPath, score);
        }
      });
    }

    // Graph-first boost: use cached graph metadata to boost scores by connectivity
    const graphMetadata = graphMetaCache.get(GRAPH_META_CACHE_KEY);
    if (graphMetadata && Object.keys(graphMetadata).length > 0) {
      for (const [filePath, baseScore] of scoredResults) {
        const meta = graphMetadata[filePath];
        if (!meta) continue;
        const backlinkCount = Array.isArray(meta.backlinks) ? meta.backlinks.length : 0;
        const linkCount = Array.isArray(meta.links) ? meta.links.length : 0;
        // Logarithmic boost: highly-connected docs get priority (max ~0.3 boost)
        const connectivityBoost = Math.min(0.3, Math.log2(1 + backlinkCount + linkCount) * 0.05);
        scoredResults.set(filePath, baseScore + connectivityBoost);
      }
    }

    // 2-hop graph traversal: discover connected documents through backlinks/links
    if (graphMetadata && Object.keys(graphMetadata).length > 0) {
      const topEntries = [...scoredResults.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // Expand from top 5 initial results

      for (const [seedPath, seedScore] of topEntries) {
        const meta = graphMetadata[seedPath];
        if (!meta) continue;

        const neighbors = [
          ...(Array.isArray(meta.backlinks) ? meta.backlinks : []),
          ...(Array.isArray(meta.links) ? meta.links : []),
        ];

        for (const neighbor of neighbors) {
          const normalizedNeighbor = normalizeResultPath(neighbor);
          if (!normalizedNeighbor || scoredResults.has(normalizedNeighbor)) continue;
          // 2nd-degree docs get half the seed score, capped at 0.4
          const hopScore = Math.min(0.4, seedScore * 0.5);
          scoredResults.set(normalizedNeighbor, hopScore);
        }
      }
    }

    const rankedPaths = [...scoredResults.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([filePath]) => filePath);
    const paths = applyGuildScopeRanking(rankedPaths, guildId, limit);
    
    logger.debug('[OBSIDIAN-RAG] Found %d documents (incl. 2-hop) for intent, returning %d', scoredResults.size, paths.length);
    return paths;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Document search failed: %o', error);
    return [];
  }
}

function normalizeResultPath(filePath: unknown): string {
  return String(filePath || '').trim().replace(/\\/g, '/');
}

function sanitizeGuildId(guildId: unknown): string {
  const value = String(guildId || '').trim();
  if (!/^\d{6,30}$/.test(value)) {
    return '';
  }
  return value;
}

function applyGuildScopeRanking(paths: string[], guildId: string | undefined, limit: number): string[] {
  const safeGuildId = sanitizeGuildId(guildId);
  const mode = DEFAULT_GUILD_SCOPE_MODE;
  if (!safeGuildId || mode === 'off') {
    return paths.slice(0, limit);
  }

  const guildPrefix = `guilds/${safeGuildId}/`;
  const guildPaths = paths.filter((filePath) => filePath.startsWith(guildPrefix));
  if (mode === 'strict') {
    return guildPaths.slice(0, limit);
  }

  const globalPaths = paths.filter((filePath) => !filePath.startsWith(guildPrefix));
  return [...guildPaths, ...globalPaths].slice(0, limit);
}

/**
 * Assemble context from documents with metadata
 */
function assembleContext(
  documents: Map<string, { content: string; frontmatter?: Record<string, any> }>,
  graphMetadata: Record<string, any> = {},
  contextMode: 'full' | 'metadata_first' = DEFAULT_CONTEXT_MODE,
): string {
  const parts: string[] = [];

  let docIndex = 1;
  for (const [path, doc] of documents.entries()) {
    const meta = graphMetadata[path];
    const backlinkCount = Array.isArray(meta?.backlinks) ? meta.backlinks.length : 0;
    const linkCount = Array.isArray(meta?.links) ? meta.links.length : 0;

    // Header with metadata + connection density
    const header = [
      `【문서 ${docIndex}】 ${path}`,
      meta?.title ? `제목: ${meta.title}` : null,
      meta?.tags?.length ? `태그: ${meta.tags.join(', ')}` : null,
      meta?.category ? `분류: ${meta.category}` : null,
      (backlinkCount > 0 || linkCount > 0) ? `연결: ←${backlinkCount} →${linkCount}` : null,
      meta?.backlinks?.length 
        ? `인용: ${meta.backlinks.slice(0, 3).join(', ')}${meta.backlinks.length > 3 ? ` 외 ${meta.backlinks.length - 3}건` : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    parts.push(`## ${header}\n`);
    if (contextMode === 'metadata_first') {
      const snippet = String(doc.content || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 320);
      parts.push(`요약 스니펫: ${snippet}`);
    } else {
      parts.push(doc.content);
    }
    parts.push('\n');

    docIndex++;
  }

  return parts.join('\n---\n\n');
}

/**
 * Compute graph density metrics for the returned document set
 */
function computeGraphDensity(
  filePaths: string[],
  graphMetadata: Record<string, any>,
): { avgBacklinks: number; maxBacklinks: number; connectedRatio: number } {
  if (filePaths.length === 0) {
    return { avgBacklinks: 0, maxBacklinks: 0, connectedRatio: 0 };
  }

  let totalBacklinks = 0;
  let maxBacklinks = 0;
  let connectedCount = 0;

  for (const filePath of filePaths) {
    const meta = graphMetadata[filePath];
    const count = Array.isArray(meta?.backlinks) ? meta.backlinks.length : 0;
    totalBacklinks += count;
    if (count > maxBacklinks) maxBacklinks = count;
    if (count > 0) connectedCount++;
  }

  return {
    avgBacklinks: Math.round((totalBacklinks / filePaths.length) * 10) / 10,
    maxBacklinks,
    connectedRatio: Math.round((connectedCount / filePaths.length) * 100) / 100,
  };
}

/**
 * Write sprint retro summary to Obsidian vault for graph-first retrieval
 */
export async function writeRetroToVault(params: {
  sprintId: string;
  guildId?: string;
  summary: string;
  lessonsLearned: { keep: string[]; stop: string[]; start: string[] };
  metrics?: Record<string, number | string>;
}): Promise<{ path: string } | null> {
  const vaultPath = String(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || '').trim();

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${dateStr}_retro_${params.sprintId}.md`;

  const content = [
    `# Sprint Retro: ${params.sprintId}`,
    '',
    `> Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    params.summary,
    '',
    '## Keep',
    ...params.lessonsLearned.keep.map((item) => `- ${item}`),
    '',
    '## Stop',
    ...params.lessonsLearned.stop.map((item) => `- ${item}`),
    '',
    '## Start',
    ...params.lessonsLearned.start.map((item) => `- ${item}`),
    '',
    params.metrics ? '## Metrics' : '',
    params.metrics
      ? Object.entries(params.metrics).map(([k, v]) => `- **${k}**: ${v}`).join('\n')
      : '',
  ].filter((line) => line !== undefined).join('\n');

  const tags = ['retro', `sprint-${params.sprintId}`, 'lessons-learned'];

  try {
    const result = await writeObsidianNoteWithAdapter({
      guildId: params.guildId || '',
      vaultPath,
      fileName: `retros/${fileName}`,
      content,
      tags,
      properties: {
        schema: 'retro/v1',
        sprint_id: params.sprintId,
        created_at: new Date().toISOString(),
      },
    });

    if (result) {
      logger.info('[OBSIDIAN-RAG] Retro written to vault: %s', result.path);
    }
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Failed to write retro to vault: %s', error instanceof Error ? error.message : String(error));
    return null;
  }
}

// ── Reactive Learning Loop ─────────────────────────────────────

const REACTIVE_LEARNING_ENABLED = String(process.env.OBSIDIAN_REACTIVE_LEARNING ?? 'true').trim() === 'true';
const REACTIVE_MIN_DOCS = 2; // Only record insights when >= N docs found (skip trivial queries)
let _insightCounter = 0;
const INSIGHT_WRITE_INTERVAL = Math.max(1, Number(process.env.OBSIDIAN_REACTIVE_WRITE_INTERVAL || 5)); // Write every N-th query

async function writeQueryInsight(params: {
  question: string;
  intent: IntentCategory;
  sourceFiles: string[];
  documentCount: number;
  executionTimeMs: number;
  guildId?: string;
}): Promise<void> {
  if (!REACTIVE_LEARNING_ENABLED) return;
  if (params.documentCount < REACTIVE_MIN_DOCS) return;

  _insightCounter++;
  if (_insightCounter % INSIGHT_WRITE_INTERVAL !== 0) return;

  const vaultPath = String(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || '').trim();
  const dateStr = new Date().toISOString().slice(0, 10);
  const timeTag = new Date().toISOString().slice(11, 16).replace(':', '');
  const fileName = `insights/${dateStr}_query_${timeTag}.md`;

  const topSources = params.sourceFiles.slice(0, 5).map((f) => `- [[${f}]]`).join('\n');

  const content = [
    `# Query Insight`,
    '',
    `> ${new Date().toISOString()}`,
    '',
    `**Question:** ${params.question.slice(0, 200)}`,
    `**Intent:** ${params.intent}`,
    `**Documents found:** ${params.documentCount}`,
    `**Execution:** ${params.executionTimeMs}ms`,
    '',
    '## Top Sources',
    topSources,
    '',
    '## Context',
    `This note was auto-generated by the RAG reactive learning loop to map frequently asked topics back to vault structure.`,
  ].join('\n');

  try {
    await writeObsidianNoteWithAdapter({
      guildId: params.guildId || '',
      vaultPath,
      fileName,
      content,
      tags: ['query-insight', params.intent, 'reactive-learning'],
      properties: {
        schema: 'query-insight/v1',
        intent: params.intent,
        doc_count: params.documentCount,
        latency_ms: params.executionTimeMs,
      },
    });
    logger.debug('[OBSIDIAN-RAG] Query insight written: %s', fileName);
  } catch (error) {
    logger.debug('[OBSIDIAN-RAG] Query insight write failed (non-critical): %s', error instanceof Error ? error.message : String(error));
  }
}

// ── Knowledge Gap Detection ────────────────────────────────────

interface KnowledgeGapEntry {
  question: string;
  intent: IntentCategory;
  guildId?: string;
  timestamp: number;
}

const _knowledgeGaps: KnowledgeGapEntry[] = [];
const KNOWLEDGE_GAP_MAX_BUFFER = 50;
const KNOWLEDGE_GAP_FLUSH_THRESHOLD = Math.max(3, Number(process.env.OBSIDIAN_GAP_FLUSH_THRESHOLD || 10));

function recordKnowledgeGap(question: string, intent: IntentCategory, guildId?: string): void {
  _knowledgeGaps.push({
    question: question.slice(0, 200),
    intent,
    guildId,
    timestamp: Date.now(),
  });

  // Cap buffer to prevent memory growth
  if (_knowledgeGaps.length > KNOWLEDGE_GAP_MAX_BUFFER) {
    _knowledgeGaps.splice(0, _knowledgeGaps.length - KNOWLEDGE_GAP_MAX_BUFFER);
  }

  // Auto-flush when enough gaps accumulate
  if (_knowledgeGaps.length >= KNOWLEDGE_GAP_FLUSH_THRESHOLD) {
    void flushKnowledgeGaps();
  }
}

export async function flushKnowledgeGaps(): Promise<{ path: string } | null> {
  if (_knowledgeGaps.length === 0) return null;

  const vaultPath = String(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || '').trim();
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `gaps/${dateStr}_knowledge_gaps.md`;

  // Group by intent
  const byIntent = new Map<string, KnowledgeGapEntry[]>();
  for (const gap of _knowledgeGaps) {
    const existing = byIntent.get(gap.intent) ?? [];
    existing.push(gap);
    byIntent.set(gap.intent, existing);
  }

  const sections: string[] = [
    `# Knowledge Gaps Report`,
    '',
    `> Generated: ${new Date().toISOString()}`,
    `> Total unanswered queries: ${_knowledgeGaps.length}`,
    '',
  ];

  for (const [intent, gaps] of byIntent) {
    sections.push(`## ${intent} (${gaps.length})`);
    for (const gap of gaps) {
      const ts = new Date(gap.timestamp).toISOString().slice(11, 19);
      sections.push(`- [${ts}] ${gap.question}`);
    }
    sections.push('');
  }

  sections.push('## Recommended Actions');
  sections.push('- Review unanswered questions and create or update relevant vault notes');
  sections.push('- Consider adding tags or backlinks to improve discoverability');

  const count = _knowledgeGaps.length;
  _knowledgeGaps.length = 0; // Clear buffer after flush

  try {
    const result = await writeObsidianNoteWithAdapter({
      guildId: '',
      vaultPath,
      fileName,
      content: sections.join('\n'),
      tags: ['knowledge-gap', 'needs-content', 'auto-generated'],
      properties: {
        schema: 'knowledge-gap/v1',
        gap_count: count,
        created_at: new Date().toISOString(),
      },
    });

    if (result) {
      logger.info('[OBSIDIAN-RAG] Knowledge gaps flushed (%d entries): %s', count, result.path);
    }
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Knowledge gap flush failed: %s', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Get current knowledge gap buffer size (for monitoring / tests)
 */
export function getKnowledgeGapCount(): number {
  return _knowledgeGaps.length;
}

// ── Daily Note Auto-Append ─────────────────────────────────────

export async function appendToDailyNote(content: string): Promise<boolean> {
  try {
    const { appendDailyNoteWithAdapter } = await import('./router');
    return appendDailyNoteWithAdapter(content);
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Daily note append failed: %s', error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function readDailyNote(): Promise<string | null> {
  try {
    const { readDailyNoteWithAdapter } = await import('./router');
    return readDailyNoteWithAdapter();
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Daily note read failed: %s', error instanceof Error ? error.message : String(error));
    return null;
  }
}
