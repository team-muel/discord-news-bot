import { isMemoryType, searchGuildMemory } from '../../agentMemoryStore';
import type { MemoryType } from '../../agentMemoryStore';
import { buildAgentMemoryHints } from '../../agentMemoryService';
import type { ActionDefinition } from './types';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const deriveQuery = (goal: string, args?: Record<string, unknown>): string => {
  const fromArgs = typeof args?.query === 'string' ? compact(args.query) : '';
  if (fromArgs) {
    return fromArgs;
  }

  return compact(goal)
    .replace(/세션 스킬 실행:[^\n]*/g, '')
    .replace(/요청:\s*/g, '')
    .replace(/목표:\s*/g, '')
    .trim();
};

const toLimit = (raw: unknown, fallback = 6): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(20, Math.trunc(parsed)));
};

const toMemoryType = (raw: unknown): MemoryType | undefined => {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  return isMemoryType(value) ? value : undefined;
};

type MemoryCitation = {
  sourceKind: string;
  sourceMessageId: string;
  sourceRef: string;
};

const formatCitation = (citation: MemoryCitation): string => {
  const source = citation.sourceMessageId || citation.sourceRef || '-';
  return `${citation.sourceKind || 'unknown'}:${source}`;
};

export const ragRetrieveAction: ActionDefinition = {
  name: 'rag.retrieve',
  description: '길드 장기기억/메모리에서 근거를 검색해 RAG 컨텍스트를 생성합니다.',
  category: 'data',
  parameters: [
    { name: 'query', required: true, description: 'Search query for guild memory', example: '주간 운영 보고서' },
    { name: 'limit', required: false, description: 'Max results (1-20, default 6)', example: '6' },
    { name: 'type', required: false, description: 'Memory type filter (lore, observation, etc.)' },
  ],
  execute: async ({ goal, args, guildId }) => {
    if (!guildId) {
      return {
        ok: false,
        name: 'rag.retrieve',
        summary: 'guildId가 없어 RAG 검색을 수행할 수 없습니다.',
        artifacts: [],
        verification: ['guild context missing'],
        error: 'GUILD_ID_REQUIRED',
      };
    }

    const query = deriveQuery(goal, args);
    if (!query) {
      return {
        ok: false,
        name: 'rag.retrieve',
        summary: 'RAG 검색어가 비어 있습니다.',
        artifacts: [],
        verification: ['query empty'],
        error: 'QUERY_EMPTY',
      };
    }

    const limit = toLimit(args?.limit, 6);
    const type = toMemoryType(args?.type ?? args?.memoryType);

    try {
      const result = await searchGuildMemory({
        guildId,
        query,
        limit,
        type,
      });

      if ((result.items || []).length === 0) {
        const hints = await buildAgentMemoryHints({ guildId, goal: query, maxItems: Math.min(10, limit) });
        if (hints.length === 0) {
          return {
            ok: false,
            name: 'rag.retrieve',
            summary: '검색 가능한 RAG 근거를 찾지 못했습니다.',
            artifacts: [],
            verification: ['memory search empty', 'memory hints empty'],
            error: 'RAG_EMPTY',
          };
        }

        return {
          ok: true,
          name: 'rag.retrieve',
          summary: `RAG 힌트 ${hints.length}건 생성 (memory fallback)`,
          artifacts: hints.map((hint, index) => `[hint:${index + 1}] ${hint}`),
          verification: ['memory search empty', 'memory hints fallback'],
        };
      }

      const artifacts = result.items.map((item, index) => {
        const citations = (item.citations || []) as MemoryCitation[];
        const citationText = citations
          .map((citation) => formatCitation(citation))
          .join(', ');
        const body = compact(item.summary || item.content || '').slice(0, 260);
        const confidence = Number(item.confidence || 0);
        return [
          `[evidence:${index + 1}] id=${item.id || '-'} type=${item.type || 'unknown'} score=${Number(item.score || 0).toFixed(2)} conf=${confidence.toFixed(2)}`,
          `title=${compact(item.title || '(untitled)').slice(0, 100)}`,
          `snippet=${body || '(empty)'}`,
          citationText ? `cite=${citationText}` : 'cite=none',
        ].join(' | ');
      });

      const avgScore = result.items.length > 0
        ? result.items.reduce((acc, item) => acc + Number(item.score || 0), 0) / result.items.length
        : 0;

      return {
        ok: true,
        name: 'rag.retrieve',
        summary: `RAG 근거 ${artifacts.length}건 검색 완료 (query="${query.slice(0, 80)}")`,
        artifacts,
        verification: [
          `queryLatencyMs=${result.meta?.queryLatencyMs || 0}`,
          `returned=${result.meta?.returned || artifacts.length}`,
          `avgScore=${avgScore.toFixed(2)}`,
          `memoryType=${type || 'all'}`,
        ],
      };
    } catch (error) {
      return {
        ok: false,
        name: 'rag.retrieve',
        summary: 'RAG 검색 실행 실패',
        artifacts: [],
        verification: ['searchGuildMemory exception'],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
