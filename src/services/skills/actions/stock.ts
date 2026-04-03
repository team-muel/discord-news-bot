import { fetchStockChartImageUrl, fetchStockQuote } from '../../trading/stockService';
import type { ActionDefinition } from './types';

const extractTicker = (goal: string, args?: Record<string, unknown>): string | null => {
  const argSymbol = typeof args?.symbol === 'string' ? args.symbol.toUpperCase().trim() : '';
  if (argSymbol) {
    return argSymbol;
  }

  const match = String(goal || '').toUpperCase().match(/\b[A-Z]{1,5}\b/);
  return match ? match[0] : null;
};

export const stockQuoteAction: ActionDefinition = {
  name: 'stock.quote',
  description: '티커 심볼의 현재 시세를 조회합니다.',
  category: 'finance',
  parameters: [
    { name: 'symbol', required: true, description: 'Stock ticker symbol (e.g. AAPL, TSLA)', example: 'AAPL' },
  ],
  execute: async ({ goal, args }) => {
    const symbol = extractTicker(goal, args);
    if (!symbol) {
      return {
        ok: false,
        name: 'stock.quote',
        summary: '티커 심볼을 찾지 못했습니다.',
        artifacts: [],
        verification: ['입력에서 심볼 추출 실패'],
        error: 'SYMBOL_NOT_FOUND',
      };
    }

    const quote = await fetchStockQuote(symbol);
    if (!quote) {
      return {
        ok: false,
        name: 'stock.quote',
        summary: `${symbol} 시세 조회 실패`,
        artifacts: [],
        verification: ['외부 시세 API 응답 없음'],
        error: 'QUOTE_FETCH_FAILED',
      };
    }

    return {
      ok: true,
      name: 'stock.quote',
      summary: `${symbol} 시세 조회 성공`,
      artifacts: [`price=${quote.price}`, `high=${quote.high}`, `low=${quote.low}`, `open=${quote.open}`, `prevClose=${quote.prevClose}`],
      verification: ['시세 필드 파싱 성공'],
    };
  },
};

export const stockChartAction: ActionDefinition = {
  name: 'stock.chart',
  description: '티커 심볼의 차트 URL을 생성합니다.',
  category: 'finance',
  parameters: [
    { name: 'symbol', required: true, description: 'Stock ticker symbol', example: 'TSLA' },
  ],
  execute: async ({ goal, args }) => {
    const symbol = extractTicker(goal, args);
    if (!symbol) {
      return {
        ok: false,
        name: 'stock.chart',
        summary: '차트 대상 티커 심볼을 찾지 못했습니다.',
        artifacts: [],
        verification: ['입력에서 심볼 추출 실패'],
        error: 'SYMBOL_NOT_FOUND',
      };
    }

    const chartUrl = await fetchStockChartImageUrl(symbol);
    if (!chartUrl) {
      return {
        ok: false,
        name: 'stock.chart',
        summary: `${symbol} 차트 URL 생성 실패`,
        artifacts: [],
        verification: ['차트 생성 API 응답 없음'],
        error: 'CHART_FETCH_FAILED',
      };
    }

    return {
      ok: true,
      name: 'stock.chart',
      summary: `${symbol} 차트 URL 생성 성공`,
      artifacts: [chartUrl],
      verification: ['차트 URL 생성 완료'],
    };
  },
};
