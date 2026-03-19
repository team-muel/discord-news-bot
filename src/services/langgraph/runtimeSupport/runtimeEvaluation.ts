import { parseLlmStructuredRecord } from '../../llmStructuredParseService';
import type { AgentPriority } from '../../agentRuntimeTypes';
import {
  buildEvidenceBundleId,
  extractMemoryCitations,
  formatCitationFirstResult,
  hasBrokenTextPattern,
  hasDebugLeak,
  sanitizeDeliverableText,
} from './runtimeFormatting';

type EvaluationSessionView = {
  goal: string;
  memoryHints: string[];
  priority: AgentPriority;
  steps: Array<{ status: string }>;
};

export type RuleBasedOrmAssessment = {
  score: number;
  verdict: 'pass' | 'review' | 'fail';
  reasons: string[];
  citationCount: number;
  evidenceBundleId: string;
};

export const assessRuleBasedOrm = (params: {
  session: EvaluationSessionView;
  taskGoal: string;
  rawResult: string;
  formattedResult: string;
  passThreshold: number;
  reviewThreshold: number;
}): RuleBasedOrmAssessment => {
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
  const verdict: 'pass' | 'review' | 'fail' = score >= params.passThreshold
    ? 'pass'
    : score >= params.reviewThreshold
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

export const clamp01 = (value: unknown, fallback: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, n));
};

export const parseSelfEvaluationJson = (raw: string): { probability: number; correctness: number } | null => {
  const parsed = parseLlmStructuredRecord(raw);
  if (!parsed) {
    return null;
  }

  return {
    probability: clamp01(parsed.probability, 0.55),
    correctness: clamp01(parsed.correctness, 0.55),
  };
};

export const evaluateTaskResultCandidate = (params: {
  session: EvaluationSessionView;
  taskGoal: string;
  rawResult: string;
  passThreshold: number;
  reviewThreshold: number;
}): {
  formatted: string;
  orm: RuleBasedOrmAssessment;
} => {
  const formatted = formatCitationFirstResult(params.rawResult, params.session);
  const orm = assessRuleBasedOrm({
    session: params.session,
    taskGoal: params.taskGoal,
    rawResult: params.rawResult,
    formattedResult: formatted,
    passThreshold: params.passThreshold,
    reviewThreshold: params.reviewThreshold,
  });
  return { formatted, orm };
};

export const extractActionableFeedbackPoints = (raw: string): string[] => {
  const text = String(raw || '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d).\s]+/, '').trim())
    .filter((line) => line.length >= 8)
    .slice(0, 8);

  const actionable = lines.filter((line) => /(?:수정|보완|추가|삭제|명확|근거|검증|리스크|가드레일)/.test(line));
  return (actionable.length > 0 ? actionable : lines).slice(0, 3);
};
