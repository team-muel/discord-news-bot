import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';
import {
  buildIndexContextBundle,
  findIndexedSymbolReferences,
  getIndexedFileOutline,
  listSecurityCandidates,
  readIndexedScope,
  resolveIndexedSymbolDefinition,
  searchIndexedSymbols,
} from '../services/codeIndexService';

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
  content: [{ type: 'text', text }],
  isError,
});

const INDEXING_TOOLS: McpToolSpec[] = [
  {
    name: 'code.index.symbol_search',
    description: '저장소 인덱스에서 심볼 후보를 검색합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        branch: { type: 'string' },
        commitSha: { type: 'string' },
        query: { type: 'string' },
        kind: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['repoId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'code.index.symbol_define',
    description: '특정 심볼의 정의와 선언 범위를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        symbolId: { type: 'string' },
        name: { type: 'string' },
        filePathHint: { type: 'string' },
      },
      required: ['repoId'],
      additionalProperties: false,
    },
  },
  {
    name: 'code.index.symbol_references',
    description: '특정 심볼의 참조 위치를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        symbolId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['repoId', 'symbolId'],
      additionalProperties: false,
    },
  },
  {
    name: 'code.index.file_outline',
    description: '파일의 top-level 구조를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        filePath: { type: 'string' },
      },
      required: ['repoId', 'filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'code.index.scope_read',
    description: '특정 심볼 또는 라인 기준 범위를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        filePath: { type: 'string' },
        symbolId: { type: 'string' },
        line: { type: 'number' },
        contextLines: { type: 'number' },
      },
      required: ['repoId', 'filePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'code.index.context_bundle',
    description: '목표에 필요한 최소 코드/문서 묶음을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        goal: { type: 'string' },
        maxItems: { type: 'number' },
        changedPaths: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['repoId', 'goal'],
      additionalProperties: false,
    },
  },
  {
    name: 'security.candidates_list',
    description: '특정 커밋 기준 보안 후보군 JSONL 레코드를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string' },
        branch: { type: 'string' },
        commitSha: { type: 'string' },
        candidateKind: { type: 'string' },
        view: { type: 'string', enum: ['raw', 'merged'] },
        limit: { type: 'number' },
      },
      required: ['repoId'],
      additionalProperties: false,
    },
  },
];

const toJsonResult = (value: unknown): McpToolCallResult => {
  return toTextResult(JSON.stringify(value, null, 2));
};

export const listIndexingMcpTools = (): McpToolSpec[] => INDEXING_TOOLS.map((tool) => ({ ...tool }));

export const callIndexingMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const name = String(request.name || '').trim();
  const args = request.arguments || {};
  if (!name) {
    return toTextResult('tool name is required', true);
  }

  // Sanitize file path arguments to prevent path traversal
  for (const key of ['filePath', 'filePathHint'] as const) {
    if (typeof (args as Record<string, unknown>)[key] === 'string') {
      const fp = String((args as Record<string, unknown>)[key]);
      if (fp.includes('..') || fp.startsWith('/') || /^[a-zA-Z]:/.test(fp)) {
        return toTextResult(`invalid ${key}: path traversal or absolute path not allowed`, true);
      }
    }
  }

  try {
    if (name === 'code.index.symbol_search') {
      return toJsonResult(await searchIndexedSymbols({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        query: String(args.query || ''),
        kind: typeof args.kind === 'string' ? args.kind : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      }));
    }

    if (name === 'code.index.symbol_define') {
      return toJsonResult(await resolveIndexedSymbolDefinition({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        symbolId: typeof args.symbolId === 'string' ? args.symbolId : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
        filePathHint: typeof args.filePathHint === 'string' ? args.filePathHint : undefined,
      }));
    }

    if (name === 'code.index.symbol_references') {
      return toJsonResult(await findIndexedSymbolReferences({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        symbolId: String(args.symbolId || ''),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      }));
    }

    if (name === 'code.index.file_outline') {
      return toJsonResult(await getIndexedFileOutline({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        filePath: String(args.filePath || ''),
      }));
    }

    if (name === 'code.index.scope_read') {
      return toJsonResult(await readIndexedScope({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        filePath: String(args.filePath || ''),
        symbolId: typeof args.symbolId === 'string' ? args.symbolId : undefined,
        line: typeof args.line === 'number' ? args.line : undefined,
        contextLines: typeof args.contextLines === 'number' ? args.contextLines : undefined,
      }));
    }

    if (name === 'code.index.context_bundle') {
      return toJsonResult(await buildIndexContextBundle({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        goal: String(args.goal || ''),
        maxItems: typeof args.maxItems === 'number' ? args.maxItems : undefined,
        changedPaths: Array.isArray(args.changedPaths)
          ? args.changedPaths.map((item) => String(item || '')).filter(Boolean)
          : undefined,
      }));
    }

    if (name === 'security.candidates_list') {
      return toJsonResult(await listSecurityCandidates({
        repoId: String(args.repoId || ''),
        branch: typeof args.branch === 'string' ? args.branch : undefined,
        commitSha: typeof args.commitSha === 'string' ? args.commitSha : undefined,
        candidateKind: typeof args.candidateKind === 'string' ? args.candidateKind : undefined,
        view: typeof args.view === 'string' ? args.view : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      }));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return toTextResult(message, true);
  }

  return toTextResult(`unknown tool: ${name}`, true);
};