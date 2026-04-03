import { describe, it, expect } from 'vitest';
import { computeAttribution } from './intentOutcomeAttributor';

describe('intentOutcomeAttributor', () => {
  describe('computeAttribution', () => {
    it('returns null (skip) for cancelled sessions', () => {
      const result = computeAttribution({
        sessionId: 's1',
        guildId: 'g1',
        intentConfidence: 0.3,
        intentPrimary: 'info_seek',
        sessionStatus: 'cancelled',
        sessionReward: null,
        userClarifiedWithinTurns: false,
        stepFailureCount: 0,
      });
      expect(result).toBeNull();
    });

    it('blames intent when early step failure with low confidence', () => {
      const result = computeAttribution({
        sessionId: 's2',
        guildId: 'g1',
        intentConfidence: 0.4,
        intentPrimary: 'action_execute',
        sessionStatus: 'completed',
        sessionReward: 0.5,
        userClarifiedWithinTurns: true,
        stepFailureCount: 2,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(false);
      expect(result!.reason).toBe('user_clarified_early');
    });

    it('blames intent when failed with low confidence', () => {
      const result = computeAttribution({
        sessionId: 's3',
        guildId: 'g1',
        intentConfidence: 0.3,
        intentPrimary: 'info_seek',
        sessionStatus: 'failed',
        sessionReward: null,
        userClarifiedWithinTurns: false,
        stepFailureCount: 1,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(false);
      expect(result!.reason).toBe('failed_low_confidence');
    });

    it('marks correct when reward is good and confidence is high', () => {
      const result = computeAttribution({
        sessionId: 's4',
        guildId: 'g1',
        intentConfidence: 0.8,
        intentPrimary: 'info_seek',
        sessionStatus: 'completed',
        sessionReward: 0.85,
        userClarifiedWithinTurns: false,
        stepFailureCount: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(true);
      expect(result!.reason).toBe('good_reward_high_confidence');
    });

    it('blames intent when reward is bad and confidence is low', () => {
      const result = computeAttribution({
        sessionId: 's5',
        guildId: 'g1',
        intentConfidence: 0.3,
        intentPrimary: 'creative_generate',
        sessionStatus: 'completed',
        sessionReward: 0.2,
        userClarifiedWithinTurns: false,
        stepFailureCount: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(false);
      expect(result!.reason).toBe('bad_reward_low_confidence');
    });

    it('blames intent for multi-step failure with low confidence', () => {
      const result = computeAttribution({
        sessionId: 's6',
        guildId: 'g1',
        intentConfidence: 0.4,
        intentPrimary: 'action_execute',
        sessionStatus: 'completed',
        sessionReward: null,
        userClarifiedWithinTurns: false,
        stepFailureCount: 3,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(false);
      expect(result!.reason).toBe('multi_step_failure_low_confidence');
    });

    it('defaults to correct for completed sessions', () => {
      const result = computeAttribution({
        sessionId: 's7',
        guildId: 'g1',
        intentConfidence: 0.6,
        intentPrimary: 'opinion_consult',
        sessionStatus: 'completed',
        sessionReward: null,
        userClarifiedWithinTurns: false,
        stepFailureCount: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.wasCorrect).toBe(true);
      expect(result!.reason).toBe('completed_default');
    });
  });
});
