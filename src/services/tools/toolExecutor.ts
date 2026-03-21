import { scriptCliToolAdapter } from './adapters/scriptCliToolAdapter';
import { getCliToolRegistryStatus, getRegisteredCliTool } from './toolRegistry';
import type { CliToolAdapter, ExecuteCliToolInput, ExecuteCliToolResult } from './types';

const ADAPTERS: Record<string, CliToolAdapter> = {
  'script-cli': scriptCliToolAdapter,
};

const resolveAdapter = (adapterId: string): CliToolAdapter | null => ADAPTERS[adapterId] || null;

export const executeRegisteredCliTool = async (input: ExecuteCliToolInput): Promise<ExecuteCliToolResult> => {
  const tool = getRegisteredCliTool(input.toolName);
  if (!tool) {
    const status = getCliToolRegistryStatus();
    return {
      ok: false,
      toolName: input.toolName || status.tools[0]?.name || 'local.cli',
      summary: input.toolName
        ? `Configured CLI tool not found: ${input.toolName}`
        : 'No configured CLI tool is available.',
      artifacts: status.issues,
      verification: ['registry lookup failed'],
      error: input.toolName ? 'LOCAL_CLI_TOOL_NOT_FOUND' : 'LOCAL_CLI_TOOL_NOT_CONFIGURED',
      durationMs: 0,
      adapterId: 'script-cli',
      exitCode: null,
    };
  }

  const adapter = resolveAdapter(tool.adapterId);
  if (!adapter || !adapter.isAvailable(tool)) {
    return {
      ok: false,
      toolName: tool.name,
      summary: `CLI adapter unavailable for tool ${tool.name}`,
      artifacts: [`adapter:${tool.adapterId}`],
      verification: ['adapter availability check failed'],
      error: 'LOCAL_CLI_TOOL_ADAPTER_UNAVAILABLE',
      durationMs: 0,
      adapterId: tool.adapterId,
      exitCode: null,
    };
  }

  return adapter.execute(tool, input);
};