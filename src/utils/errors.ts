/**
 * Structured error class that replaces string-based error branching in routes.
 *
 * Services throw `AppError` with a typed code; the global Express error handler
 * maps it to the correct HTTP status and JSON shape — no more
 * `if (message === 'SOME_STRING')` chains in route files.
 */

// ─── Error code → HTTP status mapping ────────────────────────────────────────

const ERROR_STATUS: Record<string, number> = {
  // 400 Bad Request
  VALIDATION: 400,
  INVALID_KEEP_ITEM_ID: 400,
  USER_ID_REQUIRED: 400,
  GUILD_ID_REQUIRED: 400,

  // 403 Forbidden
  PRIVACY_PREFLIGHT_BLOCKED: 403,

  // 404 Not Found
  AGENT_GOT_RUN_NOT_FOUND: 404,
  OPENCODE_CHANGE_REQUEST_NOT_FOUND: 404,
  MEMORY_NOT_FOUND: 404,
  MEMORY_CONFLICT_NOT_FOUND: 404,
  DEADLETTER_NOT_FOUND: 404,
  RETRIEVAL_EVAL_RUN_NOT_FOUND: 404,
  TOOL_LEARNING_CANDIDATE_NOT_FOUND: 404,

  // 409 Conflict
  OPENCODE_CHANGE_REQUEST_NOT_APPROVED: 409,
  JOB_NOT_CANCELABLE: 409,

  // 422 Unprocessable
  OBSIDIAN_SANITIZER_BLOCKED: 422,
  MEMORY_CONTENT_BLOCKED_BY_POISON_GUARD: 422,

  // 503 Service Unavailable
  SUPABASE_NOT_CONFIGURED: 503,
  OBSIDIAN_VAULT_PATH_MISSING: 503,
};

export type AppErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  /** Machine-readable error code. */
  readonly code: string;
  /** HTTP status code derived from code, or the explicit override. */
  readonly statusCode: number;

  constructor(code: string, message?: string, statusCode?: number) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode ?? ERROR_STATUS[code] ?? 500;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the HTTP status for a known error code, or 500 for unknown codes.
 */
export function httpStatusForCode(code: string): number {
  return ERROR_STATUS[code] ?? 500;
}

/**
 * Test whether an unknown `error` value is an {@link AppError}.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Convert a legacy `throw new Error('CODE')` or `throw new Error('CODE: detail')`
 * into an AppError if the leading word matches a known error code.
 *
 * The global error handler calls this so existing service code that hasn't been
 * migrated yet still gets the correct HTTP status.
 */
export function promoteToAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return null;

  // Handle "CODE: detail" or "CODE" formats
  const colonIdx = message.indexOf(':');
  const code = colonIdx > 0 ? message.slice(0, colonIdx) : message;

  if (code in ERROR_STATUS) {
    const detail = colonIdx > 0 ? message.slice(colonIdx + 1).trim() : undefined;
    return new AppError(code, detail ?? message, ERROR_STATUS[code]);
  }

  return null;
}
