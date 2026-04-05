/**
 * Global Express error-handling middleware.
 *
 * Must be registered AFTER all routes in app.ts:
 *   app.use(errorHandler);
 *
 * Routes can simply `throw new AppError(code)` or call `next(error)`.
 * Legacy code that `throw new Error('KNOWN_CODE')` is also handled via
 * promoteToAppError().
 */
import type { ErrorRequestHandler } from 'express';
import { AppError, promoteToAppError } from '../utils/errors';
import { getErrorMessage } from '../utils/errorMessage';
import logger from '../logger';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appErr = err instanceof AppError ? err : promoteToAppError(err);

  if (appErr) {
    const status = appErr.statusCode;
    // Use a stable JSON envelope matching existing route responses
    const label =
      status === 400 ? 'VALIDATION'
        : status === 403 ? 'FORBIDDEN'
          : status === 404 ? 'NOT_FOUND'
            : status === 409 ? 'CONFLICT'
              : status === 422 ? 'UNPROCESSABLE'
                : status === 503 ? 'CONFIG'
                  : appErr.code;
    return res.status(status).json({ ok: false, error: label, message: appErr.message });
  }

  // Unknown / unstructured error — 500
  const safeMessage = getErrorMessage(err);
  logger.error('Unhandled route error: %s', safeMessage);
  return res.status(500).json({ ok: false, error: 'INTERNAL', message: safeMessage });
};
