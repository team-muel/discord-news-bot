import logger from './logger';
import * as Sentry from '@sentry/node';
import { getErrorMessage } from './utils/errorMessage';

export function initMonitoring(): void {
  const sentryDsn = process.env.SENTRY_DSN;
  if (!sentryDsn) return;

  try {
    if (!Sentry.getCurrentHub().getClient()) {
      Sentry.init({ dsn: sentryDsn, environment: process.env.NODE_ENV || 'production' });
      logger.info('Sentry initialized');
    }
  } catch (err) {
    logger.error('Sentry initialization failed: %s', getErrorMessage(err));
    // Do not throw — monitoring must not block application start
  }
}

export default initMonitoring;
