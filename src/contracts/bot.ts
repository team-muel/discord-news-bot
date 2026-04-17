export type BotStatusGrade = 'healthy' | 'degraded' | 'offline';

export type BotRuntimeStatus = {
  started: boolean;
  ready: boolean;
  wsStatus: number;
  tokenPresent: boolean;
  reconnectQueued: boolean;
  reconnectAttempts: number;
  lastReadyAt: string | null;
  lastLoginAttemptAt: string | null;
  lastLoginErrorAt: string | null;
  lastLoginError: string | null;
  lastDisconnectAt: string | null;
  lastDisconnectCode: number | null;
  lastDisconnectReason: string | null;
  lastInvalidatedAt: string | null;
  lastAlertAt: string | null;
  lastAlertReason: string | null;
  lastRecoveryAt: string | null;
  lastManualReconnectAt: string | null;
  manualReconnectCooldownRemainingSec: number;
  loginRateLimitUntil: string | null;
  loginRateLimitRemainingSec: number;
  loginRateLimitReason: string | null;
  dynamicWorkerRestore: {
    enabled: boolean;
    attemptedAt: string | null;
    approvedCount: number;
    restoredCount: number;
    failedCount: number;
    lastError: string | null;
  };
  workerApprovalStore?: {
    configuredMode: 'auto' | 'supabase' | 'file';
    activeBackend: 'supabase' | 'file' | 'unknown';
    supabaseConfigured: boolean;
    supabaseDisabled: boolean;
    dbTable: string;
    filePath: string;
    loaded: boolean;
    totalApprovals: number;
    pendingApprovals: number;
    approvedApprovals: number;
    rejectedApprovals: number;
    lastError: string | null;
  };
};

export type AutomationJobName = 'youtube-monitor' | 'news-monitor';

export type AutomationJobStatus = {
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

export type AutomationRuntimeStatus = {
  started: boolean;
  healthy: boolean;
  summary: string;
  startedAt: string | null;
  runtime: string;
  jobs: Record<AutomationJobName, AutomationJobStatus>;
};

export type BotStatusApiResponse = {
  healthy: boolean;
  statusGrade?: BotStatusGrade;
  statusSummary?: string;
  recommendations?: string[];
  nextCheckInSec?: number;
  outageDurationMs: number;
  bot?: BotRuntimeStatus;
  automation?: AutomationRuntimeStatus;
  actionRunnerDiagnostics?: {
    lastUpdatedAt: string | null;
    totalRuns: number;
    handledRuns: number;
    successRuns: number;
    failedRuns: number;
    externalUnavailableRuns: number;
    failureTotals: {
      totalFailures: number;
      missingAction: number;
      policyBlocked: number;
      governanceUnavailable: number;
      finopsBlocked: number;
      externalFailures: number;
      unknownFailures: number;
    };
    trend: {
      windowSize: number;
      comparedRuns: number;
      failureRateDelta: number | null;
      missingActionDelta: number | null;
      policyBlockedDelta: number | null;
      direction: 'up' | 'down' | 'flat' | 'unknown';
    };
    topFailureCodes: Array<{
      code: string;
      count: number;
      share: number;
    }>;
    recentRuns: Array<{
      at: string;
      totalFailures: number;
      failed: boolean;
      missingAction: number;
      policyBlocked: number;
    }>;
    lastRun: {
      handled: boolean;
      hasSuccess: boolean;
      externalUnavailable: boolean;
      diagnostics: {
        totalFailures: number;
        missingAction: number;
        policyBlocked: number;
        governanceUnavailable: number;
        finopsBlocked: number;
        externalFailures: number;
        unknownFailures: number;
      };
    } | null;
  };
  workerProposalMetrics?: {
    startedAt: string;
    lastUpdatedAt: string | null;
    proposalClicks: number;
    generationRequested: number;
    generationSucceeded: number;
    generationFailed: number;
    approvalsApproved: number;
    approvalsRejected: number;
    approvalsRefactorRequested: number;
    generationSuccessRate: number;
    approvalDecisionRate: number;
    approvalPassRate: number;
    generationFailureReasonCounts: Record<string, number>;
    topGenerationFailureReasons: Array<{
      reason: string;
      count: number;
      share: number;
    }>;
    history: Array<{
      at: string;
      proposalClicks: number;
      generationRequested: number;
      generationSucceeded: number;
      generationFailed: number;
      approvalsApproved: number;
      approvalsRejected: number;
      approvalsRefactorRequested: number;
    }>;
  };
  agents?: {
    totalSessions: number;
    runningSessions: number;
    completedSessions: number;
    failedSessions: number;
    cancelledSessions: number;
    latestSessionAt: string | null;
    skills?: Array<{
      id: string;
      title: string;
      description: string;
    }>;
  };
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  botStatusGrade: BotStatusGrade;
  uptimeSec: number;
  diagnosticsVisibility?: 'public' | 'admin';
  bot: BotRuntimeStatus;
  automation: AutomationRuntimeStatus;
  n8n?: {
    adapterAvailable: boolean;
    delegationEnabled: boolean;
    delegationFirst: boolean;
    cacheAvailable: boolean | null;
    configuredTasks: number;
    totalTasks: number;
  };
  obsidian?: {
    vaultPath: string;
    vaultReady: boolean;
    fileCount: number;
  };
  schedulerPolicySummary?: {
    total: number;
    appOwned: number;
    dbOwned: number;
    enabled: number;
    running: number;
  };
  migrations?: {
    ok: boolean;
    trackingTableExists: boolean;
    appliedCount: number;
    pendingCount: number;
    pendingNames: string[];
  } | null;
  runtimeBootstrap?: {
    serverStarted: boolean;
    discordReadyStarted: boolean;
    sharedLoopsStarted: boolean;
    sharedLoopsSource: 'server-process' | 'discord-ready' | null;
    pgCron: {
      status: 'not-required' | 'pending' | 'ready' | 'partial' | 'failed';
      startedAt: string | null;
      completedAt: string | null;
      lastError?: string | null;
      deferredTaskCount: number;
      replacedLoops?: string[];
      summary: {
        totalJobs: number;
        created: number;
        existing: number;
        error: number;
        confirmedLoopCount: number;
      } | null;
    };
  };
  startup?: {
    summary: {
      total: number;
      idle: number;
      pending: number;
      ok: number;
      warn: number;
      skipped: number;
    };
    tasks?: Array<{
      id: string;
      label: string;
      status: 'idle' | 'pending' | 'ok' | 'warn' | 'skipped';
      updatedAt: string | null;
      message: string | null;
    }>;
  };
};
