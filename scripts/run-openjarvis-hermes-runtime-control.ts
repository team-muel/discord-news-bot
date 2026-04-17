import 'dotenv/config';

import { parseArg, parseBool } from './lib/cliArgs.mjs';
import {
  autoQueueOpenJarvisHermesRuntimeObjectives,
  enqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession,
  launchOpenJarvisHermesSwarmWave,
  type HermesRuntimeSwarmShardSpec,
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

const parseJsonArray = <T>(value: string): T[] | null => {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed as T[] : null;
  } catch {
    return null;
  }
};

const buildRequestedSwarmShards = (params: {
  waveObjective: string | null;
  includeDistiller: boolean;
  shardsJson: HermesRuntimeSwarmShardSpec[] | null;
  scoutObjective: string | null;
  scoutAddFilePaths: string[];
  executorObjective: string | null;
  executorWorktreePath: string | null;
  executorAddFilePaths: string[];
  executorArtifactBudget: string[];
}): HermesRuntimeSwarmShardSpec[] | null => {
  if (Array.isArray(params.shardsJson) && params.shardsJson.length > 0) {
    return params.shardsJson;
  }

  const hasDirectShardOverrides = Boolean(
    params.scoutObjective
    || params.scoutAddFilePaths.length > 0
    || params.executorObjective
    || params.executorWorktreePath
    || params.executorAddFilePaths.length > 0
    || params.executorArtifactBudget.length > 0,
  );

  if (!hasDirectShardOverrides) {
    return null;
  }

  const waveObjective = params.waveObjective || params.executorObjective || params.scoutObjective;
  if (!waveObjective) {
    return null;
  }

  const shards: HermesRuntimeSwarmShardSpec[] = [
    {
      shardId: 'route-scout',
      objective: params.scoutObjective || `Map route, blockers, and evidence for ${waveObjective}`,
      contextProfile: 'scout',
      addFilePaths: params.scoutAddFilePaths,
      completionDefinition: 'Route, blocker, and evidence summary is ready for the executor without reopening broad archaeology.',
      recallCondition: 'Recall the coordinator if route ambiguity remains or a shared contract is missing.',
      acceptanceOwner: 'coordinator-gpt',
    },
    {
      shardId: 'bounded-executor',
      objective: params.executorObjective || waveObjective,
      contextProfile: 'executor',
      worktreePath: params.executorWorktreePath,
      addFilePaths: params.executorAddFilePaths,
      artifactBudget: params.executorArtifactBudget,
      completionDefinition: 'Bounded implementation or validation slice is complete with typecheck and targeted verification.',
      recallCondition: 'Recall the coordinator on cross-shard architecture changes, merge conflicts, or policy boundaries.',
      acceptanceOwner: 'coordinator-gpt',
      dependsOn: ['route-scout'],
    },
  ];

  if (params.includeDistiller) {
    shards.push({
      shardId: 'closeout-distiller',
      objective: `Distill accepted outcomes for ${waveObjective}`,
      contextProfile: 'distiller',
      completionDefinition: 'Decision distillate, changelog/wiki delta, and bounded next action are ready after acceptance.',
      recallCondition: 'Start only after the executor reaches an accepted checkpoint.',
      acceptanceOwner: 'coordinator-gpt',
      dependsOn: ['bounded-executor'],
    });
  }

  return shards;
};

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
      dryRun: parseBool(parseArg('dryRun', 'false'), false),
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
      allowedRoots: parseStringArray(parseArg('allowedRoots', '')),
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

  if (action === 'swarm-launch') {
    const includeDistiller = parseBool(parseArg('includeDistiller', 'false'), false);
    const waveObjective = compact(parseArg('waveObjective', '')) || null;
    const shardsJson = parseJsonArray<HermesRuntimeSwarmShardSpec>(parseArg('shardsJson', ''));
    const result = await launchOpenJarvisHermesSwarmWave({
      waveObjective,
      shards: buildRequestedSwarmShards({
        waveObjective,
        includeDistiller,
        shardsJson,
        scoutObjective: compact(parseArg('scoutObjective', '')) || null,
        scoutAddFilePaths: parseStringArray(parseArg('scoutAddFilePaths', '')),
        executorObjective: compact(parseArg('executorObjective', '')) || null,
        executorWorktreePath: compact(parseArg('executorWorktreePath', '')) || null,
        executorAddFilePaths: parseStringArray(parseArg('executorAddFilePaths', '')),
        executorArtifactBudget: parseStringArray(parseArg('executorArtifactBudget', '')),
      }),
      boardPath: compact(parseArg('boardPath', '')) || null,
      includeDistiller,
      maximize: parseBool(parseArg('maximize', 'true'), true),
      newWindow: parseBool(parseArg('newWindow', 'true'), true),
      reuseWindow: parseBool(parseArg('reuseWindow', 'false'), false),
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
    error: 'Unsupported --action. Use auto-queue-next-objective, queue-objective, chat-launch, or swarm-launch.',
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