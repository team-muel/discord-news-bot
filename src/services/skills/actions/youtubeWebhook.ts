import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { extractQuery } from './queryUtils';

const extractYoutubeWebhookQuery = (goal: string, args?: Record<string, unknown>): string => {
  return extractQuery({
    goal,
    args,
    defaultQuery: '시장 요약',
    removePatterns: [
      /유튜브에서|youtube에서|youtube|유튜브/gi,
      /웹훅으로|웹훅|webhook|보내줘|전송해줘|알려줘|해줘|해\s*줘/gi,
    ],
  });
};

export const youtubeSearchWebhookAction: ActionDefinition = {
  name: 'youtube.search.webhook',
  description: 'YouTube 검색 상위 링크를 MCP 워커에서 조회하고 Discord Webhook으로 전송합니다.',
  execute: async ({ goal, args }) => {
    const query = extractYoutubeWebhookQuery(goal, args);
    const delegated = await runDelegatedAction({
      actionName: 'youtube.search.webhook',
      workerKind: 'youtube',
      toolName: 'youtube.search.webhook',
      args: {
        query,
        webhookUrl: args?.webhookUrl,
        limit: args?.limit,
        dryRun: args?.dryRun,
        titlePrefix: args?.titlePrefix,
      },
      successSummary: () => 'YouTube 검색 결과를 webhook으로 전송했습니다.',
      strictFailureSummary: 'MCP YouTube 워커 호출 실패(엄격 모드)',
      onWorkerMissing: () => ({
        ok: false,
        name: 'youtube.search.webhook',
        summary: 'MCP_YOUTUBE_WORKER_URL이 설정되지 않아 webhook 위임을 실행할 수 없습니다.',
        artifacts: [],
        verification: ['worker url missing'],
        error: 'MCP_WORKER_NOT_CONFIGURED',
      }),
      onEmptyResult: (lines) => ({
        ok: false,
        name: 'youtube.search.webhook',
        summary: 'MCP 워커 youtube.search.webhook 실행 실패',
        artifacts: lines,
        verification: ['mcp delegated tool error'],
        error: 'MCP_TOOL_ERROR',
      }),
      onWorkerError: (error) => ({
        ok: false,
        name: 'youtube.search.webhook',
        summary: '워커 호출 실패로 webhook 전송을 수행하지 못했습니다.',
        artifacts: [],
        verification: ['worker call failed'],
        error: error instanceof Error ? error.message : String(error),
      }),
    });

    if (delegated) {
      return delegated;
    }

    return {
      ok: false,
      name: 'youtube.search.webhook',
      summary: 'MCP 워커 youtube.search.webhook 실행 실패',
      artifacts: [],
      verification: ['mcp delegated tool error'],
      error: 'MCP_TOOL_ERROR',
    };
  },
};
