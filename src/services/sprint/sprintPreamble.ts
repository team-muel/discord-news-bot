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
import type { ActionCategory, ActionExecutionResult } from '../skills/actions/types';
import { getObsidianKnowledgeControlSurface } from '../obsidian/knowledgeCompilerService';
import { loadOperatingBaseline, summarizeOperatingBaseline } from '../runtime/operatingBaseline';

// ──── Phase → tool category mapping (Cline-inspired variant config) ───────────

const PHASE_TOOL_CATEGORIES: Record<string, ActionCategory[]> = {
  plan:      ['agent', 'data'],
  implement: ['code', 'tool', 'data', 'automation'],
  review:    ['data', 'content', 'code'],
  qa:        ['code', 'tool'],
  'security-audit': ['code', 'tool'],
  'ops-validate':   ['ops', 'data', 'tool', 'automation'],
  ship:      ['ops', 'code', 'automation'],
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
  actionCategory: ActionCategory,
): string | null => {
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
  benchScore?: number | null;
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

/** Number of accumulated learning insights (used to gate optimize calls). */
export const getLearningInsightCount = (): number => learningStore.length;

/** Get recent learning insights for injection into plan phase. */
export const getRecentLearningContext = (maxEntries = 5): string => {
  if (learningStore.length === 0) return '';
  const recent = learningStore.slice(-maxEntries);
  const lines = recent.flatMap((insight) => {
    const parts: string[] = [`- Sprint ${insight.sprintId} (${insight.storedAt}):`];
    if (insight.benchScore != null && Number.isFinite(insight.benchScore)) {
      parts.push(`  BenchScore: ${insight.benchScore}`);
    }
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
  '## Search Before Building — Reuse First',
  'Before creating ANY new file, function, or service:',
  '1. **Reuse Gate**: Search existing codebase for a service that already does 70%+ of what you need. Extend it.',
  '2. Layer 1 (Tried & True): Check if the runtime/framework already has a built-in.',
  '3. Layer 2 (New & Popular): Search recent best practices — but scrutinize trends critically.',
  '4. Layer 3 (First Principles): Reason from the specific problem. If conventional wisdom is wrong, name the insight.',
  '',
  '### New File Creation Rules',
  '- New files per sprint are HARD-CAPPED (default: 3). The scope guard enforces this.',
  '- Before creating a new file, you MUST cite 3 existing files you searched and explain why none suffices.',
  '- Test files (.test.ts) for modified code do NOT count toward the cap.',
  '- If you hit the cap, STOP and extend an existing file instead.',
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

// ──── Live System State Injection ─────────────────────────────────────────────

/**
 * Query live observations + intents and build a system-state context section.
 * Injected into plan/implement phases so the agent knows what's currently
 * broken, what was already tried, and what patterns are recurring.
 *
 * Never throws — all queries are best-effort.
 */
export const buildLiveStateSection = async (
  guildId: string,
  phase: string,
): Promise<string> => {
  // Only inject for decision-making phases
  if (!['plan', 'implement', 'review'].includes(phase)) return '';

  const sections: string[] = [];

  try {
    const { getRecentObservations } = await import('../observer/observationStore');
    const observations = await getRecentObservations({
      guildId,
      unconsumedOnly: true,
      limit: 10,
    });
    if (observations.length > 0) {
      const obsLines = observations.map(
        (o) => `- [${o.severity}] ${o.channel}: ${o.title}`,
      );
      sections.push(
        '### Active Observations',
        `${observations.length} unconsumed observations detected:`,
        ...obsLines,
      );
    }
  } catch { /* best-effort */ }

  try {
    const { getIntents } = await import('../intent/intentStore');

    // Recent rejected intents (avoid repeating what failed)
    const failed = await getIntents({ guildId, status: 'rejected', limit: 5 });
    if (failed.length > 0) {
      const failLines = failed.map(
        (i) => `- [${i.ruleId}] ${i.objective} (priority: ${i.priorityScore.toFixed(2)})`,
      );
      sections.push(
        '### Recently Failed Intents',
        'These objectives were attempted and failed — avoid repeating the same approach:',
        ...failLines,
      );
    }

    // Pending intents (know what's queued)
    const pending = await getIntents({ guildId, status: 'pending', limit: 5 });
    if (pending.length > 0) {
      const pendLines = pending.map(
        (i) => `- [${i.ruleId}] ${i.objective} (priority: ${i.priorityScore.toFixed(2)})`,
      );
      sections.push(
        '### Pending Intents',
        'These objectives are queued for execution:',
        ...pendLines,
      );
    }
  } catch { /* best-effort */ }

  if (sections.length === 0) return '';

  return [
    '## Live System State',
    `Current system state for guild ${guildId} at ${new Date().toISOString()}:`,
    '',
    ...sections,
    '',
    'Factor this context into your decisions. Do not duplicate pending work or repeat failed approaches.',
    '',
  ].join('\n');
};

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

const normalizeRepoPath = (value: string): string => String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');

export const buildKnowledgeControlPromptSection = (
  phase: string,
  changedFiles: string[],
): string => {
  if (!['plan', 'review', 'qa'].includes(phase)) {
    return '';
  }

  const surface = getObsidianKnowledgeControlSurface();
  const operatingBaseline = summarizeOperatingBaseline(loadOperatingBaseline());
  const touchedDocs = changedFiles
    .map((filePath) => normalizeRepoPath(filePath))
    .filter((filePath) => filePath.startsWith('docs/') || filePath.startsWith('retros/') || filePath === 'config/runtime/operating-baseline.json')
    .slice(0, 6);

  const sections = [
    '## Knowledge Control Context',
    `- blueprint_model: ${surface.blueprint.model}`,
    `- control_paths: ${surface.controlPaths.slice(0, 4).join(', ')}`,
    `- reflection_focus: ${surface.blueprint.reflectionChecklist.slice(0, 3).join(' | ')}`,
    `- bundle_aliases: ${surface.bundleSupport.acceptedAliases.join(', ')}`,
    `- start_here_paths: ${surface.accessProfile.startHerePaths.slice(0, 5).join(', ')}`,
    '',
    '## Operating Baseline',
    `- worker_machine: ${operatingBaseline.machineType}${operatingBaseline.memoryGb ? ` (${operatingBaseline.memoryGb}GB)` : ''}`,
    `- public_base_url: ${operatingBaseline.publicBaseUrl}`,
    `- always_on_required: ${operatingBaseline.alwaysOnRequired.join(', ')}`,
    `- local_acceleration_only: ${operatingBaseline.localAccelerationOnly.join(', ') || 'none'}`,
    `- local_hybrid_meaning: ${operatingBaseline.localHybridMeaning}`,
    `- openjarvis_role: ${operatingBaseline.openjarvisRole}`,
    '',
    '## Human-First Reference Policy',
    `- human_first: ${surface.accessProfile.humanFirst}`,
    `- operator_primary_paths: ${surface.accessProfile.operatorPrimaryPaths.slice(0, 5).join(', ')}`,
    `- agent_reference_paths: ${surface.accessProfile.agentReferencePaths.slice(0, 5).join(', ')}`,
    `- avoid_as_primary: ${surface.accessProfile.avoidAsPrimary.join(', ')}`,
    `- catalog_coverage: ${surface.accessProfile.coverage.presentEntries}/${surface.accessProfile.coverage.totalEntries}`,
    `- operator_primary_missing: ${surface.accessProfile.coverage.operatorPrimaryMissing}`,
  ];

  for (const rule of surface.accessProfile.rules.slice(0, 2)) {
    sections.push(`- rule: ${rule}`);
  }

  if (touchedDocs.length > 0) {
    sections.push('', '## Documentation Drift Watch', ...touchedDocs.map((filePath) => `- ${filePath}`));
  }

  sections.push('', 'Use this context before deciding scope, review findings, or QA acceptance criteria.');
  return sections.join('\n');
};

// ──── Phase Context Enrichment (Layer 2: cross-adapter context) ───────────────

/**
 * Phase→adapter mapping for context enrichment.
 * Each phase lists adapters + actions to invoke for additional context before execution.
 */
type PhaseEnrichmentAction = {
  adapterId: string;
  action: string;
  args: (objective: string, changedFiles: string[]) => Record<string, unknown>;
  label: string;
};

const PHASE_ENRICHMENT_MAP: Record<string, PhaseEnrichmentAction[]> = {
  plan: [
    {
      adapterId: 'deepwiki',
      action: 'wiki.read',
      args: (obj) => ({ repo: 'team-muel/discord-news-bot' }),
      label: 'Self-repo architecture overview',
    },
    {
      adapterId: 'deepwiki',
      action: 'wiki.ask',
      args: (obj) => ({ repo: 'team-muel/discord-news-bot', question: `Architecture patterns relevant to: ${obj.slice(0, 200)}` }),
      label: 'Self-wiki reference',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.research',
      args: (obj) => ({ query: `Best practices and patterns for: ${obj.slice(0, 300)}`, sources: ['github', 'docs'] }),
      label: 'Deep research (OpenJarvis)',
    },
    {
      adapterId: 'mcp-indexing',
      action: 'index.context',
      args: (obj, files) => ({ goal: obj.slice(0, 200), changedPaths: files.slice(0, 20) }),
      label: 'Code index context',
    },
  ],
  implement: [
    {
      adapterId: 'mcp-indexing',
      action: 'index.context',
      args: (obj, files) => ({ goal: obj.slice(0, 200), changedPaths: files.slice(0, 20) }),
      label: 'Code index context',
    },
    {
      adapterId: 'openclaw',
      action: 'agent.health',
      args: () => ({}),
      label: 'OpenClaw Gateway status',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.memory.search',
      args: (obj) => ({ query: obj.slice(0, 300), limit: 3 }),
      label: 'Memory knowledge search',
    },
    {
      adapterId: 'openshell',
      action: 'sandbox.list',
      args: () => ({}),
      label: 'Available sandboxes',
    },
  ],
  review: [
    {
      adapterId: 'mcp-indexing',
      action: 'index.context',
      args: (obj, files) => ({ goal: `Review: ${obj.slice(0, 180)}`, changedPaths: files.slice(0, 20), maxItems: 10 }),
      label: 'Code context bundle (changed files + symbols)',
    },
    {
      adapterId: 'mcp-indexing',
      action: 'index.references',
      args: (_obj, files) => ({ symbolId: files[0] ?? '', limit: 15 }),
      label: 'Cross-references for primary changed file',
    },
    {
      adapterId: 'litellm-admin',
      action: 'proxy.health',
      args: () => ({}),
      label: 'LLM proxy health',
    },
    {
      adapterId: 'deepwiki',
      action: 'wiki.diagnose',
      args: (obj, files) => ({
        repo: 'team-muel/discord-news-bot',
        phase: 'review',
        objective: obj.slice(0, 180),
        changedFiles: files.slice(0, 10),
      }),
      label: 'Wiki regression and diagnostic risks',
    },
  ],
  qa: [
    {
      adapterId: 'mcp-indexing',
      action: 'index.context',
      args: (obj, files) => ({ goal: `QA test targets: ${obj.slice(0, 180)}`, changedPaths: files.slice(0, 20), maxItems: 10 }),
      label: 'Code context bundle (test targets)',
    },
    {
      adapterId: 'deepwiki',
      action: 'wiki.diagnose',
      args: (obj, files) => ({
        repo: 'team-muel/discord-news-bot',
        phase: 'qa',
        objective: obj.slice(0, 180),
        changedFiles: files.slice(0, 10),
      }),
      label: 'Wiki defect and diagnostic risks',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.ask',
      args: (obj, files) => ({ question: `Test coverage gaps for: ${obj.slice(0, 150)}. Files: ${files.slice(0, 5).join(', ')}` }),
      label: 'Test gap analysis',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.eval',
      args: (obj) => ({ dataset: 'ipw_mixed', limit: 5 }),
      label: 'Eval benchmark baseline',
    },
    {
      adapterId: 'openshell',
      action: 'sandbox.list',
      args: () => ({}),
      label: 'Available sandboxes for testing',
    },
  ],
  'security-audit': [
    {
      adapterId: 'mcp-indexing',
      action: 'index.context',
      args: (obj, files) => ({ goal: `Security audit: ${obj.slice(0, 180)}`, changedPaths: files.slice(0, 20), maxItems: 15 }),
      label: 'Code context bundle (attack surface)',
    },
    {
      adapterId: 'mcp-indexing',
      action: 'security.candidates',
      args: (_obj, _files) => ({ view: 'merged', limit: 50 }),
      label: 'Security candidate entry points (SAST-like)',
    },
    {
      adapterId: 'litellm-admin',
      action: 'proxy.health',
      args: () => ({}),
      label: 'LLM proxy health',
    },
    {
      adapterId: 'deepwiki',
      action: 'wiki.diagnose',
      args: (obj, files) => ({
        repo: 'team-muel/discord-news-bot',
        phase: 'security-audit',
        objective: obj.slice(0, 180),
        changedFiles: files.slice(0, 10),
      }),
      label: 'Wiki security diagnostics',
    },
    {
      adapterId: 'openclaw',
      action: 'agent.health',
      args: () => ({}),
      label: 'OpenClaw Gateway status',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.memory.search',
      args: (obj) => ({ query: `security vulnerabilities related to: ${obj.slice(0, 200)}`, limit: 5 }),
      label: 'Security knowledge search',
    },
  ],
  'ops-validate': [
    {
      adapterId: 'litellm-admin',
      action: 'proxy.models',
      args: () => ({}),
      label: 'Available models',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.telemetry',
      args: () => ({ window: '1h' }),
      label: 'Recent telemetry metrics',
    },
    {
      adapterId: 'deepwiki',
      action: 'wiki.diagnose',
      args: (obj, files) => ({
        repo: 'team-muel/discord-news-bot',
        phase: 'ops-validate',
        objective: obj.slice(0, 180),
        changedFiles: files.slice(0, 10),
      }),
      label: 'Wiki operational risk patterns',
    },
    {
      adapterId: 'n8n',
      action: 'workflow.status',
      args: () => ({}),
      label: 'n8n workflow health',
    },
  ],
  ship: [
    {
      adapterId: 'openclaw',
      action: 'agent.health',
      args: () => ({}),
      label: 'OpenClaw Gateway status',
    },
    {
      adapterId: 'litellm-admin',
      action: 'proxy.health',
      args: () => ({}),
      label: 'LLM proxy health',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.bench',
      args: () => ({}),
      label: 'Pre-ship benchmark',
    },
  ],
  retro: [
    {
      adapterId: 'deepwiki',
      action: 'wiki.ask',
      args: (obj) => ({ repo: 'team-muel/discord-news-bot', question: `Retrospective analysis: what patterns exist for: ${obj.slice(0, 150)}` }),
      label: 'Self-wiki retro reference',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.skill.search',
      args: () => ({}),
      label: 'Available skill candidates',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.digest',
      args: (obj) => ({ topic: `Sprint retrospective: ${obj.slice(0, 100)}` }),
      label: 'Auto-generated sprint digest',
    },
    {
      adapterId: 'openjarvis',
      action: 'jarvis.telemetry',
      args: () => ({ window: '24h' }),
      label: 'Sprint telemetry (24h)',
    },
  ],
};

/**
 * Enrich a sprint phase with cross-adapter context.
 * Returns additional preamble sections or empty string if nothing available.
 * Never throws — all adapter calls are best-effort with tight timeouts.
 */
export const enrichPhaseContext = async (
  phase: string,
  objective: string,
  changedFiles: string[],
): Promise<string> => {
  const enrichmentActions = PHASE_ENRICHMENT_MAP[phase];
  if (!enrichmentActions || enrichmentActions.length === 0) return '';

  const sections: string[] = [];

  // Run enrichment calls in parallel with a tight timeout
  const results = await Promise.allSettled(
    enrichmentActions.map(async (ea) => {
      const { executeExternalAction } = await import('../tools/externalAdapterRegistry');
      const result = await executeExternalAction(ea.adapterId, ea.action, ea.args(objective, changedFiles));
      return { label: ea.label, adapterId: ea.adapterId, result };
    }),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { label, result } = r.value;
    if (!result.ok || result.output.length === 0) continue;

    // GAP-014: Log when enrichment output is truncated
    const totalLines = result.output.length;
    const totalChars = result.output.join('\n').length;
    const content = result.output.slice(0, 3).join('\n').slice(0, 1500);
    if (totalLines > 3 || totalChars > 1500) {
      const { default: log } = await import('../../logger');
      log.debug('[ENRICHMENT] %s output truncated: kept 3/%d lines, %d/%d chars', label, totalLines, content.length, totalChars);
    }
    if (content.trim()) {
      sections.push(`### ${label}\n${content}`);
    }
  }

  if (sections.length === 0) return '';

  return [
    '## External Context (auto-enriched)',
    'The following context was gathered from platform adapters:',
    '',
    ...sections,
    '',
  ].join('\n');
};
