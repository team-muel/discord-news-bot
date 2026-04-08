import { executeRegisteredCliTool } from './toolExecutor';
import { probeAllExternalTools, getExternalToolById, type ExternalToolId, type ExternalToolProbeResult, type ExternalToolStatus } from './externalToolProbe';
import { executeExternalAction, getExternalAdapterStatus, getExternalAdapter, getToolCatalog } from './externalAdapterRegistry';
import type { ExternalAdapterId, ExternalAdapterResult, ExternalToolAdapter } from './externalAdapterTypes';
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

export const getExternalAdapterById = (id: ExternalAdapterId): ExternalToolAdapter | undefined => {
  return getExternalAdapter(id);
};

export { getToolCatalog };

export type { ExternalToolId, ExternalToolProbeResult, ExternalToolStatus, ExternalAdapterId, ExternalAdapterResult, ExternalToolAdapter };