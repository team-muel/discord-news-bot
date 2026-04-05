import { generateText, isAnyLlmConfigured } from '../llmClient';
import { OPENAI_ANALYSIS_MODEL } from '../../config';

export const isInvestmentAnalysisEnabled = (): boolean => isAnyLlmConfigured();

export async function generateInvestmentAnalysis(query: string): Promise<string> {
  if (!isAnyLlmConfigured()) {
    return '(LLM 미설정) 투자 분석 기능이 제한 모드로 동작합니다.';
  }

  const safeQuery = String(query || '').slice(0, 1000);

  const prompt = [
    `기업/종목 분석 요청: ${safeQuery}`,
    '출력 형식:',
    '서론 2~3문장 후 아래 소제목을 순서대로 작성:',
    '독점적 기술 및 시장 지위',
    '산업 성장성과 수요',
    '재무 건전성 및 수익성',
    '지정학적 리스크',
    '연구 개발 투자',
    '마지막 결론: 투자 관점 요약 2~3문장',
    '규칙:',
    '- 과장/확정 표현 금지',
    '- 투자 권유 표현 금지',
    '- 각 소제목당 2~4문장으로 제한',
    '- 불릿 포인트 남발 금지 (문단형 우선)',
    '- 가능한 경우 수요/공급/경쟁/밸류에이션 관점 포함',
    '- 한국어로 간결하게 작성',
  ].join('\n');

  try {
    const result = await generateText({
      system: [
        'You are a professional equity research assistant.',
        'Provide balanced, evidence-oriented analysis in Korean.',
        'Follow user-required output format exactly and keep it concise.',
        'Avoid hype, deterministic claims, and direct investment advice.',
      ].join(' '),
      user: prompt,
      model: OPENAI_ANALYSIS_MODEL,
      temperature: 0.2,
      maxTokens: 1000,
      actionName: 'analysis.investment',
    });

    return result || '분석 결과를 생성하지 못했습니다.';
  } catch {
    return '분석 결과를 생성하지 못했습니다.';
  }
}
