import type { Client } from 'discord.js';
import {
  getNewsSentimentMonitorSnapshot,
  isNewsSentimentMonitorEnabled,
  startNewsSentimentMonitor,
  stopNewsSentimentMonitor,
  triggerNewsSentimentMonitor,
} from '../newsSentimentMonitor';
import {
  getYouTubeSubscriptionsMonitorSnapshot,
  startYouTubeSubscriptionsMonitor,
  stopYouTubeSubscriptionsMonitor,
  triggerYouTubeSubscriptionsMonitor,
} from '../youtubeSubscriptionsMonitor';
import type { AutomationJobName } from './types';

export type AutomationModuleSnapshot = {
  running: boolean;
  runCount: number;
  successCount: number;
  failCount: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastDurationMs: number | null;
};

export type AutomationModuleRunResult = {
  ok: boolean;
  message: string;
};

export type AutomationModule = {
  name: AutomationJobName;
  isEnabled: () => boolean;
  start: (client: Client) => void;
  stop: () => void;
  trigger: (client: Client, guildId?: string) => Promise<AutomationModuleRunResult>;
  getSnapshot: () => AutomationModuleSnapshot;
};

const modules: Record<AutomationJobName, AutomationModule> = {
  'youtube-monitor': {
    name: 'youtube-monitor',
    isEnabled: () => true,
    start: (client: Client) => {
      startYouTubeSubscriptionsMonitor(client);
    },
    stop: () => {
      stopYouTubeSubscriptionsMonitor();
    },
    trigger: (client: Client, guildId?: string) => triggerYouTubeSubscriptionsMonitor(client, guildId),
    getSnapshot: () => {
      const snapshot = getYouTubeSubscriptionsMonitorSnapshot();
      return {
        running: Boolean(snapshot.running),
        runCount: snapshot.runCount,
        successCount: snapshot.successCount,
        failCount: snapshot.failCount,
        lastRunAt: snapshot.lastRunAt,
        lastSuccessAt: snapshot.lastSuccessAt,
        lastErrorAt: snapshot.lastErrorAt,
        lastError: snapshot.lastError,
        lastDurationMs: snapshot.lastDurationMs,
      };
    },
  },
  'news-monitor': {
    name: 'news-monitor',
    isEnabled: () => isNewsSentimentMonitorEnabled(),
    start: (client: Client) => {
      startNewsSentimentMonitor(client);
    },
    stop: () => {
      stopNewsSentimentMonitor();
    },
    trigger: (client: Client, guildId?: string) => triggerNewsSentimentMonitor(client, guildId),
    getSnapshot: () => {
      const snapshot = getNewsSentimentMonitorSnapshot();
      return {
        running: Boolean(snapshot.running),
        runCount: snapshot.runCount,
        successCount: snapshot.successCount,
        failCount: snapshot.failCount,
        lastRunAt: snapshot.lastRunAt,
        lastSuccessAt: snapshot.lastSuccessAt,
        lastErrorAt: snapshot.lastErrorAt,
        lastError: snapshot.lastError,
        lastDurationMs: snapshot.lastDurationMs,
      };
    },
  },
};

export const getAutomationModules = (): AutomationModule[] => Object.values(modules);

export const getAutomationModule = (jobName: AutomationJobName): AutomationModule => modules[jobName];
