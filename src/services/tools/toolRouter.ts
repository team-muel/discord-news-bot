import { executeRegisteredCliTool } from './toolExecutor';
import { getCliToolRegistryStatus } from './toolRegistry';
import type { CliToolRegistryStatus, ExecuteCliToolInput, ExecuteCliToolResult } from './types';

export const getToolRuntimeStatus = (): CliToolRegistryStatus => {
  return getCliToolRegistryStatus();
};

export const executeToolByName = async (input: ExecuteCliToolInput): Promise<ExecuteCliToolResult> => {
  return executeRegisteredCliTool(input);
};