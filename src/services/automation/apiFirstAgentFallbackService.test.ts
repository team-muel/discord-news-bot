import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetExternalAdaptersStatus,
  mockGetDelegationStatus,
  mockListUpstreamDiagnostics,
  mockListProxiedTools,
} = vi.hoisted(() => ({
  mockGetExternalAdaptersStatus: vi.fn(),
  mockGetDelegationStatus: vi.fn(),
  mockListUpstreamDiagnostics: vi.fn(),
  mockListProxiedTools: vi.fn(async () => []),
}));

vi.mock('../tools/toolRouter', () => ({
  getExternalAdaptersStatus: mockGetExternalAdaptersStatus,
}));

vi.mock('./n8nDelegationService', () => ({
  getDelegationStatus: mockGetDelegationStatus,
}));

vi.mock('../../mcp/proxyAdapter', () => ({
  listUpstreamDiagnostics: mockListUpstreamDiagnostics,
  listProxiedTools: mockListProxiedTools,
}));

describe('apiFirstAgentFallbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetExternalAdaptersStatus.mockResolvedValue([
      { id: 'n8n', available: true, capabilities: ['workflow.list'] },
      { id: 'obsidian', available: true, capabilities: ['search'] },
      { id: 'openjarvis', available: true, capabilities: ['jarvis.ask'] },
      { id: 'ollama', available: true, capabilities: ['chat'] },
      { id: 'render', available: false, capabilities: ['service.list'] },
      { id: 'workstation', available: true, capabilities: ['browser.open', 'file.read'] },
    ]);
    mockGetDelegationStatus.mockReturnValue({
      enabled: true,
      delegationFirst: false,
      n8nCacheAvailable: true,
      tasks: {
        'news-rss-fetch': { configured: true, webhookPath: '***' },
        'news-summarize': { configured: true, webhookPath: '***' },
        'news-monitor-candidates': { configured: true, webhookPath: '***' },
        'youtube-feed-fetch': { configured: false, webhookPath: '' },
        'youtube-community-scrape': { configured: false, webhookPath: '' },
        'alert-dispatch': { configured: true, webhookPath: '***' },
        'article-context-fetch': { configured: false, webhookPath: '' },
      },
    });
    mockListUpstreamDiagnostics.mockReturnValue([
      {
        id: 'gcpcompute',
        namespace: 'gcpcompute',
        enabled: true,
      },
    ]);
  });

  it('builds a capability catalog that exposes API-first, MCP wrapping, and agent fallback surfaces', async () => {
    const { buildAutomationCapabilityCatalog } = await import('./apiFirstAgentFallbackService');
    const catalog = await buildAutomationCapabilityCatalog();

    expect(catalog.model).toBe('API-First & Agent-Fallback');
    expect(catalog.runtimeSignals.configuredN8nTaskCount).toBe(4);
    expect(catalog.runtimeSignals.upstreamNamespaces).toEqual(['gcpcompute']);
    expect(catalog.surfaces.find((surface) => surface.surfaceId === 'github-artifact-plane')?.layer).toBe('artifact-review');
    expect(catalog.surfaces.find((surface) => surface.surfaceId === 'n8n-router')?.operationalState).toBe('ready');
    expect(catalog.surfaces.find((surface) => surface.surfaceId === 'gcpcompute-shared-mcp')?.operationalState).toBe('ready');
    expect(catalog.surfaces.find((surface) => surface.surfaceId === 'hermes-local-operator')?.operationalState).toBe('ready');
    expect(catalog.surfaces.find((surface) => surface.surfaceId === 'local-workstation-executor')?.operationalState).toBe('ready');
    expect(catalog.canonicalExamples.map((example) => example.exampleId)).toContain('youtube-community-post-handoff');
    expect(catalog.observability.primaryObserver).toContain('OpenJarvis');
    expect(catalog.observability.currentGaps[0]).toContain('end-to-end visual trace');
    expect(catalog.orchestrationGuidance.currentPriority).toBe('compact-bootstrap-first');
    expect(catalog.orchestrationGuidance.advisorStrategy.recommendedByDefault).toBe(false);
    expect(catalog.orchestrationGuidance.tokenContextEconomics.latestAuditHighlights[0]).toContain('context-footprint audit');
  });

  it('prefers API-first with agent fallback when a deterministic path exists but reasoning may still be needed', async () => {
    const { previewApiFirstAgentFallbackRoute } = await import('./apiFirstAgentFallbackService');
    const preview = await previewApiFirstAgentFallbackRoute({
      objective: 'triage a new customer support email',
      trigger: 'webhook',
      structuredDataAvailable: true,
      clearApiAnswer: false,
      requiresReasoning: true,
      requiresLongRunningWait: true,
      executionPreference: 'hybrid',
      candidateApis: ['crm.lookup', 'faq.lookup'],
      candidateMcpTools: ['upstream.gcpcompute.internal_knowledge_resolve'],
    });

    expect(preview.recommendedMode).toBe('api-first-with-agent-fallback');
    expect(preview.primaryPath.pathType).toBe('api-path');
    expect(preview.primaryPath.surfaces).toContain('n8n-router');
    expect(preview.fallbackPath.surfaces).toContain('gcpcompute-shared-mcp');
    expect(preview.fallbackPath.surfaces).toContain('hermes-local-operator');
    expect(preview.fallbackPath.surfaces).toContain('local-workstation-executor');
    expect(preview.statePlane.artifactPlane).toContain('GitHub');
    expect(preview.activationPack.toolCalls).toContain('automation.session_start_prep');
    expect(preview.activationPack.apiSurfaces).toContain('n8n-router');
    expect(preview.escalation.required).toBe(false);
    expect(preview.orchestrationGuidance.advisorStrategy.posture).toBe('conditional-escalation');
    expect(preview.orchestrationGuidance.advisorStrategy.maxAdvisorUses).toBe(1);
  });

  it('matches the YouTube community example when the objective targets that workflow', async () => {
    const { previewApiFirstAgentFallbackRoute } = await import('./apiFirstAgentFallbackService');
    const preview = await previewApiFirstAgentFallbackRoute({
      objective: 'scrape the latest YouTube community post and hand it off to downstream publishing',
      trigger: 'webhook',
      structuredDataAvailable: true,
      clearApiAnswer: false,
      requiresReasoning: false,
      candidateApis: ['youtube-community-scrape'],
    });

    expect(preview.matchedExampleIds).toContain('youtube-community-post-handoff');
    expect(preview.recommendedMode).toBe('api-first-with-agent-fallback');
    expect(preview.activationPack.objectiveClass).toBe('youtube-community');
    expect(preview.orchestrationGuidance.advisorStrategy.posture).toBe('not-needed');
  });

  it('builds a shared-MCP activation pack for architecture optimization objectives', async () => {
    const { previewApiFirstAgentFallbackRoute } = await import('./apiFirstAgentFallbackService');
    const preview = await previewApiFirstAgentFallbackRoute({
      objective: 'stabilize shared MCP teammate bootstrap hardening and skill hub activation',
      structuredDataAvailable: false,
      requiresReasoning: true,
      requiresDurableKnowledge: true,
      executionPreference: 'hybrid',
      candidateMcpTools: ['upstream.gcpcompute.internal_knowledge_resolve'],
    });

    expect(preview.activationPack.objectiveClass).toBe('shared-mcp-bootstrap');
    expect(preview.activationPack.recommendedSkills.map((entry) => entry.skillId)).toEqual(
      expect.arrayContaining(['plan', 'obsidian-knowledge']),
    );
    expect(preview.activationPack.readNext).toEqual(expect.arrayContaining([
      'docs/adr/ADR-008-multi-plane-operating-model.md',
      'docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md',
    ]));
    expect(preview.activationPack.toolCalls).toContain('automation.session_start_prep');
    expect(preview.activationPack.toolCalls).toContain('automation.capability.catalog');
    expect(preview.activationPack.toolCalls).toContain('automation.optimizer.plan');
    expect(preview.activationPack.commands[0]).toContain('scripts/bootstrap-team.ps1 -SharedOnly');
  });

  it('builds a workflow draft from reusable n8n starter workflows', async () => {
    const { buildAutomationWorkflowDraft } = await import('./apiFirstAgentFallbackService');
    const draft = await buildAutomationWorkflowDraft({
      objective: 'update the YouTube community ingestion workflow and keep a deterministic scrape path',
      trigger: 'webhook',
      structuredDataAvailable: true,
      clearApiAnswer: false,
      requiresReasoning: false,
      candidateApis: ['youtube-community-scrape'],
      runtimeLane: 'operator-personal',
      sharedBenefitPhase: 'constraint-only',
      existingWorkflowName: 'community ingestion workflow',
      existingWorkflowTasks: ['youtube-community-scrape'],
      includeSeedPayload: true,
    });

    expect(draft.changeMode).toBe('update-existing');
    expect(draft.recommended).toBe(true);
    expect(draft.routerShape).toContain('explicit IF/Switch');
    expect(draft.currentWorkflow.name).toBe('community ingestion workflow');
    expect(draft.starterCandidates[0]?.task).toBe('youtube-community-scrape');
    expect(draft.starterCandidates[0]?.seedPayload).toEqual(expect.objectContaining({
      name: 'muel local youtube community scrape starter',
    }));
    expect(draft.stages.find((stage) => stage.stageId === 'artifact-settlement')).toEqual(expect.objectContaining({
      owner: 'github-artifact-plane',
      summary: expect.stringContaining('GitHub'),
      nodes: expect.arrayContaining(['artifact_ref']),
    }));
    expect(draft.stages.findIndex((stage) => stage.stageId === 'artifact-settlement')).toBeGreaterThan(
      draft.stages.findIndex((stage) => stage.stageId === 'finalize'),
    );
    expect(draft.modificationPolicy[0]).toContain('artifact-settlement');
    expect(draft.modificationPolicy).toEqual(expect.arrayContaining([
      expect.stringContaining('GitHub artifact settlement distinct from Supabase closeout'),
    ]));
  });

  it('builds an optimizer plan with public-guild guardrails and shared scale-out guidance', async () => {
    const { buildAutomationOptimizerPlan } = await import('./apiFirstAgentFallbackService');
    const plan = await buildAutomationOptimizerPlan({
      objective: 'design a public Discord autopilot that drafts alerts and escalates only on policy boundaries',
      trigger: 'webhook',
      structuredDataAvailable: true,
      clearApiAnswer: false,
      requiresReasoning: true,
      requiresLongRunningWait: true,
      candidateApis: ['alert-dispatch'],
      candidateMcpTools: ['upstream.gcpcompute.internal_knowledge_resolve'],
      runtimeLane: 'public-guild',
      sharedBenefitPhase: 'constraint-only',
      dynamicWorkflowRequested: true,
      includeSeedPayload: true,
    });

    expect(plan.runtimeLane).toBe('public-guild');
    expect(plan.sharedBenefitPhase).toBe('constraint-only');
    expect(plan.dynamicWorkflowRequested).toBe(true);
    expect(plan.routePreview.recommendedMode).toBe('api-first-with-agent-fallback');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'supabase-hot-state')?.defaultMode).toBe('primary');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'github-artifact-plane')?.currentState).toBe('assumed');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'gcpcompute-shared-mcp')?.currentState).toBe('ready');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'hermes-local-operator')?.currentBottleneck).toContain('Public guild routes');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'local-workstation-executor')?.currentState).toBe('ready');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'gpt-recall')?.defaultMode).toBe('escalation-only');
    expect(plan.assetDelegationMatrix.find((entry) => entry.assetId === 'skills-and-activation-pack')?.useFor).toEqual(expect.arrayContaining([
      expect.stringContaining('compact bootstrap'),
    ]));
    expect(plan.operatingContract.stateOwners.artifactPlane).toContain('GitHub');
    expect(plan.operatingContract.serviceGuardrails).toEqual(expect.arrayContaining([
      expect.stringContaining('Sanitize the final Discord deliverable'),
    ]));
    expect(plan.costPerformancePolicy.costControls).toEqual(expect.arrayContaining([
      expect.stringContaining('Keep waits, retries, and schedules in n8n'),
    ]));
    expect(plan.observabilityPlan.signals).toContain('deliverable_sanitized');
    expect(plan.workflowDraft.stages.find((stage) => stage.stageId === 'artifact-settlement')).toEqual(expect.objectContaining({
      owner: 'github-artifact-plane',
      nodes: expect.arrayContaining(['artifact_ref']),
    }));
    expect(plan.workflowDraft.starterCandidates[0]?.task).toBe('alert-dispatch');
    expect(plan.sharedEnablementPlan.futureMilestones[0]).toContain('shared MCP');
  });

  it('forces GPT recall for policy-sensitive tasks', async () => {
    const { previewApiFirstAgentFallbackRoute } = await import('./apiFirstAgentFallbackService');
    const preview = await previewApiFirstAgentFallbackRoute({
      objective: 'rotate production secrets and approve policy changes',
      policySensitive: true,
      requiresReasoning: true,
      executionPreference: 'hybrid',
    });

    expect(preview.recommendedMode).toBe('gpt-recall');
    expect(preview.primaryPath.pathType).toBe('recall');
    expect(preview.escalation.required).toBe(true);
    expect(preview.escalation.target).toBe('gpt');
    expect(preview.orchestrationGuidance.advisorStrategy.posture).toBe('gpt-recall-instead');
  });
});