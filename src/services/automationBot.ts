import { spawn } from 'child_process';
import cron, { type ScheduledTask } from 'node-cron';
import logger from '../logger';
import {
  AUTOMATION_ENABLED,
  AUTOMATION_NEWS_INTERVAL_MIN,
  AUTOMATION_PERSISTENT_WORKERS,
  AUTOMATION_RESTART_DELAY_MS,
  AUTOMATION_RUN_ON_START,
  AUTOMATION_RUNTIME_ENABLED,
  AUTOMATION_YOUTUBE_INTERVAL_MIN,
  JOB_CONFIGS,
  PYTHON_COMMAND,
} from './automation/config';
import { buildAutomationSummary, isAutomationHealthy } from './automation/health';
import { createInitialJobStates, initJobState } from './automation/runtimeState';
import type { AutomationJobName, AutomationRuntimeSnapshot } from './automation/types';

export type { AutomationJobName, AutomationRuntimeSnapshot };

const jobStates = createInitialJobStates();

const scheduledTasks: Partial<Record<AutomationJobName, ScheduledTask>> = {};
const daemonProcesses: Partial<Record<AutomationJobName, ReturnType<typeof spawn>>> = {};
let started = false;
let startedAt: string | null = null;

const getJobIntervalMin = (jobName: AutomationJobName) => {
  return jobName === 'news-analysis' ? AUTOMATION_NEWS_INTERVAL_MIN : AUTOMATION_YOUTUBE_INTERVAL_MIN;
};

const startPersistentJob = (jobName: AutomationJobName) => {
  const state = jobStates[jobName];
  if (!state.enabled) {
    return;
  }

  if (state.running) {
    return;
  }

  const intervalMin = getJobIntervalMin(jobName);
  state.running = true;
  state.runCount += 1;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;

  logger.info('[AUTOMATION] Starting persistent worker %s (interval=%dm)', jobName, intervalMin);

  const child = spawn(PYTHON_COMMAND, [state.scriptPath, '--daemon'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTOMATION_JOB_NAME: jobName,
      AUTOMATION_JOB_INTERVAL_MIN: String(intervalMin),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  daemonProcesses[jobName] = child;

  child.stdout.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (!line) {
      return;
    }

    logger.info('[AUTOMATION][%s][stdout] %s', jobName, line);
    const lower = line.toLowerCase();
    if (lower.includes('tick complete') || lower.includes('report sent') || lower.includes('alert sent')) {
      state.successCount += 1;
      state.lastSuccessAt = new Date().toISOString();
      state.lastError = null;
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trim();
    if (line) {
      state.lastError = line;
      logger.warn('[AUTOMATION][%s][stderr] %s', jobName, line);
    }
  });

  child.on('error', (error) => {
    state.running = false;
    state.failCount += 1;
    state.lastErrorAt = new Date().toISOString();
    state.lastError = error.message;
    state.lastExitCode = -1;
    logger.error('[AUTOMATION] Persistent worker %s failed to start: %o', jobName, error);

    if (started && state.enabled) {
      setTimeout(() => startPersistentJob(jobName), AUTOMATION_RESTART_DELAY_MS);
    }
  });

  child.on('close', (code) => {
    state.running = false;
    state.lastExitCode = code;
    daemonProcesses[jobName] = undefined;

    if (code === 0) {
      logger.info('[AUTOMATION] Persistent worker %s exited gracefully', jobName);
      if (started && state.enabled) {
        setTimeout(() => startPersistentJob(jobName), AUTOMATION_RESTART_DELAY_MS);
      }
      return;
    }

    state.failCount += 1;
    state.lastErrorAt = new Date().toISOString();
    state.lastError = state.lastError || `Exited with code ${String(code)}`;
    logger.error('[AUTOMATION] Persistent worker %s exited with code=%s', jobName, String(code));

    if (started && state.enabled) {
      setTimeout(() => startPersistentJob(jobName), AUTOMATION_RESTART_DELAY_MS);
    }
  });
};

const runJob = (jobName: AutomationJobName, trigger: 'cron' | 'manual') => {
  const state = jobStates[jobName];
  if (!state.enabled) {
    return Promise.resolve({ ok: false, message: 'Job disabled' });
  }

  if (state.running) {
    return Promise.resolve({ ok: false, message: 'Job already running' });
  }

  state.running = true;
  state.runCount += 1;
  state.lastRunAt = new Date().toISOString();
  const startMs = Date.now();

  logger.info('[AUTOMATION] Starting job %s (trigger=%s)', jobName, trigger);

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    const child = spawn(PYTHON_COMMAND, [state.scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdErr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) {
        logger.info('[AUTOMATION][%s][stdout] %s', jobName, line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) {
        stdErr = `${stdErr}\n${line}`.trim();
        logger.warn('[AUTOMATION][%s][stderr] %s', jobName, line);
      }
    });

    child.on('error', (error) => {
      state.running = false;
      state.failCount += 1;
      state.lastErrorAt = new Date().toISOString();
      state.lastError = error.message;
      state.lastExitCode = -1;
      state.lastDurationMs = Date.now() - startMs;
      logger.error('[AUTOMATION] Job %s failed to start: %o', jobName, error);
      resolve({ ok: false, message: error.message });
    });

    child.on('close', (code) => {
      state.running = false;
      state.lastDurationMs = Date.now() - startMs;
      state.lastExitCode = code;

      if (code === 0) {
        state.successCount += 1;
        state.lastSuccessAt = new Date().toISOString();
        state.lastError = null;
        logger.info('[AUTOMATION] Job %s completed successfully', jobName);
        resolve({ ok: true, message: 'Completed' });
        return;
      }

      state.failCount += 1;
      state.lastErrorAt = new Date().toISOString();
      state.lastError = stdErr || `Exited with code ${String(code)}`;
      logger.error('[AUTOMATION] Job %s failed: code=%s stderr=%s', jobName, String(code), stdErr || '-');
      resolve({ ok: false, message: state.lastError || 'Failed' });
    });
  });
};

export const startAutomationBot = () => {
  if (started) {
    return;
  }

  for (const config of JOB_CONFIGS) {
    initJobState(jobStates, config);
  }

  started = true;
  startedAt = new Date().toISOString();

  if (!AUTOMATION_ENABLED) {
    logger.info('[AUTOMATION] START_AUTOMATION_BOT disabled');
    return;
  }

  if (!AUTOMATION_RUNTIME_ENABLED) {
    for (const config of JOB_CONFIGS) {
      const state = jobStates[config.name];
      state.enabled = false;
      state.lastError = null;
      state.lastErrorAt = null;
      state.running = false;
    }
    logger.info('[AUTOMATION] Token missing. Skipping automation workers (set SECONDARY_DISCORD_TOKEN or AUTOMATION_DISCORD_TOKEN to enable).');
    return;
  }

  if (AUTOMATION_PERSISTENT_WORKERS) {
    for (const config of JOB_CONFIGS) {
      if (!config.enabled) {
        logger.info('[AUTOMATION] Job %s is disabled', config.name);
        continue;
      }

      startPersistentJob(config.name);
    }

    return;
  }

  for (const config of JOB_CONFIGS) {
    if (!config.enabled) {
      logger.info('[AUTOMATION] Job %s is disabled', config.name);
      continue;
    }

    if (!cron.validate(config.schedule)) {
      jobStates[config.name].lastErrorAt = new Date().toISOString();
      jobStates[config.name].lastError = `Invalid cron expression: ${config.schedule}`;
      logger.error('[AUTOMATION] Invalid cron for %s: %s', config.name, config.schedule);
      continue;
    }

    scheduledTasks[config.name] = cron.schedule(config.schedule, () => {
      void runJob(config.name, 'cron');
    });

    logger.info('[AUTOMATION] Scheduled job %s with cron %s', config.name, config.schedule);

    if (AUTOMATION_RUN_ON_START) {
      // Kick off one immediate run so startup health reflects actual script operability.
      setTimeout(() => {
        void runJob(config.name, 'manual').then((result) => {
          if (!result.ok) {
            logger.warn('[AUTOMATION] Startup run failed for %s: %s', config.name, result.message);
          }
        });
      }, 2000);
    }
  }
};

export const triggerAutomationJob = (jobName: AutomationJobName) => {
  if (!AUTOMATION_RUNTIME_ENABLED) {
    return Promise.resolve({ ok: false, message: 'Automation token is not configured' });
  }

  if (AUTOMATION_PERSISTENT_WORKERS) {
    const state = jobStates[jobName];
    if (!state.enabled) {
      return Promise.resolve({ ok: false, message: 'Job disabled' });
    }

    if (!state.running) {
      startPersistentJob(jobName);
      return Promise.resolve({ ok: true, message: 'Persistent worker restart requested' });
    }

    return Promise.resolve({ ok: true, message: 'Persistent worker already running' });
  }

  return runJob(jobName, 'manual');
};

export const getAutomationRuntimeSnapshot = (): AutomationRuntimeSnapshot => {
  return {
    started,
    healthy: isAutomationHealthy(Object.values(jobStates)),
    summary: buildAutomationSummary(Object.values(jobStates)),
    startedAt,
    pythonCommand: PYTHON_COMMAND,
    jobs: {
      'news-analysis': { ...jobStates['news-analysis'] },
      'youtube-monitor': { ...jobStates['youtube-monitor'] },
    },
  };
};

export const isAutomationEnabled = () => AUTOMATION_RUNTIME_ENABLED;
