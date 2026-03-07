import { parseBooleanEnv, parseIntegerEnv } from '../../utils/env';
import type { JobConfig } from './types';

export const AUTOMATION_ENABLED = parseBooleanEnv(
  process.env.START_AUTOMATION_BOT ?? process.env.ENABLE_SECONDARY_BOT,
  true,
);
export const AUTOMATION_DISCORD_TOKEN = process.env.SECONDARY_DISCORD_TOKEN || process.env.AUTOMATION_DISCORD_TOKEN || '';
export const AUTOMATION_RUNTIME_ENABLED = AUTOMATION_ENABLED && Boolean(AUTOMATION_DISCORD_TOKEN);

export const PYTHON_COMMAND = process.env.AUTOMATION_PYTHON_COMMAND || 'python';
export const AUTOMATION_RUN_ON_START = parseBooleanEnv(process.env.AUTOMATION_RUN_ON_START, true);
export const AUTOMATION_PERSISTENT_WORKERS = parseBooleanEnv(process.env.AUTOMATION_PERSISTENT_WORKERS, true);
export const AUTOMATION_RESTART_DELAY_MS = parseIntegerEnv(process.env.AUTOMATION_RESTART_DELAY_MS, 5000);
export const AUTOMATION_NEWS_INTERVAL_MIN = parseIntegerEnv(process.env.AUTOMATION_NEWS_INTERVAL_MIN, 30);
export const AUTOMATION_YOUTUBE_INTERVAL_MIN = parseIntegerEnv(process.env.AUTOMATION_YOUTUBE_INTERVAL_MIN, 10);

export const JOB_CONFIGS: JobConfig[] = [
  {
    name: 'news-analysis',
    enabled: parseBooleanEnv(process.env.AUTOMATION_NEWS_ENABLED, true),
    schedule: process.env.AUTOMATION_NEWS_CRON || '*/30 * * * *',
    scriptPath: process.env.AUTOMATION_NEWS_SCRIPT || 'bot_task.py',
  },
  {
    name: 'youtube-monitor',
    enabled: parseBooleanEnv(process.env.AUTOMATION_YOUTUBE_ENABLED, true),
    schedule: process.env.AUTOMATION_YOUTUBE_CRON || '*/10 * * * *',
    scriptPath: process.env.AUTOMATION_YOUTUBE_SCRIPT || 'youtube_monitor.py',
  },
];
