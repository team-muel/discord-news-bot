/**
 * LLM-as-Judge evaluator for sprint phase outputs (Tier 3).
 *
 * Inspired by gstack's 3-tier test pyramid:
 * - Tier 1: Static validation (free, <2s) — already covered by fast-path
 * - Tier 2: E2E via agent session (~$3.85) — covered by sprint pipeline
 * - Tier 3: LLM-as-Judge (~$0.15, ~30s) — THIS MODULE
 *
 * Scores phase outputs on: correctness, completeness, actionability.
 */

import logger from '../../logger';
import {
  SPRINT_LLM_JUDGE_ENABLED,
  SPRINT_LLM_JUDGE_PHASES,
} from '../../config';
import { parseCsvList } from '../../utils/env';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { getErrorMessage } from '../../utils/errorMessage';
// ──── Types ───────────────────────────────────────────────────────────────────

export type JudgeScore = {
  correctness: number;   // 0-10
  completeness: number;  // 0-10
  actionability: number; // 0-10
  overall: number;       // average
  explanation: string;
  suggestions: string[];
};

export type JudgeResult = {
  phase: string;
  score: JudgeScore;
  durationMs: number;
  judgedAt: string;
};

// ──── Config ──────────────────────────────────────────────────────────────────

const JUDGE_PHASES = new Set(parseCsvList(SPRINT_LLM_JUDGE_PHASES));

export const isJudgePhase = (phase: string): boolean =>
  SPRINT_LLM_JUDGE_ENABLED && JUDGE_PHASES.has(phase);

// ──── Core ────────────────────────────────────────────────────────────────────

/**
 * Score a phase output using LLM-as-Judge.
 * Returns null if judging is disabled or fails.
 */
export const judgePhaseOutput = async (params: {
  phase: string;
  objective: string;
  output: string;
  artifacts: string[];
}): Promise<JudgeResult | null> => {
  if (!SPRINT_LLM_JUDGE_ENABLED || !isAnyLlmConfigured()) {
    return null;
  }

  if (!JUDGE_PHASES.has(params.phase)) {
    return null;
  }

  const start = Date.now();

  const system = [
    'You are a quality judge evaluating AI-generated sprint phase output.',
    'Score on three dimensions (0-10 each):',
    '',
    '**Correctness** (0-10): Is the output factually accurate? No hallucinated code, no wrong APIs.',
    '**Completeness** (0-10): Does it address all aspects of the objective? Any gaps?',
    '**Actionability** (0-10): Can the next phase act on this output directly? Clear enough to proceed?',
    '',
    'Respond in EXACTLY this JSON format (no markdown wrapping):',
    '{"correctness":N,"completeness":N,"actionability":N,"explanation":"...","suggestions":["..."]}',
  ].join('\n');

  const user = [
    `Phase: ${params.phase}`,
    `Objective: ${params.objective}`,
    '',
    'Output to judge:',
    params.output.slice(0, 3000),
    '',
    params.artifacts.length > 0
      ? `Artifacts:\n${params.artifacts.map((a) => a.slice(0, 500)).join('\n---\n')}`
      : '',
  ].join('\n');

  try {
    const raw = await generateText({
      system,
      user,
      actionName: 'sprint.llm-judge',
      temperature: 0.1,
      maxTokens: 500,
    });

    const score = parseJudgeResponse(raw);
    if (!score) {
      logger.warn('[LLM-JUDGE] failed to parse response for phase=%s', params.phase);
      return null;
    }

    const result: JudgeResult = {
      phase: params.phase,
      score,
      durationMs: Date.now() - start,
      judgedAt: new Date().toISOString(),
    };

    logger.info(
      '[LLM-JUDGE] phase=%s correctness=%d completeness=%d actionability=%d overall=%.1f duration=%dms',
      params.phase, score.correctness, score.completeness, score.actionability, score.overall, result.durationMs,
    );

    return result;
  } catch (error) {
    logger.warn(
      '[LLM-JUDGE] evaluation failed (non-fatal): %s',
      getErrorMessage(error),
    );
    return null;
  }
};

/**
 * Format judge result as an appendix for the phase output.
 */
export const formatJudgeAppendix = (result: JudgeResult): string => {
  const { score } = result;
  const lines = [
    '',
    `## Quality Score (LLM-as-Judge, ${result.durationMs}ms)`,
    '',
    `| Dimension | Score |`,
    `|-----------|-------|`,
    `| Correctness | ${score.correctness}/10 |`,
    `| Completeness | ${score.completeness}/10 |`,
    `| Actionability | ${score.actionability}/10 |`,
    `| **Overall** | **${score.overall.toFixed(1)}/10** |`,
    '',
    score.explanation,
    '',
  ];

  if (score.suggestions.length > 0) {
    lines.push('### Improvement Suggestions');
    lines.push(...score.suggestions.map((s) => `- ${s}`));
  }

  return lines.join('\n');
};

// ──── Parser ──────────────────────────────────────────────────────────────────

const clampScore = (n: unknown): number => {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10, Math.round(num)));
};

const parseJudgeResponse = (raw: string): JudgeScore | null => {
  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const correctness = clampScore(parsed.correctness);
    const completeness = clampScore(parsed.completeness);
    const actionability = clampScore(parsed.actionability);
    const overall = (correctness + completeness + actionability) / 3;
    const explanation = String(parsed.explanation || '').slice(0, 500);
    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.map((s) => String(s).slice(0, 200)).slice(0, 5)
      : [];

    return { correctness, completeness, actionability, overall, explanation, suggestions };
  } catch {
    return null;
  }
};
