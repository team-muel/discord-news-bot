import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deriveResumeStateFromWorkflowSession } from './openjarvis-workflow-state.mjs';
import { buildWorkflowStepsForRun } from './run-openjarvis-unattended.mjs';
import {
  buildAutonomousGoalCandidates,
  buildGoalCycleLaunchArgs,
  buildSessionOpenBundle,
  buildStatusPayload,
  canLaunchContinuousLoopResume,
  launchVisibleWindowsPowerShell,
  normalizeLoopLimit,
  parseJsonCommandOutput,
  pickAutonomousGoalCandidate,
  readExecutionBoardFocusedObjectives,
  readExecutionBoardQueuedObjectives,
  resolveRequestedWorkflowSessionId,
  resolveGoalCycleRouteMode,
  runContinuousLoop,
} from './run-openjarvis-goal-cycle.mjs';
import {
  formatWorkflowSessionReference,
  normalizeContinuityObsidianHealth,
  resolveContinuityObjective,
  resolveContinuitySafeQueue,
  resolveLocalAutonomyWatchState,
  resolveRequestedSessionId,
} from './sync-openjarvis-continuity-packets';

describe('openjarvis remote workstream smoke', () => {
  it('surfaces a remote-only Supabase workstream in goal-cycle status', async () => {
    const session = {
      session_id: 'remote-session-1',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-12T10:00:00.000Z',
      completed_at: '2026-04-12T10:01:00.000Z',
      metadata: {
        objective: 'remote-workstream-resume',
        route_mode: 'operations',
        runtime_lane: 'operator-personal',
      },
      events: [
        {
          event_type: 'recall_request',
          decision_reason: 'need gpt re-entry',
          evidence_id: 'wf-evidence-1',
          created_at: '2026-04-12T10:00:30.000Z',
          payload: {
            blocked_action: 'planActions',
            next_action: 'resume bounded GCP capacity recovery until capacity reaches 90',
            requested_by: 'goal-pipeline',
            runtime_lane: 'operator-personal',
            failed_step_names: ['gate-check'],
          },
        },
        {
          event_type: 'decision_distillate',
          decision_reason: 'Pipeline released after bounded GCP-capacity recovery completed.',
          evidence_id: 'wf-distillate-1',
          created_at: '2026-04-12T10:00:45.000Z',
          payload: {
            next_action: 'promote the recovery outcome into Obsidian if it changes operator guidance',
            runtime_lane: 'operator-personal',
            source_event: 'session_complete',
            promote_as: 'development_slice',
            tags: ['goal-pipeline', 'released'],
          },
        },
        {
          event_type: 'artifact_ref',
          created_at: '2026-04-12T10:00:20.000Z',
          payload: {
            runtime_lane: 'operator-personal',
            source_step_name: 'gate-check',
            source_event: 'step_passed',
            refs: [
              {
                locator: 'docs/CHANGELOG-ARCH.md',
                ref_kind: 'repo-file',
                title: 'Architecture changelog',
              },
              {
                locator: 'https://github.com/team-muel/discord-news-bot/pull/123',
                ref_kind: 'url',
                title: 'PR 123',
              },
              {
                locator: 'https://example.com/runbook',
                ref_kind: 'url',
                title: 'Runbook',
              },
            ],
          },
        },
      ],
      steps: [
        {
          step_name: 'gate-check',
          status: 'passed',
          agent_role: 'openjarvis',
          duration_ms: 321,
          details: {
            route_mode: 'operations',
          },
        },
      ],
    };

    const status = await buildStatusPayload({
      summary: {},
      launch: {},
      loopState: {},
      capacityTarget: 90,
      gcpCapacityRecoveryRequested: true,
      runtimeLane: 'operator-personal',
      workstreamState: {
        ok: true,
        source: 'supabase',
        sessionPath: null,
        session,
      },
      resumeState: deriveResumeStateFromWorkflowSession(session, {
        source: 'supabase-workstream',
        gcpCapacityRecoveryRequested: true,
        capacityTarget: 90,
        runtimeLane: 'operator-personal',
        waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
      }),
    });

    expect(status.workflow.source).toBe('supabase');
    expect(status.workflow.runtime_lane).toBe('operator-personal');
    expect(status.workflow.session_id).toBe('remote-session-1');
    expect(status.workflow.session_path).toBeNull();
    expect(status.workflow.lastRecallRequest).toMatchObject({
      blockedAction: 'planActions',
      runtimeLane: 'operator-personal',
      failedStepNames: ['gate-check'],
    });
    expect(status.workflow.lastDecisionDistillate).toMatchObject({
      summary: 'Pipeline released after bounded GCP-capacity recovery completed.',
      runtimeLane: 'operator-personal',
      sourceEvent: 'session_complete',
      promoteAs: 'development_slice',
    });
    expect(status.workflow.lastArtifactRefs).toMatchObject([
      {
        locator: 'docs/CHANGELOG-ARCH.md',
        refKind: 'repo-file',
        artifactPlane: 'github',
        githubSettlementKind: 'repo-file',
        sourceStepName: 'gate-check',
      },
      {
        locator: 'https://github.com/team-muel/discord-news-bot/pull/123',
        refKind: 'url',
        artifactPlane: 'github',
        githubSettlementKind: 'pull-request',
      },
      {
        locator: 'https://example.com/runbook',
        refKind: 'url',
        artifactPlane: 'external',
      },
    ]);
    expect(status.resume_state.runtime_lane).toBe('operator-personal');
    expect(status.resume_state.source).toBe('supabase-workstream');
    expect(status.resume_state.next_action).toBe('resume bounded GCP capacity recovery until capacity reaches 90');
    expect(status.hermes_runtime).toMatchObject({
      target_role: 'persistent-local-operator',
      current_role: 'helper-only',
      readiness: 'not-ready',
      can_continue_without_gpt_session: false,
      queue_enabled: false,
      supervisor_alive: false,
      has_hot_state: true,
      local_operator_surface: false,
    });
    expect(status.hermes_runtime.remediation_actions.map((entry: { action_id: string }) => entry.action_id)).toEqual(
      expect.arrayContaining(['start-supervisor-loop']),
    );
    expect(status.hermes_runtime.next_actions).toEqual(expect.arrayContaining([
      'Mark the workstream as resumable release-to-restart automation only for bounded safe objectives.',
      'Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.',
    ]));
  });

  it('treats queued-chat reentry acknowledgment as a wait boundary instead of a missing-supervisor failure', async () => {
    const queuedLaunchAt = new Date(Date.now() - 60 * 1000).toISOString();
    const session = {
      session_id: 'remote-session-ack',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-15T08:00:00.000Z',
      completed_at: '2026-04-15T08:05:00.000Z',
      metadata: {
        objective: 'await queued reentry ack',
        route_mode: 'delivery',
        runtime_lane: 'operator-personal',
        auto_restart_on_release: true,
      },
      events: [],
      steps: [],
    };

    const status = await buildStatusPayload({
      summary: {},
      launch: {},
      loopState: {
        status: 'stopped',
        supervisor_pid: null,
        auto_select_queued_objective: true,
        auto_launch_queued_chat: true,
        awaiting_reentry_acknowledgment: true,
        stop_reason: 'queued_chat_launched',
        last_reason: 'queued-chat-launched',
        last_launch: {
          objective: 'await queued reentry ack',
          launched_at: queuedLaunchAt,
          awaiting_reentry_acknowledgment: true,
        },
      },
      capacityTarget: 90,
      runtimeLane: 'operator-personal',
      workstreamState: {
        ok: true,
        source: 'supabase',
        sessionPath: null,
        session,
      },
      resumeState: deriveResumeStateFromWorkflowSession(session, {
        source: 'supabase-workstream',
        gcpCapacityRecoveryRequested: false,
        capacityTarget: 90,
        runtimeLane: 'operator-personal',
        waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
      }),
    });

    expect(status.supervisor).toMatchObject({
      supervisor_alive: false,
      auto_select_queued_objective: true,
      auto_launch_queued_chat: true,
      awaiting_reentry_acknowledgment: true,
      queued_reentry_objective: 'await queued reentry ack',
      stop_reason: 'queued_chat_launched',
    });
    expect(status.resume_state).toMatchObject({
      objective: 'await queued reentry ack',
      queued_reentry_objective: 'await queued reentry ack',
      resumable: false,
      reason: 'packet_awaiting_reentry_ack',
    });
    expect(status.hermes_runtime).toMatchObject({
      readiness: 'partial',
      supervisor_alive: false,
      awaiting_reentry_acknowledgment: true,
      awaiting_reentry_acknowledgment_stale: false,
    });
    expect(status.hermes_runtime.next_actions).toEqual(expect.arrayContaining([
      'Acknowledge the queued GPT handoff with the reentry-ack command before allowing the queue-aware supervisor to relaunch.',
    ]));
    expect(status.hermes_runtime.blockers).not.toContain('No live supervisor is holding the local continuity loop open right now.');
    expect(status.hermes_runtime.remediation_actions.map((entry: { action_id: string }) => entry.action_id)).not.toContain('start-supervisor-loop');
  });

  it('raises a stale queued-chat reentry warning and derived capability demand after the wait boundary ages out', async () => {
    const staleQueuedLaunchAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const session = {
      session_id: 'remote-session-stale-ack',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-15T08:00:00.000Z',
      completed_at: '2026-04-15T08:05:00.000Z',
      metadata: {
        objective: 'close out the pending queued chat turn',
        route_mode: 'delivery',
        runtime_lane: 'operator-personal',
        auto_restart_on_release: true,
      },
      events: [],
      steps: [],
    };

    const status = await buildStatusPayload({
      summary: {},
      launch: {},
      loopState: {
        status: 'stopped',
        supervisor_pid: null,
        auto_select_queued_objective: true,
        auto_launch_queued_chat: true,
        awaiting_reentry_acknowledgment: true,
        stop_reason: 'queued_chat_launched',
        stopped_at: staleQueuedLaunchAt,
        last_reason: 'queued-chat-launched',
        last_launch: {
          objective: 'close out the pending queued chat turn',
          launched_at: staleQueuedLaunchAt,
          awaiting_reentry_acknowledgment: true,
        },
      },
      capacityTarget: 90,
      runtimeLane: 'operator-personal',
      workstreamState: {
        ok: true,
        source: 'supabase',
        sessionPath: null,
        session,
      },
      resumeState: deriveResumeStateFromWorkflowSession(session, {
        source: 'supabase-workstream',
        gcpCapacityRecoveryRequested: false,
        capacityTarget: 90,
        runtimeLane: 'operator-personal',
        waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
      }),
    });

    expect(status.supervisor).toMatchObject({
      awaiting_reentry_acknowledgment: true,
      awaiting_reentry_acknowledgment_started_at: staleQueuedLaunchAt,
      awaiting_reentry_acknowledgment_stale: true,
    });
    expect(status.hermes_runtime).toMatchObject({
      awaiting_reentry_acknowledgment: true,
      awaiting_reentry_acknowledgment_started_at: staleQueuedLaunchAt,
      awaiting_reentry_acknowledgment_stale: true,
    });
    expect(status.hermes_runtime.blockers).toContain(
      'Queued GPT handoff has been waiting more than 15 minutes for reentry acknowledgment, so the autonomy loop is paused on a stale boundary.',
    );
    expect(status.hermes_runtime.next_actions).toContain(
      'Inspect the pending queued VS Code GPT handoff and run the reentry-ack command; the wait boundary has gone stale and Hermes will stay paused until it is closed out.',
    );

    const bundle = buildSessionOpenBundle({ status });
    expect(bundle.capability_demands[0]).toMatchObject({
      summary: 'Queued GPT handoff has been waiting more than 15 minutes for reentry acknowledgment and is blocking the next autonomous cycle.',
      missing_capability: 'stale_reentry_acknowledgment',
      failed_or_insufficient_route: 'queued_gpt_handoff_launched -> reentry_acknowledged',
      proposed_owner: 'hermes',
    });
    expect(bundle.supervisor).toMatchObject({
      awaiting_reentry_acknowledgment: true,
      awaiting_reentry_acknowledgment_started_at: staleQueuedLaunchAt,
      awaiting_reentry_acknowledgment_stale: true,
    });
  });

  it('derives local autonomy watch observability fallback from manifest and status artifacts', () => {
    const watchState = resolveLocalAutonomyWatchState({
      manifest: {
        pid: process.pid,
        startedAt: '2026-04-15T09:32:40.191Z',
        logPath: 'tmp/autonomy/local-autonomy-supervisor.log',
        statusPath: 'tmp/autonomy/local-autonomy-supervisor.json',
        detached: true,
      },
      status: {
        checkedAt: '2026-04-15T09:42:53.847Z',
        summary: 'doctor=true failures=0 hermes=ready supervisor:alive:auto-chat',
        watchProcess: {
          pid: process.pid,
          detached: true,
          manifestPath: 'tmp/autonomy/local-autonomy-supervisor.manifest.json',
          statusPath: 'tmp/autonomy/local-autonomy-supervisor.json',
          logPath: 'tmp/autonomy/local-autonomy-supervisor.log',
        },
        code: {
          driftDetected: false,
          restartRecommended: false,
          reason: null,
        },
      },
    });

    expect(watchState).toMatchObject({
      alive: true,
      pid: process.pid,
      detached: true,
      summary: 'doctor=true failures=0 hermes=ready supervisor:alive:auto-chat',
      manifestPath: 'tmp/autonomy/local-autonomy-supervisor.manifest.json',
      statusPath: 'tmp/autonomy/local-autonomy-supervisor.json',
      logPath: 'tmp/autonomy/local-autonomy-supervisor.log',
      codeDriftDetected: false,
      restartRecommended: false,
      driftReason: null,
    });
  });

  it('prefers the detached watcher manifest over a one-shot status pid', () => {
    const watchState = resolveLocalAutonomyWatchState({
      manifest: {
        pid: process.pid,
        startedAt: '2026-04-17T10:37:02.601Z',
        logPath: 'tmp/autonomy/local-autonomy-supervisor.log',
        statusPath: 'tmp/autonomy/local-autonomy-supervisor.json',
        detached: true,
      },
      status: {
        checkedAt: '2026-04-17T10:48:46.789Z',
        summary: 'doctor=true failures=0 hermes=ready queue=ready chat=auto supervisor:alive:auto-chat',
        watchProcess: {
          pid: process.pid + 999999,
          detached: false,
          manifestPath: 'tmp/autonomy/local-autonomy-supervisor.manifest.json',
          statusPath: 'tmp/autonomy/local-autonomy-supervisor.json',
          logPath: 'tmp/autonomy/local-autonomy-supervisor.log',
        },
        code: {
          driftDetected: false,
          restartRecommended: false,
          reason: null,
        },
      },
    });

    expect(watchState).toMatchObject({
      alive: true,
      pid: process.pid,
      detached: true,
      summary: 'doctor=true failures=0 hermes=ready queue=ready chat=auto supervisor:alive:auto-chat',
    });
  });

  it('prefers persisted capability demand events over derived bundle demands', () => {
    const bundle = buildSessionOpenBundle({
      status: {
        workflow: {
          objective: 'repair the failed automation route',
          runtime_lane: 'operator-personal',
          lastCapabilityDemands: [
            {
              createdAt: '2026-04-12T10:00:30.000Z',
              summary: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
              objective: 'repair the failed automation route',
              missingCapability: 'ACTION_NOT_ALLOWED',
              missingSource: null,
              failedOrInsufficientRoute: 'replan-step-1-web.search',
              cheapestEnablementPath: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
              proposedOwner: 'operator',
              evidenceRefs: ['docs/CHANGELOG-ARCH.md'],
              evidenceRefDetails: [
                {
                  createdAt: '2026-04-12T10:00:30.000Z',
                  locator: 'docs/CHANGELOG-ARCH.md',
                  refKind: 'repo-file',
                  title: 'Architecture changelog',
                  artifactPlane: 'github',
                  githubSettlementKind: 'repo-file',
                  runtimeLane: 'operator-personal',
                  sourceStepName: null,
                  sourceEvent: 'session_complete',
                },
              ],
              recallCondition: 'Pipeline failed after replanning; GPT recall required',
              runtimeLane: 'operator-personal',
              sourceEvent: 'session_complete',
              tags: ['goal-pipeline', 'failed', 'replanned'],
            },
          ],
          lastArtifactRefs: [],
        },
        result: { final_status: 'failed', failed_steps: 1, step_count: 3 },
        capacity: {},
        resume_state: {},
        automation_route: {
          recommended_mode: 'api-first-with-agent-fallback',
          primary_path_type: 'api-path',
          primary_surfaces: ['supabase-hot-state'],
        },
        supervisor: {},
        hermes_runtime: {
          target_role: 'persistent-local-operator',
          current_role: 'helper-only',
          readiness: 'ready',
          can_continue_without_gpt_session: true,
          queue_enabled: true,
          supervisor_alive: true,
          has_hot_state: true,
          local_operator_surface: true,
          ide_handoff_observed: true,
          queued_objectives_available: false,
          strengths: [],
          blockers: ['derived blocker that should be ignored when persisted demand exists'],
          next_actions: [],
          remediation_actions: [],
        },
        autonomous_goal_candidates: [],
      },
    });

    expect(bundle.capability_demands).toEqual([
      {
        summary: 'Pipeline step replan-step-1-web.search was blocked by policy and needs a narrower route or approval.',
        objective: 'repair the failed automation route',
        missing_capability: 'ACTION_NOT_ALLOWED',
        missing_source: null,
        failed_or_insufficient_route: 'replan-step-1-web.search',
        cheapest_enablement_path: 'inspect the failed steps and revise the objective, policy boundary, or execution plan',
        proposed_owner: 'operator',
        evidence_refs: ['docs/CHANGELOG-ARCH.md'],
        evidence_ref_details: [
          {
            locator: 'docs/CHANGELOG-ARCH.md',
            refKind: 'repo-file',
            title: 'Architecture changelog',
            artifactPlane: 'github',
            githubSettlementKind: 'repo-file',
            sourceStepName: null,
          },
        ],
        recall_condition: 'Pipeline failed after replanning; GPT recall required',
      },
    ]);
  });

  it('formats packet evidence for remote-only workflow sessions', () => {
    expect(formatWorkflowSessionReference(null, {
      session_id: 'remote-session-2',
    })).toBe('workflow session: supabase:remote-session-2');
  });

  it('prefers the selected local session path over a stale summary session id when requesting continuity sync state', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'muel-sync-session-id-'));
    const sessionPath = path.join(tempDir, 'latest-session.json');

    await fs.writeFile(sessionPath, JSON.stringify({
      session_id: 'latest-local-session',
      steps: [],
      events: [],
    }), 'utf8');

    try {
      expect(resolveRequestedSessionId({
        workflow: {
          session_id: 'stale-summary-session',
        },
      }, sessionPath, '')).toBe('latest-local-session');

      expect(resolveRequestedSessionId({
        workflow: {
          session_id: 'stale-summary-session',
        },
      }, sessionPath, 'explicit-session')).toBe('explicit-session');

      expect(resolveRequestedWorkflowSessionId({
        workflow: {
          session_id: 'stale-summary-session',
        },
      }, sessionPath, '')).toBe('latest-local-session');

      expect(resolveRequestedWorkflowSessionId({
        workflow: {
          session_id: 'stale-summary-session',
        },
      }, sessionPath, 'explicit-session')).toBe('explicit-session');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('preserves explicit safe queue overrides over generated continuity defaults', () => {
    const generatedQueue = [
      'continue the current workflow if runner and session state stay healthy',
      'keep launch manifest/log, workflow session, and summary aligned',
    ];

    expect(resolveContinuitySafeQueue({
      existingQueue: ['stabilize shared MCP teammate bootstrap hardening'],
      generatedQueue,
    })).toEqual(['stabilize shared MCP teammate bootstrap hardening']);

    expect(resolveContinuitySafeQueue({
      existingQueue: generatedQueue,
      generatedQueue: [...generatedQueue, 'persist route decisions, artifact refs, and compact distillates after each fallback cycle'],
    })).toEqual([
      'continue the current workflow if runner and session state stay healthy',
      'keep launch manifest/log, workflow session, and summary aligned',
      'persist route decisions, artifact refs, and compact distillates after each fallback cycle',
    ]);
  });

  it('prefers an explicit packet objective when the workstream objective is only a placeholder', () => {
    expect(resolveContinuityObjective({
      sessionObjective: 'none',
      packetObjective: '전체 코드 최적화 + 서비스 모듈 유지보수성 개선',
    })).toBe('전체 코드 최적화 + 서비스 모듈 유지보수성 개선');

    expect(resolveContinuityObjective({
      sessionObjective: 'Autopilot continuity session',
      packetObjective: 'stabilize shared MCP teammate bootstrap hardening',
    })).toBe('stabilize shared MCP teammate bootstrap hardening');

    expect(resolveContinuityObjective({
      sessionObjective: 'none',
      packetObjective: 'none',
    })).toBeNull();
  });

  it('prefers the execution-board focus objective over stale released session objectives', () => {
    expect(resolveContinuityObjective({
      focusObjective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
      sessionStatus: 'released',
      sessionObjective: '전체 코드 최적화 + 서비스 모듈 유지보수성 개선',
      packetObjective: '전체 코드 최적화 + 서비스 모듈 유지보수성 개선',
    })).toBe('코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상');

    expect(resolveContinuityObjective({
      focusObjective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
      sessionStatus: 'executing',
      sessionObjective: '전체 코드 최적화 + 서비스 모듈 유지보수성 개선',
      packetObjective: '전체 코드 최적화 + 서비스 모듈 유지보수성 개선',
    })).toBe('전체 코드 최적화 + 서비스 모듈 유지보수성 개선');
  });

  it('does not keep stale packet-based GCP recovery active unless explicitly requested again', async () => {
    const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'muel-openjarvis-packets-'));
    const executionDir = path.join(vaultPath, 'plans', 'execution');
    await fs.mkdir(executionDir, { recursive: true });

    await fs.writeFile(path.join(executionDir, 'HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md'), `---
objective: "stabilize local n8n delegation"
---

## Session Objective
- stabilize local n8n delegation

## Safe Autonomous Queue For Hermes
- inspect local n8n runtime health
`, 'utf8');

    await fs.writeFile(path.join(executionDir, 'HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'), `---
objective: "stabilize local n8n delegation"
gcp_capacity_recovery_requested: true
---

## Next Action
- resume bounded GCP capacity recovery until capacity reaches 90

## Escalation Status
- none

## Owner And Mode
- owner: human
- mode: waiting

## Capacity State
- target: 90
- current: 51
- gap: 39
- reached: false
- state: waiting
- loop_action: continue
- continue_recommended: true
- primary_reason: operator_requested_gcp_capacity_recovery
- gcp_capacity_recovery_requested: true

## Automation Route Guidance
- recommended_mode: api-first-with-agent-fallback
- primary_path_type: api-path
- primary_surfaces: n8n-router, supabase-hot-state
- fallback_surfaces: gcpcompute-shared-mcp, hermes-local-operator
- hot_state: Supabase workflow sessions/events remain the shared hot-state plane.
- orchestration: n8n is available for trigger routing, waits, retries, and webhook glue.
- semantic_owner: Promote durable conclusions into Obsidian after runtime execution settles.
- artifact_plane: GitHub remains the repo-visible artifact, review, and settlement plane for code, docs, CI evidence, and merge history.
- candidate_apis: youtube-community-scrape
- candidate_mcp_tools: none
- matched_examples: youtube-community-post-handoff
- escalation_required: false
- escalation_target: none
- escalation_reason: Current API and fallback surfaces are sufficient for bounded automation.

## MCP Wrapping Guidance
- local_pattern: ext.<adapterId>.<capability>
- shared_pattern: upstream.<namespace>.<tool>
`, 'utf8');

    try {
      const status = await buildStatusPayload({
        summary: {},
        launch: {},
        loopState: {},
        sessionPath: null,
        vaultPath,
        capacityTarget: 90,
        gcpCapacityRecoveryRequested: false,
        runtimeLane: 'operator-personal',
        workstreamState: {
          ok: false,
          reason: 'not_found',
          source: 'unavailable',
          sessionPath: null,
          session: null,
        },
      });

      expect(status.capacity).toBeTruthy();
      if (!status.capacity) {
        throw new Error('expected capacity payload');
      }
      const capacity = status.capacity as {
        gcp_capacity_recovery_requested: boolean;
        loop_action: string;
      };

      expect(status.resume_state.next_action).toBe('wait for the next gpt objective or human approval boundary');
      expect(status.resume_state.gcp_capacity_recovery_requested).toBe(false);
      expect(status.resume_state.reason).toBe('packet_waiting_for_next_gpt_objective');
      expect(status.resume_state.automation_route).toMatchObject({
        recommended_mode: 'api-first-with-agent-fallback',
        matched_examples: ['youtube-community-post-handoff'],
        hot_state: 'Supabase workflow sessions/events remain the shared hot-state plane.',
        artifact_plane: 'GitHub remains the repo-visible artifact, review, and settlement plane for code, docs, CI evidence, and merge history.',
        candidate_apis: ['youtube-community-scrape'],
        local_pattern: 'ext.<adapterId>.<capability>',
        shared_pattern: 'upstream.<namespace>.<tool>',
      });
      expect(status.automation_route).toMatchObject({
        recommended_mode: 'api-first-with-agent-fallback',
        primary_surfaces: ['n8n-router', 'supabase-hot-state'],
        fallback_surfaces: ['gcpcompute-shared-mcp', 'hermes-local-operator'],
      });
      expect(capacity.gcp_capacity_recovery_requested).toBe(false);
      expect(capacity.loop_action).toBe('wait');
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('marks released workstreams as directly resumable when auto restart on release is enabled', async () => {
    const session = {
      session_id: 'remote-session-auto-restart',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-12T10:00:00.000Z',
      completed_at: '2026-04-12T10:01:00.000Z',
      metadata: {
        objective: 'schedule youtube community automation loop',
        route_mode: 'delivery',
        runtime_lane: 'operator-personal',
        auto_restart_on_release: true,
      },
      events: [],
      steps: [
        {
          step_name: 'delivery-cycle',
          status: 'passed',
          agent_role: 'openjarvis',
          duration_ms: 250,
          details: {
            route_mode: 'delivery',
          },
        },
      ],
    };

    const status = await buildStatusPayload({
      summary: {},
      launch: {},
      loopState: {
        status: 'running',
        launches_completed: 1,
        auto_select_queued_objective: true,
        auto_launch_queued_chat: true,
      },
      capacityTarget: 90,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      workstreamState: {
        ok: true,
        source: 'supabase',
        sessionPath: null,
        session,
      },
      resumeState: deriveResumeStateFromWorkflowSession(session, {
        source: 'supabase-workstream',
        gcpCapacityRecoveryRequested: false,
        capacityTarget: 90,
        runtimeLane: 'operator-personal',
        waitBoundaryAction: 'wait for the next gpt objective or human approval boundary',
      }),
    });

    expect(status.workflow.auto_restart_on_release).toBe(true);
    expect(status.supervisor).toMatchObject({
      auto_select_queued_objective: true,
      auto_launch_queued_chat: true,
    });
    expect(status.resume_state).toMatchObject({
      resumable: true,
      owner: 'hermes',
      mode: 'observing',
      next_action: 'restart the next bounded automation cycle from the active objective',
      reason: 'workstream_auto_restart_ready',
      auto_restart_on_release: true,
    });
    expect(status.capacity).toBeTruthy();
    if (!status.capacity) {
      throw new Error('expected capacity payload');
    }
    const capacity = status.capacity as { loop_action: string; primary_reason: string };
    expect(capacity.loop_action).toBe('continue');
    expect(capacity.primary_reason).toBe('capacity_below_target');
  });

  it('fills workflow objective from resume state when the workstream metadata only contains a placeholder', async () => {
    const session = {
      session_id: 'remote-session-placeholder-objective',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-16T00:00:00.000Z',
      completed_at: '2026-04-16T00:01:00.000Z',
      metadata: {
        objective: 'none',
        route_mode: 'delivery',
        runtime_lane: 'operator-personal',
        auto_restart_on_release: true,
      },
      events: [],
      steps: [],
    };

    const status = await buildStatusPayload({
      summary: {},
      launch: {},
      loopState: {
        status: 'running',
        auto_select_queued_objective: true,
        auto_launch_queued_chat: true,
      },
      capacityTarget: 90,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      workstreamState: {
        ok: true,
        source: 'supabase',
        sessionPath: null,
        session,
      },
      resumeState: {
        owner: 'hermes',
        mode: 'observing',
        objective: 'stabilize queue-aware supervisor visibility',
        next_action: 'restart the next bounded automation cycle from the active objective',
        resumable: true,
        reason: 'workstream_auto_restart_ready',
        escalation_status: 'none',
        auto_restart_on_release: true,
        safe_queue: ['stabilize queue-aware supervisor visibility'],
      },
    });

    expect(status.workflow.objective).toBe('stabilize queue-aware supervisor visibility');
    expect(status.resume_state).toMatchObject({
      objective: 'stabilize queue-aware supervisor visibility',
      available: true,
    });

    const bundle = buildSessionOpenBundle({ status });
    expect(bundle.objective).toBe('stabilize queue-aware supervisor visibility');
    expect(bundle.activation_pack.target_objective).toBe(status.autonomous_goal_candidates[0]?.objective);
  });

  it('merges packet safe queue objectives into live workstream resume state', async () => {
    const vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'muel-openjarvis-safe-queue-'));
    const executionDir = path.join(vaultPath, 'plans', 'execution');
    await fs.mkdir(executionDir, { recursive: true });

    await fs.writeFile(path.join(executionDir, 'HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md'), `---
objective: "recover canonical GCP always-on lane and Render deploy readiness"
---

## Session Objective
- recover canonical GCP always-on lane and Render deploy readiness

## Safe Autonomous Queue For Hermes
- document API-first and agent-fallback tool-layer optimization slice
`, 'utf8');

    await fs.writeFile(path.join(executionDir, 'HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'), `---
objective: "recover canonical GCP always-on lane and Render deploy readiness"
automation_auto_restart_on_release: true
---

## Next Action
- restart the next bounded automation cycle from the active objective

## Escalation Status
- none

## Owner And Mode
- owner: hermes
- mode: observing
`, 'utf8');

    const session = {
      session_id: 'remote-session-safe-queue-1',
      workflow_name: 'openjarvis.unattended',
      scope: 'interactive:goal',
      stage: 'interactive',
      status: 'released',
      started_at: '2026-04-12T10:00:00.000Z',
      completed_at: '2026-04-12T10:01:00.000Z',
      metadata: {
        objective: 'recover canonical GCP always-on lane and Render deploy readiness',
        route_mode: 'operations',
        runtime_lane: 'operator-personal',
        auto_restart_on_release: true,
      },
      events: [],
      steps: [],
    };

    try {
      const status = await buildStatusPayload({
        summary: {},
        launch: {},
        loopState: {
          status: 'running',
          launches_completed: 1,
          auto_select_queued_objective: true,
          auto_launch_queued_chat: true,
        },
        vaultPath,
        capacityTarget: 90,
        gcpCapacityRecoveryRequested: false,
        runtimeLane: 'operator-personal',
        workstreamState: {
          ok: true,
          source: 'supabase',
          sessionPath: null,
          session,
        },
      });

      expect(status.resume_state.safe_queue).toEqual(expect.arrayContaining([
        'document API-first and agent-fallback tool-layer optimization slice',
      ]));
      expect(status.autonomous_goal_candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
          source: 'execution-board-focus',
        }),
      ]));
    } finally {
      await fs.rm(vaultPath, { recursive: true, force: true });
    }
  });

  it('allows one auto-restart launch per released workflow session id', () => {
    const resumeState = {
      objective: 'schedule youtube community automation loop',
      resumable: true,
      session_id: 'released-session-1',
      fingerprint: 'schedule youtube community automation loop|restart the next bounded automation cycle from the active objective',
      auto_restart_on_release: true,
    };

    expect(canLaunchContinuousLoopResume({
      resumeState,
      resumeFromPackets: false,
      autoRestartOnRelease: true,
      lastResumeLaunchIdentity: null,
    })).toMatchObject({
      allowed: true,
      identity: 'released-session-1',
    });

    expect(canLaunchContinuousLoopResume({
      resumeState,
      resumeFromPackets: false,
      autoRestartOnRelease: true,
      lastResumeLaunchIdentity: 'released-session-1',
    })).toMatchObject({
      allowed: false,
      identity: 'released-session-1',
    });

    expect(canLaunchContinuousLoopResume({
      resumeState: {
        ...resumeState,
        session_id: 'released-session-2',
      },
      resumeFromPackets: false,
      autoRestartOnRelease: true,
      lastResumeLaunchIdentity: 'released-session-1',
    })).toMatchObject({
      allowed: true,
      identity: 'released-session-2',
    });
  });

  it('builds a compact session-open bundle from hot-state and personalization', () => {
    const bundle = buildSessionOpenBundle({
      status: {
        ok: true,
        summary_path: 'tmp/autonomy/openjarvis-unattended-last-run.json',
        workflow: {
          session_id: 'remote-session-auto-restart',
          source: 'supabase',
          runtime_lane: 'operator-personal',
          workflow_name: 'openjarvis.unattended',
          status: 'released',
          scope: 'interactive:goal',
          stage: 'interactive',
          objective: 'schedule youtube community automation loop',
          route_mode: 'delivery',
          started_at: '2026-04-12T10:00:00.000Z',
          completed_at: '2026-04-12T10:01:00.000Z',
          execution_health: null,
          lastRecallRequest: null,
          lastDecisionDistillate: {
            summary: 'Pipeline released after 1 bounded step.',
            nextAction: 'promote durable operator-visible outcomes into Obsidian if the result should persist',
            promoteAs: 'development_slice',
            tags: ['released'],
          },
          lastArtifactRefs: [
            {
              locator: 'docs/CHANGELOG-ARCH.md',
              refKind: 'repo-file',
              title: 'Architecture changelog',
              artifactPlane: 'github',
              githubSettlementKind: 'repo-file',
              sourceStepName: 'delivery-cycle',
            },
          ],
        },
        launch: null,
        supervisor: {
          status: 'stopped',
          auto_select_queued_objective: true,
          launches_completed: 2,
          stop_reason: 'max_cycles_reached',
          last_launch: {
            source: 'packet-resume',
            launched_at: '2026-04-12T10:01:05.000Z',
          },
        },
        result: {
          final_status: 'released',
          step_count: 4,
          failed_steps: 0,
          latest_gate_decision: null,
          deploy_status: null,
          stale_execution_suspected: false,
        },
        capacity: {
          target: 90,
          score: 72,
          state: 'advancing',
          loop_action: 'continue',
          primary_reason: 'workstream_auto_restart_ready',
          continue_recommended: true,
        },
        resume_state: {
          owner: 'hermes',
          mode: 'observing',
          next_action: 'restart the next bounded automation cycle from the active objective',
          resumable: true,
          reason: 'workstream_auto_restart_ready',
          escalation_status: 'none',
          auto_restart_on_release: true,
          safe_queue: [
            'keep workflow session, launch state, and summary aligned',
            'restart the next bounded automation cycle after release unless an escalation boundary appears',
          ],
          progress_packet_relative_path: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md',
          handoff_packet_relative_path: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
        },
        automation_route: {
          recommended_mode: 'api-first-with-agent-fallback',
          primary_path_type: 'api-path',
          primary_surfaces: ['n8n-router', 'supabase-hot-state'],
          fallback_surfaces: ['hermes-local-operator'],
          hot_state: 'Supabase workflow sessions/events remain the shared hot-state plane.',
          orchestration: 'n8n is available for trigger routing, waits, retries, and webhook glue.',
          semantic_owner: 'Promote durable conclusions into Obsidian after runtime execution settles.',
          artifact_plane: 'GitHub remains the repo-visible artifact, review, and settlement plane for code, docs, CI evidence, and merge history.',
          candidate_apis: ['youtube-community-scrape'],
          candidate_mcp_tools: ['upstream.gcpcompute.internal_knowledge_resolve'],
          matched_examples: ['youtube-community-post-handoff'],
          escalation_required: false,
          escalation_target: 'none',
        },
        continuity_packets: null,
        gcp_capacity_recovery_requested: false,
        gcp_native: null,
        autonomous_goal_candidates: [
          {
            objective: 'stabilize shared MCP teammate bootstrap hardening',
            source: 'safe-queue',
            milestone: null,
            source_path: null,
            fingerprint: 'safe-queue:stabilize shared mcp teammate bootstrap hardening',
          },
        ],
        vscode_cli: null,
        steps: [],
      },
      personalizationSnapshot: {
        effective: {
          priority: 'precise',
          providerProfile: 'quality-optimized',
          retrievalProfile: 'graph_lore',
        },
        persona: {
          communicationStyle: 'concise',
          preferredTopics: ['ops', 'automation'],
        },
        promptHints: ['[personalization:profile] style=concise | topics=ops, automation'],
      },
    });

    expect(bundle).toMatchObject({
      objective: 'schedule youtube community automation loop',
      route_mode: 'delivery',
      continuity: {
        owner: 'hermes',
        resumable: true,
        auto_restart_on_release: true,
      },
      routing: {
        recommended_mode: 'api-first-with-agent-fallback',
        hot_state: 'Supabase workflow sessions/events remain the shared hot-state plane.',
        semantic_owner: 'Promote durable conclusions into Obsidian after runtime execution settles.',
        artifact_plane: 'GitHub remains the repo-visible artifact, review, and settlement plane for code, docs, CI evidence, and merge history.',
        candidate_mcp_tools: ['upstream.gcpcompute.internal_knowledge_resolve'],
        matched_examples: ['youtube-community-post-handoff'],
      },
      hermes_runtime: {
        target_role: 'persistent-local-operator',
        current_role: 'continuity-sidecar',
        readiness: 'partial',
        can_continue_without_gpt_session: true,
        queue_enabled: true,
        supervisor_alive: false,
        has_hot_state: true,
        local_operator_surface: true,
        ide_handoff_observed: false,
        queued_objectives_available: true,
      },
      activation_pack: {
        target_objective: 'stabilize shared MCP teammate bootstrap hardening',
        objective_class: 'shared-mcp-bootstrap',
        tool_calls: expect.arrayContaining(['automation.route.preview', 'automation.capability.catalog']),
        mcp_surfaces: expect.arrayContaining(['external-mcp-wrappers']),
      },
      orchestration: {
        current_priority: 'compact-bootstrap-first',
        advisor_strategy: {
          posture: 'conditional-escalation',
          max_advisor_uses: 1,
        },
      },
      compact_bootstrap: {
        posture: 'small-bundle-first',
        start_with: ['objective', 'hermes_runtime', 'decision', 'next_queue'],
        objective: 'schedule youtube community automation loop',
        hermes_readiness: 'partial',
        latest_decision_distillate: 'Pipeline released after 1 bounded step.',
        next_queue_head: 'stabilize shared MCP teammate bootstrap hardening',
        defer_large_docs_until_ambiguous: true,
      },
      autonomous_queue: {
        enabled: true,
        candidates: [
          {
            objective: 'stabilize shared MCP teammate bootstrap hardening',
            source: 'safe-queue',
          },
        ],
      },
      supervisor: {
        launches_completed: 2,
        last_launch_source: 'packet-resume',
      },
      personalization: {
        priority: 'precise',
        provider_profile: 'quality-optimized',
        retrieval_profile: 'graph_lore',
        communication_style: 'concise',
      },
    });
    expect(bundle.compact_bootstrap.open_later).toContain('progress-packet:plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md');
    expect(bundle.capability_demands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        summary: 'No live supervisor is holding the local continuity loop open right now.',
        objective: 'stabilize shared MCP teammate bootstrap hardening',
        proposed_owner: 'hermes',
      }),
    ]));
    expect(bundle.evidence_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        locator: 'docs/CHANGELOG-ARCH.md',
        refKind: 'repo-file',
        artifactPlane: 'github',
        githubSettlementKind: 'repo-file',
      }),
    ]));
    expect(bundle.read_first).toContain('progress-packet:plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md');
    expect(bundle.read_first).toContain('unattended-summary:tmp/autonomy/openjarvis-unattended-last-run.json');
    expect(bundle.read_first).toContain('next-objective:stabilize shared MCP teammate bootstrap hardening');
    expect(bundle.read_first).toContain('hermes-runtime:partial');
    expect(bundle.hermes_runtime).toMatchObject({
      target_role: 'persistent-local-operator',
      current_role: 'continuity-sidecar',
      readiness: 'partial',
      can_continue_without_gpt_session: true,
      queue_enabled: true,
      supervisor_alive: false,
      local_operator_surface: true,
    });
    expect(bundle.hermes_runtime.blockers).toEqual(expect.arrayContaining([
      'No live supervisor is holding the local continuity loop open right now.',
    ]));
    expect(bundle.hermes_runtime.next_actions).toEqual(expect.arrayContaining([
      'Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.',
    ]));
    expect(bundle.hermes_runtime.remediation_actions.map((entry: { action_id: string }) => entry.action_id)).toEqual(
      expect.arrayContaining(['start-supervisor-loop', 'open-progress-packet']),
    );
    expect(bundle.activation_pack.read_next).toContain('docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md');
    expect(bundle.activation_pack.recommended_skills.map((entry) => entry.skill_id)).toEqual(
      expect.arrayContaining(['plan', 'obsidian-knowledge']),
    );
    expect(bundle.activation_pack.tool_calls).toContain('automation.route.preview');
    expect(bundle.activation_pack.fallback_order).toContain('n8n-router');
  });

  it('falls back to the first autonomous goal candidate when the bundle workflow objective is still a placeholder', () => {
    const bundle = buildSessionOpenBundle({
      status: {
        workflow: {
          objective: 'none',
          route_mode: 'delivery',
          runtime_lane: 'operator-personal',
          lastArtifactRefs: [],
        },
        result: {
          final_status: 'released',
          failed_steps: 0,
          step_count: 1,
        },
        capacity: {},
        resume_state: {
          objective: 'none',
          safe_queue: [],
        },
        automation_route: {},
        supervisor: {},
        hermes_runtime: {
          target_role: 'persistent-local-operator',
          current_role: 'continuity-sidecar',
          readiness: 'ready',
          can_continue_without_gpt_session: true,
          queue_enabled: true,
          supervisor_alive: true,
          has_hot_state: true,
          local_operator_surface: true,
          ide_handoff_observed: true,
          queued_objectives_available: true,
          strengths: [],
          blockers: [],
          next_actions: [],
          remediation_actions: [],
        },
        autonomous_goal_candidates: [
          {
            objective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
            source: 'execution-board-focus',
            milestone: 'M-21',
            source_path: 'docs/planning/EXECUTION_BOARD.md',
          },
        ],
      },
    });

    expect(bundle.objective).toBe('코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상');
    expect(bundle.activation_pack.target_objective).toBe('코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상');
  });

  it('derives autonomous goal candidates from safe queue and queued execution board items when no focus override is present', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'muel-openjarvis-execution-board-'));
    const executionBoardPath = path.join(workspaceDir, 'EXECUTION_BOARD.md');

    await fs.writeFile(executionBoardPath, `# Execution Board

## Active Now (WIP <= 3)

1. [M-19] User CRM 심화 + Social Graph 고도화
2. [M-20] LLM 레이턴시 SLO 자동 Fallback

## Queued Now (Approved, Not In Active WIP)

1. [M-23] Operator docs lightweighting
`, 'utf8');

    try {
      const candidates = buildAutonomousGoalCandidates({
        resumeState: {
          objective: 'recover canonical GCP lane and Render readiness',
          safe_queue: [
            'keep workflow session, launch state, and summary aligned',
            'keep launch manifest/log, workflow session, and summary aligned',
            'refresh the active progress packet on session transitions and completion',
            'only escalate into fallback surfaces after an explicit router miss, ambiguity, or parser drift: hermes-local-operator, local-workstation-executor',
            'persist route decisions, artifact refs, and compact distillates after each fallback cycle',
            'stabilize shared MCP teammate bootstrap hardening',
          ],
        },
        executionBoardPath,
      });

      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          objective: 'stabilize shared MCP teammate bootstrap hardening',
          source: 'safe-queue',
        }),
        expect.objectContaining({
          objective: 'Operator docs lightweighting',
          source: 'execution-board-queued',
          milestone: 'M-23',
        }),
      ]));
      expect(readExecutionBoardQueuedObjectives(executionBoardPath)).toEqual([
        expect.objectContaining({
          objective: 'Operator docs lightweighting',
          milestone: 'M-23',
        }),
      ]);
      expect(pickAutonomousGoalCandidate({
        candidates,
        consumedFingerprints: ['safe-queue:stabilize shared mcp teammate bootstrap hardening'],
      })).toEqual(expect.objectContaining({
        objective: 'Operator docs lightweighting',
        source: 'execution-board-queued',
      }));
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('pins autonomous goal candidates to the single execution-board focus override', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'muel-openjarvis-focus-board-'));
    const executionBoardPath = path.join(workspaceDir, 'EXECUTION_BOARD.md');

    await fs.writeFile(executionBoardPath, `# Execution Board

## Autonomous Focus (Single Objective Override)

1. [M-21] 코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상

## Active Now (WIP <= 3)

1. [M-19] User CRM 심화 + Social Graph 고도화

## Queued Now (Approved, Not In Active WIP)

1. [M-23] Operator docs lightweighting
`, 'utf8');

    try {
      const candidates = buildAutonomousGoalCandidates({
        resumeState: {
          objective: 'recover canonical GCP lane and Render readiness',
          safe_queue: [
            'stabilize shared MCP teammate bootstrap hardening',
            'operator docs lightweighting',
          ],
        },
        executionBoardPath,
      });

      expect(readExecutionBoardFocusedObjectives(executionBoardPath)).toEqual([
        expect.objectContaining({
          objective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
          source: 'execution-board-focus',
          milestone: 'M-21',
        }),
      ]);
      expect(candidates).toEqual([
        expect.objectContaining({
          objective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
          source: 'execution-board-focus',
          milestone: 'M-21',
        }),
      ]);
      expect(buildAutonomousGoalCandidates({
        resumeState: {
          objective: '코드베이스 복잡도 축소 + 결함 제거 + 유지보수성 향상',
          safe_queue: ['stabilize shared MCP teammate bootstrap hardening'],
        },
        executionBoardPath,
      })).toEqual([
        expect.objectContaining({
          objective: 'stabilize shared MCP teammate bootstrap hardening',
          source: 'safe-queue',
        }),
      ]);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it('treats zero loop limits as unbounded for overnight automation', () => {
    expect(normalizeLoopLimit('0', 3)).toBe(Number.POSITIVE_INFINITY);
    expect(normalizeLoopLimit('0', 120)).toBe(Number.POSITIVE_INFINITY);
    expect(normalizeLoopLimit('5', 3)).toBe(5);
  });

  it('forces operations route when GCP capacity recovery is explicitly requested from auto mode', () => {
    expect(resolveGoalCycleRouteMode('auto', true)).toBe('operations');
    expect(resolveGoalCycleRouteMode('delivery', true)).toBe('delivery');
  });

  it('passes the queued-chat relaunch flag through child goal-cycle launch args', () => {
    const args = buildGoalCycleLaunchArgs({
      objective: 'stabilize the next GPT relaunch objective',
      dryRun: false,
      autoDeploy: false,
      strict: true,
      routeMode: 'delivery',
      scope: 'interactive:goal',
      stage: 'interactive',
      runtimeLane: 'operator-personal',
      autoRestartOnRelease: true,
      resumeFromPackets: true,
      forceResume: false,
      continuousLoop: true,
      vaultPath: 'C:/vault',
      idleSeconds: 45,
      maxCycles: Number.POSITIVE_INFINITY,
      maxIdleChecks: Number.POSITIVE_INFINITY,
      capacityTarget: 90,
      continueUntilCapacity: false,
      gcpCapacityRecoveryRequested: false,
      autoSelectQueuedObjective: true,
      autoLaunchQueuedChat: true,
      autoOpenResumePacket: true,
    });

    expect(args).toContain('--autoLaunchQueuedChat=true');
  });

  it('passes the queued-swarm relaunch settings through child goal-cycle launch args', () => {
    const args = buildGoalCycleLaunchArgs({
      objective: 'stabilize the next GPT relaunch objective',
      dryRun: false,
      autoDeploy: false,
      strict: true,
      routeMode: 'delivery',
      scope: 'interactive:goal',
      stage: 'interactive',
      runtimeLane: 'operator-personal',
      autoRestartOnRelease: true,
      resumeFromPackets: true,
      forceResume: false,
      continuousLoop: true,
      vaultPath: 'C:/vault',
      idleSeconds: 45,
      maxCycles: Number.POSITIVE_INFINITY,
      maxIdleChecks: Number.POSITIVE_INFINITY,
      capacityTarget: 90,
      continueUntilCapacity: false,
      gcpCapacityRecoveryRequested: false,
      autoSelectQueuedObjective: true,
      autoLaunchQueuedSwarm: true,
      autoLaunchQueuedSwarmIncludeDistiller: true,
      autoLaunchQueuedSwarmExecutorWorktreePath: 'C:/Muel_S/wt/swarm-executor',
      autoLaunchQueuedSwarmExecutorArtifactBudget: ['tests', 'docs'],
      autoOpenResumePacket: true,
    });

    expect(args).toContain('--autoLaunchQueuedSwarm=true');
    expect(args).toContain('--autoLaunchQueuedSwarmIncludeDistiller=true');
    expect(args).toContain('--autoLaunchQueuedSwarmExecutorWorktreePath=C:/Muel_S/wt/swarm-executor');
    expect(args).toContain('--autoLaunchQueuedSwarmExecutorArtifactBudget=tests,docs');
  });

  it('returns a preview instead of launching a visible terminal during dry runs', () => {
    const launch = launchVisibleWindowsPowerShell({
      objective: 'stabilize shared wrapper readiness',
      dryRun: true,
      autoDeploy: false,
      strict: true,
      routeMode: 'operations',
      scope: 'interactive:goal',
      stage: 'interactive',
      runtimeLane: 'operator-personal',
      resumeFromPackets: true,
      forceResume: false,
      continuousLoop: true,
      idleSeconds: 45,
      maxCycles: Number.POSITIVE_INFINITY,
      maxIdleChecks: Number.POSITIVE_INFINITY,
      autoRestartOnRelease: true,
      capacityTarget: 90,
      continueUntilCapacity: false,
      autoSelectQueuedObjective: true,
      autoLaunchQueuedChat: false,
      autoLaunchQueuedChatContextProfile: null,
      autoLaunchQueuedSwarm: true,
      autoLaunchQueuedSwarmIncludeDistiller: true,
      autoLaunchQueuedSwarmExecutorWorktreePath: 'C:/Muel_S/wt/swarm-executor',
      autoLaunchQueuedSwarmExecutorArtifactBudget: ['tests', 'docs'],
      gcpCapacityRecoveryRequested: false,
      vaultPath: null,
      resumeState: null,
      autoOpenResumePacket: false,
    });

    expect(launch).toMatchObject({
      ok: true,
      exit_code: 0,
      completion: 'skipped',
      launched_visible_terminal: false,
      terminal_pid: null,
      runner_pid: null,
      manifest_path: null,
      log_path: null,
      auto_launch_queued_swarm: true,
      auto_launch_queued_swarm_include_distiller: true,
      auto_launch_queued_swarm_executor_artifact_budget: ['tests', 'docs'],
      resume_from_packets: true,
      vscode_bridge: null,
    });
  });

  it('does not write continuity loop state during continuous-loop dry runs', async () => {
    const loopStatePath = path.resolve('tmp', 'autonomy', 'launches', 'latest-interactive-goal-loop.json');
    const originalLoopState = await fs.readFile(loopStatePath, 'utf8').catch(() => null);

    const loop = await runContinuousLoop({
      objective: 'preview bounded continuity restart only',
      dryRun: true,
      autoDeploy: false,
      strict: true,
      routeMode: 'operations',
      scope: 'interactive:goal',
      stage: 'interactive',
      runtimeLane: 'operator-personal',
      sessionPath: null,
      vaultPath: null,
      resumeFromPackets: false,
      forceResume: false,
      idleSeconds: 0,
      maxCycles: 0,
      maxIdleChecks: 0,
      continueUntilCapacity: false,
      autoSelectQueuedObjective: false,
      autoLaunchQueuedChat: false,
      autoLaunchQueuedChatContextProfile: null,
      autoLaunchQueuedSwarm: false,
      autoLaunchQueuedSwarmIncludeDistiller: false,
      autoLaunchQueuedSwarmExecutorWorktreePath: null,
      autoLaunchQueuedSwarmExecutorArtifactBudget: [],
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      vscodeBridge: null,
      autoRestartOnRelease: false,
    });

    expect(loop).toMatchObject({
      ok: true,
      continuous_loop: true,
      stop_reason: 'max_cycles_reached',
      launches_completed: 0,
      idle_checks: 0,
      loop_state_path: null,
    });
    const nextLoopState = await fs.readFile(loopStatePath, 'utf8').catch(() => null);
    expect(nextLoopState).toBe(originalLoopState);
  });

  it('injects a GCP health step into unattended operations runs before memory sync', () => {
    const steps = buildWorkflowStepsForRun({
      workflowSteps: [
        {
          id: 'weekly-report-all',
          script: 'gates:weekly-report:all',
          scriptDry: 'gates:weekly-report:all:dry',
          classification: 'implement',
          agentRole: 'opencode',
          handoffFrom: 'openjarvis',
          handoffTo: 'opencode',
          reason: 'collect weekly artifacts',
        },
        {
          id: 'openjarvis-memory-sync',
          script: 'openjarvis:memory:sync',
          scriptDry: 'openjarvis:memory:sync:dry',
          classification: 'discover',
          agentRole: 'openjarvis',
          handoffFrom: 'opencode',
          handoffTo: 'openjarvis',
          reason: 'project context into OpenJarvis memory',
        },
      ],
    }, {
      routeMode: 'operations',
      objective: 'recover canonical GCP lane and Render readiness',
      gcpCapacityRecoveryRequested: true,
    });

    expect(steps.map((step: { id: string }) => step.id)).toEqual([
      'weekly-report-all',
      'gcp-worker-cost-health',
      'openjarvis-memory-sync',
    ]);
    expect(steps[1]).toMatchObject({
      script: 'ops:gcp:report:weekly',
      scriptDry: 'ops:gcp:report:weekly',
      classification: 'discover',
    });
  });

  it('extracts the final JSON payload when helper stdout contains log lines first', () => {
    const parsed = parseJsonCommandOutput([
      '{"level":"info","message":"bridge started"}',
      '{',
      '  "ok": true,',
      '  "action": "chat-launch"',
      '}',
    ].join('\n'), null);

    expect(parsed).toEqual({ ok: true, action: 'chat-launch' });
  });

  it('preserves the JSON payload when helper stdout has trailing non-JSON text', () => {
    const parsed = parseJsonCommandOutput('{"ok":true,"action":"queue-objective"}\n[info] trailing note', null);

    expect(parsed).toEqual({ ok: true, action: 'queue-objective' });
  });

  it('treats mixed routing as continuity-healthy when local mirrors and core capabilities are available', () => {
    const normalized = normalizeContinuityObsidianHealth({
      healthy: false,
      issues: ['Remote MCP and direct vault adapters are mixed across capabilities (write=remote-mcp, read=local-fs, search=local-fs)'],
      adapterStatus: {
        accessPosture: {
          mode: 'mixed-routing',
          summary: 'Remote MCP and direct vault adapters are mixed across capabilities (write=remote-mcp, read=local-fs, search=local-fs)',
        },
      },
      writeCapable: true,
      readCapable: true,
      searchCapable: true,
      remoteMcp: {},
    } as any, 'C:/Users/fancy/Documents/Obsidian Vault');

    expect(normalized.healthy).toBe(true);
    expect(normalized.issues).toEqual([]);
    expect(normalized.warnings).toEqual([
      'Remote MCP and direct vault adapters are mixed across capabilities (write=remote-mcp, read=local-fs, search=local-fs)',
    ]);
  });
});