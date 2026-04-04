import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('stockService', () => {
  let envSnapshot: string | undefined;

  beforeEach(() => {
    envSnapshot = process.env.ALPHA_VANTAGE_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (envSnapshot !== undefined) {
      process.env.ALPHA_VANTAGE_KEY = envSnapshot;
    } else {
      delete process.env.ALPHA_VANTAGE_KEY;
    }
  });

  // ── isStockFeatureEnabled ──────────────────────────────────────────

  describe('isStockFeatureEnabled', () => {
    it('returns false when ALPHA_VANTAGE_KEY is not set', async () => {
      delete process.env.ALPHA_VANTAGE_KEY;
      vi.resetModules();
      const { isStockFeatureEnabled } = await import('./stockService');
      expect(isStockFeatureEnabled()).toBe(false);
    });

    it('returns false when ALPHA_VANTAGE_KEY is empty', async () => {
      process.env.ALPHA_VANTAGE_KEY = '  ';
      vi.resetModules();
      const { isStockFeatureEnabled } = await import('./stockService');
      expect(isStockFeatureEnabled()).toBe(false);
    });

    it('returns true when ALPHA_VANTAGE_KEY is set', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'demo_key';
      vi.resetModules();
      const { isStockFeatureEnabled } = await import('./stockService');
      expect(isStockFeatureEnabled()).toBe(true);
    });
  });

  // ── fetchStockQuote ────────────────────────────────────────────────

  describe('fetchStockQuote', () => {
    it('returns null when API key is not set', async () => {
      delete process.env.ALPHA_VANTAGE_KEY;
      vi.resetModules();
      const { fetchStockQuote } = await import('./stockService');
      const result = await fetchStockQuote('AAPL');
      expect(result).toBeNull();
    });

    it('returns null for invalid symbol', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      const { fetchStockQuote } = await import('./stockService');
      // SQL injection attempt, special characters
      expect(await fetchStockQuote("'; DROP TABLE--")).toBeNull();
      expect(await fetchStockQuote('')).toBeNull();
      expect(await fetchStockQuote('VERY_LONG_SYMBOL_EXCEEDS_LIMIT')).toBeNull();
    });

    it('parses successful API response correctly', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      const mockResponse = {
        'Global Quote': {
          '01. symbol': 'AAPL',
          '02. open': '150.00',
          '03. high': '155.00',
          '04. low': '148.00',
          '05. price': '152.50',
          '08. previous close': '149.00',
        },
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const { fetchStockQuote } = await import('./stockService');
      const result = await fetchStockQuote('AAPL');

      expect(result).toEqual({
        symbol: 'AAPL',
        price: '152.50',
        high: '155.00',
        low: '148.00',
        open: '150.00',
        prevClose: '149.00',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null when API returns empty Global Quote', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ 'Global Quote': {} }), { status: 200 }),
      );

      const { fetchStockQuote } = await import('./stockService');
      expect(await fetchStockQuote('FAKE')).toBeNull();
    });

    it('returns null when API returns HTTP error', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('rate limited', { status: 429 }),
      );

      const { fetchStockQuote } = await import('./stockService');
      expect(await fetchStockQuote('AAPL')).toBeNull();
    });
  });

  // ── fetchStockChartImageUrl ────────────────────────────────────────

  describe('fetchStockChartImageUrl', () => {
    it('returns null when API key is not set', async () => {
      delete process.env.ALPHA_VANTAGE_KEY;
      vi.resetModules();
      const { fetchStockChartImageUrl } = await import('./stockService');
      expect(await fetchStockChartImageUrl('AAPL')).toBeNull();
    });

    it('returns null for invalid symbol', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      const { fetchStockChartImageUrl } = await import('./stockService');
      expect(await fetchStockChartImageUrl('<script>')).toBeNull();
    });

    it('returns quickchart URL for valid API response', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      const series: Record<string, Record<string, string>> = {};
      for (let i = 1; i <= 5; i++) {
        series[`2026-01-0${i}`] = { '4. close': String(150 + i) };
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ 'Time Series (Daily)': series }), { status: 200 }),
      );

      const { fetchStockChartImageUrl } = await import('./stockService');
      const url = await fetchStockChartImageUrl('AAPL');

      expect(url).toBeTruthy();
      expect(url).toContain('quickchart.io');
      expect(url).toContain('AAPL');
    });

    it('returns null when API returns empty time series', async () => {
      process.env.ALPHA_VANTAGE_KEY = 'test';
      vi.resetModules();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ 'Time Series (Daily)': {} }), { status: 200 }),
      );

      const { fetchStockChartImageUrl } = await import('./stockService');
      expect(await fetchStockChartImageUrl('AAPL')).toBeNull();
    });
  });
});
