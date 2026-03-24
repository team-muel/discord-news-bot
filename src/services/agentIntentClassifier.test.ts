import { describe, expect, it, vi } from 'vitest';

vi.mock('./llmClient', () => ({
  generateText: vi.fn().mockResolvedValue('테스트 응답입니다.'),
}));

import {
  buildPolicyBlockMessage,
  buildIntentClarificationFallback,
  generateIntentClarificationResult,
  buildCasualChatFallback,
  generateCasualChatResult,
} from './agentIntentClassifier';

describe('agentIntentClassifier', () => {
  describe('buildPolicyBlockMessage', () => {
    it('includes policy reasons in message', () => {
      const msg = buildPolicyBlockMessage(['privacy_pii', 'financial_data']);
      expect(msg).toContain('privacy_pii');
      expect(msg).toContain('financial_data');
      expect(msg).toContain('개인정보 보호 정책상');
    });

    it('uses fallback when reasons are empty', () => {
      const msg = buildPolicyBlockMessage([]);
      expect(msg).toContain('privacy_policy');
    });

    it('truncates to 4 reasons', () => {
      const reasons = ['a', 'b', 'c', 'd', 'e'];
      const msg = buildPolicyBlockMessage(reasons);
      expect(msg).not.toContain('e');
    });
  });

  describe('buildIntentClarificationFallback', () => {
    it('returns generic fallback for empty goal', () => {
      const msg = buildIntentClarificationFallback('');
      expect(msg).toContain('원하는 결과를 한 줄로 알려주세요');
    });

    it('returns confirmation request for non-empty goal', () => {
      const msg = buildIntentClarificationFallback('뭔가 해줘');
      expect(msg).toContain('작업 실행인지');
    });
  });

  describe('buildCasualChatFallback', () => {
    it('returns empathetic response for emotional keywords', () => {
      const msg = buildCasualChatFallback('오늘 너무 힘들었어');
      expect(msg).toContain('지쳤던 것 같아요');
    });

    it('returns generic follow-up for other messages', () => {
      const msg = buildCasualChatFallback('안녕');
      expect(msg).toContain('들려줘서 고마워요');
    });
  });

  describe('generateCasualChatResult', () => {
    it('returns LLM-generated response', async () => {
      const result = await generateCasualChatResult('오늘 좋은 일 있었어');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('generateIntentClarificationResult', () => {
    it('returns LLM-generated clarification', async () => {
      const result = await generateIntentClarificationResult('뭔가 해줘', ['힌트1']);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });
});
