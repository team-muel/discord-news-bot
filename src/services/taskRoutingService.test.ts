import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseChain } from '../test/supabaseMock';

// ---------- mocks ----------
const mockFrom = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(createSupabaseChain({ data: [], error: null })) });
vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: mockFrom }),
}));

// ---------- import under test ----------
const { detectTaskRoute, detectTaskRouteForGuild, buildRagQueryPlan } = await import('./taskRoutingService');

describe('taskRoutingService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('detectTaskRoute', () => {
    it('returns knowledge route for knowledge queries', () => {
      const result = detectTaskRoute('스키마 설명해줘');
      expect(result.route).toBe('knowledge');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('returns execution route for build commands', () => {
      const result = detectTaskRoute('이 함수를 구현해줘');
      expect(result.route).toBe('execution');
    });

    it('returns casual for greetings', () => {
      const result = detectTaskRoute('안녕하세요');
      expect(result.route).toBe('casual');
    });

    it('returns mixed for ambiguous inputs', () => {
      const result = detectTaskRoute('설명하고 구현해줘');
      expect(result.route).toBe('mixed');
    });

    it('handles explicit route override', () => {
      const result = detectTaskRoute('[route: execution] 안녕');
      expect(result.route).toBe('execution');
      expect(result.overrideUsed).toBe(true);
      expect(result.confidence).toBe(1);
    });

    it('returns fallback for empty input', () => {
      const result = detectTaskRoute('');
      expect(result.route).toBe('knowledge');
      expect(result.reasons).toContain('empty_input_fallback');
    });
  });

  describe('detectTaskRouteForGuild', () => {
    it('returns base route when no guildId', async () => {
      const result = await detectTaskRouteForGuild('스키마 문서');
      expect(result.route).toBe('knowledge');
    });

    it('applies learning rule match when available', async () => {
      // Mock learning rules returning a match
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          or: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      data: [{
                        guild_id: '123',
                        signal_key: 'deploy',
                        signal_pattern: 'deploy',
                        recommended_route: 'execution',
                        confidence: 0.9,
                        support_count: 10,
                        status: 'active',
                      }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });
      const result = await detectTaskRouteForGuild('deploy the new version', '123');
      expect(result.route).toBe('execution');
      expect(result.reasons).toContainEqual(expect.stringContaining('learning_rule_match'));
    });
  });

  describe('buildRagQueryPlan', () => {
    it('returns higher maxDocs for knowledge queries', () => {
      const plan = buildRagQueryPlan('문서 정리해줘');
      expect(plan.route).toBe('knowledge');
      expect(plan.maxDocs).toBe(10);
    });

    it('returns lower maxDocs for execution queries', () => {
      const plan = buildRagQueryPlan('코드 구현해줘');
      expect(plan.route).toBe('execution');
      expect(plan.maxDocs).toBe(6);
      expect(plan.contextMode).toBe('metadata_first');
    });

    it('returns medium maxDocs for mixed queries', () => {
      const plan = buildRagQueryPlan('설명하고 구현해줘');
      expect(plan.route).toBe('mixed');
      expect(plan.maxDocs).toBe(8);
    });
  });
});
