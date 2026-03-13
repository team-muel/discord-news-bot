import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';

const buildCommunityFallbackLinks = (query: string): string[] => {
  const encoded = encodeURIComponent(query);
  return [
    `Reddit 검색\\nhttps://www.reddit.com/search/?q=${encoded}`,
    `Naver 카페/게시글 검색\\nhttps://search.naver.com/search.naver?where=article&query=${encoded}`,
    `DCInside 통합검색\\nhttps://search.dcinside.com/combine/q/${encoded}`,
    `Ruliweb 검색\\nhttps://bbs.ruliweb.com/search?search_type=subject_content&search_key=${encoded}`,
  ];
};

const extractCommunityQuery = (goal: string, args?: Record<string, unknown>): string => {
  return extractQuery({
    goal,
    args,
    defaultQuery: '',
  });
};

export const communitySearchAction: ActionDefinition = {
  name: 'community.search',
  description: '커뮤니티 게시글 검색을 MCP 워커에 위임합니다(본체 직접 크롤링 금지).',
  execute: async ({ goal, args }) => {
    const query = extractCommunityQuery(goal, args);
    if (!query) {
      return {
        ok: false,
        name: 'community.search',
        summary: '검색어가 비어 있습니다.',
        artifacts: [],
        verification: ['query empty'],
        error: 'QUERY_EMPTY',
      };
    }

    const fallbackArtifacts = buildCommunityFallbackLinks(query);

    const delegated = await runDelegatedAction({
      actionName: 'community.search',
      workerKind: 'community',
      toolName: 'community.search',
      args: { query, limit: 5 },
      successSummary: (blocks) => `커뮤니티 결과 ${blocks.length}건 수집 완료`,
      strictFailureSummary: '커뮤니티 워커 호출 실패',
      respectStrictRouting: false,
      onWorkerMissing: () => ({
        ok: true,
        name: 'community.search',
        summary: '커뮤니티 워커 미구성: 수동 검색 링크를 제공합니다.',
        artifacts: fallbackArtifacts,
        verification: ['community worker missing', 'fallback links returned'],
      }),
      onEmptyResult: (blocks) => ({
        ok: true,
        name: 'community.search',
        summary: '커뮤니티 워커 결과가 비어 있어 수동 검색 링크로 대체했습니다.',
        artifacts: blocks.length > 0 ? [...blocks, ...fallbackArtifacts] : fallbackArtifacts,
        verification: ['delegated tool returned empty/error', 'fallback links returned'],
      }),
      onWorkerError: (error) => ({
        ok: true,
        name: 'community.search',
        summary: '커뮤니티 워커 호출 실패: 수동 검색 링크를 제공합니다.',
        artifacts: fallbackArtifacts,
        verification: ['delegated tool call failed', 'fallback links returned'],
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    if (delegated) {
      return delegated;
    }

    return {
      ok: true,
      name: 'community.search',
      summary: '커뮤니티 워커 호출 실패: 수동 검색 링크를 제공합니다.',
      artifacts: fallbackArtifacts,
      verification: ['delegated tool call failed', 'fallback links returned'],
      error: 'COMMUNITY_WORKER_CALL_FAILED',
    };
  },
};
