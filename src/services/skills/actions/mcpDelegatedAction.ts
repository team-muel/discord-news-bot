import type { ActionExecutionResult } from './types';
import { callMcpWorkerTool, getMcpWorkerUrl, isMcpStrictRouting, parseMcpTextBlocks, type McpWorkerKind } from './mcpDelegate';
import { appendOutcomeSignalVerification, type OutcomeSignal } from '../../observability/outcomeSignal';

const toAgentRole = (workerKind: McpWorkerKind): NonNullable<ActionExecutionResult['agentRole']> => {
  switch (workerKind) {
    case 'opencode':
      return 'opencode';
    case 'opendev':
      return 'opendev';
    case 'nemoclaw':
      return 'nemoclaw';
    case 'openjarvis':
    case 'local-orchestrator':
      return 'openjarvis';
    default:
      return 'nemoclaw';
  }
};

type RunDelegatedActionOptions = {
  actionName: string;
  workerKind: McpWorkerKind;
  toolName: string;
  args: Record<string, unknown>;
  successSummary: (blocks: string[]) => string;
  strictFailureSummary: string;
  strictFailureVerification?: string[];
  strictFailureError?: string;
  respectStrictRouting?: boolean;
  parseStructuredResult?: (blocks: string[]) => ActionExecutionResult | null;
  onWorkerMissing?: () => ActionExecutionResult | null;
  onEmptyResult?: (blocks: string[]) => ActionExecutionResult | null;
  onWorkerError?: (error: unknown) => ActionExecutionResult | null;
};

const withOutcomeSignal = (
  result: ActionExecutionResult,
  outcome: OutcomeSignal,
  workerKind: McpWorkerKind,
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
    const structured = options.parseStructuredResult?.(blocks) || null;
    if (structured) {
      return withOutcomeSignal(structured, structured.ok ? 'success' : 'failure', options.workerKind, options.toolName);
    }

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
