/**
 * AI-actionable error guidance for sprint phase failures.
 *
 * gstack philosophy: "Errors are for AI agents, not humans."
 * Every error includes what went wrong AND what to do next.
 */

import type { SprintPhase } from './sprintOrchestrator';

type ActionableGuidance = {
  summary: string;
  nextAction: string;
  suggestedPhase: SprintPhase | null;
};

const PHASE_FAILURE_GUIDANCE: Record<string, (rawError: string) => ActionableGuidance> = {
  plan: (err) => ({
    summary: `Plan phase failed: ${err.slice(0, 200)}`,
    nextAction: 'Rephrase the objective with more specificity. Include concrete acceptance criteria and constraints.',
    suggestedPhase: null,
  }),

  implement: (err) => {
    if (err.includes('OBJECTIVE_EMPTY')) {
      return {
        summary: 'Implement phase received empty objective.',
        nextAction: 'Re-run /plan with a concrete objective. The plan output must include files-to-change and approach.',
        suggestedPhase: 'plan',
      };
    }
    if (err.includes('timed out')) {
      return {
        summary: 'Implement phase timed out — the change scope may be too large.',
        nextAction: 'Split the objective into smaller sub-tasks (max 5 files per sprint). Re-run /plan with narrower scope.',
        suggestedPhase: 'plan',
      };
    }
    return {
      summary: `Implement phase failed: ${err.slice(0, 200)}`,
      nextAction: 'Check the error output. If it is a dependency issue, run `npm install` first. If code error, review the plan constraints.',
      suggestedPhase: 'plan',
    };
  },

  review: (err) => ({
    summary: `Review found critical issues: ${err.slice(0, 200)}`,
    nextAction: 'Return to /implement and address each finding. The review output contains specific line references — fix them in order.',
    suggestedPhase: 'implement',
  }),

  qa: (err) => {
    if (err.includes('exit code')) {
      const exitMatch = err.match(/exit code (\d+)/);
      const code = exitMatch ? exitMatch[1] : 'non-zero';
      return {
        summary: `QA tests failed with exit code ${code}.`,
        nextAction: `Run \`npx vitest run\` locally to see full output. Fix failing tests, then re-run from /implement. Common causes: missing imports, type errors, async timing.`,
        suggestedPhase: 'implement',
      };
    }
    return {
      summary: `QA phase failed: ${err.slice(0, 200)}`,
      nextAction: 'Check test output for specific failures. If no tests exist, the /implement phase should have created them.',
      suggestedPhase: 'implement',
    };
  },

  'security-audit': (err) => ({
    summary: `Security audit found vulnerabilities: ${err.slice(0, 200)}`,
    nextAction: 'Each finding includes an exploit scenario and fix. Apply fixes in /implement, prioritizing OWASP Top 10 issues.',
    suggestedPhase: 'implement',
  }),

  'ops-validate': (err) => {
    if (err.includes('type error')) {
      const countMatch = err.match(/(\d+) type error/);
      const count = countMatch ? countMatch[1] : 'multiple';
      return {
        summary: `TypeCheck failed with ${count} type error(s).`,
        nextAction: `Run \`npx tsc --noEmit\` to see full errors. Fix type mismatches in /implement. Common: missing imports, wrong argument counts, null checks.`,
        suggestedPhase: 'implement',
      };
    }
    return {
      summary: `Ops validation failed: ${err.slice(0, 200)}`,
      nextAction: 'Check the build output. If deployment config issue, verify render.yaml and env vars. If runtime issue, check server.ts startup.',
      suggestedPhase: 'implement',
    };
  },

  ship: (err) => {
    if (err.includes('branch creation failed') || err.includes('Git integration not configured')) {
      return {
        summary: 'Ship failed: Git integration unavailable.',
        nextAction: 'Set SPRINT_GIT_ENABLED=true and configure SPRINT_GITHUB_TOKEN/OWNER/REPO. Then re-run /ship.',
        suggestedPhase: null,
      };
    }
    if (err.includes('PR creation failed')) {
      return {
        summary: 'Ship failed at PR creation.',
        nextAction: 'Branch and commit succeeded. Manually create the PR, or check GitHub API permissions (SPRINT_GITHUB_TOKEN needs repo scope).',
        suggestedPhase: null,
      };
    }
    return {
      summary: `Ship failed: ${err.slice(0, 200)}`,
      nextAction: 'Check Git credentials and network. If all gates passed, the issue is infrastructure — not code quality.',
      suggestedPhase: null,
    };
  },

  retro: (err) => ({
    summary: `Retro phase failed: ${err.slice(0, 200)}`,
    nextAction: 'Retro is non-blocking. The sprint changes are already shipped. Review phase results manually if retro LLM is unavailable.',
    suggestedPhase: null,
  }),
};

/**
 * Transform a raw error into AI-actionable guidance with specific next steps.
 */
export const makeActionableError = (phase: SprintPhase, rawError: string): ActionableGuidance => {
  const handler = PHASE_FAILURE_GUIDANCE[phase];
  if (handler) {
    return handler(rawError);
  }
  return {
    summary: `Phase ${phase} failed: ${rawError.slice(0, 200)}`,
    nextAction: 'Check the error output and retry. If the error persists, cancel the sprint and investigate manually.',
    suggestedPhase: null,
  };
};

/**
 * Format an actionable error into a string suitable for PhaseResult.output
 */
export const formatActionableOutput = (phase: SprintPhase, rawError: string): string => {
  const guidance = makeActionableError(phase, rawError);
  return [
    guidance.summary,
    '',
    `NEXT_ACTION: ${guidance.nextAction}`,
    guidance.suggestedPhase ? `SUGGESTED_PHASE: ${guidance.suggestedPhase}` : '',
  ].filter(Boolean).join('\n');
};
