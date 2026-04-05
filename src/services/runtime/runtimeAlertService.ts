import { checkAutomationAlerts } from '../runtime-alerts/checks';
import { RUNTIME_ALERT_COOLDOWN_MS, RUNTIME_ALERT_ENABLED, RUNTIME_ALERT_SCAN_INTERVAL_MS, RUNTIME_ALERT_WEBHOOK_URL } from '../runtime-alerts/config';
import { createAlertDispatcher } from '../runtime-alerts/dispatcher';
import { BackgroundLoop } from '../../utils/backgroundLoop';

const emitAlert = createAlertDispatcher();

const loop = new BackgroundLoop(
  async () => { await checkAutomationAlerts(emitAlert); },
  { name: '[ALERT]', intervalMs: RUNTIME_ALERT_SCAN_INTERVAL_MS, runOnStart: true },
);

export const startRuntimeAlerts = () => {
  if (!RUNTIME_ALERT_ENABLED) return;
  loop.start();
};

export const stopRuntimeAlerts = () => {
  loop.stop();
};

export const getRuntimeAlertsStats = () => ({
  ...loop.getStats(),
  enabled: RUNTIME_ALERT_ENABLED,
  cooldownMs: RUNTIME_ALERT_COOLDOWN_MS,
  webhookConfigured: Boolean(RUNTIME_ALERT_WEBHOOK_URL),
});
