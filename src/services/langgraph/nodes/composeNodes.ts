export type ComposeBeamMetrics = {
  probability: number;
  correctness: number;
  score: number;
  probabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
};

export type ComposeEvalMetrics = {
  ormScore: number;
  ormVerdict: 'pass' | 'review' | 'fail';
  evidenceBundleId: string;
};

export type ComposePromotionDecision = {
  shouldEvaluate: boolean;
  promote: boolean;
  promoteByTotPolicy: boolean;
  promoteByGotCutover: boolean;
  scoreGain: number;
  beamGain: number;
};

export const decideComposePromotion = (params: {
  totPolicyActiveEnabled: boolean;
  totPolicyActiveAllowFast: boolean;
  totPolicyActiveMinGoalLength: number;
  totPolicyActiveRequireNonPass: boolean;
  totPolicyActiveMinScoreGain: number;
  totPolicyActiveMinBeamGain: number;
  gotCutoverAllowed: boolean;
  gotMinSelectedScore: number;
  priority: 'fast' | 'balanced' | 'precise';
  taskGoal: string;
  base: ComposeEvalMetrics | null;
  candidate: ComposeEvalMetrics | null;
  baseBeam: ComposeBeamMetrics | null;
  candidateBeam: ComposeBeamMetrics | null;
}): ComposePromotionDecision => {
  const priorityEligible = params.priority !== 'fast' || params.totPolicyActiveAllowFast;
  const goalEligible = String(params.taskGoal || '').trim().length >= params.totPolicyActiveMinGoalLength;
  const hasInputs = Boolean(params.base && params.candidate && params.baseBeam && params.candidateBeam);
  const shouldEvaluate = priorityEligible && goalEligible && hasInputs;
  if (!shouldEvaluate || !params.base || !params.candidate || !params.baseBeam || !params.candidateBeam) {
    return {
      shouldEvaluate: false,
      promote: false,
      promoteByTotPolicy: false,
      promoteByGotCutover: false,
      scoreGain: 0,
      beamGain: 0,
    };
  }

  const scoreGain = params.candidate.ormScore - params.base.ormScore;
  const beamGain = params.candidateBeam.score - params.baseBeam.score;
  const passGate = !params.totPolicyActiveRequireNonPass || params.base.ormVerdict !== 'pass';
  const promoteByTotPolicy = params.totPolicyActiveEnabled
    && passGate
    && scoreGain >= params.totPolicyActiveMinScoreGain
    && beamGain >= params.totPolicyActiveMinBeamGain;
  const promoteByGotCutover = params.gotCutoverAllowed
    && (params.candidate.ormScore / 100) >= params.gotMinSelectedScore
    && params.candidateBeam.score >= params.baseBeam.score;
  return {
    shouldEvaluate: true,
    promote: promoteByTotPolicy || promoteByGotCutover,
    promoteByTotPolicy,
    promoteByGotCutover,
    scoreGain,
    beamGain,
  };
};

export const buildTotCandidatePairTelemetryPayload = (params: {
  guildId: string;
  sessionId: string;
  strategy: string;
  base: ComposeEvalMetrics;
  candidate: ComposeEvalMetrics;
  baseBeam: ComposeBeamMetrics;
  candidateBeam: ComposeBeamMetrics;
  baselineResult: string;
  candidateResult: string;
  promoted: boolean;
  scoreGain: number;
  beamGain: number;
}) => {
  return {
    guildId: params.guildId,
    sessionId: params.sessionId,
    strategy: params.strategy,
    baselineScore: params.base.ormScore,
    candidateScore: params.candidate.ormScore,
    scoreGain: params.scoreGain,
    beamGain: params.beamGain,
    promoted: params.promoted,
    baselineProbability: params.baseBeam.probability,
    baselineProbabilitySource: params.baseBeam.probabilitySource,
    baselineCorrectness: params.baseBeam.correctness,
    baselineBeamScore: params.baseBeam.score,
    candidateProbability: params.candidateBeam.probability,
    candidateProbabilitySource: params.candidateBeam.probabilitySource,
    candidateCorrectness: params.candidateBeam.correctness,
    candidateBeamScore: params.candidateBeam.score,
    baselineEvidenceBundleId: params.base.evidenceBundleId,
    candidateEvidenceBundleId: params.candidate.evidenceBundleId,
    baselineResult: params.baselineResult,
    candidateResult: params.candidateResult,
  };
};