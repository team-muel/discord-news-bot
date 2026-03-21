import { executeRegisteredCliTool } from './toolExecutor';
import { probeAllExternalTools, getExternalToolById } from './externalToolProbe';
import type { ExternalToolId, ExternalToolProbeResult, ExternalToolStatus } from './externalToolProbe';
import { executeExternalAction, getExternalAdapterStatus } from './externalAdapterRegistry';
import type { ExternalAdapterId, ExternalAdapterResult } from './externalAdapterTypes';
import { getCliToolRegistryStatus } from './toolRegistry';
import type { CliToolRegistryStatus, ExecuteCliToolInput, ExecuteCliToolResult } from './types';

export const getToolRuntimeStatus = (): CliToolRegistryStatus => {
  return getCliToolRegistryStatus();
};

export const executeToolByName = async (input: ExecuteCliToolInput): Promise<ExecuteCliToolResult> => {
  return executeRegisteredCliTool(input);
};

export const getExternalToolsStatus = async (): Promise<ExternalToolProbeResult> => {
  return probeAllExternalTools();
};

export const getExternalToolStatus = async (id: ExternalToolId): Promise<ExternalToolStatus> => {
  return getExternalToolById(id);
};

export const runExternalAction = async (
  adapterId: ExternalAdapterId,
  action: string,
  args?: Record<string, unknown>,
): Promise<ExternalAdapterResult> => {
  return executeExternalAction(adapterId, action, args);
};

export const getExternalAdaptersStatus = async () => {
  return getExternalAdapterStatus();
};

export type { ExternalToolId, ExternalToolProbeResult, ExternalToolStatus, ExternalAdapterId, ExternalAdapterResult };