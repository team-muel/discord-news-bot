export type AutomationJobName = 'youtube-monitor' | 'news-monitor';

// ── Platform-agnostic channel sink (ADR-007) ──
// Services use this instead of discord.js Client directly.
// The Discord surface layer provides the concrete implementation.

export type ChannelSinkEmbed = {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
};

export type ChannelSinkSendOptions = {
  content?: string;
  embeds?: ChannelSinkEmbed[];
  /** If set, create a thread on the sent message. */
  thread?: { name: string; autoArchiveDuration?: number; reason?: string };
};

export type ChannelSink = {
  /** Send a message (text and/or embed) to a channel. Returns true if sent. */
  sendToChannel: (channelId: string, options: ChannelSinkSendOptions) => Promise<boolean>;
};

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
  runtime: string;
  jobs: Record<AutomationJobName, AutomationJobState>;
};

export type JobConfig = {
  name: AutomationJobName;
  enabled: boolean;
  schedule: string;
  scriptPath: string;
};
