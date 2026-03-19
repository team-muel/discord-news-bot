import type { ActionExecutionInput, ActionExecutionResult } from './skills/actions/types';

export type WorkerErrorCode =
  | 'ACTION_TIMEOUT'
  | 'ACTION_INPUT_INVALID'
  | 'ACTION_RESULT_INVALID'
  | 'MCP_WORKER_NOT_CONFIGURED'
  | 'MCP_TIMEOUT'
  | 'MCP_HTTP_ERROR'
  | 'MCP_PARSE_ERROR'
  | 'UNKNOWN_ERROR';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const isAgentRole = (value: unknown): value is NonNullable<ActionExecutionResult['agentRole']> => {
  const role = String(value || '').trim().toLowerCase();
  return role === 'openjarvis' || role === 'opencode' || role === 'nemoclaw' || role === 'opendev';
};

const inferAgentRoleByActionName = (actionName: string): NonNullable<ActionExecutionResult['agentRole']> => {
  const normalized = String(actionName || '').trim().toLowerCase();
  if (normalized.startsWith('opencode.')) {
    return 'opencode';
  }
  if (normalized.startsWith('news.')
    || normalized.startsWith('web.')
    || normalized.startsWith('youtube.')
    || normalized.startsWith('community.')) {
    return 'nemoclaw';
  }
  if (normalized.startsWith('db.')
    || normalized.startsWith('code.')
    || normalized.startsWith('rag.')) {
    return 'opendev';
  }
  return 'openjarvis';
};

const normalizeHandoff = (value: unknown): ActionExecutionResult['handoff'] => {
  if (!isRecord(value)) {
    return undefined;
  }

  const fromAgent = isAgentRole(value.fromAgent) ? value.fromAgent : null;
  const toAgent = isAgentRole(value.toAgent) ? value.toAgent : null;
  if (!fromAgent || !toAgent) {
    return undefined;
  }

  const reason = String(value.reason || '').trim() || undefined;
  const evidenceId = String(value.evidenceId || '').trim() || undefined;
  return {
    fromAgent,
    toAgent,
    reason,
    evidenceId,
  };
};

export class WorkerExecutionError extends Error {
  readonly code: WorkerErrorCode;
  readonly retryable: boolean;
  readonly meta?: Record<string, unknown>;

  constructor(params: {
    code: WorkerErrorCode;
    message?: string;
    retryable?: boolean;
    meta?: Record<string, unknown>;
  }) {
    super(params.message || params.code);
    this.name = 'WorkerExecutionError';
    this.code = params.code;
    this.retryable = Boolean(params.retryable);
    this.meta = params.meta;
  }
}

export const toWorkerExecutionError = (value: unknown, fallbackCode: WorkerErrorCode = 'UNKNOWN_ERROR'): WorkerExecutionError => {
  if (value instanceof WorkerExecutionError) {
    return value;
  }

  if (value instanceof Error) {
    const message = String(value.message || '').trim();
    if (message === 'ACTION_TIMEOUT') {
      return new WorkerExecutionError({ code: 'ACTION_TIMEOUT', message, retryable: true });
    }
    if (message === 'MCP_TIMEOUT') {
      return new WorkerExecutionError({ code: 'MCP_TIMEOUT', message, retryable: true });
    }
    if (message.startsWith('MCP_HTTP_')) {
      return new WorkerExecutionError({ code: 'MCP_HTTP_ERROR', message, retryable: true });
    }
    if (message === 'MCP_WORKER_NOT_CONFIGURED') {
      return new WorkerExecutionError({ code: 'MCP_WORKER_NOT_CONFIGURED', message, retryable: false });
    }
    return new WorkerExecutionError({ code: fallbackCode, message });
  }

  return new WorkerExecutionError({
    code: fallbackCode,
    message: String(value),
  });
};

export const normalizeActionInput = (params: {
  actionName: string;
  input: ActionExecutionInput;
}): ActionExecutionInput => {
  const goal = String(params.input.goal || '').trim();
  if (!goal) {
    throw new WorkerExecutionError({
      code: 'ACTION_INPUT_INVALID',
      message: 'goal is required',
      retryable: false,
      meta: { actionName: params.actionName },
    });
  }

  const args = params.input.args;
  if (args !== undefined && !isRecord(args)) {
    throw new WorkerExecutionError({
      code: 'ACTION_INPUT_INVALID',
      message: 'args must be a plain object',
      retryable: false,
      meta: { actionName: params.actionName },
    });
  }

  return {
    ...params.input,
    goal,
    args: args || {},
  };
};

export const normalizeActionResult = (params: {
  actionName: string;
  result: unknown;
}): ActionExecutionResult => {
  if (!isRecord(params.result)) {
    throw new WorkerExecutionError({
      code: 'ACTION_RESULT_INVALID',
      message: 'action result must be an object',
      retryable: false,
      meta: { actionName: params.actionName },
    });
  }

  const ok = Boolean(params.result.ok);
  const name = String(params.result.name || params.actionName).trim() || params.actionName;
  const summary = String(params.result.summary || '').trim();
  if (!summary) {
    throw new WorkerExecutionError({
      code: 'ACTION_RESULT_INVALID',
      message: 'action result summary is required',
      retryable: false,
      meta: { actionName: params.actionName },
    });
  }

  const artifacts = normalizeStringList(params.result.artifacts);
  const verification = normalizeStringList(params.result.verification);
  const error = params.result.error === undefined ? undefined : String(params.result.error || '').trim() || undefined;
  const agentRole = isAgentRole(params.result.agentRole)
    ? params.result.agentRole
    : inferAgentRoleByActionName(params.actionName);
  const handoff = normalizeHandoff(params.result.handoff);

  return {
    ok,
    name,
    summary,
    artifacts,
    verification,
    error,
    agentRole,
    handoff,
  };
};

export const validateMcpCallParams = (params: {
  workerUrl: string;
  toolName: string;
  args: Record<string, unknown>;
}) => {
  const workerUrl = String(params.workerUrl || '').trim();
  const toolName = String(params.toolName || '').trim();

  if (!workerUrl) {
    throw new WorkerExecutionError({
      code: 'MCP_WORKER_NOT_CONFIGURED',
      message: 'MCP worker URL is not configured',
      retryable: false,
    });
  }

  if (!toolName) {
    throw new WorkerExecutionError({
      code: 'MCP_PARSE_ERROR',
      message: 'MCP tool name is required',
      retryable: false,
    });
  }

  if (!isRecord(params.args)) {
    throw new WorkerExecutionError({
      code: 'MCP_PARSE_ERROR',
      message: 'MCP arguments must be a plain object',
      retryable: false,
    });
  }
};
