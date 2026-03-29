import { generateInvestmentAnalysis } from '../../investmentAnalysisService';
import type { ActionDefinition } from './types';

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

export const investmentAnalysisAction: ActionDefinition = {
  name: 'investment.analysis',
  description: '요청 텍스트 기반으로 투자 분석 결과를 생성합니다.',
  category: 'finance',
  parameters: [
    { name: 'query', required: true, description: 'Investment analysis topic or question', example: 'NVIDIA Q4 2025 earnings analysis' },
  ],
  execute: async ({ goal, args }) => {
    const query = typeof args?.query === 'string' && args.query.trim()
      ? args.query.trim()
      : compact(goal).replace(/세션 스킬 실행:[^\n]*/g, '').replace(/요청:\s*/g, '').replace(/목표:\s*/g, '').trim();

    const analysis = await generateInvestmentAnalysis(query || goal);
    return {
      ok: true,
      name: 'investment.analysis',
      summary: '투자 분석 결과 생성 완료',
      artifacts: [String(analysis || '결과 없음').slice(0, 3200)],
      verification: ['LLM 분석 응답 수신 완료'],
    };
  },
};
