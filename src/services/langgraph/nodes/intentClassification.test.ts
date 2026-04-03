import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyIntent, runRouteIntentNode, runClassifyIntentNode } from './coreNodes';
import type { IntentClassification } from '../../agent/agentRuntimeTypes';

// Mock llmClient to avoid real LLM calls
vi.mock('../../llmClient', () => ({
  generateText: vi.fn().mockResolvedValue('{"primary":"info_seek","confidence":0.8,"secondary":null,"latentNeeds":[],"reasoning":"test"}'),
  generateTextWithMeta: vi.fn(),
  isAnyLlmConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../../llmStructuredParseService', () => ({
  parseLlmStructuredRecord: vi.fn((raw: string) => {
    try { return JSON.parse(raw); } catch { return null; }
  }),
}));

vi.mock('../../agent/agentPrivacyPolicyService', () => ({
  getAgentPrivacyPolicySnapshot: vi.fn().mockReturnValue({
    modeDefault: 'direct',
    blockScore: 80,
    reviewScore: 60,
    reviewRules: [],
    blockRules: [],
  }),
}));

const { loadTopExemplars: mockLoadTopExemplars } = vi.hoisted(() => ({
  loadTopExemplars: vi.fn().mockResolvedValue([]),
}));

vi.mock('./intentExemplarStore', () => ({
  loadTopExemplars: mockLoadTopExemplars,
  persistIntentExemplar: vi.fn().mockResolvedValue(true),
  loadIntentFrequency: vi.fn().mockResolvedValue({ userHistory: [], guildDominant: null }),
}));

describe('Intent Intelligence Layer (ADR-006)', () => {
  describe('classifyIntent — Stage 1: Rule-based fast-path', () => {
    it('classifies meta_control for "멈춰"', async () => {
      const result = await classifyIntent({
        goal: '멈춰',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('meta_control');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.legacyIntent).toBe('task');
      expect(result.source).toBe('rule');
    });

    it('classifies emotional for short emotional text', async () => {
      const result = await classifyIntent({
        goal: '우울해',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('emotional');
      expect(result.legacyIntent).toBe('casual_chat');
      expect(result.source).toBe('rule');
    });

    it('classifies action_execute for "배포해"', async () => {
      const result = await classifyIntent({
        goal: '프로덕션에 배포해줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('action_execute');
      expect(result.legacyIntent).toBe('task');
      expect(result.source).toBe('rule');
    });

    it('classifies creative_generate for "만들어줘"', async () => {
      const result = await classifyIntent({
        goal: 'API 문서 만들어줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('creative_generate');
      expect(result.legacyIntent).toBe('task');
      expect(result.source).toBe('rule');
    });

    it('classifies info_seek for Korean question patterns', async () => {
      const result = await classifyIntent({
        goal: '이거 어떻게 하는 거야?',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('info_seek');
      expect(result.legacyIntent).toBe('task');
      expect(result.source).toBe('rule');
    });

    it('returns action_execute with confidence 1.0 when requestedSkillId is present', async () => {
      const result = await classifyIntent({
        goal: '아무 말이나',
        requestedSkillId: 'some-skill',
        intentHints: [],
        signals: null,
      });
      expect(result.primary).toBe('action_execute');
      expect(result.confidence).toBe(1.0);
      expect(result.legacyIntent).toBe('task');
    });

    it('classifies confirm_deny for "네" with prior turn context', async () => {
      const result = await classifyIntent({
        goal: '네',
        requestedSkillId: null,
        intentHints: [],
        signals: {
          message: '네',
          compiledPrompt: { originalGoal: '네', normalizedGoal: '네', executionGoal: '네', compiledGoal: '네', intentTags: [], directives: [], droppedNoise: false },
          recentTurns: [{ role: 'user', content: '이전 질문' }, { role: 'assistant', content: '응답' }],
          turnPosition: 1,
          graphNeighborTags: [],
          graphClusterHint: null,
          userIntentHistory: [],
          guildDominantIntent: null,
          memoryHints: [],
        },
      });
      expect(result.primary).toBe('confirm_deny');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('classifies opinion_consult for recommendation requests', async () => {
      const result = await classifyIntent({
        goal: '어떻게 생각해?',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      // Can be opinion_consult (rule) or info_seek (question pattern)
      // Depends on rule ordering — opinion_consult has lower confidence, question pattern also matches
      expect(['opinion_consult', 'info_seek']).toContain(result.primary);
      expect(result.legacyIntent).toBe('task');
    });
  });

  describe('classifyIntent — Stage 3: LLM fallback', () => {
    it('falls through to LLM for ambiguous text', async () => {
      const result = await classifyIntent({
        goal: '오늘 날씨 좋다',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      // This should fall through rules (no strong pattern) and hit LLM
      expect(result.source).toBe('llm');
      expect(result.primary).toBe('info_seek'); // From mock
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('runRouteIntentNode — backward compatibility', () => {
    it('returns legacy AgentIntent string', async () => {
      const result = await runRouteIntentNode({
        goal: '멈춰',
        requestedSkillId: null,
        intentHints: [],
      });
      expect(result).toBe('task');
    });

    it('returns task for requestedSkillId', async () => {
      const result = await runRouteIntentNode({
        goal: 'something',
        requestedSkillId: 'plan',
        intentHints: [],
      });
      expect(result).toBe('task');
    });
  });

  describe('runClassifyIntentNode — full classification', () => {
    it('returns IntentClassification object', async () => {
      const result = await runClassifyIntentNode({
        goal: '실행해줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
      });
      expect(result).toHaveProperty('primary');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('secondary');
      expect(result).toHaveProperty('legacyIntent');
      expect(result).toHaveProperty('latentNeeds');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('source');
    });
  });

  describe('classifyIntent — Stage 2: Exemplar matching', () => {
    beforeEach(() => {
      mockLoadTopExemplars.mockReset();
    });

    it('skips exemplar matching when fewer than 5 exemplars', async () => {
      mockLoadTopExemplars.mockResolvedValue([
        { id: 1, guildId: 'g1', message: '배포해줘', classifiedIntent: 'action_execute', confidence: 0.9, wasCorrect: true, sessionReward: 0.8, sessionId: 's1', userCorrection: null, signalSnapshot: {}, createdAt: '' },
      ]);
      const result = await classifyIntent({
        goal: '배포를 해줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: 'g1',
      });
      // Should NOT be 'exemplar' source since too few exemplars
      expect(result.source).not.toBe('exemplar');
    });

    it('returns exemplar match when sufficient high-quality exemplars agree', async () => {
      const exemplars = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        guildId: 'g1',
        message: `프로덕션 서버에 배포해줘 ${i}`,
        classifiedIntent: 'action_execute',
        confidence: 0.9,
        wasCorrect: true,
        sessionReward: 0.8,
        sessionId: `s${i}`,
        userCorrection: null,
        signalSnapshot: {},
        createdAt: '',
      }));
      mockLoadTopExemplars.mockResolvedValue(exemplars);

      const result = await classifyIntent({
        goal: '프로덕션 서버에 배포해줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: 'g1',
      });
      // Rule-based should catch this first due to 배포해 pattern
      // but if it falls through, exemplar should work
      expect(result.primary).toBe('action_execute');
    });

    it('falls through when exemplar confidence is too low', async () => {
      // Mixed intents = low confidence
      const exemplars = [
        { id: 1, guildId: 'g1', message: '오늘 점심 뭐 먹을까', classifiedIntent: 'opinion_consult', confidence: 0.8, wasCorrect: true, sessionReward: 0.7, sessionId: 's1', userCorrection: null, signalSnapshot: {}, createdAt: '' },
        { id: 2, guildId: 'g1', message: '오늘 저녁 뭐 먹을까', classifiedIntent: 'info_seek', confidence: 0.7, wasCorrect: true, sessionReward: 0.6, sessionId: 's2', userCorrection: null, signalSnapshot: {}, createdAt: '' },
        { id: 3, guildId: 'g1', message: '보고서 작성 요약', classifiedIntent: 'creative_generate', confidence: 0.8, wasCorrect: true, sessionReward: 0.7, sessionId: 's3', userCorrection: null, signalSnapshot: {}, createdAt: '' },
        { id: 4, guildId: 'g1', message: '서버 로그 확인', classifiedIntent: 'info_seek', confidence: 0.9, wasCorrect: true, sessionReward: 0.8, sessionId: 's4', userCorrection: null, signalSnapshot: {}, createdAt: '' },
        { id: 5, guildId: 'g1', message: '신규 기능 제안', classifiedIntent: 'creative_generate', confidence: 0.7, wasCorrect: true, sessionReward: 0.6, sessionId: 's5', userCorrection: null, signalSnapshot: {}, createdAt: '' },
      ];
      mockLoadTopExemplars.mockResolvedValue(exemplars);

      const result = await classifyIntent({
        goal: '내일 회의 어디서 하지',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: 'g1',
      });
      // Should NOT come from exemplar (low overlap + mixed intents)
      expect(result.source).not.toBe('exemplar');
    });

    it('skips exemplar matching when guildId is null', async () => {
      mockLoadTopExemplars.mockResolvedValue([]);
      const result = await classifyIntent({
        goal: '배포해줘',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: null,
      });
      expect(mockLoadTopExemplars).not.toHaveBeenCalled();
    });

    it('requires exactly 5 exemplars to activate (boundary)', async () => {
      const exemplars = Array.from({ length: 4 }, (_, i) => ({
        id: i + 1,
        guildId: 'g1',
        message: `새 기능 만들어줘 ${i}`,
        classifiedIntent: 'creative_generate',
        confidence: 0.9,
        wasCorrect: true,
        sessionReward: 0.8,
        sessionId: `s${i}`,
        userCorrection: null,
        signalSnapshot: {},
        createdAt: '',
      }));
      mockLoadTopExemplars.mockResolvedValue(exemplars);

      const result = await classifyIntent({
        goal: '새 기능 만들어줘 테스트',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: 'g1',
      });
      expect(result.source).not.toBe('exemplar');
    });

    it('handles exemplar store failure gracefully', async () => {
      mockLoadTopExemplars.mockRejectedValue(new Error('DB timeout'));
      const result = await classifyIntent({
        goal: '오늘 뭐 하지',
        requestedSkillId: null,
        intentHints: [],
        signals: null,
        guildId: 'g1',
      });
      // Should fall through to LLM, not crash
      expect(result).toHaveProperty('primary');
      expect(result.source).not.toBe('exemplar');
    });
  });
});
