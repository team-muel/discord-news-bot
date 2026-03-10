import * as Sentry from '@sentry/node';
import logger from '../logger';
import { getAutomationRuntimeSnapshot } from './automationBot';
import { getTradingEngineRuntimeSnapshot } from './tradingEngine';

type AlertState = {
  lastSentAtMs: number;
};

const SCAN_INTERVAL_MS = Math.max(10_000, Number(process.env.RUNTIME_ALERT_SCAN_INTERVAL_MS || 30_000));
const COOLDOWN_MS = Math.max(30_000, Number(process.env.RUNTIME_ALERT_COOLDOWN_MS || 5 * 60_000));
const WEBHOOK_URL = String(process.env.RUNTIME_ALERT_WEBHOOK_URL || '').trim();
const ALERT_ENABLED = String(process.env.RUNTIME_ALERT_ENABLED || 'true').toLowerCase() !== 'false';

const alertStates = new Map<string, AlertState>();
let timer: NodeJS.Timeout | null = null;
let started = false;

const shouldSendAlert = (key: string): boolean => {
  const now = Date.now();
  const previous = alertStates.get(key);
  if (previous && now - previous.lastSentAtMs < COOLDOWN_MS) {
    return false;
  }

  alertStates.set(key, { lastSentAtMs: now });
  return true;
};

const sendWebhookAlert = async (title: string, message: string, tags?: Record<string, string>) => {
  if (!WEBHOOK_URL) {
    return;
  }

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[Muel Runtime Alert] ${title}\n${message}`,
        tags: tags || {},
      }),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
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

const emitAlert = async (key: string, title: string, message: string, tags?: Record<string, string>) => {
  if (!shouldSendAlert(key)) {
    return;
  }

  logger.error('[ALERT] %s | %s', title, message);
  sendSentryAlert(title, message, tags);
  await sendWebhookAlert(title, message, tags);
};

const checkAutomationAlerts = async () => {
  const automation = getAutomationRuntimeSnapshot();
  for (const [jobName, job] of Object.entries(automation.jobs)) {
    const hasError = Boolean(job.lastErrorAt && job.lastError);
    if (!hasError) {
      continue;
    }

    const key = `automation:${jobName}:${job.lastError || 'unknown'}`;
    const title = `Automation job degraded: ${jobName}`;
    const message = [
      `error=${job.lastError || 'unknown'}`,
      `lastErrorAt=${job.lastErrorAt || 'unknown'}`,
      `runCount=${job.runCount}`,
      `success=${job.successCount}`,
      `fail=${job.failCount}`,
    ].join(' | ');

    await emitAlert(key, title, message, { subsystem: 'automation', job: jobName });
  }
};

const checkTradingAlerts = async () => {
  const runtime = getTradingEngineRuntimeSnapshot();
  if (!runtime.started) {
    return;
  }

  if (runtime.paused && runtime.pausedReason && runtime.pausedReason.startsWith('memory_guard')) {
    const key = `trading:memory_guard:${runtime.pausedReason}`;
    const title = 'Trading engine paused by memory guard';
    const message = `${runtime.pausedReason} | symbols=${runtime.symbols.join(',')}`;
    await emitAlert(key, title, message, { subsystem: 'trading', reason: 'memory_guard' });
  }

  if (runtime.lastLoopError) {
    const key = `trading:loop_error:${runtime.lastLoopError}`;
    const title = 'Trading engine loop error';
    const message = `lastLoopError=${runtime.lastLoopError} | lastLoopAt=${runtime.lastLoopAt || 'n/a'}`;
    await emitAlert(key, title, message, { subsystem: 'trading', reason: 'loop_error' });
  }
};

const scanAlerts = async () => {
  await checkAutomationAlerts();
  await checkTradingAlerts();
};

export const startRuntimeAlerts = () => {
  if (started || !ALERT_ENABLED) {
    return;
  }

  started = true;
  void scanAlerts();
  timer = setInterval(() => {
    void scanAlerts();
  }, SCAN_INTERVAL_MS);

  logger.info('[ALERT] runtime alert scanner started (intervalMs=%d, cooldownMs=%d, webhook=%s)', SCAN_INTERVAL_MS, COOLDOWN_MS, String(Boolean(WEBHOOK_URL)));
};

export const stopRuntimeAlerts = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
};
