/**
 * Extracted reasoning strategy helpers from multiAgentService.ts
 *
 * Contains: complexity estimation, self-consistency, ToT shadow, self-refine,
 * least-to-most decomposition, beam evaluation, and ORM finalization.
 */
import {
  AGENT_SESSION_TIMEOUT_MS as CFG_AGENT_SESSION_TIMEOUT_MS,
  AGENT_STEP_TIMEOUT_MS as CFG_AGENT_STEP_TIMEOUT_MS,
  FINAL_SELF_CONSISTENCY_ENABLED,
  FINAL_SELF_CONSISTENCY_SAMPLES,
  LEAST_TO_MOST_ENABLED,
  LEAST_TO_MOST_MAX_SUBGOALS,
  LEAST_TO_MOST_MIN_GOAL_LENGTH,
  SELF_REFINE_LITE_ENABLED,
  SELF_REFINE_LITE_MAX_PASSES,
  SELF_REFINE_LITE_REQUIRE_ACTIONABLE,
  SELF_REFINE_LITE_MIN_SCORE_GAIN,
  ORM_RULE_PASS_THRESHOLD as CFG_ORM_RULE_PASS_THRESHOLD,
  ORM_RULE_REVIEW_THRESHOLD as CFG_ORM_RULE_REVIEW_THRESHOLD,
  TOT_SELF_EVAL_ENABLED,
  TOT_SELF_EVAL_TEMPERATURE,
  TOT_PROVIDER_LOGPROB_ENABLED,
  AGENT_DYNAMIC_REASONING_BUDGET_ENABLED,
  AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH,
  AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH,
} from '../config';
import logger from '../logger';
import { TtlCache } from '../utils/ttlCache';
import { generateText, generateTextWithMeta } from './llmClient';
import { executeSkill } from './skills/engine';
import type { SkillExecutionResult } from './skills/types';
import { ensureSessionBudget, getErrorMessage, withTimeout } from './langgraph/runtimeSupport/runtimeBudget';
import { formatCitationFirstResult } from './langgraph/runtimeSupport/runtimeFormatting';
import {
  assessRuleBasedOrm,
  clamp01,
  evaluateTaskResultCandidate,
  extractActionableFeedbackPoints,
  parseSelfEvaluationJson,
} from './langgraph/runtimeSupport/runtimeEvaluation';
import {
  ensureShadowGraph,
  touch,
  traceShadowNode,
} from './langgraph/runtimeSupport/runtimeSessionState';
import { enqueueTelemetryTask } from './agent/agentTelemetryQueue';
import { getTotReplayCandidates, type AgentTotPolicySnapshot } from './agent/agentTotPolicyService';
import { resolveGotBudgetForPriority, type AgentGotPolicySnapshot } from './agent/agentGotPolicyService';
import type { AgentPriority } from './agent/agentRuntimeTypes';
import type { AgentSession, AgentStep, BeamEvaluation } from './multiAgentTypes';

// ── Config constants (sourced from ../config) ──────────────────────────────
export const AGENT_SESSION_TIMEOUT_MS = CFG_AGENT_SESSION_TIMEOUT_MS;
export const AGENT_STEP_TIMEOUT_MS = CFG_AGENT_STEP_TIMEOUT_MS;
export const ORM_RULE_PASS_THRESHOLD = CFG_ORM_RULE_PASS_THRESHOLD;
export const ORM_RULE_REVIEW_THRESHOLD = CFG_ORM_RULE_REVIEW_THRESHOLD;

export const GOT_SHADOW_RECORD_TASK = 'got_shadow_record';
export const TOT_CANDIDATE_PAIR_RECORD_TASK = 'tot_candidate_pair_record';

// ── Complexity history (per-guild adaptive reasoning budget) ────────────────
type ComplexityRecord = { stepCount: number; traceLength: number };
const complexityHistory = new TtlCache<ComplexityRecord[]>(200);
const COMPLEXITY_HISTORY_TTL_MS = 300_000;
const COMPLEXITY_HISTORY_MAX_PER_GUILD = 10;

export const recordComplexityMetric = (session: AgentSession): void => {
  const key = session.guildId;
  if (!key) return;
  const traceLength = session.shadowGraph?.trace?.length || 0;
  const existing = complexityHistory.get(key) || [];
  existing.unshift({ stepCount: session.steps.length, traceLength });
  complexityHistory.set(key, existing.slice(0, COMPLEXITY_HISTORY_MAX_PER_GUILD), COMPLEXITY_HISTORY_TTL_MS);
};

// ── Telemetry helper ────────────────────────────────────────────────────────
export const enqueueBestEffortTelemetry = (params: {
  name: string;
  taskType: string;
  payload: Record<string, unknown>;
  guildId?: string;
}): void => {
  const accepted = enqueueTelemetryTask({
    name: params.name,
    taskType: params.taskType,
    payload: params.payload,
    guildId: params.guildId,
  });
  if (!accepted) {
    logger.warn('[AGENT] telemetry queue saturated; dropped task=%s guild=%s', params.name, params.guildId || '');
  }
};

// ── Reasoning complexity estimation ─────────────────────────────────────────
export type ReasoningComplexity = 'low' | 'medium' | 'high';

export const estimateReasoningComplexity = (taskGoal: string, priority: AgentPriority, guildId?: string): ReasoningComplexity => {
  const text = String(taskGoal || '').trim();
  if (!AGENT_DYNAMIC_REASONING_BUDGET_ENABLED) {
    return priority === 'precise' ? 'high' : priority === 'fast' ? 'low' : 'medium';
  }

  const length = text.length;
  const hardKeywords = /(설계|아키텍처|migration|마이그레이션|cutover|rollout|benchmark|성능|지연|보안|privacy|policy|gate|리스크)/i;
  const lowKeywords = /(요약|짧게|한줄|간단|quick|빠르게)/i;

  let historicalBump: ReasoningComplexity | null = null;
  if (guildId) {
    const history = complexityHistory.get(guildId);
    if (history && history.length >= 2) {
      const avgSteps = history.reduce((sum, r) => sum + r.stepCount, 0) / history.length;
      if (avgSteps >= 4) historicalBump = 'high';
      else if (avgSteps >= 2.5) historicalBump = 'medium';
    }
  }

  if (priority === 'precise' || hardKeywords.test(text) || length >= AGENT_DYNAMIC_REASONING_HIGH_GOAL_LENGTH) {
    return 'high';
  }
  if (priority === 'fast' || lowKeywords.test(text) || length < AGENT_DYNAMIC_REASONING_LOW_GOAL_LENGTH) {
    return historicalBump === 'high' ? 'medium' : 'low';
  }
  return historicalBump === 'high' ? 'high' : 'medium';
};

// ── Self-consistency samples ────────────────────────────────────────────────
export const resolveFinalSelfConsistencySamples = (session: AgentSession, taskGoal: string): number => {
  if (!FINAL_SELF_CONSISTENCY_ENABLED) {
    return 1;
  }
  const complexity = estimateReasoningComplexity(taskGoal, session.priority, session.guildId);
  if (complexity === 'low') {
    return 1;
  }
  if (complexity === 'medium') {
    return Math.min(FINAL_SELF_CONSISTENCY_SAMPLES, 2);
  }
  return FINAL_SELF_CONSISTENCY_SAMPLES;
};

// ── ToT shadow budget ───────────────────────────────────────────────────────
export const resolveTotShadowBudget = (params: {
  session: AgentSession;
  taskGoal: string;
  policy: AgentTotPolicySnapshot;
}): {
  maxBranches: number;
  replayTopK: number;
  localSearchMutations: number;
} => {
  const complexity = estimateReasoningComplexity(params.taskGoal, params.session.priority, params.session.guildId);
  if (complexity === 'low') {
    return {
      maxBranches: Math.min(params.policy.maxBranches, 1),
      replayTopK: 0,
      localSearchMutations: 0,
    };
  }
  if (complexity === 'medium') {
    return {
      maxBranches: Math.min(params.policy.maxBranches, 2),
      replayTopK: Math.min(params.policy.replayTopK, 1),
      localSearchMutations: Math.min(params.policy.localSearchMutations, 1),
    };
  }
  return {
    maxBranches: params.policy.maxBranches,
    replayTopK: params.policy.replayTopK,
    localSearchMutations: params.policy.localSearchMutations,
  };
};

// ── LLM subgoal parser ──────────────────────────────────────────────────────
export const parseSubgoalsFromLlm = (raw: string): string[] => {
  const text = String(raw || '');
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      const rows = Array.isArray(parsed.subgoals) ? parsed.subgoals : [];
      const normalized = rows
        .map((row) => String(row || '').trim())
        .filter((row) => row.length >= 4)
        .slice(0, LEAST_TO_MOST_MAX_SUBGOALS);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch (err) {
      logger.debug('[REASONING] subgoal JSON parse fallback: %s', err instanceof Error ? err.message : String(err));
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d).\s]+/, '').trim())
    .filter((line) => line.length >= 4)
    .slice(0, LEAST_TO_MOST_MAX_SUBGOALS);
};

// ── Self-guided beam evaluation (ToT) ───────────────────────────────────────
export const evaluateSelfGuidedBeam = async (params: {
  session: AgentSession;
  taskGoal: string;
  candidate: string;
  ormScore: number;
}): Promise<BeamEvaluation> => {
  if (!TOT_SELF_EVAL_ENABLED) {
    const fallbackCorrectness = clamp01(params.ormScore / 100, 0.55);
    return {
      probability: 0.55,
      correctness: fallbackCorrectness,
      score: 0.55 * fallbackCorrectness,
      probabilitySource: 'fallback',
    };
  }

  try {
    const generated = await generateTextWithMeta({
      system: [
        '너는 추론 후보의 Self-Evaluation 스코어러다.',
        'probability: 현재 상태에서 이 후보가 자연스럽고 일관되게 생성될 가능성(0~1).',
        'correctness: 최종 정답/정합한 실행안으로 이어질 가능성(0~1).',
        '출력은 반드시 JSON 한 줄만 허용한다.',
      ].join('\n'),
      user: [
        `목표: ${params.taskGoal}`,
        `후보: ${String(params.candidate || '').slice(0, 1800)}`,
        '출력 형식: {"probability":0.00,"correctness":0.00}',
      ].join('\n'),
      actionName: 'tot.self_eval',
      temperature: TOT_SELF_EVAL_TEMPERATURE,
      maxTokens: 120,
      includeLogprobs: TOT_PROVIDER_LOGPROB_ENABLED,
    });
    const raw = generated.text;

    const parsed = parseSelfEvaluationJson(raw);
    if (parsed) {
      const providerProb = generated.avgLogprob !== undefined
        ? clamp01(Math.exp(generated.avgLogprob), parsed.probability)
        : null;
      const probability = providerProb ?? parsed.probability;
      return {
        probability,
        correctness: parsed.correctness,
        score: probability * parsed.correctness,
        probabilitySource: providerProb !== null ? 'provider_logprob' : 'self_eval',
      };
    }
  } catch (err) {
    logger.debug('[REASONING] ORM eval fallback: %s', err instanceof Error ? err.message : String(err));
  }

  const fallbackCorrectness = clamp01(params.ormScore / 100, 0.55);
  return {
    probability: 0.55,
    correctness: fallbackCorrectness,
    score: 0.55 * fallbackCorrectness,
    probabilitySource: 'fallback',
  };
};

// ── Self-refine lite ────────────────────────────────────────────────────────
export const runSelfRefineLite = async (params: {
  session: AgentSession;
  taskGoal: string;
  currentDraft: string;
  sessionStartedAtMs: number;
  traceLabel: string;
}): Promise<string> => {
  if (!SELF_REFINE_LITE_ENABLED || SELF_REFINE_LITE_MAX_PASSES <= 0) {
    return params.currentDraft;
  }

  let draft = String(params.currentDraft || '').trim();
  if (!draft) {
    return draft;
  }

  for (let pass = 0; pass < SELF_REFINE_LITE_MAX_PASSES; pass += 1) {
    ensureSessionBudget(params.sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
    if (params.session.cancelRequested) {
      throw new Error('SESSION_CANCELLED');
    }

    try {
      const critique = await withTimeout(executeSkill('ops-critique', {
        guildId: params.session.guildId,
        requestedBy: params.session.requestedBy,
        goal: [
          '역할: 품질 검토기',
          `목표: ${params.taskGoal}`,
          `현재 초안: ${draft}`,
          '출력: 치명적 오류/모호성/근거 누락 위주로 3개 이하 보완 포인트만 간결히 제시',
        ].join('\n'),
        memoryHints: params.session.memoryHints,
        priorOutput: draft,
      }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:self_refine_critique');

      const critiqueText = String(critique.output || '').trim();
      if (!critiqueText) {
        continue;
      }

      const actionablePoints = extractActionableFeedbackPoints(critiqueText);
      if (SELF_REFINE_LITE_REQUIRE_ACTIONABLE && actionablePoints.length === 0) {
        traceShadowNode(params.session, 'compose_response', `${params.traceLabel}:self_refine_skip_non_actionable`);
        continue;
      }

      const baseScore = evaluateTaskResultCandidate({
        session: params.session,
        taskGoal: params.taskGoal,
        rawResult: draft,
        passThreshold: ORM_RULE_PASS_THRESHOLD,
        reviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
      }).orm.score;

      const rewrite = await withTimeout(executeSkill('ops-execution', {
        guildId: params.session.guildId,
        requestedBy: params.session.requestedBy,
        goal: [
          '역할: self-refine 재작성기',
          `목표: ${params.taskGoal}`,
          `기존 초안: ${draft}`,
          `보완 지시:\n${actionablePoints.join('\n') || critiqueText}`,
          '규칙: 중간 과정/디버그 마커 금지, 최종 전달물만 작성',
        ].join('\n'),
        memoryHints: params.session.memoryHints,
        priorOutput: critiqueText,
      }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:self_refine_rewrite');

      const refined = String(rewrite.output || '').trim();
      if (refined) {
        const refinedScore = evaluateTaskResultCandidate({
          session: params.session,
          taskGoal: params.taskGoal,
          rawResult: refined,
          passThreshold: ORM_RULE_PASS_THRESHOLD,
          reviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
        }).orm.score;
        const gain = refinedScore - baseScore;
        if (gain >= SELF_REFINE_LITE_MIN_SCORE_GAIN) {
          draft = refined;
          traceShadowNode(params.session, 'compose_response', `${params.traceLabel}:self_refine_accept_gain=${gain}`);
        } else {
          traceShadowNode(params.session, 'compose_response', `${params.traceLabel}:self_refine_reject_gain=${gain}`);
        }
      }
    } catch (error) {
      traceShadowNode(params.session, 'compose_response', `${params.traceLabel}:self_refine_fallback:${getErrorMessage(error)}`);
      return draft;
    }
  }

  traceShadowNode(params.session, 'compose_response', `${params.traceLabel}:self_refine_passes=${SELF_REFINE_LITE_MAX_PASSES}`);
  return draft;
};

// ── Tree-of-Thought shadow exploration ──────────────────────────────────────
export const runToTShadowExploration = async (params: {
  session: AgentSession;
  policy: AgentTotPolicySnapshot;
  gotPolicy: AgentGotPolicySnapshot;
  taskGoal: string;
  plan: string;
  executionDraft: string;
  critique: string;
  sessionStartedAtMs: number;
}): Promise<{
  rawResult: string;
  score: number;
  beamProbability: number;
  beamCorrectness: number;
  beamScore: number;
  beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
  evidenceBundleId: string;
} | null> => {
  const clampRange = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const buildBranchSamplingProfile = (angle: string, branchIndex: number, totalBranches: number): {
    temperature: number;
    topP: number;
    maxTokens: number;
  } => {
    const defaultTemp = 0.22;
    const defaultTopP = 0.9;
    if (!policy.adaptiveSamplingEnabled) {
      return {
        temperature: defaultTemp,
        topP: defaultTopP,
        maxTokens: 1000,
      };
    }

    const lower = String(angle || '').toLowerCase();
    const riskOrEvidence = /(리스크|보수|증거|안정)/.test(lower);
    const speedOrCost = /(속도|비용|장애 대응)/.test(lower);
    const branchPos = totalBranches > 1 ? branchIndex / (totalBranches - 1) : 0.5;

    let temperature = riskOrEvidence
      ? policy.samplingTempMin
      : speedOrCost
        ? policy.samplingTempMax
        : (policy.samplingTempMin + policy.samplingTempMax) / 2;
    temperature = clampRange(
      temperature + (branchPos - 0.5) * 0.08,
      policy.samplingTempMin,
      policy.samplingTempMax,
    );

    let topP = riskOrEvidence
      ? policy.samplingTopPMin
      : speedOrCost
        ? policy.samplingTopPMax
        : (policy.samplingTopPMin + policy.samplingTopPMax) / 2;
    topP = clampRange(
      topP + (branchPos - 0.5) * 0.06,
      policy.samplingTopPMin,
      policy.samplingTopPMax,
    );

    return {
      temperature,
      topP,
      maxTokens: 1000,
    };
  };

  const { session, policy, taskGoal, plan, executionDraft, critique, sessionStartedAtMs } = params;
  if (!policy.shadowEnabled) {
    session.totShadowAssessment = {
      enabled: false,
      exploredBranches: 0,
      keptCandidates: 0,
      bestScore: 0,
      bestEvidenceBundleId: '',
      strategy: policy.strategy,
    };
    return null;
  }

  const defaultBranchAngles = policy.strategy === 'dfs'
    ? [
      '리스크 최소화 관점',
      '실행 속도 최적화 관점',
      '운영 안정성 관점',
      '증거 보수성 관점',
      '장애 대응 우선 관점',
      '비용 최적화 관점',
    ]
    : [
      '증거 보수성 관점',
      '운영 안정성 관점',
      '리스크 최소화 관점',
      '실행 속도 최적화 관점',
      '비용 최적화 관점',
      '장애 대응 우선 관점',
    ];
  const branchAngles = policy.branchAngles.length > 0 ? policy.branchAngles : defaultBranchAngles;
  const dynamicBudget = resolveTotShadowBudget({ session, taskGoal, policy });
  const selectedAngles = branchAngles.slice(0, dynamicBudget.maxBranches);
  const replaySeeds = policy.replayEnabled && dynamicBudget.replayTopK > 0
    ? await getTotReplayCandidates({ guildId: session.guildId, topK: dynamicBudget.replayTopK })
    : [];
  const scored: Array<{
    nodeKey: string;
    nodeType: 'hypothesis' | 'patch';
    parentNodeKey: string;
    depth: number;
    metadata?: Record<string, unknown>;
    rawResult: string;
    score: number;
    beamProbability: number;
    beamCorrectness: number;
    beamScore: number;
    beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
    evidenceBundleId: string;
  }> = [];

  const pushScoredCandidate = async (
    output: string,
    meta: {
      nodeKey: string;
      nodeType: 'hypothesis' | 'patch';
      parentNodeKey: string;
      depth: number;
      metadata?: Record<string, unknown>;
    },
  ) => {
    const trimmed = String(output || '').trim();
    if (!trimmed) {
      return;
    }
    const formatted = formatCitationFirstResult(trimmed, session);
    const orm = assessRuleBasedOrm({
      session,
      taskGoal,
      rawResult: trimmed,
      formattedResult: formatted,
      passThreshold: ORM_RULE_PASS_THRESHOLD,
      reviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
    });
    const beam = await evaluateSelfGuidedBeam({
      session,
      taskGoal,
      candidate: trimmed,
      ormScore: orm.score,
    });
    scored.push({
      nodeKey: meta.nodeKey,
      nodeType: meta.nodeType,
      parentNodeKey: meta.parentNodeKey,
      depth: meta.depth,
      metadata: meta.metadata,
      rawResult: trimmed,
      score: orm.score,
      beamProbability: beam.probability,
      beamCorrectness: beam.correctness,
      beamScore: beam.score,
      beamProbabilitySource: beam.probabilitySource,
      evidenceBundleId: orm.evidenceBundleId,
    });
  };

  for (let index = 0; index < selectedAngles.length; index += 1) {
    ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
    if (session.cancelRequested) {
      throw new Error('SESSION_CANCELLED');
    }

    try {
      const angle = selectedAngles[index];
      const sampling = buildBranchSamplingProfile(angle, index, selectedAngles.length);
      const candidate = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
        actionName: 'tot.shadow.branch',
        goal: [
          `역할: Tree-of-Thought shadow branch ${index + 1}/${selectedAngles.length}`,
          `탐색 관점: ${angle}`,
          `목표: ${taskGoal}`,
          `계획 참고: ${plan}`,
          `기존 실행초안 참고: ${executionDraft}`,
          `검토 참고: ${critique}`,
          '출력: 최종 전달 가능한 단일 결과안만 작성',
        ].join('\n'),
        memoryHints: session.memoryHints,
        priorOutput: critique,
        generationOptions: {
          temperature: sampling.temperature,
          topP: sampling.topP,
          maxTokens: sampling.maxTokens,
        },
      }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:tot_shadow_branch');

      const output = String(candidate.output || '').trim();
      const branchNodeKey = `branch_${index + 1}`;
      await pushScoredCandidate(output, {
        nodeKey: branchNodeKey,
        nodeType: 'hypothesis',
        parentNodeKey: 'root',
        depth: 1,
        metadata: {
          kind: 'branch',
          angle,
          branchIndex: index + 1,
        },
      });

      if (policy.localSearchEnabled && dynamicBudget.localSearchMutations > 0 && output) {
        const operators = ['근거 강화', '리스크 선제 완화', '실행 단계 단순화'];
        for (let mutateIndex = 0; mutateIndex < dynamicBudget.localSearchMutations; mutateIndex += 1) {
          const operator = operators[mutateIndex % operators.length];
          const mutated = await withTimeout(executeSkill('ops-execution', {
            guildId: session.guildId,
            requestedBy: session.requestedBy,
            actionName: 'tot.shadow.local_search',
            goal: [
              `역할: ToT local-search mutation ${mutateIndex + 1}/${dynamicBudget.localSearchMutations}`,
              `변형 연산자: ${operator}`,
              `목표: ${taskGoal}`,
              `기준 후보: ${output}`,
              '출력: 기존 강점을 유지하며 변형된 최종 전달안 1개만 작성',
            ].join('\n'),
            memoryHints: session.memoryHints,
            priorOutput: output,
            generationOptions: {
              temperature: clampRange(sampling.temperature + 0.05, policy.samplingTempMin, policy.samplingTempMax),
              topP: clampRange(sampling.topP, policy.samplingTopPMin, policy.samplingTopPMax),
              maxTokens: sampling.maxTokens,
            },
          }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:tot_shadow_local_search');

          await pushScoredCandidate(String(mutated.output || '').trim(), {
            nodeKey: `${branchNodeKey}_mut_${mutateIndex + 1}`,
            nodeType: 'patch',
            parentNodeKey: branchNodeKey,
            depth: 2,
            metadata: {
              kind: 'mutation',
              operator,
              branchIndex: index + 1,
              mutateIndex: mutateIndex + 1,
            },
          });
        }
      }
    } catch (err) {
      logger.debug('[REASONING] shadow mutation failed: %s', err instanceof Error ? err.message : String(err));
    }
  }

  for (let replayIndex = 0; replayIndex < replaySeeds.length; replayIndex += 1) {
    ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
    if (session.cancelRequested) {
      throw new Error('SESSION_CANCELLED');
    }
    try {
      const replaySeed = replaySeeds[replayIndex];
      const replaySampling = buildBranchSamplingProfile('replay_branch', replayIndex, Math.max(1, replaySeeds.length));
      const replayCandidate = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
        actionName: 'tot.shadow.replay',
        goal: [
          `역할: ToT replay branch ${replayIndex + 1}/${replaySeeds.length}`,
          `목표: ${taskGoal}`,
          `과거 고보상 경로: ${replaySeed}`,
          '지시: 과거 경로를 복사하지 말고 현재 목표/제약에 맞게 재조합하여 최종 전달안 1개 작성',
        ].join('\n'),
        memoryHints: session.memoryHints,
        priorOutput: critique,
        generationOptions: {
          temperature: replaySampling.temperature,
          topP: replaySampling.topP,
          maxTokens: replaySampling.maxTokens,
        },
      }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:tot_shadow_replay');
      await pushScoredCandidate(String(replayCandidate.output || '').trim(), {
        nodeKey: `replay_${replayIndex + 1}`,
        nodeType: 'hypothesis',
        parentNodeKey: 'root',
        depth: 1,
        metadata: {
          kind: 'replay',
          replayIndex: replayIndex + 1,
        },
      });
    } catch (err) {
      logger.debug('[REASONING] replay branch failed: %s', err instanceof Error ? err.message : String(err));
    }
  }

  const ranked = [...scored].sort((a, b) => {
    if (b.beamScore !== a.beamScore) {
      return b.beamScore - a.beamScore;
    }
    return b.score - a.score;
  });
  const kept = ranked.slice(0, policy.keepTop);
  const best = kept[0];

  session.totShadowAssessment = {
    enabled: true,
    exploredBranches: selectedAngles.length + replaySeeds.length,
    keptCandidates: kept.length,
    bestScore: best?.score || 0,
    bestEvidenceBundleId: best?.evidenceBundleId || '',
    strategy: policy.strategy,
  };

  traceShadowNode(
    session,
    'execute_actions',
    `tot_shadow:strategy=${policy.strategy},branches=${selectedAngles.length},replay=${replaySeeds.length},candidates=${scored.length},best_orm=${best?.score || 0},best_beam=${(best?.beamScore || 0).toFixed(4)}`,
  );

  if (params.gotPolicy.shadowEnabled && scored.length > 0) {
    const budget = resolveGotBudgetForPriority(session.priority, params.gotPolicy);
    const selected = best ? scored.find((candidate) => candidate.nodeKey === best.nodeKey) : undefined;
    enqueueBestEffortTelemetry({
      name: 'got_shadow_record',
      taskType: GOT_SHADOW_RECORD_TASK,
      guildId: session.guildId,
      payload: {
        guildId: session.guildId,
        sessionId: session.id,
        rootGoal: taskGoal,
        strategy: params.gotPolicy.strategy,
        maxNodes: budget.maxNodes,
        maxEdges: budget.maxEdges,
        candidates: scored.map((candidate) => ({
          nodeKey: candidate.nodeKey,
          nodeType: candidate.nodeType,
          content: candidate.rawResult,
          parentNodeKey: candidate.parentNodeKey,
          depth: candidate.depth,
          score: clamp01(candidate.score / 100, 0.5),
          confidence: clamp01(candidate.beamProbability, 0.5),
          novelty: null,
          risk: clamp01(1 - candidate.beamCorrectness, 0.5),
          grounded: candidate.score >= ORM_RULE_PASS_THRESHOLD,
          blocked: false,
          scoreSource: candidate.beamProbabilitySource === 'fallback' ? 'rule' : candidate.beamProbabilitySource,
          metadata: {
            ...candidate.metadata,
            ormScore: candidate.score,
            beamScore: candidate.beamScore,
          },
        })),
        selectedNodeKey: selected?.nodeKey,
        selectedScore: selected ? clamp01(selected.score / 100, 0.5) : undefined,
        selectionReason: selected ? 'tot_shadow_best_candidate' : 'tot_shadow_no_selection',
      },
    });
  }

  return best
    ? {
      rawResult: best.rawResult,
      score: best.score,
      beamProbability: best.beamProbability,
      beamCorrectness: best.beamCorrectness,
      beamScore: best.beamScore,
      beamProbabilitySource: best.beamProbabilitySource,
      evidenceBundleId: best.evidenceBundleId,
    }
    : null;
};

// ── ORM finalize ────────────────────────────────────────────────────────────
export const finalizeTaskResult = (params: {
  session: AgentSession;
  taskGoal: string;
  rawResult: string;
  traceLabel?: string;
}): string => {
  const { session, taskGoal, rawResult } = params;
  const { formatted, orm } = evaluateTaskResultCandidate({
    session,
    taskGoal,
    rawResult,
    passThreshold: ORM_RULE_PASS_THRESHOLD,
    reviewThreshold: ORM_RULE_REVIEW_THRESHOLD,
  });
  session.ormAssessment = orm;
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    outcomes: [
      ...ensureShadowGraph(session).outcomes,
      {
        state: orm.verdict === 'pass' ? 'success' : orm.verdict === 'review' ? 'degraded' : 'failure',
        code: `ORM_RULE_${orm.verdict.toUpperCase()}`,
        summary: `rule_score=${orm.score};evidence_bundle_id=${orm.evidenceBundleId};reasons=${orm.reasons.join(',') || 'none'}`,
        retryable: orm.verdict !== 'pass',
        confidence: orm.verdict === 'pass' ? 'high' : orm.verdict === 'review' ? 'medium' : 'low',
      },
    ],
  };
  traceShadowNode(
    session,
    'compose_response',
    `${params.traceLabel || 'result'}:orm_score=${orm.score},verdict=${orm.verdict},evidence=${orm.evidenceBundleId}`,
  );
  return formatted;
};

// ── Least-to-Most decomposition ─────────────────────────────────────────────
export const decomposeGoalLeastToMost = async (params: {
  taskGoal: string;
  priority: AgentPriority;
}): Promise<string[]> => {
  if (!LEAST_TO_MOST_ENABLED) {
    return [];
  }
  const goal = String(params.taskGoal || '').trim();
  if (goal.length < LEAST_TO_MOST_MIN_GOAL_LENGTH) {
    return [];
  }

  try {
    const raw = await generateText({
      system: [
        '너는 Least-to-Most 문제 분해기다.',
        '복잡한 목표를 실행 순서의 하위목표로 분해한다.',
        '출력은 반드시 JSON 한 줄만 허용한다.',
      ].join('\n'),
      user: [
        `우선순위: ${params.priority}`,
        `목표: ${goal}`,
        `출력 형식: {"subgoals":["...","..."]}`,
        `제약: 하위목표는 ${LEAST_TO_MOST_MAX_SUBGOALS}개 이하, 각 항목은 실행 가능한 짧은 문장`,
      ].join('\n'),
      actionName: 'ltm.decompose',
      temperature: 0,
      maxTokens: 260,
    });

    const subgoals = parseSubgoalsFromLlm(raw);
    if (subgoals.length >= 2) {
      return subgoals;
    }
  } catch (err) {
    logger.debug('[REASONING] least-to-most decomposition failed: %s', err instanceof Error ? err.message : String(err));
  }

  return [];
};

// ── Least-to-Most execution draft ───────────────────────────────────────────
const nowIso = () => new Date().toISOString();

export const runLeastToMostExecutionDraft = async (params: {
  session: AgentSession;
  step: AgentStep;
  taskGoal: string;
  plan: string;
  subgoals: string[];
  sessionStartedAtMs: number;
}): Promise<string> => {
  const { session, step, taskGoal, plan, subgoals, sessionStartedAtMs } = params;
  if (session.cancelRequested) {
    step.status = 'cancelled';
    step.startedAt = step.startedAt || nowIso();
    step.endedAt = nowIso();
    touch(session);
    throw new Error('SESSION_CANCELLED');
  }

  step.status = 'running';
  step.startedAt = nowIso();
  touch(session);

  try {
    const drafts: string[] = [];
    let prior: string | undefined = plan;

    for (let index = 0; index < subgoals.length; index += 1) {
      ensureSessionBudget(sessionStartedAtMs, AGENT_SESSION_TIMEOUT_MS);
      if (session.cancelRequested) {
        throw new Error('SESSION_CANCELLED');
      }

      const subgoal = subgoals[index];
      const result: SkillExecutionResult = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
        actionName: 'ltm.execute_subgoal',
        goal: [
          session.priority === 'precise' ? '우선순위: 정밀 (하위목표별 근거/가드레일 포함)' : '우선순위: 균형',
          '역할: 실행/리서치 에이전트',
          `상위목표: ${taskGoal}`,
          `현재 하위목표 (${index + 1}/${subgoals.length}): ${subgoal}`,
          `계획안: ${plan}`,
          `이전 하위결과: ${String(prior || '없음').slice(0, 700)}`,
          '출력: 해당 하위목표를 달성하는 실행 초안만 작성',
        ].join('\n'),
        memoryHints: session.memoryHints,
        priorOutput: prior,
      }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:researcher');

      const output: string = String(result.output || '').trim();
      if (output) {
        drafts.push(`- [${index + 1}] ${output}`);
        prior = output;
      }
    }

    const merged = drafts.join('\n');
    if (!merged.trim()) {
      throw new Error('LEAST_TO_MOST_EMPTY_DRAFT');
    }

    step.status = 'completed';
    step.endedAt = nowIso();
    step.output = merged;
    touch(session);
    return merged;
  } catch (error) {
    step.status = 'failed';
    step.endedAt = nowIso();
    step.error = getErrorMessage(error);
    touch(session);
    throw error;
  }
};
