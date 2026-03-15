import crypto from 'crypto';
import { buildAgentMemoryHints } from './agentMemoryService';
import { getAgentPolicySnapshot, primeAgentPolicyCache, validateAgentSessionRequest } from './agentPolicyService';
import { persistAgentSession } from './agentSessionStore';
import { generateText, generateTextWithMeta, isAnyLlmConfigured } from './llmClient';
import { executeSkill } from './skills/engine';
import { isSkillId, listSkills } from './skills/registry';
import type { SkillExecutionResult, SkillId } from './skills/types';
import { getWorkflowStepTemplates, primeWorkflowProfileCache } from './agentWorkflowService';
import { compilePromptGoal } from './promptCompiler';
import { appendTrace, createInitialLangGraphState, type LangGraphState } from './langgraph/stateContract';
import { getAgentPrivacyPolicySnapshot, primeAgentPrivacyPolicyCache } from './agentPrivacyPolicyService';
import { recordPrivacyGateSample } from './agentPrivacyTuningService';
import {
  getAgentTotPolicySnapshot,
  getTotReplayCandidates,
  maybeAutoTuneAgentTotPolicy,
  primeAgentTotPolicyCache,
  recordTotCandidatePair,
  type AgentTotPolicySnapshot,
} from './agentTotPolicyService';

export type AgentRole = 'planner' | 'researcher' | 'critic';
export type AgentPriority = 'fast' | 'balanced' | 'precise';
export type AgentSessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AgentIntent = 'task' | 'casual_chat' | 'uncertain';
export type AgentDeliberationMode = 'direct' | 'plan_act' | 'deliberate' | 'guarded';
export type AgentPolicyGateDecision = 'allow' | 'review' | 'block';

export type AgentStep = {
  id: string;
  role: AgentRole;
  title: string;
  status: AgentStepStatus;
  startedAt: string | null;
  endedAt: string | null;
  output: string | null;
  error: string | null;
};

export type AgentSession = {
  id: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  priority: AgentPriority;
  requestedSkillId: SkillId | null;
  routedIntent: AgentIntent;
  status: AgentSessionStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  result: string | null;
  error: string | null;
  cancelRequested: boolean;
  deliberationMode?: AgentDeliberationMode;
  riskScore?: number;
  policyGate?: {
    decision: AgentPolicyGateDecision;
    reasons: string[];
  };
  ormAssessment?: {
    score: number;
    verdict: 'pass' | 'review' | 'fail';
    reasons: string[];
    citationCount: number;
    evidenceBundleId: string;
  };
  totShadowAssessment?: {
    enabled: boolean;
    exploredBranches: number;
    keptCandidates: number;
    bestScore: number;
    bestEvidenceBundleId: string;
    strategy: 'bfs' | 'dfs';
    selectedByRouter?: boolean;
    scoreGainVsBaseline?: number;
  };
  memoryHints: string[];
  steps: AgentStep[];
  shadowGraph: LangGraphState | null;
};

export type AgentRuntimeSnapshot = {
  totalSessions: number;
  runningSessions: number;
  queuedSessions: number;
  completedSessions: number;
  failedSessions: number;
  cancelledSessions: number;
  deadletteredSessions: number;
  latestSessionAt: string | null;
};

export type AgentSessionShadowSummary = {
  traceLength: number;
  lastNode: string | null;
  intent: AgentIntent | null;
  hasError: boolean;
  elapsedMs: number | null;
  uniqueNodeCount: number;
  traceTail: Array<{
    node: string;
    at: string;
    note?: string;
  }>;
};

export type AgentSessionProgressSummary = {
  totalSteps: number;
  doneSteps: number;
  completedSteps: number;
  failedSteps: number;
  cancelledSteps: number;
  runningSteps: number;
  pendingSteps: number;
  progressPercent: number;
};

export type AgentSessionApiView = Omit<AgentSession, 'shadowGraph'> & {
  shadowGraphSummary: AgentSessionShadowSummary | null;
  progressSummary: AgentSessionProgressSummary;
  privacySummary: {
    deliberationMode: AgentDeliberationMode;
    riskScore: number;
    decision: AgentPolicyGateDecision;
    reasons: string[];
  };
  shadowGraph?: LangGraphState | null;
};

type AgentDeadletter = {
  sessionId: string;
  guildId: string;
  requestedBy: string;
  goal: string;
  reason: string;
  failedAt: string;
};

type BeamEvaluation = {
  probability: number;
  correctness: number;
  score: number;
  probabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
};

const MAX_SESSION_HISTORY = Math.max(50, Number(process.env.AGENT_MAX_SESSION_HISTORY || 300));
const AGENT_SESSION_TIMEOUT_MS = Math.max(20_000, Number(process.env.AGENT_SESSION_TIMEOUT_MS || 180_000));
const AGENT_STEP_TIMEOUT_MS = Math.max(5_000, Number(process.env.AGENT_STEP_TIMEOUT_MS || 75_000));
const AGENT_MEMORY_HINT_TIMEOUT_MS = Math.max(500, Number(process.env.AGENT_MEMORY_HINT_TIMEOUT_MS || 5_000));
const AGENT_QUEUE_POLL_MS = Math.max(100, Number(process.env.AGENT_QUEUE_POLL_MS || 250));
const AGENT_MAX_QUEUE_SIZE = Math.max(10, Number(process.env.AGENT_MAX_QUEUE_SIZE || 300));
const AGENT_SESSION_MAX_ATTEMPTS = Math.max(1, Number(process.env.AGENT_SESSION_MAX_ATTEMPTS || 2));
const AGENT_DEADLETTER_MAX = Math.max(10, Number(process.env.AGENT_DEADLETTER_MAX || 300));
const FINAL_SELF_CONSISTENCY_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.FINAL_SELF_CONSISTENCY_ENABLED || 'true').trim());
const FINAL_SELF_CONSISTENCY_SAMPLES = Math.max(1, Math.min(5, Number(process.env.FINAL_SELF_CONSISTENCY_SAMPLES || 3) || 3));
const LEAST_TO_MOST_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.LEAST_TO_MOST_ENABLED || 'true').trim());
const LEAST_TO_MOST_MAX_SUBGOALS = Math.max(2, Math.min(8, Number(process.env.LEAST_TO_MOST_MAX_SUBGOALS || 4) || 4));
const LEAST_TO_MOST_MIN_GOAL_LENGTH = Math.max(20, Number(process.env.LEAST_TO_MOST_MIN_GOAL_LENGTH || 40) || 40);
const SELF_REFINE_LITE_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.SELF_REFINE_LITE_ENABLED || 'true').trim());
const SELF_REFINE_LITE_MAX_PASSES = Math.max(1, Math.min(2, Number(process.env.SELF_REFINE_LITE_MAX_PASSES || 1) || 1));
const SELF_REFINE_LITE_REQUIRE_ACTIONABLE = !/^(0|false|off|no)$/i.test(String(process.env.SELF_REFINE_LITE_REQUIRE_ACTIONABLE || 'true').trim());
const SELF_REFINE_LITE_MIN_SCORE_GAIN = Math.max(0, Math.min(10, Number(process.env.SELF_REFINE_LITE_MIN_SCORE_GAIN || 1) || 1));
const ORM_RULE_PASS_THRESHOLD = Math.max(50, Math.min(95, Number(process.env.ORM_RULE_PASS_THRESHOLD || 75) || 75));
const ORM_RULE_REVIEW_THRESHOLD = Math.max(35, Math.min(90, Number(process.env.ORM_RULE_REVIEW_THRESHOLD || 55) || 55));
const TOT_SELF_EVAL_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.TOT_SELF_EVAL_ENABLED || 'true').trim());
const TOT_SELF_EVAL_TEMPERATURE = Math.max(0, Math.min(1, Number(process.env.TOT_SELF_EVAL_TEMPERATURE || 0.1) || 0.1));
const TOT_PROVIDER_LOGPROB_ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.TOT_PROVIDER_LOGPROB_ENABLED || 'true').trim());
const sessions = new Map<string, AgentSession>();
const pendingSessionQueue: string[] = [];
const runningSessionIds = new Set<string>();
const sessionAttempts = new Map<string, number>();
const deadletters: AgentDeadletter[] = [];
let queueDrainTimer: NodeJS.Timeout | null = null;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const ensureSessionBudget = (sessionStartedAtMs: number) => {
  if (Date.now() - sessionStartedAtMs > AGENT_SESSION_TIMEOUT_MS) {
    throw new Error('SESSION_TIMEOUT');
  }
};

const toPriority = (value?: string | null): AgentPriority => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fast' || normalized === '빠름') {
    return 'fast';
  }
  if (normalized === 'precise' || normalized === '정밀') {
    return 'precise';
  }
  return 'balanced';
};

const nowIso = () => new Date().toISOString();

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const extractMemoryCitations = (memoryHints: string[]): string[] => {
  const out: string[] = [];
  for (const hint of memoryHints) {
    const line = String(hint || '');
    const matches = line.match(/\[memory:([^\]\s]+)/g) || [];
    for (const match of matches) {
      const id = match.replace('[memory:', '').replace(']', '').trim();
      if (!id) continue;
      if (!out.includes(id)) {
        out.push(id);
      }
      if (out.length >= 6) {
        return out;
      }
    }
  }
  return out;
};

const toConfidenceLabel = (priority: AgentPriority, citationCount: number): string => {
  if (citationCount >= 2 && priority === 'precise') {
    return 'high';
  }
  if (citationCount >= 1) {
    return 'medium';
  }
  return 'low';
};

const SECTION_LABEL_ONLY_PATTERN = /^(?:#+\s*)?(?:deliverable|verification|confidence)\s*:?$/i;
const DEBUG_LINE_PATTERN = /^(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/;

const sanitizeDeliverableText = (raw: string): string => {
  return String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !SECTION_LABEL_ONLY_PATTERN.test(line))
    .filter((line) => !DEBUG_LINE_PATTERN.test(line))
    .map((line) => line.replace(/^#+\s*(deliverable|verification|confidence)\s*:?\s*/i, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const toConclusion = (raw: string): string => {
  const compact = sanitizeDeliverableText(raw);
  if (!compact) {
    return '현재 시점에서 확정할 수 있는 결론을 생성하지 못했습니다.';
  }
  return compact.slice(0, 280);
};

const shortHash = (value: string): string => {
  const digest = crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  return digest.slice(0, 16);
};

const hasDebugLeak = (value: string): boolean => {
  const text = String(value || '');
  return /(요청 결과|액션:|검증:|재시도 횟수:|소요시간\(ms\):|상태:)/.test(text);
};

const hasBrokenTextPattern = (value: string): boolean => {
  const text = String(value || '');
  if (text.includes('�')) {
    return true;
  }
  return /\b[a-f0-9]{40,}\b/i.test(text);
};

const buildEvidenceBundleId = (taskGoal: string, citations: string[]): string => {
  const normalizedGoal = String(taskGoal || '').trim().toLowerCase();
  const normalizedCitations = [...citations].map((id) => String(id || '').trim().toLowerCase()).sort();
  return shortHash(`${normalizedGoal}|${normalizedCitations.join('|')}`);
};

const toTokenSet = (value: string): Set<string> => {
  const tokens = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return new Set(tokens);
};

const jaccardSimilarity = (a: string, b: string): number => {
  const setA = toTokenSet(a);
  const setB = toTokenSet(b);
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const selectConsensusText = (candidates: string[]): string => {
  const normalized = candidates
    .map((candidate) => sanitizeDeliverableText(candidate))
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (normalized.length <= 1) {
    return normalized[0] || candidates[0] || '';
  }

  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < normalized.length; i += 1) {
    let score = 0;
    for (let j = 0; j < normalized.length; j += 1) {
      if (i === j) continue;
      score += jaccardSimilarity(normalized[i], normalized[j]);
    }
    score = score / Math.max(1, normalized.length - 1);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return normalized[bestIndex];
};

const parseSubgoalsFromLlm = (raw: string): string[] => {
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
    } catch {
      // Fallback parsing below.
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d).\s]+/, '').trim())
    .filter((line) => line.length >= 4)
    .slice(0, LEAST_TO_MOST_MAX_SUBGOALS);
};

const assessRuleBasedOrm = (params: {
  session: AgentSession;
  taskGoal: string;
  rawResult: string;
  formattedResult: string;
}): {
  score: number;
  verdict: 'pass' | 'review' | 'fail';
  reasons: string[];
  citationCount: number;
  evidenceBundleId: string;
} => {
  const citations = extractMemoryCitations(params.session.memoryHints);
  const deliverable = sanitizeDeliverableText(params.rawResult);
  const reasons: string[] = [];
  let score = 100;

  if (citations.length === 0) {
    score -= params.session.priority === 'precise' ? 20 : 10;
    reasons.push('missing_memory_citation');
  }

  if (deliverable.length < 80) {
    score -= 12;
    reasons.push('deliverable_too_short');
  }

  if (hasDebugLeak(params.rawResult) || hasDebugLeak(params.formattedResult)) {
    score -= 15;
    reasons.push('debug_marker_leak');
  }

  if (hasBrokenTextPattern(params.rawResult) || hasBrokenTextPattern(params.formattedResult)) {
    score -= 10;
    reasons.push('text_integrity_warning');
  }

  const failedSteps = params.session.steps.filter((step) => step.status === 'failed').length;
  if (failedSteps > 0) {
    score -= Math.min(20, failedSteps * 6);
    reasons.push('step_failure_history');
  }

  if (/근거 부족/.test(params.formattedResult)) {
    score -= 8;
    reasons.push('verification_insufficient');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: 'pass' | 'review' | 'fail' = score >= ORM_RULE_PASS_THRESHOLD
    ? 'pass'
    : score >= ORM_RULE_REVIEW_THRESHOLD
      ? 'review'
      : 'fail';

  return {
    score,
    verdict,
    reasons,
    citationCount: citations.length,
    evidenceBundleId: buildEvidenceBundleId(params.taskGoal, citations),
  };
};

const clamp01 = (value: unknown, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, n));
};

const parseSelfEvaluationJson = (raw: string): { probability: number; correctness: number } | null => {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    return {
      probability: clamp01(parsed.probability, 0.55),
      correctness: clamp01(parsed.correctness, 0.55),
    };
  } catch {
    return null;
  }
};

const evaluateSelfGuidedBeam = async (params: {
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
  } catch {
    // Fallback to deterministic estimate below.
  }

  const fallbackCorrectness = clamp01(params.ormScore / 100, 0.55);
  return {
    probability: 0.55,
    correctness: fallbackCorrectness,
    score: 0.55 * fallbackCorrectness,
    probabilitySource: 'fallback',
  };
};

const evaluateTaskResultCandidate = (params: {
  session: AgentSession;
  taskGoal: string;
  rawResult: string;
}): {
  formatted: string;
  orm: ReturnType<typeof assessRuleBasedOrm>;
} => {
  const formatted = formatCitationFirstResult(params.rawResult, params.session);
  const orm = assessRuleBasedOrm({
    session: params.session,
    taskGoal: params.taskGoal,
    rawResult: params.rawResult,
    formattedResult: formatted,
  });
  return { formatted, orm };
};

const extractActionableFeedbackPoints = (raw: string): string[] => {
  const text = String(raw || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d).\s]+/, '').trim())
    .filter((line) => line.length >= 8)
    .slice(0, 8);

  const actionable = lines.filter((line) => /(?:수정|보완|추가|삭제|명확|근거|검증|리스크|가드레일)/.test(line));
  const picked = (actionable.length > 0 ? actionable : lines).slice(0, 3);
  return picked;
};

const runSelfRefineLite = async (params: {
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
    ensureSessionBudget(params.sessionStartedAtMs);
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

const runToTShadowExploration = async (params: {
  session: AgentSession;
  policy: AgentTotPolicySnapshot;
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
  const selectedAngles = branchAngles.slice(0, policy.maxBranches);
  const replaySeeds = policy.replayEnabled && policy.replayTopK > 0
    ? await getTotReplayCandidates({ guildId: session.guildId, topK: policy.replayTopK })
    : [];
  const scored: Array<{
    rawResult: string;
    score: number;
    beamProbability: number;
    beamCorrectness: number;
    beamScore: number;
    beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
    evidenceBundleId: string;
  }> = [];

  const pushScoredCandidate = async (output: string) => {
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
    });
    const beam = await evaluateSelfGuidedBeam({
      session,
      taskGoal,
      candidate: trimmed,
      ormScore: orm.score,
    });
    scored.push({
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
    ensureSessionBudget(sessionStartedAtMs);
    if (session.cancelRequested) {
      throw new Error('SESSION_CANCELLED');
    }

    try {
      const angle = selectedAngles[index];
      const sampling = buildBranchSamplingProfile(angle, index, selectedAngles.length);
      const candidate = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
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
      await pushScoredCandidate(output);

      if (policy.localSearchEnabled && policy.localSearchMutations > 0 && output) {
        const operators = ['근거 강화', '리스크 선제 완화', '실행 단계 단순화'];
        for (let mutateIndex = 0; mutateIndex < policy.localSearchMutations; mutateIndex += 1) {
          const operator = operators[mutateIndex % operators.length];
          const mutated = await withTimeout(executeSkill('ops-execution', {
            guildId: session.guildId,
            requestedBy: session.requestedBy,
            goal: [
              `역할: ToT local-search mutation ${mutateIndex + 1}/${policy.localSearchMutations}`,
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

          await pushScoredCandidate(String(mutated.output || '').trim());
        }
      }
    } catch {
      // Shadow mode is best-effort and must not break primary path.
    }
  }

  for (let replayIndex = 0; replayIndex < replaySeeds.length; replayIndex += 1) {
    ensureSessionBudget(sessionStartedAtMs);
    if (session.cancelRequested) {
      throw new Error('SESSION_CANCELLED');
    }
    try {
      const replaySeed = replaySeeds[replayIndex];
      const replaySampling = buildBranchSamplingProfile('replay_branch', replayIndex, Math.max(1, replaySeeds.length));
      const replayCandidate = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
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
      await pushScoredCandidate(String(replayCandidate.output || '').trim());
    } catch {
      // Replay branch is also best-effort.
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

const finalizeTaskResult = (params: {
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

const decomposeGoalLeastToMost = async (params: {
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
      temperature: 0,
      maxTokens: 260,
    });

    const subgoals = parseSubgoalsFromLlm(raw);
    if (subgoals.length >= 2) {
      return subgoals;
    }
  } catch {
    // Fail closed to baseline path.
  }

  return [];
};

const runLeastToMostExecutionDraft = async (params: {
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
      ensureSessionBudget(sessionStartedAtMs);
      if (session.cancelRequested) {
        throw new Error('SESSION_CANCELLED');
      }

      const subgoal = subgoals[index];
      const result: SkillExecutionResult = await withTimeout(executeSkill('ops-execution', {
        guildId: session.guildId,
        requestedBy: session.requestedBy,
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

const evaluatePolicyGate = (goal: string, guildId: string): {
  mode: AgentDeliberationMode;
  score: number;
  decision: AgentPolicyGateDecision;
  reasons: string[];
} => {
  const text = String(goal || '').trim();
  const policy = getAgentPrivacyPolicySnapshot(guildId);
  let score = policy.modeDefault === 'guarded' ? 55 : 10;
  const reasons: string[] = policy.modeDefault === 'guarded' ? ['privacy_guarded_default'] : [];

  for (const rule of policy.reviewRules) {
    if (rule.re.test(text)) {
      score += rule.score;
      reasons.push(rule.reason);
    }
  }

  for (const rule of policy.blockRules) {
    if (rule.re.test(text)) {
      score += rule.score;
      reasons.push(rule.reason);
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (score >= policy.blockScore) {
    return { mode: 'guarded', score, decision: 'block', reasons: reasons.length > 0 ? reasons : ['privacy_block_threshold'] };
  }
  if (score >= policy.reviewScore) {
    return { mode: 'guarded', score, decision: 'review', reasons: reasons.length > 0 ? reasons : ['privacy_review_threshold'] };
  }
  if (score >= 45) {
    return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'deliberate', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_moderate'] };
  }
  if (score >= 25) {
    return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'plan_act', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_low'] };
  }
  return { mode: policy.modeDefault === 'guarded' ? 'guarded' : 'direct', score, decision: 'allow', reasons: reasons.length > 0 ? reasons : ['risk_minimal'] };
};

const buildPolicyBlockMessage = (reasons: string[]): string => {
  const joined = reasons.slice(0, 4).join(', ') || 'privacy_policy';
  return [
    '개인정보 보호 정책상 이 요청은 자동 실행할 수 없습니다.',
    '민감정보를 제거한 최소 목적 질문으로 다시 요청해주세요.',
    `정책 사유: ${joined}`,
  ].join(' ');
};

const parseIntentFromLlm = (raw: string): AgentIntent | null => {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const intent = String(parsed.intent || '').trim().toLowerCase();
    if (intent === 'task') {
      return 'task';
    }
    if (intent === 'casual_chat') {
      return 'casual_chat';
    }
    if (intent === 'uncertain') {
      return 'uncertain';
    }
  } catch {
    return null;
  }

  return null;
};

const classifyIntent = async (params: {
  guildId: string;
  goal: string;
  requestedSkillId: SkillId | null;
  intentHints: string[];
}): Promise<AgentIntent> => {
  const { goal, requestedSkillId, intentHints } = params;
  if (requestedSkillId) {
    return 'task';
  }

  const text = String(goal || '').trim();
  if (!text) {
    return 'task';
  }

  const hintLines = intentHints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 4)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const raw = await generateText({
      system: [
        '너는 대화 의도 분류기다.',
        'task: 정보/방법 요청, 기술 설정·연동·구성, 작업 실행, 검색·분석·생성, "~하고 싶어(목적·기능)", "알려줘야", "어떻게", "방법" 등 무언가를 얻거나 이루려는 모든 발화.',
        'casual_chat: 순수 감정 토로(우울해, 힘들어), 단순 인사, 목적 없는 잡담. 기술/작업 맥락이 조금이라도 있으면 task.',
        'uncertain: 문장이 짧거나 모호해서 task/casual_chat 판별 신뢰가 낮은 경우. 정책/권한/관리 이슈가 섞였지만 목표가 불명확한 경우도 uncertain.',
        '출력은 반드시 JSON 한 줄만 사용한다.',
      ].join('\n'),
      user: [
        '참고 메모리 힌트(길드 정책/맥락):',
        hintBlock,
        `문장: ${text}`,
        '출력 형식: {"intent":"task|casual_chat|uncertain"}',
      ].join('\n'),
      temperature: 0,
      maxTokens: 40,
    });

    return parseIntentFromLlm(raw) || 'uncertain';
  } catch {
    return 'uncertain';
  }
};

const buildIntentClarificationFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (!text) {
    return '요청을 정확히 처리하려면 원하는 결과를 한 줄로 알려주세요. 예: "공지 채널 하나 만들어줘" 또는 "그냥 오늘 힘들었어"';
  }
  return '요청을 안전하게 처리하려고 확인이 필요해요. 지금 원하는 게 작업 실행인지, 그냥 대화/상담인지 한 줄로 알려주세요.';
};

const generateIntentClarificationResult = async (goal: string, hints: string[]): Promise<string> => {
  const hintLines = hints
    .filter((line) => !line.startsWith('현재 목표:'))
    .slice(0, 3)
    .map((line) => `- ${String(line || '').slice(0, 180)}`);
  const hintBlock = hintLines.length > 0
    ? hintLines.join('\n')
    : '- 없음';

  try {
    const output = await generateText({
      system: [
        '너는 디스코드 운영 봇의 안전 라우팅 어시스턴트다.',
        '목표가 모호할 때는 자동 실행을 시작하지 말고 확인 질문 1개만 한다.',
        '출력은 짧은 한국어 1~2문장으로 작성한다.',
      ].join('\n'),
      user: [
        '아래 사용자 발화는 의도가 모호하다.',
        `사용자 발화: ${String(goal || '').trim()}`,
        '참고 메모리 힌트:',
        hintBlock,
        '작업 실행 vs 일반 대화 중 무엇을 원하는지 확인하는 질문을 작성해라.',
      ].join('\n'),
      temperature: 0.2,
      maxTokens: 120,
    });

    const text = String(output || '').trim();
    return text || buildIntentClarificationFallback(goal);
  } catch {
    return buildIntentClarificationFallback(goal);
  }
};

const buildCasualChatFallback = (goal: string): string => {
  const text = String(goal || '').trim();
  if (/우울|슬퍼|힘들|불안/.test(text)) {
    return '많이 지쳤던 것 같아요. 괜찮다면 오늘 특히 힘들었던 순간이 뭐였는지 한 가지만 말해줄래요?';
  }
  return '들려줘서 고마워요. 지금 마음이나 상황을 한두 문장만 더 말해주면, 거기에 맞춰 같이 이야기해볼게요.';
};

const generateCasualChatResult = async (goal: string): Promise<string> => {
  try {
    const output = await generateText({
      system: [
        '너는 공감형 한국어 대화 파트너다.',
        '도구 호출을 유도하거나 작업 실행으로 전환하지 않는다.',
        '과거 데이터베이스/장기기억(메모리, Obsidian)을 먼저 뒤지지 않는다.',
        '감정적 호소나 짧은 일상어에는 현재 맥락에 공감한 뒤 가벼운 질문 1개로 핑퐁을 유도한다.',
        '질문 예시 톤: 무슨 일 있었어?, 어떤 빵 먹었어?',
        '짧고 자연스럽게 공감하고, 필요하면 한 가지 되묻기만 한다.',
        '진단, 단정, 과도한 조언은 피한다.',
      ].join('\n'),
      user: [
        '사용자 발화에 대해 자연스럽게 답해라.',
        '출력은 일반 대화 문장만 작성한다.',
        '근거/검증/confidence 같은 섹션 제목을 쓰지 않는다.',
        `사용자: ${String(goal || '').trim()}`,
      ].join('\n'),
      temperature: 0.5,
      maxTokens: 220,
    });

    const text = String(output || '').trim();
    return text || buildCasualChatFallback(goal);
  } catch {
    return buildCasualChatFallback(goal);
  }
};

const cancelAllPendingSteps = (session: AgentSession, timestamp: string) => {
  for (const step of session.steps) {
    if (step.status === 'pending' || step.status === 'running') {
      step.status = 'cancelled';
      step.startedAt = step.startedAt || timestamp;
      step.endedAt = timestamp;
    }
  }
};

const formatCitationFirstResult = (rawResult: string, session: AgentSession): string => {
  const citations = extractMemoryCitations(session.memoryHints);
  const confidence = toConfidenceLabel(session.priority, citations.length);
  const conclusion = toConclusion(rawResult);
  const evidenceBundleId = buildEvidenceBundleId(session.goal, citations);

  const citationText = citations.length > 0
    ? citations.map((id) => `- memory:${id}`).join('\n')
    : '- 근거 부족: memory 힌트에서 직접 인용 가능한 항목을 찾지 못했습니다.';

  return [
    '## Deliverable',
    conclusion,
    '',
    '## Verification',
    `- evidence_bundle_id: ${evidenceBundleId}`,
    citationText,
    '',
    `## Confidence: ${confidence}`,
  ].join('\n');
};

const touch = (session: AgentSession) => {
  session.updatedAt = nowIso();
};

const buildInitialSteps = (
  guildId: string,
  requestedSkillId: SkillId | null,
  priority: AgentPriority,
  timestamp: string,
): AgentStep[] => {
  primeWorkflowProfileCache();
  const templates = getWorkflowStepTemplates({
    guildId,
    priority,
    hasRequestedSkill: Boolean(requestedSkillId),
  });

  return templates.map((template) => {
    const cancelled = Boolean(
      (priority === 'fast' && template.skipWhenFast)
      || (requestedSkillId && template.skipWhenRequestedSkill),
    );
    return {
      id: crypto.randomUUID(),
      role: template.role,
      title: requestedSkillId && template.role === 'planner'
        ? `스킬 실행: ${requestedSkillId}`
        : template.title,
      status: cancelled ? 'cancelled' : 'pending',
      startedAt: null,
      endedAt: cancelled ? timestamp : null,
      output: null,
      error: null,
    };
  });
};

const cloneSession = (session: AgentSession): AgentSession => ({
  ...session,
  steps: session.steps.map((step) => ({ ...step })),
  shadowGraph: session.shadowGraph
    ? {
      ...session.shadowGraph,
      memoryHints: [...session.shadowGraph.memoryHints],
      plans: session.shadowGraph.plans.map((plan) => ({ ...plan, args: { ...plan.args } })),
      outcomes: session.shadowGraph.outcomes.map((outcome) => ({ ...outcome })),
      trace: session.shadowGraph.trace.map((entry) => ({ ...entry })),
    }
    : null,
});

const getSession = (sessionId: string): AgentSession => sessions.get(sessionId) as AgentSession;

const ensureShadowGraph = (session: AgentSession): LangGraphState => {
  if (!session.shadowGraph) {
    session.shadowGraph = createInitialLangGraphState({
      sessionId: session.id,
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      priority: session.priority,
      goal: session.goal,
    });
  }
  return session.shadowGraph;
};

const traceShadowNode = (
  session: AgentSession,
  node: Parameters<typeof appendTrace>[1],
  note?: string,
) => {
  session.shadowGraph = appendTrace(ensureShadowGraph(session), node, note);
};

const markSessionTerminal = (session: AgentSession, status: AgentSessionStatus, patch?: Partial<AgentSession>) => {
  const nextResult = patch?.result !== undefined ? patch.result : session.result;
  const nextError = patch?.error !== undefined ? patch.error : session.error;

  session.shadowGraph = appendTrace({
    ...ensureShadowGraph(session),
    finalText: nextResult ?? null,
    errorCode: nextError ? String(nextError) : null,
  }, 'persist_and_emit', status);

  session.status = status;
  session.endedAt = nowIso();
  if (patch?.result !== undefined) {
    session.result = patch.result;
  }
  if (patch?.error !== undefined) {
    session.error = patch.error;
  }
  touch(session);
  void persistAgentSession(cloneSession(session));
};

const runStep = async (
  session: AgentSession,
  step: AgentStep,
  skillId: SkillId,
  buildInput: (priorOutput?: string) => string,
  priorOutput?: string,
): Promise<string> => {
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
    const result = await withTimeout(executeSkill(skillId, {
      guildId: session.guildId,
      requestedBy: session.requestedBy,
      goal: buildInput(priorOutput),
      memoryHints: session.memoryHints,
      priorOutput,
    }), AGENT_STEP_TIMEOUT_MS, `STEP_TIMEOUT:${step.role}`);

    const output = result.output;
    if (session.cancelRequested) {
      step.status = 'cancelled';
      step.endedAt = nowIso();
      touch(session);
      throw new Error('SESSION_CANCELLED');
    }

    step.status = 'completed';
    step.endedAt = nowIso();
    step.output = String(output || '').trim();
    touch(session);
    return step.output;
  } catch (error) {
    step.status = 'failed';
    step.endedAt = nowIso();
    step.error = getErrorMessage(error);
    touch(session);
    throw error;
  }
};

type SessionBranchResult = AgentSessionStatus | null;

const handleNonTaskIntentBranch = async (params: {
  session: AgentSession;
  sessionStartedAtMs: number;
  intentHints: string[];
}): Promise<SessionBranchResult> => {
  const { session, sessionStartedAtMs, intentHints } = params;
  if (session.routedIntent === 'casual_chat') {
    ensureSessionBudget(sessionStartedAtMs);
    const timestamp = nowIso();
    cancelAllPendingSteps(session, timestamp);
    traceShadowNode(session, 'compose_response', 'casual_chat');
    const casualReply = await generateCasualChatResult(session.goal);
    markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: casualReply,
      error: null,
    });
    return session.cancelRequested ? 'cancelled' : 'completed';
  }

  if (session.routedIntent === 'uncertain') {
    ensureSessionBudget(sessionStartedAtMs);
    const timestamp = nowIso();
    cancelAllPendingSteps(session, timestamp);
    traceShadowNode(session, 'compose_response', 'intent_clarification');
    const clarification = await generateIntentClarificationResult(session.goal, intentHints);
    markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
      result: clarification,
      error: null,
    });
    return session.cancelRequested ? 'cancelled' : 'completed';
  }

  return null;
};

const handleRequestedSkillBranch = async (params: {
  session: AgentSession;
  sessionStartedAtMs: number;
  taskGoal: string;
  forceFullReview: boolean;
}): Promise<SessionBranchResult> => {
  const { session, sessionStartedAtMs, taskGoal, forceFullReview } = params;
  if (!session.requestedSkillId) {
    return null;
  }
  if (forceFullReview) {
    return null;
  }

  ensureSessionBudget(sessionStartedAtMs);
  const singleSkillStep = session.steps[0];
  traceShadowNode(session, 'plan_actions', `requested_skill=${session.requestedSkillId}`);
  const singleResult = await runStep(
    session,
    singleSkillStep,
    session.requestedSkillId,
    () => taskGoal,
    undefined,
  );
  const refinedResult = await runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: singleResult,
    sessionStartedAtMs,
    traceLabel: 'single_skill',
  });
  traceShadowNode(session, 'execute_actions', session.requestedSkillId);
  traceShadowNode(session, 'compose_response', 'single_skill');

  markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: finalizeTaskResult({
      session,
      taskGoal,
      rawResult: refinedResult,
      traceLabel: 'single_skill',
    }),
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};

const handleFastPriorityBranch = async (params: {
  session: AgentSession;
  sessionStartedAtMs: number;
  taskGoal: string;
  researcher: AgentStep;
  forceFullReview: boolean;
}): Promise<SessionBranchResult> => {
  const {
    session,
    sessionStartedAtMs,
    taskGoal,
    researcher,
    forceFullReview,
  } = params;
  if (session.priority !== 'fast') {
    return null;
  }
  if (forceFullReview) {
    return null;
  }

  ensureSessionBudget(sessionStartedAtMs);
  traceShadowNode(session, 'execute_actions', 'fast_path');
  const fastDraft = await runStep(session, researcher, 'ops-execution', () => [
    '우선순위: 빠름',
    '요구사항: 중간 과정 없이 최종 결과물만 제시',
    `목표: ${taskGoal}`,
    '출력: 바로 사용할 수 있는 결과물 텍스트',
  ].join('\n'), undefined);
  const fastRefined = await runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: fastDraft,
    sessionStartedAtMs,
    traceLabel: 'fast_path',
  });
  traceShadowNode(session, 'compose_response', 'fast_path');

  markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: finalizeTaskResult({
      session,
      taskGoal,
      rawResult: fastRefined,
      traceLabel: 'fast_path',
    }),
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};

const handleBalancedOrPreciseBranch = async (params: {
  session: AgentSession;
  sessionStartedAtMs: number;
  taskGoal: string;
  planner: AgentStep;
  researcher: AgentStep;
  critic: AgentStep;
}): Promise<AgentSessionStatus> => {
  const {
    session,
    sessionStartedAtMs,
    taskGoal,
    planner,
    researcher,
    critic,
  } = params;
  const totPolicy = getAgentTotPolicySnapshot(session.guildId);

  ensureSessionBudget(sessionStartedAtMs);
  traceShadowNode(session, 'plan_actions', 'planner');
  const subgoals = await decomposeGoalLeastToMost({
    taskGoal,
    priority: session.priority,
  });
  if (subgoals.length >= 2) {
    traceShadowNode(session, 'plan_actions', `least_to_most:subgoals=${subgoals.length}`);
  }
  const taskGoalWithSubgoals = subgoals.length >= 2
    ? [
      taskGoal,
      '',
      '하위목표(Least-to-Most):',
      ...subgoals.map((subgoal, index) => `${index + 1}. ${subgoal}`),
    ].join('\n')
    : taskGoal;

  const plan = await runStep(session, planner, 'ops-plan', () => [
    session.priority === 'precise' ? '우선순위: 정밀 (검증과 리스크 완화를 강화)' : '우선순위: 균형',
    '역할: 계획 수립 에이전트',
    `목표: ${taskGoalWithSubgoals}`,
    '출력: 1) 실행 단계 2) 필요한 근거 3) 실패시 대안 을 간결한 한국어 문단으로 작성',
    '규칙: 추측과 단정 금지, 실제 실행 가능한 단계 중심',
  ].join('\n'), undefined);
  session.shadowGraph = {
    ...ensureShadowGraph(session),
    plans: [{ actionName: 'ops-plan', args: { goal: taskGoal }, reason: String(plan || '').slice(0, 300) }],
  };

  ensureSessionBudget(sessionStartedAtMs);
  traceShadowNode(session, 'execute_actions', 'researcher_execution');
  let executionDraft: string;
  if (subgoals.length >= 2) {
    try {
      executionDraft = await runLeastToMostExecutionDraft({
        session,
        step: researcher,
        taskGoal,
        plan,
        subgoals,
        sessionStartedAtMs,
      });
    } catch (error) {
      traceShadowNode(session, 'execute_actions', `least_to_most:fallback:${getErrorMessage(error)}`);
      executionDraft = await runStep(session, researcher, 'ops-execution', () => [
        session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
        '역할: 실행/리서치 에이전트',
        `목표: ${taskGoal}`,
        `계획안: ${plan}`,
        '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
      ].join('\n'), plan);
    }
  } else {
    executionDraft = await runStep(session, researcher, 'ops-execution', () => [
      session.priority === 'precise' ? '우선순위: 정밀 (근거/가드레일을 더 상세히 포함)' : '우선순위: 균형',
      '역할: 실행/리서치 에이전트',
      `목표: ${taskGoal}`,
      `계획안: ${plan}`,
      '출력: 디스코드 운영자가 바로 수행할 수 있는 실행안/체크리스트/예상 리스크를 한국어로 정리',
    ].join('\n'), plan);
  }

  ensureSessionBudget(sessionStartedAtMs);
  traceShadowNode(session, 'critic_review', 'ops-critique');
  const critique = await runStep(session, critic, 'ops-critique', () => [
    session.priority === 'precise' ? '우선순위: 정밀 (보수적 관점으로 리스크를 촘촘히 점검)' : '우선순위: 균형',
    '역할: 검증 에이전트',
    `목표: ${taskGoal}`,
    `실행안: ${executionDraft}`,
    '출력: 사실성 위험, 과잉자동화 위험, 개인정보/운영 리스크를 점검하고 보완안을 제시',
  ].join('\n'), executionDraft);

  let totShadowBest: {
    rawResult: string;
    score: number;
    beamProbability: number;
    beamCorrectness: number;
    beamScore: number;
    beamProbabilitySource: 'provider_logprob' | 'self_eval' | 'fallback';
    evidenceBundleId: string;
  } | null = null;
  if (!session.cancelRequested) {
    totShadowBest = await runToTShadowExploration({
      session,
      policy: totPolicy,
      taskGoal,
      plan,
      executionDraft,
      critique,
      sessionStartedAtMs,
    });
  }

  ensureSessionBudget(sessionStartedAtMs);
  traceShadowNode(session, 'compose_response', 'final_output');
  const finalComposeGoal = [
    '요구사항: 중간 과정/역할별 산출물 노출 금지',
    `목표: ${taskGoal}`,
    `계획 참고: ${plan}`,
    `검증 참고: ${critique}`,
    `초안 참고: ${executionDraft}`,
    '출력: 사용자에게 전달할 최종 결과물만 간결하게 작성',
  ].join('\n');

  const finalResultBase = await runStep(session, researcher, 'ops-execution', () => finalComposeGoal, critique);
  let finalResult = finalResultBase;

  if (FINAL_SELF_CONSISTENCY_ENABLED && FINAL_SELF_CONSISTENCY_SAMPLES > 1 && !session.cancelRequested) {
    const candidates: string[] = [finalResultBase];
    let sampleFailures = 0;

    for (let i = 1; i < FINAL_SELF_CONSISTENCY_SAMPLES; i += 1) {
      ensureSessionBudget(sessionStartedAtMs);
      if (session.cancelRequested) {
        throw new Error('SESSION_CANCELLED');
      }
      try {
        const variantGoal = [
          finalComposeGoal,
          `추가 지시: self-consistency 후보 ${i + 1}/${FINAL_SELF_CONSISTENCY_SAMPLES}.`,
          '동일 사실을 유지하되 문장 구성은 독립적으로 재작성하라.',
        ].join('\n');

        const variant = await withTimeout(executeSkill('ops-execution', {
          guildId: session.guildId,
          requestedBy: session.requestedBy,
          goal: variantGoal,
          memoryHints: session.memoryHints,
          priorOutput: critique,
        }), AGENT_STEP_TIMEOUT_MS, 'STEP_TIMEOUT:researcher');

        const output = String(variant.output || '').trim();
        if (output) {
          candidates.push(output);
        }
      } catch {
        sampleFailures += 1;
      }
    }

    const consensus = selectConsensusText(candidates);
    if (consensus) {
      finalResult = consensus;
      researcher.output = consensus;
      touch(session);
    }
    traceShadowNode(session, 'compose_response', `self_consistency:candidates=${candidates.length},failures=${sampleFailures}`);
  }

  const finalRefined = await runSelfRefineLite({
    session,
    taskGoal,
    currentDraft: finalResult,
    sessionStartedAtMs,
    traceLabel: 'final_output',
  });

  let selectedFinalRaw = finalRefined;
  let baseEval: ReturnType<typeof evaluateTaskResultCandidate> | null = null;
  let totEval: ReturnType<typeof evaluateTaskResultCandidate> | null = null;
  let baseBeam: BeamEvaluation | null = null;
  let totBeam: BeamEvaluation | null = null;
  let candidatePairLogged = false;

  if (totShadowBest?.rawResult) {
    baseEval = evaluateTaskResultCandidate({
      session,
      taskGoal,
      rawResult: finalRefined,
    });
    totEval = evaluateTaskResultCandidate({
      session,
      taskGoal,
      rawResult: totShadowBest.rawResult,
    });
    baseBeam = await evaluateSelfGuidedBeam({
      session,
      taskGoal,
      candidate: finalRefined,
      ormScore: baseEval.orm.score,
    });
    // Reuse shadow-time beam evaluation to avoid re-scoring drift on the same candidate.
    totBeam = {
      probability: totShadowBest.beamProbability,
      correctness: totShadowBest.beamCorrectness,
      score: totShadowBest.beamScore,
      probabilitySource: totShadowBest.beamProbabilitySource,
    };
  }

  if (totPolicy.activeEnabled && !session.cancelRequested) {
    const priorityEligible = session.priority !== 'fast' || totPolicy.activeAllowFast;
    const goalEligible = String(taskGoal || '').trim().length >= totPolicy.activeMinGoalLength;
    if (priorityEligible && goalEligible && baseEval && totEval && totShadowBest?.rawResult && baseBeam && totBeam) {
      const gain = totEval.orm.score - baseEval.orm.score;
      const beamGain = totBeam.score - baseBeam.score;
      const passGate = !totPolicy.activeRequireNonPass || baseEval.orm.verdict !== 'pass';
      const promote = passGate
        && gain >= totPolicy.activeMinScoreGain
        && beamGain >= totPolicy.activeMinBeamGain;

      if (promote) {
        selectedFinalRaw = totShadowBest.rawResult;
      }

      if (session.totShadowAssessment) {
        session.totShadowAssessment.selectedByRouter = promote;
        session.totShadowAssessment.scoreGainVsBaseline = gain;
      }
      traceShadowNode(
        session,
        'compose_response',
        `tot_active:promote=${promote},base_orm=${baseEval.orm.score},tot_orm=${totEval.orm.score},orm_gain=${gain},beam_gain=${beamGain.toFixed(4)}`,
      );

      void recordTotCandidatePair({
        guildId: session.guildId,
        sessionId: session.id,
        strategy: totPolicy.strategy,
        baselineScore: baseEval.orm.score,
        candidateScore: totEval.orm.score,
        scoreGain: gain,
        beamGain,
        promoted: promote,
        baselineProbability: baseBeam.probability,
        baselineProbabilitySource: baseBeam.probabilitySource,
        baselineCorrectness: baseBeam.correctness,
        baselineBeamScore: baseBeam.score,
        candidateProbability: totBeam.probability,
        candidateProbabilitySource: totBeam.probabilitySource,
        candidateCorrectness: totBeam.correctness,
        candidateBeamScore: totBeam.score,
        baselineEvidenceBundleId: baseEval.orm.evidenceBundleId,
        candidateEvidenceBundleId: totEval.orm.evidenceBundleId,
        baselineResult: finalRefined,
        candidateResult: totShadowBest.rawResult,
      }).then(() => maybeAutoTuneAgentTotPolicy(session.guildId));
      candidatePairLogged = true;
    } else {
      traceShadowNode(session, 'compose_response', 'tot_active:skipped_by_policy');
    }
  }

  if (!candidatePairLogged && baseEval && totEval && totShadowBest?.rawResult && baseBeam && totBeam) {
    const scoreGain = totEval.orm.score - baseEval.orm.score;
    const beamGain = totBeam.score - baseBeam.score;
    const promoted = selectedFinalRaw === totShadowBest.rawResult;
    void recordTotCandidatePair({
      guildId: session.guildId,
      sessionId: session.id,
      strategy: totPolicy.strategy,
      baselineScore: baseEval.orm.score,
      candidateScore: totEval.orm.score,
      scoreGain,
      beamGain,
      promoted,
      baselineProbability: baseBeam.probability,
      baselineProbabilitySource: baseBeam.probabilitySource,
      baselineCorrectness: baseBeam.correctness,
      baselineBeamScore: baseBeam.score,
      candidateProbability: totBeam.probability,
      candidateProbabilitySource: totBeam.probabilitySource,
      candidateCorrectness: totBeam.correctness,
      candidateBeamScore: totBeam.score,
      baselineEvidenceBundleId: baseEval.orm.evidenceBundleId,
      candidateEvidenceBundleId: totEval.orm.evidenceBundleId,
      baselineResult: finalRefined,
      candidateResult: totShadowBest.rawResult,
    }).then(() => maybeAutoTuneAgentTotPolicy(session.guildId));
  }

  markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
    result: finalizeTaskResult({
      session,
      taskGoal,
      rawResult: selectedFinalRaw,
      traceLabel: 'final_output',
    }),
    error: null,
  });
  return session.cancelRequested ? 'cancelled' : 'completed';
};

const executeSession = async (sessionId: string): Promise<AgentSessionStatus> => {
  const session = getSession(sessionId);
  if (!session) {
    return 'failed';
  }

  traceShadowNode(session, 'ingest', `priority=${session.priority}`);
  session.status = 'running';
  session.startedAt = nowIso();
  touch(session);
  void persistAgentSession(cloneSession(session));
  const sessionStartedAtMs = Date.now();

  try {
    const compiledPrompt = compilePromptGoal(session.goal);
    const taskGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || session.goal;
    session.shadowGraph = {
      ...ensureShadowGraph(session),
      compiledPrompt,
      executionGoal: taskGoal,
    };
    traceShadowNode(
      session,
      'compile_prompt',
      compiledPrompt.directives.length > 0 || compiledPrompt.intentTags.length > 0 ? 'structured_directive' : 'plain_goal',
    );

    ensureSessionBudget(sessionStartedAtMs);
    const intentHints = await withTimeout(buildAgentMemoryHints({
      guildId: session.guildId,
      goal: taskGoal,
      maxItems: 4,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'INTENT_HINT_TIMEOUT').catch(() => []);
    session.routedIntent = await classifyIntent({
      guildId: session.guildId,
      goal: compiledPrompt.normalizedGoal || taskGoal,
      requestedSkillId: session.requestedSkillId,
      intentHints,
    });
    session.shadowGraph = {
      ...ensureShadowGraph(session),
      intent: session.routedIntent,
    };
    traceShadowNode(session, 'route_intent', session.routedIntent);

    if (session.routedIntent === 'task') {
      const gate = evaluatePolicyGate(taskGoal, session.guildId);
      session.deliberationMode = gate.mode;
      session.riskScore = gate.score;
      session.policyGate = {
        decision: gate.decision,
        reasons: [...gate.reasons],
      };
      traceShadowNode(session, 'policy_gate', `${gate.decision}:${gate.score}`);
      void recordPrivacyGateSample({
        guildId: session.guildId,
        sessionId: session.id,
        mode: gate.mode,
        decision: gate.decision,
        riskScore: gate.score,
        reasons: gate.reasons,
        goal: taskGoal,
      });

      if (gate.decision === 'block') {
        const timestamp = nowIso();
        cancelAllPendingSteps(session, timestamp);
        markSessionTerminal(session, session.cancelRequested ? 'cancelled' : 'completed', {
          result: buildPolicyBlockMessage(gate.reasons),
          error: null,
        });
        return session.cancelRequested ? 'cancelled' : 'completed';
      }
    } else {
      session.deliberationMode = 'direct';
      session.riskScore = 0;
      session.policyGate = { decision: 'allow', reasons: ['non_task_intent'] };
    }

    touch(session);

    const nonTaskResult = await handleNonTaskIntentBranch({
      session,
      sessionStartedAtMs,
      intentHints,
    });
    if (nonTaskResult) {
      return nonTaskResult;
    }

    ensureSessionBudget(sessionStartedAtMs);
    session.memoryHints = await withTimeout(buildAgentMemoryHints({
      guildId: session.guildId,
      goal: taskGoal,
      maxItems: session.priority === 'fast' ? 4 : session.priority === 'precise' ? 16 : 10,
    }), AGENT_MEMORY_HINT_TIMEOUT_MS, 'MEMORY_HINT_TIMEOUT').catch(() => []);
    session.shadowGraph = {
      ...ensureShadowGraph(session),
      memoryHints: [...session.memoryHints],
    };
    traceShadowNode(session, 'hydrate_memory', `count=${session.memoryHints.length}`);
    touch(session);

    const requestedSkillResult = await handleRequestedSkillBranch({
      session,
      sessionStartedAtMs,
      taskGoal,
      forceFullReview: session.policyGate?.decision === 'review',
    });
    if (requestedSkillResult) {
      return requestedSkillResult;
    }

    const planner = session.steps[0];
    const researcher = session.steps[1];
    const critic = session.steps[2];

    const fastResult = await handleFastPriorityBranch({
      session,
      sessionStartedAtMs,
      taskGoal,
      researcher,
      forceFullReview: session.policyGate?.decision === 'review',
    });
    if (fastResult) {
      return fastResult;
    }

    return await handleBalancedOrPreciseBranch({
      session,
      sessionStartedAtMs,
      taskGoal,
      planner,
      researcher,
      critic,
    });
  } catch (error) {
    if (session.cancelRequested || getErrorMessage(error) === 'SESSION_CANCELLED') {
      markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
      return 'cancelled';
    }

    if (getErrorMessage(error) === 'SESSION_TIMEOUT') {
      markSessionTerminal(session, 'failed', { error: '처리 시간이 길어져 세션을 종료했습니다. 요청 범위를 줄여 다시 시도해주세요.' });
      return 'failed';
    }

    if (getErrorMessage(error).startsWith('STEP_TIMEOUT:')) {
      const role = getErrorMessage(error).split(':')[1] || 'unknown';
      markSessionTerminal(session, 'failed', { error: `단계 처리 시간이 초과되었습니다(${role}). 잠시 후 다시 시도해주세요.` });
      return 'failed';
    }

    markSessionTerminal(session, 'failed', { error: getErrorMessage(error) });
    return 'failed';
  }
};

const enqueueSession = (sessionId: string) => {
  if (!pendingSessionQueue.includes(sessionId)) {
    pendingSessionQueue.push(sessionId);
  }
};

const removeFromQueue = (sessionId: string) => {
  const index = pendingSessionQueue.indexOf(sessionId);
  if (index >= 0) {
    pendingSessionQueue.splice(index, 1);
  }
};

const pushDeadletter = (session: AgentSession, reason: string) => {
  deadletters.unshift({
    sessionId: session.id,
    guildId: session.guildId,
    requestedBy: session.requestedBy,
    goal: session.goal,
    reason,
    failedAt: nowIso(),
  });
  if (deadletters.length > AGENT_DEADLETTER_MAX) {
    deadletters.length = AGENT_DEADLETTER_MAX;
  }
};

const requeueForRetry = (session: AgentSession) => {
  const privacyPolicy = getAgentPrivacyPolicySnapshot(session.guildId);
  session.status = 'queued';
  session.startedAt = null;
  session.endedAt = null;
  session.result = null;
  session.cancelRequested = false;
  session.deliberationMode = privacyPolicy.modeDefault;
  session.riskScore = privacyPolicy.modeDefault === 'guarded' ? 55 : 0;
  session.policyGate = privacyPolicy.modeDefault === 'guarded'
    ? { decision: 'review', reasons: ['privacy_guarded_default'] }
    : { decision: 'allow', reasons: ['legacy_default'] };
  session.steps = buildInitialSteps(session.guildId, session.requestedSkillId, session.priority, nowIso());
  session.shadowGraph = null;
  touch(session);
  void persistAgentSession(cloneSession(session));
  enqueueSession(session.id);
};

const scheduleQueueDrain = () => {
  if (queueDrainTimer) {
    return;
  }

  queueDrainTimer = setTimeout(() => {
    queueDrainTimer = null;
    const maxConcurrent = Math.max(1, getAgentPolicySnapshot().maxConcurrentSessions);
    while (runningSessionIds.size < maxConcurrent && pendingSessionQueue.length > 0) {
      const sessionId = pendingSessionQueue.shift() as string;
      const session = sessions.get(sessionId);
      if (!session) {
        continue;
      }

      if (session.cancelRequested || session.status === 'cancelled') {
        markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
        continue;
      }

      runningSessionIds.add(sessionId);
      const attempts = (sessionAttempts.get(sessionId) || 0) + 1;
      sessionAttempts.set(sessionId, attempts);

      void executeSession(sessionId)
        .then((status) => {
          const latest = sessions.get(sessionId);
          if (!latest) {
            return;
          }

          if (status === 'failed') {
            if (attempts < AGENT_SESSION_MAX_ATTEMPTS) {
              requeueForRetry(latest);
              return;
            }

            pushDeadletter(latest, latest.error || 'FAILED');
          }
        })
        .finally(() => {
          runningSessionIds.delete(sessionId);
          scheduleQueueDrain();
        });
    }
  }, AGENT_QUEUE_POLL_MS);
};

const pruneSessions = () => {
  if (sessions.size <= MAX_SESSION_HISTORY) {
    return;
  }

  const ordered = [...sessions.values()]
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  const removeCount = sessions.size - MAX_SESSION_HISTORY;
  for (let i = 0; i < removeCount; i += 1) {
    sessions.delete(ordered[i].id);
  }
};

export const startAgentSession = (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  skillId?: string | null;
  priority?: string | null;
  isAdmin?: boolean;
}) => {
  if (!isAnyLlmConfigured()) {
    throw new Error('LLM provider is not configured. Configure OPENAI/GEMINI/ANTHROPIC/OPENCLAW/OLLAMA provider.');
  }

  const requestedSkillId = params.skillId && isSkillId(params.skillId)
    ? params.skillId
    : null;
  const privacyPolicy = getAgentPrivacyPolicySnapshot(params.guildId);
  const priority = toPriority(params.priority);
  primeAgentPolicyCache();
  primeAgentPrivacyPolicyCache();
  primeWorkflowProfileCache();
  primeAgentTotPolicyCache();

  if (pendingSessionQueue.length >= AGENT_MAX_QUEUE_SIZE) {
    throw new Error(`대기열이 가득 찼습니다. 잠시 후 다시 시도해주세요. (max=${AGENT_MAX_QUEUE_SIZE})`);
  }

  const policy = validateAgentSessionRequest({
    guildId: params.guildId,
    runningSessions: runningSessionIds.size,
    goal: params.goal,
    requestedSkillId,
    isAdmin: params.isAdmin === true,
  });

  if (!policy.ok) {
    throw new Error(policy.message);
  }

  const sessionId = crypto.randomUUID();
  const timestamp = nowIso();
  const session: AgentSession = {
    id: sessionId,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal.trim(),
    priority,
    requestedSkillId,
    routedIntent: 'task',
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    cancelRequested: false,
    deliberationMode: privacyPolicy.modeDefault,
    riskScore: privacyPolicy.modeDefault === 'guarded' ? 55 : 0,
    policyGate: privacyPolicy.modeDefault === 'guarded'
      ? { decision: 'review', reasons: ['privacy_guarded_default'] }
      : { decision: 'allow', reasons: ['legacy_default'] },
    memoryHints: [],
    steps: buildInitialSteps(params.guildId, requestedSkillId, priority, timestamp),
    shadowGraph: null,
  };

  sessions.set(session.id, session);
  pruneSessions();
  void persistAgentSession(cloneSession(session));
  enqueueSession(session.id);
  scheduleQueueDrain();
  return cloneSession(session);
};

export const cancelAgentSession = (sessionId: string): { ok: boolean; message: string } => {
  const session = sessions.get(sessionId);
  if (!session) {
    return { ok: false, message: '세션을 찾을 수 없습니다.' };
  }

  if (session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled') {
    return { ok: false, message: `이미 종료된 세션입니다: ${session.status}` };
  }

  session.cancelRequested = true;
  if (session.status === 'queued') {
    removeFromQueue(sessionId);
    markSessionTerminal(session, 'cancelled', { error: '사용자 요청으로 중지되었습니다.' });
    return { ok: true, message: '대기열에서 중지했습니다.' };
  }

  touch(session);
  return { ok: true, message: '중지 요청을 수락했습니다.' };
};

export const getAgentSession = (sessionId: string): AgentSession | null => {
  const session = sessions.get(sessionId);
  return session ? cloneSession(session) : null;
};

export const listGuildAgentSessions = (guildId: string, limit = 10): AgentSession[] => {
  const size = Math.max(1, Math.min(50, Math.trunc(limit)));
  return [...sessions.values()]
    .filter((session) => session.guildId === guildId)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, size)
    .map((session) => cloneSession(session));
};

export const listAgentDeadletters = (params?: { guildId?: string; limit?: number }) => {
  const limit = Math.max(1, Math.min(200, Math.trunc(params?.limit ?? 30)));
  const guildId = String(params?.guildId || '').trim();
  return deadletters
    .filter((row) => (!guildId || row.guildId === guildId))
    .slice(0, limit)
    .map((row) => ({ ...row }));
};

const toElapsedMs = (session: AgentSession): number | null => {
  if (!session.startedAt) {
    return null;
  }

  const startedMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }

  const endBase = session.endedAt || session.updatedAt || nowIso();
  const endedMs = Date.parse(endBase);
  if (!Number.isFinite(endedMs)) {
    return null;
  }

  return Math.max(0, endedMs - startedMs);
};

const toTraceTailLimit = (raw?: number): number => {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(0, Math.min(20, Math.trunc(value)));
};

const buildShadowSummary = (
  shadowGraph: LangGraphState | null,
  session: AgentSession,
  traceTailLimit: number,
): AgentSessionShadowSummary | null => {
  if (!shadowGraph) {
    return null;
  }

  const uniqueNodeCount = new Set(shadowGraph.trace.map((entry) => entry.node)).size;
  const traceTail = traceTailLimit > 0
    ? shadowGraph.trace
      .slice(-traceTailLimit)
      .map((entry) => ({ node: entry.node, at: entry.at, note: entry.note }))
    : [];

  const lastNode = shadowGraph.trace.length > 0
    ? shadowGraph.trace[shadowGraph.trace.length - 1].node
    : null;

  return {
    traceLength: shadowGraph.trace.length,
    lastNode,
    intent: shadowGraph.intent,
    hasError: Boolean(shadowGraph.errorCode),
    elapsedMs: toElapsedMs(session),
    uniqueNodeCount,
    traceTail,
  };
};

const buildProgressSummary = (session: AgentSession): AgentSessionProgressSummary => {
  const totalSteps = session.steps.length;
  const completedSteps = session.steps.filter((step) => step.status === 'completed').length;
  const failedSteps = session.steps.filter((step) => step.status === 'failed').length;
  const cancelledSteps = session.steps.filter((step) => step.status === 'cancelled').length;
  const runningSteps = session.steps.filter((step) => step.status === 'running').length;
  const pendingSteps = session.steps.filter((step) => step.status === 'pending').length;
  const doneSteps = completedSteps + failedSteps + cancelledSteps;
  const progressPercent = totalSteps > 0
    ? Math.round((doneSteps / totalSteps) * 100)
    : 100;

  return {
    totalSteps,
    doneSteps,
    completedSteps,
    failedSteps,
    cancelledSteps,
    runningSteps,
    pendingSteps,
    progressPercent,
  };
};

const buildPrivacySummary = (session: AgentSession) => {
  return {
    deliberationMode: session.deliberationMode || 'direct',
    riskScore: Number.isFinite(session.riskScore) ? Number(session.riskScore) : 0,
    decision: session.policyGate?.decision || 'allow',
    reasons: [...(session.policyGate?.reasons || [])],
  };
};

export const serializeAgentSessionForApi = (
  session: AgentSession,
  options?: { includeShadowGraph?: boolean; traceTailLimit?: number },
): AgentSessionApiView => {
  const includeShadowGraph = options?.includeShadowGraph === true;
  const traceTailLimit = toTraceTailLimit(options?.traceTailLimit);
  const cloned = cloneSession(session);
  const shadowGraph = cloned.shadowGraph;

  return {
    ...cloned,
    shadowGraphSummary: buildShadowSummary(shadowGraph, cloned, traceTailLimit),
    progressSummary: buildProgressSummary(cloned),
    privacySummary: buildPrivacySummary(cloned),
    ...(includeShadowGraph ? { shadowGraph } : {}),
    ...(includeShadowGraph ? {} : { shadowGraph: undefined }),
  };
};

export const getMultiAgentRuntimeSnapshot = (): AgentRuntimeSnapshot => {
  const all = [...sessions.values()];
  const latest = all
    .map((session) => session.updatedAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    totalSessions: all.length,
    runningSessions: runningSessionIds.size,
    queuedSessions: pendingSessionQueue.length,
    completedSessions: all.filter((session) => session.status === 'completed').length,
    failedSessions: all.filter((session) => session.status === 'failed').length,
    cancelledSessions: all.filter((session) => session.status === 'cancelled').length,
    deadletteredSessions: deadletters.length,
    latestSessionAt: latest,
  };
};

export const listAgentSkills = () => listSkills();

export const getAgentPolicy = () => getAgentPolicySnapshot();

export const __resetAgentRuntimeForTests = (): void => {
  if (queueDrainTimer) {
    clearTimeout(queueDrainTimer);
    queueDrainTimer = null;
  }

  sessions.clear();
  pendingSessionQueue.length = 0;
  runningSessionIds.clear();
  sessionAttempts.clear();
  deadletters.length = 0;
};
