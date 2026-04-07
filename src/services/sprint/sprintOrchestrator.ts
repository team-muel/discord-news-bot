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
  MCP_FAST_FAIL_TIMEOUT_MS,
} from '../../config';
import { getPhaseActionName, getPhaseLeadAgent, buildPhaseSystemPrompt } from './skillPromptLoader';
import { isDeterministicPhase, executeFastPath } from './fastPathExecutors';
import { formatActionableOutput } from './actionableErrors';
import { buildSprintPreamble, storeLearningInsight, loadJournalPreambleSection, isActionBlockedInPhase, accumulateActionContext, clearSprintContext, enrichPhaseContext } from './sprintPreamble';
import { recordSprintJournalEntry, applyReconfigToPhaseOrder, loadWorkflowReconfigHints, type JournalEntry, type WorkflowReconfigHints } from './sprintLearningJournal';
import { createLoopState, checkActionLoop, actionSignature, formatLoopWarning, type LoopState } from '../skills/loopDetection';
import { parseBenchResult } from '../tools/adapters/openjarvisAdapter';
import { writeLocalCache, readLocalCache } from '../localStateCache';
import { executeHooks } from './sprintHooks';
import { ingestRetroInsights, precipitateSessionToMemory, adjustBehaviorFromReward } from '../entityNervousSystem';
import { isCrossModelPhase, requestCrossModelReview, formatCrossModelAppendix } from './crossModelVoice';
import { checkFilesScope } from './scopeGuard';
import { isJudgePhase, judgePhaseOutput, formatJudgeAppendix } from './llmJudge';
import { runAutoplan, formatAutoplanAppendix } from './autoplan';
import { getAction } from '../skills/actions/registry';
import { getDynamicAction } from '../workerGeneration/dynamicWorkerRegistry';
import { getSupabaseClient, isSupabaseConfigured } from '../supabaseClient';
import { getMcpWorkerUrl, callMcpWorkerTool, parseMcpTextBlocks, type McpWorkerKind } from '../skills/actions/mcpDelegate';
import { resolveWorkerByKind } from '../mcpSkillRouter';
import { createActionApprovalRequest } from '../skills/actionGovernanceStore';
import { executeExternalAction } from '../tools/externalAdapterRegistry';
import { runWorkerGenerationPipeline } from '../workerGeneration/workerGenerationPipeline';
import { generateAndApplyCodeChanges, rollbackCodeChanges, type CodeChange } from './sprintCodeWriter';
import { buildStructuralDiffSection } from './sprintDiffSummarizer';
import { recordWorkflowEvent } from '../workflow/workflowPersistenceService';
import { persistTrafficRoutingDecision, type TrafficRoutingDecision } from '../workflow/trafficRoutingService';
import {
  PHASE_WORKER_KIND,
  PHASE_EXTERNAL_ADAPTER,
  getPhaseExternalAdapterMap,
  isWorkerKnownDead,
  recordWorkerHealth,
  getWorkerHealthCacheSnapshot,
  isAdapterCircuitOpen,
  recordAdapterResult,
  getAdapterCircuitBreakerSnapshot,
  buildExternalAdapterArgs,
  buildSecondaryAdapterArgs,
} from './sprintWorkerRouter';
import {
  recordPhaseMetric as _recordPhaseMetric,
  recordPipelineCreated as _recordPipelineCreated,
  recordLoopBack as _recordLoopBack,
  getSprintMetrics as _getSprintMetrics,
  type SprintMetricsSummary,
} from './sprintMetricsCollector';
import {
  shadowPipelineCreated,
  shadowPhaseCompleted,
  shadowFilesChanged,
  shadowPipelineCancelled,
  shadowPipelineBlocked,
} from './eventSourcing/bridge';
import { logCatchError, debugCatchError, getErrorMessage } from '../../utils/errorMessage';

const catchPersist = logCatchError(logger, '[SPRINT] persistPipeline');
const catchShadow = debugCatchError(logger, '[VENTYD] shadow');

// Re-export for backward compatibility
export { getPhaseExternalAdapterMap, getWorkerHealthCacheSnapshot, getAdapterCircuitBreakerSnapshot } from './sprintWorkerRouter';
export { recordPhaseMetric, recordPipelineCreated, recordLoopBack, getSprintMetrics, type SprintMetricsSummary } from './sprintMetricsCollector';

// Local aliases for internal usage
const recordPhaseMetric = _recordPhaseMetric;
const recordPipelineCreated = _recordPipelineCreated;
const recordLoopBack = _recordLoopBack;

// Race a promise against a timeout, cleaning up the timer when the main promise resolves
const raceWithTimeout = <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
};

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
  | 'self-improvement'
  | 'observation';

export type AutonomyLevel = 'full-auto' | 'approve-ship' | 'approve-impl' | 'manual';

export type PhaseResult = {
  phase: SprintPhase;
  status: 'success' | 'failed' | 'blocked' | 'skipped' | 'awaiting-approval' | 'approved';
  output: string;
  artifacts: string[];
  sessionId?: string;
  startedAt: string;
  completedAt: string;
  iterationCount: number;
  /** GAP-006: Which adapter handled this phase (undefined = local action fallback) */
  adapterMeta?: {
    adapterId: string;
    action: string;
    durationMs: number;
    ok: boolean;
    error?: string;
    secondary?: { adapterId: string; action: string };
  };
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
  /** Loop detection state — tracks consecutive identical action calls. */
  loopState: LoopState;
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
      // Insert security-audit before qa if review explicitly flags security concerns
      // Use word-boundary matching to avoid false positives from "no SECURITY issues"
      if (/\bSECURITY[_\s]?(ISSUE|CONCERN|VULN|RISK|FINDING)/i.test(r.output) ||
          /\bsecurity concern\b/i.test(r.output)) {
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

const MAX_PIPELINE_ENTRIES = 200;
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
  } catch (err) {
    logger.debug('[SPRINT] reconfig-hints refresh failed: %s', getErrorMessage(err));
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
    loopState: createLoopState(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (mutation.appliedProposals.length > 0) {
    logger.info('[SPRINT] reconfig applied to pipeline=%s: %s', sprintId, mutation.log.filter((l) => l.startsWith('[APPLIED')).join('; '));
  }

  pipelines.set(sprintId, pipeline);
  // Evict oldest completed pipelines when exceeding cap
  if (pipelines.size > MAX_PIPELINE_ENTRIES) {
    const completed = [...pipelines.entries()]
      .filter(([, p]) => p.currentPhase === 'complete' || p.currentPhase === 'cancelled' || p.currentPhase === 'blocked')
      .sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt));
    const toRemove = Math.max(1, pipelines.size - MAX_PIPELINE_ENTRIES);
    for (let i = 0; i < Math.min(toRemove, completed.length); i++) {
      pipelines.delete(completed[i][0]);
    }
  }
  recordPipelineCreated();
  logger.info('[SPRINT] created pipeline=%s trigger=%s objective=%.80s', sprintId, params.triggerType, params.objective);

  // Best-effort persist to Supabase
  persistPipeline(pipeline).catch(catchPersist);

  // Dual-write: shadow as Ventyd event (best-effort)
  shadowPipelineCreated(pipeline).catch(catchShadow);

  // Fire SprintStart lifecycle hook (best-effort, non-blocking)
  executeHooks({
    hookPoint: 'SprintStart',
    sprintId,
    meta: { triggerType: params.triggerType, objective: params.objective, guildId: params.guildId },
  }).catch(() => {});

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

/** Mark a pipeline as blocked (e.g., after an unhandled crash during execution). */
export const markPipelineBlocked = (sprintId: string, reason: string): void => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) return;
  const terminal: SprintPhase[] = ['complete', 'cancelled', 'blocked'];
  if (terminal.includes(pipeline.currentPhase)) return;
  pipeline.currentPhase = 'blocked';
  pipeline.error = reason;
  pipeline.updatedAt = new Date().toISOString();
  persistPipeline(pipeline).catch(catchPersist);
  shadowPipelineBlocked(sprintId, reason).catch(catchShadow);
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

  // ── Phase tool enforcement (Cline PLAN_MODE_RESTRICTED_TOOLS pattern) ──
  const blockReason = isActionBlockedInPhase(phase, action.category);
  if (blockReason) {
    logger.warn('[SPRINT] phase enforcement blocked action=%s phase=%s reason=%s', actionName, phase, blockReason);
    return {
      phase,
      status: 'failed',
      output: blockReason,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 0,
    };
  }

  // ── Action loop detection (Cline loop-detection.ts pattern) ──
  const argSig = actionSignature(
    { phase, objective: pipeline.objective } as Record<string, unknown>,
  );
  const loopCheck = checkActionLoop(pipeline.loopState, actionName, argSig);
  if (loopCheck.hardBlock) {
    logger.error('[SPRINT] loop hard-block: action=%s repeated %d times, aborting', actionName, loopCheck.count);
    return {
      phase,
      status: 'failed',
      output: `Loop detection hard-block: "${actionName}" called ${loopCheck.count} consecutive times with identical parameters. Aborting to prevent infinite loop.`,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
      iterationCount: 0,
    };
  }
  const loopWarning = loopCheck.softWarning ? formatLoopWarning(actionName, loopCheck.count) : '';

  // ── ActionPreExec lifecycle hook — can cancel or inject context ──
  const preExecHook = await executeHooks({
    hookPoint: 'ActionPreExec',
    sprintId: pipeline.sprintId,
    phase,
    actionName,
    meta: { objective: pipeline.objective },
  }).catch(() => ({} as { cancel?: boolean; cancelReason?: string; context?: string }));

  if (preExecHook.cancel) {
    return {
      phase,
      status: 'failed',
      output: preExecHook.cancelReason || 'ActionPreExec hook cancelled execution',
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
        const pipeResult = await raceWithTimeout(
          runWorkerGenerationPipeline({
            goal: pipeline.objective,
            guildId: pipeline.guildId,
            requestedBy: `sprint:${pipeline.sprintId}`,
          }),
          SPRINT_PHASE_TIMEOUT_MS,
          'Worker generation timed out',
        );

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
        logger.warn('[SPRINT] worker-generation threw: %s, falling through to standard implement', getErrorMessage(wgError));
      }
    }

    // ── Code modification path: self-improvement / error-detection / manual / scheduled ──
    const CODE_MOD_TRIGGERS: SprintTriggerType[] = ['error-detection', 'self-improvement', 'manual', 'scheduled'];
    if (phase === 'implement' && CODE_MOD_TRIGGERS.includes(pipeline.triggerType)) {
      logger.info('[SPRINT] code-modification path for phase=%s trigger=%s', phase, pipeline.triggerType);
      try {
        const planKey = Object.keys(pipeline.phaseResults)
          .filter((k) => k.startsWith('plan-'))
          .sort()
          .pop();
        const planOutput = planKey ? pipeline.phaseResults[planKey]?.output : undefined;
        const codeResult = await raceWithTimeout(
          generateAndApplyCodeChanges({
            objective: pipeline.objective,
            changedFiles: pipeline.changedFiles,
            previousPhaseOutput: planOutput,
            sprintId: pipeline.sprintId,
          }),
          SPRINT_PHASE_TIMEOUT_MS,
          'Code modification timed out',
        );

        if (codeResult.ok) {
          pipeline.codeChanges = codeResult.changes;
          // Cache full diffs for lazy resolution by external adapters (no truncation)
          writeLocalCache(`sprint-${pipeline.sprintId}-diffs`, codeResult.changes, 2 * 60 * 60_000);
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
        logger.warn('[SPRINT] code-modification threw: %s, falling through to LLM action', getErrorMessage(cmError));
      }
    }

    // ── Fast-path: deterministic phases skip LLM entirely ──
    if (isDeterministicPhase(phase)) {
      logger.info('[SPRINT] fast-path execution for phase=%s (zero LLM tokens)', phase);
      const fastResult = await raceWithTimeout(
        executeFastPath({
          phase,
          sprintId: pipeline.sprintId,
          objective: pipeline.objective,
          changedFiles: pipeline.changedFiles,
          codeChanges: pipeline.codeChanges,
        }),
        SPRINT_PHASE_TIMEOUT_MS,
        `Fast-path ${phase} timed out`,
      ).catch(() => null);

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

    // ── Layer 2: Enrich phase context from external adapters (best-effort, non-blocking) ──
    let enrichedGoal = goal;
    try {
      const enrichment = await raceWithTimeout(
        enrichPhaseContext(phase, pipeline.objective, pipeline.changedFiles),
        10_000,
        'ENRICHMENT_TIMEOUT',
      );
      if (enrichment) {
        enrichedGoal = `${goal}\n\n${enrichment}`;
      }
    } catch (err) {
      logger.debug('[SPRINT] phase enrichment failed phase=%s: %s', phase, getErrorMessage(err));
    }

    const goalWithLoopWarning = loopWarning ? `${enrichedGoal}\n\n${loopWarning}` : enrichedGoal;

    // ── MCP worker delegation: prefer health-aware router, fall back to env-var lookup ──
    const workerKind = PHASE_WORKER_KIND[phase];
    const routerResult = workerKind ? resolveWorkerByKind(workerKind) : null;
    const workerUrl = routerResult?.workerUrl || (workerKind ? getMcpWorkerUrl(workerKind as McpWorkerKind) : '');

    if (workerUrl && !isWorkerKnownDead(workerUrl)) {
      logger.info('[SPRINT] delegating phase=%s to MCP worker=%s', phase, workerKind);
      try {
        const mcpResult = await raceWithTimeout(
          callMcpWorkerTool({
            workerUrl,
            toolName: actionName,
            args: {
              goal: goalWithLoopWarning,
              sprintId: pipeline.sprintId,
              phase,
              objective: pipeline.objective,
              changedFiles: pipeline.changedFiles,
            },
          }),
          MCP_FAST_FAIL_TIMEOUT_MS,
          `MCP delegation timed out for phase ${phase}`,
        );
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
          workerKind, phase, getErrorMessage(mcpError));
      }
    } else if (workerUrl) {
      logger.info('[SPRINT] skipping known-dead MCP worker %s for phase=%s', workerKind, phase);
    }

    // ── External adapter fallback: try real external tools before LLM-only fallback ──
    const externalMapping = PHASE_EXTERNAL_ADAPTER[phase];
    if (externalMapping) {
      // GAP-001: Skip adapter if circuit breaker is open (too many recent failures)
      if (isAdapterCircuitOpen(externalMapping.adapterId)) {
        logger.info('[SPRINT] skipping adapter %s for phase=%s (circuit breaker open)', externalMapping.adapterId, phase);
      } else {
        // Bootstrap OpenClaw session with tool catalog for implement phase
        if (phase === 'implement' && externalMapping.adapterId === 'openclaw') {
          try {
            const { bootstrapOpenClawSession } = await import('../tools/adapters/openclawCliAdapter');
            const sessionId = `sprint-${pipeline.sprintId}`;
            await raceWithTimeout(bootstrapOpenClawSession(sessionId), 5_000, 'OpenClaw bootstrap timeout');
          } catch (err) {
            logger.debug('[SPRINT] OpenClaw bootstrap failed: %s', getErrorMessage(err));
          }
        }

        const adapterArgs = buildExternalAdapterArgs(phase, pipeline);
        const attemptAdapter = async (): Promise<{ ok: boolean; output: string; durationMs: number; error?: string } | null> => {
          try {
            const adapterResult = await executeExternalAction(externalMapping.adapterId, externalMapping.action, adapterArgs);
            const adapterOutput = adapterResult.ok ? adapterResult.output.join('\n').trim() : '';
            return { ok: adapterResult.ok && adapterOutput.length >= 50, output: adapterOutput, durationMs: adapterResult.durationMs, error: adapterResult.error };
          } catch (err) {
            return { ok: false, output: '', durationMs: 0, error: getErrorMessage(err) };
          }
        };

        // GAP-003: Try once, retry once on transient failure with short backoff
        let attempt = await attemptAdapter();
        if (attempt && !attempt.ok && attempt.error && /timeout|ECONN|EPIPE|5\d\d/i.test(attempt.error)) {
          logger.info('[SPRINT] retrying adapter %s.%s for phase=%s after transient error: %s', externalMapping.adapterId, externalMapping.action, phase, attempt.error);
          await new Promise((r) => setTimeout(r, 500));
          attempt = await attemptAdapter();
        }

        if (attempt?.ok && attempt.output.length >= 50) {
          recordAdapterResult(externalMapping.adapterId, true);
          logger.info('[SPRINT] external adapter %s.%s succeeded for phase=%s (duration=%dms, outputLen=%d)', externalMapping.adapterId, externalMapping.action, phase, attempt.durationMs, attempt.output.length);

          // ── Secondary adapter: composite phase execution ──
          let combinedOutput = attempt.output;
          if (externalMapping.secondary && !isAdapterCircuitOpen(externalMapping.secondary.adapterId)) {
            try {
              const secondaryArgs = buildSecondaryAdapterArgs(phase, pipeline, attempt.output);
              const secondaryResult = await raceWithTimeout(
                executeExternalAction(externalMapping.secondary.adapterId, externalMapping.secondary.action, secondaryArgs),
                15_000,
                `Secondary adapter timeout for ${externalMapping.secondary.adapterId}`,
              );
              if (secondaryResult.ok && secondaryResult.output.join('\n').trim().length >= 20) {
                recordAdapterResult(externalMapping.secondary.adapterId, true);
                const secondaryOutput = secondaryResult.output.join('\n').trim().slice(0, 3000);
                combinedOutput = `${attempt.output}\n\n--- Secondary Analysis (${externalMapping.secondary.adapterId}.${externalMapping.secondary.action}) ---\n${secondaryOutput}`;
                logger.info('[SPRINT] secondary adapter %s.%s succeeded for phase=%s (duration=%dms)', externalMapping.secondary.adapterId, externalMapping.secondary.action, phase, secondaryResult.durationMs);
              } else {
                recordAdapterResult(externalMapping.secondary.adapterId, false);
              }
            } catch (secErr) {
              logger.debug('[SPRINT] secondary adapter %s failed for phase=%s: %s', externalMapping.secondary.adapterId, phase, getErrorMessage(secErr));
            }
          }

          return {
            phase,
            status: 'success',
            output: combinedOutput,
            artifacts: [],
            startedAt,
            completedAt: new Date().toISOString(),
            iterationCount: 1,
            // GAP-006: Persist adapter metadata for forensics
            adapterMeta: {
              adapterId: externalMapping.adapterId,
              action: externalMapping.action,
              durationMs: attempt.durationMs,
              ok: true,
              secondary: externalMapping.secondary ? { adapterId: externalMapping.secondary.adapterId, action: externalMapping.secondary.action } : undefined,
            },
          };
        }
        // Record failure for circuit breaker
        recordAdapterResult(externalMapping.adapterId, false);
        if (attempt?.ok && attempt.output.length < 50) {
          logger.warn('[SPRINT] external adapter %s.%s returned low-quality output for phase=%s (len=%d, min=50), falling through', externalMapping.adapterId, externalMapping.action, phase, attempt?.output.length ?? 0);
        } else {
          logger.info('[SPRINT] external adapter %s.%s unavailable/failed for phase=%s (%s), falling through to local action', externalMapping.adapterId, externalMapping.action, phase, attempt?.error || 'empty output');
        }
      }
    }

    // ── Local action fallback ──
    const result = await raceWithTimeout(
      action.execute({
        goal: goalWithLoopWarning,
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
      SPRINT_PHASE_TIMEOUT_MS,
      `Phase ${phase} timed out after ${SPRINT_PHASE_TIMEOUT_MS}ms`,
    );

    // ── Post-action context accumulation (Cline PostToolUse hook pattern) ──
    accumulateActionContext(pipeline.sprintId, phase, result);

    // ── ActionPostExec lifecycle hook (best-effort) ──
    executeHooks({
      hookPoint: 'ActionPostExec',
      sprintId: pipeline.sprintId,
      phase,
      actionName,
      meta: { ok: result.ok, summary: result.summary?.slice(0, 500) },
    }).catch(() => {});

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
    const rawError = getErrorMessage(error);
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
      sections.push(buildStructuralDiffSection(pipeline.codeChanges));
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

const inProgressPhases = new Set<string>();

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

  if (inProgressPhases.has(sprintId)) {
    return { ok: false, pipeline, message: 'Phase already in progress for this pipeline' };
  }
  inProgressPhases.add(sprintId);

  try {
    return await advanceSprintPhaseInner(pipeline, sprintId);
  } finally {
    inProgressPhases.delete(sprintId);
  }
};

const advanceSprintPhaseInner = async (pipeline: SprintPipeline, sprintId: string): Promise<{
  ok: boolean;
  pipeline: SprintPipeline;
  phaseResult?: PhaseResult;
  message: string;
}> => {

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

  // Fire PhaseStart lifecycle hook — can cancel phase execution
  const phaseStartHook = await executeHooks({
    hookPoint: 'PhaseStart',
    sprintId,
    phase: currentPhase,
    meta: { objective: pipeline.objective, totalPhasesExecuted: pipeline.totalPhasesExecuted },
  }).catch(() => ({} as { cancel?: boolean; cancelReason?: string; context?: string }));

  if (phaseStartHook.cancel) {
    const reason = phaseStartHook.cancelReason || 'PhaseStart hook cancelled execution';
    logger.warn('[SPRINT] PhaseStart hook cancelled phase=%s: %s', currentPhase, reason);
    return { ok: false, pipeline, message: reason };
  }

  const phaseResult = await executePhaseAction(pipeline, currentPhase);
  const phaseDurationMs = Date.now() - phaseStartMs;
  const phaseDeterministic = isDeterministicPhase(currentPhase);
  recordPhaseMetric(currentPhase, phaseDurationMs, phaseResult.status === 'failed', phaseDeterministic);

  // Fire PhaseComplete lifecycle hook (best-effort)
  executeHooks({
    hookPoint: 'PhaseComplete',
    sprintId,
    phase: currentPhase,
    meta: { status: phaseResult.status, durationMs: phaseDurationMs },
  }).catch(() => {});

  // ── Autoplan: multi-lens review after plan phase ──
  if (currentPhase === 'plan' && phaseResult.status === 'success') {
    // Inject Obsidian journal reconfig hints into plan output
    try {
      const journalSection = await loadJournalPreambleSection();
      if (journalSection) {
        phaseResult.output += `\n\n${journalSection}`;
      }
    } catch (err) {
      logger.debug('[SPRINT] journal enrichment failed: %s', getErrorMessage(err));
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
    } else {
      logger.warn('[SPRINT] self-learning trace failed for sprint=%s: %s', sprintId, traceResult.output.join('; ') || 'unknown');
    }

    // 2. Trigger optimization if enough traces have accumulated
    const optimizeResult = await executeExternalAction('openjarvis', 'jarvis.optimize', {});
    if (optimizeResult.ok && optimizeResult.output.length > 0) {
      learningAppendix.push(`[OPTIMIZE] ${optimizeResult.output.slice(0, 5).join('; ')}`);
    } else if (!optimizeResult.ok) {
      logger.warn('[SPRINT] self-learning optimize failed for sprint=%s: %s', sprintId, optimizeResult.output.join('; ') || 'unknown');
    }

    // 3. Run benchmark for before/after comparison
    const benchResult = await executeExternalAction('openjarvis', 'jarvis.bench', {});
    const benchParsed = benchResult.ok ? parseBenchResult(benchResult.output) : null;
    if (benchResult.ok && benchResult.output.length > 0) {
      const scoreLabel = benchParsed?.benchScore != null ? ` (score=${benchParsed.benchScore})` : '';
      learningAppendix.push(`[BENCH] ${benchResult.output.slice(0, 5).join('; ')}${scoreLabel}`);
    } else if (!benchResult.ok) {
      logger.warn('[SPRINT] self-learning bench failed for sprint=%s: %s', sprintId, benchResult.output.join('; ') || 'unknown');
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
        benchScore: benchParsed?.benchScore ?? null,
      });
    }

    // 4. Skill discovery: detect missing skills from trace patterns
    const skillDiscoveryResult = await executeExternalAction('openjarvis', 'jarvis.skill.discover', { limit: 5 });
    if (skillDiscoveryResult.ok && skillDiscoveryResult.output.length > 0) {
      learningAppendix.push(`[SKILL-DISCOVER] ${skillDiscoveryResult.output.slice(0, 3).join('; ')}`);
      logger.info('[SPRINT] skill discovery found candidates for sprint=%s', sprintId);
    }

    // 5. Telemetry snapshot: capture energy/latency metrics post-sprint
    const telemetryResult = await executeExternalAction('openjarvis', 'jarvis.telemetry', { window: '1h' });
    if (telemetryResult.ok && telemetryResult.output.length > 0) {
      learningAppendix.push(`[TELEMETRY] ${telemetryResult.output.slice(0, 3).join('; ')}`);
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
      benchScore: benchParsed?.benchScore ?? null,
      phaseTimings,
      failedPhases,
      succeededPhases,
      scaffoldingRatio: (() => {
        const allPhaseNames = Object.keys(pipeline.phaseResults).map((k) => k.replace(/-\d+$/, ''));
        const deterministicCount = allPhaseNames.filter((p) => isDeterministicPhase(p as SprintPhase)).length;
        return allPhaseNames.length > 0 ? deterministicCount / allPhaseNames.length : 0;
      })(),
      completedAt: new Date().toISOString(),
    };

    recordSprintJournalEntry(journalEntry).catch((err) =>
      logger.warn('[SPRINT] journal entry write failed: %s', getErrorMessage(err)),
    );

    // ── SOP auto-update: extract lessons from retro and persist to tribal knowledge ──
    const sopAction = getAction('sop.update');
    if (sopAction && failedPhases.length > 0) {
      const lessons: string[] = [];
      for (const fp of failedPhases) {
        lessons.push(`Sprint ${pipeline.sprintId}: ${fp} phase failed during "${pipeline.objective.slice(0, 100)}"`);
      }
      if (pipeline.implementReviewLoopCount > 1) {
        lessons.push(`Sprint ${pipeline.sprintId}: implement↔review looped ${pipeline.implementReviewLoopCount} times — review threshold may need adjustment`);
      }
      void sopAction.execute({
        goal: 'Auto-update SOP from retro',
        args: { lessons, section: 'Sprint Lessons Learned' },
        guildId: pipeline.guildId,
      }).catch((err) =>
        logger.debug('[SPRINT] sop.update best-effort failed: %s', getErrorMessage(err)),
      );
    }

    // Circuit 3: Ingest retro insights as self-notes for future session context
    void ingestRetroInsights({
      guildId: pipeline.guildId,
      sprintId: pipeline.sprintId,
      optimizeHints: journalEntry.optimizeHints,
      failedPhases: journalEntry.failedPhases,
    }).catch((err) =>
      logger.warn('[SPRINT] retro insight ingestion failed: %s', getErrorMessage(err)),
    );

    // Layer 3 Bridge: precipitate sprint outcome as agent memory for cross-system context
    void precipitateSessionToMemory({
      sessionId: `sprint-${pipeline.sprintId}`,
      guildId: pipeline.guildId,
      goal: pipeline.objective,
      result: phaseResult.output.slice(0, 2000),
      status: 'completed',
      stepCount: pipeline.totalPhasesExecuted,
      requestedBy: 'sprint-pipeline',
    }).catch((err) =>
      logger.debug('[SPRINT] memory precipitation failed: %s', getErrorMessage(err)),
    );
  }

  // Track implement↔review loops (count ANY failure that loops back to implement)
  const loopsBackToImplement = currentPhase === 'review' || currentPhase === 'qa' || currentPhase === 'security-audit' || currentPhase === 'ops-validate';
  if (loopsBackToImplement && phaseResult.status !== 'success') {
    pipeline.implementReviewLoopCount++;
    recordLoopBack();

    // Signal bus: phase looping detected
    if (pipeline.implementReviewLoopCount >= 2) {
      try {
        const { emitSignal } = await import('../runtime/signalBus');
        emitSignal('workflow.phase.looping', 'sprintOrchestrator', pipeline.guildId, {
          sprintId, loopCount: pipeline.implementReviewLoopCount,
          fromPhase: currentPhase, toPhase: 'implement',
        });
      } catch (err) {
        logger.debug('[SPRINT] signal-emit workflow.phase.looping failed: %s', getErrorMessage(err));
      }
    }

    // Rollback code changes before re-implementing so the next iteration starts clean
    if (pipeline.codeChanges && pipeline.codeChanges.length > 0) {
      logger.info('[SPRINT] rolling back %d code change(s) after %s failure', pipeline.codeChanges.length, currentPhase);
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

  // Dual-write: shadow phase completion + file changes as Ventyd events (best-effort)
  shadowPhaseCompleted(sprintId, {
    phase: currentPhase,
    status: phaseResult.status,
    output: phaseResult.output,
    artifacts: phaseResult.artifacts,
    startedAt: phaseResult.startedAt,
    completedAt: phaseResult.completedAt,
    iterationCount: phaseResult.iterationCount,
  }).catch(catchShadow);
  if (newFiles.length > 0) {
    shadowFilesChanged(sprintId, newFiles).catch(catchShadow);
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
      logger.warn('[SPRINT] approval request creation failed: %s', getErrorMessage(approvalError));
    }
    pipeline.updatedAt = new Date().toISOString();
    persistPipeline(pipeline).catch(catchPersist);
    return { ok: true, pipeline, phaseResult, message: `Phase ${currentPhase} awaiting approval` };
  }

  // Determine next phase
  const transition = PHASE_TRANSITIONS[currentPhase];
  const nextPhase = transition ? transition(phaseResult, pipeline) : 'blocked';

  pipeline.currentPhase = nextPhase;
  pipeline.updatedAt = new Date().toISOString();

  // Emit workflow event for sprint ↔ workflow cross-reference (best-effort)
  void recordWorkflowEvent({
    sessionId: `sprint-${sprintId}`,
    eventType: 'sprint_phase_transition',
    fromState: currentPhase,
    toState: nextPhase,
    handoffFrom: getPhaseLeadAgent(currentPhase as SprintPhase),
    handoffTo: nextPhase !== 'complete' && nextPhase !== 'blocked'
      ? getPhaseLeadAgent(nextPhase as SprintPhase)
      : undefined,
    decisionReason: phaseResult.status === 'success'
      ? `Phase ${currentPhase} succeeded (${phaseDurationMs}ms)`
      : `Phase ${currentPhase} ${phaseResult.status}: ${phaseResult.output.slice(0, 200)}`,
    evidenceId: sprintId,
    payload: {
      sprintId,
      guildId: pipeline.guildId,
      objective: pipeline.objective.slice(0, 200),
      phaseStatus: phaseResult.status,
      phaseDurationMs,
      totalPhasesExecuted: pipeline.totalPhasesExecuted,
      changedFilesCount: pipeline.changedFiles.length,
    },
  }).catch(debugCatchError(logger, '[SPRINT] recordWorkflowEvent'));

  if (nextPhase === 'complete') {
    pipeline.completedAt = new Date().toISOString();
    logger.info('[SPRINT] pipeline=%s completed successfully', sprintId);
    // Clean up accumulated context + persist final snapshot to local file cache
    clearSprintContext(sprintId);
    writeLocalCache(`sprint-${sprintId}`, {
      sprintId,
      objective: pipeline.objective,
      guildId: pipeline.guildId,
      totalPhasesExecuted: pipeline.totalPhasesExecuted,
      changedFiles: pipeline.changedFiles,
      completedAt: pipeline.completedAt,
    }, 7 * 24 * 60 * 60_000); // keep for 7 days

    // Fire SprintComplete lifecycle hook
    executeHooks({
      hookPoint: 'SprintComplete',
      sprintId,
      meta: { objective: pipeline.objective, changedFiles: pipeline.changedFiles, totalPhasesExecuted: pipeline.totalPhasesExecuted },
    }).catch(() => {});

    // ENS Circuit 2: sprint success is a positive signal — re-evaluate behavior
    void adjustBehaviorFromReward(pipeline.guildId).catch((err) =>
      logger.debug('[SPRINT] ENS behavior adjustment after completion failed: %s', getErrorMessage(err)),
    );

    // Signal bus: sprint completed
    try {
      const { emitSignal } = await import('../runtime/signalBus');
      emitSignal('workflow.sprint.completed', 'sprintOrchestrator', pipeline.guildId, {
        sprintId, triggerType: pipeline.triggerType,
        phasesExecuted: pipeline.totalPhasesExecuted,
        changedFiles: pipeline.changedFiles,
      });
    } catch (err) {
      logger.debug('[SPRINT] signal-emit sprint.completed failed: %s', getErrorMessage(err));
    }
  } else if (nextPhase === 'blocked') {
    pipeline.error = `Phase ${currentPhase} failed: ${phaseResult.output.slice(0, 200)}`;
    logger.warn('[SPRINT] pipeline=%s blocked at phase=%s', sprintId, currentPhase);

    // ENS Circuit 2: sprint failure is a negative signal — boost exploration
    void adjustBehaviorFromReward(pipeline.guildId).catch((err) =>
      logger.debug('[SPRINT] ENS behavior adjustment after block failed: %s', getErrorMessage(err)),
    );

    // Signal bus: sprint failed
    try {
      const { emitSignal } = await import('../runtime/signalBus');
      emitSignal('workflow.sprint.failed', 'sprintOrchestrator', pipeline.guildId, {
        sprintId, triggerType: pipeline.triggerType,
        phasesExecuted: pipeline.totalPhasesExecuted,
        changedFiles: pipeline.changedFiles,
      });
    } catch (err) {
      logger.debug('[SPRINT] signal-emit sprint.failed failed: %s', getErrorMessage(err));
    }
  }

  persistPipeline(pipeline).catch(catchPersist);

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

  // Find the most recent result for the current phase (keys are like "plan-0", "implement-1", etc.)
  const phaseKey = Object.keys(pipeline.phaseResults)
    .filter((k) => k.startsWith(`${pipeline.currentPhase}-`))
    .sort()
    .pop();
  const lastResult = phaseKey ? pipeline.phaseResults[phaseKey] : undefined;
  if (!lastResult || lastResult.status !== 'awaiting-approval') {
    return { ok: false, message: 'No phase awaiting approval' };
  }

  const approvedPhase = pipeline.currentPhase;
  logger.info('[SPRINT] phase=%s approved by=%s pipeline=%s — re-executing', approvedPhase, approvedBy, sprintId);

  // Mark approval in the result for audit trail
  lastResult.status = 'approved';
  lastResult.output = `Approved by ${approvedBy}`;

  // Temporarily override autonomy to execute this phase without re-triggering approval
  const originalAutonomy = pipeline.autonomyLevel;
  pipeline.autonomyLevel = 'full-auto';

  try {
    // Re-execute the approved phase (now runs without approval gate)
    const result = await advanceSprintPhase(sprintId);

    // Restore autonomy level
    pipeline.autonomyLevel = originalAutonomy;

    if (!result.ok) {
      persistPipeline(pipeline).catch(catchPersist);
      return { ok: true, message: `Phase ${approvedPhase} approved and executed, but failed: ${result.message}` };
    }

    // Continue the pipeline until next approval gate or completion
    void runFullSprintPipeline(sprintId).catch((err) =>
      logger.error('[SPRINT] pipeline resume after approval failed: %s', getErrorMessage(err)),
    );

    return { ok: true, message: `Phase ${approvedPhase} approved and executed, pipeline resuming` };
  } catch (err) {
    pipeline.autonomyLevel = originalAutonomy;
    const msg = getErrorMessage(err);
    logger.error('[SPRINT] phase re-execution after approval failed: %s', msg);
    persistPipeline(pipeline).catch(catchPersist);
    return { ok: false, message: `Phase execution failed after approval: ${msg}` };
  }
};

export const cancelSprintPipeline = (sprintId: string): { ok: boolean; message: string } => {
  const pipeline = pipelines.get(sprintId);
  if (!pipeline) return { ok: false, message: 'Pipeline not found' };

  pipeline.currentPhase = 'cancelled';
  pipeline.updatedAt = new Date().toISOString();
  pipeline.completedAt = new Date().toISOString();

  persistPipeline(pipeline).catch(catchPersist);
  shadowPipelineCancelled(sprintId).catch(catchShadow);
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
    logger.debug('[SPRINT] persist failed: %s', getErrorMessage(error));
  }
};

// ──── Snapshot ─────────────────────────────────────────────────────────────────

// ──── Rehydration ─────────────────────────────────────────────────────────────

let rehydrationInFlight: Promise<number> | null = null;

export const rehydrateActivePipelines = async (): Promise<number> => {
  if (rehydrationInFlight) return rehydrationInFlight;
  rehydrationInFlight = rehydrateActivePipelinesInner().finally(() => { rehydrationInFlight = null; });
  return rehydrationInFlight;
};

const rehydrateActivePipelinesInner = async (): Promise<number> => {
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
        loopState: createLoopState(),
        createdAt: String(row.created_at || new Date().toISOString()),
        updatedAt: String(row.updated_at || new Date().toISOString()),
        completedAt: row.completed_at ? String(row.completed_at) : undefined,
        error: row.error ? String(row.error) : undefined,
      };
      pipelines.set(sprintId, pipeline);
    }
    logger.info('[SPRINT] rehydrated %d active pipelines from Supabase', data.length);

    // Resume non-approval-blocked pipelines so they don't stall after restart
    for (const row of data as Array<Record<string, unknown>>) {
      const sprintId = String(row.sprint_id || '');
      const pipeline = pipelines.get(sprintId);
      if (!pipeline) continue;

      // Check if the most recent phase result is awaiting-approval — don't resume those
      const latestKey = Object.keys(pipeline.phaseResults)
        .filter((k) => k.startsWith(`${pipeline.currentPhase}-`))
        .sort()
        .pop();
      const latestResult = latestKey ? pipeline.phaseResults[latestKey] : undefined;
      if (latestResult?.status === 'awaiting-approval') {
        logger.info('[SPRINT] rehydrated pipeline=%s at phase=%s awaiting approval — not resuming', sprintId, pipeline.currentPhase);
        continue;
      }

      void runFullSprintPipeline(sprintId).catch((err) =>
        logger.warn('[SPRINT] rehydrated pipeline resume failed sprint=%s: %s', sprintId, getErrorMessage(err)),
      );
    }

    return data.length;
  } catch (error) {
    logger.warn('[SPRINT] rehydration failed: %s', getErrorMessage(error));
    return 0;
  }
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
