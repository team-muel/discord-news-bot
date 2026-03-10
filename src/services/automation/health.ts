import {
  AUTOMATION_ENABLED,
  AUTOMATION_RUNTIME_ENABLED,
} from './config';
import type { AutomationJobState } from './types';

export const buildAutomationSummary = (jobs: AutomationJobState[]) => {
  if (!AUTOMATION_ENABLED) {
    return 'Automation bot is disabled';
  }

  if (!AUTOMATION_RUNTIME_ENABLED) {
    return 'Automation bot is disabled (missing DISCORD_TOKEN/DISCORD_BOT_TOKEN)';
  }

  const activeJobs = jobs.filter((job) => job.enabled);
  if (activeJobs.length === 0) {
    return 'Automation bot has no enabled jobs';
  }

  const unhealthy = activeJobs.find(
    (job) => job.lastErrorAt && (!job.lastSuccessAt || Date.parse(job.lastErrorAt) > Date.parse(job.lastSuccessAt)),
  );
  if (unhealthy) {
    return `Automation job ${unhealthy.name} needs attention`;
  }

  return 'Automation bot is healthy';
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
    if (!job.lastErrorAt) {
      return false;
    }

    if (!job.lastSuccessAt) {
      return true;
    }

    return Date.parse(job.lastErrorAt) >= Date.parse(job.lastSuccessAt);
  });
};
