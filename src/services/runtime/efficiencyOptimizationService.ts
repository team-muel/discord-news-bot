import { getAgentTelemetryQueueSnapshot } from '../agent/agentTelemetryQueue';
import { getMemoryJobQueueStats, getMemoryJobRunnerStats } from '../memory/memoryJobRunner';
import { getPlatformLightweightingReport } from './platformLightweightingService';
import { getRuntimeSchedulerPolicySnapshot } from './runtimeSchedulerPolicyService';
import {
  ensureSupabaseMaintenanceCronJobs,
  evaluateHypoPgIndexes,
  getHypoPgCandidates,
  getSupabaseExtensionOpsSnapshot,
} from '../infra/supabaseExtensionOpsService';
import { getErrorMessage } from '../../utils/errorMessage';

export type EfficiencyMode = 'idle-improvement' | 'balanced-flow' | 'queue-drain';

export type EfficiencyRecommendation = {
  id: string;
  title: string;
  reason: string;
  action: 'observe' | 'shift-to-db' | 'drain-queue' | 'run-diagnostics';
  ready: boolean;
};

export type EfficiencySnapshot = {
  generatedAt: string;
  mode: EfficiencyMode;
  efficiencyScore: number;
  pressure: {
    telemetryQueued: number;
    telemetryInflight: number;
    memoryQueued: number;
    memoryRunning: number;
  };
  pipeline: {
    appOwned: number;
    dbOwned: number;
    lightweightingReady: number;
    lightweightingBlocked: number;
  };
  recommendations: EfficiencyRecommendation[];
};

export type EfficiencyQuickWinActionResult = {
  id: string;
  ok: boolean;
  dryRun: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export type EfficiencyQuickWinResult = {
  generatedAt: string;
  dryRun: boolean;
  mode: EfficiencyMode;
  actions: EfficiencyQuickWinActionResult[];
};

const toEfficiencyScore = (params: {
  telemetryQueued: number;
  telemetryInflight: number;
  memoryQueued: number;
  memoryRunning: number;
  dbOwned: number;
  blocked: number;
}): number => {
  const queuePenalty = Math.min(60, params.telemetryQueued * 2 + params.memoryQueued * 1.5);
  const inflightBoost = Math.min(20, params.telemetryInflight * 3 + params.memoryRunning * 2);
  const dbBoost = Math.min(15, params.dbOwned * 6);
  const blockedPenalty = Math.min(20, params.blocked * 4);
  const raw = 70 + inflightBoost + dbBoost - queuePenalty - blockedPenalty;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

const deriveMode = (params: {
  telemetryQueued: number;
  memoryQueued: number;
  telemetryInflight: number;
  memoryRunning: number;
}): EfficiencyMode => {
  const backlog = params.telemetryQueued + params.memoryQueued;
  const active = params.telemetryInflight + params.memoryRunning;

  if (backlog >= 20) {
    return 'queue-drain';
  }
  if (backlog === 0 && active <= 1) {
    return 'idle-improvement';
  }
  return 'balanced-flow';
};

export const getEfficiencySnapshot = async (): Promise<EfficiencySnapshot> => {
  const telemetry = getAgentTelemetryQueueSnapshot();
  const memoryRunner = getMemoryJobRunnerStats();
  const memoryQueue = await getMemoryJobQueueStats();
  const scheduler = await getRuntimeSchedulerPolicySnapshot();
  const lightweighting = await getPlatformLightweightingReport();

  const pressure = {
    telemetryQueued: telemetry.queued,
    telemetryInflight: telemetry.inflight,
    memoryQueued: memoryQueue.queued,
    memoryRunning: memoryQueue.running,
  };

  const mode = deriveMode(pressure);
  const efficiencyScore = toEfficiencyScore({
    ...pressure,
    dbOwned: scheduler.summary.dbOwned,
    blocked: lightweighting.summary.blocked,
  });

  const recommendations: EfficiencyRecommendation[] = [
    {
      id: 'rec-queue-drain',
      title: 'Prioritize queue drain over new background work',
      reason: `telemetryQueued=${pressure.telemetryQueued}, memoryQueued=${pressure.memoryQueued}`,
      action: 'drain-queue',
      ready: mode === 'queue-drain',
    },
    {
      id: 'rec-shift-maintenance',
      title: 'Shift recurring maintenance to db scheduler',
      reason: `dbOwned=${scheduler.summary.dbOwned}, cronJobs=${scheduler.supabase.cronJobCount}`,
      action: 'shift-to-db',
      ready: scheduler.supabase.configured,
    },
    {
      id: 'rec-run-diagnostics',
      title: 'Run query bottleneck diagnostics with hypopg candidates',
      reason: `blockedItems=${lightweighting.summary.blocked}`,
      action: 'run-diagnostics',
      ready: scheduler.supabase.configured,
    },
    {
      id: 'rec-observe',
      title: 'Keep mode stable and observe throughput/latency drift',
      reason: `runnerEnabled=${String(memoryRunner.enabled)} mode=${mode}`,
      action: 'observe',
      ready: true,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode,
    efficiencyScore,
    pressure,
    pipeline: {
      appOwned: scheduler.summary.appOwned,
      dbOwned: scheduler.summary.dbOwned,
      lightweightingReady: lightweighting.summary.ready,
      lightweightingBlocked: lightweighting.summary.blocked,
    },
    recommendations,
  };
};

export const runEfficiencyQuickWins = async (params?: {
  dryRun?: boolean;
  llmRetentionDays?: number;
  evaluateHypopgTop?: number;
}): Promise<EfficiencyQuickWinResult> => {
  const dryRun = params?.dryRun !== false;
  const llmRetentionDays = Math.max(1, Math.min(365, Math.trunc(Number(params?.llmRetentionDays || 30))));
  const evaluateHypopgTop = Math.max(1, Math.min(10, Math.trunc(Number(params?.evaluateHypopgTop || 2))));

  const snapshot = await getEfficiencySnapshot();
  const actions: EfficiencyQuickWinActionResult[] = [];

  let extensionSnapshot;
  try {
    extensionSnapshot = await getSupabaseExtensionOpsSnapshot({ includeTopQueries: true, topLimit: 10 });
  } catch (error) {
    const message = getErrorMessage(error);
    actions.push({
      id: 'supabase-unavailable',
      ok: false,
      dryRun,
      message: `supabase extension snapshot unavailable: ${message}`,
    });
    return {
      generatedAt: new Date().toISOString(),
      dryRun,
      mode: snapshot.mode,
      actions,
    };
  }

  const installed = new Set(extensionSnapshot.extensions.filter((item) => item.installed).map((item) => item.extensionName));

  if (!installed.has('pg_cron')) {
    actions.push({
      id: 'ensure-cron-maintenance',
      ok: false,
      dryRun,
      message: 'pg_cron is not installed',
    });
  } else if (dryRun) {
    actions.push({
      id: 'ensure-cron-maintenance',
      ok: true,
      dryRun: true,
      message: `would ensure daily maintenance cron jobs (retentionDays=${llmRetentionDays})`,
    });
  } else {
    const installedJobs = await ensureSupabaseMaintenanceCronJobs({ llmRetentionDays });
    actions.push({
      id: 'ensure-cron-maintenance',
      ok: true,
      dryRun: false,
      message: 'maintenance cron jobs ensured',
      details: {
        installedJobs,
      },
    });
  }

  const canRunHypopg = installed.has('hypopg') && installed.has('pg_stat_statements');
  if (!canRunHypopg) {
    actions.push({
      id: 'evaluate-hypopg-candidates',
      ok: false,
      dryRun,
      message: 'hypopg and pg_stat_statements are both required',
    });
  } else {
    const candidates = await getHypoPgCandidates();
    const selectedDdls = candidates.slice(0, evaluateHypopgTop).map((item) => item.ddl);
    if (dryRun) {
      actions.push({
        id: 'evaluate-hypopg-candidates',
        ok: true,
        dryRun: true,
        message: `would evaluate ${selectedDdls.length} hypothetical indexes`,
        details: {
          selectedDdls,
        },
      });
    } else {
      const evaluations = await evaluateHypoPgIndexes(selectedDdls);
      actions.push({
        id: 'evaluate-hypopg-candidates',
        ok: true,
        dryRun: false,
        message: `evaluated ${evaluations.length} hypothetical indexes`,
        details: {
          evaluations,
        },
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun,
    mode: snapshot.mode,
    actions,
  };
};