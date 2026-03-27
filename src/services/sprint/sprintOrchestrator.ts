import crypto from 'node:crypto';
import logger from '../../logger';
import {
  SPRINT_ENABLED,
  SPRINT_AUTONOMY_LEVEL,
  SPRINT_MAX_IMPL_REVIEW_LOOPS,
  SPRINT_MAX_TOTAL_PHASES,
  SPRINT_CHANGED_FILE_CAP,
  SPRINT_PHASE_TIMEOUT_MS,
  SPRINT_PIPELINES_TABLE,
  SPRINT_DRY_RUN,
} from '../../config';
import { getPhaseActionName, getPhaseLeadAgent, buildPhaseSystemPrompt } from './skillPromptLoader';
import { isDeterministicPhase, executeFastPath } from './fastPathExecutors';
import { formatActionableOutput } from './actionableErrors';
import { buildSprintPreamble, storeLearningInsight, loadJournalPreambleSection } from './sprintPreamble';
import { recordSprintJournalEntry, applyReconfigToPhaseOrder, loadWorkflowReconfigHints, type JournalEntry, type WorkflowReconfigHints } from './sprintLearningJournal';
import { isCrossModelPhase, requestCrossModelReview, formatCrossModelAppendix } from './crossModelVoice';
import { checkFilesScope } from './scopeGuard';
import { isJudgePhase, judgePhaseOutput, formatJudgeAppendix } from './llmJudge';
import { runAutoplan, formatAutoplanAppendix } from './autoplan';
import { getAction } from '../skills/actions/registry';
import { getDynamicAction } from '../workerGeneration/dynamicWorkerRegistry';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getMcpWorkerUrl, callMcpWorkerTool, parseMcpTextBlocks, type McpWorkerKind } from '../skills/actions/mcpDelegate';
import { createActionApprovalRequest } from '../skills/actionGovernanceStore';
import { executeExternalAction } from '../tools/externalAdapterRegistry';
import { runWorkerGenerationPipeline } from '../workerGeneration/workerGenerationPipeline';
import { generateAndApplyCodeChanges, rollbackCodeChanges, type CodeChange } from './sprintCodeWriter';

// Phase → MCP worker kind mapping for delegation
const PHASE_WORKER_KIND: Partial<Record<SprintPhase, McpWorkerKind>> = {
  plan: 'architect',
  implement: 'implement',
  review: 'review',
  'security-audit': 'review',
  'ops-validate': 'operate',
  ship: 'operate',
  retro: 'architect',
};

// Phase → external adapter fallback for when MCP workers are absent
const PHASE_EXTERNAL_ADAPTER: Partial<Record<SprintPhase, { adapterId: 'openshell' | 'nemoclaw' | 'openclaw' | 'openjarvis'; action: string }>> = {
  review: { adapterId: 'nemoclaw', action: 'code.review' },
  'security-audit': { adapterId: 'nemoclaw', action: 'code.review' },
  'ops-validate': { adapterId: 'openjarvis', action: 'jarvis.ask' },
};

// Worker health cache — skip known-dead workers quickly instead of waiting for full timeout
const WORKER_HEALTH_CACHE_TTL_MS = 60_000;
const MCP_FAST_FAIL_TIMEOUT_MS = Math.max(3_000, Math.min(SPRINT_PHASE_TIMEOUT_MS, Number(process.env.MCP_FAST_FAIL_TIMEOUT_MS || 10_000)));
const workerHealthCache = new Map<string, { healthy: boolean; checkedAt: number }>();

const isWorkerKnownDead = (workerUrl: string): boolean => {
  const entry = workerHealthCache.get(workerUrl);
  if (!entry) return false;
  if (Date.now() - entry.checkedAt > WORKER_HEALTH_CACHE_TTL_MS) {
    workerHealthCache.delete(workerUrl);
    return false;
  }
  return !entry.healthy;
};

const recordWorkerHealth = (workerUrl: string, healthy: boolean): void => {
  workerHealthCache.set(workerUrl, { healthy, checkedAt: Date.now() });
  // Prevent unbounded growth
  if (workerHealthCache.size > 50) {
    const oldest = [...workerHealthCache.entries()]
      .sort((a, b) => a[1].checkedAt - b[1].checkedAt)[0];
    if (oldest) workerHealthCache.delete(oldest[0]);
  }
};

// Expose for diagnostics
export const getWorkerHealthCacheSnapshot = () => Object.fromEntries(workerHealthCache);

// ──── Types ───────────────────────────────────────────────────────────────────

export type SprintPhase =
  | 'plan' | 'implement' | 'review' | 'qa'
  | 'security-audit' | 'ops-validate' | 'ship' | 'retro'
  | 'complete' | 'blocked' | 'cancelled';

export type SprintTriggerType =
  | 'error-detection'
  | 'cs-ticket'
  | 'feature-request'
  | 'scheduled'
  | 'manual'
  | 'self-improvement';

export type AutonomyLevel = 'full-auto' | 'approve-ship' | 'approve-impl' | 'manual';

export type PhaseResult = {
  phase: SprintPhase;
  status: 'success' | 'failed' | 'blocked' | 'skipped' | 'awaiting-approval';
  output: string;
  artifacts: string[];
  sessionId?: string;
  startedAt: string;
  completedAt: string;
  iterationCount: number;
};

export type SprintPipeline = {
  sprintId: string;
  triggerId: string;
  triggerType: SprintTriggerType;
  guildId: string;
  objective: string;
  autonomyLevel: AutonomyLevel;
  currentPhase: SprintPhase;
  phaseResults: Record<string, PhaseResult>;
  phaseOrder: SprintPhase[];
  implementReviewLoopCount: number;
  /** Per-pipeline loop limit (may be adjusted by journal reconfig). */
  maxImplReviewLoops: number;
  totalPhasesExecuted: number;
  changedFiles: string[];
  rollbackPlan: string;
  /** Name of dynamically generated worker (if any), populated during implement phase */
  generatedWorkerName?: string;
  /** Code changes applied during implement phase (for rollback and ship) */
  codeChanges?: CodeChange[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
};

// ──── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PHASE_ORDER: SprintPhase[] = [
  'plan', 'implement', 'review', 'qa', 'ops-validate', 'ship', 'retro',
];

const PHASE_TRANSITIONS: Record<string, (result: PhaseResult, pipeline: SprintPipeline) => SprintPhase> = {
  plan: (r) => r.status === 'success' ? 'implement' : 'blocked',

  implement: (r) => r.status === 'success' ? 'review' : 'blocked',

  review: (r, p) => {
    if (r.status === 'success') {
      // Insert security-audit before qa if high-risk content detected
      if (r.output.includes('SECURITY') || r.output.includes('security concern')) {
        return 'security-audit';
      }
      return 'qa';
    }
    // Critical findings → re-implement (with loop guard)
    if (p.implementReviewLoopCount < p.maxImplReviewLoops) {
      return 'implement';
    }
    return 'blocked';
  },

  qa: (r, p) => {
    if (r.status === 'success') return 'ops-validate';
    if (p.implementReviewLoopCount < p.maxImplReviewLoops) return 'implement';
    return 'blocked';
  },

  'security-audit': (r, p) => {
    if (r.status === 'success') return 'qa';
    if (p.implementReviewLoopCount < p.maxImplReviewLoops) return 'implement';
    return 'blocked';
  },

  'ops-validate': (r, p) => {
    if (r.status === 'success') return 'ship';
    if (p.implementReviewLoopCount < p.maxImplReviewLoops) return 'implement';
    return 'blocked';
  },

  ship: (r) => r.status === 'success' ? 'retro' : 'blocked',

  retro: () => 'complete',
};

// ──── In-memory store ─────────────────────────────────────────────────────────

const pipelines = new Map<string, SprintPipeline>();

// ──── Reconfig hints cache (refreshed before pipeline runs) ──────────────────

let cachedReconfigHints: WorkflowReconfigHints | null = null;
let cachedReconfigHintsAt = 0;
const RECONFIG_CACHE_TTL_MS = 10 * 60_000;

const refreshReconfigHints = async (): Promise<void> => {
  if (Date.now() - cachedReconfigHintsAt < RECONFIG_CACHE_TTL_MS) return;
  try {
    cachedReconfigHints = await loadWorkflowReconfigHints();
    cachedReconfigHintsAt = Date.now();
  } catch {
    // best-effort
  }
};

/** Expose cached hints for testing/diagnostics. */
export const getCachedReconfigHints = (): WorkflowReconfigHints | null => cachedReconfigHints;

// ──── Pipeline CRUD ───────────────────────────────────────────────────────────

export const createSprintPipeline = (params: {
  triggerId: string;
  triggerType: SprintTriggerType;
  guildId: string;
  objective: string;
  autonomyLevel?: AutonomyLevel;
  includeSecurityAudit?: boolean;
}): SprintPipeline => {
  if (!SPRINT_ENABLED) {
    throw new Error('Sprint pipeline is disabled (SPRINT_ENABLED=false)');
  }

  const sprintId = `sprint-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const basePhaseOrder: SprintPhase[] = params.includeSecurityAudit
    ? ['plan', 'implement', 'review', 'security-audit', 'qa', 'ops-validate', 'ship', 'retro']
    : [...DEFAULT_PHASE_ORDER];

  // Apply journal-driven reconfig mutations (phase-insert, phase-skip, loop-limit-adjust)
  const mutation = applyReconfigToPhaseOrder(
    basePhaseOrder,
    SPRINT_MAX_IMPL_REVIEW_LOOPS,
    cachedReconfigHints,
    params.triggerType,
  );
  const phaseOrder = (mutation.appliedProposals.length > 0
    ? mutation.phaseOrder
    : basePhaseOrder) as SprintPhase[];
  const effectiveLoopLimit = mutation.adjustedLoopLimit ?? SPRINT_MAX_IMPL_REVIEW_LOOPS;

  const pipeline: SprintPipeline = {
    sprintId,
    triggerId: params.triggerId,
    triggerType: params.triggerType,
    guildId: params.guildId,
    objective: params.objective,
    autonomyLevel: params.autonomyLevel || SPRINT_AUTONOMY_LEVEL,
    currentPhase: phaseOrder[0],
    phaseResults: {},
    phaseOrder,
    implementReviewLoopCount: 0,
    maxImplReviewLoops: effectiveLoopLimit,
    totalPhasesExecuted: 0,
    changedFiles: [],
    rollbackPlan: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (mutation.appliedProposals.length > 0) {
    logger.info('[SPRINT] reconfig applied to pipeline=%s: %s', sprintId, mutation.log.filter((l) => l.startsWith('[APPLIED')).join('; '));
  }

  pipelines.set(sprintId, pipeline);
  recordPipelineCreated();
  logger.info('[SPRINT] created pipeline=%s trigger=%s objective=%.80s', sprintId, params.triggerType, params.objective);

  // Best-effort persist to Supabase
  persistPipeline(pipeline).catch(() => {});

  return pipeline;
};

export const getSprintPipeline = (sprintId: string): SprintPipeline | null => {
  return pipelines.get(sprintId) || null;
};

export const listSprintPipelines = (guildId?: string, limit = 20): SprintPipeline[] => {
  const all = Array.from(pipelines.values());
  const filtered = guildId ? all.filter((p) => p.guildId === guildId) : all;
  return filtered
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
};

// ──── Phase execution ─────────────────────────────────────────────────────────

const requiresApproval = (phase: SprintPhase, autonomy: AutonomyLevel): boolean => {
  if (autonomy === 'full-auto') return false;
  if (autonomy === 'manual') return true;
  if (autonomy === 'approve-ship') return phase === 'ship';
  if (autonomy === 'approve-impl') return phase === 'implement' || phase === 'ship';
  return false;
};

const executePhaseAction = async (
  pipeline: SprintPipeline,
  phase: SprintPhase,
): Promise<PhaseResult> => {
  const startedAt = new Date().toISOString();
  const actionName = getPhaseActionName(phase);
  const systemPrompt = buildPhaseSystemPrompt(phase);

  if (!actionName) {
    return {
      phase,
      status: 'failed',
      output: `No action mapped for phase: ${phase}`,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 0,
    };
  }

  // Check approval requirement
  if (requiresApproval(phase, pipeline.autonomyLevel)) {
    return {
      phase,
      status: 'awaiting-approval',
      output: `Phase ${phase} requires human approval (autonomyLevel=${pipeline.autonomyLevel})`,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 0,
    };
  }

  // Resolve action from static registry or dynamic workers
  const action = getAction(actionName) || getDynamicAction(actionName);
  if (!action) {
    return {
      phase,
      status: 'failed',
      output: `Action not found: ${actionName}`,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 0,
    };
  }

  try {
    // ── Worker generation path: feature-request/cs-ticket implement generates dynamic workers ──
    if (phase === 'implement' && (pipeline.triggerType === 'feature-request' || pipeline.triggerType === 'cs-ticket')) {
      logger.info('[SPRINT] worker-generation path for phase=%s trigger=%s', phase, pipeline.triggerType);
      try {
        const pipeResult = await Promise.race([
          runWorkerGenerationPipeline({
            goal: pipeline.objective,
            guildId: pipeline.guildId,
            requestedBy: `sprint:${pipeline.sprintId}`,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Worker generation timed out')), SPRINT_PHASE_TIMEOUT_MS),
          ),
        ]);

        if (pipeResult.ok) {
          pipeline.generatedWorkerName = pipeResult.approval.actionName;
          return {
            phase,
            status: 'success',
            output: `Dynamic worker generated: ${pipeResult.approval.actionName} (approval=${pipeResult.approval.id}, validation=${pipeResult.approval.validationPassed ? 'passed' : 'failed'})`,
            artifacts: [pipeResult.approval.actionName, `approval:${pipeResult.approval.id}`],
            startedAt,
            completedAt: new Date().toISOString(),
            iterationCount: 1,
          };
        }

        logger.warn('[SPRINT] worker-generation failed: %s, falling through to standard implement', pipeResult.error);
      } catch (wgError) {
        logger.warn('[SPRINT] worker-generation threw: %s, falling through to standard implement', wgError instanceof Error ? wgError.message : String(wgError));
      }
    }

    // ── Code modification path: self-improvement / error-detection / manual / scheduled ──
    const CODE_MOD_TRIGGERS: SprintTriggerType[] = ['error-detection', 'self-improvement', 'manual', 'scheduled'];
    if (phase === 'implement' && CODE_MOD_TRIGGERS.includes(pipeline.triggerType)) {
      logger.info('[SPRINT] code-modification path for phase=%s trigger=%s', phase, pipeline.triggerType);
      try {
        const planOutput = pipeline.phaseResults['plan-0']?.output;
        const codeResult = await Promise.race([
          generateAndApplyCodeChanges({
            objective: pipeline.objective,
            changedFiles: pipeline.changedFiles,
            previousPhaseOutput: planOutput,
            sprintId: pipeline.sprintId,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Code modification timed out')), SPRINT_PHASE_TIMEOUT_MS),
          ),
        ]);

        if (codeResult.ok) {
          pipeline.codeChanges = codeResult.changes;
          for (const change of codeResult.changes) {
            if (!pipeline.changedFiles.includes(change.filePath)) {
              pipeline.changedFiles.push(change.filePath);
            }
          }
          return {
            phase,
            status: 'success',
            output: codeResult.summary,
            artifacts: codeResult.changes.map((c) => c.filePath),
            startedAt,
            completedAt: new Date().toISOString(),
            iterationCount: 1,
          };
        }

        logger.warn('[SPRINT] code-modification returned no changes: %s, falling through to LLM action', codeResult.summary);
      } catch (cmError) {
        logger.warn('[SPRINT] code-modification threw: %s, falling through to LLM action', cmError instanceof Error ? cmError.message : String(cmError));
      }
    }

    // ── Fast-path: deterministic phases skip LLM entirely ──
    if (isDeterministicPhase(phase)) {
      logger.info('[SPRINT] fast-path execution for phase=%s (zero LLM tokens)', phase);
      const fastResult = await Promise.race([
        executeFastPath({
          phase,
          sprintId: pipeline.sprintId,
          objective: pipeline.objective,
          changedFiles: pipeline.changedFiles,
          codeChanges: pipeline.codeChanges,
        }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SPRINT_PHASE_TIMEOUT_MS),
        ),
      ]);

      if (fastResult) {
        return {
          phase,
          status: fastResult.ok ? 'success' : 'failed',
          output: fastResult.summary || '',
          artifacts: fastResult.artifacts || [],
          startedAt,
          completedAt: new Date().toISOString(),
          iterationCount: 1,
        };
      }
      logger.warn('[SPRINT] fast-path returned null for phase=%s, falling back to LLM action', phase);
    }

    // ── Standard path: LLM-based action execution ──
    const goal = buildPhaseGoal(pipeline, phase, systemPrompt);

    // ── MCP worker delegation: prefer remote worker if configured ──
    const workerKind = PHASE_WORKER_KIND[phase];
    const workerUrl = workerKind ? getMcpWorkerUrl(workerKind) : '';

    if (workerUrl && !isWorkerKnownDead(workerUrl)) {
      logger.info('[SPRINT] delegating phase=%s to MCP worker=%s', phase, workerKind);
      try {
        const mcpResult = await Promise.race([
          callMcpWorkerTool({
            workerUrl,
            toolName: actionName,
            args: {
              goal,
              sprintId: pipeline.sprintId,
              phase,
              objective: pipeline.objective,
              changedFiles: pipeline.changedFiles,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`MCP delegation timed out for phase ${phase}`)), MCP_FAST_FAIL_TIMEOUT_MS),
          ),
        ]);
        recordWorkerHealth(workerUrl, true);
        const blocks = parseMcpTextBlocks(mcpResult);
        const output = blocks.join('\n') || '';
        return {
          phase,
          status: mcpResult.isError ? 'failed' : 'success',
          output,
          artifacts: [],
          startedAt,
          completedAt: new Date().toISOString(),
          iterationCount: 1,
        };
      } catch (mcpError) {
        recordWorkerHealth(workerUrl, false);
        logger.warn('[SPRINT] MCP worker %s failed for phase=%s (%s), falling through to next fallback',
          workerKind, phase, mcpError instanceof Error ? mcpError.message : String(mcpError));
      }
    } else if (workerUrl) {
      logger.info('[SPRINT] skipping known-dead MCP worker %s for phase=%s', workerKind, phase);
    }

    // ── External adapter fallback: try real external tools before LLM-only fallback ──
    const externalMapping = PHASE_EXTERNAL_ADAPTER[phase];
    if (externalMapping) {
      try {
        const adapterResult = await executeExternalAction(externalMapping.adapterId, externalMapping.action, {
          code: pipeline.changedFiles.join('\n'),
          goal: pipeline.objective,
          question: `Sprint phase "${phase}" objective: ${pipeline.objective}`,
        });
        if (adapterResult.ok && adapterResult.output.length > 0) {
          logger.info('[SPRINT] external adapter %s.%s succeeded for phase=%s (duration=%dms)', externalMapping.adapterId, externalMapping.action, phase, adapterResult.durationMs);
          return {
            phase,
            status: 'success',
            output: adapterResult.output.join('\n'),
            artifacts: [],
            startedAt,
            completedAt: new Date().toISOString(),
            iterationCount: 1,
          };
        }
        logger.info('[SPRINT] external adapter %s.%s unavailable or empty for phase=%s, falling through to local action', externalMapping.adapterId, externalMapping.action, phase);
      } catch (adapterError) {
        logger.warn('[SPRINT] external adapter %s.%s failed: %s', externalMapping.adapterId, externalMapping.action, adapterError instanceof Error ? adapterError.message : String(adapterError));
      }
    }

    // ── Local action fallback ──
    const result = await Promise.race([
      action.execute({
        goal,
        args: {
          sprintId: pipeline.sprintId,
          phase,
          objective: pipeline.objective,
          changedFiles: pipeline.changedFiles,
          previousPhaseResults: Object.values(pipeline.phaseResults).map((r) => ({
            phase: r.phase,
            status: r.status,
            output: r.output.slice(0, 500),
          })),
        },
        guildId: pipeline.guildId,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Phase ${phase} timed out after ${SPRINT_PHASE_TIMEOUT_MS}ms`)), SPRINT_PHASE_TIMEOUT_MS),
      ),
    ]);

    return {
      phase,
      status: result.ok ? 'success' : 'failed',
      output: result.summary || '',
      artifacts: result.artifacts || [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 1,
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error);
    logger.error('[SPRINT] phase=%s action=%s error=%s', phase, actionName, rawError);
    return {
      phase,
      status: 'failed',
      output: formatActionableOutput(phase, rawError),
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 1,
    };
  }
};

const buildPhaseGoal = (pipeline: SprintPipeline, phase: SprintPhase, systemPrompt: string | null): string => {
  const sections = [
    `[SPRINT] ${pipeline.sprintId}`,
    `[PHASE] ${phase}`,
    `[OBJECTIVE] ${pipeline.objective}`,
  ];

  // Inject preamble (gstack pattern: common preprocessing for all phases)
  const preamble = buildSprintPreamble(pipeline.sprintId, phase);
  sections.push(`[PREAMBLE]\n${preamble}`);

  if (systemPrompt) {
    sections.push(`[PHASE_INSTRUCTIONS]\n${systemPrompt}`);
  }

  // Feed previous phase output as context
  const prevResults = Object.values(pipeline.phaseResults);
  if (prevResults.length > 0) {
    const lastResult = prevResults[prevResults.length - 1];
    sections.push(`[PREVIOUS_PHASE] ${lastResult.phase} (${lastResult.status})`);
    if (lastResult.output) {
      sections.push(`[PREVIOUS_OUTPUT]\n${lastResult.output.slice(0, 2000)}`);
    }
  }

  if (pipeline.changedFiles.length > 0) {
    sections.push(`[CHANGED_FILES]\n${pipeline.changedFiles.join('\n')}`);
  }

  // Inject generated worker context for post-implement phases
  if (pipeline.generatedWorkerName && phase !== 'implement') {
    sections.push(`[GENERATED_WORKER] ${pipeline.generatedWorkerName}`);
    sections.push(`[REVIEW_TARGET] Review the dynamically generated worker "${pipeline.generatedWorkerName}" for correctness, security, and alignment with the objective.`);
  }

  // Inject actual code diffs for review/security-audit/implement (re-implement) phases
  if (pipeline.codeChanges && pipeline.codeChanges.length > 0) {
    if (phase === 'review' || phase === 'security-audit') {
      const diffSections: string[] = ['[CODE_DIFFS] Review the following actual code modifications:'];
      for (const change of pipeline.codeChanges) {
        const origSnippet = change.originalContent.slice(0, 1500);
        const newSnippet = change.newContent.slice(0, 1500);
        diffSections.push(
          `\n### ${change.filePath}`,
          `**Before (truncated):**\n\`\`\`typescript\n${origSnippet}\n\`\`\``,
          `**After (truncated):**\n\`\`\`typescript\n${newSnippet}\n\`\`\``,
        );
      }
      sections.push(diffSections.join('\n'));
    } else if (phase === 'implement' && pipeline.implementReviewLoopCount > 0) {
      // Re-implement: feed structured diff context so the LLM knows what was tried and rejected
      const rejectedSummary = pipeline.codeChanges.map(
        (c) => `- ${c.filePath} (${c.newContent.length} bytes → rolled back)`,
      ).join('\n');
      sections.push(`[PREVIOUS_CODE_CHANGES_REJECTED]\nThe following code modifications were attempted but rejected by review/qa:\n${rejectedSummary}\nMake different changes to address the review feedback.`);
    }
  }

  return sections.join('\n\n');
};

// ──── Pipeline advancement ────────────────────────────────────────────────────

export const advanceSprintPhase = async (sprintId: string): Promise<{
  ok: boolean;
  pipeline: SprintPipeline;
  phaseResult?: PhaseResult;
  message: string;
}> => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) {
    return { ok: false, pipeline: {} as SprintPipeline, message: 'Pipeline not found' };
  }

  if (pipeline.currentPhase === 'complete' || pipeline.currentPhase === 'cancelled') {
    return { ok: false, pipeline, message: `Pipeline already ${pipeline.currentPhase}` };
  }

  if (pipeline.currentPhase === 'blocked') {
    return { ok: false, pipeline, message: 'Pipeline is blocked — requires manual intervention or cancellation' };
  }

  if (pipeline.totalPhasesExecuted >= SPRINT_MAX_TOTAL_PHASES) {
    pipeline.currentPhase = 'blocked';
    pipeline.error = `Max total phases exceeded (${SPRINT_MAX_TOTAL_PHASES})`;
    pipeline.updatedAt = new Date().toISOString();
    return { ok: false, pipeline, message: pipeline.error };
  }

  if (pipeline.changedFiles.length > SPRINT_CHANGED_FILE_CAP) {
    pipeline.currentPhase = 'blocked';
    pipeline.error = `Changed file cap exceeded (${SPRINT_CHANGED_FILE_CAP})`;
    pipeline.updatedAt = new Date().toISOString();
    return { ok: false, pipeline, message: pipeline.error };
  }

  const currentPhase = pipeline.currentPhase;
  logger.info('[SPRINT] advancing pipeline=%s phase=%s', sprintId, currentPhase);

  // ── Scope guard: check changed files are within allowed scope ──
  if (pipeline.changedFiles.length > 0) {
    const scopeCheck = checkFilesScope(pipeline.changedFiles);
    if (!scopeCheck.allowed) {
      pipeline.currentPhase = 'blocked';
      pipeline.error = `Scope guard: ${scopeCheck.reason}`;
      pipeline.updatedAt = new Date().toISOString();
      return { ok: false, pipeline, message: pipeline.error };
    }
  }

  const phaseStartMs = Date.now();
  const phaseResult = await executePhaseAction(pipeline, currentPhase);
  const phaseDurationMs = Date.now() - phaseStartMs;
  recordPhaseMetric(currentPhase, phaseDurationMs, phaseResult.status === 'failed');

  // ── Autoplan: multi-lens review after plan phase ──
  if (currentPhase === 'plan' && phaseResult.status === 'success') {
    // Inject Obsidian journal reconfig hints into plan output
    try {
      const journalSection = await loadJournalPreambleSection();
      if (journalSection) {
        phaseResult.output += `\n\n${journalSection}`;
      }
    } catch {
      // Journal enrichment is best-effort
    }

    const autoplanResult = await runAutoplan({
      planOutput: phaseResult.output,
      objective: pipeline.objective,
    });
    if (autoplanResult) {
      phaseResult.output += formatAutoplanAppendix(autoplanResult);
      if (autoplanResult.requiresHumanDecision && pipeline.autonomyLevel !== 'full-auto') {
        phaseResult.status = 'awaiting-approval';
        phaseResult.output += '\n\nAWAITING_APPROVAL: Autoplan found taste decisions requiring human input.';
      }
    }
  }

  // ── Cross-model outside voice: independent review for review phases ──
  if (isCrossModelPhase(currentPhase) && phaseResult.status === 'success') {
    const crossResult = await requestCrossModelReview({
      phase: currentPhase,
      primaryOutput: phaseResult.output,
      objective: pipeline.objective,
      changedFiles: pipeline.changedFiles,
    });
    if (crossResult) {
      phaseResult.output += formatCrossModelAppendix(crossResult);
    }
  }

  // ── LLM-as-Judge: quality score for applicable phases ──
  if (isJudgePhase(currentPhase) && phaseResult.status === 'success') {
    const judgeResult = await judgePhaseOutput({
      phase: currentPhase,
      objective: pipeline.objective,
      output: phaseResult.output,
      artifacts: phaseResult.artifacts,
    });
    if (judgeResult) {
      phaseResult.output += formatJudgeAppendix(judgeResult);
    }
  }

  // ── Self-learning loop: feed retro results to OpenJarvis for trace + optimize ──
  if (currentPhase === 'retro' && phaseResult.status === 'success') {
    const learningAppendix: string[] = [];

    // 1. Store trace data
    const traceResult = await executeExternalAction('openjarvis', 'jarvis.trace', {
      trace: {
        run_id: pipeline.sprintId,
        phase: 'retro',
        objective: pipeline.objective,
        output: phaseResult.output.slice(0, 3000),
        changed_files: pipeline.changedFiles,
        total_phases: pipeline.totalPhasesExecuted,
        timestamp: new Date().toISOString(),
      },
    });
    if (traceResult.ok) {
      learningAppendix.push(`[TRACE] stored (run_id=${pipeline.sprintId})`);
    }

    // 2. Trigger optimization if enough traces have accumulated
    const optimizeResult = await executeExternalAction('openjarvis', 'jarvis.optimize', {});
    if (optimizeResult.ok && optimizeResult.output.length > 0) {
      learningAppendix.push(`[OPTIMIZE] ${optimizeResult.output.slice(0, 5).join('; ')}`);
    }

    // 3. Run benchmark for before/after comparison
    const benchResult = await executeExternalAction('openjarvis', 'jarvis.bench', {});
    if (benchResult.ok && benchResult.output.length > 0) {
      learningAppendix.push(`[BENCH] ${benchResult.output.slice(0, 5).join('; ')}`);
    }

    if (learningAppendix.length > 0) {
      phaseResult.output += `\n\n## Self-Learning Loop\n${learningAppendix.join('\n')}`;
      logger.info('[SPRINT] self-learning loop completed for sprint=%s steps=%d', sprintId, learningAppendix.length);

      // C-17/18: Store learning insights for next sprint's plan phase
      storeLearningInsight({
        sprintId: pipeline.sprintId,
        storedAt: new Date().toISOString(),
        optimizeHints: optimizeResult.ok ? optimizeResult.output.slice(0, 5) : [],
        benchResults: benchResult.ok ? benchResult.output.slice(0, 5) : [],
      });
    }

    // ── Obsidian journal: persist retro insights to vault for pattern accumulation ──
    const phaseTimings: Record<string, number> = {};
    const failedPhases: string[] = [];
    const succeededPhases: string[] = [];
    for (const [key, result] of Object.entries(pipeline.phaseResults)) {
      const phaseName = key.replace(/-\d+$/, '');
      const start = new Date(result.startedAt).getTime();
      const end = new Date(result.completedAt).getTime();
      if (Number.isFinite(start) && Number.isFinite(end)) {
        phaseTimings[phaseName] = end - start;
      }
      if (result.status === 'failed') failedPhases.push(phaseName);
      if (result.status === 'success') succeededPhases.push(phaseName);
    }

    const journalEntry: JournalEntry = {
      sprintId: pipeline.sprintId,
      guildId: pipeline.guildId,
      objective: pipeline.objective,
      totalPhases: pipeline.totalPhasesExecuted,
      implementReviewLoops: pipeline.implementReviewLoopCount,
      changedFiles: pipeline.changedFiles,
      retroOutput: phaseResult.output.slice(0, 3000),
      optimizeHints: optimizeResult.ok ? optimizeResult.output.slice(0, 5) : [],
      benchResults: benchResult.ok ? benchResult.output.slice(0, 5) : [],
      phaseTimings,
      failedPhases,
      succeededPhases,
      completedAt: new Date().toISOString(),
    };

    recordSprintJournalEntry(journalEntry).catch((err) =>
      logger.warn('[SPRINT] journal entry write failed: %s', err instanceof Error ? err.message : String(err)),
    );
  }

  // Track implement↔review loops
  if (currentPhase === 'review' && phaseResult.status !== 'success') {
    pipeline.implementReviewLoopCount++;
    recordLoopBack();

    // Rollback code changes before re-implementing so the next iteration starts clean
    if (pipeline.codeChanges && pipeline.codeChanges.length > 0) {
      logger.info('[SPRINT] rolling back %d code change(s) after review failure', pipeline.codeChanges.length);
      await rollbackCodeChanges(pipeline.codeChanges);
      pipeline.codeChanges = undefined;
    }
  }

  // Rollback code changes when qa fails and loops back to implement
  if (currentPhase === 'qa' && phaseResult.status !== 'success') {
    if (pipeline.codeChanges && pipeline.codeChanges.length > 0) {
      logger.info('[SPRINT] rolling back %d code change(s) after qa failure', pipeline.codeChanges.length);
      await rollbackCodeChanges(pipeline.codeChanges);
      pipeline.codeChanges = undefined;
    }
  }

  // Record result
  const resultKey = `${currentPhase}-${pipeline.totalPhasesExecuted}`;
  pipeline.phaseResults[resultKey] = phaseResult;
  pipeline.totalPhasesExecuted++;

  // Track changed files from artifacts
  const newFiles = phaseResult.artifacts.filter((a) => a.endsWith('.ts') || a.endsWith('.js') || a.endsWith('.md'));
  for (const f of newFiles) {
    if (!pipeline.changedFiles.includes(f)) {
      pipeline.changedFiles.push(f);
    }
  }

  // Handle awaiting-approval
  if (phaseResult.status === 'awaiting-approval') {
    // Create approval request via governance store (enables Discord button notification)
    try {
      const approvalReq = await createActionApprovalRequest({
        guildId: pipeline.guildId,
        requestedBy: 'sprint-pipeline',
        goal: `Sprint ${sprintId} phase "${currentPhase}" requires approval`,
        actionName: `sprint.${currentPhase}`,
        actionArgs: { sprintId, phase: currentPhase, objective: pipeline.objective },
        reason: `Autonomy level ${pipeline.autonomyLevel} requires human approval for phase "${currentPhase}"`,
      });
      phaseResult.output += `\n\nAPPROVAL_REQUEST_ID: ${approvalReq.id}`;
    } catch (approvalError) {
      logger.warn('[SPRINT] approval request creation failed: %s', approvalError instanceof Error ? approvalError.message : String(approvalError));
    }
    pipeline.updatedAt = new Date().toISOString();
    persistPipeline(pipeline).catch(() => {});
    return { ok: true, pipeline, phaseResult, message: `Phase ${currentPhase} awaiting approval` };
  }

  // Determine next phase
  const transition = PHASE_TRANSITIONS[currentPhase];
  const nextPhase = transition ? transition(phaseResult, pipeline) : 'blocked';

  pipeline.currentPhase = nextPhase;
  pipeline.updatedAt = new Date().toISOString();

  if (nextPhase === 'complete') {
    pipeline.completedAt = new Date().toISOString();
    logger.info('[SPRINT] pipeline=%s completed successfully', sprintId);
  } else if (nextPhase === 'blocked') {
    pipeline.error = `Phase ${currentPhase} failed: ${phaseResult.output.slice(0, 200)}`;
    logger.warn('[SPRINT] pipeline=%s blocked at phase=%s', sprintId, currentPhase);
  }

  persistPipeline(pipeline).catch(() => {});

  return {
    ok: nextPhase !== 'blocked',
    pipeline,
    phaseResult,
    message: nextPhase === 'complete'
      ? 'Sprint completed successfully'
      : nextPhase === 'blocked'
        ? `Sprint blocked at ${currentPhase}`
        : `Advanced to ${nextPhase}`,
  };
};

// ──── Full pipeline run ───────────────────────────────────────────────────────

export const runFullSprintPipeline = async (sprintId: string): Promise<SprintPipeline> => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) throw new Error(`Pipeline ${sprintId} not found`);

  // Refresh journal-driven reconfig hints before execution
  await refreshReconfigHints();

  while (
    pipeline.currentPhase !== 'complete' &&
    pipeline.currentPhase !== 'blocked' &&
    pipeline.currentPhase !== 'cancelled' &&
    pipeline.totalPhasesExecuted < SPRINT_MAX_TOTAL_PHASES
  ) {
    const result = await advanceSprintPhase(sprintId);

    // Stop if awaiting approval in any non-full-auto mode
    if (result.phaseResult?.status === 'awaiting-approval') {
      logger.info('[SPRINT] pipeline=%s paused for approval at phase=%s', sprintId, pipeline.currentPhase);
      break;
    }

    if (!result.ok) break;
  }

  return pipeline;
};

// ──── Approval handling ───────────────────────────────────────────────────────

export const approveSprintPhase = async (sprintId: string, approvedBy: string): Promise<{
  ok: boolean;
  message: string;
}> => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) return { ok: false, message: 'Pipeline not found' };

  const lastResult = Object.values(pipeline.phaseResults).pop();
  if (!lastResult || lastResult.status !== 'awaiting-approval') {
    return { ok: false, message: 'No phase awaiting approval' };
  }

  logger.info('[SPRINT] phase=%s approved by=%s pipeline=%s', pipeline.currentPhase, approvedBy, sprintId);

  // Re-execute the phase without approval gate by temporarily overriding
  lastResult.status = 'success';
  lastResult.output = `Approved by ${approvedBy} — re-executing phase`;

  // Determine next phase based on approval
  const transition = PHASE_TRANSITIONS[pipeline.currentPhase];
  const nextPhase = transition ? transition(lastResult, pipeline) : 'blocked';
  pipeline.currentPhase = nextPhase;
  pipeline.updatedAt = new Date().toISOString();

  persistPipeline(pipeline).catch(() => {});
  return { ok: true, message: `Phase approved, advancing to ${nextPhase}` };
};

export const cancelSprintPipeline = (sprintId: string): { ok: boolean; message: string } => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) return { ok: false, message: 'Pipeline not found' };

  pipeline.currentPhase = 'cancelled';
  pipeline.updatedAt = new Date().toISOString();
  pipeline.completedAt = new Date().toISOString();

  persistPipeline(pipeline).catch(() => {});
  logger.info('[SPRINT] pipeline=%s cancelled', sprintId);
  return { ok: true, message: 'Pipeline cancelled' };
};

// ──── Supabase persistence ────────────────────────────────────────────────────

const persistPipeline = async (pipeline: SprintPipeline): Promise<void> => {
  if (SPRINT_DRY_RUN) {
    logger.debug('[SPRINT][DRY-RUN] would persist pipeline=%s phase=%s', pipeline.sprintId, pipeline.currentPhase);
    return;
  }
  if (!isSupabaseConfigured()) return;
  try {
    const client = getSupabaseClient();
    await client.from(SPRINT_PIPELINES_TABLE).upsert({
      sprint_id: pipeline.sprintId,
      trigger_id: pipeline.triggerId,
      trigger_type: pipeline.triggerType,
      guild_id: pipeline.guildId,
      objective: pipeline.objective,
      autonomy_level: pipeline.autonomyLevel,
      current_phase: pipeline.currentPhase,
      phase_results: pipeline.phaseResults,
      phase_order: pipeline.phaseOrder,
      changed_files: pipeline.changedFiles,
      total_phases_executed: pipeline.totalPhasesExecuted,
      impl_review_loop_count: pipeline.implementReviewLoopCount,
      max_impl_review_loops: pipeline.maxImplReviewLoops,
      error: pipeline.error || null,
      created_at: pipeline.createdAt,
      updated_at: pipeline.updatedAt,
      completed_at: pipeline.completedAt || null,
    }, { onConflict: 'sprint_id' });
  } catch (error) {
    logger.debug('[SPRINT] persist failed: %s', error instanceof Error ? error.message : String(error));
  }
};

// ──── Snapshot ─────────────────────────────────────────────────────────────────

// ──── Rehydration ─────────────────────────────────────────────────────────────

export const rehydrateActivePipelines = async (): Promise<number> => {
  if (!SPRINT_ENABLED || !isSupabaseConfigured()) return 0;
  try {
    const client = getSupabaseClient();
    const { data } = await client
      .from(SPRINT_PIPELINES_TABLE)
      .select('*')
      .not('current_phase', 'in', '("complete","cancelled","blocked")')
      .order('created_at', { ascending: false })
      .limit(50);
    if (!data || data.length === 0) return 0;

    for (const row of data as Array<Record<string, unknown>>) {
      const sprintId = String(row.sprint_id || '');
      if (!sprintId || pipelines.has(sprintId)) continue;

      const pipeline: SprintPipeline = {
        sprintId,
        triggerId: String(row.trigger_id || ''),
        triggerType: (row.trigger_type || 'manual') as SprintTriggerType,
        guildId: String(row.guild_id || ''),
        objective: String(row.objective || ''),
        autonomyLevel: (row.autonomy_level || SPRINT_AUTONOMY_LEVEL) as AutonomyLevel,
        currentPhase: (row.current_phase || 'blocked') as SprintPhase,
        phaseResults: (row.phase_results || {}) as Record<string, PhaseResult>,
        phaseOrder: Array.isArray(row.phase_order) ? row.phase_order as SprintPhase[] : [...DEFAULT_PHASE_ORDER],
        implementReviewLoopCount: Number(row.impl_review_loop_count || 0),
        maxImplReviewLoops: Number(row.max_impl_review_loops || SPRINT_MAX_IMPL_REVIEW_LOOPS),
        totalPhasesExecuted: Number(row.total_phases_executed || 0),
        changedFiles: Array.isArray(row.changed_files) ? row.changed_files as string[] : [],
        rollbackPlan: '',
        createdAt: String(row.created_at || new Date().toISOString()),
        updatedAt: String(row.updated_at || new Date().toISOString()),
        completedAt: row.completed_at ? String(row.completed_at) : undefined,
        error: row.error ? String(row.error) : undefined,
      };
      pipelines.set(sprintId, pipeline);
    }
    logger.info('[SPRINT] rehydrated %d active pipelines from Supabase', data.length);
    return data.length;
  } catch (error) {
    logger.warn('[SPRINT] rehydration failed: %s', error instanceof Error ? error.message : String(error));
    return 0;
  }
};

// ──── Observability / Metrics ──────────────────────────────────────────────────

const sprintMetrics = {
  totalPipelinesCreated: 0,
  totalPhasesExecuted: 0,
  totalPhasesFailed: 0,
  totalLoopBacks: 0,
  phaseTimingsMs: [] as Array<{ phase: string; durationMs: number; at: string }>,
};

/** Record a phase execution metric (called internally after each phase). */
export const recordPhaseMetric = (phase: string, durationMs: number, failed: boolean): void => {
  sprintMetrics.totalPhasesExecuted++;
  if (failed) sprintMetrics.totalPhasesFailed++;
  sprintMetrics.phaseTimingsMs.push({ phase, durationMs, at: new Date().toISOString() });
  // Keep only last 200 entries to bound memory
  if (sprintMetrics.phaseTimingsMs.length > 200) {
    sprintMetrics.phaseTimingsMs = sprintMetrics.phaseTimingsMs.slice(-200);
  }
};

export const recordPipelineCreated = (): void => {
  sprintMetrics.totalPipelinesCreated++;
};

export const recordLoopBack = (): void => {
  sprintMetrics.totalLoopBacks++;
};

export type SprintMetricsSummary = {
  totalPipelinesCreated: number;
  totalPhasesExecuted: number;
  totalPhasesFailed: number;
  totalLoopBacks: number;
  avgPhaseDurationMs: number;
  recentTimings: Array<{ phase: string; durationMs: number; at: string }>;
};

export const getSprintMetrics = (): SprintMetricsSummary => {
  const timings = sprintMetrics.phaseTimingsMs;
  const avg = timings.length > 0
    ? Math.round(timings.reduce((s, t) => s + t.durationMs, 0) / timings.length)
    : 0;
  return {
    totalPipelinesCreated: sprintMetrics.totalPipelinesCreated,
    totalPhasesExecuted: sprintMetrics.totalPhasesExecuted,
    totalPhasesFailed: sprintMetrics.totalPhasesFailed,
    totalLoopBacks: sprintMetrics.totalLoopBacks,
    avgPhaseDurationMs: avg,
    recentTimings: timings.slice(-20),
  };
};

// ──── Snapshot ─────────────────────────────────────────────────────────────────

export type SprintRuntimeSnapshot = {
  enabled: boolean;
  defaultAutonomyLevel: AutonomyLevel;
  activePipelines: number;
  completedPipelines: number;
  blockedPipelines: number;
  recentPipelines: Array<{
    sprintId: string;
    triggerType: SprintTriggerType;
    currentPhase: SprintPhase;
    objective: string;
    totalPhasesExecuted: number;
    createdAt: string;
  }>;
};

export const getSprintRuntimeSnapshot = (): SprintRuntimeSnapshot => {
  const all = Array.from(pipelines.values());
  return {
    enabled: SPRINT_ENABLED,
    defaultAutonomyLevel: SPRINT_AUTONOMY_LEVEL,
    activePipelines: all.filter((p) => !['complete', 'blocked', 'cancelled'].includes(p.currentPhase)).length,
    completedPipelines: all.filter((p) => p.currentPhase === 'complete').length,
    blockedPipelines: all.filter((p) => p.currentPhase === 'blocked').length,
    recentPipelines: all
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((p) => ({
        sprintId: p.sprintId,
        triggerType: p.triggerType,
        currentPhase: p.currentPhase,
        objective: p.objective.slice(0, 120),
        totalPhasesExecuted: p.totalPhasesExecuted,
        createdAt: p.createdAt,
      })),
  };
};
