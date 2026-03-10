import { getAutomationRuntimeSnapshot } from '../automationBot';
import { getTradingEngineRuntimeSnapshot } from '../tradingEngine';
import type { EmitAlert } from './types';

export const checkAutomationAlerts = async (emitAlert: EmitAlert) => {
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

    await emitAlert({ key, title, message, tags: { subsystem: 'automation', job: jobName } });
  }
};

export const checkTradingAlerts = async (emitAlert: EmitAlert) => {
  const runtime = getTradingEngineRuntimeSnapshot();
  if (!runtime.started) {
    return;
  }

  if (runtime.paused && runtime.pausedReason && runtime.pausedReason.startsWith('memory_guard')) {
    const key = `trading:memory_guard:${runtime.pausedReason}`;
    const title = 'Trading engine paused by memory guard';
    const message = `${runtime.pausedReason} | symbols=${runtime.symbols.join(',')}`;
    await emitAlert({ key, title, message, tags: { subsystem: 'trading', reason: 'memory_guard' } });
  }

  if (runtime.lastLoopError) {
    const key = `trading:loop_error:${runtime.lastLoopError}`;
    const title = 'Trading engine loop error';
    const message = `lastLoopError=${runtime.lastLoopError} | lastLoopAt=${runtime.lastLoopAt || 'n/a'}`;
    await emitAlert({ key, title, message, tags: { subsystem: 'trading', reason: 'loop_error' } });
  }
};
