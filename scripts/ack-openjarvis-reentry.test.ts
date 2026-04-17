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
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'recorded',
      completionStatus: 'completed',
      profile: 'default',
      sessionId: 'wf-session-1',
      objective: 'stabilize the next GPT relaunch objective',
      runtimeLane: 'operator-personal',
      recordedEventTypes: ['reentry_acknowledged', 'decision_distillate'],
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
    expect(mockAppendWorkflowEvent).toHaveBeenCalledTimes(2);
    expect(mockAutoQueueNextObjectives).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wf-session-1',
      runtimeLane: 'operator-personal',
      capacityTarget: 90,
      dryRun: true,
    }));
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: 'reentry_acknowledged',
      sessionId: 'wf-session-1',
    }));
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'decision_distillate',
      sessionId: 'wf-session-1',
    }));
    expect(mockPromoteKnowledge).not.toHaveBeenCalled();
    expect(mockSpawnGoalCycle).not.toHaveBeenCalled();

    const nextLoopState = JSON.parse(fs.readFileSync(loopPath, 'utf8')) as Record<string, unknown>;
    expect(nextLoopState.awaiting_reentry_acknowledgment).toBe(false);
    expect(nextLoopState.reentry_acknowledgment).toMatchObject({
      completion_status: 'completed',
      summary: 'Queued turn completed and the next bounded step is ready.',
      auto_queue_objective: {
        requested: true,
        completion: 'updated',
      },
    });
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
});