import { getAutomationRuntimeSnapshot } from '../automationBot';
import {
  RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT,
  RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO,
} from './config';
import type { EmitAlert } from './types';

export const checkAutomationAlerts = async (emitAlert: EmitAlert) => {
  const automation = getAutomationRuntimeSnapshot();

  const shouldAlertPartialFailure = (message: string): boolean => {
    const parsed = String(message || '').match(/Partial failure:\s*(\d+)\/(\d+)\s+sources failed/i);
    if (!parsed) {
      return true;
    }

    const failed = Number(parsed[1] || 0);
    const total = Math.max(1, Number(parsed[2] || 0));
    const ratio = failed / total;

    if (failed < RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_COUNT) {
      return false;
    }

    if (ratio < RUNTIME_ALERT_AUTOMATION_PARTIAL_FAIL_MIN_RATIO) {
      return false;
    }

    return true;
  };

  for (const [jobName, job] of Object.entries(automation.jobs)) {
    const hasError = Boolean(job.lastErrorAt && job.lastError);
    if (!hasError) {
      continue;
    }

    if (!shouldAlertPartialFailure(String(job.lastError || ''))) {
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

    await emitAlert({ key, title, message, tags: { subsystem: 'automation', job: jobName } });
  }
};
