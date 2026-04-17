import 'dotenv/config';
/* eslint-disable no-console */

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  ensureOpenJarvisMemorySyncSchedule,
  getOpenJarvisMemorySyncScheduleStatus,
  startOpenJarvisSchedulerDaemon,
} from '../src/services/openjarvis/openjarvisMemorySyncStatusService';

const toOptionalString = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const run = async (): Promise<void> => {
  const statusOnly = parseBool(parseArg('status', 'false'), false);
  const ensureMemorySyncSchedule = parseBool(parseArg('ensureMemorySyncSchedule', 'false'), false);
  const dryRun = parseBool(parseArg('dryRun', 'false'), false);
  const pollIntervalSeconds = Number(parseArg('pollIntervalSeconds', process.env.OPENJARVIS_SCHEDULER_POLL_INTERVAL || '60')) || 60;
  const scheduleType = toOptionalString(parseArg('scheduleType', process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_TYPE || ''));
  const scheduleValue = toOptionalString(parseArg('scheduleValue', process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_VALUE || ''));
  const prompt = toOptionalString(parseArg('prompt', process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_PROMPT || ''));
  const agent = toOptionalString(parseArg('agent', process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_AGENT || ''));
  const tools = toOptionalString(parseArg('tools', process.env.OPENJARVIS_MEMORY_SYNC_SCHEDULE_TOOLS || ''));

  if (statusOnly) {
    const status = await getOpenJarvisMemorySyncScheduleStatus({
      prompt,
      scheduleType,
      scheduleValue,
      agent,
      tools,
    });
    console.log(JSON.stringify({ ok: true, status }, null, 2));
    return;
  }

  const ensureResult = ensureMemorySyncSchedule
    ? await ensureOpenJarvisMemorySyncSchedule({
      dryRun,
      prompt,
      scheduleType,
      scheduleValue,
      agent,
      tools,
    })
    : null;

  const startResult = await startOpenJarvisSchedulerDaemon({
    dryRun,
    pollIntervalSeconds,
  });

  const ok = startResult.ok && (!ensureResult || ensureResult.ok);
  console.log(JSON.stringify({
    ok,
    ensureMemorySyncSchedule: ensureResult,
    scheduler: startResult,
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
};

void run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});