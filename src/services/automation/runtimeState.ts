import type { AutomationJobName, AutomationJobState, JobConfig } from './types';

export const createInitialJobStates = (): Record<AutomationJobName, AutomationJobState> => ({
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
  'news-monitor': {
    name: 'news-monitor',
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
});

export const initJobState = (
  jobStates: Record<AutomationJobName, AutomationJobState>,
  config: JobConfig,
) => {
  const state = jobStates[config.name];
  state.enabled = config.enabled;
  state.schedule = config.schedule;
  state.scriptPath = config.scriptPath;
};
