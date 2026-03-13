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

import { isAnyLlmConfigured } from './llmClient';
import {
  initObsidianHeadless,
  searchObsidianVault,
  readObsidianFile,
  getObsidianGraphMetadata,
  parseObsidianFrontmatter,
} from './obsidianHeadlessService';
import {
  initObsidianCache,
  loadDocumentsWithCache,
  getCacheStats,
  clearExpiredCache,
} from './obsidianCacheService';
import logger from '../logger';

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
  documentCount: number;
  cacheStatus: { hits: number; misses: number };
  executionTimeMs: number;
}

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
    setInterval(() => {
      clearExpiredCache().catch(error =>
        logger.warn('[OBSIDIAN-RAG] Cache cleanup failed: %o', error)
      );
    }, 3600000);

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
  options?: { maxDocs?: number; debug?: boolean }
): Promise<RAGQueryResult> {
  const startTime = Date.now();
  const maxDocs = options?.maxDocs || 10;
  const cacheStatus = { hits: 0, misses: 0 };

  try {
    // 1. Infer intent from question
    const intent = inferIntent(question);
    logger.info('[OBSIDIAN-RAG] Query intent=%s question=%s', intent, question.slice(0, 50));

    // 2. Route to relevant documents
    const routes = INTENT_ROUTES[intent];
    const documentPaths = await findRelatedDocuments(question, routes, maxDocs);

    if (documentPaths.length === 0) {
      logger.warn('[OBSIDIAN-RAG] No relevant documents found for intent=%s', intent);
      return {
        sourceFiles: [],
        documentContext: '(No relevant documents found)',
        intent,
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

    // 4. Get graph metadata for relationship context
    const graphMetadata = await getObsidianGraphMetadata();

    // 5. Assemble context
    const contextText = assembleContext(documents, graphMetadata);

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

    return {
      sourceFiles: Array.from(documents.keys()),
      documentContext: contextText,
      intent,
      documentCount: documents.size,
      cacheStatus,
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('[OBSIDIAN-RAG] Query failed: %o', error);
    return {
      sourceFiles: [],
      documentContext: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      intent: 'development',
      documentCount: 0,
      cacheStatus,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Infer intent category from question text
 */
export function inferIntent(question: string): IntentCategory {
  for (const [category, route] of Object.entries(INTENT_ROUTES)) {
    if (route.keywords.test(question)) {
      return category as IntentCategory;
    }
  }

  // Default fallback
  return 'development';
}

/**
 * Find related documents based on intent and question
 */
async function findRelatedDocuments(
  question: string,
  routes: typeof INTENT_ROUTES[IntentCategory],
  limit: number
): Promise<string[]> {
  const results = new Set<string>();

  try {
    // Search by tag
    for (const tag of routes.tags) {
      const tagResults = await searchObsidianVault(`tag:${tag}`, Math.ceil(limit / routes.tags.length));
      tagResults.forEach(r => results.add(r.filePath));
    }

    // Limit results
    const paths = Array.from(results).slice(0, limit);
    
    logger.debug('[OBSIDIAN-RAG] Found %d documents for intent, returning %d', results.size, paths.length);
    return paths;
  } catch (error) {
    logger.warn('[OBSIDIAN-RAG] Document search failed: %o', error);
    return [];
  }
}

/**
 * Assemble context from documents with metadata
 */
function assembleContext(
  documents: Map<string, { content: string; frontmatter?: Record<string, any> }>,
  graphMetadata: Record<string, any> = {}
): string {
  const parts: string[] = [];

  let docIndex = 1;
  for (const [path, doc] of documents.entries()) {
    const meta = graphMetadata[path];

    // Header with metadata
    const header = [
      `【문서 ${docIndex}】 ${path}`,
      meta?.title ? `제목: ${meta.title}` : null,
      meta?.tags?.length ? `태그: ${meta.tags.join(', ')}` : null,
      meta?.category ? `분류: ${meta.category}` : null,
      meta?.backlinks?.length 
        ? `링크: ${meta.backlinks.slice(0, 3).join(', ')}${meta.backlinks.length > 3 ? '...' : ''}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    parts.push(`## ${header}\n`);
    parts.push(doc.content);
    parts.push('\n');

    docIndex++;
  }

  return parts.join('\n---\n\n');
}

/**
 * Extract key sections from document (for summary)
 */
export function extractKeySections(content: string, maxLength: number = 500): string {
  // Extract first significant heading and its content
  const lines = content.split('\n');
  let section = '';
  let inSection = false;

  for (const line of lines) {
    if (line.startsWith('# ') || line.startsWith('## ')) {
      if (inSection && section.length > maxLength) break;
      inSection = true;
      section += line + '\n';
    } else if (inSection) {
      section += line + '\n';
      if (section.length > maxLength) break;
    }
  }

  return section.slice(0, maxLength) || content.slice(0, maxLength);
}
