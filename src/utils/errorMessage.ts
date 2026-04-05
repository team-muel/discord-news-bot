/**
 * Shared error-message extractor with sensitive-info filtering.
 * Single canonical source — do NOT duplicate in other modules.
 */
const SENSITIVE_PATTERN = /supabase|postgres|token|secret|api.key|authorization|password|connection.string/i;

export const getErrorMessage = (error: unknown): string => {
  let raw: string;
  if (error instanceof Error && error.message) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.code, record.message, record.details, record.hint]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) {
      raw = parts.join(' | ');
    } else {
      try {
        raw = JSON.stringify(error);
      } catch {
        raw = String(error);
      }
    }
  } else {
    raw = String(error);
  }
  return SENSITIVE_PATTERN.test(raw) ? 'internal error' : raw;
};

/**
 * Catch handler for fire-and-forget promises that logs instead of silently swallowing.
 * Use: `somePromise.catch(logCatchError(logger, 'tag'))` instead of `.catch(() => {})`.
 */
export const logCatchError = (
  log: { warn(msg: string, ...args: unknown[]): void },
  tag: string,
) => (err: unknown): void => {
  log.warn('%s failed: %s', tag, getErrorMessage(err));
};

/**
 * Like logCatchError but at debug level — for dual-write or low-severity side effects.
 */
export const debugCatchError = (
  log: { debug(msg: string, ...args: unknown[]): void },
  tag: string,
) => (err: unknown): void => {
  log.debug('%s failed: %s', tag, getErrorMessage(err));
};
