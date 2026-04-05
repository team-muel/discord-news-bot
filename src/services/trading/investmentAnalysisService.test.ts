import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateText = vi.fn();
const mockIsAnyLlmConfigured = vi.fn();

vi.mock('../llmClient', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  isAnyLlmConfigured: () => mockIsAnyLlmConfigured(),
}));

vi.mock('../../config', () => ({
  OPENAI_ANALYSIS_MODEL: 'gpt-4o-mini',
}));

describe('investmentAnalysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isInvestmentAnalysisEnabled', () => {
    it('returns false when no LLM is configured', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(false);
      vi.resetModules();
      const { isInvestmentAnalysisEnabled } = await import('./investmentAnalysisService');
      expect(isInvestmentAnalysisEnabled()).toBe(false);
    });

    it('returns true when any LLM is configured', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      vi.resetModules();
      const { isInvestmentAnalysisEnabled } = await import('./investmentAnalysisService');
      expect(isInvestmentAnalysisEnabled()).toBe(true);
    });
  });

  describe('generateInvestmentAnalysis', () => {
    it('returns fallback message when no LLM is configured', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(false);
      vi.resetModules();
      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('삼성전자');
      expect(result).toContain('LLM 미설정');
    });

    it('truncates overly long input to 1000 chars', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      mockGenerateText.mockResolvedValueOnce('테스트 분석 결과');
      vi.resetModules();
      const longQuery = 'A'.repeat(5000);

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      await generateInvestmentAnalysis(longQuery);

      const callArgs = mockGenerateText.mock.calls[0][0];
      // Truncated input should not contain the full 5000-char query
      expect(callArgs.user.length).toBeLessThan(longQuery.length);
    });

    it('returns AI content on successful LLM response', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      mockGenerateText.mockResolvedValueOnce('삼성전자는 반도체 시장의 핵심 기업입니다.');
      vi.resetModules();

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('삼성전자');
      expect(result).toBe('삼성전자는 반도체 시장의 핵심 기업입니다.');
    });

    it('passes correct actionName for policy routing', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      mockGenerateText.mockResolvedValueOnce('결과');
      vi.resetModules();

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      await generateInvestmentAnalysis('AAPL');
      expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
        actionName: 'analysis.investment',
      }));
    });

    it('returns fallback when LLM throws', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      mockGenerateText.mockRejectedValueOnce(new Error('LLM_REQUEST_FAILED'));
      vi.resetModules();

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('AAPL');
      expect(result).toBe('분석 결과를 생성하지 못했습니다.');
    });

    it('returns fallback when LLM returns empty content', async () => {
      mockIsAnyLlmConfigured.mockReturnValue(true);
      mockGenerateText.mockResolvedValueOnce('');
      vi.resetModules();

      const { generateInvestmentAnalysis } = await import('./investmentAnalysisService');
      const result = await generateInvestmentAnalysis('test');
      expect(result).toBe('분석 결과를 생성하지 못했습니다.');
    });
  });
});
