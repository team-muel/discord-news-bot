import logger from '../logger';
import { checkAutomationAlerts, checkTradingAlerts } from './runtime-alerts/checks';
import { RUNTIME_ALERT_COOLDOWN_MS, RUNTIME_ALERT_ENABLED, RUNTIME_ALERT_SCAN_INTERVAL_MS, RUNTIME_ALERT_WEBHOOK_URL } from './runtime-alerts/config';
import { createAlertDispatcher } from './runtime-alerts/dispatcher';

let timer: NodeJS.Timeout | null = null;
let started = false;
const emitAlert = createAlertDispatcher();

const scanAlerts = async () => {
  await checkAutomationAlerts(emitAlert);
  await checkTradingAlerts(emitAlert);
};

export const startRuntimeAlerts = () => {
  if (started || !RUNTIME_ALERT_ENABLED) {
    return;
  }

  started = true;
  void scanAlerts();
  timer = setInterval(() => {
    void scanAlerts();
  }, RUNTIME_ALERT_SCAN_INTERVAL_MS);
  timer.unref();

  logger.info(
    '[ALERT] runtime alert scanner started (intervalMs=%d, cooldownMs=%d, webhook=%s)',
    RUNTIME_ALERT_SCAN_INTERVAL_MS,
    RUNTIME_ALERT_COOLDOWN_MS,
    String(Boolean(RUNTIME_ALERT_WEBHOOK_URL)),
  );
};

export const stopRuntimeAlerts = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
};

export const getRuntimeAlertsStats = () => ({
  enabled: RUNTIME_ALERT_ENABLED,
  started,
  running: Boolean(timer),
  intervalMs: RUNTIME_ALERT_SCAN_INTERVAL_MS,
  cooldownMs: RUNTIME_ALERT_COOLDOWN_MS,
  webhookConfigured: Boolean(RUNTIME_ALERT_WEBHOOK_URL),
});
