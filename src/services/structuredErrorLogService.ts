import logger from '../logger';
import { parseBooleanEnv } from '../utils/env';
import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient';

export type StructuredErrorCode =
  | 'API_TIMEOUT'
  | 'ACTION_TIMEOUT'
  | 'ACTION_INPUT_INVALID'
  | 'ACTION_RESULT_INVALID'
  | 'CLI_IO_ERROR'
  | 'MCP_PARSE_ERROR'
  | 'MCP_TIMEOUT'
  | 'MCP_HTTP_ERROR'
  | 'MCP_WORKER_NOT_CONFIGURED'
  | 'LLM_REQUEST_FAILED'
  | 'UNKNOWN_ERROR';

type StructuredErrorInput = {
  code: StructuredErrorCode;
  source: string;
  message: string;
  guildId?: string;
  sessionId?: string;
  actionName?: string;
  severity?: 'info' | 'warn' | 'error';
  meta?: Record<string, unknown>;
};

const ERROR_LOG_DB_ENABLED = parseBooleanEnv(process.env.ERROR_LOG_DB_ENABLED, true);
const ERROR_LOG_TABLE = String(process.env.ERROR_LOG_TABLE || 'system_error_events').trim();

let dbDisabled = false;

const toText = (value: unknown): string => String(value || '').trim();

const toErrorStack = (value: unknown): string | null => {
  if (value instanceof Error) {
    return toText(value.stack || value.message) || null;
  }
  return null;
};

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const persistStructuredError = async (row: Record<string, unknown>) => {
  if (!ERROR_LOG_DB_ENABLED || dbDisabled || !isSupabaseConfigured()) {
    return;
  }

  try {
    const client = getSupabaseClient();
    const { error } = await client.from(ERROR_LOG_TABLE).insert(row);
    if (error) {
      const message = toText(error.message).toLowerCase();
      if (message.includes(ERROR_LOG_TABLE.toLowerCase()) || message.includes('does not exist') || toText((error as any)?.code) === '42P01') {
        dbDisabled = true;
      }
    }
  } catch {
    // best-effort only
  }
};

export const logStructuredError = async (params: StructuredErrorInput, error?: unknown): Promise<void> => {
  const severity = params.severity || 'error';
  const message = toText(params.message) || toErrorMessage(error);
  const stack = toErrorStack(error);
  const row = {
    code: params.code,
    source: params.source,
    severity,
    message,
    stack,
    guild_id: params.guildId || null,
    session_id: params.sessionId || null,
    action_name: params.actionName || null,
    metadata: params.meta || {},
    created_at: new Date().toISOString(),
  };

  logger.error('[%s] source=%s message=%s meta=%o', params.code, params.source, message, {
    guildId: params.guildId,
    sessionId: params.sessionId,
    actionName: params.actionName,
    ...params.meta,
  });

  await persistStructuredError(row);
};
