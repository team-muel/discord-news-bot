import { spawn } from 'child_process';
import cron, { type ScheduledTask } from 'node-cron';
import logger from '../logger';

export type AutomationJobName = 'news-analysis' | 'youtube-monitor';

type AutomationJobState = {
  name: AutomationJobName;
  enabled: boolean;
  schedule: string;
  scriptPath: string;
  running: boolean;
  runCount: number;
  successCount: number;
  failCount: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastExitCode: number | null;
};

export type AutomationRuntimeSnapshot = {
  started: boolean;
  healthy: boolean;
  summary: string;
  startedAt: string | null;
  pythonCommand: string;
  jobs: Record<AutomationJobName, AutomationJobState>;
};

type JobConfig = {
  name: AutomationJobName;
  enabled: boolean;
  schedule: string;
  scriptPath: string;
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }

  return fallback;
};

const AUTOMATION_ENABLED = toBool(process.env.START_AUTOMATION_BOT, true);
const PYTHON_COMMAND = process.env.AUTOMATION_PYTHON_COMMAND || 'python';

const JOB_CONFIGS: JobConfig[] = [
  {
    name: 'news-analysis',
    enabled: toBool(process.env.AUTOMATION_NEWS_ENABLED, true),
    schedule: process.env.AUTOMATION_NEWS_CRON || '*/30 * * * *',
    scriptPath: process.env.AUTOMATION_NEWS_SCRIPT || 'bot_task.py',
  },
  {
    name: 'youtube-monitor',
    enabled: toBool(process.env.AUTOMATION_YOUTUBE_ENABLED, true),
    schedule: process.env.AUTOMATION_YOUTUBE_CRON || '*/10 * * * *',
    scriptPath: process.env.AUTOMATION_YOUTUBE_SCRIPT || 'youtube_monitor.py',
  },
];

const jobStates: Record<AutomationJobName, AutomationJobState> = {
  'news-analysis': {
    name: 'news-analysis',
    enabled: false,
    schedule: '',
    scriptPath: '',
    running: false,
    runCount: 0,
    successCount: 0,
    failCount: 0,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastDurationMs: null,
    lastExitCode: null,
  },
  'youtube-monitor': {
    name: 'youtube-monitor',
    enabled: false,
    schedule: '',
    scriptPath: '',
    running: false,
    runCount: 0,
    successCount: 0,
    failCount: 0,
    lastRunAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastDurationMs: null,
    lastExitCode: null,
  },
};

const scheduledTasks: Partial<Record<AutomationJobName, ScheduledTask>> = {};
let started = false;
let startedAt: string | null = null;

const initJobState = (config: JobConfig) => {
  const state = jobStates[config.name];
  state.enabled = config.enabled;
  state.schedule = config.schedule;
  state.scriptPath = config.scriptPath;
};

const buildSummary = () => {
  if (!AUTOMATION_ENABLED) {
    return 'Automation bot is disabled';
  }

  const activeJobs = Object.values(jobStates).filter((job) => job.enabled);
  if (activeJobs.length === 0) {
    return 'Automation bot has no enabled jobs';
  }

  const unhealthy = activeJobs.find((job) => job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) > Date.parse(job.lastSuccessAt)));
  if (unhealthy) {
    return `Automation job ${unhealthy.name} needs attention`;
  }

  return 'Automation bot is healthy';
};

const isHealthy = () => {
  if (!AUTOMATION_ENABLED) {
    return false;
  }

  const activeJobs = Object.values(jobStates).filter((job) => job.enabled);
  if (activeJobs.length === 0) {
    return false;
  }

  return !activeJobs.some((job) => {
    if (!job.lastErrorAt) {
      return false;
    }

    if (!job.lastSuccessAt) {
      return true;
    }

    return Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt);
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
    initJobState(config);
  }

  started = true;
  startedAt = new Date().toISOString();

  if (!AUTOMATION_ENABLED) {
    logger.info('[AUTOMATION] START_AUTOMATION_BOT disabled');
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
  }
};

export const triggerAutomationJob = (jobName: AutomationJobName) => {
  return runJob(jobName, 'manual');
};

export const getAutomationRuntimeSnapshot = (): AutomationRuntimeSnapshot => {
  return {
    started,
    healthy: isHealthy(),
    summary: buildSummary(),
    startedAt,
    pythonCommand: PYTHON_COMMAND,
    jobs: {
      'news-analysis': { ...jobStates['news-analysis'] },
      'youtube-monitor': { ...jobStates['youtube-monitor'] },
    },
  };
};

export const isAutomationEnabled = () => AUTOMATION_ENABLED;
