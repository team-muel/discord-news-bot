import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('investmentAnalysisService', () => {
  let envSnapshot: string | undefined;

  beforeEach(() => {
    envSnapshot = process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (envSnapshot !== undefined) {
      process.env.OPENAI_API_KEY = envSnapshot;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  describe('isInvestmentAnalysisEnabled', () => {
    it('returns false when OPENAI_API_KEY is absent', async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();
      const { isInvestmentAnalysisEnabled } = await import('./investmentAnalysisService');
      expect(isInvestmentAnalysisEnabled()).toBe(false);
    });

    it('returns true when OPENAI_API_KEY is set', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      vi.resetModules();
      const { isInvestmentAnalysisEnabled } = await import('./investmentAnalysisService');
      expect(isInvestmentAnalysisEnabled()).toBe(true);
    });
  });

  describe('generateInvestmentAnalysis', () => {
    it('returns fallback message when API key is missing', async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();
      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('삼성전자');
      expect(result).toContain('OPENAI_API_KEY 없음');
    });

    it('truncates overly long input to 1000 chars', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      vi.resetModules();
      const longQuery = 'A'.repeat(5000);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          choices: [{ message: { content: '테스트 분석 결과' } }],
        }), { status: 200 }),
      );

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      await generateInvestmentAnalysis(longQuery);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      const userContent = body.messages[1].content;
      // Truncated input should not exceed 1000 chars of original query
      expect(userContent.length).toBeLessThan(longQuery.length);
    });

    it('returns AI content on successful API response', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          choices: [{ message: { content: '삼성전자는 반도체 시장의 핵심 기업입니다.' } }],
        }), { status: 200 }),
      );

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('삼성전자');
      expect(result).toBe('삼성전자는 반도체 시장의 핵심 기업입니다.');
    });

    it('returns error message on API failure', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('rate limited', { status: 429 }),
      );

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('AAPL');
      expect(result).toContain('AI 응답 실패');
    });

    it('returns fallback when API returns empty content', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }),
      );

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('test');
      expect(result).toBe('분석 결과를 생성하지 못했습니다.');
    });
  });
});
