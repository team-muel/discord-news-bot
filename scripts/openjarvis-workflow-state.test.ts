import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendWorkflowEvent, deriveResumeStateFromWorkflowSession } from './openjarvis-workflow-state.mjs';

describe('openjarvis-workflow-state helpers', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('derives a waiting human boundary from a released workflow session', () => {
    const resumeState = deriveResumeStateFromWorkflowSession({
      session_id: 'openjarvis-1',
      status: 'released',
      metadata: {
        objective: 'stabilize local autonomy loop',
      },
      steps: [],
    }, {
      waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
      gcpCapacityRecoveryRequested: false,
    });

    expect(resumeState.source).toBe('workflow-session');
    expect(resumeState.owner).toBe('human');
    expect(resumeState.mode).toBe('waiting');
    expect(resumeState.next_action).toBe('wait for the next gpt objective or human approval boundary');
    expect(resumeState.resumable).toBe(false);
    expect(resumeState.reason).toBe('workstream_waiting_for_next_gpt_objective');
  });

  it('keeps a released workflow resumable when operator GCP recovery is requested', () => {
    const resumeState = deriveResumeStateFromWorkflowSession({
      session_id: 'openjarvis-2',
      status: 'released',
      metadata: {
        objective: 'recover GCP native leverage',
      },
      steps: [],
    }, {
      gcpCapacityRecoveryRequested: true,
      capacityTarget: 90,
      waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
    });

    expect(resumeState.owner).toBe('human');
    expect(resumeState.mode).toBe('waiting');
    expect(resumeState.next_action).toBe('resume bounded GCP capacity recovery until capacity reaches 90');
    expect(resumeState.resumable).toBe(true);
    expect(resumeState.reason).toBe('operator_gcp_capacity_recovery_requested');
  });

  it('escalates blocked failed sessions back to GPT', () => {
    const resumeState = deriveResumeStateFromWorkflowSession({
      session_id: 'openjarvis-3',
      status: 'failed',
      metadata: {
        objective: 'finish weekly unattended flow',
      },
      steps: [
        {
          step_name: 'gate-check',
          status: 'failed',
        },
      ],
    }, {
      waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
    });

    expect(resumeState.owner).toBe('gpt');
    expect(resumeState.mode).toBe('blocked');
    expect(resumeState.escalation_status).toBe('pending-gpt');
    expect(resumeState.next_action).toContain('recover gate-check');
    expect(resumeState.resumable).toBe(false);
  });

  it('appends workflow events into the local session mirror when Supabase is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-event-append-'));
    tempDirs.push(root);
    const sessionPath = path.join(root, 'wf-session.json');
    fs.writeFileSync(sessionPath, JSON.stringify({
      session_id: 'openjarvis-local-1',
      workflow_name: 'openjarvis.unattended',
      stage: 'interactive',
      scope: 'interactive:goal',
      status: 'released',
      metadata: {
        objective: 'keep the latest GPT closeout in hot-state',
      },
      started_at: '2026-04-13T01:00:00.000Z',
      completed_at: null,
      steps: [],
      events: [],
    }, null, 2), 'utf8');

    const result = await appendWorkflowEvent({
      sessionPath,
      eventType: 'reentry_acknowledged',
      decisionReason: 'local closeout recorded',
      payload: {
        completion_status: 'completed',
      },
    });

    expect(result.sessionId).toBe('openjarvis-local-1');
    expect(result.source).toBe('local-mirror');
    const updated = JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as { events: Array<Record<string, unknown>> };
    expect(updated.events).toHaveLength(1);
    expect(updated.events[0]).toMatchObject({
      event_type: 'reentry_acknowledged',
      decision_reason: 'local closeout recorded',
      payload: {
        completion_status: 'completed',
      },
    });
  });
});