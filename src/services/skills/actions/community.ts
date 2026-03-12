import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';

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

    const delegated = await runDelegatedAction({
      actionName: 'community.search',
      workerKind: 'community',
      toolName: 'community.search',
      args: { query, limit: 5 },
      successSummary: (blocks) => `커뮤니티 결과 ${blocks.length}건 수집 완료`,
      strictFailureSummary: '커뮤니티 워커 호출 실패',
      respectStrictRouting: false,
      onWorkerMissing: () => ({
        ok: false,
        name: 'community.search',
        summary: '커뮤니티 워커가 구성되지 않았습니다.',
        artifacts: ['MCP_COMMUNITY_WORKER_URL is empty'],
        verification: ['delegation-only policy'],
        error: 'COMMUNITY_WORKER_NOT_CONFIGURED',
      }),
      onEmptyResult: (blocks) => ({
        ok: false,
        name: 'community.search',
        summary: '커뮤니티 워커가 유효한 결과를 반환하지 않았습니다.',
        artifacts: blocks,
        verification: ['delegated tool returned empty/error'],
        error: 'COMMUNITY_RESULT_EMPTY',
      }),
      onWorkerError: (error) => ({
        ok: false,
        name: 'community.search',
        summary: '커뮤니티 워커 호출 실패',
        artifacts: [],
        verification: ['delegated tool call failed'],
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    if (delegated) {
      return delegated;
    }

    return {
      ok: false,
      name: 'community.search',
      summary: '커뮤니티 워커 호출 실패',
      artifacts: [],
      verification: ['delegated tool call failed'],
      error: 'COMMUNITY_WORKER_CALL_FAILED',
    };
  },
};
