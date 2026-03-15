import {
  AUTOMATION_ENABLED,
  AUTOMATION_RUNTIME_ENABLED,
  JOB_CONFIGS,
} from './automation/config';
import { buildAutomationSummary, isAutomationHealthy } from './automation/health';
import { getAutomationModule, getAutomationModules } from './automation/modules';
import { createInitialJobStates, initJobState } from './automation/runtimeState';
import type { AutomationJobName, AutomationRuntimeSnapshot } from './automation/types';
import type { Client } from 'discord.js';

export type { AutomationJobName, AutomationRuntimeSnapshot };

export type AutomationTriggerContext = {
  guildId?: string;
};

const jobStates = createInitialJobStates();
let started = false;
let startedAt: string | null = null;
let activeClient: Client | null = null;
const manualTriggers: Partial<Record<AutomationJobName, (context?: AutomationTriggerContext) => Promise<{ ok: boolean; message: string }>>> = {};

const syncMonitorState = () => {
  for (const module of getAutomationModules()) {
    const state = jobStates[module.name];
    const monitor = module.getSnapshot();

    state.running = Boolean(monitor.running);
    state.runCount = monitor.runCount;
    state.successCount = monitor.successCount;
    state.failCount = monitor.failCount;
    state.lastRunAt = monitor.lastRunAt;
    state.lastSuccessAt = monitor.lastSuccessAt;
    state.lastErrorAt = monitor.lastErrorAt;
    state.lastError = monitor.lastError;
    state.lastDurationMs = monitor.lastDurationMs;
    state.lastExitCode = null;
  }
};

export const registerAutomationManualTrigger = (
  jobName: AutomationJobName,
  fn: (context?: AutomationTriggerContext) => Promise<{ ok: boolean; message: string }>,
) => {
  manualTriggers[jobName] = fn;
};

export const startAutomationJobs = () => {
  if (started) {
    return;
  }

  for (const config of JOB_CONFIGS) {
    initJobState(jobStates, config);
  }

  started = true;
  startedAt = new Date().toISOString();

  if (!AUTOMATION_ENABLED) {
    return;
  }

  if (!AUTOMATION_RUNTIME_ENABLED) {
    for (const name of Object.keys(jobStates) as AutomationJobName[]) {
      const state = jobStates[name];
      state.enabled = false;
      state.running = false;
      state.lastError = 'Primary Discord token missing';
      state.lastErrorAt = new Date().toISOString();
    }
  }

  syncMonitorState();
};

export const startAutomationModules = (client: Client) => {
  if (!AUTOMATION_ENABLED || !AUTOMATION_RUNTIME_ENABLED) {
    return;
  }

  activeClient = client;

  for (const module of getAutomationModules()) {
    const state = jobStates[module.name];
    if (!state.enabled || !module.isEnabled()) {
      continue;
    }

    module.start(client);
  }
};

export const triggerAutomationJob = async (jobName: AutomationJobName, context?: AutomationTriggerContext) => {
  const state = jobStates[jobName];
  if (!state) {
    return { ok: false, message: `Unsupported job: ${String(jobName || '(unknown)')}` };
  }

  if (!state.enabled) {
    return { ok: false, message: `${jobName} is disabled` };
  }

  if (!AUTOMATION_ENABLED) {
    return { ok: false, message: 'Automation is disabled' };
  }

  if (!AUTOMATION_RUNTIME_ENABLED) {
    return { ok: false, message: 'Primary Discord token is not configured' };
  }

  const manualTrigger = manualTriggers[jobName];
  const module = getAutomationModule(jobName);

  if (!module.isEnabled()) {
    return { ok: false, message: `${jobName} is disabled` };
  }

  if (!manualTrigger && !activeClient) {
    return { ok: false, message: `${jobName} is not ready yet` };
  }

  const result = manualTrigger
    ? await manualTrigger(context)
    : await module.trigger(activeClient as Client, context?.guildId);

  syncMonitorState();
  return result;
};

export const getAutomationRuntimeSnapshot = (): AutomationRuntimeSnapshot => {
  syncMonitorState();
  return {
    started,
    healthy: isAutomationHealthy(Object.values(jobStates)),
    summary: buildAutomationSummary(Object.values(jobStates)),
    startedAt,
    runtime: 'node',
    jobs: {
      'youtube-monitor': { ...jobStates['youtube-monitor'] },
      'news-monitor': { ...jobStates['news-monitor'] },
    },
  };
};

export const isAutomationEnabled = () => AUTOMATION_RUNTIME_ENABLED && AUTOMATION_ENABLED;
