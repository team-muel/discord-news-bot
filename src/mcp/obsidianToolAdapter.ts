/**
 * Obsidian MCP Tool Adapter
 *
 * Exposes Obsidian vault operations as MCP tools for agent consumption.
 * Tools cover the two key facets:
 *   1. Retrieval — search, read, graph metadata, RAG query
 *   2. Operations — write notes, sync status, cache stats, quality audit
 *
 * All write operations route through the sanitization gate in router.ts.
 */

import {
  searchObsidianVaultWithAdapter,
  readObsidianFileWithAdapter,
  getObsidianGraphMetadataWithAdapter,
  writeObsidianNoteWithAdapter,
  getObsidianAdapterRuntimeStatus,
} from '../services/obsidian/router';
import { queryObsidianRAG } from '../services/obsidian/obsidianRagService';
import { getCacheStats } from '../services/obsidian/obsidianCacheService';
import { getObsidianLoreSyncLoopStats } from '../services/obsidian/obsidianLoreSyncService';
import { getLatestObsidianGraphAuditSnapshot } from '../services/obsidian/obsidianQualityService';
import { getObsidianVaultRoot } from '../utils/obsidianEnv';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

const compact = (value: unknown): string => String(value ?? '').trim();

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
  content: [{ type: 'text', text }],
  isError,
});

const toJsonResult = (value: unknown): McpToolCallResult =>
  toTextResult(JSON.stringify(value, null, 2));

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const OBSIDIAN_TOOLS: McpToolSpec[] = [
  {
    name: 'obsidian.search',
    description: 'Obsidian vault에서 키워드 기반 graph-first 검색을 수행합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '검색 키워드' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
        maxResults: { type: 'number', description: '최대 결과 수 (기본: 10)' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.rag',
    description: '인텐트 기반 RAG 검색 — graph-first 전략으로 vault 지식을 검색합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '질문 또는 검색 쿼리' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
        maxDocs: { type: 'number', description: '최대 문서 수 (기본: 10)' },
        contextMode: { type: 'string', enum: ['full', 'metadata_first'], description: '컨텍스트 모드 (기본: metadata_first)' },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.read',
    description: 'Vault 내 특정 파일의 내용을 읽습니다.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'vault 내 상대 파일 경로' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
      },
      required: ['filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.graph',
    description: 'Vault의 그래프 메타데이터(backlinks, tags, links)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.write',
    description: 'Sanitization gate를 통해 vault에 노트를 작성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: '파일명 (확장자 포함)' },
        content: { type: 'string', description: '마크다운 본문 (frontmatter 포함)' },
        folder: { type: 'string', description: 'vault 내 대상 폴더 (선택)' },
        guildId: { type: 'string', description: '길드 ID (선택)' },
      },
      required: ['fileName', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.sync.status',
    description: 'Obsidian Lore 동기화 루프 상태를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.cache.stats',
    description: 'Obsidian 문서 캐시 통계(적중률, TTL, 문서 수)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.quality.audit',
    description: '최근 그래프 품질 감사 스냅샷을 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'obsidian.adapter.status',
    description: '현재 어댑터 라우팅 상태(활성 어댑터, strict 모드, capability별 선택)를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

// ── Tool Names Set (for routing in unifiedToolAdapter) ────────────────────────

export const OBSIDIAN_TOOL_NAMES = new Set(OBSIDIAN_TOOLS.map((t) => t.name));

// ── Tool Catalog ──────────────────────────────────────────────────────────────

export const listObsidianMcpTools = (): McpToolSpec[] => OBSIDIAN_TOOLS.map((t) => ({ ...t }));

// ── Tool Dispatcher ───────────────────────────────────────────────────────────

export const callObsidianMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const name = compact(request.name);
  const args = request.arguments ?? {};
  if (!name) {
    return toTextResult('tool name is required', true);
  }

  const vaultPath = getObsidianVaultRoot();

  // ── obsidian.search ─────────────────────────────────────────────────────
  if (name === 'obsidian.search') {
    const keyword = compact(args.keyword);
    if (!keyword) return toTextResult('keyword is required', true);
    const limit = typeof args.maxResults === 'number' ? args.maxResults : 10;

    const results = await searchObsidianVaultWithAdapter({
      query: keyword,
      vaultPath: vaultPath || '',
      limit,
    });

    if (results.length === 0) {
      return toTextResult('No results found.');
    }
    return toJsonResult(results);
  }

  // ── obsidian.rag ────────────────────────────────────────────────────────
  if (name === 'obsidian.rag') {
    const question = compact(args.question);
    if (!question) return toTextResult('question is required', true);
    const maxDocs = typeof args.maxDocs === 'number' ? args.maxDocs : undefined;
    const contextMode = args.contextMode === 'full' ? 'full' : 'metadata_first';
    const guildId = compact(args.guildId) || undefined;

    const result = await queryObsidianRAG(question, {
      maxDocs,
      contextMode,
      guildId,
    });

    return toJsonResult(result);
  }

  // ── obsidian.read ───────────────────────────────────────────────────────
  if (name === 'obsidian.read') {
    const filePath = compact(args.filePath);
    if (!filePath) return toTextResult('filePath is required', true);
    // Path traversal guard
    if (filePath.includes('..') || /^[a-zA-Z]:/.test(filePath) || filePath.startsWith('/')) {
      return toTextResult('invalid filePath: path traversal or absolute path not allowed', true);
    }

    const content = await readObsidianFileWithAdapter({
      filePath,
      vaultPath: vaultPath || '',
    });

    if (content === null) {
      return toTextResult(`File not found or unreadable: ${filePath}`);
    }
    return toTextResult(content);
  }

  // ── obsidian.graph ──────────────────────────────────────────────────────
  if (name === 'obsidian.graph') {
    if (!vaultPath) {
      return toTextResult('OBSIDIAN_VAULT_PATH not configured', true);
    }
    const metadata = await getObsidianGraphMetadataWithAdapter({ vaultPath });
    const nodeCount = Object.keys(metadata).length;
    if (nodeCount === 0) {
      return toTextResult('Graph metadata is empty (no indexed files).');
    }
    return toJsonResult({ nodeCount, nodes: metadata });
  }

  // ── obsidian.write ──────────────────────────────────────────────────────
  if (name === 'obsidian.write') {
    const fileName = compact(args.fileName);
    const content = compact(args.content);
    if (!fileName) return toTextResult('fileName is required', true);
    if (!content) return toTextResult('content is required', true);
    // File name safety
    if (/[<>:"|?*]/.test(fileName) || fileName.includes('..')) {
      return toTextResult('invalid fileName: unsafe characters or path traversal', true);
    }
    const folder = compact(args.folder) || undefined;
    const guildId = compact(args.guildId) || 'MCP';

    const result = await writeObsidianNoteWithAdapter({
      fileName,
      content,
      guildId,
      vaultPath: vaultPath || '',
      ...(folder ? { tags: [folder] } : {}),
    });

    if (!result) {
      return toTextResult('Write failed (sanitization blocked or no adapter available)', true);
    }
    return toJsonResult({ ok: true, path: result.path });
  }

  // ── obsidian.sync.status ────────────────────────────────────────────────
  if (name === 'obsidian.sync.status') {
    return toJsonResult(getObsidianLoreSyncLoopStats());
  }

  // ── obsidian.cache.stats ────────────────────────────────────────────────
  if (name === 'obsidian.cache.stats') {
    const stats = await getCacheStats();
    if (!stats) {
      return toTextResult('Cache stats unavailable (Supabase not configured or cache disabled)');
    }
    return toJsonResult(stats);
  }

  // ── obsidian.quality.audit ──────────────────────────────────────────────
  if (name === 'obsidian.quality.audit') {
    const snapshot = await getLatestObsidianGraphAuditSnapshot();
    if (!snapshot) {
      return toTextResult('No audit snapshot available. Run `npm run obsidian:audit` first.');
    }
    return toJsonResult(snapshot);
  }

  // ── obsidian.adapter.status ─────────────────────────────────────────────
  if (name === 'obsidian.adapter.status') {
    return toJsonResult(getObsidianAdapterRuntimeStatus());
  }

  return toTextResult(`Unknown obsidian tool: ${name}`, true);
};
