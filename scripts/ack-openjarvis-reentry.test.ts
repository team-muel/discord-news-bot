import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acknowledgeOpenJarvisReentry,
  buildGoalCycleRestartArgs,
  normalizeReentryCompletionStatus,
} from './ack-openjarvis-reentry.ts';

describe('ack-openjarvis-reentry', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('normalizes completion status into the supported reentry states', () => {
    expect(normalizeReentryCompletionStatus('completed')).toBe('completed');
    expect(normalizeReentryCompletionStatus('blocked')).toBe('blocked');
    expect(normalizeReentryCompletionStatus('error')).toBe('failed');
    expect(normalizeReentryCompletionStatus('')).toBe('completed');
  });

  it('builds a queue-aware restart command that preserves session context', () => {
    const args = buildGoalCycleRestartArgs({
      sessionPath: 'tmp/autonomy/workflow-sessions/openjarvis-1.json',
      runtimeLane: 'operator-personal',
      routeMode: 'operations',
      capacityTarget: 90,
      gcpCapacityRecoveryRequested: true,
      autoRestartOnRelease: true,
      continueUntilCapacity: true,
      restartVisibleTerminal: false,
      autoLaunchQueuedChatContextProfile: 'auto',
    });

    expect(args).toEqual(expect.arrayContaining([
      path.join('scripts', 'run-openjarvis-goal-cycle.mjs'),
      '--resumeFromPackets=true',
      '--continuousLoop=true',
      '--autoSelectQueuedObjective=true',
      '--autoLaunchQueuedChat=true',
      '--runtimeLane=operator-personal',
      '--routeMode=operations',
      '--capacityTarget=90',
      '--gcpCapacityRecovery=true',
      '--autoRestartOnRelease=true',
      '--continueUntilCapacity=true',
      '--autoLaunchQueuedChatContextProfile=auto',
      '--visibleTerminal=false',
    ]));
    expect(args.some((entry) => entry.startsWith('--sessionPath='))).toBe(true);
  });

  it('builds a queue-aware swarm restart command that preserves executor settings', () => {
    const executorWorktreePath = path.resolve('C:/Muel_S/wt/swarm-executor');
    const args = buildGoalCycleRestartArgs({
      sessionPath: 'tmp/autonomy/workflow-sessions/openjarvis-1.json',
      runtimeLane: 'operator-personal',
      routeMode: 'operations',
      capacityTarget: 90,
      autoLaunchQueuedSwarm: true,
      autoLaunchQueuedSwarmIncludeDistiller: true,
      autoLaunchQueuedSwarmExecutorWorktreePath: executorWorktreePath,
      autoLaunchQueuedSwarmExecutorArtifactBudget: ['tests', 'docs'],
    });

    expect(args).toEqual(expect.arrayContaining([
      path.join('scripts', 'run-openjarvis-goal-cycle.mjs'),
      '--resumeFromPackets=true',
      '--continuousLoop=true',
      '--autoSelectQueuedObjective=true',
      '--autoLaunchQueuedSwarm=true',
      '--autoLaunchQueuedSwarmIncludeDistiller=true',
      `--autoLaunchQueuedSwarmExecutorWorktreePath=${executorWorktreePath}`,
      '--autoLaunchQueuedSwarmExecutorArtifactBudget=tests,docs',
      '--runtimeLane=operator-personal',
      '--routeMode=operations',
      '--capacityTarget=90',
      '--visibleTerminal=false',
    ]));
    expect(args).not.toContain('--autoLaunchQueuedChat=true');
  });

  it('records a completed reentry ack and prepares the next supervisor restart in dry-run mode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reentry-ack-'));
    tempDirs.push(root);
    const loopPath = path.join(root, 'latest-interactive-goal-loop.json');
    const manifestPath = path.join(root, 'latest-interactive-goal.json');
    fs.writeFileSync(loopPath, JSON.stringify({
      auto_select_queued_objective: true,
      auto_launch_queued_chat: true,
      stop_reason: 'queued_chat_launched',
      runtime_lane: 'operator-personal',
      last_launch: {
        objective: 'stabilize the next GPT relaunch objective',
        session_id: 'wf-session-1',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-1.json',
        runtime_lane: 'operator-personal',
        awaiting_reentry_acknowledgment: true,
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      auto_select_queued_objective: true,
      auto_launch_queued_chat: true,
      auto_restart_on_release: true,
      route_mode: 'operations',
      runtime_lane: 'operator-personal',
      objective: 'stabilize the next GPT relaunch objective',
      capacity_target: 90,
    }, null, 2), 'utf8');

    const mockReadLatestWorkflowState = vi.fn().mockResolvedValue({
      ok: true,
      source: 'supabase',
      sessionPath: null,
      session: {
        session_id: 'wf-session-1',
        metadata: {
          objective: 'stabilize the next GPT relaunch objective',
          runtime_lane: 'operator-personal',
          route_mode: 'operations',
        },
      },
    });
    const mockAppendWorkflowEvent = vi.fn().mockImplementation(async (params) => ({
      sessionId: params.sessionId,
      sessionPath: params.sessionPath || null,
      event: {
        event_type: params.eventType,
      },
      source: 'supabase',
      remote: { ok: true, reason: 'persisted' },
    }));
    const mockAutoQueueNextObjectives = vi.fn().mockResolvedValue({
      completion: 'updated',
      synthesizedObjectives: ['stabilize the next GPT relaunch objective'],
      queuedObjectives: ['stabilize the next GPT relaunch objective'],
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      errorCode: null,
      error: null,
    });
    const mockSpawnGoalCycle = vi.fn().mockResolvedValue({
      started: true,
      pid: 1234,
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
    });
    const mockPromoteKnowledge = vi.fn().mockResolvedValue({
      status: 'written',
      writtenArtifacts: ['ops/improvement/test.md'],
      skippedReasons: [],
      targetPath: 'ops/improvement/test.md',
      canonicalKey: 'hermes-test',
    });
    const mockRecordSwarmCloseout = vi.fn().mockResolvedValue({
      completion: 'updated',
      waveId: null,
      shardId: null,
      workerRole: null,
      boardPath: null,
      shardPath: null,
      errorCode: null,
      error: null,
    });
    const originalLoopState = fs.readFileSync(loopPath, 'utf8');
    const originalManifestState = fs.readFileSync(manifestPath, 'utf8');

    const result = await acknowledgeOpenJarvisReentry({
      completionStatus: 'completed',
      summary: 'Queued turn completed and the next bounded step is ready.',
      nextAction: 'wait for the next gpt objective or human approval boundary',
      dryRun: true,
      loopPath,
      manifestPath,
    }, {
      readLatestWorkflowState: mockReadLatestWorkflowState,
      appendWorkflowEvent: mockAppendWorkflowEvent,
      autoQueueNextObjectives: mockAutoQueueNextObjectives,
      promoteKnowledge: mockPromoteKnowledge,
      recordSwarmCloseout: mockRecordSwarmCloseout,
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'skipped',
      completionStatus: 'completed',
      profile: 'default',
      sessionId: 'wf-session-1',
      objective: 'stabilize the next GPT relaunch objective',
      runtimeLane: 'operator-personal',
      recordedEventTypes: [],
      autoQueueObjective: {
        requested: true,
        completion: 'updated',
        synthesizedObjectives: ['stabilize the next GPT relaunch objective'],
        queuedObjectives: ['stabilize the next GPT relaunch objective'],
      },
      restartSupervisor: {
        requested: true,
        started: false,
        dryRun: true,
      },
      knowledgePromotion: null,
    });
    expect(mockAppendWorkflowEvent).not.toHaveBeenCalled();
    expect(mockAutoQueueNextObjectives).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wf-session-1',
      runtimeLane: 'operator-personal',
      capacityTarget: 90,
      dryRun: true,
    }));
    expect(mockPromoteKnowledge).not.toHaveBeenCalled();
    expect(mockRecordSwarmCloseout).not.toHaveBeenCalled();
    expect(mockSpawnGoalCycle).not.toHaveBeenCalled();

    expect(fs.readFileSync(loopPath, 'utf8')).toBe(originalLoopState);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(originalManifestState);
  });

  it('promotes distiller closeout results into shared knowledge and records a vault artifact ref', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reentry-ack-distiller-'));
    tempDirs.push(root);
    const loopPath = path.join(root, 'latest-interactive-goal-loop.json');
    const manifestPath = path.join(root, 'latest-interactive-goal.json');
    fs.writeFileSync(loopPath, JSON.stringify({
      auto_select_queued_objective: false,
      auto_launch_queued_chat: true,
      auto_launch_queued_chat_context_profile: 'auto',
      stop_reason: 'queued_chat_launched',
      runtime_lane: 'operator-personal',
      last_launch: {
        objective: 'promote the recovery outcome into shared wiki and changelog',
        context_profile: 'distiller',
        session_id: 'wf-session-2',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-2.json',
        runtime_lane: 'operator-personal',
        awaiting_reentry_acknowledgment: true,
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      auto_select_queued_objective: false,
      auto_launch_queued_chat: true,
      auto_launch_queued_chat_context_profile: 'auto',
      auto_restart_on_release: true,
      route_mode: 'operations',
      runtime_lane: 'operator-personal',
      objective: 'promote the recovery outcome into shared wiki and changelog',
      capacity_target: 90,
    }, null, 2), 'utf8');

    const mockReadLatestWorkflowState = vi.fn().mockResolvedValue({
      ok: true,
      source: 'supabase',
      sessionPath: null,
      session: {
        session_id: 'wf-session-2',
        metadata: {
          objective: 'promote the recovery outcome into shared wiki and changelog',
          runtime_lane: 'operator-personal',
          route_mode: 'operations',
        },
      },
    });
    const mockAppendWorkflowEvent = vi.fn().mockImplementation(async (params) => ({
      sessionId: params.sessionId,
      sessionPath: params.sessionPath || null,
      event: {
        event_type: params.eventType,
      },
      source: 'supabase',
      remote: { ok: true, reason: 'persisted' },
    }));
    const mockAutoQueueNextObjectives = vi.fn().mockResolvedValue({
      completion: 'skipped',
      synthesizedObjectives: [],
      queuedObjectives: [],
      handoffPacketPath: null,
      errorCode: null,
      error: null,
    });
    const mockPromoteKnowledge = vi.fn().mockResolvedValue({
      status: 'written',
      writtenArtifacts: ['ops/improvement/hermes-distiller-closeout.md'],
      skippedReasons: [],
      targetPath: 'ops/improvement/hermes-distiller-closeout.md',
      canonicalKey: 'hermes-distiller-closeout',
    });
    const mockSpawnGoalCycle = vi.fn().mockResolvedValue({
      started: true,
      pid: 1234,
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
    });
    const mockRecordSwarmCloseout = vi.fn().mockResolvedValue({
      completion: 'updated',
      waveId: null,
      shardId: null,
      workerRole: null,
      boardPath: null,
      shardPath: null,
      errorCode: null,
      error: null,
    });

    const result = await acknowledgeOpenJarvisReentry({
      completionStatus: 'completed',
      profile: 'distiller',
      summary: 'Promotion-ready closeout distilled the operator-visible recovery change.',
      nextAction: 'update the shared wiki mirror and changelog summary',
      loopPath,
      manifestPath,
    }, {
      readLatestWorkflowState: mockReadLatestWorkflowState,
      appendWorkflowEvent: mockAppendWorkflowEvent,
      autoQueueNextObjectives: mockAutoQueueNextObjectives,
      promoteKnowledge: mockPromoteKnowledge,
      recordSwarmCloseout: mockRecordSwarmCloseout,
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'recorded',
      completionStatus: 'completed',
      profile: 'distiller',
      recordedEventTypes: ['reentry_acknowledged', 'decision_distillate', 'artifact_ref'],
      knowledgePromotion: {
        requested: true,
        profile: 'distiller',
        artifactKind: 'lesson',
        status: 'written',
        targetPath: 'ops/improvement/hermes-distiller-closeout.md',
      },
    });
    expect(mockPromoteKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      artifactKind: 'lesson',
      tags: expect.arrayContaining(['hermes', 'reentry', 'distiller', 'completed']),
    }));
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'decision_distillate',
      payload: expect.objectContaining({
        promote_as: 'development_slice',
        tags: expect.arrayContaining(['distiller']),
      }),
    }));
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      eventType: 'artifact_ref',
      payload: expect.objectContaining({
        refs: expect.arrayContaining([expect.objectContaining({
          locator: 'ops/improvement/hermes-distiller-closeout.md',
          ref_kind: 'vault-note',
        })]),
      }),
    }));
  });

  it('records swarm board and shard metadata into the reentry closeout path', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reentry-ack-swarm-'));
    tempDirs.push(root);
    const loopPath = path.join(root, 'latest-interactive-goal-loop.json');
    const manifestPath = path.join(root, 'latest-interactive-goal.json');
    fs.writeFileSync(loopPath, JSON.stringify({
      auto_select_queued_objective: false,
      auto_launch_queued_chat: true,
      stop_reason: 'queued_chat_launched',
      runtime_lane: 'operator-personal',
      last_launch: {
        objective: 'Map route, blockers, and evidence for shared wrapper readiness',
        context_profile: 'scout',
        session_id: 'wf-session-3',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-3.json',
        runtime_lane: 'operator-personal',
        awaiting_reentry_acknowledgment: true,
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      auto_select_queued_objective: false,
      auto_launch_queued_chat: true,
      runtime_lane: 'operator-personal',
      objective: 'Map route, blockers, and evidence for shared wrapper readiness',
    }, null, 2), 'utf8');

    const mockReadLatestWorkflowState = vi.fn().mockResolvedValue({
      ok: true,
      source: 'supabase',
      sessionPath: null,
      session: {
        session_id: 'wf-session-3',
        metadata: {
          objective: 'Map route, blockers, and evidence for shared wrapper readiness',
          runtime_lane: 'operator-personal',
          route_mode: 'operations',
        },
      },
    });
    const mockAppendWorkflowEvent = vi.fn().mockImplementation(async (params) => ({
      sessionId: params.sessionId,
      sessionPath: params.sessionPath || null,
      event: {
        event_type: params.eventType,
      },
      source: 'supabase',
      remote: { ok: true, reason: 'persisted' },
    }));
    const mockAutoQueueNextObjectives = vi.fn().mockResolvedValue({
      completion: 'skipped',
      synthesizedObjectives: [],
      queuedObjectives: [],
      handoffPacketPath: null,
      errorCode: null,
      error: null,
    });
    const mockPromoteKnowledge = vi.fn().mockResolvedValue({
      status: 'skipped',
      writtenArtifacts: [],
      skippedReasons: ['not_requested'],
      targetPath: null,
      canonicalKey: null,
    });
    const mockRecordSwarmCloseout = vi.fn().mockResolvedValue({
      completion: 'updated',
      waveId: 'wave-1',
      shardId: 'route-scout',
      workerRole: 'scout',
      boardPath: 'plans/execution/HERMES_PARALLEL_GPT_SWARM_BOARD.md',
      shardPath: 'plans/execution/hermes-swarm/wave-1/01-route-scout.md',
      errorCode: null,
      error: null,
    });
    const mockSpawnGoalCycle = vi.fn().mockResolvedValue({
      started: true,
      pid: 1234,
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
    });

    const result = await acknowledgeOpenJarvisReentry({
      completionStatus: 'completed',
      profile: 'scout',
      summary: 'Scout shard completed with one executor-ready route map.',
      nextAction: 'launch the executor shard against the isolated worktree',
      waveId: 'wave-1',
      shardId: 'route-scout',
      workerRole: 'scout',
      swarmBoardPath: 'plans/execution/HERMES_PARALLEL_GPT_SWARM_BOARD.md',
      shardPath: 'plans/execution/hermes-swarm/wave-1/01-route-scout.md',
      dryRun: true,
      loopPath,
      manifestPath,
    }, {
      readLatestWorkflowState: mockReadLatestWorkflowState,
      appendWorkflowEvent: mockAppendWorkflowEvent,
      autoQueueNextObjectives: mockAutoQueueNextObjectives,
      promoteKnowledge: mockPromoteKnowledge,
      recordSwarmCloseout: mockRecordSwarmCloseout,
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result).toMatchObject({
      ok: true,
      completionStatus: 'completed',
      profile: 'scout',
      swarmCloseout: {
        requested: true,
        completion: 'updated',
        waveId: 'wave-1',
        shardId: 'route-scout',
        workerRole: 'scout',
      },
    });
    expect(mockRecordSwarmCloseout).toHaveBeenCalledWith(expect.objectContaining({
      waveId: 'wave-1',
      shardId: 'route-scout',
      workerRole: 'scout',
      boardPath: 'plans/execution/HERMES_PARALLEL_GPT_SWARM_BOARD.md',
      shardPath: 'plans/execution/hermes-swarm/wave-1/01-route-scout.md',
      dryRun: true,
    }));
    expect(mockAppendWorkflowEvent).not.toHaveBeenCalled();
  });

  it('preserves queue swarm supervisor mode when reentry ack requests a restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reentry-ack-swarm-restart-'));
    tempDirs.push(root);
    const loopPath = path.join(root, 'latest-interactive-goal-loop.json');
    const manifestPath = path.join(root, 'latest-interactive-goal.json');
    fs.writeFileSync(loopPath, JSON.stringify({
      auto_select_queued_objective: true,
      auto_launch_queued_swarm: true,
      auto_launch_queued_swarm_include_distiller: true,
      auto_launch_queued_swarm_executor_worktree_path: 'C:/Muel_S/wt/swarm-executor',
      auto_launch_queued_swarm_executor_artifact_budget: ['tests', 'docs'],
      stop_reason: 'queued_swarm_launched',
      runtime_lane: 'operator-personal',
      last_launch: {
        objective: 'stabilize shared wrapper readiness',
        source: 'autonomous-queue:vscode-swarm',
        session_id: 'wf-session-4',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-4.json',
        runtime_lane: 'operator-personal',
        awaiting_reentry_acknowledgment: true,
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      auto_select_queued_objective: true,
      auto_launch_queued_swarm: true,
      auto_launch_queued_swarm_include_distiller: true,
      auto_launch_queued_swarm_executor_worktree_path: 'C:/Muel_S/wt/swarm-executor',
      auto_launch_queued_swarm_executor_artifact_budget: ['tests', 'docs'],
      auto_restart_on_release: true,
      route_mode: 'operations',
      runtime_lane: 'operator-personal',
      objective: 'stabilize shared wrapper readiness',
      capacity_target: 90,
    }, null, 2), 'utf8');

    const mockReadLatestWorkflowState = vi.fn().mockResolvedValue({
      ok: true,
      source: 'supabase',
      sessionPath: null,
      session: {
        session_id: 'wf-session-4',
        metadata: {
          objective: 'stabilize shared wrapper readiness',
          runtime_lane: 'operator-personal',
          route_mode: 'operations',
        },
      },
    });
    const mockAppendWorkflowEvent = vi.fn().mockImplementation(async (params) => ({
      sessionId: params.sessionId,
      sessionPath: params.sessionPath || null,
      event: { event_type: params.eventType },
      source: 'supabase',
      remote: { ok: true, reason: 'persisted' },
    }));
    const mockAutoQueueNextObjectives = vi.fn().mockResolvedValue({
      completion: 'updated',
      synthesizedObjectives: ['stabilize shared wrapper readiness'],
      queuedObjectives: ['stabilize shared wrapper readiness'],
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      errorCode: null,
      error: null,
    });
    const mockPromoteKnowledge = vi.fn().mockResolvedValue({
      status: 'skipped',
      writtenArtifacts: [],
      skippedReasons: ['not_requested'],
      targetPath: null,
      canonicalKey: null,
    });
    const mockRecordSwarmCloseout = vi.fn().mockResolvedValue({
      completion: 'updated',
      waveId: null,
      shardId: null,
      workerRole: null,
      boardPath: null,
      shardPath: null,
      errorCode: null,
      error: null,
    });
    const mockSpawnGoalCycle = vi.fn().mockResolvedValue({
      started: true,
      pid: 1234,
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true --autoLaunchQueuedSwarm=true',
    });
    const originalLoopState = fs.readFileSync(loopPath, 'utf8');
    const originalManifestState = fs.readFileSync(manifestPath, 'utf8');

    const result = await acknowledgeOpenJarvisReentry({
      completionStatus: 'completed',
      summary: 'Queued swarm wave completed and the next bounded step is ready.',
      nextAction: 'wait for the next bounded swarm objective',
      dryRun: true,
      loopPath,
      manifestPath,
    }, {
      readLatestWorkflowState: mockReadLatestWorkflowState,
      appendWorkflowEvent: mockAppendWorkflowEvent,
      autoQueueNextObjectives: mockAutoQueueNextObjectives,
      promoteKnowledge: mockPromoteKnowledge,
      recordSwarmCloseout: mockRecordSwarmCloseout,
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result.restartSupervisor).toMatchObject({
      requested: true,
      started: false,
      dryRun: true,
    });
    const normalizedRestartCommand = String(result.restartSupervisor.command || '').replace(/\\/g, '/');
    expect(normalizedRestartCommand).toContain('--autoLaunchQueuedSwarm=true');
    expect(normalizedRestartCommand).toContain('--autoLaunchQueuedSwarmIncludeDistiller=true');
    expect(normalizedRestartCommand).toContain('--autoLaunchQueuedSwarmExecutorWorktreePath=C:/Muel_S/wt/swarm-executor');
    expect(normalizedRestartCommand).toContain('--autoLaunchQueuedSwarmExecutorArtifactBudget=tests,docs');
    expect(mockAppendWorkflowEvent).not.toHaveBeenCalled();
    expect(fs.readFileSync(loopPath, 'utf8')).toBe(originalLoopState);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(originalManifestState);
  });
});