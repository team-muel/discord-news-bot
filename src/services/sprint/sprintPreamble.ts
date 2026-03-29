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
import { loadWorkflowReconfigHints, formatReconfigHintsForPreamble } from './sprintLearningJournal';
import { buildToolCatalogPrompt } from '../skills/actions/registry';
import type { ActionCategory } from '../skills/actions/types';
import type { ActionExecutionResult } from '../skills/actions/types';

// ──── Phase → tool category mapping (Cline-inspired variant config) ───────────

const PHASE_TOOL_CATEGORIES: Record<string, ActionCategory[]> = {
  plan:      ['agent', 'data'],
  implement: ['code', 'tool', 'data'],
  review:    ['data', 'content', 'code'],
  qa:        ['code', 'tool'],
  'security-audit': ['code', 'tool'],
  'ops-validate':   ['ops', 'data', 'tool'],
  ship:      ['ops', 'code'],
  retro:     ['data', 'agent'],
};

// ──── Phase tool enforcement (Cline PLAN_MODE_RESTRICTED_TOOLS pattern) ───────
// Hard-block: actions in restricted categories cannot execute during certain phases.
// plan phase → block 'code' and 'tool' (read-only planning only)
// retro phase → block 'code' (reflection only, no mutations)

const PHASE_BLOCKED_CATEGORIES: Record<string, ActionCategory[]> = {
  plan:  ['code', 'tool'],
  retro: ['code', 'tool'],
};

/**
 * Check if an action category is blocked in the given phase.
 * Returns a rejection reason string if blocked, null if allowed.
 */
export const isActionBlockedInPhase = (
  phase: string,
  actionCategory: ActionCategory | undefined,
): string | null => {
  if (!actionCategory) return null; // uncategorised actions are allowed
  const blocked = PHASE_BLOCKED_CATEGORIES[phase];
  if (!blocked) return null;
  if (blocked.includes(actionCategory)) {
    return `Action category "${actionCategory}" is restricted in phase "${phase}". Switch to an appropriate phase first.`;
  }
  return null;
};

// ──── Post-action context accumulator (Cline hook_context pattern) ─────────────
// Accumulates action results within a sprint for injection into subsequent phase prompts.

type AccumulatedContext = {
  actionName: string;
  phase: string;
  summary: string;
  ok: boolean;
  storedAt: number;
};

const sprintContextStore = new Map<string, AccumulatedContext[]>();
const MAX_CONTEXT_PER_SPRINT = 30;
const MAX_SPRINT_CONTEXT_ENTRIES = 100;

/** Record an action result so later phases can reference it. */
export const accumulateActionContext = (
  sprintId: string,
  phase: string,
  result: ActionExecutionResult,
): void => {
  let entries = sprintContextStore.get(sprintId);
  if (!entries) {
    entries = [];
    sprintContextStore.set(sprintId, entries);
  }
  entries.push({
    actionName: result.name,
    phase,
    summary: result.summary.slice(0, 500),
    ok: result.ok,
    storedAt: Date.now(),
  });
  while (entries.length > MAX_CONTEXT_PER_SPRINT) entries.shift();
  // Bound overall map size
  if (sprintContextStore.size > MAX_SPRINT_CONTEXT_ENTRIES) {
    const oldest = sprintContextStore.keys().next().value;
    if (oldest !== undefined) sprintContextStore.delete(oldest);
  }
};

/** Build a context section from accumulated action results for a sprint. */
export const getAccumulatedContextSection = (sprintId: string, maxItems = 10): string => {
  const entries = sprintContextStore.get(sprintId);
  if (!entries || entries.length === 0) return '';
  const recent = entries.slice(-maxItems);
  const lines = recent.map(
    (e) => `- [${e.ok ? 'OK' : 'FAIL'}] ${e.actionName} (${e.phase}): ${e.summary.slice(0, 200)}`,
  );
  return [
    '## Action Context (accumulated)',
    'Previous action results in this sprint:',
    ...lines,
    '',
  ].join('\n');
};

/** Clear context for a completed sprint. */
export const clearSprintContext = (sprintId: string): void => {
  sprintContextStore.delete(sprintId);
};

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

const MAX_ACTIVE_SESSIONS = 500;

export const trackSprintSession = (sprintId: string): void => {
  if (activeSessions.size >= MAX_ACTIVE_SESSIONS && !activeSessions.has(sprintId)) {
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
    for (const [id, lastActive] of activeSessions) {
      if (lastActive <= twoHoursAgo) activeSessions.delete(id);
    }
  }
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

  // Phase-filtered tool catalog (Cline-inspired: variant → tools)
  const phaseCategories = PHASE_TOOL_CATEGORIES[phase];
  if (phaseCategories) {
    const toolSection = buildToolCatalogPrompt({ categories: phaseCategories });
    if (toolSection) {
      sections.push(toolSection, '');
    }
  }

  // Accumulated action context from prior phases (Cline hook_context pattern)
  const accContext = getAccumulatedContextSection(sprintId);
  if (accContext) {
    sections.push(accContext, '');
  }

  // Phase tool restriction notice (Cline PLAN_MODE_RESTRICTED_TOOLS pattern)
  const blockedCats = PHASE_BLOCKED_CATEGORIES[phase];
  if (blockedCats && blockedCats.length > 0) {
    sections.push(
      '## Restricted Tool Categories',
      `The following tool categories are **blocked** in the "${phase}" phase: ${blockedCats.join(', ')}.`,
      'Attempting to use actions in these categories will be rejected. Use only the tools listed above.',
      '',
    );
  }

  return sections.join('\n');
};

// ──── Async preamble enrichment (Obsidian journal) ────────────────────────────

/**
 * Load workflow reconfiguration hints from Obsidian journal.
 * Called once during plan phase to inject adaptive proposals.
 * Returns empty string if journal is unavailable or has insufficient data.
 */
export const loadJournalPreambleSection = async (): Promise<string> => {
  try {
    const hints = await loadWorkflowReconfigHints();
    if (!hints) return '';
    return formatReconfigHintsForPreamble(hints);
  } catch {
    return '';
  }
};
