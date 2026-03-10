const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export const isInvestmentAnalysisEnabled = (): boolean => Boolean((process.env.OPENAI_API_KEY || '').trim());

export async function generateInvestmentAnalysis(query: string): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return '(OPENAI_API_KEY 없음) 투자 분석 기능이 제한 모드로 동작합니다.';
  }

  const prompt = [
    `기업/종목 분석 요청: ${query}`,
    '출력 형식:',
    '1) 핵심 포인트 3줄',
    '2) 단기 리스크/기회',
    '3) 중기 관찰 지표',
    '과장 없이 중립적으로 한국어로 작성',
  ].join('\n');

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'You are a concise financial analysis assistant.' },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return `AI 응답 실패: ${text.slice(0, 300)}`;
  }

  const data = (await res.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '분석 결과를 생성하지 못했습니다.');
}
