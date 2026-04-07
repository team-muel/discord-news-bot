import { parseBooleanEnv, parseBoundedNumberEnv, parseMinIntEnv, parseStringEnv } from '../../utils/env';

export const RUNTIME_ALERT_SCAN_INTERVAL_MS = parseMinIntEnv(process.env.RUNTIME_ALERT_SCAN_INTERVAL_MS, 30_000, 10_000);
export const RUNTIME_ALERT_COOLDOWN_MS = parseMinIntEnv(process.env.RUNTIME_ALERT_COOLDOWN_MS, 5 * 60_000, 30_000);
export const RUNTIME_ALERT_WEBHOOK_URL = parseStringEnv(process.env.RUNTIME_ALERT_WEBHOOK_URL, '');
export const RUNTIME_ALERT_ENABLED = parseBooleanEnv(process.env.RUNTIME_ALERT_ENABLED, true);
export const RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT = parseMinIntEnv(process.env.RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT, 2, 1);
export const RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO = parseBoundedNumberEnv(process.env.RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO, 0.5, 0, 1);

