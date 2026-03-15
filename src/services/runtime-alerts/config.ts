export const RUNTIME_ALERT_SCAN_INTERVAL_MS = Math.max(10_000, Number(process.env.RUNTIME_ALERT_SCAN_INTERVAL_MS || 30_000));
export const RUNTIME_ALERT_COOLDOWN_MS = Math.max(30_000, Number(process.env.RUNTIME_ALERT_COOLDOWN_MS || 5 * 60_000));
export const RUNTIME_ALERT_WEBHOOK_URL = String(process.env.RUNTIME_ALERT_WEBHOOK_URL || '').trim();
export const RUNTIME_ALERT_ENABLED = String(process.env.RUNTIME_ALERT_ENABLED || 'true').toLowerCase() !== 'false';
export const RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT = Math.max(
	1,
	Number(process.env.RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT || 2),
);
export const RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO = Math.min(
	1,
	Math.max(0, Number(process.env.RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO || 0.5)),
);
