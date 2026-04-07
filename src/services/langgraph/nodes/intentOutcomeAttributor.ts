/**
 * Intent Outcome Attributor (ADR-006)
 *
 * Closes the feedback loop between intent classification and session outcomes.
 * Called after a session terminates to determine whether the intent classification
 * was correct and update the exemplar store accordingly.
 *
 * Attribution heuristics:
 * - Low reward + low confidence → likely misclassification
 * - User sent clarification within 2 turns → original intent was probably 'uncertain'
 * - Good reward + high confidence → positive exemplar
 */

import logger from '../../../logger';
import { attributeIntentOutcome } from './intentExemplarStore';
import { getErrorMessage } from '../../../utils/errorMessage';

// ──── Types ─────────────────────────────────────────────────────────────────

export type IntentOutcomeInput = {
  sessionId: string;
  guildId: string;
  intentConfidence: number;
  intentPrimary: string;
  sessionStatus: string;          // 'completed' | 'failed' | 'cancelled'
  sessionReward: number | null;   // from rewardSignalService, 0-1 or null
  userClarifiedWithinTurns: boolean;  // did user send follow-up clarification?
  stepFailureCount: number;
};

export type AttributionResult = {
  wasCorrect: boolean;
  reason: string;
};

// ──── Attribution Logic ─────────────────────────────────────────────────────

const REWARD_GOOD_THRESHOLD = 0.6;
const REWARD_BAD_THRESHOLD = 0.35;
const CONFIDENCE_LOW_THRESHOLD = 0.5;
const CONFIDENCE_HIGH_THRESHOLD = 0.6;

export const computeAttribution = (input: IntentOutcomeInput): AttributionResult | null => {
  // Cancelled sessions are inconclusive — skip attribution entirely
  if (input.sessionStatus === 'cancelled') {
    return null;
  }

  // If user clarified within 2 turns, the original classification was likely wrong
  if (input.userClarifiedWithinTurns) {
    return { wasCorrect: false, reason: 'user_clarified_early' };
  }

  // If session failed and confidence was low, blame the classification
  if (input.sessionStatus === 'failed' && input.intentConfidence < CONFIDENCE_LOW_THRESHOLD) {
    return { wasCorrect: false, reason: 'failed_low_confidence' };
  }

  // If reward is available, use it as primary signal
  if (input.sessionReward !== null && Number.isFinite(input.sessionReward)) {
    if (input.sessionReward >= REWARD_GOOD_THRESHOLD && input.intentConfidence >= CONFIDENCE_HIGH_THRESHOLD) {
      return { wasCorrect: true, reason: 'good_reward_high_confidence' };
    }
    if (input.sessionReward < REWARD_BAD_THRESHOLD && input.intentConfidence < CONFIDENCE_LOW_THRESHOLD) {
      return { wasCorrect: false, reason: 'bad_reward_low_confidence' };
    }
    if (input.sessionReward >= REWARD_GOOD_THRESHOLD) {
      return { wasCorrect: true, reason: 'good_reward' };
    }
  }

  // Step failures with low confidence suggest wrong routing
  if (input.stepFailureCount >= 2 && input.intentConfidence < CONFIDENCE_LOW_THRESHOLD) {
    return { wasCorrect: false, reason: 'multi_step_failure_low_confidence' };
  }

  // Default: completed session → assume correct
  if (input.sessionStatus === 'completed') {
    return { wasCorrect: true, reason: 'completed_default' };
  }

  // Failed but high confidence — probably not an intent issue
  return { wasCorrect: true, reason: 'failed_high_confidence_not_intent' };
};

// ──── Integration Entry Point ───────────────────────────────────────────────

/**
 * Called after session termination (from entityNervousSystem or session cleanup).
 * Computes attribution and persists to intent_exemplars.
 */
export const attributeAndPersistIntentOutcome = async (input: IntentOutcomeInput): Promise<AttributionResult | null> => {
  const result = computeAttribution(input);

  // Inconclusive (e.g. cancelled) — skip persistence entirely
  if (result === null) {
    logger.debug('[INTENT-ATTRIBUTOR] skipping attribution for session=%s status=%s', input.sessionId, input.sessionStatus);
    return null;
  }

  try {
    await attributeIntentOutcome({
      sessionId: input.sessionId,
      wasCorrect: result.wasCorrect,
      sessionReward: input.sessionReward,
    });

    logger.info(
      '[INTENT-ATTRIBUTOR] session=%s intent=%s confidence=%.2f wasCorrect=%s reason=%s reward=%s',
      input.sessionId,
      input.intentPrimary,
      input.intentConfidence,
      String(result.wasCorrect),
      result.reason,
      input.sessionReward !== null ? input.sessionReward.toFixed(3) : 'null',
    );
  } catch (err) {
    logger.warn('[INTENT-ATTRIBUTOR] persist failed session=%s: %s', input.sessionId, getErrorMessage(err));
  }

  return result;
};
