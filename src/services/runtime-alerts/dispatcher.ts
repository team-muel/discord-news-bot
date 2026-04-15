import * as Sentry from '@sentry/node';
import logger from '../../logger';
import { delegateAlertDispatch, shouldDelegate, shouldSkipInlineFallback } from '../automation/n8nDelegationService';
import { RUNTIME_ALERT_COOLDOWN_MS, RUNTIME_ALERT_WEBHOOK_URL } from './config';
import type { EmitAlert } from './types';
import { getErrorMessage } from '../../utils/errorMessage';

type AlertState = {
  lastSentAtMs: number;
};

const alertStates = new Map<string, AlertState>();

const shouldSendAlert = (key: string): boolean => {
  const now = Date.now();
  const previous = alertStates.get(key);
  if (previous && now - previous.lastSentAtMs < RUNTIME_ALERT_COOLDOWN_MS) {
    return false;
  }

  alertStates.set(key, { lastSentAtMs: now });
  return true;
};

const sendWebhookAlert = async (title: string, message: string, tags?: Record<string, string>) => {
  // n8n delegation: try dispatching alert via n8n
  if (shouldDelegate('alert-dispatch')) {
    const n8n = await delegateAlertDispatch(title, message, tags || {});
    if (n8n.delegated && n8n.ok) {
      return; // n8n handled the alert dispatch
    }
    if (shouldSkipInlineFallback('alert-dispatch')) {
      logger.warn('[ALERT] n8n delegation-first skipped inline webhook fallback');
      return;
    }
  }

  if (!RUNTIME_ALERT_WEBHOOK_URL) {
    return;
  }

  try {
    await fetch(RUNTIME_ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[Muel Runtime Alert] ${title}\n${message}`,
        tags: tags || {},
      }),
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.warn('[ALERT] Failed to send webhook alert: %s', errorMessage);
  }
};

const sendSentryAlert = (title: string, message: string, tags?: Record<string, string>) => {
  try {
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('runtime_alert', 'true');
      for (const [k, v] of Object.entries(tags || {})) {
        scope.setTag(k, v);
      }
      scope.setExtra('message', message);
      Sentry.captureMessage(title);
    });
  } catch {
    // Monitoring failures should not affect runtime behavior.
  }
};

export const createAlertDispatcher = (): EmitAlert => {
  return async ({ key, title, message, tags }) => {
    if (!shouldSendAlert(key)) {
      return;
    }

    logger.error('[ALERT] %s | %s', title, message);
    sendSentryAlert(title, message, tags);
    await sendWebhookAlert(title, message, tags);
  };
};
