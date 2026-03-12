import type { ActionExecutionResult } from './types';
import { callMcpWorkerTool, getMcpWorkerUrl, isMcpStrictRouting, parseMcpTextBlocks } from './mcpDelegate';

type WorkerKind = 'youtube' | 'news' | 'community' | 'web';

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

export const runDelegatedAction = async (options: RunDelegatedActionOptions): Promise<ActionExecutionResult | null> => {
  const workerUrl = getMcpWorkerUrl(options.workerKind);
  if (!workerUrl) {
    return options.onWorkerMissing?.() || null;
  }

  try {
    const payload = await callMcpWorkerTool({
      workerUrl,
      toolName: options.toolName,
      args: options.args,
    });

    const blocks = parseMcpTextBlocks(payload);
    if (!payload.isError && blocks.length > 0) {
      return {
        ok: true,
        name: options.actionName,
        summary: options.successSummary(blocks),
        artifacts: blocks,
        verification: ['mcp delegated tool success'],
      };
    }

    return options.onEmptyResult?.(blocks) || null;
  } catch (error) {
    if ((options.respectStrictRouting ?? true) && isMcpStrictRouting()) {
      return {
        ok: false,
        name: options.actionName,
        summary: options.strictFailureSummary,
        artifacts: [],
        verification: options.strictFailureVerification || ['strict routing enabled'],
        error: options.strictFailureError || (error instanceof Error ? error.message : String(error)),
      };
    }

    return options.onWorkerError?.(error) || null;
  }
};
