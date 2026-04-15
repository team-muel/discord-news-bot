import { parseBooleanEnv } from '../../utils/env';
import type { McpCallResponse } from '../skills/actions/mcpDelegate';
import { callMcpWorkerTool, getMcpWorkerUrl, isMcpStrictRouting, parseMcpTextBlocks } from '../skills/actions/mcpDelegate';
import { runObsidianLoreSyncOnce } from './obsidianLoreSyncService';
import {
  getLatestObsidianGraphAuditSnapshot,
  runObsidianGraphAuditOnce,
  type ObsidianGraphAuditLoopStats,
  type ObsidianGraphAuditSnapshot,
} from './obsidianQualityService';

export type ObsidianMaintenanceExecutor = 'repo-runtime';
export type ObsidianMaintenancePreferredExecutor = 'repo-runtime' | 'operate-worker';
export type ObsidianMaintenanceTask = 'lore-sync' | 'graph-audit';

export type ObsidianMaintenanceDelegationSurface = {
  preferredExecutor: ObsidianMaintenancePreferredExecutor;
  fallbackExecutor: ObsidianMaintenanceExecutor;
  workerKind: 'operate';
  workerConfigured: boolean;
  strict: boolean;
};

export type ObsidianMaintenanceControlSurface = {
  executor: ObsidianMaintenanceExecutor;
  tasks: ObsidianMaintenanceTask[];
  delegation: ObsidianMaintenanceDelegationSurface;
};

export type ObsidianMaintenanceExecutionOptions = {
  forceLocal?: boolean;
};

const CONTROL_SURFACE: ObsidianMaintenanceControlSurface = {
  executor: 'repo-runtime',
  tasks: ['lore-sync', 'graph-audit'],
  delegation: {
    preferredExecutor: 'repo-runtime',
    fallbackExecutor: 'repo-runtime',
    workerKind: 'operate',
    workerConfigured: false,
    strict: false,
  },
};

const normalizePreferredExecutor = (value: string | undefined): ObsidianMaintenancePreferredExecutor => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'operate-worker' || normalized === 'openjarvis-worker') {
    return 'operate-worker';
  }
  return 'repo-runtime';
};

const OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR = normalizePreferredExecutor(
  process.env.OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR,
);
const OBSIDIAN_MAINTENANCE_STRICT_DELEGATION = parseBooleanEnv(
  process.env.OBSIDIAN_MAINTENANCE_STRICT_DELEGATION,
  false,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getDelegationSurface = (): ObsidianMaintenanceDelegationSurface => ({
  preferredExecutor: OBSIDIAN_MAINTENANCE_PREFERRED_EXECUTOR,
  fallbackExecutor: 'repo-runtime',
  workerKind: 'operate',
  workerConfigured: Boolean(getMcpWorkerUrl('operate')),
  strict: OBSIDIAN_MAINTENANCE_STRICT_DELEGATION || isMcpStrictRouting(),
});

export const getObsidianMaintenanceControlSurface = (): ObsidianMaintenanceControlSurface => ({
  executor: CONTROL_SURFACE.executor,
  tasks: [...CONTROL_SURFACE.tasks],
  delegation: getDelegationSurface(),
});

const parseDelegatedJson = <T extends Record<string, unknown>>(
  payload: McpCallResponse,
  requiredKeys: string[],
): T | null => {
  const text = parseMcpTextBlocks(payload).join('\n').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    for (const key of requiredKeys) {
      if (!(key in parsed)) {
        return null;
      }
    }

    return parsed as T;
  } catch {
    return null;
  }
};

const runObsidianLoreSyncLocal = async () => runObsidianLoreSyncOnce();

const runObsidianGraphAuditLocal = async (): Promise<{
  result: ObsidianGraphAuditLoopStats;
  snapshot: ObsidianGraphAuditSnapshot | null;
}> => {
  const result = await runObsidianGraphAuditOnce();
  const snapshot = await getLatestObsidianGraphAuditSnapshot();
  return { result, snapshot };
};

const executeWithOptionalOperateWorker = async <T extends Record<string, unknown>>(params: {
  forceLocal?: boolean;
  toolName: string;
  parsePayload: (payload: McpCallResponse) => T | null;
  runLocal: () => Promise<T>;
}): Promise<T> => {
  const delegation = getDelegationSurface();
  if (params.forceLocal || delegation.preferredExecutor === 'repo-runtime') {
    return params.runLocal();
  }

  const workerUrl = getMcpWorkerUrl(delegation.workerKind);
  if (!workerUrl) {
    if (delegation.strict) {
      throw new Error('MCP_WORKER_NOT_CONFIGURED');
    }
    return params.runLocal();
  }

  try {
    const payload = await callMcpWorkerTool({
      workerUrl,
      toolName: params.toolName,
      args: {},
    });
    const delegatedResult = params.parsePayload(payload);
    if (delegatedResult) {
      return delegatedResult;
    }
    if (delegation.strict || payload.isError) {
      throw new Error('OBSIDIAN_MAINTENANCE_DELEGATED_RESULT_INVALID');
    }
  } catch (error) {
    if (delegation.strict) {
      throw error;
    }
  }

  return params.runLocal();
};

export const executeObsidianLoreSync = async (
  options: ObsidianMaintenanceExecutionOptions = {},
) => executeWithOptionalOperateWorker({
  forceLocal: options.forceLocal,
  toolName: 'obsidian.sync.run',
  parsePayload: (payload) => parseDelegatedJson(payload, ['lastStatus']),
  runLocal: runObsidianLoreSyncLocal,
});

export const executeObsidianGraphAudit = async (
  options: ObsidianMaintenanceExecutionOptions = {},
): Promise<{
  result: ObsidianGraphAuditLoopStats;
  snapshot: ObsidianGraphAuditSnapshot | null;
}> => executeWithOptionalOperateWorker({
  forceLocal: options.forceLocal,
  toolName: 'obsidian.quality.audit.run',
  parsePayload: (payload) => parseDelegatedJson(payload, ['result']),
  runLocal: runObsidianGraphAuditLocal,
});