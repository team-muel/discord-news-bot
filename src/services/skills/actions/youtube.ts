import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';

const extractYoutubeQuery = (goal: string, args?: Record<string, unknown>): string => {
  return extractQuery({
    goal,
    args,
    defaultQuery: '고양이 영상',
    removePatterns: [
      /유튜브에서|youtube에서|youtube|유튜브/gi,
      /진짜|제발|좀|하나만|하나|한\s*개|찾아봐|찾아\s*줘|찾아줘|보여줘|올려줘|해줘|해\s*줘/gi,
    ],
  });
};

export const youtubeSearchFirstAction: ActionDefinition = {
  name: 'youtube.search.first',
  description: 'YouTube에서 질의어 기준 상위 영상 URL(최대 3개)을 추출합니다.',
  execute: async ({ goal, args }) => {
    const query = extractYoutubeQuery(goal, args);
    const delegated = await runDelegatedAction({
      actionName: 'youtube.search.first',
      workerKind: 'youtube',
      toolName: 'youtube.search.first',
      args: { query, limit: 3 },
      successSummary: (blocks) => `MCP 워커를 통해 YouTube 결과 ${blocks.length}건 수집 완료`,
      strictFailureSummary: 'MCP YouTube 워커 호출 실패(엄격 모드)',
    });
    if (delegated) {
      return delegated;
    }

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    return {
      ok: false,
      name: 'youtube.search.first',
      summary: 'YouTube 워커 호출 실패로 검색 링크만 제공합니다.',
      artifacts: [searchUrl],
      verification: ['local heavy parser removed; worker-first design'],
      error: 'WORKER_UNAVAILABLE',
    };
  },
};
