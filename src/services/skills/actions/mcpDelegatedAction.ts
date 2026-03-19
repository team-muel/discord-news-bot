import type { ActionExecutionResult } from './types';
import { callMcpWorkerTool, getMcpWorkerUrl, isMcpStrictRouting, parseMcpTextBlocks } from './mcpDelegate';
import { appendOutcomeSignalVerification, type OutcomeSignal } from '../../observability/outcomeSignal';

type WorkerKind = 'youtube' | 'news' | 'community' | 'web' | 'opencode';

const toAgentRole = (workerKind: WorkerKind): NonNullable<ActionExecutionResult['agentRole']> => {
  if (workerKind === 'opencode') {
    return 'opencode';
  }
  return 'nemoclaw';
};

type RunDelegatedActionOptions = {
  actionName: string;
  workerKind: WorkerKind;
  toolName: string;
  args: Record<string, unknown>;
  successSummary: (blocks: string[]) => string;
  strictFailureSummary: string;
  strictFailureVerification?: string[];
  strictFailureError?: string;
  respectStrictRouting?: boolean;
  onWorkerMissing?: () => ActionExecutionResult | null;
  onEmptyResult?: (blocks: string[]) => ActionExecutionResult | null;
  onWorkerError?: (error: unknown) => ActionExecutionResult | null;
};

const withOutcomeSignal = (
  result: ActionExecutionResult,
  outcome: OutcomeSignal,
  workerKind: WorkerKind,
  toolName: string,
): ActionExecutionResult => {
  const role = result.agentRole || toAgentRole(workerKind);
  return {
    ...result,
    agentRole: role,
    handoff: result.handoff || {
      fromAgent: 'openjarvis',
      toAgent: role,
      reason: 'mcp delegated action execution',
      evidenceId: toolName,
    },
    verification: appendOutcomeSignalVerification(result.verification, {
      scope: 'action',
      component: 'action',
      outcome,
      path: 'mcp-delegated',
      extra: {
        worker_kind: workerKind,
        tool: toolName,
      },
    }),
  };
};

export const runDelegatedAction = async (options: RunDelegatedActionOptions): Promise<ActionExecutionResult | null> => {
  const workerUrl = getMcpWorkerUrl(options.workerKind);
  if (!workerUrl) {
    const missing = options.onWorkerMissing?.() || null;
    if (!missing) {
      return null;
    }
    return withOutcomeSignal(missing, missing.ok ? 'degraded' : 'failure', options.workerKind, options.toolName);
  }

  try {
    const payload = await callMcpWorkerTool({
      workerUrl,
      toolName: options.toolName,
      args: options.args,
    });

    const blocks = parseMcpTextBlocks(payload);
    if (!payload.isError && blocks.length > 0) {
      return withOutcomeSignal({
        ok: true,
        name: options.actionName,
        summary: options.successSummary(blocks),
        artifacts: blocks,
        verification: ['mcp delegated tool success'],
      }, 'success', options.workerKind, options.toolName);
    }

    const empty = options.onEmptyResult?.(blocks) || null;
    if (!empty) {
      return null;
    }
    return withOutcomeSignal(empty, empty.ok ? 'degraded' : 'failure', options.workerKind, options.toolName);
  } catch (error) {
    if ((options.respectStrictRouting ?? true) && isMcpStrictRouting()) {
      return withOutcomeSignal({
        ok: false,
        name: options.actionName,
        summary: options.strictFailureSummary,
        artifacts: [],
        verification: options.strictFailureVerification || ['strict routing enabled'],
        error: options.strictFailureError || (error instanceof Error ? error.message : String(error)),
      }, 'failure', options.workerKind, options.toolName);
    }

    const workerError = options.onWorkerError?.(error) || null;
    if (!workerError) {
      return null;
    }
    return withOutcomeSignal(workerError, workerError.ok ? 'degraded' : 'failure', options.workerKind, options.toolName);
  }
};
