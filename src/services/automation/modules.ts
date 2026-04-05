import {
  getNewsSentimentMonitorSnapshot,
  isNewsSentimentMonitorEnabled,
  startNewsSentimentMonitor,
  stopNewsSentimentMonitor,
  triggerNewsSentimentMonitor,
} from '../news/newsSentimentMonitor';
import {
  getYouTubeSubscriptionsMonitorSnapshot,
  startYouTubeSubscriptionsMonitor,
  stopYouTubeSubscriptionsMonitor,
  triggerYouTubeSubscriptionsMonitor,
} from '../news/youtubeSubscriptionsMonitor';
import type { AutomationJobName, ChannelSink } from './types';

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
  start: (sink: ChannelSink) => void;
  stop: () => void;
  trigger: (sink: ChannelSink, guildId?: string) => Promise<AutomationModuleRunResult>;
  getSnapshot: () => AutomationModuleSnapshot;
};

const modules: Record<AutomationJobName, AutomationModule> = {
  'youtube-monitor': {
    name: 'youtube-monitor',
    isEnabled: () => true,
    start: (sink: ChannelSink) => {
      startYouTubeSubscriptionsMonitor(sink);
    },
    stop: () => {
      stopYouTubeSubscriptionsMonitor();
    },
    trigger: (sink: ChannelSink, guildId?: string) => triggerYouTubeSubscriptionsMonitor(sink, guildId),
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
    start: (sink: ChannelSink) => {
      startNewsSentimentMonitor(sink);
    },
    stop: () => {
      stopNewsSentimentMonitor();
    },
    trigger: (sink: ChannelSink, guildId?: string) => triggerNewsSentimentMonitor(sink, guildId),
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
