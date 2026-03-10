export const RUNTIME_ALERT_SCAN_INTERVAL_MS = Math.max(10_000, Number(process.env.RUNTIME_ALERT_SCAN_INTERVAL_MS || 30_000));
export const RUNTIME_ALERT_COOLDOWN_MS = Math.max(30_000, Number(process.env.RUNTIME_ALERT_COOLDOWN_MS || 5 * 60_000));
export const RUNTIME_ALERT_WEBHOOK_URL = String(process.env.RUNTIME_ALERT_WEBHOOK_URL || '').trim();
export const RUNTIME_ALERT_ENABLED = String(process.env.RUNTIME_ALERT_ENABLED || 'true').toLowerCase() !== 'false';
