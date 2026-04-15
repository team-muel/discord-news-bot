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
    const mockSpawnGoalCycle = vi.fn().mockResolvedValue({
      started: true,
      pid: 1234,
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
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
      spawnGoalCycle: mockSpawnGoalCycle,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'recorded',
      completionStatus: 'completed',
      sessionId: 'wf-session-1',
      objective: 'stabilize the next GPT relaunch objective',
      runtimeLane: 'operator-personal',
      recordedEventTypes: ['reentry_acknowledged', 'decision_distillate'],
      restartSupervisor: {
        requested: true,
        started: false,
        dryRun: true,
      },
    });
    expect(mockAppendWorkflowEvent).toHaveBeenCalledTimes(2);
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: 'reentry_acknowledged',
      sessionId: 'wf-session-1',
    }));
    expect(mockAppendWorkflowEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'decision_distillate',
      sessionId: 'wf-session-1',
    }));
    expect(mockSpawnGoalCycle).not.toHaveBeenCalled();

    const nextLoopState = JSON.parse(fs.readFileSync(loopPath, 'utf8')) as Record<string, unknown>;
    expect(nextLoopState.awaiting_reentry_acknowledgment).toBe(false);
    expect(nextLoopState.reentry_acknowledgment).toMatchObject({
      completion_status: 'completed',
      summary: 'Queued turn completed and the next bounded step is ready.',
    });
  });
});