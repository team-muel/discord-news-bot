import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';

const extractNewsQuery = (goal: string, args?: Record<string, unknown>): string => {
  return extractQuery({
    goal,
    args,
    defaultQuery: '시장 주요 뉴스',
    removePatterns: [/뉴스|news/gi],
  });
};

export const newsGoogleSearchAction: ActionDefinition = {
  name: 'news.google.search',
  description: 'Google News RSS 기반으로 질의어 관련 최신 뉴스 링크를 수집합니다.',
  execute: async ({ goal, args }) => {
    const query = extractNewsQuery(goal, args);

    const delegated = await runDelegatedAction({
      actionName: 'news.google.search',
      workerKind: 'news',
      toolName: 'news.google.search',
      args: { query, limit: 5 },
      successSummary: () => 'MCP 뉴스 워커 조회 성공',
      strictFailureSummary: 'MCP 뉴스 워커 호출 실패(엄격 모드)',
    });
    if (delegated) {
      return delegated;
    }

    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    return {
      ok: false,
      name: 'news.google.search',
      summary: '뉴스 워커 호출 실패로 RSS 링크만 제공합니다.',
      artifacts: [rssUrl],
      verification: ['local heavy rss parser removed; worker-first design'],
      error: 'WORKER_UNAVAILABLE',
    };
  },
};
