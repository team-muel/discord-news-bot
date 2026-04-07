/**
 * Cross-model outside voice for sprint review phases.
 *
 * Sends the same content to a secondary LLM and returns an independent
 * review to cross-verify findings. Reduces blind spots from single-model bias.
 *
 * Inspired by gstack's /codex cross-model review (v0.9.9.1).
 */

import logger from '../../logger';
import {
  SPRINT_CROSS_MODEL_ENABLED,
  SPRINT_CROSS_MODEL_PROVIDER,
  SPRINT_CROSS_MODEL_PHASES,
  SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED,
} from '../../config';
import { parseCsvList } from '../../utils/env';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { executeExternalAction } from '../tools/externalAdapterRegistry';
import { getErrorMessage } from '../../utils/errorMessage';

export type CrossModelResult = {
  enabled: boolean;
  provider: string;
  review: string;
  agreements: string[];
  disagreements: string[];
  durationMs: number;
};

// ──── Helpers ─────────────────────────────────────────────────────────────────

const ENABLED_PHASES = new Set(parseCsvList(SPRINT_CROSS_MODEL_PHASES));

export const isCrossModelPhase = (phase: string): boolean =>
  SPRINT_CROSS_MODEL_ENABLED && ENABLED_PHASES.has(phase);

// ──── Core ────────────────────────────────────────────────────────────────────

/**
 * Request an independent review from a secondary model.
 * Returns null if cross-model is disabled or not configured.
 */
export const requestCrossModelReview = async (params: {
  phase: string;
  primaryOutput: string;
  objective: string;
  changedFiles: string[];
}): Promise<CrossModelResult | null> => {
  if (!SPRINT_CROSS_MODEL_ENABLED || !isAnyLlmConfigured()) {
    return null;
  }

  if (!ENABLED_PHASES.has(params.phase)) {
    return null;
  }

  const start = Date.now();

  const system = [
    'You are an independent code reviewer providing a second opinion.',
    'Another AI model has already reviewed this code. Your job:',
    '1. Independently assess the same changes.',
    '2. List points where you AGREE with the primary review.',
    '3. List points where you DISAGREE or see something the primary review missed.',
    '4. Be specific: reference file names, function names, line patterns.',
    '',
    'Format your response as:',
    '## Independent Review',
    '[your assessment]',
    '',
    '## Agreements',
    '- [point 1]',
    '',
    '## Disagreements',
    '- [point 1]',
  ].join('\n');

  const user = [
    `## Objective`,
    params.objective,
    '',
    `## Changed Files`,
    params.changedFiles.join('\n'),
    '',
    `## Primary Review Output`,
    params.primaryOutput.slice(0, 3000),
  ].join('\n');

  try {
    // ── NemoClaw sandbox path: fault-isolated independent review ──
    if (SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED) {
      try {
        const codePayload = [
          `## Objective\n${params.objective}`,
          `## Changed Files\n${params.changedFiles.join('\n')}`,
          `## Primary Review Output\n${params.primaryOutput.slice(0, 3000)}`,
        ].join('\n\n');

        const adapterResult = await executeExternalAction('nemoclaw', 'code.review', {
          code: codePayload,
          goal: `Independent cross-model review for phase "${params.phase}": assess, agree/disagree with primary review.`,
        });

        if (adapterResult.ok && adapterResult.output.length > 0) {
          const raw = adapterResult.output.join('\n').slice(0, 3000);
          const agreements = extractSection(raw, 'Agreements');
          const disagreements = extractSection(raw, 'Disagreements');

          logger.info(
            '[CROSS-MODEL] nemoclaw sandbox review: phase=%s duration=%dms',
            params.phase, adapterResult.durationMs,
          );

          return {
            enabled: true,
            provider: 'nemoclaw-sandbox',
            review: raw,
            agreements: agreements.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
            disagreements: disagreements.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
            durationMs: adapterResult.durationMs,
          };
        }
        logger.info('[CROSS-MODEL] nemoclaw adapter unavailable or empty, falling through to LLM path');
      } catch (nemoclawErr) {
        logger.warn('[CROSS-MODEL] nemoclaw sandbox failed (non-fatal): %s', getErrorMessage(nemoclawErr));
      }
    }

    // ── LLM path: configured provider (muel-nemotron default) ──
    const modelOverride = SPRINT_CROSS_MODEL_PROVIDER || 'muel-nemotron';
    const raw = await generateText({
      system,
      user,
      actionName: 'sprint.cross-model-review',
      temperature: 0.3,
      maxTokens: 1500,
      model: modelOverride,
    });

    const agreements = extractSection(raw, 'Agreements');
    const disagreements = extractSection(raw, 'Disagreements');

    const result: CrossModelResult = {
      enabled: true,
      provider: SPRINT_CROSS_MODEL_PROVIDER || 'muel-nemotron',
      review: raw.slice(0, 3000),
      agreements: agreements.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
      disagreements: disagreements.split('\n').filter((l) => l.startsWith('-')).map((l) => l.slice(1).trim()),
      durationMs: Date.now() - start,
    };

    logger.info(
      '[CROSS-MODEL] phase=%s agreements=%d disagreements=%d duration=%dms',
      params.phase, result.agreements.length, result.disagreements.length, result.durationMs,
    );

    return result;
  } catch (error) {
    logger.warn(
      '[CROSS-MODEL] review failed (non-fatal): %s',
      getErrorMessage(error),
    );
    return null;
  }
};

/**
 * Format cross-model result as an appendix to append to the primary output.
 */
export const formatCrossModelAppendix = (result: CrossModelResult): string => {
  const lines = [
    '',
    `## Cross-Model Review (${result.provider}, ${result.durationMs}ms)`,
    '',
    result.review,
    '',
  ];

  if (result.disagreements.length > 0) {
    lines.push(
      '### Disagreements Requiring Attention',
      ...result.disagreements.map((d) => `- ⚠ ${d}`),
      '',
    );
  }

  return lines.join('\n');
};

// ──── Internal ────────────────────────────────────────────────────────────────

const extractSection = (text: string, heading: string): string => {
  const regex = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
};
