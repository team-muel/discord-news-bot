import { listActions, getAction } from '../services/skills/actions/registry';
import { runGoalActions } from '../services/skills/actionRunner';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

const MCP_GUILD_ID = 'MCP';
const MCP_REQUESTER = 'mcp-adapter';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const toObject = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const toTextResult = (text: string, isError = false): McpToolCallResult => ({
  content: [{ type: 'text', text }],
  isError,
});

const MCP_TOOLS: McpToolSpec[] = [
  {
    name: 'stock.quote',
    description: '티커 심볼의 시세를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '예: AAPL, TSLA' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'stock.chart',
    description: '티커 심볼의 차트 URL을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '예: AAPL, TSLA' },
      },
      required: ['symbol'],
      additionalProperties: false,
    },
  },
  {
    name: 'investment.analysis',
    description: '질의 텍스트 기반 투자 분석을 생성합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '분석 요청 텍스트' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'action.catalog',
    description: '현재 등록된 액션 이름 목록을 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'action.execute.direct',
    description: '등록된 액션을 직접 실행합니다(개발/운영 점검용).',
    inputSchema: {
      type: 'object',
      properties: {
        actionName: { type: 'string', description: '예: web.fetch' },
        goal: { type: 'string', description: '액션 실행 목표 텍스트' },
        args: { type: 'object', description: '액션 인자' },
      },
      required: ['actionName', 'goal'],
      additionalProperties: false,
    },
  },
];

export const listMcpTools = (): McpToolSpec[] => MCP_TOOLS.map((tool) => ({ ...tool }));

export const callMcpTool = async (request: McpToolCallRequest): Promise<McpToolCallResult> => {
  const args = toObject(request.arguments);

  if (request.name === 'stock.quote') {
    const symbol = compact(args.symbol).toUpperCase();
    if (!symbol) {
      return toTextResult('symbol is required', true);
    }

    const result = await runGoalActions({
      goal: `stock.quote ${symbol}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
    });

    if (!result.hasSuccess) {
      return toTextResult(`quote not available for ${symbol}`, true);
    }

    return toTextResult(result.output);
  }

  if (request.name === 'stock.chart') {
    const symbol = compact(args.symbol).toUpperCase();
    if (!symbol) {
      return toTextResult('symbol is required', true);
    }

    const result = await runGoalActions({
      goal: `stock.chart ${symbol}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
    });

    if (!result.hasSuccess) {
      return toTextResult(`chart not available for ${symbol}`, true);
    }

    return toTextResult(result.output);
  }

  if (request.name === 'investment.analysis') {
    const query = compact(args.query);
    if (!query) {
      return toTextResult('query is required', true);
    }

    const result = await runGoalActions({
      goal: `investment.analysis ${query}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
    });

    return toTextResult(result.output || 'empty analysis', !result.hasSuccess);
  }

  if (request.name === 'action.catalog') {
    const names = listActions().map((action) => action.name);
    return toTextResult(JSON.stringify(names, null, 2));
  }

  if (request.name === 'action.execute.direct') {
    if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
      return toTextResult('action.execute.direct is disabled in production', true);
    }
    const actionName = compact(args.actionName);
    const goal = compact(args.goal);
    if (!actionName || !goal) {
      return toTextResult('actionName and goal are required', true);
    }

    const action = getAction(actionName);
    if (!action) {
      return toTextResult(`unknown action: ${actionName}`, true);
    }

    const result = await runGoalActions({
      goal: `${actionName} ${goal}`,
      guildId: MCP_GUILD_ID,
      requestedBy: MCP_REQUESTER,
    });

    return toTextResult(JSON.stringify({ handled: result.handled, output: result.output, hasSuccess: result.hasSuccess }, null, 2), !result.hasSuccess);
  }

  return toTextResult(`unknown tool: ${request.name}`, true);
};
