import {
  AUTOMATION_ENABLED,
  AUTOMATION_PERSISTENT_WORKERS,
  AUTOMATION_RUNTIME_ENABLED,
} from './config';
import type { AutomationJobState } from './types';

export const buildAutomationSummary = (jobs: AutomationJobState[]) => {
  if (!AUTOMATION_ENABLED) {
    return 'Automation workers are disabled';
  }

  if (!AUTOMATION_RUNTIME_ENABLED) {
    return 'Automation workers are disabled (missing DISCORD_TOKEN or DISCORD_BOT_TOKEN)';
  }

  const activeJobs = jobs.filter((job) => job.enabled);
  if (activeJobs.length === 0) {
    return 'Automation workers have no enabled jobs';
  }

  const unhealthy = activeJobs.find(
    (job) => job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) > Date.parse(job.lastSuccessAt)),
  );
  if (unhealthy) {
    return `Automation job ${unhealthy.name} needs attention`;
  }

  return 'Automation workers are healthy';
};

export const isAutomationHealthy = (jobs: AutomationJobState[]) => {
  if (!AUTOMATION_ENABLED || !AUTOMATION_RUNTIME_ENABLED) {
    return false;
  }

  const activeJobs = jobs.filter((job) => job.enabled);
  if (activeJobs.length === 0) {
    return false;
  }

  return !activeJobs.some((job) => {
    if (AUTOMATION_PERSISTENT_WORKERS && !job.running) {
      return true;
    }

    if (!job.lastErrorAt) {
      return false;
    }

    if (!job.lastSuccessAt) {
      return true;
    }

    return Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt);
  });
};
