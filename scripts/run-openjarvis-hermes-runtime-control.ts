import 'dotenv/config';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  autoQueueOpenJarvisHermesRuntimeObjectives,
  enqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession,
} from '../src/services/openjarvis/openjarvisHermesRuntimeControlService.ts';

const compact = (value: unknown): string => String(value || '').trim();

const parseNumberOrNull = (value: string): number | null => {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseStringArray = (value: string): string[] => compact(value)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

async function main() {
  const action = compact(parseArg('action', ''));
  const sessionPath = compact(parseArg('sessionPath', '')) || null;
  const sessionId = compact(parseArg('sessionId', '')) || null;
  const vaultPath = compact(parseArg('vaultPath', '')) || null;
  const contextProfile = compact(parseArg('contextProfile', '')) || null;
  const capacityTarget = parseNumberOrNull(parseArg('capacityTarget', ''));
  const gcpCapacityRecoveryRequested = parseBool(parseArg('gcpCapacityRecovery', 'false'), false);
  const runtimeLane = compact(parseArg('runtimeLane', '')) || null;

  if (action === 'queue-objective') {
    const result = await enqueueOpenJarvisHermesRuntimeObjectives({
      objective: compact(parseArg('objective', '')) || null,
      objectives: parseStringArray(parseArg('objectives', '')),
      replaceExisting: parseBool(parseArg('replaceExisting', 'false'), false),
      sessionPath,
      sessionId,
      vaultPath,
      capacityTarget,
      gcpCapacityRecoveryRequested,
      runtimeLane,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (action === 'auto-queue-next-objective') {
    const result = await autoQueueOpenJarvisHermesRuntimeObjectives({
      sessionPath,
      sessionId,
      vaultPath,
      capacityTarget,
      gcpCapacityRecoveryRequested,
      runtimeLane,
      dryRun: parseBool(parseArg('dryRun', 'false'), false),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (action === 'chat-launch') {
    const result = await launchOpenJarvisHermesChatSession({
      objective: compact(parseArg('objective', '')) || null,
      prompt: compact(parseArg('prompt', '')) || null,
      chatMode: compact(parseArg('chatMode', '')) || null,
      contextProfile,
      addFilePaths: parseStringArray(parseArg('addFilePaths', '')),
      maximize: parseBool(parseArg('maximize', 'true'), true),
      newWindow: parseBool(parseArg('newWindow', 'false'), false),
      reuseWindow: parseBool(parseArg('reuseWindow', 'true'), true),
      dryRun: parseBool(parseArg('dryRun', 'false'), false),
      sessionPath,
      vaultPath,
      capacityTarget,
      gcpCapacityRecoveryRequested,
      runtimeLane,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    error: 'Unsupported --action. Use auto-queue-next-objective, queue-objective, or chat-launch.',
  }, null, 2));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});