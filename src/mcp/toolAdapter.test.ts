import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRunGoalPipeline } = vi.hoisted(() => ({
  mockRunGoalPipeline: vi.fn(),
}));

const {
  mockBuildAutomationCapabilityCatalog,
  mockBuildAutomationOptimizerPlan,
  mockBuildAutomationWorkflowDraft,
  mockPreviewApiFirstAgentFallbackRoute,
  mockGetOpenJarvisAutopilotStatus,
  mockGetOpenJarvisMemorySyncStatus,
  mockResolveAgentPersonalizationSnapshot,
  mockGetOpenJarvisSessionOpenBundle,
  mockCreateOpenJarvisHermesRuntimeChatNote,
  mockEnqueueOpenJarvisHermesRuntimeObjectives,
  mockLaunchOpenJarvisHermesChatSession,
  mockPrepareOpenJarvisHermesSessionStart,
  mockRunOpenJarvisMemorySync,
  mockRunOpenJarvisHermesRuntimeRemediation,
} = vi.hoisted(() => ({
  mockBuildAutomationCapabilityCatalog: vi.fn(),
  mockBuildAutomationOptimizerPlan: vi.fn(),
  mockBuildAutomationWorkflowDraft: vi.fn(),
  mockPreviewApiFirstAgentFallbackRoute: vi.fn(),
  mockGetOpenJarvisAutopilotStatus: vi.fn(),
  mockGetOpenJarvisMemorySyncStatus: vi.fn(),
  mockResolveAgentPersonalizationSnapshot: vi.fn(),
  mockGetOpenJarvisSessionOpenBundle: vi.fn(),
  mockCreateOpenJarvisHermesRuntimeChatNote: vi.fn(),
  mockEnqueueOpenJarvisHermesRuntimeObjectives: vi.fn(),
  mockLaunchOpenJarvisHermesChatSession: vi.fn(),
  mockPrepareOpenJarvisHermesSessionStart: vi.fn(),
  mockRunOpenJarvisMemorySync: vi.fn(),
  mockRunOpenJarvisHermesRuntimeRemediation: vi.fn(),
}));

vi.mock('../services/skills/actionRunner', () => ({
  runGoalPipeline: mockRunGoalPipeline,
}));

vi.mock('../services/skills/actions/registry', () => ({
  listActions: () => [],
  getAction: () => null,
}));

vi.mock('../config', () => ({
  NODE_ENV: 'test',
}));

vi.mock('../services/llmClient', () => ({
  generateText: vi.fn(),
  isAnyLlmConfigured: vi.fn(() => false),
  resolveLlmProvider: vi.fn(() => 'test'),
}));

vi.mock('./proxyAdapter', () => ({
  listProxiedTools: vi.fn(async () => []),
  listUpstreamDiagnostics: vi.fn(() => []),
}));

vi.mock('../services/automation/apiFirstAgentFallbackService', () => ({
  buildAutomationCapabilityCatalog: mockBuildAutomationCapabilityCatalog,
  buildAutomationOptimizerPlan: mockBuildAutomationOptimizerPlan,
  buildAutomationWorkflowDraft: mockBuildAutomationWorkflowDraft,
  previewApiFirstAgentFallbackRoute: mockPreviewApiFirstAgentFallbackRoute,
}));

vi.mock('../services/agent/agentPersonalizationService', () => ({
  resolveAgentPersonalizationSnapshot: mockResolveAgentPersonalizationSnapshot,
}));

vi.mock('../services/openjarvis/openjarvisAutopilotStatusService', () => ({
  getOpenJarvisAutopilotStatus: mockGetOpenJarvisAutopilotStatus,
  getOpenJarvisSessionOpenBundle: mockGetOpenJarvisSessionOpenBundle,
}));

vi.mock('../services/openjarvis/openjarvisMemorySyncStatusService', () => ({
  getOpenJarvisMemorySyncStatus: mockGetOpenJarvisMemorySyncStatus,
  runOpenJarvisMemorySync: mockRunOpenJarvisMemorySync,
}));

vi.mock('../services/openjarvis/openjarvisHermesRuntimeControlService', () => ({
  createOpenJarvisHermesRuntimeChatNote: mockCreateOpenJarvisHermesRuntimeChatNote,
  enqueueOpenJarvisHermesRuntimeObjectives: mockEnqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession: mockLaunchOpenJarvisHermesChatSession,
  prepareOpenJarvisHermesSessionStart: mockPrepareOpenJarvisHermesSessionStart,
  runOpenJarvisHermesRuntimeRemediation: mockRunOpenJarvisHermesRuntimeRemediation,
}));

import { callMcpTool } from './toolAdapter';

describe('toolAdapter runtime lanes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOpenJarvisAutopilotStatus.mockResolvedValue({
      hermes_runtime: {
        readiness: 'partial',
        current_role: 'continuity-sidecar',
        remediation_actions: [{ action_id: 'start-supervisor-loop' }],
      },
    });
    mockRunOpenJarvisHermesRuntimeRemediation.mockResolvedValue({
      ok: true,
      actionId: 'start-supervisor-loop',
      completion: 'queued',
      command: 'node scripts/run-openjarvis-goal-cycle.mjs --resumeFromPackets=true',
    });
    mockGetOpenJarvisMemorySyncStatus.mockReturnValue({
      configured: true,
      summaryPath: 'tmp/openjarvis-memory-feed/summary.json',
      exists: true,
      status: 'fresh',
      healthy: true,
      generatedAt: '2026-04-15T00:00:00.000Z',
      ageMinutes: 3,
      staleAfterMinutes: 1440,
      dryRun: false,
      forced: false,
      vaultPath: 'C:/vault',
      obsidianAdapterSummary: 'remote-mcp',
      supabaseAvailability: 'ok',
      counts: {
        total: 12,
        obsidian: 8,
        repo: 3,
        supabase: 1,
      },
      docs: [],
      memoryIndex: {
        attempted: true,
        status: 'completed',
        completedAt: '2026-04-15T00:00:00.000Z',
        outputSummary: 'indexed 12 docs',
        reason: null,
      },
      issues: [],
    });
    mockRunOpenJarvisMemorySync.mockResolvedValue({
      ok: true,
      dryRun: true,
      force: false,
      guildId: null,
      scriptName: 'openjarvis:memory:sync:dry',
      command: 'node --import tsx scripts/sync-openjarvis-memory.ts --dryRun=true',
      completion: 'queued',
      pid: 9876,
      startedAt: '2026-04-15T00:00:00.000Z',
      finishedAt: '2026-04-15T00:00:00.100Z',
      durationMs: 100,
      stdoutLines: [],
      stderrLines: [],
      statusBefore: mockGetOpenJarvisMemorySyncStatus(),
      statusAfter: mockGetOpenJarvisMemorySyncStatus(),
      error: null,
    });
    mockCreateOpenJarvisHermesRuntimeChatNote.mockResolvedValue({
      ok: true,
      completion: 'created',
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      requestTitle: 'Hermes Runtime Handoff',
      requestMessage: 'Review the current Hermes runtime state below.',
    });
    mockEnqueueOpenJarvisHermesRuntimeObjectives.mockResolvedValue({
      ok: true,
      completion: 'updated',
      requestedObjectives: ['stabilize the next GPT relaunch objective'],
      queuedObjectives: ['stabilize the next GPT relaunch objective'],
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });
    mockLaunchOpenJarvisHermesChatSession.mockResolvedValue({
      ok: true,
      completion: 'queued',
      objective: 'stabilize the next GPT relaunch objective',
      prompt: 'Continue the next bounded local autonomy task.',
      addFilePaths: ['docs/planning/EXECUTION_BOARD.md'],
      command: 'code chat Continue the next bounded local autonomy task.',
      pid: 4321,
    });
    mockPrepareOpenJarvisHermesSessionStart.mockResolvedValue({
      ok: true,
      completion: 'prepared',
      sharedObsidianPreferred: true,
      statusSummary: {
        readiness: 'partial',
        currentRole: 'continuity-sidecar',
        supervisorAlive: false,
        queuedObjectivesAvailable: false,
      },
      bundle: {
        objective: 'stabilize the next GPT relaunch objective',
      },
      chatNote: {
        completion: 'created',
        notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      },
      queueObjective: null,
      remediation: {
        actionId: 'start-supervisor-loop',
        completion: 'queued',
      },
    });
  });

  it('returns the hybrid automation capability catalog', async () => {
    mockBuildAutomationCapabilityCatalog.mockResolvedValue({
      model: 'API-First & Agent-Fallback',
      surfaces: [{ surfaceId: 'n8n-router' }],
      orchestrationGuidance: {
        currentPriority: 'compact-bootstrap-first',
        advisorStrategy: { recommendedByDefault: false },
      },
    });

    const result = await callMcpTool({
      name: 'automation.capability.catalog',
      arguments: { refreshUpstreams: true },
    });

    expect(result.isError).not.toBe(true);
    expect(mockBuildAutomationCapabilityCatalog).toHaveBeenCalledWith({ refreshUpstreams: true });
    expect(result.content[0]?.text).toContain('API-First & Agent-Fallback');
  });

  it('returns a route preview for hybrid automation planning', async () => {
    mockPreviewApiFirstAgentFallbackRoute.mockResolvedValue({
      objective: 'triage a customer email',
      recommendedMode: 'api-first-with-agent-fallback',
      orchestrationGuidance: {
        advisorStrategy: {
          posture: 'conditional-escalation',
        },
      },
    });

    const result = await callMcpTool({
      name: 'automation.route.preview',
      arguments: {
        objective: 'triage a customer email',
        trigger: 'webhook',
        structuredDataAvailable: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockPreviewApiFirstAgentFallbackRoute).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'triage a customer email',
      trigger: 'webhook',
      structuredDataAvailable: true,
    }));
    expect(result.content[0]?.text).toContain('api-first-with-agent-fallback');
  });

  it('returns an optimizer plan for autopilot tool-layer routing', async () => {
    mockBuildAutomationOptimizerPlan.mockResolvedValue({
      objective: 'draft a public Discord autopilot workflow',
      runtimeLane: 'public-guild',
      sharedBenefitPhase: 'constraint-only',
      dynamicWorkflowRequested: true,
      routePreview: {
        objective: 'draft a public Discord autopilot workflow',
        recommendedMode: 'api-first-with-agent-fallback',
      },
      operatingContract: {
        ingressModel: 'deterministic API first -> explicit router decision -> MCP or Hermes fallback -> GPT recall only at the acceptance boundary',
        stateOwners: {
          hotState: 'Supabase workflow sessions and workflow events remain the canonical hot-state ledger.',
          semanticOwner: 'Obsidian remains the durable semantic owner for decisions, runbooks, and architecture-significant deltas.',
          workflowRouter: 'n8n owns trigger, wait, retry, and router-node execution for deterministic automation.',
          teammateScaleOut: 'Keep shared-team scale-out as a compatibility constraint first, then promote stable wrappers into shared MCP once the contract settles.',
        },
        serviceGuardrails: ['sanitize deliverable'],
      },
      costPerformancePolicy: {
        defaultPath: 'Do not spend LLM budget on the API path unless the deterministic lookup misses or returns low confidence.',
        reasoningTier: 'Use deterministic routing first, then bounded wrapped fallback, and only then escalate to GPT when the acceptance boundary demands it.',
        escalationBoundary: 'Escalate to GPT when policy, architecture, destructive change, or unresolved ambiguity crosses the fallback boundary.',
        costControls: ['Keep waits in n8n'],
        latencyControls: ['Prefer schedule or webhook ingress plus deterministic APIs for low-latency first response.'],
      },
      observabilityPlan: {
        primaryTimeline: ['n8n trigger and execution log'],
        signals: ['workflow_event.route_selected'],
        currentGaps: ['end-to-end visual trace'],
      },
      workflowDraft: {
        runtimeLane: 'public-guild',
        changeMode: 'create-new',
        recommended: true,
        rationale: ['Public Discord traffic requires explicit deliverable sanitization and a bounded fallback contract.'],
        routerShape: 'webhook -> deterministic lookup -> explicit IF/Switch -> MCP or Hermes fallback -> structured closeout',
        currentWorkflow: {
          name: null,
          tasks: [],
        },
        starterCandidates: [
          {
            task: 'alert-dispatch',
            workflowName: 'muel local alert dispatch starter',
            fileName: 'alert-dispatch-starter.workflow.json',
            webhookPath: 'muel/alert-dispatch',
            description: 'Forward runtime alerts to a caller-supplied webhook URL.',
            manualFollowUp: 'Wire a real sink before turning on N8N_DELEGATION_ENABLED for alerts.',
          },
        ],
        stages: [],
        modificationPolicy: ['Keep waits in n8n'],
      },
      assetDelegationMatrix: [
        {
          assetId: 'supabase-hot-state',
          defaultMode: 'primary',
          currentState: 'assumed',
          ownership: 'hot mutable ledger',
          useFor: ['workflow events'],
          avoidFor: ['semantic ownership'],
          currentBottleneck: null,
          nextMove: 'persist compact route signals',
        },
      ],
      sharedEnablementPlan: {
        currentMilestone: ['Keep the first milestone local-first.'],
        futureMilestones: ['Promote stable wrappers to shared MCP.'],
        blockedBy: ['Need end-to-end observability.'],
      },
    });

    const result = await callMcpTool({
      name: 'automation.optimizer.plan',
      arguments: {
        objective: 'draft a public Discord autopilot workflow',
        trigger: 'webhook',
        runtimeLane: 'public-guild',
        dynamicWorkflowRequested: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockBuildAutomationOptimizerPlan).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'draft a public Discord autopilot workflow',
      trigger: 'webhook',
      runtimeLane: 'public-guild',
      dynamicWorkflowRequested: true,
    }));
    expect(result.content[0]?.text).toContain('public-guild');
    expect(result.content[0]?.text).toContain('supabase-hot-state');
  });

  it('returns a workflow draft with reusable starter candidates', async () => {
    mockBuildAutomationWorkflowDraft.mockResolvedValue({
      runtimeLane: 'operator-personal',
      changeMode: 'update-existing',
      recommended: true,
      rationale: ['Matched reusable n8n starter workflows: youtube-community-scrape.'],
      routerShape: 'webhook -> deterministic lookup -> explicit IF/Switch -> MCP or Hermes fallback -> structured closeout',
      currentWorkflow: {
        name: 'existing workflow',
        tasks: ['youtube-community-scrape'],
      },
      starterCandidates: [
        {
          task: 'youtube-community-scrape',
          workflowName: 'muel local youtube community scrape starter',
          fileName: 'youtube-community-scrape-starter.workflow.json',
          webhookPath: 'muel/youtube-community-scrape',
          description: 'Best-effort scrape of the latest YouTube community post.',
          manualFollowUp: 'Replace the HTML parser if YouTube page structure drifts.',
          seedPayload: { name: 'muel local youtube community scrape starter' },
        },
      ],
      stages: [],
      modificationPolicy: ['Patch router, fallback, and finalization stages only.'],
    });

    const result = await callMcpTool({
      name: 'automation.workflow.draft',
      arguments: {
        objective: 'update the YouTube community ingestion workflow',
        trigger: 'webhook',
        existingWorkflowName: 'existing workflow',
        existingWorkflowTasks: ['youtube-community-scrape'],
        includeSeedPayload: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockBuildAutomationWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({
      objective: 'update the YouTube community ingestion workflow',
      existingWorkflowName: 'existing workflow',
      includeSeedPayload: true,
    }));
    expect(result.content[0]?.text).toContain('youtube-community-scrape');
  });

  it('returns a compact session-open bundle with optional personalization', async () => {
    mockResolveAgentPersonalizationSnapshot.mockResolvedValue({
      guildId: 'guild-1',
      userId: 'user-1',
      effective: {
        priority: 'precise',
        providerProfile: 'quality-optimized',
        retrievalProfile: 'graph_lore',
      },
      persona: {
        communicationStyle: 'concise',
        preferredTopics: ['ops'],
      },
      promptHints: ['[personalization:profile] style=concise'],
    });
    mockGetOpenJarvisSessionOpenBundle.mockResolvedValue({
      bundle_version: 1,
      objective: 'triage a customer email',
      routing: { recommended_mode: 'api-first-with-agent-fallback' },
      hermes_runtime: {
        readiness: 'partial',
        current_role: 'continuity-sidecar',
        can_continue_without_gpt_session: true,
      },
      orchestration: {
        current_priority: 'compact-bootstrap-first',
        advisor_strategy: {
          posture: 'conditional-escalation',
        },
      },
      continuity: { auto_restart_on_release: true },
      personalization: { communication_style: 'concise' },
      read_first: ['progress-packet:plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
      recall_triggers: [],
    });

    const result = await callMcpTool({
      name: 'automation.session_open_bundle',
      arguments: {
        runtimeLane: 'operator-personal',
        guildId: 'guild-1',
        userId: 'user-1',
        priority: 'precise',
        skillId: 'review',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockResolveAgentPersonalizationSnapshot).toHaveBeenCalledWith({
      guildId: 'guild-1',
      userId: 'user-1',
      requestedPriority: 'precise',
      requestedSkillId: 'review',
    });
    expect(mockGetOpenJarvisSessionOpenBundle).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      personalizationSnapshot: expect.objectContaining({
        guildId: 'guild-1',
        userId: 'user-1',
      }),
    });
    expect(result.content[0]?.text).toContain('api-first-with-agent-fallback');
    expect(result.content[0]?.text).toContain('communication_style');
    expect(result.content[0]?.text).toContain('continuity-sidecar');
  });

  it('returns OpenJarvis memory sync status through a dedicated MCP tool', async () => {
    mockGetOpenJarvisMemorySyncStatus.mockClear();

    const result = await callMcpTool({
      name: 'automation.openjarvis.memory_sync.status',
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(mockGetOpenJarvisMemorySyncStatus).toHaveBeenCalledTimes(1);
    expect(result.content[0]?.text).toContain('openjarvis-memory-feed/summary.json');
    expect(result.content[0]?.text).toContain('"status": "fresh"');
  });

  it('queues OpenJarvis memory sync through a dedicated MCP tool', async () => {
    mockRunOpenJarvisMemorySync.mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      force: true,
      guildId: 'guild-1',
      scriptName: 'openjarvis:memory:sync',
      command: 'node --import tsx scripts/sync-openjarvis-memory.ts --force=true --guildId=guild-1',
      completion: 'queued',
      pid: 9988,
      startedAt: '2026-04-15T00:00:00.000Z',
      finishedAt: '2026-04-15T00:00:00.100Z',
      durationMs: 100,
      stdoutLines: [],
      stderrLines: [],
      statusBefore: mockGetOpenJarvisMemorySyncStatus(),
      statusAfter: mockGetOpenJarvisMemorySyncStatus(),
      error: null,
    });

    const result = await callMcpTool({
      name: 'automation.openjarvis.memory_sync.run',
      arguments: {
        dryRun: false,
        force: true,
        guildId: 'guild-1',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockRunOpenJarvisMemorySync).toHaveBeenCalledWith({
      dryRun: false,
      force: true,
      guildId: 'guild-1',
    });
    expect(result.content[0]?.text).toContain('openjarvis:memory:sync');
    expect(result.content[0]?.text).toContain('"force": true');
  });

  it('prepares the Hermes session-start lane through a dedicated MCP tool', async () => {
    const result = await callMcpTool({
      name: 'automation.session_start_prep',
      arguments: {
        objective: 'stabilize the next GPT relaunch objective',
        runtimeLane: 'operator-personal',
        startSupervisor: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockPrepareOpenJarvisHermesSessionStart).toHaveBeenCalledWith({
      objective: 'stabilize the next GPT relaunch objective',
      objectives: [],
      contextProfile: null,
      title: null,
      guildId: null,
      createChatNote: true,
      startSupervisor: true,
      dryRun: false,
      visibleTerminal: true,
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      requesterId: 'mcp-adapter',
      requesterKind: 'bearer',
    });
    expect(result.content[0]?.text).toContain('prepared');
    expect(result.content[0]?.text).toContain('start-supervisor-loop');
  });

  it('returns Hermes runtime diagnostics without the full session-open bundle', async () => {
    const result = await callMcpTool({
      name: 'automation.hermes_runtime',
      arguments: {
        runtimeLane: 'operator-personal',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockGetOpenJarvisAutopilotStatus).toHaveBeenCalledWith({
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
    });
    expect(result.content[0]?.text).toContain('continuity-sidecar');
    expect(result.content[0]?.text).toContain('start-supervisor-loop');
  });

  it('runs Hermes runtime remediation actions through a dedicated MCP tool', async () => {
    const result = await callMcpTool({
      name: 'automation.hermes_runtime.remediate',
      arguments: {
        actionId: 'start-supervisor-loop',
        runtimeLane: 'operator-personal',
        visibleTerminal: true,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockRunOpenJarvisHermesRuntimeRemediation).toHaveBeenCalledWith({
      actionId: 'start-supervisor-loop',
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      dryRun: false,
      visibleTerminal: true,
    });
    expect(result.content[0]?.text).toContain('start-supervisor-loop');
    expect(result.content[0]?.text).toContain('queued');
  });

  it('creates an Obsidian chat note from the Hermes runtime MCP tool', async () => {
    mockCreateOpenJarvisHermesRuntimeChatNote.mockResolvedValueOnce({
      ok: true,
      completion: 'created',
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-follow-up.md',
      notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-follow-up.md',
      requestTitle: 'Hermes Runtime Follow-up',
      requestMessage: 'Review the current Hermes runtime state below.',
    });

    const result = await callMcpTool({
      name: 'automation.hermes_runtime.chat_note',
      arguments: {
        title: 'Hermes Runtime Follow-up',
        runtimeLane: 'operator-personal',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockCreateOpenJarvisHermesRuntimeChatNote).toHaveBeenCalledWith({
      title: 'Hermes Runtime Follow-up',
      guildId: null,
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
      requesterId: 'mcp-adapter',
      requesterKind: 'bearer',
    });
    expect(result.content[0]?.text).toContain('Hermes Runtime Follow-up');
    expect(result.content[0]?.text).toContain('chat/inbox/2026-04-13/010203_hermes-runtime-follow-up.md');
  });

  it('queues the next bounded objective through the Hermes runtime MCP tool', async () => {
    const result = await callMcpTool({
      name: 'automation.hermes_runtime.queue_objective',
      arguments: {
        objective: 'stabilize the next GPT relaunch objective',
        replaceExisting: true,
        runtimeLane: 'operator-personal',
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockEnqueueOpenJarvisHermesRuntimeObjectives).toHaveBeenCalledWith({
      objective: 'stabilize the next GPT relaunch objective',
      objectives: [],
      replaceExisting: true,
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
    });
    expect(result.content[0]?.text).toContain('stabilize the next GPT relaunch objective');
    expect(result.content[0]?.text).toContain('updated');
  });

  it('launches a queued Hermes objective into VS Code chat through MCP', async () => {
    const result = await callMcpTool({
      name: 'automation.hermes_runtime.chat_launch',
      arguments: {
        objective: 'stabilize the next GPT relaunch objective',
        contextProfile: 'delegated-operator',
        runtimeLane: 'operator-personal',
        addFilePaths: ['docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md'],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(mockLaunchOpenJarvisHermesChatSession).toHaveBeenCalledWith({
      objective: 'stabilize the next GPT relaunch objective',
      prompt: null,
      chatMode: null,
      contextProfile: 'delegated-operator',
      addFilePaths: ['docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md'],
      maximize: true,
      newWindow: false,
      reuseWindow: true,
      dryRun: false,
      sessionPath: null,
      vaultPath: null,
      capacityTarget: null,
      gcpCapacityRecoveryRequested: false,
      runtimeLane: 'operator-personal',
    });
    expect(result.content[0]?.text).toContain('stabilize the next GPT relaunch objective');
    expect(result.content[0]?.text).toContain('queued');
  });
});