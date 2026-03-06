export type AutomationJobName = 'news-analysis' | 'youtube-monitor';

export type AutomationJobState = {
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

export type JobConfig = {
  name: AutomationJobName;
  enabled: boolean;
  schedule: string;
  scriptPath: string;
};
