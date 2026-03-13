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
  bot: BotRuntimeStatus;
  automation: AutomationRuntimeStatus;
};
