import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildManagedServicePlan,
  mockBuildDoctorReport,
  mockSpawnSync,
  mockRunUp,
  mockGetOpenJarvisAutopilotStatus,
  mockRunOpenJarvisHermesRuntimeRemediation,
  mockRecordWorkflowCapabilityDemands,
  mockSyncOpenJarvisContinuityPackets,
} = vi.hoisted(() => ({
  mockBuildManagedServicePlan: vi.fn(() => ({
    litellm: true,
    n8n: true,
    openjarvis: true,
    opencodeWorker: true,
    requiresOllama: true,
  })),
  mockBuildDoctorReport: vi.fn(async () => ({
    ok: true,
    failures: [] as string[],
    nextSteps: [] as string[],
    workflowState: { runtimeLane: 'operator-personal' },
  })),
  mockSpawnSync: vi.fn(() => ({ status: 0 })),
  mockRunUp: vi.fn(async () => ({
    ok: true,
    checkedAt: '2026-04-15T00:00:00.000Z',
    doctor: {
      ok: true,
      failures: [] as string[],
      nextSteps: [] as string[],
      workflowState: { runtimeLane: 'operator-personal' },
    },
  })),
  mockGetOpenJarvisAutopilotStatus: vi.fn(async () => ({
    workflow: {
      status: 'idle',
      session_id: null as string | null,
      session_path: null as string | null,
      objective: null as string | null,
      lastCapabilityDemands: [] as Array<Record<string, unknown>>,
    },
    supervisor: {
      supervisor_pid: null as number | null,
      auto_launch_queued_chat: false,
      awaiting_reentry_acknowledgment: false,
      awaiting_reentry_acknowledgment_stale: false,
      awaiting_reentry_acknowledgment_started_at: null as string | null,
    },
    hermes_runtime: {
      readiness: 'partial',
      supervisor_alive: false,
      awaiting_reentry_acknowledgment_stale: false,
      queued_objectives_available: true,
      remediation_actions: [
        { action_id: 'start-supervisor-loop' },
      ],
    },
  })),
  mockRunOpenJarvisHermesRuntimeRemediation: vi.fn(async () => ({
    ok: true,
    completion: 'queued',
    pid: 1234,
    startedAt: '2026-04-15T00:00:01.000Z',
    errorCode: null,
  })),
  mockRecordWorkflowCapabilityDemands: vi.fn(async () => ({ ok: true })),
  mockSyncOpenJarvisContinuityPackets: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../../scripts/local-ai-stack-control.mjs', () => ({
  buildManagedServicePlan: mockBuildManagedServicePlan,
  buildDoctorReport: mockBuildDoctorReport,
  runUp: mockRunUp,
}));

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock('../openjarvis/openjarvisAutopilotStatusService', () => ({
  getOpenJarvisAutopilotStatus: mockGetOpenJarvisAutopilotStatus,
}));

vi.mock('../openjarvis/openjarvisHermesRuntimeControlService', () => ({
  runOpenJarvisHermesRuntimeRemediation: mockRunOpenJarvisHermesRuntimeRemediation,
}));

vi.mock('../workflow/workflowPersistenceService', () => ({
  recordWorkflowCapabilityDemands: mockRecordWorkflowCapabilityDemands,
}));

vi.mock('../../../scripts/sync-openjarvis-continuity-packets.ts', () => ({
  syncOpenJarvisContinuityPackets: mockSyncOpenJarvisContinuityPackets,
}));

describe('localAutonomySupervisorService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('repairs the local stack before checking Hermes supervisor when doctor fails', async () => {
    mockBuildDoctorReport
      .mockResolvedValueOnce({
        ok: false,
        failures: ['Local OpenJarvis serve is enabled but /v1/models is unreachable with auth.'] as string[],
        nextSteps: ['npm run openjarvis:serve:local'] as string[],
        workflowState: { runtimeLane: 'operator-personal' },
      })
      .mockResolvedValueOnce({
        ok: true,
        failures: [] as string[],
        nextSteps: [] as string[],
        workflowState: { runtimeLane: 'operator-personal' },
      });

    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockRunUp).toHaveBeenCalledWith({
      profile: 'local-nemoclaw-max-delegation',
      applyProfileFirst: false,
      dryRun: false,
    });
    expect(summary).toContain('stack-heal:ok');
    expect(stats.lastDoctorOk).toBe(true);
    expect(stats.lastUpOk).toBe(true);
  });

  it('queues Hermes supervisor when the local stack is healthy but supervisor is down', async () => {
    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockRunOpenJarvisHermesRuntimeRemediation).toHaveBeenCalledWith({
      runtimeLane: 'operator-personal',
      actionId: 'start-supervisor-loop',
      dryRun: false,
      visibleTerminal: false,
      autoLaunchQueuedChat: true,
    });
    expect(summary).toContain('queue=ready');
    expect(summary).toContain('chat=auto');
    expect(summary).toContain('supervisor:queued:auto-chat');
    expect(stats.lastSupervisorAction).toBe('supervisor:queued:auto-chat');
    expect(stats.lastSupervisorAutoLaunchQueuedChat).toBe(true);
    expect(stats.lastSupervisorPid).toBe(1234);
  });

  it('does not requeue the supervisor while the queued GPT handoff is still awaiting reentry acknowledgment', async () => {
    mockGetOpenJarvisAutopilotStatus.mockResolvedValueOnce({
      workflow: {
        status: 'released',
        session_id: 'wf-session-awaiting-ack',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-awaiting-ack.json',
        objective: 'continue bounded queued work',
        lastCapabilityDemands: [],
      },
      supervisor: {
        supervisor_pid: null,
        auto_launch_queued_chat: true,
        awaiting_reentry_acknowledgment: true,
        awaiting_reentry_acknowledgment_stale: false,
        awaiting_reentry_acknowledgment_started_at: '2026-04-15T09:00:00.000Z',
      },
      hermes_runtime: {
        readiness: 'partial',
        supervisor_alive: false,
        awaiting_reentry_acknowledgment_stale: false,
        queued_objectives_available: true,
        remediation_actions: [
          { action_id: 'start-supervisor-loop' },
        ],
      },
    });

    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockRunOpenJarvisHermesRuntimeRemediation).not.toHaveBeenCalled();
    expect(mockSyncOpenJarvisContinuityPackets).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wf-session-awaiting-ack',
      runtimeLane: 'operator-personal',
      reason: 'local-autonomy-awaiting-reentry-ack',
    }));
    expect(summary).toContain('reentry=awaiting-ack');
    expect(summary).toContain('awaiting-packet:refreshed');
    expect(summary).toContain('supervisor:awaiting-reentry-ack');
    expect(stats.lastAwaitingReentryAcknowledgment).toBe(true);
    expect(stats.lastAwaitingReentrySyncKey).toBe('wf-session-awaiting-ack:2026-04-15T09:00:00.000Z');
    expect(stats.lastSupervisorAction).toBe('supervisor:awaiting-reentry-ack');
    expect(stats.lastSupervisorAutoLaunchQueuedChat).toBe(true);
  });

  it('surfaces stale queued reentry acknowledgment waits without requeueing the supervisor', async () => {
    mockGetOpenJarvisAutopilotStatus.mockResolvedValueOnce({
      workflow: {
        status: 'released',
        session_id: 'wf-session-stale-ack',
        session_path: 'tmp/autonomy/workflow-sessions/wf-session-stale-ack.json',
        objective: 'close out the pending queued chat turn',
        lastCapabilityDemands: [],
      },
      supervisor: {
        supervisor_pid: null,
        auto_launch_queued_chat: true,
        awaiting_reentry_acknowledgment: true,
        awaiting_reentry_acknowledgment_stale: true,
        awaiting_reentry_acknowledgment_started_at: '2026-04-15T08:45:00.000Z',
      },
      hermes_runtime: {
        readiness: 'partial',
        supervisor_alive: false,
        awaiting_reentry_acknowledgment_stale: true,
        queued_objectives_available: true,
        remediation_actions: [
          { action_id: 'start-supervisor-loop' },
        ],
      },
    });

    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockRunOpenJarvisHermesRuntimeRemediation).not.toHaveBeenCalled();
    expect(mockRecordWorkflowCapabilityDemands).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wf-session-stale-ack',
      runtimeLane: 'operator-personal',
      sourceEvent: 'local_autonomy_stale_reentry_ack',
    }));
    expect(mockSyncOpenJarvisContinuityPackets).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'wf-session-stale-ack',
      runtimeLane: 'operator-personal',
      reason: 'local-autonomy-stale-reentry-ack',
    }));
    expect(summary).toContain('reentry=stale-ack');
    expect(summary).toContain('stale-demand:recorded');
    expect(summary).toContain('stale-packet:refreshed');
    expect(summary).toContain('supervisor:awaiting-reentry-ack:stale');
    expect(stats.lastAwaitingReentryAcknowledgment).toBe(true);
    expect(stats.lastAwaitingReentryAcknowledgmentStale).toBe(true);
    expect(stats.lastStaleReentryPromotionKey).toBe('wf-session-stale-ack:2026-04-15T08:45:00.000Z');
    expect(stats.lastSupervisorAction).toBe('supervisor:awaiting-reentry-ack:stale');
  });

  it('replaces a stale manual-chat supervisor with the queue-aware auto-chat mode when the workflow is not executing', async () => {
    mockGetOpenJarvisAutopilotStatus.mockResolvedValueOnce({
      workflow: {
        status: 'released',
        session_id: null,
        session_path: null,
        objective: null,
        lastCapabilityDemands: [],
      },
      supervisor: {
        supervisor_pid: process.pid,
        auto_launch_queued_chat: false,
        awaiting_reentry_acknowledgment: false,
        awaiting_reentry_acknowledgment_stale: false,
        awaiting_reentry_acknowledgment_started_at: null,
      },
      hermes_runtime: {
        readiness: 'ready',
        supervisor_alive: true,
        awaiting_reentry_acknowledgment_stale: false,
        queued_objectives_available: true,
        remediation_actions: [],
      },
    });

    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockSpawnSync).toHaveBeenCalled();
    expect(mockRunOpenJarvisHermesRuntimeRemediation).toHaveBeenCalledWith({
      runtimeLane: 'operator-personal',
      actionId: 'start-supervisor-loop',
      dryRun: false,
      visibleTerminal: false,
      autoLaunchQueuedChat: true,
    });
    expect(summary).toContain('supervisor:manual-chat-stopped');
    expect(summary).toContain('supervisor:upgraded:auto-chat');
    expect(stats.lastSupervisorAction).toBe('supervisor:upgraded:auto-chat');
    expect(stats.lastSupervisorAutoLaunchQueuedChat).toBe(true);
    expect(stats.lastSupervisorPid).toBe(1234);
  });

  it('does not replace a manual-chat supervisor while a workflow is still executing', async () => {
    mockGetOpenJarvisAutopilotStatus.mockResolvedValueOnce({
      workflow: {
        status: 'executing',
        session_id: null,
        session_path: null,
        objective: null,
        lastCapabilityDemands: [],
      },
      supervisor: {
        supervisor_pid: process.pid,
        auto_launch_queued_chat: false,
        awaiting_reentry_acknowledgment: false,
        awaiting_reentry_acknowledgment_stale: false,
        awaiting_reentry_acknowledgment_started_at: null,
      },
      hermes_runtime: {
        readiness: 'partial',
        supervisor_alive: true,
        awaiting_reentry_acknowledgment_stale: false,
        queued_objectives_available: true,
        remediation_actions: [],
      },
    });

    const module = await import('./localAutonomySupervisorService');
    const summary = await module.runLocalAutonomySupervisorCycle();
    const stats = module.getLocalAutonomySupervisorLoopStats();

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(mockRunOpenJarvisHermesRuntimeRemediation).not.toHaveBeenCalled();
    expect(summary).toContain('chat=manual');
    expect(stats.lastSupervisorAction).toBe('supervisor:alive:manual-chat');
    expect(stats.lastSupervisorAutoLaunchQueuedChat).toBe(false);
    expect(stats.lastSupervisorPid).toBe(process.pid);
  });
});