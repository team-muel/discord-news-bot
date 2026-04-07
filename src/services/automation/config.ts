import { parseBooleanEnv, parseIntegerEnv, parseStringEnv } from '../../utils/env';
import type { JobConfig } from './types';

export const AUTOMATION_ENABLED = parseBooleanEnv(
  process.env.START_AUTOMATION_JOBS ?? process.env.START_AUTOMATION_BOT,
  true,
);
export const PRIMARY_DISCORD_TOKEN = parseStringEnv(process.env.DISCORD_TOKEN ?? process.env.DISCORD_BOT_TOKEN, '');
export const AUTOMATION_RUNTIME_ENABLED = AUTOMATION_ENABLED && Boolean(PRIMARY_DISCORD_TOKEN);

export const AUTOMATION_YOUTUBE_ENABLED = parseBooleanEnv(process.env.AUTOMATION_YOUTUBE_ENABLED, true);
export const AUTOMATION_YOUTUBE_INTERVAL_MIN = parseIntegerEnv(process.env.AUTOMATION_YOUTUBE_INTERVAL_MIN, 10);
export const AUTOMATION_NEWS_ENABLED = parseBooleanEnv(process.env.AUTOMATION_NEWS_ENABLED, false);
export const AUTOMATION_NEWS_INTERVAL_MIN = parseIntegerEnv(process.env.AUTOMATION_NEWS_INTERVAL_MIN, 10);

export const JOB_CONFIGS: JobConfig[] = [
  {
    name: 'youtube-monitor',
    enabled: AUTOMATION_YOUTUBE_ENABLED,
    schedule: `every ${AUTOMATION_YOUTUBE_INTERVAL_MIN}m`,
    scriptPath: 'node:youtubeSubscriptionsMonitor',
  },
  {
    name: 'news-monitor',
    enabled: AUTOMATION_NEWS_ENABLED,
    schedule: `every ${AUTOMATION_NEWS_INTERVAL_MIN}m`,
    scriptPath: 'node:newsSentimentMonitor',
  },
];
