import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetObsidianAdapterRuntimeStatus,
  mockGetObsidianVaultRoot,
  mockGetOpenJarvisAutopilotStatus,
  mockGetOpenJarvisSessionOpenBundle,
  mockBuildInboxChatNote,
  mockReadObsidianFileWithAdapter,
  mockWriteObsidianNoteWithAdapter,
  mockRunHermesVsCodeBridge,
} = vi.hoisted(() => ({
  mockGetObsidianAdapterRuntimeStatus: vi.fn(),
  mockGetObsidianVaultRoot: vi.fn(),
  mockGetOpenJarvisAutopilotStatus: vi.fn(),
  mockGetOpenJarvisSessionOpenBundle: vi.fn(),
  mockBuildInboxChatNote: vi.fn(),
  mockReadObsidianFileWithAdapter: vi.fn(),
  mockWriteObsidianNoteWithAdapter: vi.fn(),
  mockRunHermesVsCodeBridge: vi.fn(),
}));

vi.mock('../../utils/obsidianEnv', () => ({
  getObsidianVaultRoot: mockGetObsidianVaultRoot,
}));

vi.mock('./openjarvisAutopilotStatusService', () => ({
  getOpenJarvisAutopilotStatus: mockGetOpenJarvisAutopilotStatus,
  getOpenJarvisSessionOpenBundle: mockGetOpenJarvisSessionOpenBundle,
}));

vi.mock('../../routes/chat', () => ({
  buildInboxChatNote: mockBuildInboxChatNote,
}));

vi.mock('../obsidian/router', () => ({
  getObsidianAdapterRuntimeStatus: mockGetObsidianAdapterRuntimeStatus,
  readObsidianFileWithAdapter: mockReadObsidianFileWithAdapter,
  writeObsidianNoteWithAdapter: mockWriteObsidianNoteWithAdapter,
}));

vi.mock('../runtime/hermesVsCodeBridgeService', () => ({
  runHermesVsCodeBridge: mockRunHermesVsCodeBridge,
}));

import {
  createOpenJarvisHermesRuntimeChatNote,
  enqueueOpenJarvisHermesRuntimeObjectives,
  launchOpenJarvisHermesChatSession,
  prepareOpenJarvisHermesSessionStart,
} from './openjarvisHermesRuntimeControlService';

const buildStatus = () => ({
  workflow: {
    session_id: 'wf-session-1',
    workflow_name: 'openjarvis-unattended',
    source: 'supabase',
    objective: 'recover GCP native leverage',
    runtime_lane: 'operator-personal',
    status: 'released',
    route_mode: 'operations',
    lastRecallRequest: {
      createdAt: '2026-04-13T00:01:00.000Z',
      decisionReason: 'approval boundary',
      evidenceId: 'recall-1',
      blockedAction: 'ship',
      nextAction: 'prepare operator-visible handoff',
      requestedBy: 'hermes',
      runtimeLane: 'operator-personal',
      failedStepNames: ['ship'],
    },
    lastDecisionDistillate: {
      createdAt: '2026-04-13T00:02:00.000Z',
      summary: 'Use the compact continuity bundle first.',
      evidenceId: 'decision-1',
      nextAction: 'launch the next bounded GPT task',
      runtimeLane: 'operator-personal',
      sourceEvent: 'decision_distillate',
      promoteAs: 'development_slice',
      tags: ['hermes', 'continuity'],
    },
    lastArtifactRefs: [
      {
        createdAt: '2026-04-13T00:03:00.000Z',
        locator: 'docs/planning/EXECUTION_BOARD.md',
        refKind: 'doc',
        title: 'Execution Board',
        runtimeLane: 'operator-personal',
        sourceStepName: 'collect-artifacts',
        sourceEvent: 'artifact_ref',
      },
    ],
  },
  hermes_runtime: {
    readiness: 'partial',
    current_role: 'continuity-sidecar',
    can_continue_without_gpt_session: true,
    queue_enabled: false,
    supervisor_alive: false,
    has_hot_state: true,
    local_operator_surface: true,
    blockers: ['No live supervisor is holding the local continuity loop open right now.'],
    next_actions: ['Run the continuous goal-cycle supervisor.'],
    remediation_actions: [
      {
        action_id: 'start-supervisor-loop',
        label: 'Start Hermes queue supervisor',
        description: null,
      },
    ],
  },
  capacity: {
    score: 82,
    target: 90,
    state: 'recovering',
    loop_action: 'continue',
    primary_reason: 'gcp_openjarvis_serve_not_remote',
  },
  resume_state: {
    next_action: 'resume bounded GCP capacity recovery until capacity reaches 90',
    reason: 'workstream_auto_restart_ready',
    owner: 'hermes',
    mode: 'observing',
    handoff_packet_relative_path: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
  },
  autonomous_goal_candidates: [
    {
      objective: 'stabilize the next GPT relaunch objective',
      source: 'safe-queue',
      milestone: null,
      source_path: 'docs/planning/EXECUTION_BOARD.md',
      fingerprint: 'safe-queue:stabilize the next GPT relaunch objective',
    },
  ],
});

const buildBundle = () => ({
  workflow: {
    source: 'supabase',
    status: 'released',
  },
  runtime_lane: 'operator-personal',
  route_mode: 'operations',
  continuity: {
    next_action: 'launch the next bounded GPT task',
  },
  autonomous_queue: {
    enabled: true,
    candidates: [
      {
        objective: 'stabilize the next GPT relaunch objective',
        source: 'safe-queue',
        milestone: 'M1',
        source_path: 'docs/planning/EXECUTION_BOARD.md',
      },
    ],
  },
  hermes_runtime: {
    readiness: 'partial',
    queued_objectives_available: true,
  },
  activation_pack: {
    activate_first: ['read the continuity packet'],
    read_next: ['plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
    tool_calls: ['automation.session_start_prep'],
    commands: ['npm run openjarvis:goal:status'],
    api_surfaces: ['/agent/runtime/openjarvis/session-open-bundle'],
    mcp_surfaces: ['automation.session_start_prep'],
    fallback_order: ['session-open bundle', 'handoff packet', 'manual recall'],
  },
  compact_bootstrap: {
    posture: 'small-bundle-first',
    start_with: ['objective', 'hermes_runtime', 'decision', 'next_queue'],
    objective: 'recover GCP native leverage',
    hermes_readiness: 'partial',
    latest_decision_distillate: 'Use the compact continuity bundle first.',
    next_queue_head: 'stabilize the next GPT relaunch objective',
    defer_large_docs_until_ambiguous: true,
    open_later: ['plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
  },
  read_first: ['plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md'],
  recall_triggers: ['blocked-action:start-supervisor-loop'],
  decision: {
    summary: 'Use the compact continuity bundle first.',
    next_action: 'launch the next bounded GPT task',
    promote_as: 'development_slice',
    tags: ['hermes', 'continuity'],
  },
  recall: {
    decision_reason: 'approval boundary',
    blocked_action: 'ship',
    next_action: 'prepare operator-visible handoff',
    failed_step_names: ['ship'],
  },
  evidence_refs: [
    {
      locator: 'docs/planning/EXECUTION_BOARD.md',
      refKind: 'doc',
      title: 'Execution Board',
      sourceStepName: 'collect-artifacts',
    },
  ],
  capability_demands: [
    {
      summary: 'No live supervisor is holding the local continuity loop open right now.',
      objective: 'stabilize the next GPT relaunch objective',
      missing_capability: 'No live supervisor is holding the local continuity loop open right now.',
      missing_source: null,
      failed_or_insufficient_route: 'operations via hermes-local-operator',
      cheapest_enablement_path: 'Run the continuous goal-cycle supervisor.',
      proposed_owner: 'hermes',
      evidence_refs: ['docs/planning/EXECUTION_BOARD.md'],
      recall_condition: 'approval boundary',
    },
  ],
});

describe('openjarvisHermesRuntimeControlService chat note', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetObsidianAdapterRuntimeStatus.mockReturnValue({
      selectedByCapability: {
        read_file: 'remote-mcp',
        write_note: 'remote-mcp',
      },
      accessPosture: {
        mode: 'shared-remote-ingress',
      },
    });
    mockGetObsidianVaultRoot.mockReturnValue('/vault');
    mockGetOpenJarvisAutopilotStatus.mockResolvedValue(buildStatus());
    mockGetOpenJarvisSessionOpenBundle.mockResolvedValue(buildBundle());
    mockBuildInboxChatNote.mockImplementation(({ title, message, guildId, requesterId, requesterKind }) => ({
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      content: `# ${title}\n\n${message}`,
      tags: ['chat', 'inbox', 'external-query'],
      properties: {
        title,
        guild_id: guildId || 'system',
        requester_id: requesterId,
        requester_kind: requesterKind,
      },
    }));
    mockWriteObsidianNoteWithAdapter.mockResolvedValue({
      path: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
    });
    mockReadObsidianFileWithAdapter.mockResolvedValue(null);
    mockRunHermesVsCodeBridge.mockResolvedValue({
      ok: true,
      action: 'chat',
      dryRun: false,
      completion: 'queued',
      command: 'code chat Continue the next bounded local autonomy task',
      pid: 4321,
      startedAt: '2026-04-13T00:00:00.000Z',
      finishedAt: '2026-04-13T00:00:00.100Z',
      durationMs: 100,
      stdoutLines: [],
      stderrLines: [],
      statusBefore: {},
      statusAfter: {},
      packetLog: {
        attempted: true,
        packetPath: '/vault/plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
        packetRelativePath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
        logged: true,
        entry: 'launch queued GPT task',
        error: null,
      },
      errorCode: null,
      error: null,
    });
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const createVaultPacket = () => {
    const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-runtime-control-'));
    tempDirs.push(vaultRoot);
    const packetPath = path.join(vaultRoot, 'plans', 'execution', 'HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md');
    fs.mkdirSync(path.dirname(packetPath), { recursive: true });
    fs.writeFileSync(packetPath, `---\ntitle: Hermes Autopilot Continuity Handoff Packet\n---\n\n## Safe Autonomous Queue For Hermes\n- keep workflow session and summary aligned\n\n## Evidence And References\n- docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md\n`, 'utf8');
    return { vaultRoot, packetPath };
  };

  it('creates a Hermes runtime Obsidian inbox note with the existing chat schema', async () => {
    const result = await createOpenJarvisHermesRuntimeChatNote({
      requesterId: 'agent-1',
      requesterKind: 'session',
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'created',
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      notePath: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      requestTitle: 'Hermes Runtime Handoff',
    });
    expect(mockBuildInboxChatNote).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Hermes Runtime Handoff',
      guildId: '',
      requesterId: 'agent-1',
      requesterKind: 'session',
    }));
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('Review the current Hermes runtime state below');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('hot_state_source: supabase');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('Supabase workflow session and event rows remain the mutable hot-state source.');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('Compact Bootstrap');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('start_with: objective -> hermes_runtime -> decision -> next_queue');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('Capability Demands');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('owner=hermes');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('Latest Decision Distillate');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('summary: Use the compact continuity bundle first.');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('blocked_action: ship');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('docs/planning/EXECUTION_BOARD.md - Execution Board (doc, collect-artifacts)');
    expect(mockBuildInboxChatNote.mock.calls[0][0].message).toContain('start-supervisor-loop');
    expect(mockGetOpenJarvisSessionOpenBundle).toHaveBeenCalledWith(expect.objectContaining({
      status: expect.objectContaining({
        workflow: expect.objectContaining({
          source: 'supabase',
        }),
      }),
    }));
    expect(mockWriteObsidianNoteWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      guildId: '',
      vaultPath: path.resolve('/vault'),
      fileName: 'chat/inbox/2026-04-13/010203_hermes-runtime-handoff.md',
      trustedSource: true,
      tags: ['chat', 'inbox', 'external-query', 'hermes-runtime'],
      properties: expect.objectContaining({
        source: 'hermes-runtime-chat',
        hermes_runtime_readiness: 'partial',
        hermes_runtime_role: 'continuity-sidecar',
        runtime_lane: 'operator-personal',
        workflow_source: 'supabase',
        workflow_session_id: 'wf-session-1',
        workflow_status: 'released',
        state_projection: 'supabase-hot-state-to-obsidian-projection',
        decision_summary: 'Use the compact continuity bundle first.',
        decision_next_action: 'launch the next bounded GPT task',
        decision_tags: ['hermes', 'continuity'],
        recall_blocked_action: 'ship',
        capability_demands: ['No live supervisor is holding the local continuity loop open right now.'],
        compact_bootstrap_next_queue_head: 'stabilize the next GPT relaunch objective',
        evidence_refs: ['docs/planning/EXECUTION_BOARD.md'],
      }),
    }));
  });

  it('fails closed when no vault path is configured', async () => {
    mockGetObsidianVaultRoot.mockReturnValue('');

    const result = await createOpenJarvisHermesRuntimeChatNote();

    expect(result).toMatchObject({
      ok: false,
      completion: 'skipped',
      errorCode: 'VAULT_PATH_REQUIRED',
    });
    expect(mockGetOpenJarvisAutopilotStatus).not.toHaveBeenCalled();
    expect(mockBuildInboxChatNote).not.toHaveBeenCalled();
  });

  it('appends queued objectives into the Hermes handoff packet safe queue', async () => {
    const { vaultRoot, packetPath } = createVaultPacket();
    mockGetObsidianVaultRoot.mockReturnValue(vaultRoot);
    mockGetObsidianAdapterRuntimeStatus.mockReturnValueOnce({
      selectedByCapability: {
        read_file: 'local-fs',
        write_note: 'local-fs',
      },
      accessPosture: {
        mode: 'direct-vault-primary',
      },
    });
    mockWriteObsidianNoteWithAdapter.mockResolvedValueOnce({
      path: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });

    const result = await enqueueOpenJarvisHermesRuntimeObjectives({
      objective: 'stabilize the next GPT relaunch objective',
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'updated',
      requestedObjectives: ['stabilize the next GPT relaunch objective'],
      queuedObjectives: [
        'stabilize the next GPT relaunch objective',
        'keep workflow session and summary aligned',
      ],
    });
    expect(fs.readFileSync(packetPath, 'utf8')).toContain('- stabilize the next GPT relaunch objective');
    expect(mockWriteObsidianNoteWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vaultPath: vaultRoot,
      fileName: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      skipKnowledgeCompilation: true,
      trustedSource: true,
    }));
  });

  it('updates the Hermes handoff packet through the shared Obsidian adapter before touching local fs', async () => {
    const packetContent = `---\ntitle: Hermes Autopilot Continuity Handoff Packet\n---\n\n## Safe Autonomous Queue For Hermes\n- keep workflow session and summary aligned\n`;
    mockReadObsidianFileWithAdapter.mockResolvedValueOnce(packetContent);
    mockWriteObsidianNoteWithAdapter.mockResolvedValueOnce({
      path: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });

    const result = await enqueueOpenJarvisHermesRuntimeObjectives({
      vaultPath: '/vault',
      objective: 'stabilize the next GPT relaunch objective',
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'updated',
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });
    expect(mockReadObsidianFileWithAdapter).toHaveBeenCalledWith({
      vaultPath: path.resolve('/vault'),
      filePath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });
    expect(mockWriteObsidianNoteWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      vaultPath: path.resolve('/vault'),
      fileName: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
      skipKnowledgeCompilation: true,
    }));
  });

  it('previews Hermes queue updates without writing when dryRun is enabled', async () => {
    const { vaultRoot, packetPath } = createVaultPacket();
    mockGetObsidianVaultRoot.mockReturnValue(vaultRoot);
    mockGetObsidianAdapterRuntimeStatus.mockReturnValueOnce({
      selectedByCapability: {
        read_file: 'local-fs',
        write_note: 'local-fs',
      },
      accessPosture: {
        mode: 'direct-vault-primary',
      },
    });

    const before = fs.readFileSync(packetPath, 'utf8');
    const result = await enqueueOpenJarvisHermesRuntimeObjectives({
      objective: 'stabilize the next GPT relaunch objective',
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'skipped',
      requestedObjectives: ['stabilize the next GPT relaunch objective'],
      queuedObjectives: [
        'stabilize the next GPT relaunch objective',
        'keep workflow session and summary aligned',
      ],
      handoffPacketPath: 'plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md',
    });
    expect(fs.readFileSync(packetPath, 'utf8')).toBe(before);
    expect(mockWriteObsidianNoteWithAdapter).not.toHaveBeenCalled();
  });

  it('prepares session-start runtime state with shared Obsidian projection and supervisor startup', async () => {
    const result = await prepareOpenJarvisHermesSessionStart({
      runtimeLane: 'operator-personal',
      dryRun: true,
      requesterId: 'agent-1',
      requesterKind: 'session',
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'prepared',
      sharedObsidianPreferred: true,
      statusSummary: {
        readiness: 'partial',
        currentRole: 'continuity-sidecar',
        supervisorAlive: false,
      },
      remediation: {
        ok: true,
        actionId: 'start-supervisor-loop',
        dryRun: true,
        completion: 'queued',
      },
      chatNote: {
        ok: true,
        completion: 'created',
      },
    });
    expect(result.bundle?.workflow.source).toBe('supabase');
    expect(mockWriteObsidianNoteWithAdapter).toHaveBeenCalledWith(expect.objectContaining({
      trustedSource: true,
      vaultPath: path.resolve('/vault'),
    }));
  });

  it('does not mutate the Hermes queue during session-start dry runs', async () => {
    const { vaultRoot, packetPath } = createVaultPacket();
    mockGetObsidianVaultRoot.mockReturnValue(vaultRoot);
    mockGetObsidianAdapterRuntimeStatus.mockReturnValueOnce({
      selectedByCapability: {
        read_file: 'local-fs',
        write_note: 'local-fs',
      },
      accessPosture: {
        mode: 'direct-vault-primary',
      },
    });

    const before = fs.readFileSync(packetPath, 'utf8');
    const result = await prepareOpenJarvisHermesSessionStart({
      objective: 'verify shared MCP session prep',
      dryRun: true,
      createChatNote: false,
      startSupervisor: false,
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'prepared',
      queueObjective: {
        ok: true,
        completion: 'skipped',
        requestedObjectives: ['verify shared MCP session prep'],
        queuedObjectives: [
          'verify shared MCP session prep',
          'keep workflow session and summary aligned',
        ],
      },
      chatNote: null,
      remediation: null,
    });
    expect(fs.readFileSync(packetPath, 'utf8')).toBe(before);
    expect(mockWriteObsidianNoteWithAdapter).not.toHaveBeenCalled();
  });

  it('launches a queued objective into a new VS Code chat session', async () => {
    const status = buildStatus();
    const handoffPath = '/vault/plans/execution/HERMES_AUTOPILOT_CONTINUITY_HANDOFF_PACKET.md';
    const progressPath = '/vault/plans/execution/HERMES_AUTOPILOT_CONTINUITY_PROGRESS_PACKET.md';
    mockGetOpenJarvisAutopilotStatus.mockResolvedValueOnce({
      ...status,
      resume_state: {
        ...status.resume_state,
        handoff_packet_path: handoffPath,
        progress_packet_path: progressPath,
      },
    });

    const result = await launchOpenJarvisHermesChatSession({
      runtimeLane: 'operator-personal',
      addFilePaths: ['docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md'],
    });

    expect(result).toMatchObject({
      ok: true,
      completion: 'queued',
      objective: 'stabilize the next GPT relaunch objective',
    });
    expect(result.prompt).toContain('Primary objective: stabilize the next GPT relaunch objective');
    expect(result.prompt).toContain('npm run openjarvis:hermes:runtime:reentry-ack -- --completionStatus=completed');
    expect(result.prompt).toContain('use the --name=value form exactly');
    expect(mockRunHermesVsCodeBridge).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat',
      chatMode: 'agent',
      maximize: true,
      reuseWindow: true,
      packetPath: handoffPath,
      addFilePaths: expect.arrayContaining([
        'docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md',
        handoffPath,
        progressPath,
        path.resolve(process.cwd(), 'docs/planning/EXECUTION_BOARD.md'),
      ]),
    }));
  });
});