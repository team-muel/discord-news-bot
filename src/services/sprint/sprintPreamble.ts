/**
 * Sprint Preamble — common preprocessing injected before every phase.
 *
 * Inspired by gstack's {{PREAMBLE}} pattern:
 * 1. Session context (parallel sprint awareness)
 * 2. Search Before Building (3-layer knowledge)
 * 3. Actionable question format
 * 4. Meta-cognitive instructions
 */

import { SPRINT_AUTOPLAN_ENABLED } from '../../config';

// ──── Learning context store (C-17/18: optimize/bench feedback loop) ──────────

type LearningInsight = {
  sprintId: string;
  storedAt: string;
  optimizeHints: string[];
  benchResults: string[];
};

const LEARNING_MAX_ENTRIES = 20;
const learningStore: LearningInsight[] = [];

/** Store optimization and benchmark insights from retro phase self-learning loop. */
export const storeLearningInsight = (insight: LearningInsight): void => {
  learningStore.push(insight);
  while (learningStore.length > LEARNING_MAX_ENTRIES) {
    learningStore.shift();
  }
};

/** Get recent learning insights for injection into plan phase. */
export const getRecentLearningContext = (maxEntries = 5): string => {
  if (learningStore.length === 0) return '';
  const recent = learningStore.slice(-maxEntries);
  const lines = recent.flatMap((insight) => {
    const parts: string[] = [`- Sprint ${insight.sprintId} (${insight.storedAt}):`];
    if (insight.optimizeHints.length > 0) {
      parts.push(`  Optimize: ${insight.optimizeHints.slice(0, 3).join('; ')}`);
    }
    if (insight.benchResults.length > 0) {
      parts.push(`  Bench: ${insight.benchResults.slice(0, 3).join('; ')}`);
    }
    return parts;
  });
  return lines.join('\n');
};

// ──── Session tracking ────────────────────────────────────────────────────────

const activeSessions = new Map<string, number>(); // sprintId → lastActiveAt

export const trackSprintSession = (sprintId: string): void => {
  activeSessions.set(sprintId, Date.now());
};

export const getActiveSessionCount = (): number => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
  let count = 0;
  for (const [id, lastActive] of activeSessions) {
    if (lastActive > twoHoursAgo) {
      count++;
    } else {
      activeSessions.delete(id);
    }
  }
  return count;
};

// ──── Preamble builder ────────────────────────────────────────────────────────

const SEARCH_BEFORE_BUILDING = [
  '## Search Before Building',
  'Before building anything involving unfamiliar patterns or infrastructure:',
  '1. Layer 1 (Tried & True): Check if the runtime/framework already has a built-in.',
  '2. Layer 2 (New & Popular): Search recent best practices — but scrutinize trends critically.',
  '3. Layer 3 (First Principles): Reason from the specific problem. If conventional wisdom is wrong, name the insight.',
  '',
  'The cost of checking is near-zero. The cost of not checking is reinventing something worse.',
].join('\n');

const ACTIONABLE_QUESTION_FORMAT = [
  '## Question Format',
  'When asking for decisions, use this structure:',
  '- CONTEXT: What you found and why it matters.',
  '- QUESTION: One specific decision to make.',
  '- RECOMMENDATION: "Choose X because ___"',
  '- OPTIONS: (A) ..., (B) ..., (C) ...',
].join('\n');

const BOIL_THE_LAKE = [
  '## Completeness',
  'AI-assisted coding makes the marginal cost of completeness near-zero.',
  'When the complete implementation costs minutes more than the shortcut — do the complete thing.',
  'Do not defer tests. Do not skip edge cases. Do not choose 90% when 100% costs 70 more lines.',
].join('\n');

const META_COGNITIVE = [
  '## Meta-Cognitive Rules',
  '- If you discover a repeated pattern of failure, log it in the sprint output as a PATTERN note.',
  '- If first-principles reasoning reveals the conventional approach is wrong, name the EUREKA moment.',
  '- All errors must include what went wrong AND what to do next (AI-actionable errors).',
].join('\n');

/**
 * Build the preamble that gets prepended to every phase's system prompt.
 */
export const buildSprintPreamble = (sprintId: string, phase: string): string => {
  trackSprintSession(sprintId);
  const sessionCount = getActiveSessionCount();

  const sections: string[] = [
    `# Sprint Preamble (${phase})`,
    '',
  ];

  // Multi-session awareness (gstack's ELI16 mode)
  if (sessionCount >= 3) {
    sections.push(
      '## Multi-Sprint Mode',
      `${sessionCount} sprints are active. Re-ground context at each step: state the objective, current phase, and last result before proceeding.`,
      '',
    );
  }

  // Search Before Building (phases that involve creation)
  if (['plan', 'implement'].includes(phase)) {
    sections.push(SEARCH_BEFORE_BUILDING, '');
  }

  // Boil the Lake (implementation phases)
  if (['implement', 'review', 'qa'].includes(phase)) {
    sections.push(BOIL_THE_LAKE, '');
  }

  // Always include meta-cognitive and question format
  sections.push(META_COGNITIVE, '');
  sections.push(ACTIONABLE_QUESTION_FORMAT, '');

  // Autoplan hint for plan phase
  if (phase === 'plan' && SPRINT_AUTOPLAN_ENABLED) {
    sections.push(
      '## Autoplan Active',
      'This plan will be reviewed from CEO, engineering, and security lenses automatically.',
      'Focus on the technical plan — strategic and security reviews will follow.',
      '',
    );
  }

  // Learning context from previous sprints' retro → optimize → bench results
  if (phase === 'plan') {
    const learningContext = getRecentLearningContext();
    if (learningContext) {
      sections.push(
        '## Learning From Previous Sprints',
        'Recent optimization insights and benchmark results from past sprints:',
        learningContext,
        '',
        'Use these insights to avoid known issues and build on proven patterns.',
        '',
      );
    }
  }

  return sections.join('\n');
};
