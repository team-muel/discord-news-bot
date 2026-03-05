import logger from './logger';
import * as Sentry from '@sentry/node';

export function initMonitoring(): void {
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn && !Sentry.getCurrentHub().getClient()) {
    Sentry.init({ dsn: sentryDsn, environment: process.env.NODE_ENV || 'production' });
    logger.info('Sentry initialized');
  }
}

export default initMonitoring;
