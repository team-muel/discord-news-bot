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
};

export type AutomationJobName = 'news-analysis' | 'youtube-monitor';

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
  pythonCommand: string;
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
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  botStatusGrade: BotStatusGrade;
  uptimeSec: number;
  bot: BotRuntimeStatus;
  automation: AutomationRuntimeStatus;
};
