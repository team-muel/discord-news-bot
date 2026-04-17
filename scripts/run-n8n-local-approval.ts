import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  N8N_STARTER_INSTALL_ACTION_NAME,
  previewN8nStarterWorkflows,
  rollbackN8nStarterWorkflowOperation,
  seedN8nStarterWorkflows,
} from './bootstrap-n8n-local.mjs';
import {
  createActionApprovalRequest,
  decideActionApprovalRequest,
  getActionApprovalRequest,
  type ActionApprovalRequest,
} from '../src/services/skills/actionGovernanceStore.ts';

type ApprovalCliAction = 'request' | 'apply-approved' | 'approve-and-apply' | 'rollback';

type StarterPreviewResult = {
  baseUrl: string;
  requestedTasks: string[];
  updateExisting: boolean;
  dryRun: true;
  canApply: boolean;
  blockedReasons: string[];
  doctor: {
    summary: string;
  };
  plannedMethod: string;
  existingDiscoverySource: string;
  operationId: string;
  operationLogPathRelative: string;
  results: Array<{
    task: string;
    transport: string;
    workflowId: string;
    status: string;
  }>;
};

type StarterApplyResult = {
  baseUrl: string;
  requestedTasks: string[];
  updateExisting: boolean;
  seedMethod: string;
  operationId: string;
  operationLogPathRelative: string;
  approvalRequestId: string | null;
  rollbackPolicy?: {
    summary: string;
  };
  results: Array<{
    task: string;
    workflowId: string;
    status: string;
  }>;
};

type StarterRollbackResult = {
  operationId: string;
  operationLogPathRelative: string;
  summary: string;
  results: Array<{
    task: string;
    workflowId: string;
    status: string;
  }>;
};

type StarterInstallActionArgs = {
  tasks?: string[];
  updateExisting?: boolean;
  outputDir?: string;
  baseUrl?: string;
  operationId?: string;
};

const fileName = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(fileName), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'tmp', 'n8n-local');
const DEFAULT_BASE_URL = 'http://127.0.0.1:5678';

const previewStarterWorkflows = previewN8nStarterWorkflows as (params: {
  outputDir?: string;
  baseUrl?: string;
  tasks?: string[];
  updateExisting?: boolean;
  operationId?: string;
}) => Promise<StarterPreviewResult>;

const applyStarterWorkflows = seedN8nStarterWorkflows as (params: {
  outputDir?: string;
  baseUrl?: string;
  tasks?: string[];
  updateExisting?: boolean;
  dryRun?: boolean;
  operationId?: string;
  approvalRequestId?: string | null;
  requestedBy?: string | null;
}) => Promise<StarterApplyResult>;

const rollbackStarterWorkflowOperation = rollbackN8nStarterWorkflowOperation as (params: {
  outputDir?: string;
  baseUrl?: string;
  operationId?: string;
  operationLogPath?: string;
}) => Promise<StarterRollbackResult>;

const parseArg = (name: string, fallback = ''): string => {
  const prefix = `--${name}=`;
  const matched = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : fallback;
};

const parseBool = (value: string, fallback = false): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parseTasks = (value: string): string[] => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const asString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const asBoolean = (value: unknown, fallback = false): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
};

const resolveOutputDir = (value: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return DEFAULT_OUTPUT_DIR;
  }
  return path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(ROOT, normalized);
};

const toRepoRelativePath = (value: string): string => {
  return (path.relative(ROOT, value) || value).replace(/\\/g, '/');
};

const buildDefaultGoal = (tasks: string[], updateExisting: boolean): string => {
  const taskSummary = tasks.length > 0 ? tasks.join(', ') : 'all starter workflows';
  return updateExisting
    ? `Update local n8n starter workflows: ${taskSummary}`
    : `Install local n8n starter workflows: ${taskSummary}`;
};

const requireValue = (value: string, flagName: string): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${flagName} is required`);
  }
  return normalized;
};

const ensureInstallRequest = (request: ActionApprovalRequest | null): ActionApprovalRequest => {
  if (!request) {
    throw new Error('Approval request was not found');
  }
  if (request.actionName !== N8N_STARTER_INSTALL_ACTION_NAME) {
    throw new Error(`Approval request ${request.id} is not for ${N8N_STARTER_INSTALL_ACTION_NAME}`);
  }
  return request;
};

const resolveInstallArgsFromRequest = (request: ActionApprovalRequest, overrides: {
  outputDir?: string;
  baseUrl?: string;
  operationId?: string;
}) => {
  const actionArgs = request.actionArgs as StarterInstallActionArgs;
  const tasks = asStringArray(actionArgs.tasks);
  const updateExisting = asBoolean(actionArgs.updateExisting, false);
  const outputDir = resolveOutputDir(overrides.outputDir || asString(actionArgs.outputDir, ''));
  const baseUrl = String(overrides.baseUrl || asString(actionArgs.baseUrl, DEFAULT_BASE_URL)).trim() || DEFAULT_BASE_URL;
  const operationId = String(overrides.operationId || asString(actionArgs.operationId, '')).trim();

  return {
    tasks,
    updateExisting,
    outputDir,
    baseUrl,
    operationId,
  };
};

const printRequestResult = (request: ActionApprovalRequest, preview: StarterPreviewResult) => {
  console.log(`[n8n-local-approval] requestId=${request.id}`);
  console.log(`[n8n-local-approval] status=${request.status}`);
  console.log(`[n8n-local-approval] goal=${request.goal}`);
  console.log(`[n8n-local-approval] operationId=${preview.operationId}`);
  console.log(`[n8n-local-approval] operationLog=${preview.operationLogPathRelative}`);
  console.log(`[n8n-local-approval] plannedMethod=${preview.plannedMethod}`);
  console.log(`[n8n-local-approval] canApply=${preview.canApply}`);
  console.log(`[n8n-local-approval] doctorSummary=${preview.doctor.summary}`);
  for (const blockedReason of preview.blockedReasons) {
    console.log(`[n8n-local-approval] blockedReason=${blockedReason}`);
  }
  for (const item of preview.results) {
    console.log(`[n8n-local-approval] plan ${item.status} task=${item.task} transport=${item.transport} workflowId=${item.workflowId || 'n/a'}`);
  }
};

const printApplyResult = (result: StarterApplyResult) => {
  console.log(`[n8n-local-approval] operationId=${result.operationId}`);
  console.log(`[n8n-local-approval] operationLog=${result.operationLogPathRelative}`);
  console.log(`[n8n-local-approval] seedMethod=${result.seedMethod}`);
  if (result.approvalRequestId) {
    console.log(`[n8n-local-approval] approvalRequestId=${result.approvalRequestId}`);
  }
  if (result.rollbackPolicy?.summary) {
    console.log(`[n8n-local-approval] rollbackPolicy=${result.rollbackPolicy.summary}`);
  }
  for (const item of result.results) {
    console.log(`[n8n-local-approval] apply ${item.status} task=${item.task} workflowId=${item.workflowId || 'n/a'}`);
  }
};

const printRollbackResult = (result: StarterRollbackResult) => {
  console.log(`[n8n-local-approval] operationId=${result.operationId}`);
  console.log(`[n8n-local-approval] operationLog=${result.operationLogPathRelative}`);
  console.log(`[n8n-local-approval] summary=${result.summary}`);
  for (const item of result.results) {
    console.log(`[n8n-local-approval] rollback ${item.status} task=${item.task} workflowId=${item.workflowId || 'n/a'}`);
  }
};

const main = async () => {
  const action = String(parseArg('action', 'request')).trim() as ApprovalCliAction;
  const guildId = String(parseArg('guildId', process.env.DISCORD_GUILD_ID || 'local-n8n')).trim() || 'local-n8n';
  const requestedBy = String(parseArg('requestedBy', process.env.USER || process.env.USERNAME || 'local-operator')).trim() || 'local-operator';
  const actorId = String(parseArg('actorId', requestedBy)).trim() || requestedBy;
  const reason = String(parseArg('reason', '')).trim();
  const requestId = String(parseArg('requestId', '')).trim();
  const outputDir = resolveOutputDir(parseArg('dir', ''));
  const baseUrl = String(parseArg('baseUrl', process.env.N8N_BASE_URL || DEFAULT_BASE_URL)).trim() || DEFAULT_BASE_URL;
  const tasks = parseTasks(parseArg('tasks', ''));
  const updateExisting = parseBool(parseArg('updateExisting', 'false'), false);
  const operationId = String(parseArg('operationId', '')).trim();
  const operationLog = String(parseArg('operationLog', '')).trim();
  const goal = String(parseArg('goal', buildDefaultGoal(tasks, updateExisting))).trim() || buildDefaultGoal(tasks, updateExisting);

  if (!['request', 'apply-approved', 'approve-and-apply', 'rollback'].includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }

  if (action === 'request') {
    const preview = await previewStarterWorkflows({
      outputDir,
      baseUrl,
      tasks,
      updateExisting,
      operationId,
    });

    if (!preview.canApply) {
      throw new Error(`Approval request is blocked until doctor issues are cleared: ${preview.blockedReasons.join(' | ')}`);
    }

    const request = await createActionApprovalRequest({
      guildId,
      requestedBy,
      goal,
      actionName: N8N_STARTER_INSTALL_ACTION_NAME,
      actionArgs: {
        tasks: preview.requestedTasks,
        updateExisting,
        baseUrl,
        outputDir: toRepoRelativePath(outputDir),
        operationId: preview.operationId,
      },
      reason,
    });

    printRequestResult(request, preview);
    return;
  }

  if (action === 'rollback') {
    const rollbackResult = await rollbackStarterWorkflowOperation({
      outputDir,
      baseUrl,
      operationId: operationId || requestId,
      operationLogPath: operationLog,
    });
    printRollbackResult(rollbackResult);
    return;
  }

  const resolvedRequestId = requireValue(requestId, '--requestId');
  let approvalRequest = ensureInstallRequest(await getActionApprovalRequest(resolvedRequestId));

  if (action === 'approve-and-apply') {
    if (approvalRequest.status === 'pending') {
      approvalRequest = ensureInstallRequest(await decideActionApprovalRequest({
        requestId: approvalRequest.id,
        decision: 'approve',
        actorId,
        reason: reason || 'approved for local n8n starter workflow install',
      }));
    }
  }

  if (approvalRequest.status !== 'approved') {
    throw new Error(`Approval request ${approvalRequest.id} is ${approvalRequest.status}; apply is only allowed after approval.`);
  }

  const installArgs = resolveInstallArgsFromRequest(approvalRequest, {
    outputDir: parseArg('dir', ''),
    baseUrl: parseArg('baseUrl', ''),
    operationId,
  });
  const applied = await applyStarterWorkflows({
    outputDir: installArgs.outputDir,
    baseUrl: installArgs.baseUrl,
    tasks: installArgs.tasks,
    updateExisting: installArgs.updateExisting,
    dryRun: false,
    operationId: installArgs.operationId,
    approvalRequestId: approvalRequest.id,
    requestedBy: approvalRequest.requestedBy,
  });

  printApplyResult(applied);
};

main().catch((error) => {
  console.error(`[n8n-local-approval] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});