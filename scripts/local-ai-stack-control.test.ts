import { describe, expect, it } from 'vitest';

import {
  buildControlPlaneExecutionPlan,
  buildFutureControlPlanePlan,
  buildManagedServicePlan,
  deriveObsidianAccessPosture,
  parseEmbeddedJsonPayload,
} from './local-ai-stack-control.mjs';

describe('local-ai-stack-control helpers', () => {
  it('extracts the last JSON payload from noisy command output', () => {
    const payload = parseEmbeddedJsonPayload(`
[n8n-local] bootstrapDir=tmp/n8n-local
{"ok":false,"step":"bootstrap"}
trailing noise
{"ok":true,"step":"doctor","reachable":true}
`);

    expect(payload).toEqual({
      ok: true,
      step: 'doctor',
      reachable: true,
    });
  });

  it('builds the managed service plan for the max-delegation local profile', () => {
    const plan = buildManagedServicePlan({
      AI_PROVIDER: 'ollama',
      OPENJARVIS_ENGINE: 'litellm',
      LITELLM_ENABLED: 'true',
      LITELLM_BASE_URL: 'http://127.0.0.1:4000',
      N8N_ENABLED: 'true',
      N8N_DISABLED: 'false',
      N8N_BASE_URL: 'http://127.0.0.1:5678',
      OPENJARVIS_ENABLED: 'true',
      OPENJARVIS_SERVE_URL: 'http://127.0.0.1:8000',
      MCP_IMPLEMENT_WORKER_URL: 'http://127.0.0.1:8787',
    });

    expect(plan).toEqual({
      litellm: true,
      n8n: true,
      openjarvis: true,
      opencodeWorker: true,
      requiresOllama: true,
    });
  });

  it('classifies direct-vault-first obsidian posture from capability orders', () => {
    const posture = deriveObsidianAccessPosture({
      OBSIDIAN_ADAPTER_ORDER: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_READ_FILE: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT: 'local-fs,native-cli,remote-mcp',
      OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE: 'local-fs,native-cli,remote-mcp',
    });

    expect(posture.mode).toBe('direct-vault-primary');
    expect(posture.primaryReadAdapter).toBe('local-fs');
    expect(posture.primaryWriteAdapter).toBe('local-fs');
    expect(posture.primarySearchAdapter).toBe('local-fs');
  });

  it('builds a phased control-plane activation plan from surface readiness', () => {
    const plan = buildControlPlaneExecutionPlan({
      multica: {
        surface: 'multica',
        status: 'ready',
        nextSteps: [],
      },
      hermes: {
        surface: 'hermes',
        status: 'partial',
        nextSteps: ['repair the Hermes auth or model endpoint until hermes chat -q Reply with only OK -Q succeeds'],
      },
      vscodeCopilot: {
        surface: 'vscode-copilot',
        status: 'ready',
        nextSteps: [],
      },
      openjarvis: {
        surface: 'openjarvis',
        status: 'partial',
        nextSteps: ['Run the continuous goal-cycle supervisor so Hermes remains attached after release instead of stopping at the last bounded cycle.'],
      },
      localAutonomy: {
        surface: 'local-autonomy',
        status: 'partial',
        nextSteps: ['run npm run local:autonomy:supervisor:restart to restore the detached self-heal loop'],
      },
    });

    expect(plan.currentPosture).toBe('needs-activation');
    expect(plan.readySurfaces).toEqual(['multica', 'vscode-copilot']);
    expect(plan.partialSurfaces).toEqual(['hermes', 'openjarvis', 'local-autonomy']);
    expect(plan.recommendedCommands).toContain('npm run local:control-plane:doctor');
    expect(plan.recommendedCommands).toContain('npm run local:control-plane:up');
    expect(plan.recommendedCommands).toContain('npm run local:autonomy:supervisor:restart');
    expect(plan.phases).toHaveLength(4);
    expect(plan.phases[1]?.status).toBe('partial');
    expect(plan.phases[3]?.steps).toContain('run npm run local:autonomy:supervisor:restart to restore the detached self-heal loop');
  });

  it('builds a future control-plane cadence plan once the local surfaces are healthy', () => {
    const plan = buildFutureControlPlanePlan({
      controlPlaneReport: {
        ok: true,
        multica: { status: 'ready' },
        hermes: { status: 'ready' },
        vscodeCopilot: { status: 'ready' },
        openjarvis: {
          status: 'ready',
          objective: 'reduce codebase complexity safely',
          queueLaunchMode: 'chat',
          queuedObjectivesAvailable: true,
          awaitingReentryAcknowledgment: false,
          autonomousGoalCandidates: ['launch the next bounded GPT task'],
        },
        localAutonomy: { status: 'ready' },
      },
    });

    expect(plan.currentPhase).toBe('launch-next-bounded-turn');
    expect(plan.commands).toContain('npm run openjarvis:autopilot:queue:chat');
    expect(plan.readiness.openjarvis).toBe('ready');
    expect(plan.checkpoints[1]?.command).toBe('npm run openjarvis:hermes:runtime:queue-objective:auto');
    expect(plan.guardrails[1]).toContain('one bounded queued GPT handoff');
    expect(plan.sessionSynthesis).toMatchObject({
      sessionKind: 'bounded-turn',
      activationState: 'launch-now',
      plannedQueueLaunchMode: 'chat',
      launchObjective: 'reduce codebase complexity safely',
      reasoningSurface: {
        ownerSurface: 'vscode-copilot',
        surfaceMode: 'chat',
      },
      executionLane: {
        primaryAssetId: 'hermes-local-operator',
      },
    });
    expect(plan.sessionSynthesis.childTurns[0]).toMatchObject({
      workerId: 'bounded-turn',
      assetId: 'hermes-local-operator',
    });
  });

  it('recommends queue swarm launch when the supervisor is armed for swarm mode', () => {
    const plan = buildFutureControlPlanePlan({
      controlPlaneReport: {
        ok: true,
        multica: { status: 'ready' },
        hermes: { status: 'ready' },
        vscodeCopilot: { status: 'ready' },
        openjarvis: {
          status: 'ready',
          objective: 'stabilize shared wrapper readiness',
          queueLaunchMode: 'swarm',
          queuedObjectivesAvailable: true,
          awaitingReentryAcknowledgment: false,
          autonomousGoalCandidates: ['launch the next bounded GPT task'],
        },
        localAutonomy: { status: 'ready' },
      },
    });

    expect(plan.currentPhase).toBe('launch-next-bounded-wave');
    expect(plan.commands).toContain('npm run openjarvis:autopilot:queue:swarm');
    expect(plan.checkpoints[2]?.command).toBe('npm run openjarvis:autopilot:queue:swarm');
    expect(plan.sessionSynthesis).toMatchObject({
      sessionKind: 'bounded-wave',
      activationState: 'launch-now',
      plannedQueueLaunchMode: 'swarm',
      reasoningSurface: {
        surfaceMode: 'swarm',
      },
    });
    expect(plan.sessionSynthesis.childTurns.map((entry) => entry.workerId)).toEqual([
      'route-scout',
      'bounded-executor',
      'closeout-distiller',
    ]);
  });

  it('routes browser and screenshot objectives to the workstation execution lane', () => {
    const plan = buildFutureControlPlanePlan({
      controlPlaneReport: {
        ok: true,
        multica: { status: 'ready' },
        hermes: { status: 'ready' },
        vscodeCopilot: { status: 'ready' },
        openjarvis: {
          status: 'ready',
          objective: 'inspect the browser-based operator dashboard and capture screenshot evidence',
          queueLaunchMode: 'chat',
          queuedObjectivesAvailable: true,
          awaitingReentryAcknowledgment: false,
          autonomousGoalCandidates: ['inspect the browser-based operator dashboard and capture screenshot evidence'],
        },
        localAutonomy: { status: 'ready' },
      },
    });

    expect(plan.sessionSynthesis.executionLane).toMatchObject({
      primaryAssetId: 'local-workstation-executor',
      supportAssetIds: ['hermes-local-operator'],
    });
    expect(plan.sessionSynthesis.childTurns[0]).toMatchObject({
      assetId: 'local-workstation-executor',
    });
  });

  it('routes remote deploy and benchmark objectives to the remote execution lane', () => {
    const plan = buildFutureControlPlanePlan({
      controlPlaneReport: {
        ok: true,
        multica: { status: 'ready' },
        hermes: { status: 'ready' },
        vscodeCopilot: { status: 'ready' },
        openjarvis: {
          status: 'ready',
          objective: 'run remote worker benchmark and deploy validation on gcp',
          queueLaunchMode: 'chat',
          queuedObjectivesAvailable: true,
          awaitingReentryAcknowledgment: false,
          autonomousGoalCandidates: ['run remote worker benchmark and deploy validation on gcp'],
        },
        localAutonomy: { status: 'ready' },
      },
    });

    expect(plan.sessionSynthesis.executionLane).toMatchObject({
      primaryAssetId: 'remote-heavy-execution',
      supportAssetIds: ['hermes-local-operator'],
    });
    expect(plan.sessionSynthesis.childTurns[0]).toMatchObject({
      assetId: 'remote-heavy-execution',
    });
  });

  it('holds relaunch while the current workflow is still executing and queue-chat mode drift exists', () => {
    const plan = buildFutureControlPlanePlan({
      controlPlaneReport: {
        ok: false,
        multica: { status: 'ready' },
        hermes: { status: 'ready' },
        vscodeCopilot: { status: 'ready' },
        openjarvis: {
          status: 'partial',
          workflowStatus: 'executing',
          objective: 'keep the active workflow healthy',
          queueChatModeDrift: true,
          queuedObjectivesAvailable: true,
          awaitingReentryAcknowledgment: false,
          autonomousGoalCandidates: ['launch the next bounded GPT task'],
        },
        localAutonomy: { status: 'ready' },
      },
    });

    expect(plan.currentPhase).toBe('monitor-active-workflow');
    expect(plan.commands).toContain('npm run openjarvis:goal:status');
    expect(plan.commands).toContain('npm run openjarvis:packets:sync');
    expect(plan.commands).toContain('npm run local:autonomy:supervisor:restart');
    expect(plan.commands).not.toContain('npm run openjarvis:autopilot:queue:chat');
    expect(plan.checkpoints[4]?.command).toBe('npm run openjarvis:packets:sync');
  });
});