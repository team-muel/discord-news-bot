import crypto from 'crypto';
// Cross-domain imports via barrel exports (domain boundary contracts)
import { getDynamicAction } from '../workerGeneration';
import { compilePromptGoal } from '../infra';
// Root-level service imports (no barrel available)
import { decideFinopsAction, estimateActionExecutionCostUsd } from '../finopsService';
import { getGateProviderProfileOverride, setGateProviderProfileOverride, type LlmProviderProfile } from '../llmClient';
// Within-domain imports
import { getAction } from './actions/registry';
import { planActions } from './actions/planner';
import { getActionRunnerMode, isActionAllowed } from './actions/policy';
import {
  type ActionExecutionResult,
} from './actions/types';
import { logActionExecutionEvent } from './actionExecutionLogService';
import { parseBooleanEnv } from '../../utils/env';
import logger from '../../logger';
import {
  type FailureDiagnostics,
  type SkillActionResult,
  type ActionRunnerDiagnosticsSnapshot,
  createEmptyDiagnostics,
  classifyFailureCode,
  isExternalUnavailableError,
  updateActionRunnerDiagnostics,
  getActionRunnerDiagnosticsSnapshot,
  recordFailureCode,
} from './actionRunnerDiagnostics';
import {
  ACTION_CACHE_ENABLED,
  ACTION_CACHE_TTL_MS,
  ACTION_CIRCUIT_BREAKER_ENABLED,
  ACTION_FINOPS_DEGRADED_RETRY_MAX,
  ACTION_FINOPS_DEGRADED_TIMEOUT_MS,
  ACTION_RETRY_MAX,
  ACTION_RUNNER_ENABLED,
  ACTION_RUNNER_MODE,
  ACTION_TIMEOUT_MS,
  GATE_VERDICT_ENFORCEMENT_ENABLED,
  HIGH_RISK_APPROVAL_ACTIONS,
  isActionCacheable,
  isGovernanceFastPathEligible,
} from './actionRunnerConfig';
import {
  actionCircuitBreaker,
  getFinopsBudgetStatusSafely,
  getLatestGateVerdict,
} from './actionRunnerState';
import {
  extractWorkflowArtifactRefs,
  formatActionArtifactsForDisplay,
} from './actionRunnerArtifacts';
import {
  buildActionCacheKey,
  executeResolvedAction,
  getCachedActionResult,
  isActionCircuitOpen,
  storeCachedActionResult,
} from './actionRunnerExecution';
import { evaluateActionGovernanceGate } from './actionRunnerGovernance';
import { captureExternalNewsMemory } from './actionRunnerNewsCapture';

// Re-export for backward compatibility
export { getActionRunnerDiagnosticsSnapshot, type ActionRunnerDiagnosticsSnapshot } from './actionRunnerDiagnostics';
export type { SkillActionResult, FailureDiagnostics } from './actionRunnerDiagnostics';
export { getActionUtilityScore, __resetActionRunnerStateForTests as __resetActionRunnerForTests } from './actionRunnerState';
export { extractWorkflowArtifactRefs, formatActionArtifactsForDisplay } from './actionRunnerArtifacts';

/**
 * D-06: Sync HIGH_RISK_APPROVAL_ACTIONS to OpenShell network policy YAML.
 * Sends the current high-risk action list as deny-by-default rules to OpenShell policy.set.
 * Returns { synced, actions, error? }. Graceful no-op when OpenShell is unavailable.
 */
export const syncHighRiskActionsToSandboxPolicy = async (): Promise<{ synced: boolean; actions: string[]; error?: string }> => {
  const { runExternalAction } = await import('../tools/toolRouter');
  const actions = [...HIGH_RISK_APPROVAL_ACTIONS];
  if (actions.length === 0) {
    return { synced: false, actions, error: 'no high-risk actions configured' };
  }
  try {
    const policyYaml = [
      '# Auto-synced from HIGH_RISK_APPROVAL_ACTIONS',
      `# Generated: ${new Date().toISOString()}`,
      'network:',
      '  default: deny',
      '  rules:',
      ...actions.map((a) => `    - action: "${a}"\n      network: deny\n      approval_required: true`),
    ].join('\n');
    const result = await runExternalAction('openshell', 'policy.set', { policy: policyYaml });
    if (result.ok) {
      logger.info('[ACTION-RUNNER] high-risk actions synced to OpenShell policy: %d actions', actions.length);
      return { synced: true, actions };
    }
    return { synced: false, actions, error: result.error || result.summary };
  } catch (err) {
    const msg = getErrorMessage(err);
    logger.debug('[ACTION-RUNNER] OpenShell policy sync skipped: %s', msg);
    return { synced: false, actions, error: msg };
  }
};

type GoalActionInput = {
  goal: string;
  guildId: string;
  requestedBy: string;
  providerProfile?: LlmProviderProfile;
  sessionId?: string;
  runtimeLane?: string;
};

const pushActionArtifactSections = (lines: string[], artifacts: string[]): void => {
  const display = formatActionArtifactsForDisplay(artifacts);
  lines.push(display.artifactLines.length > 0 ? `산출물:\n${display.artifactLines.map((line) => `- ${line}`).join('\n')}` : '산출물: 없음');
  if (display.reflectionLines.length > 0) {
    lines.push(`반영 가이드:\n${display.reflectionLines.map((line) => `- ${line}`).join('\n')}`);
  }
};

export const runGoalActions = async (input: GoalActionInput): Promise<SkillActionResult> => {
  const diagnostics = createEmptyDiagnostics();
  const actionResults: ActionExecutionResult[] = [];

  const finish = (result: SkillActionResult): SkillActionResult => {
    updateActionRunnerDiagnostics(result);
    return result;
  };

  const pushActionResult = (result: ActionExecutionResult): void => {
    actionResults.push({
      ...result,
      artifacts: [...(result.artifacts || [])],
      verification: [...(result.verification || [])],
      handoff: result.handoff ? { ...result.handoff } : undefined,
    });
  };

  const recordFailureCategory = (code: string | undefined) => {
    diagnostics.totalFailures += 1;
    const normalizedCode = String(code || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    recordFailureCode(normalizedCode);
    const key = classifyFailureCode(normalizedCode);
    diagnostics[key] += 1;
  };

  if (!ACTION_RUNNER_ENABLED) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  // M-04/M-07: Gate verdict enforcement — block execution when latest gate = no-go
  if (GATE_VERDICT_ENFORCEMENT_ENABLED) {
    const gate = await getLatestGateVerdict(input.guildId);
    if (gate.overall === 'no-go') {
      recordFailureCategory('GATE_VERDICT_NO_GO');
      logger.warn('[ACTION-RUNNER] execution blocked by no-go gate verdict guild=%s', input.guildId);
      return finish({
        handled: true,
        output: 'go/no-go 게이트 verdict가 no-go이므로 실행이 차단되었습니다. 게이트 통과 후 재시도하세요.',
        hasSuccess: false,
        externalUnavailable: false,
        diagnostics,
      });
    }
    // M-06/M-07: Auto-regression — apply gate-recommended provider profile
    const profileTarget = gate.providerProfileTarget;
    if (profileTarget === 'cost-optimized' || profileTarget === 'quality-optimized') {
      setGateProviderProfileOverride(profileTarget as LlmProviderProfile, input.guildId);
    }
  }

  const compiledPrompt = compilePromptGoal(input.goal);
  const planningGoal = compiledPrompt.compiledGoal || input.goal;
  const executionGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || input.goal;
  const effectiveProviderProfile = getGateProviderProfileOverride(input.guildId) || input.providerProfile;

  const chain = await planActions(planningGoal, {
    guildId: input.guildId,
    requestedBy: input.requestedBy,
    providerProfile: effectiveProviderProfile || undefined,
    sessionId: input.sessionId,
  });
  if (!chain.actions || chain.actions.length === 0) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  const lines: string[] = ['요청 결과'];
  if (compiledPrompt.droppedNoise || compiledPrompt.intentTags.length > 0 || compiledPrompt.directives.length > 0) {
    lines.push([
      '[프롬프트 컴파일]',
      `- dropped_noise=${compiledPrompt.droppedNoise ? 'true' : 'false'}`,
      `- intent_tags=${compiledPrompt.intentTags.join(',') || 'none'}`,
      `- directives=${compiledPrompt.directives.join(',') || 'none'}`,
    ].join('\n'));
  }
  let handledAny = false;
  let hasSuccess = false;
  let externalUnavailable = false;
  const budget = await getFinopsBudgetStatusSafely(input.guildId);
  const finopsMode = budget?.mode || 'normal';
  if (budget?.enabled) {
    lines.push(`FinOps 모드: ${budget.mode} (daily=${budget.daily.spendUsd.toFixed(4)}/${budget.daily.budgetUsd.toFixed(2)}, monthly=${budget.monthly.spendUsd.toFixed(4)}/${budget.monthly.budgetUsd.toFixed(2)})`);
  }

  for (const planned of chain.actions) {
    if (budget?.enabled && !isGovernanceFastPathEligible(planned.actionName)) {
      const finopsDecision = decideFinopsAction({
        budget,
        actionName: planned.actionName,
      });

      if (!finopsDecision.allow) {
        recordFailureCategory(finopsDecision.reason);
        lines.push(`액션: ${planned.actionName}`);
        lines.push(`상태: 실패 (${finopsDecision.reason})`);
        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: planned.actionName,
          ok: false,
          summary: 'FinOps 예산 가드레일에 의해 실행이 차단되었습니다.',
          artifacts: [],
          verification: ['finops guardrail block'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          error: finopsDecision.reason,
          estimatedCostUsd: 0,
          finopsMode,
        });
        pushActionResult({
          ok: false,
          name: planned.actionName,
          summary: 'FinOps 예산 가드레일에 의해 실행이 차단되었습니다.',
          artifacts: [],
          verification: ['finops guardrail block'],
          error: finopsDecision.reason,
        });
        continue;
      }
    }

    if (!isActionAllowed(planned.actionName)) {
      recordFailureCategory('ACTION_NOT_ALLOWED');
      lines.push(`액션: ${planned.actionName}`);
      lines.push('상태: 실패 (ACTION_NOT_ALLOWED)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: planned.actionName,
        ok: false,
        summary: '정책 allowlist에 없는 액션입니다.',
        artifacts: [],
        verification: ['action allowlist policy block'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_NOT_ALLOWED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      pushActionResult({
        ok: false,
        name: planned.actionName,
        summary: '정책 allowlist에 없는 액션입니다.',
        artifacts: [],
        verification: ['action allowlist policy block'],
        error: 'ACTION_NOT_ALLOWED',
      });
      continue;
    }

    const action = getAction(planned.actionName) ?? getDynamicAction(planned.actionName);
    if (!action) {
      recordFailureCategory('ACTION_NOT_IMPLEMENTED');
      lines.push(`액션: ${planned.actionName}`);
      lines.push('상태: 실패 (ACTION_NOT_IMPLEMENTED)');
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: planned.actionName,
        ok: false,
        summary: '요청된 액션이 아직 구현되지 않았습니다.',
        artifacts: [],
        verification: ['action registry lookup miss'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: 'ACTION_NOT_IMPLEMENTED',
        estimatedCostUsd: 0,
        finopsMode,
      });
      pushActionResult({
        ok: false,
        name: planned.actionName,
        summary: '요청된 액션이 아직 구현되지 않았습니다.',
        artifacts: [],
        verification: ['action registry lookup miss'],
        error: 'ACTION_NOT_IMPLEMENTED',
      });
      externalUnavailable = true;
      continue;
    }

    const governanceGate = await evaluateActionGovernanceGate({
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      goal: input.goal,
      actionName: action.name,
      actionArgs: planned.args || {},
      fastPath: isGovernanceFastPathEligible(action.name),
    });
    if (!governanceGate.proceed) {
      recordFailureCategory(governanceGate.error);
      handledAny = handledAny || governanceGate.handledAny;
      lines.push(`액션: ${action.name}`);
      lines.push(governanceGate.lineStatus);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: governanceGate.summary,
        artifacts: governanceGate.artifacts,
        verification: governanceGate.verification,
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        error: governanceGate.error,
        estimatedCostUsd: 0,
        finopsMode,
      });
      pushActionResult({
        ok: false,
        name: action.name,
        summary: governanceGate.summary,
        artifacts: governanceGate.artifacts,
        verification: governanceGate.verification,
        error: governanceGate.error,
      });
      continue;
    }

    handledAny = true;

    if (ACTION_RUNNER_MODE === 'dry-run') {
      lines.push(`액션: ${action.name}`);
      lines.push('상태: DRY_RUN (실행 생략)');
      lines.push(`계획 인자: ${JSON.stringify(planned.args || {})}`);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: true,
        summary: 'dry-run 모드로 실제 실행은 생략되었습니다.',
        artifacts: [JSON.stringify(planned.args || {})],
        verification: ['runner dry-run mode'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: false,
        estimatedCostUsd: 0,
        finopsMode,
      });
      hasSuccess = true;
      continue;
    }

    if (isActionCircuitOpen(action.name)) {
      recordFailureCategory('CIRCUIT_OPEN');
      const message = `상태: 실패 (CIRCUIT_OPEN)`;
      lines.push(`액션: ${action.name}`);
      lines.push(message);
      await logActionExecutionEvent({
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        goal: input.goal,
        actionName: action.name,
        ok: false,
        summary: '회로차단기로 실행이 차단되었습니다.',
        artifacts: [],
        verification: ['circuit breaker open'],
        durationMs: 0,
        retryCount: 0,
        circuitOpen: true,
        error: 'CIRCUIT_OPEN',
        estimatedCostUsd: 0,
        finopsMode,
      });
      pushActionResult({
        ok: false,
        name: action.name,
        summary: '회로차단기로 실행이 차단되었습니다.',
        artifacts: [],
        verification: ['circuit breaker open'],
        error: 'CIRCUIT_OPEN',
      });
      continue;
    }

    const effectiveRetryMax = finopsMode === 'degraded'
      ? Math.min(ACTION_RETRY_MAX, ACTION_FINOPS_DEGRADED_RETRY_MAX)
      : ACTION_RETRY_MAX;
    const effectiveTimeoutMs = finopsMode === 'degraded'
      ? Math.min(ACTION_TIMEOUT_MS, ACTION_FINOPS_DEGRADED_TIMEOUT_MS)
      : ACTION_TIMEOUT_MS;

    const cacheEligible = ACTION_CACHE_ENABLED && isActionCacheable(action.name);
    const cacheKey = cacheEligible
      ? buildActionCacheKey({
        guildId: input.guildId,
        actionName: action.name,
        goal: executionGoal,
        args: planned.args || {},
      })
      : '';

    if (cacheEligible && cacheKey) {
      const cached = getCachedActionResult(cacheKey);
      if (cached) {
        lines.push(`액션: ${cached.name}`);
        lines.push(`${cached.summary} (cache hit)`);
        pushActionArtifactSections(lines, cached.artifacts);
        lines.push(cached.verification.length > 0
          ? `검증:\n${[...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'].map((line) => `- ${line}`).join('\n')}`
          : `검증:\n- cache_ttl_ms=${ACTION_CACHE_TTL_MS}\n- cache_hit=true`);
        lines.push('재시도 횟수: 0');
        lines.push('소요시간(ms): 0');
        lines.push('상태: 성공');

        await logActionExecutionEvent({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: input.goal,
          actionName: cached.name,
          ok: true,
          summary: `${cached.summary} (cache hit)`,
          artifacts: cached.artifacts,
          verification: [...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'],
          durationMs: 0,
          retryCount: 0,
          circuitOpen: false,
          estimatedCostUsd: 0,
          finopsMode,
          agentRole: cached.agentRole,
          handoff: cached.handoff,
        });

        pushActionResult({
          ok: true,
          name: cached.name,
          summary: `${cached.summary} (cache hit)`,
          artifacts: [...cached.artifacts],
          verification: [...cached.verification, `cache_ttl_ms=${ACTION_CACHE_TTL_MS}`, 'cache_hit=true'],
          agentRole: cached.agentRole,
          handoff: cached.handoff,
        });

        hasSuccess = true;

        continue;
      }
    }

    const executed = await executeResolvedAction({
      action,
      goal: executionGoal,
      args: planned.args || {},
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      retryMax: effectiveRetryMax,
      timeoutMs: effectiveTimeoutMs,
    });
    const final = executed.final;
    const attempt = executed.attemptCount;
    const durationMs = executed.durationMs;

    if (final.ok) {
      hasSuccess = true;
      if (final.name === 'news.google.search') {
        await captureExternalNewsMemory({
          guildId: input.guildId,
          requestedBy: input.requestedBy,
          goal: executionGoal,
          artifacts: final.artifacts,
        });
      }
      if (cacheEligible && cacheKey) {
        storeCachedActionResult({
          cacheKey,
          ttlMs: ACTION_CACHE_TTL_MS,
          result: final,
        });
      }
    } else {
      recordFailureCategory(final.error);
      if (isExternalUnavailableError(final.error)) {
        externalUnavailable = true;
      }
    }

    lines.push(`액션: ${final.name}`);
    lines.push(final.summary);
  pushActionArtifactSections(lines, final.artifacts);
    lines.push(final.verification.length > 0 ? `검증:\n${final.verification.map((line) => `- ${line}`).join('\n')}` : '검증: 없음');
    lines.push(`재시도 횟수: ${Math.max(0, attempt - 1)}`);
    lines.push(`소요시간(ms): ${durationMs}`);
    lines.push(final.ok ? '상태: 성공' : `상태: 실패 (${final.error || 'UNKNOWN'})`);

    const estimatedCostUsd = estimateActionExecutionCostUsd({
      ok: final.ok,
      retryCount: Math.max(0, attempt - 1),
      durationMs,
    });

    await logActionExecutionEvent({
      guildId: input.guildId,
      requestedBy: input.requestedBy,
      goal: input.goal,
      actionName: final.name,
      ok: final.ok,
      summary: final.summary,
      artifacts: final.artifacts,
      verification: final.verification,
      durationMs,
      retryCount: Math.max(0, attempt - 1),
      circuitOpen: false,
      error: final.error,
      estimatedCostUsd,
      finopsMode,
      agentRole: final.agentRole,
      handoff: final.handoff,
    });

    pushActionResult({
      ok: final.ok,
      name: final.name,
      summary: final.summary,
      artifacts: [...final.artifacts],
      verification: [...final.verification],
      error: final.error,
      agentRole: final.agentRole,
      handoff: final.handoff,
    });
  }

  if (!handledAny) {
    return finish({
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    });
  }

  if (diagnostics.totalFailures > 0) {
    lines.push('[실패 진단]');
    lines.push(`total=${diagnostics.totalFailures}`);
    lines.push(`missing_action=${diagnostics.missingAction}`);
    lines.push(`policy_blocked=${diagnostics.policyBlocked}`);
    lines.push(`governance_unavailable=${diagnostics.governanceUnavailable}`);
    lines.push(`finops_blocked=${diagnostics.finopsBlocked}`);
    lines.push(`external_failures=${diagnostics.externalFailures}`);
    lines.push(`unknown_failures=${diagnostics.unknownFailures}`);
  }

  return finish({
    handled: true,
    output: lines.filter(Boolean).join('\n\n'),
    hasSuccess,
    externalUnavailable,
    diagnostics,
    actionResults,
  });
};

// ─── Pipeline-aware Execution (Judgment Loop) ─────────────────────────────────

import {
  executePipeline,
  actionChainToPipelinePlan,
  createPipelineContext,
  type PipelineStep,
  type PipelineContext as PipelineCtx,
  type StepExecutor,
} from './pipelineEngine';
import { getErrorMessage } from '../../utils/errorMessage';
import { buildWorkflowCloseoutArtifacts as buildWorkflowCloseoutArtifactsInternal } from './actionRunnerWorkflowCloseout';
import {
  finalizeGoalPipelineSession,
  initializeGoalPipelineSession,
  persistGoalPipelineSteps,
  persistPlannerEmptyPipelineCloseout,
  recordGoalPipelineReplan,
  transitionGoalPipelineToExecuting,
} from './actionRunnerPipelinePersistence';

const PIPELINE_MODE_ENABLED = parseBooleanEnv(process.env.PIPELINE_MODE_ENABLED, false);

const extractCloseoutEvidenceRefs = (artifacts: string[]) => {
  return extractWorkflowArtifactRefs(artifacts);
};

export const buildWorkflowCloseoutArtifacts = (params: Parameters<typeof buildWorkflowCloseoutArtifactsInternal>[0]) => {
  return buildWorkflowCloseoutArtifactsInternal(params, extractCloseoutEvidenceRefs);
};

/**
 * Pipeline-aware goal execution — upgrade of `runGoalActions` with:
 * - Inter-action data flow (A's output feeds B's input)
 * - Conditional branching based on intermediate results
 * - Mid-execution replanning on failure
 * - Parallel execution of independent actions
 * - Full workflow persistence to Supabase
 *
 * Falls back to `runGoalActions` when PIPELINE_MODE_ENABLED=false.
 */
export const runGoalPipeline = async (input: GoalActionInput): Promise<SkillActionResult> => {
  if (!PIPELINE_MODE_ENABLED) {
    return runGoalActions(input);
  }

  const diagnostics = createEmptyDiagnostics();

  if (!ACTION_RUNNER_ENABLED) {
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    };
  }

  const { sessionId, workflowRuntimeLane } = await initializeGoalPipelineSession({
    goal: input.goal,
    guildId: input.guildId,
    requestedBy: input.requestedBy,
    runtimeLane: input.runtimeLane,
  });

  // Plan actions
  const compiledPrompt = compilePromptGoal(input.goal);
  const planningGoal = compiledPrompt.compiledGoal || input.goal;
  const executionGoal = compiledPrompt.executionGoal || compiledPrompt.normalizedGoal || input.goal;
  const effectiveProviderProfile = getGateProviderProfileOverride(input.guildId) || input.providerProfile;

  const chain = await planActions(planningGoal, {
    guildId: input.guildId,
    requestedBy: input.requestedBy,
    providerProfile: effectiveProviderProfile || undefined,
    sessionId,
  });
  if (!chain.actions || chain.actions.length === 0) {
    const closeoutArtifacts = buildWorkflowCloseoutArtifactsInternal(
      {
        goal: planningGoal,
        guildId: input.guildId,
        finalStatus: 'failed',
        sourceEvent: 'recall_request',
        plannerActionCount: 0,
      },
      extractCloseoutEvidenceRefs,
    );
    await persistPlannerEmptyPipelineCloseout({
      sessionId,
      workflowRuntimeLane,
      requestedBy: input.requestedBy,
      closeoutArtifacts,
    });
    return {
      handled: false,
      output: '',
      hasSuccess: false,
      externalUnavailable: false,
      diagnostics,
    };
  }

  await transitionGoalPipelineToExecuting({
    sessionId,
    plannedActionCount: chain.actions.length,
  });

  // Convert planner output to pipeline plan
  const plan = actionChainToPipelinePlan(chain.actions);
  const ctx = createPipelineContext({
    goal: executionGoal,
    guildId: input.guildId,
    requestedBy: input.requestedBy,
  });

  // Step executor: bridges pipeline engine to existing action execution logic
  const stepExecutor: StepExecutor = async (actionName, args, pipeCtx) => {
    const action = getAction(actionName) ?? getDynamicAction(actionName);
    if (!action) {
      return {
        ok: false,
        name: actionName,
        summary: 'ACTION_NOT_IMPLEMENTED',
        artifacts: [],
        verification: [],
        error: 'ACTION_NOT_IMPLEMENTED',
      };
    }

    if (!isActionAllowed(actionName)) {
      return {
        ok: false,
        name: actionName,
        summary: 'ACTION_NOT_ALLOWED',
        artifacts: [],
        verification: [],
        error: 'ACTION_NOT_ALLOWED',
      };
    }

    if (isActionCircuitOpen(actionName)) {
      return {
        ok: false,
        name: actionName,
        summary: 'CIRCUIT_OPEN',
        artifacts: [],
        verification: [],
        error: 'CIRCUIT_OPEN',
      };
    }

    return (await executeResolvedAction({
      action,
      goal: pipeCtx.goal,
      args,
      guildId: pipeCtx.guildId,
      requestedBy: pipeCtx.requestedBy,
      retryMax: 0,
      timeoutMs: ACTION_TIMEOUT_MS,
      failureSummary: 'Action execution failed',
      errorSource: 'skills.actionRunner.pipelineStep',
    })).final;
  };

  // Replanner: re-invokes the LLM planner with context about what failed
  const replanner = async (replanGoal: string, _pipeCtx: PipelineCtx): Promise<PipelineStep[]> => {
    try {
      const replanChain = await planActions(replanGoal, {
        guildId: input.guildId,
        requestedBy: input.requestedBy,
        providerProfile: effectiveProviderProfile || undefined,
        sessionId,
      });
      if (!replanChain.actions || replanChain.actions.length === 0) return [];

      await recordGoalPipelineReplan({
        sessionId,
        replanGoal,
        newActionCount: replanChain.actions.length,
      });

      return replanChain.actions.map((a, i) => ({
        name: `replan-step-${i + 1}-${a.actionName}`,
        type: 'action' as const,
        actionName: a.actionName,
        args: a.args,
        reason: a.reason,
        pipeOutput: true,
      }));
    } catch (err) {
      logger.debug('[ACTION-RUNNER] pipeline-build replan failed: %s', getErrorMessage(err));
      return [];
    }
  };

  // Execute pipeline
  const pipelineResult = await executePipeline(plan, stepExecutor, replanner, ctx);

  await persistGoalPipelineSteps({
    sessionId,
    workflowRuntimeLane,
    guildId: input.guildId,
    requestedBy: input.requestedBy,
    goal: input.goal,
    steps: pipelineResult.steps,
    extractArtifactRefs: extractWorkflowArtifactRefs,
  });

  const failedSteps = pipelineResult.steps.filter((s) => !s.ok);
  const closeoutArtifacts = buildWorkflowCloseoutArtifactsInternal(
    {
      goal: executionGoal,
      guildId: input.guildId,
      finalStatus: pipelineResult.ok ? 'released' : 'failed',
      sourceEvent: 'session_complete',
      stepCount: pipelineResult.steps.length,
      failedSteps,
      replanned: pipelineResult.replanned,
      replanCount: pipelineResult.replanCount,
    },
    extractCloseoutEvidenceRefs,
  );

  await finalizeGoalPipelineSession({
    sessionId,
    workflowRuntimeLane,
    requestedBy: input.requestedBy,
    goal: executionGoal,
    pipelineResult,
    failedSteps,
    closeoutArtifacts,
  });

  // Build output
  const lines: string[] = ['파이프라인 실행 결과'];
  lines.push(`세션: ${sessionId}`);
  lines.push(`총 단계: ${pipelineResult.steps.length}`);
  lines.push(`소요시간: ${pipelineResult.totalDurationMs}ms`);
  if (pipelineResult.replanned) {
    lines.push(`재계획: ${pipelineResult.replanCount}회`);
  }

  for (const step of pipelineResult.steps) {
    lines.push(`\n[${step.stepName}] ${step.ok ? '성공' : '실패'} (${step.durationMs}ms)`);
    if (step.artifacts.length > 0) {
      lines.push(`산출물:\n${step.artifacts.map((a) => `- ${a}`).join('\n')}`);
    }
    if (step.error) {
      lines.push(`오류: ${step.error}`);
    }
  }

  const hasSuccess = pipelineResult.steps.some((s) => s.ok);
  for (const f of failedSteps) {
    diagnostics.totalFailures += 1;
    const key = classifyFailureCode(f.error);
    diagnostics[key] += 1;
  }

  const result: SkillActionResult = {
    handled: true,
    output: lines.filter(Boolean).join('\n'),
    hasSuccess,
    externalUnavailable: failedSteps.some((s) => isExternalUnavailableError(s.error)),
    diagnostics,
  };

  updateActionRunnerDiagnostics(result);
  return result;
};
