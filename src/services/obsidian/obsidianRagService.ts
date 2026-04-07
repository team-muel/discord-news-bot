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
  isObsidianCapabilityAvailable,
  warmupObsidianAdapters,
  searchObsidianVaultWithAdapter,
  readObsidianFileWithAdapter,
  getObsidianGraphMetadataWithAdapter,
  writeObsidianNoteWithAdapter,
} from './router';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import {
  initObsidianCache,
  loadDocumentsWithCache,
  getCacheStats,
  clearExpiredCache,
} from './obsidianCacheService';
import { TtlCache } from '../../utils/ttlCache';
import logger from '../../logger';
import { doc } from './obsidianDocBuilder';
import { getErrorMessage } from '../../utils/errorMessage';

// In-memory TTL cache for graph metadata (avoids reload every RAG query)
const GRAPH_META_CACHE_TTL_MS = Math.max(30_000, Number(process.env.OBSIDIAN_GRAPH_META_CACHE_TTL_MS || 120_000));
const graphMetaCache = new TtlCache<Record<string, any>>(4);
const GRAPH_META_CACHE_KEY = 'graph_metadata';

/** Category routing rules — static base, enriched dynamically from vault tags */
const INTENT_ROUTES: Record<string, {
  tags: string[];
  folders: string[];
  keywords: RegExp;
}> = {
  trading: {
    tags: ['trading', 'api', 'strategy', 'market'],
    folders: ['docs/planning/', 'docs/adr/'],
    keywords: /trading|stock|price|chart|strategy|variance|leverage/i,
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

// ── Dynamic intent enrichment from vault tag distribution ──────

const DYNAMIC_INTENT_ENABLED = String(process.env.OBSIDIAN_DYNAMIC_INTENT_ROUTING ?? 'true').trim() === 'true';
const DYNAMIC_INTENT_MIN_TAG_COUNT = Math.max(2, Number(process.env.OBSIDIAN_DYNAMIC_INTENT_MIN_TAG_COUNT || 3));

let _dynamicIntentEnriched = false;

/**
 * Enrich static intent routes with actual vault tag distribution.
 * Tags that appear frequently in the vault but aren't in any static route
 * get mapped to the closest matching intent via folder proximity.
 */
function enrichIntentRoutesFromGraph(graphMetadata: Record<string, Record<string, unknown>>): void {
  if (_dynamicIntentEnriched || !DYNAMIC_INTENT_ENABLED) return;
  if (!graphMetadata || Object.keys(graphMetadata).length === 0) return;

  // Count tag frequency across all vault documents
  const tagFrequency = new Map<string, number>();
  const tagFolders = new Map<string, Set<string>>();
  const allKnownTags = new Set<string>();

  for (const route of Object.values(INTENT_ROUTES)) {
    for (const tag of route.tags) {
      allKnownTags.add(tag.toLowerCase());
    }
  }

  for (const [filePath, meta] of Object.entries(graphMetadata)) {
    const tags = Array.isArray(meta?.tags) ? (meta.tags as unknown[]) : [];
    const folder = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
    for (const tag of tags) {
      const normalizedTag = String(tag).toLowerCase().trim();
      if (!normalizedTag || allKnownTags.has(normalizedTag)) continue;
      tagFrequency.set(normalizedTag, (tagFrequency.get(normalizedTag) || 0) + 1);
      const folderSet = tagFolders.get(normalizedTag) || new Set();
      if (folder) folderSet.add(folder);
      tagFolders.set(normalizedTag, folderSet);
    }
  }

  // Map frequent unmatched tags to the best intent based on folder overlap
  for (const [tag, count] of tagFrequency) {
    if (count < DYNAMIC_INTENT_MIN_TAG_COUNT) continue;

    const folders = tagFolders.get(tag) || new Set();
    let bestIntent = '';
    let bestOverlap = 0;

    for (const [intentName, route] of Object.entries(INTENT_ROUTES)) {
      let overlap = 0;
      for (const folder of folders) {
        if (route.folders.some((rf) => folder.startsWith(rf) || rf.startsWith(folder))) {
          overlap++;
        }
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIntent = intentName;
      }
    }

    // If no folder overlap, assign to development as catch-all
    const targetIntent = bestIntent || 'development';
    if (INTENT_ROUTES[targetIntent]) {
      INTENT_ROUTES[targetIntent].tags.push(tag);
      logger.debug('[OBSIDIAN-RAG] Dynamic intent: tag=%s → %s (count=%d)', tag, targetIntent, count);
    }
  }

  _dynamicIntentEnriched = true;
}

/** Exposed for tests */
export function resetDynamicIntentState(): void {
  _dynamicIntentEnriched = false;
}

export type IntentCategory = 'trading' | 'architecture' | 'operations' | 'development' | 'memory';

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
    // Check adapter availability (replaces initObsidianHeadless)
    const adapterReady = isObsidianCapabilityAvailable('search_vault') || isObsidianCapabilityAvailable('read_file');
    if (adapterReady) {
      const vaultPath = getObsidianVaultRoot();
      if (vaultPath) {
        await warmupObsidianAdapters(vaultPath);
      }
    }

    const cacheReady = await initObsidianCache();

    logger.info('[OBSIDIAN-RAG] Initialized (adapter=%s cache=%s)', 
      String(adapterReady), String(cacheReady)
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
    const vaultPath = getObsidianVaultRoot();
    const documents = await loadDocumentsWithCache(documentPaths, async (filePath) => {
      const content = vaultPath
        ? await readObsidianFileWithAdapter({ vaultPath, filePath })
        : null;
      if (content) cacheStatus.hits++;
      else cacheStatus.misses++;
      return content;
    });

    // 4. Get graph metadata for relationship context (TTL-cached in memory)
    let graphMetadata = graphMetaCache.get(GRAPH_META_CACHE_KEY);
    if (!graphMetadata) {
      graphMetadata = await getObsidianGraphMetadataWithAdapter({ vaultPath: vaultPath || '' });
      graphMetaCache.set(GRAPH_META_CACHE_KEY, graphMetadata, GRAPH_META_CACHE_TTL_MS);
    }

    // Dynamic intent enrichment: learn new tags from vault structure
    enrichIntentRoutesFromGraph(graphMetadata);

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
    const ragVaultPath = getObsidianVaultRoot() || '';
    const searches = routes.tags.map((tag) =>
      searchObsidianVaultWithAdapter({ vaultPath: ragVaultPath, query: `tag:${tag}`, limit: perTagLimit }),
    );
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
        // Orphan/deadend penalty: no backlinks AND no links = likely orphan
        const orphanPenalty = (backlinkCount === 0 && linkCount === 0) ? -0.15 : 0;
        scoredResults.set(filePath, baseScore + connectivityBoost + orphanPenalty);
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

    // Fallback: if tag search yielded no results, try keyword search using the question itself.
    if (scoredResults.size === 0) {
      logger.info('[OBSIDIAN-RAG] tag search returned 0 results — falling back to keyword search for: %s', question.slice(0, 80));
      const ragVaultPathFb = getObsidianVaultRoot() || '';
      const keywordResults = await searchObsidianVaultWithAdapter({
        vaultPath: ragVaultPathFb,
        query: question.slice(0, 200),
        limit,
      });
      logger.info('[OBSIDIAN-RAG] keyword fallback returned %d results (vault=%s)', keywordResults.length, ragVaultPathFb);
      for (const r of keywordResults) {
        const p = normalizeResultPath(r.filePath);
        if (p) scoredResults.set(p, Number.isFinite(r.score) ? Number(r.score) : 0);
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
  /** Vault-relative path to the plan document that spawned this sprint. */
  planPath?: string;
  /** Vault-relative path to the previous retro for the follows chain. */
  prevRetroPath?: string;
}): Promise<{ path: string } | null> {
  const vaultPath = String(process.env.OBSIDIAN_VAULT_PATH || process.env.OBSIDIAN_SYNC_VAULT_PATH || '').trim();

  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${dateStr}_retro_${params.sprintId}.md`;

  const builder = doc()
    .title(`Sprint Retro: ${params.sprintId}`)
    .tag('retro', `sprint-${params.sprintId}`, 'lessons-learned')
    .property('schema', 'retro/v1')
    .property('sprint_id', params.sprintId)
    .property('created_at', new Date().toISOString());

  // Automatic backlinks
  if (params.planPath) builder.spawnedBy(params.planPath);
  if (params.prevRetroPath) builder.follows(params.prevRetroPath);

  builder
    .section('What Shipped')
    .line(`**Date**: ${dateStr}`)
    .line(`**Sprint ID**: ${params.sprintId}`)
    .line('')
    .line(params.summary);

  if (params.metrics && Object.keys(params.metrics).length > 0) {
    builder.section('Metrics').table(
      ['Metric', 'Value'],
      Object.entries(params.metrics).map(([k, v]) => [k, String(v)]),
    );
  }

  builder.section('What Went Well (Keep)').bullets(
    params.lessonsLearned.keep.length > 0
      ? params.lessonsLearned.keep
      : ['(no successes to note)'],
  );

  builder.section("What Didn't Go Well (Stop)").bullets(
    params.lessonsLearned.stop.length > 0
      ? params.lessonsLearned.stop
      : ['(no failures)'],
  );

  builder.section('What to Try (Start)').bullets(
    params.lessonsLearned.start.length > 0
      ? params.lessonsLearned.start
      : ['Review phase success rate trend across sprints'],
  );

  const { markdown: content, tags, properties } = builder.build();

  try {
    const result = await writeObsidianNoteWithAdapter({
      guildId: params.guildId || '',
      vaultPath,
      fileName: `retros/${fileName}`,
      content,
      tags,
      properties,
    });

    if (result) {
      logger.info('[OBSIDIAN-RAG] Retro written to vault: %s', result.path);
    }
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Failed to write retro to vault: %s', getErrorMessage(error));
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

  const builder = doc()
    .title('Query Insight')
    .tag('query-insight', params.intent, 'reactive-learning')
    .property('schema', 'query-insight/v1')
    .property('intent', params.intent)
    .property('doc_count', params.documentCount)
    .property('latency_ms', params.executionTimeMs)
    .section('Details')
    .line(`> ${new Date().toISOString()}`)
    .line('')
    .line(`**Question:** ${params.question.slice(0, 200)}`)
    .line(`**Intent:** ${params.intent}`)
    .line(`**Documents found:** ${params.documentCount}`)
    .line(`**Execution:** ${params.executionTimeMs}ms`);

  builder.section('Top Sources');
  for (const f of params.sourceFiles.slice(0, 5)) {
    builder.line(`- [[${f}]]`);
    builder.references(f);
  }

  builder.section('Context')
    .line('This note was auto-generated by the RAG reactive learning loop to map frequently asked topics back to vault structure.');

  const { markdown: content, tags, properties } = builder.build();

  try {
    await writeObsidianNoteWithAdapter({
      guildId: params.guildId || '',
      vaultPath,
      fileName,
      content,
      tags,
      properties,
    });
    logger.debug('[OBSIDIAN-RAG] Query insight written: %s', fileName);
  } catch (error) {
    logger.debug('[OBSIDIAN-RAG] Query insight write failed (non-critical): %s', getErrorMessage(error));
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

  const builder = doc()
    .title('Knowledge Gaps Report')
    .tag('knowledge-gap', 'needs-content', 'auto-generated')
    .property('schema', 'knowledge-gap/v1')
    .property('gap_count', _knowledgeGaps.length)
    .property('created_at', new Date().toISOString())
    .section('Summary')
    .line(`> Generated: ${new Date().toISOString()}`)
    .line(`> Total unanswered queries: ${_knowledgeGaps.length}`);

  for (const [intent, gaps] of byIntent) {
    builder.section(`${intent} (${gaps.length})`);
    for (const gap of gaps) {
      const ts = new Date(gap.timestamp).toISOString().slice(11, 19);
      builder.bullet(`[${ts}] ${gap.question}`);
    }
  }

  builder.section('Recommended Actions')
    .bullet('Review unanswered questions and create or update relevant vault notes')
    .bullet('Consider adding tags or backlinks to improve discoverability');

  const count = _knowledgeGaps.length;
  _knowledgeGaps.length = 0; // Clear buffer after flush

  const { markdown: content, tags, properties } = builder.build();

  try {
    const result = await writeObsidianNoteWithAdapter({
      guildId: '',
      vaultPath,
      fileName,
      content,
      tags,
      properties,
    });

    if (result) {
      logger.info('[OBSIDIAN-RAG] Knowledge gaps flushed (%d entries): %s', count, result.path);
    }
    return result;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Knowledge gap flush failed: %s', getErrorMessage(error));
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

// ── Lightweight graph-first lore hints (for agent memory pipeline) ──

export type LoreHint = {
  text: string;
  filePath: string;
  score: number;
  backlinks: number;
};

/**
 * Lightweight graph-first document hints for the agent memory pipeline.
 * Uses intent routing + connectivity boost + 2-hop traversal — same as
 * queryObsidianRAG but skips full document loading and context assembly.
 * Returns scored snippet hints suitable for direct merge into memory hints.
 */
export async function queryObsidianLoreHints(
  goal: string,
  options?: { maxDocs?: number; guildId?: string },
): Promise<LoreHint[]> {
  const maxDocs = Math.max(1, Math.min(8, options?.maxDocs ?? 4));

  try {
    const intent = inferIntent(goal);
    const routes = INTENT_ROUTES[intent];
    const documentPaths = await findRelatedDocuments(goal, routes, maxDocs, options?.guildId);

    if (documentPaths.length === 0) return [];

    // Load lightweight graph metadata (TTL-cached)
    const vaultPath = getObsidianVaultRoot();
    let graphMetadata = graphMetaCache.get(GRAPH_META_CACHE_KEY);
    if (!graphMetadata) {
      graphMetadata = await getObsidianGraphMetadataWithAdapter({ vaultPath: vaultPath || '' });
      graphMetaCache.set(GRAPH_META_CACHE_KEY, graphMetadata, GRAPH_META_CACHE_TTL_MS);
    }

    // Load documents through cache (metadata_first style — only snippets)
    const documents = await loadDocumentsWithCache(documentPaths, async (filePath) => {
      return vaultPath
        ? await readObsidianFileWithAdapter({ vaultPath, filePath })
        : null;
    });

    const hints: LoreHint[] = [];
    for (const [filePath, doc] of documents) {
      const meta = graphMetadata[filePath];
      const backlinkCount = Array.isArray(meta?.backlinks) ? meta.backlinks.length : 0;
      const linkCount = Array.isArray(meta?.links) ? meta.links.length : 0;
      const connectivityScore = Math.min(0.3, Math.log2(1 + backlinkCount + linkCount) * 0.05);

      const title = meta?.title || filePath.split('/').pop()?.replace(/\.md$/, '') || filePath;
      const snippet = String(doc.content || '').replace(/\s+/g, ' ').trim().slice(0, 220);
      const tags = Array.isArray(meta?.tags) ? meta.tags.slice(0, 5).join(', ') : '';

      const textParts = [
        `[obsidian:${filePath}]`,
        tags ? `(${tags})` : null,
        `${title}: ${snippet}`,
      ].filter(Boolean).join(' ');

      hints.push({
        text: textParts,
        filePath,
        score: connectivityScore,
        backlinks: backlinkCount,
      });
    }

    return hints
      .sort((a, b) => b.score - a.score)
      .slice(0, maxDocs);
  } catch (err) {
    logger.debug('[OBSIDIAN-RAG] Lore hints failed: %s', getErrorMessage(err));
    return [];
  }
}

export async function appendToDailyNote(content: string): Promise<boolean> {
  try {
    const { appendDailyNoteWithAdapter } = await import('./router');
    return appendDailyNoteWithAdapter(content);
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Daily note append failed: %s', getErrorMessage(error));
    return false;
  }
}

export async function readDailyNote(): Promise<string | null> {
  try {
    const { readDailyNoteWithAdapter } = await import('./router');
    return readDailyNoteWithAdapter();
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Daily note read failed: %s', getErrorMessage(error));
    return null;
  }
}
