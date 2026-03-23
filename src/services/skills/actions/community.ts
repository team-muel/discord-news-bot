import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';
import { webSearchAction } from './webSearch';

const COMMUNITY_SITES = ['reddit.com', 'naver.com', 'dcinside.com', 'ruliweb.com'];

const buildCommunityFallbackLinks = (query: string): string[] => {
  const encoded = encodeURIComponent(query);
  return [
    `Reddit 검색\\nhttps://www.reddit.com/search/?q=${encoded}`,
    `Naver 카페/게시글 검색\\nhttps://search.naver.com/search.naver?where=article&query=${encoded}`,
    `DCInside 통합검색\\nhttps://search.dcinside.com/combine/q/${encoded}`,
    `Ruliweb 검색\\nhttps://bbs.ruliweb.com/search?search_type=subject_content&search_key=${encoded}`,
  ];
};

const searchCommunitiesViaWeb = async (query: string): Promise<string[] | null> => {
  const siteFilter = COMMUNITY_SITES.map((s) => `site:${s}`).join(' OR ');
  const scopedQuery = `${query} (${siteFilter})`;
  try {
    const result = await webSearchAction.execute({
      goal: scopedQuery,
      args: { query: scopedQuery },
      guildId: '',
      requestedBy: 'system:community-fallback',
    });
    if (result.ok && result.artifacts.length > 0) {
      return result.artifacts;
    }
  } catch {
    // fall through
  }
  return null;
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
      onWorkerMissing: () => null,
      onEmptyResult: () => null,
      onWorkerError: () => null,
    });
    if (delegated) {
      return delegated;
    }

    // MCP worker unavailable — try web search with site: filter as active fallback.
    const webResults = await searchCommunitiesViaWeb(query);
    if (webResults && webResults.length > 0) {
      return {
        ok: true,
        name: 'community.search',
        summary: `커뮤니티 검색 결과 ${webResults.length}건 (웹 검색 경유)`,
        artifacts: webResults,
        verification: ['mcp worker unavailable', 'web search site-scoped fallback'],
      };
    }

    return {
      ok: true,
      name: 'community.search',
      summary: '커뮤니티 워커/웹 검색 모두 실패: 수동 검색 링크를 제공합니다.',
      artifacts: fallbackArtifacts,
      verification: ['mcp worker unavailable', 'web search fallback failed', 'static links returned'],
    };
  },
};
