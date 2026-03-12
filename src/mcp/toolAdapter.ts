import { fetchStockChartImageUrl, fetchStockQuote } from '../services/stockService';
import { generateInvestmentAnalysis } from '../services/investmentAnalysisService';
import { listActions, getAction } from '../services/skills/actions/registry';
import type { McpToolCallRequest, McpToolCallResult, McpToolSpec } from './types';

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

    const quote = await fetchStockQuote(symbol);
    if (!quote) {
      return toTextResult(`quote not available for ${symbol}`, true);
    }

    return toTextResult(JSON.stringify(quote, null, 2));
  }

  if (request.name === 'stock.chart') {
    const symbol = compact(args.symbol).toUpperCase();
    if (!symbol) {
      return toTextResult('symbol is required', true);
    }

    const chartUrl = await fetchStockChartImageUrl(symbol);
    if (!chartUrl) {
      return toTextResult(`chart not available for ${symbol}`, true);
    }

    return toTextResult(chartUrl);
  }

  if (request.name === 'investment.analysis') {
    const query = compact(args.query);
    if (!query) {
      return toTextResult('query is required', true);
    }

    const output = await generateInvestmentAnalysis(query);
    return toTextResult(output || 'empty analysis');
  }

  if (request.name === 'action.catalog') {
    const names = listActions().map((action) => action.name);
    return toTextResult(JSON.stringify(names, null, 2));
  }

  if (request.name === 'action.execute.direct') {
    const actionName = compact(args.actionName);
    const goal = compact(args.goal);
    const actionArgs = toObject(args.args);
    if (!actionName || !goal) {
      return toTextResult('actionName and goal are required', true);
    }

    const action = getAction(actionName);
    if (!action) {
      return toTextResult(`unknown action: ${actionName}`, true);
    }

    const result = await action.execute({ goal, args: actionArgs });
    return toTextResult(JSON.stringify(result, null, 2), !result.ok);
  }

  return toTextResult(`unknown tool: ${request.name}`, true);
};
