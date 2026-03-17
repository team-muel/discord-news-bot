import { getAutomationRuntimeSnapshot, isAutomationEnabled } from './automationBot';
import { LOGIN_SESSION_CLEANUP_INTERVAL_MS, LOGIN_SESSION_CLEANUP_OWNER } from '../discord/auth';
import { getAgentOpsSnapshot } from './agentOpsService';
import { getMemoryJobRunnerStats } from './memoryJobRunner';
import { getObsidianLoreSyncLoopStats } from './obsidianLoreSyncService';
import { getRetrievalEvalLoopStats } from './retrievalEvalLoopService';
import { listSupabaseCronJobs } from './supabaseExtensionOpsService';

type SchedulerOwner = 'app' | 'db';

export type RuntimeSchedulerPolicyItem = {
  id: string;
  title: string;
  owner: SchedulerOwner;
  startup: 'discord-ready' | 'service-init' | 'database';
  enabled: boolean;
  running: boolean;
  schedule: string;
  source: string[];
};

export type RuntimeSchedulerPolicySnapshot = {
  generatedAt: string;
  summary: {
    total: number;
    appOwned: number;
    dbOwned: number;
    enabled: number;
    running: number;
  };
  supabase: {
    configured: boolean;
    cronJobCount: number;
  };
  items: RuntimeSchedulerPolicyItem[];
};

export const getRuntimeSchedulerPolicySnapshot = async (): Promise<RuntimeSchedulerPolicySnapshot> => {
  const automation = getAutomationRuntimeSnapshot();
  const agentOps = getAgentOpsSnapshot();
  const memoryJobs = getMemoryJobRunnerStats();
  const obsidianSync = getObsidianLoreSyncLoopStats();
  const retrievalEval = getRetrievalEvalLoopStats();

  let cronJobCount = 0;
  let supabaseConfigured = true;
  try {
    const cronJobs = await listSupabaseCronJobs();
    cronJobCount = cronJobs.length;
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)) === 'SUPABASE_NOT_CONFIGURED') {
      supabaseConfigured = false;
    } else {
      throw error;
    }
  }

  const items: RuntimeSchedulerPolicyItem[] = [
    {
      id: 'login-session-cleanup',
      title: 'Discord login-session cleanup',
      owner: LOGIN_SESSION_CLEANUP_OWNER,
      startup: LOGIN_SESSION_CLEANUP_OWNER === 'app' ? 'discord-ready' : 'database',
      enabled: LOGIN_SESSION_CLEANUP_OWNER === 'app' ? true : cronJobCount > 0,
      running: LOGIN_SESSION_CLEANUP_OWNER === 'app' ? true : cronJobCount > 0,
      schedule: LOGIN_SESSION_CLEANUP_OWNER === 'app'
        ? `every ${Math.max(1, Math.round(LOGIN_SESSION_CLEANUP_INTERVAL_MS / 60000))}m`
        : 'daily (pg_cron)',
      source: ['src/discord/auth.ts', 'docs/SUPABASE_SCHEMA.sql', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'automation-modules',
      title: 'Automation monitors (news/youtube)',
      owner: 'app',
      startup: 'discord-ready',
      enabled: isAutomationEnabled(),
      running: Object.values(automation.jobs).some((job) => job.running),
      schedule: Object.values(automation.jobs)
        .map((job) => `${job.name}:${job.schedule || 'n/a'}`)
        .join(', '),
      source: ['src/services/automationBot.ts', 'src/services/automation/config.ts'],
    },
    {
      id: 'agent-daily-learning',
      title: 'Agent daily learning loop',
      owner: 'app',
      startup: 'discord-ready',
      enabled: Boolean(agentOps.dailyLearningEnabled),
      running: Boolean(agentOps.dailyLearningEnabled),
      schedule: `daily@${String(agentOps.dailyLearningHour).padStart(2, '0')}:00`,
      source: ['src/services/agentOpsService.ts', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'got-cutover-autopilot',
      title: 'GoT cutover autopilot loop',
      owner: 'app',
      startup: 'discord-ready',
      enabled: Boolean(agentOps.gotCutoverAutopilotEnabled),
      running: Boolean(agentOps.gotCutoverAutopilotEnabled),
      schedule: `every ${agentOps.gotCutoverAutopilotIntervalMin}m`,
      source: ['src/services/agentOpsService.ts', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'memory-job-runner',
      title: 'Memory job queue poll/recovery',
      owner: 'app',
      startup: 'discord-ready',
      enabled: Boolean(memoryJobs.enabled),
      running: Boolean(memoryJobs.startedAt),
      schedule: `poll=${memoryJobs.pollIntervalMs}ms recovery=${memoryJobs.deadletterRecoveryIntervalMs}ms`,
      source: ['src/services/memoryJobRunner.ts', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'obsidian-sync-loop',
      title: 'Obsidian lore sync loop',
      owner: 'app',
      startup: 'discord-ready',
      enabled: Boolean(obsidianSync.enabled),
      running: Boolean(obsidianSync.running),
      schedule: `every ${obsidianSync.intervalMin}m`,
      source: ['src/services/obsidianLoreSyncService.ts', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'retrieval-eval-loop',
      title: 'Retrieval eval auto loop',
      owner: 'app',
      startup: 'discord-ready',
      enabled: Boolean(retrievalEval.enabled),
      running: Boolean(retrievalEval.running),
      schedule: `every ${retrievalEval.intervalHours}h`,
      source: ['src/services/retrievalEvalLoopService.ts', 'src/discord/runtime/readyWorkloads.ts'],
    },
    {
      id: 'supabase-maintenance-cron',
      title: 'Supabase maintenance cron jobs',
      owner: 'db',
      startup: 'database',
      enabled: cronJobCount > 0,
      running: cronJobCount > 0,
      schedule: cronJobCount > 0 ? `jobs=${cronJobCount}` : 'not installed',
      source: ['docs/SUPABASE_SCHEMA.sql', 'src/services/supabaseExtensionOpsService.ts'],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      appOwned: items.filter((item) => item.owner === 'app').length,
      dbOwned: items.filter((item) => item.owner === 'db').length,
      enabled: items.filter((item) => item.enabled).length,
      running: items.filter((item) => item.running).length,
    },
    supabase: {
      configured: supabaseConfigured,
      cronJobCount,
    },
    items,
  };
};