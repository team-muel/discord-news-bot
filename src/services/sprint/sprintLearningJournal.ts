/**
 * Sprint Learning Journal — Obsidian-backed persistent learning loop.
 *
 * Closes the gap between in-memory learningStore and the "liquid architecture"
 * vision: retro insights are written to the Obsidian vault as structured notes
 * with graph links (tags + backlinks), then read back to detect recurring
 * patterns and propose workflow reconfiguration.
 *
 * Flow:
 *   retro phase → recordSprintJournalEntry()  → Obsidian vault write
 *   plan phase  → loadWorkflowReconfigHints()  → Obsidian vault search + pattern analysis
 */

import logger from '../../logger';
import { getObsidianVaultRoot } from '../../utils/obsidianEnv';
import { upsertObsidianGuildDocument } from '../obsidian/authoring';
import { searchObsidianVaultWithAdapter, readObsidianFileWithAdapter } from '../obsidian/router';
import { generateText, isAnyLlmConfigured } from '../llmClient';
import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import { isSupabaseConfigured, getSupabaseClient } from '../supabaseClient';

// ──── Configuration ───────────────────────────────────────────────────────────

const JOURNAL_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_ENABLED, true);
const JOURNAL_GUILD_ID = String(process.env.SPRINT_LEARNING_JOURNAL_GUILD_ID || 'system').trim();
const JOURNAL_PATTERN_WINDOW = Math.max(3, parseIntegerEnv(process.env.SPRINT_LEARNING_JOURNAL_PATTERN_WINDOW, 10));
const JOURNAL_LLM_RECONFIG_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_LLM_RECONFIG_ENABLED, true);
const JOURNAL_AUTO_APPLY_ENABLED = parseBooleanEnv(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_ENABLED, true);
const JOURNAL_AUTO_APPLY_MIN_CONFIDENCE = Math.max(0.5, Math.min(1, Number(process.env.SPRINT_LEARNING_JOURNAL_AUTO_APPLY_MIN_CONFIDENCE) || 0.75));

const JOURNAL_TABLE = 'sprint_journal_entries';

// ──── Types ───────────────────────────────────────────────────────────────────

export type JournalEntry = {
  sprintId: string;
  guildId: string;
  objective: string;
  totalPhases: number;
  implementReviewLoops: number;
  changedFiles: string[];
  retroOutput: string;
  optimizeHints: string[];
  benchResults: string[];
  phaseTimings: Record<string, number>;
  failedPhases: string[];
  succeededPhases: string[];
  completedAt: string;
};

export type ReconfigProposal = {
  type: 'phase-insert' | 'phase-skip' | 'fallback-reorder' | 'loop-limit-adjust' | 'trigger-rule';
  summary: string;
  confidence: number;
  evidence: string[];
};

export type WorkflowReconfigHints = {
  proposals: ReconfigProposal[];
  patternSummary: string;
  journalEntriesAnalyzed: number;
};

export type PipelineMutation = {
  appliedProposals: ReconfigProposal[];
  phaseOrder: string[];
  adjustedLoopLimit: number | null;
  log: string[];
};

// ──── Write: Record sprint retro to Obsidian ──────────────────────────────────

const formatJournalMarkdown = (entry: JournalEntry): string => {
  const sections: string[] = [
    `# Sprint Journal: ${entry.sprintId}`,
    '',
    `**Objective:** ${entry.objective.slice(0, 500)}`,
    `**Completed:** ${entry.completedAt}`,
    `**Guild:** ${entry.guildId}`,
    '',
    '## Execution Summary',
    `- Total phases executed: ${entry.totalPhases}`,
    `- Implement↔review loops: ${entry.implementReviewLoops}`,
    `- Changed files: ${entry.changedFiles.length}`,
    `- Succeeded: ${entry.succeededPhases.join(', ') || 'none'}`,
    `- Failed: ${entry.failedPhases.join(', ') || 'none'}`,
    '',
  ];

  if (Object.keys(entry.phaseTimings).length > 0) {
    sections.push('## Phase Timings (ms)');
    for (const [phase, ms] of Object.entries(entry.phaseTimings)) {
      sections.push(`- ${phase}: ${ms}`);
    }
    sections.push('');
  }

  if (entry.optimizeHints.length > 0) {
    sections.push('## Optimization Hints');
    for (const hint of entry.optimizeHints.slice(0, 10)) {
      sections.push(`- ${hint}`);
    }
    sections.push('');
  }

  if (entry.benchResults.length > 0) {
    sections.push('## Benchmark Results');
    for (const bench of entry.benchResults.slice(0, 10)) {
      sections.push(`- ${bench}`);
    }
    sections.push('');
  }

  if (entry.retroOutput) {
    sections.push('## Retro Output');
    sections.push(entry.retroOutput.slice(0, 3000));
    sections.push('');
  }

  if (entry.changedFiles.length > 0) {
    sections.push('## Changed Files');
    for (const file of entry.changedFiles.slice(0, 20)) {
      sections.push(`- [[${file}]]`);
    }
    sections.push('');
  }

  return sections.join('\n');
};

const buildJournalTags = (entry: JournalEntry): string[] => {
  const tags = ['sprint-journal', 'retro', 'learning-loop'];
  if (entry.implementReviewLoops > 0) tags.push('had-review-loops');
  if (entry.failedPhases.length > 0) tags.push('had-failures');
  if (entry.optimizeHints.length > 0) tags.push('has-optimize-hints');
  if (entry.benchResults.length > 0) tags.push('has-bench-results');
  return tags;
};

// ──── Supabase fallback: write ────────────────────────────────────────────────

const writeJournalToSupabase = async (entry: JournalEntry): Promise<{ ok: boolean; path: string | null }> => {
  if (!isSupabaseConfigured()) return { ok: false, path: null };

  try {
    const client = getSupabaseClient();
    const tags = buildJournalTags(entry);
    const content = formatJournalMarkdown(entry);

    await client.from(JOURNAL_TABLE).upsert({
      sprint_id: entry.sprintId,
      guild_id: entry.guildId || JOURNAL_GUILD_ID,
      objective: entry.objective.slice(0, 500),
      content,
      tags,
      total_phases: entry.totalPhases,
      implement_review_loops: entry.implementReviewLoops,
      changed_files: entry.changedFiles,
      failed_phases: entry.failedPhases,
      succeeded_phases: entry.succeededPhases,
      phase_timings: entry.phaseTimings,
      optimize_hints: entry.optimizeHints,
      bench_results: entry.benchResults,
      retro_output: entry.retroOutput.slice(0, 3000),
      completed_at: entry.completedAt,
    }, { onConflict: 'sprint_id' });

    const path = `supabase://${JOURNAL_TABLE}/${entry.sprintId}`;
    logger.info('[SPRINT-JOURNAL] recorded entry via Supabase for sprint=%s', entry.sprintId);
    return { ok: true, path };
  } catch (err) {
    logger.warn('[SPRINT-JOURNAL] Supabase write failed: %s', err instanceof Error ? err.message : String(err));
    return { ok: false, path: null };
  }
};

// ──── Supabase fallback: read ─────────────────────────────────────────────────

const loadJournalEntriesFromSupabase = async (limit: number): Promise<string[]> => {
  if (!isSupabaseConfigured()) return [];

  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(JOURNAL_TABLE)
      .select('content')
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return data
      .map((row: { content?: string }) => row.content)
      .filter((c): c is string => typeof c === 'string' && c.length > 0);
  } catch (err) {
    logger.warn('[SPRINT-JOURNAL] Supabase read failed: %s', err instanceof Error ? err.message : String(err));
    return [];
  }
};

// ──── Write: Record sprint retro (Obsidian-first, Supabase-fallback) ──────────

export const recordSprintJournalEntry = async (entry: JournalEntry): Promise<{ ok: boolean; path: string | null }> => {
  if (!JOURNAL_ENABLED) {
    return { ok: false, path: null };
  }

  const vaultPath = getObsidianVaultRoot();

  // Strategy: Obsidian-first, Supabase-fallback
  if (vaultPath) {
    return recordJournalToObsidian(entry, vaultPath);
  }

  // No vault configured — use Supabase fallback for production
  return writeJournalToSupabase(entry);
};

const recordJournalToObsidian = async (entry: JournalEntry, vaultPath: string): Promise<{ ok: boolean; path: string | null }> => {
  const guildId = entry.guildId && /^\d{6,30}$/.test(entry.guildId) ? entry.guildId : JOURNAL_GUILD_ID;
  // Use a non-numeric guild prefix for system-level journal entries
  const effectiveGuildId = /^\d{6,30}$/.test(guildId) ? guildId : '000000';

  const dateSlug = entry.completedAt.slice(0, 10).replace(/-/g, '');
  const sprintSlug = entry.sprintId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const fileName = `sprint-journal/${dateSlug}_${sprintSlug}`;

  const content = formatJournalMarkdown(entry);
  const tags = buildJournalTags(entry);

  try {
    const result = await upsertObsidianGuildDocument({
      guildId: effectiveGuildId,
      vaultPath,
      fileName,
      content,
      tags,
      properties: {
        schema: 'sprint-journal/v1',
        source: 'sprint-retro',
        sprint_id: entry.sprintId,
        total_phases: entry.totalPhases,
        review_loops: entry.implementReviewLoops,
        changed_files_count: entry.changedFiles.length,
        had_failures: entry.failedPhases.length > 0,
        completed_at: entry.completedAt,
      },
    });

    if (result.ok) {
      logger.info('[SPRINT-JOURNAL] recorded entry for sprint=%s path=%s', entry.sprintId, result.path);
    } else {
      logger.warn('[SPRINT-JOURNAL] write failed for sprint=%s reason=%s', entry.sprintId, result.reason);
    }

    return { ok: result.ok, path: result.path };
  } catch (err) {
    logger.warn('[SPRINT-JOURNAL] recordSprintJournalEntry error: %s', err instanceof Error ? err.message : String(err));
    return { ok: false, path: null };
  }
};

// ──── Read: Retrieve recent journal entries (Obsidian-first, Supabase-fallback)

const loadRecentJournalEntries = async (limit: number): Promise<string[]> => {
  const vaultPath = getObsidianVaultRoot();

  // Strategy: Obsidian-first, Supabase-fallback
  if (vaultPath) {
    return loadJournalEntriesFromObsidian(vaultPath, limit);
  }

  return loadJournalEntriesFromSupabase(limit);
};

const loadJournalEntriesFromObsidian = async (vaultPath: string, limit: number): Promise<string[]> => {
  try {
    const results = await searchObsidianVaultWithAdapter({
      vaultPath,
      query: 'sprint-journal retro learning-loop',
      limit,
    });

    if (results.length === 0) return [];

    const contents: string[] = [];
    for (const result of results.slice(0, limit)) {
      const content = await readObsidianFileWithAdapter({
        vaultPath,
        filePath: result.filePath,
      });
      if (content) {
        contents.push(content);
      }
    }

    return contents;
  } catch (err) {
    logger.warn('[SPRINT-JOURNAL] loadRecentJournalEntries error: %s', err instanceof Error ? err.message : String(err));
    return [];
  }
};

// ──── Analyze: Detect patterns and propose workflow reconfiguration ────────────

const extractDeterministicPatterns = (entries: string[]): ReconfigProposal[] => {
  const proposals: ReconfigProposal[] = [];

  // Pattern 1: Repeated review loops → suggest increasing scrutiny or adding pre-review lint
  let loopCount = 0;
  let totalEntries = 0;
  for (const entry of entries) {
    const match = entry.match(/Implement↔review loops:\s*(\d+)/);
    if (match) {
      totalEntries++;
      const loops = Number(match[1]);
      if (loops > 0) loopCount++;
    }
  }
  if (totalEntries >= 3 && loopCount / totalEntries >= 0.5) {
    proposals.push({
      type: 'phase-insert',
      summary: `${Math.round(loopCount / totalEntries * 100)}% of recent sprints had implement↔review loops. Consider inserting a pre-review static analysis phase or adjusting review criteria.`,
      confidence: Math.min(0.9, loopCount / totalEntries),
      evidence: [`${loopCount}/${totalEntries} sprints had review loops`],
    });
  }

  // Pattern 2: Frequent failures in a specific phase
  const phaseFailCounts: Record<string, number> = {};
  for (const entry of entries) {
    const match = entry.match(/Failed:\s*([^\n]+)/);
    if (match && match[1].trim() !== 'none') {
      for (const phase of match[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        phaseFailCounts[phase] = (phaseFailCounts[phase] || 0) + 1;
      }
    }
  }
  for (const [phase, count] of Object.entries(phaseFailCounts)) {
    if (count >= 3 && totalEntries >= 3) {
      proposals.push({
        type: 'fallback-reorder',
        summary: `Phase "${phase}" failed in ${count}/${totalEntries} recent sprints. Consider reordering fallback chain or switching execution strategy for this phase.`,
        confidence: Math.min(0.85, count / totalEntries),
        evidence: [`${phase} failures: ${count}/${totalEntries}`],
      });
    }
  }

  // Pattern 3: Consistently zero review loops → security-audit may be safely skippable for low-risk triggers
  if (totalEntries >= 5 && loopCount === 0) {
    proposals.push({
      type: 'phase-skip',
      summary: 'No review loops detected across recent sprints. For low-risk scheduled sprints, consider skipping security-audit phase to reduce latency.',
      confidence: 0.5,
      evidence: [`0/${totalEntries} sprints had review loops`],
    });
  }

  return proposals;
};

const generateLlmReconfigProposals = async (patternContext: string, deterministicProposals: ReconfigProposal[]): Promise<ReconfigProposal[]> => {
  if (!JOURNAL_LLM_RECONFIG_ENABLED || !isAnyLlmConfigured()) return [];

  const existingSummaries = deterministicProposals.map((p) => `- ${p.summary}`).join('\n');

  try {
    const result = await generateText({
      system: `You are a workflow optimization advisor for an autonomous sprint pipeline.
Given historical sprint journal data, propose concrete workflow reconfigurations.
Each proposal must be one of: phase-insert, phase-skip, fallback-reorder, loop-limit-adjust, trigger-rule.
Output JSON array of objects with fields: type, summary (1-2 sentences), confidence (0-1).
Only propose changes with clear evidence. Do not repeat existing proposals.
Respond ONLY with a valid JSON array, no markdown fences.`,
      user: `## Recent Sprint Patterns
${patternContext.slice(0, 4000)}

## Already Proposed (do not repeat)
${existingSummaries || 'none'}

Analyze the patterns and propose additional workflow reconfigurations.`,
      actionName: 'sprint.journal.reconfig',
      temperature: 0.3,
      maxTokens: 800,
    });

    const cleaned = result.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((p: unknown): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).type === 'string' && typeof (p as Record<string, unknown>).summary === 'string')
      .map((p) => ({
        type: String(p.type) as ReconfigProposal['type'],
        summary: String(p.summary).slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.5)),
        evidence: ['llm-analysis'],
      }))
      .slice(0, 5);
  } catch (err) {
    logger.debug('[SPRINT-JOURNAL] LLM reconfig generation failed: %s', err instanceof Error ? err.message : String(err));
    return [];
  }
};

export const loadWorkflowReconfigHints = async (): Promise<WorkflowReconfigHints | null> => {
  if (!JOURNAL_ENABLED) return null;

  const vaultPath = getObsidianVaultRoot();
  if (!vaultPath && !isSupabaseConfigured()) return null;

  try {
    const entries = await loadRecentJournalEntries(JOURNAL_PATTERN_WINDOW);
    if (entries.length < 3) {
      logger.debug('[SPRINT-JOURNAL] not enough journal entries for pattern analysis (%d < 3)', entries.length);
      return null;
    }

    const deterministicProposals = extractDeterministicPatterns(entries);
    const patternContext = entries.map((e) => e.slice(0, 600)).join('\n---\n');
    const llmProposals = await generateLlmReconfigProposals(patternContext, deterministicProposals);

    const allProposals = [...deterministicProposals, ...llmProposals]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);

    if (allProposals.length === 0) return null;

    const patternSummary = allProposals.map((p) => `[${p.type}] ${p.summary}`).join('\n');

    logger.info('[SPRINT-JOURNAL] generated %d workflow reconfig proposals from %d journal entries', allProposals.length, entries.length);

    return {
      proposals: allProposals,
      patternSummary,
      journalEntriesAnalyzed: entries.length,
    };
  } catch (err) {
    logger.warn('[SPRINT-JOURNAL] loadWorkflowReconfigHints error: %s', err instanceof Error ? err.message : String(err));
    return null;
  }
};

// ──── Format: Render reconfig hints for preamble injection ────────────────────

export const formatReconfigHintsForPreamble = (hints: WorkflowReconfigHints): string => {
  const lines: string[] = [
    '## Workflow Reconfiguration Proposals',
    `Based on ${hints.journalEntriesAnalyzed} recent sprint journal entries (Obsidian graph):`,
    '',
  ];

  for (const proposal of hints.proposals) {
    const confidence = Math.round(proposal.confidence * 100);
    lines.push(`- **[${proposal.type}]** (${confidence}% confidence): ${proposal.summary}`);
    if (proposal.evidence.length > 0) {
      lines.push(`  Evidence: ${proposal.evidence.join('; ')}`);
    }
  }

  lines.push('');
  lines.push('Consider these proposals when designing the plan. Apply changes that have >70% confidence.');
  lines.push('For lower-confidence proposals, flag them as options in the plan output.');
  lines.push('');

  return lines.join('\n');
};

// ──── Apply: Convert high-confidence proposals into pipeline mutations ─────────

const VALID_PHASES: readonly string[] = [
  'plan', 'implement', 'review', 'qa',
  'security-audit', 'ops-validate', 'ship', 'retro',
];

const LOW_RISK_TRIGGERS: readonly string[] = ['scheduled', 'self-improvement'];

/**
 * Apply high-confidence reconfig proposals to a pipeline's phase order.
 * Only proposals above the confidence threshold are applied.
 * Safety invariants: plan and retro are never removed; no duplicates; no unknown phases.
 */
export const applyReconfigToPhaseOrder = (
  baseOrder: string[],
  baseLoopLimit: number,
  hints: WorkflowReconfigHints | null,
  triggerType: string,
): PipelineMutation => {
  const result: PipelineMutation = {
    appliedProposals: [],
    phaseOrder: [...baseOrder],
    adjustedLoopLimit: null,
    log: [],
  };

  if (!JOURNAL_AUTO_APPLY_ENABLED || !hints) return result;

  const eligible = hints.proposals.filter(
    (p) => p.confidence >= JOURNAL_AUTO_APPLY_MIN_CONFIDENCE,
  );
  if (eligible.length === 0) return result;

  for (const proposal of eligible) {
    switch (proposal.type) {
      case 'phase-insert': {
        // Insert security-audit after review if not already present
        if (!result.phaseOrder.includes('security-audit')) {
          const reviewIdx = result.phaseOrder.indexOf('review');
          if (reviewIdx >= 0) {
            result.phaseOrder.splice(reviewIdx + 1, 0, 'security-audit');
            result.appliedProposals.push(proposal);
            result.log.push(
              `[APPLIED phase-insert] security-audit inserted after review (confidence=${proposal.confidence})`,
            );
          }
        }
        break;
      }

      case 'phase-skip': {
        // Only skip security-audit, and only for low-risk triggers
        if (LOW_RISK_TRIGGERS.includes(triggerType)) {
          const saIdx = result.phaseOrder.indexOf('security-audit');
          if (saIdx >= 0) {
            result.phaseOrder.splice(saIdx, 1);
            result.appliedProposals.push(proposal);
            result.log.push(
              `[APPLIED phase-skip] security-audit removed for trigger=${triggerType} (confidence=${proposal.confidence})`,
            );
          }
        }
        break;
      }

      case 'loop-limit-adjust': {
        // Increase loop limit by 1, capped at 5
        const newLimit = Math.min(5, baseLoopLimit + 1);
        if (newLimit !== baseLoopLimit) {
          result.adjustedLoopLimit = newLimit;
          result.appliedProposals.push(proposal);
          result.log.push(
            `[APPLIED loop-limit-adjust] ${baseLoopLimit} → ${newLimit} (confidence=${proposal.confidence})`,
          );
        }
        break;
      }

      // fallback-reorder and trigger-rule: advisory only (too complex for safe auto-apply)
      default:
        result.log.push(
          `[SKIPPED ${proposal.type}] advisory only (confidence=${proposal.confidence})`,
        );
        break;
    }
  }

  // Safety: never produce a phaseOrder without plan or retro
  if (!result.phaseOrder.includes('plan') || !result.phaseOrder.includes('retro')) {
    result.phaseOrder = [...baseOrder];
    result.appliedProposals = [];
    result.log.push('[SAFETY] restored base order: plan or retro was missing');
    return result;
  }

  // Safety: remove duplicates preserving first occurrence
  const seen = new Set<string>();
  result.phaseOrder = result.phaseOrder.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  // Safety: only allow known phases
  result.phaseOrder = result.phaseOrder.filter((p) => VALID_PHASES.includes(p));

  if (result.appliedProposals.length > 0) {
    logger.info(
      '[SPRINT-JOURNAL] applied %d reconfig mutations: %s',
      result.appliedProposals.length,
      result.log.filter((l) => l.startsWith('[APPLIED')).join('; '),
    );
  }

  return result;
};
