/**
 * Autoplan sub-pipeline — multi-lens plan review.
 *
 * Inspired by gstack's /autoplan:
 *   CEO review → Design review → Eng review → synthesize
 *
 * Runs the plan through multiple "lenses" automatically,
 * surfacing only taste decisions for human approval.
 */

import logger from '../../logger';
import {
  SPRINT_AUTOPLAN_ENABLED,
  SPRINT_AUTOPLAN_LENSES,
} from '../../config';
import { generateText, isAnyLlmConfigured } from '../llmClient';

// ──── Types ───────────────────────────────────────────────────────────────────

export type PlanLens = 'ceo' | 'engineering' | 'security' | 'design';

export type LensReview = {
  lens: PlanLens;
  verdict: 'approve' | 'refine' | 'reject';
  feedback: string;
  tasteDecisions: string[];
  durationMs: number;
};

export type AutoplanResult = {
  reviews: LensReview[];
  synthesizedFeedback: string;
  requiresHumanDecision: boolean;
  tasteDecisions: string[];
  totalDurationMs: number;
};

// ──── Config ──────────────────────────────────────────────────────────────────

const CONFIGURED_LENSES = SPRINT_AUTOPLAN_LENSES
  .split(',').map((l) => l.trim()).filter(Boolean) as PlanLens[];

// ──── Lens system prompts ─────────────────────────────────────────────────────

const LENS_PROMPTS: Record<PlanLens, string> = {
  ceo: [
    'You are a CEO/Founder reviewing a technical plan.',
    'Your job: rethink the problem scope. Is this the right thing to build?',
    '- Challenge the framing. Is the user solving the right problem?',
    '- Look for the 10-star product hiding inside the request.',
    '- Consider: should scope expand, hold, or reduce?',
    '- Flag any taste decisions that need human input.',
    '',
    'Respond as JSON: {"verdict":"approve|refine|reject","feedback":"...","tasteDecisions":["..."]}',
  ].join('\n'),

  engineering: [
    'You are a Staff Engineer reviewing a technical plan.',
    'Your job: lock in architecture, data flow, edge cases, and tests.',
    '- Draw out hidden assumptions.',
    '- Identify failure modes and error paths.',
    '- Check: are tests included? Are edge cases covered?',
    '- Flag any architectural decisions that could paint us into a corner.',
    '',
    'Respond as JSON: {"verdict":"approve|refine|reject","feedback":"...","tasteDecisions":["..."]}',
  ].join('\n'),

  security: [
    'You are a CSO reviewing a technical plan for security implications.',
    '- OWASP Top 10 and STRIDE threat model against the proposed changes.',
    '- Check auth boundaries, input validation, data exposure.',
    '- Only flag concrete concerns (8/10+ confidence), not theoretical ones.',
    '',
    'Respond as JSON: {"verdict":"approve|refine|reject","feedback":"...","tasteDecisions":["..."]}',
  ].join('\n'),

  design: [
    'You are a Senior Designer reviewing a plan for user experience.',
    '- Rate clarity and coherence of the user-facing changes.',
    '- Check for AI slop: is this genuinely useful or just generated filler?',
    '- Flag UX decisions that require human taste judgment.',
    '',
    'Respond as JSON: {"verdict":"approve|refine|reject","feedback":"...","tasteDecisions":["..."]}',
  ].join('\n'),
};

// ──── Core ────────────────────────────────────────────────────────────────────

/**
 * Run the plan through all configured lenses.
 * Returns null if autoplan is disabled.
 */
export const runAutoplan = async (params: {
  planOutput: string;
  objective: string;
}): Promise<AutoplanResult | null> => {
  if (!SPRINT_AUTOPLAN_ENABLED || !isAnyLlmConfigured()) {
    return null;
  }

  if (CONFIGURED_LENSES.length === 0) {
    return null;
  }

  const totalStart = Date.now();
  const reviews: LensReview[] = [];

  // Run lenses sequentially (each may depend on context of the plan)
  for (const lens of CONFIGURED_LENSES) {
    const lensPrompt = LENS_PROMPTS[lens];
    if (!lensPrompt) continue;

    const start = Date.now();
    try {
      const raw = await generateText({
        system: lensPrompt,
        user: [
          `## Objective`,
          params.objective,
          '',
          `## Plan`,
          params.planOutput.slice(0, 4000),
        ].join('\n'),
        actionName: `sprint.autoplan.${lens}`,
        temperature: 0.3,
        maxTokens: 800,
      });

      const parsed = parseLensResponse(raw, lens);
      reviews.push({
        ...parsed,
        durationMs: Date.now() - start,
      });

      logger.info('[AUTOPLAN] lens=%s verdict=%s duration=%dms', lens, parsed.verdict, Date.now() - start);
    } catch (error) {
      logger.warn('[AUTOPLAN] lens=%s failed (non-fatal): %s', lens, error instanceof Error ? error.message : String(error));
      reviews.push({
        lens,
        verdict: 'approve',
        feedback: `Lens ${lens} evaluation failed — proceeding without this review.`,
        tasteDecisions: [],
        durationMs: Date.now() - start,
      });
    }
  }

  // Collect all taste decisions
  const allTasteDecisions = reviews.flatMap((r) => r.tasteDecisions);
  const hasReject = reviews.some((r) => r.verdict === 'reject');
  const hasRefine = reviews.some((r) => r.verdict === 'refine');

  // Synthesize feedback
  const synthesized = reviews
    .map((r) => `### ${r.lens.toUpperCase()} (${r.verdict})\n${r.feedback}`)
    .join('\n\n');

  return {
    reviews,
    synthesizedFeedback: synthesized,
    requiresHumanDecision: hasReject || allTasteDecisions.length > 0,
    tasteDecisions: allTasteDecisions,
    totalDurationMs: Date.now() - totalStart,
  };
};

/**
 * Format autoplan result as an appendix to the plan output.
 */
export const formatAutoplanAppendix = (result: AutoplanResult): string => {
  const lines = [
    '',
    `## Autoplan Review (${result.reviews.length} lenses, ${result.totalDurationMs}ms)`,
    '',
    result.synthesizedFeedback,
    '',
  ];

  if (result.tasteDecisions.length > 0) {
    lines.push(
      '### Taste Decisions (requires human input)',
      ...result.tasteDecisions.map((d, i) => `${i + 1}. ${d}`),
      '',
    );
  }

  const verdictSummary = result.reviews.map((r) => `${r.lens}=${r.verdict}`).join(', ');
  lines.push(`**Summary**: ${verdictSummary}`);

  return lines.join('\n');
};

// ──── Parser ──────────────────────────────────────────────────────────────────

const parseLensResponse = (raw: string, lens: PlanLens): Omit<LensReview, 'durationMs'> => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      lens,
      verdict: 'refine',
      feedback: `[parse-failed] ${raw.slice(0, 1000)}`,
      tasteDecisions: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const verdict = ['approve', 'refine', 'reject'].includes(String(parsed.verdict))
      ? (String(parsed.verdict) as 'approve' | 'refine' | 'reject')
      : 'refine';

    return {
      lens,
      verdict,
      feedback: String(parsed.feedback || '').slice(0, 1500),
      tasteDecisions: Array.isArray(parsed.tasteDecisions)
        ? parsed.tasteDecisions.map((d) => String(d).slice(0, 200)).slice(0, 5)
        : [],
    };
  } catch {
    return {
      lens,
      verdict: 'refine',
      feedback: `[parse-failed] ${raw.slice(0, 1000)}`,
      tasteDecisions: [],
    };
  }
};
