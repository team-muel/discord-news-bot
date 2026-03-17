import { describe, expect, it } from 'vitest';
import { buildTotCandidatePairTelemetryPayload, decideComposePromotion } from './composeNodes';

describe('decideComposePromotion', () => {
  it('입력 조건이 부족하면 평가를 건너뛴다', () => {
    const decision = decideComposePromotion({
      totPolicyActiveEnabled: true,
      totPolicyActiveAllowFast: true,
      totPolicyActiveMinGoalLength: 10,
      totPolicyActiveRequireNonPass: false,
      totPolicyActiveMinScoreGain: 1,
      totPolicyActiveMinBeamGain: 0.01,
      gotCutoverAllowed: false,
      gotMinSelectedScore: 0.5,
      priority: 'balanced',
      taskGoal: '짧은 테스트',
      base: null,
      candidate: null,
      baseBeam: null,
      candidateBeam: null,
    });

    expect(decision.shouldEvaluate).toBe(false);
    expect(decision.promote).toBe(false);
  });

  it('ToT 정책 게이트를 통과하면 승격한다', () => {
    const decision = decideComposePromotion({
      totPolicyActiveEnabled: true,
      totPolicyActiveAllowFast: true,
      totPolicyActiveMinGoalLength: 5,
      totPolicyActiveRequireNonPass: false,
      totPolicyActiveMinScoreGain: 3,
      totPolicyActiveMinBeamGain: 0.01,
      gotCutoverAllowed: false,
      gotMinSelectedScore: 0.5,
      priority: 'balanced',
      taskGoal: '운영 개선안을 단계별로 제시해줘',
      base: {
        ormScore: 70,
        ormVerdict: 'review',
        evidenceBundleId: 'ev-base',
      },
      candidate: {
        ormScore: 78,
        ormVerdict: 'pass',
        evidenceBundleId: 'ev-cand',
      },
      baseBeam: {
        probability: 0.6,
        correctness: 0.7,
        score: 0.42,
        probabilitySource: 'self_eval',
      },
      candidateBeam: {
        probability: 0.66,
        correctness: 0.72,
        score: 0.4752,
        probabilitySource: 'self_eval',
      },
    });

    expect(decision.shouldEvaluate).toBe(true);
    expect(decision.promoteByTotPolicy).toBe(true);
    expect(decision.promote).toBe(true);
    expect(decision.scoreGain).toBe(8);
    expect(decision.beamGain).toBeCloseTo(0.0552, 5);
  });

  it('ToT는 실패해도 GoT cutover 조건이면 승격한다', () => {
    const decision = decideComposePromotion({
      totPolicyActiveEnabled: true,
      totPolicyActiveAllowFast: true,
      totPolicyActiveMinGoalLength: 5,
      totPolicyActiveRequireNonPass: true,
      totPolicyActiveMinScoreGain: 10,
      totPolicyActiveMinBeamGain: 0.1,
      gotCutoverAllowed: true,
      gotMinSelectedScore: 0.75,
      priority: 'balanced',
      taskGoal: '긴급 장애 대응 runbook 작성',
      base: {
        ormScore: 80,
        ormVerdict: 'pass',
        evidenceBundleId: 'ev-base',
      },
      candidate: {
        ormScore: 82,
        ormVerdict: 'pass',
        evidenceBundleId: 'ev-cand',
      },
      baseBeam: {
        probability: 0.6,
        correctness: 0.7,
        score: 0.42,
        probabilitySource: 'fallback',
      },
      candidateBeam: {
        probability: 0.61,
        correctness: 0.7,
        score: 0.427,
        probabilitySource: 'fallback',
      },
    });

    expect(decision.promoteByTotPolicy).toBe(false);
    expect(decision.promoteByGotCutover).toBe(true);
    expect(decision.promote).toBe(true);
  });
});

describe('buildTotCandidatePairTelemetryPayload', () => {
  it('후보 비교 페이로드를 일관된 키로 생성한다', () => {
    const payload = buildTotCandidatePairTelemetryPayload({
      guildId: 'g1',
      sessionId: 's1',
      strategy: 'tot_v1',
      base: {
        ormScore: 71,
        ormVerdict: 'review',
        evidenceBundleId: 'base-ev',
      },
      candidate: {
        ormScore: 79,
        ormVerdict: 'pass',
        evidenceBundleId: 'cand-ev',
      },
      baseBeam: {
        probability: 0.55,
        correctness: 0.66,
        score: 0.363,
        probabilitySource: 'self_eval',
      },
      candidateBeam: {
        probability: 0.63,
        correctness: 0.7,
        score: 0.441,
        probabilitySource: 'provider_logprob',
      },
      baselineResult: 'base',
      candidateResult: 'cand',
      promoted: true,
      scoreGain: 8,
      beamGain: 0.078,
    });

    expect(payload).toMatchObject({
      guildId: 'g1',
      sessionId: 's1',
      strategy: 'tot_v1',
      baselineScore: 71,
      candidateScore: 79,
      scoreGain: 8,
      beamGain: 0.078,
      promoted: true,
      baselineEvidenceBundleId: 'base-ev',
      candidateEvidenceBundleId: 'cand-ev',
      baselineResult: 'base',
      candidateResult: 'cand',
    });
  });
});
