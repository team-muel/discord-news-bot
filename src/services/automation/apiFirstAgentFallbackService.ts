import { listProxiedTools, listUpstreamDiagnostics } from '../../mcp/proxyAdapter';
import { getExternalAdaptersStatus } from '../tools/toolRouter';
import { getDelegationStatus } from './n8nDelegationService';
import { buildAutomationActivationPack } from '../../../scripts/lib/automationActivationPack.mjs';
import {
  buildN8nStarterWorkflowDefinitions,
  toN8nWorkflowSeedPayload,
} from '../../../scripts/bootstrap-n8n-local.mjs';

export type AutomationSurfaceLayer =
  | 'semantic-owner'
  | 'hot-state'
  | 'artifact-review'
  | 'api-first'
  | 'mcp-wrapping'
  | 'agent-fallback'
  | 'remote-execution';

export type AutomationSurfaceState = 'ready' | 'partial' | 'assumed' | 'missing';

export type AutomationSurface = {
  surfaceId: string;
  layer: AutomationSurfaceLayer;
  operationalState: AutomationSurfaceState;
  responsibility: string;
  bindings: string[];
  preferredWhen: string[];
  avoidWhen: string[];
};

export type AutomationCapabilityCatalog = {
  generatedAt: string;
  model: 'API-First & Agent-Fallback';
  surfaces: AutomationSurface[];
  canonicalExamples: AutomationCanonicalExample[];
  observability: AutomationObservabilityCoverage;
  orchestrationGuidance: AutomationOrchestrationGuidance;
  wrapperPattern: {
    localProviderPattern: string;
    sharedProviderPattern: string;
    guidance: string[];
  };
  runtimeSignals: {
    configuredN8nTaskCount: number;
    availableAdapters: string[];
    upstreamNamespaces: string[];
  };
};

export type AutomationRouteMode =
  | 'api-first'
  | 'api-first-with-agent-fallback'
  | 'agent-fallback'
  | 'gpt-recall';

export type AutomationRoutePreviewInput = {
  objective: string;
  trigger?: 'webhook' | 'schedule' | 'manual' | 'event';
  structuredDataAvailable?: boolean;
  clearApiAnswer?: boolean;
  requiresReasoning?: boolean;
  requiresLongRunningWait?: boolean;
  requiresDurableKnowledge?: boolean;
  policySensitive?: boolean;
  executionPreference?: 'local' | 'remote' | 'hybrid';
  candidateApis?: string[];
  candidateMcpTools?: string[];
};

export type AutomationRoutePreview = {
  objective: string;
  recommendedMode: AutomationRouteMode;
  rationale: string[];
  activationPack: AutomationActivationPack;
  orchestrationGuidance: AutomationRouteOrchestrationGuidance;
  matchedExampleIds: string[];
  primaryPath: {
    pathType: 'api-path' | 'mcp-path' | 'recall';
    surfaces: string[];
    actions: string[];
  };
  fallbackPath: {
    surfaces: string[];
    actions: string[];
  };
  statePlane: {
    hotState: string;
    orchestration: string;
    semanticOwner: string;
    artifactPlane: string;
  };
  modelPolicy: {
    apiPath: string;
    fallbackPath: string;
    escalation: string;
  };
  wrappingLayer: {
    localPattern: string;
    sharedPattern: string;
    recommendations: string[];
  };
  candidates: {
    apis: string[];
    mcpTools: string[];
  };
  escalation: {
    required: boolean;
    target: 'gpt' | 'none';
    reason: string;
  };
};

export type AutomationRuntimeLane = 'operator-personal' | 'public-guild' | 'system-internal';

export type AutomationSharedBenefitPhase = 'constraint-only' | 'phase-1' | 'required-now';

export type AutomationWorkflowDraftInput = AutomationRoutePreviewInput & {
  runtimeLane?: AutomationRuntimeLane;
  sharedBenefitPhase?: AutomationSharedBenefitPhase;
  existingWorkflowName?: string;
  existingWorkflowTasks?: string[];
  includeWorkflowPayload?: boolean;
  includeSeedPayload?: boolean;
};

export type AutomationOptimizerPlanInput = AutomationWorkflowDraftInput & {
  dynamicWorkflowRequested?: boolean;
};

export type AutomationWorkflowDraftCandidate = {
  task: string;
  workflowName: string;
  fileName: string;
  webhookPath: string;
  description: string;
  manualFollowUp: string;
  seedPayload?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
};

export type AutomationWorkflowDraftStageOwner =
  | 'api-router'
  | 'supabase-hot-state'
  | 'github-artifact-plane'
  | 'mcp-wrapper'
  | 'hermes-local'
  | 'gpt-recall'
  | 'obsidian';

export type AutomationWorkflowDraftStage = {
  stageId: string;
  owner: AutomationWorkflowDraftStageOwner;
  summary: string;
  nodes: string[];
  successCriteria: string;
};

export type AutomationWorkflowDraft = {
  runtimeLane: AutomationRuntimeLane;
  changeMode: 'create-new' | 'update-existing';
  recommended: boolean;
  rationale: string[];
  routerShape: string;
  currentWorkflow: {
    name: string | null;
    tasks: string[];
  };
  starterCandidates: AutomationWorkflowDraftCandidate[];
  stages: AutomationWorkflowDraftStage[];
  modificationPolicy: string[];
};

export type AutomationDelegationMode = 'primary' | 'supporting' | 'escalation-only';

export type AutomationAssetDelegation = {
  assetId: string;
  defaultMode: AutomationDelegationMode;
  currentState: AutomationSurfaceState;
  ownership: string;
  useFor: string[];
  avoidFor: string[];
  currentBottleneck: string | null;
  nextMove: string;
};

export type AutomationOptimizerPlan = {
  objective: string;
  runtimeLane: AutomationRuntimeLane;
  sharedBenefitPhase: AutomationSharedBenefitPhase;
  dynamicWorkflowRequested: boolean;
  routePreview: AutomationRoutePreview;
  operatingContract: {
    ingressModel: string;
    stateOwners: {
      hotState: string;
      semanticOwner: string;
      artifactPlane: string;
      workflowRouter: string;
      teammateScaleOut: string;
    };
    serviceGuardrails: string[];
  };
  costPerformancePolicy: {
    defaultPath: string;
    reasoningTier: string;
    escalationBoundary: string;
    costControls: string[];
    latencyControls: string[];
  };
  observabilityPlan: {
    primaryTimeline: string[];
    signals: string[];
    currentGaps: string[];
  };
  workflowDraft: AutomationWorkflowDraft;
  assetDelegationMatrix: AutomationAssetDelegation[];
  sharedEnablementPlan: {
    currentMilestone: string[];
    futureMilestones: string[];
    blockedBy: string[];
  };
};

export type AutomationActivationPack = {
  targetObjective: string;
  objectiveClass: 'shared-mcp-bootstrap' | 'youtube-community' | 'validation' | 'general';
  summary: string;
  activateFirst: string[];
  recommendedSkills: Array<{
    skillId: string;
    reason: string;
  }>;
  readNext: string[];
  toolCalls: string[];
  commands: string[];
  apiSurfaces: string[];
  mcpSurfaces: string[];
  fallbackOrder: string[];
};

export type AutomationCanonicalExample = {
  exampleId: string;
  title: string;
  summary: string;
  currentRepoSurfaces: string[];
  trigger: string;
  apiPath: string[];
  routerDecision: string[];
  fallbackPath: string[];
  finalization: string[];
};

export type AutomationObservabilityCoverage = {
  primaryObserver: string;
  directCoverage: string[];
  complementaryCoverage: string[];
  currentGaps: string[];
  recommendedPlacement: string[];
};

export type AutomationOrchestrationGuidance = {
  currentPriority: 'compact-bootstrap-first';
  advisorStrategy: {
    priority: 'conditional-after-bootstrap';
    recommendedByDefault: false;
    rationale: string[];
    activationCriteria: string[];
    avoidWhen: string[];
  };
  tokenContextEconomics: {
    currentBottlenecks: string[];
    latestAuditHighlights: string[];
  };
};

export type AutomationRouteOrchestrationGuidance = {
  currentPriority: 'compact-bootstrap-first';
  advisorStrategy: {
    posture: 'not-needed' | 'conditional-escalation' | 'gpt-recall-instead';
    reason: string;
    maxAdvisorUses: number | null;
  };
};

type AdapterStatus = Awaited<ReturnType<typeof getExternalAdaptersStatus>>[number];

type N8nStarterWorkflowDefinition = {
  task: string;
  fileName: string;
  webhookEnv: string;
  webhookPath: string;
  description: string;
  manualFollowUp: string;
  workflow: Record<string, unknown> & {
    name: string;
  };
};

const AUTOMATION_RUNTIME_LANES: AutomationRuntimeLane[] = [
  'operator-personal',
  'public-guild',
  'system-internal',
];

const AUTOMATION_SHARED_BENEFIT_PHASES: AutomationSharedBenefitPhase[] = [
  'constraint-only',
  'phase-1',
  'required-now',
];

const STARTER_WORKFLOW_HINTS: Record<string, {
  objectiveKeywords: string[];
  apiHints: string[];
}> = {
  'news-rss-fetch': {
    objectiveKeywords: ['rss', 'headline', 'google news', 'news rss', 'news search'],
    apiHints: ['news-rss-fetch', 'rss', 'google news', 'news'],
  },
  'news-summarize': {
    objectiveKeywords: ['summarize', 'summary', 'brief', 'digest'],
    apiHints: ['news-summarize', 'summarize', 'summary'],
  },
  'news-monitor-candidates': {
    objectiveKeywords: ['monitor', 'candidate', 'watchlist', 'signal'],
    apiHints: ['news-monitor-candidates', 'monitor', 'candidate'],
  },
  'youtube-feed-fetch': {
    objectiveKeywords: ['youtube feed', 'channel feed', 'atom feed'],
    apiHints: ['youtube-feed-fetch', 'youtube feed'],
  },
  'youtube-community-scrape': {
    objectiveKeywords: ['youtube community', 'community post', 'community scrape'],
    apiHints: ['youtube-community-scrape', 'community'],
  },
  'alert-dispatch': {
    objectiveKeywords: ['alert', 'notify', 'notification', 'dispatch', 'webhook'],
    apiHints: ['alert-dispatch', 'alert', 'notify'],
  },
  'article-context-fetch': {
    objectiveKeywords: ['article context', 'article metadata', 'metadata', 'fetch article', 'extract title'],
    apiHints: ['article-context-fetch', 'article', 'metadata'],
  },
};

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeStringList = (value: unknown): string[] => Array.isArray(value)
  ? value.map((entry) => compact(entry)).filter(Boolean)
  : [];

const dedupeStringList = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
};

const findAdapter = (adapters: AdapterStatus[], adapterId: string): AdapterStatus | undefined =>
  adapters.find((adapter) => adapter.id === adapterId);

const resolveOperationalState = (params: {
  ready?: boolean;
  partial?: boolean;
  assumed?: boolean;
}): AutomationSurfaceState => {
  if (params.ready) return 'ready';
  if (params.partial) return 'partial';
  if (params.assumed) return 'assumed';
  return 'missing';
};

const buildCanonicalExamples = (): AutomationCanonicalExample[] => ([
  {
    exampleId: 'youtube-community-post-handoff',
    title: 'Reverse-engineered YouTube community post ingestion',
    summary: 'This repo already has a real API-first/agent-fallback style slice: a reverse-engineered YouTube community post workflow that avoids the missing official API by using a deterministic scrape path first and only escalates when the page shape or downstream interpretation fails.',
    currentRepoSurfaces: [
      'scripts/bootstrap-n8n-local.mjs :: buildN8nYoutubeCommunityScrapeWorkflow',
      'src/services/news/youtubeMonitorWorkerClient.ts',
      'src/services/automation/n8nDelegationService.ts :: youtube-community-scrape',
      'src/services/skills/actions/n8n.ts :: n8n.delegate.youtube-community',
    ],
    trigger: 'Webhook or monitor tick asking for the latest YouTube community post.',
    apiPath: [
      'n8n starter workflow or local worker fetches the community page with a deterministic HTML or InnerTube-based scrape path.',
      'The scrape returns a stable JSON payload: id, title, content, link, published, author.',
      'This path is already useful even without an official YouTube community API because it keeps the first pass deterministic and cheap.',
    ],
    routerDecision: [
      'If the scrape returns a valid post payload, continue on the deterministic path and publish or store the result.',
      'If the scrape fails because the page shape drifted, the router should escalate into MCP or Hermes fallback rather than pretending the API path succeeded.',
    ],
    fallbackPath: [
      'Hermes can inspect the local code, patch the parser, or run bounded diagnostics.',
      'Shared MCP can help with related knowledge retrieval, runbook lookup, or remote-capable tool use when the failure is not purely local.',
      'GPT recall remains the boundary for product, policy, or higher-risk interpretation changes.',
    ],
    finalization: [
      'Persist runtime facts into workflow events, artifact refs, and decision distillates.',
      'Promote durable parser or operating lessons into Obsidian rather than leaving them only in transient runtime logs.',
    ],
  },
]);

const buildObservabilityCoverage = (): AutomationObservabilityCoverage => ({
  primaryObserver: 'OpenJarvis is a strong adjunct observability surface, but not the sole canonical observer.',
  directCoverage: [
    'jarvis.telemetry gives aggregated telemetry stats from OpenJarvis itself.',
    'jarvis.eval and jarvis.bench cover quality, latency, and benchmark-oriented measurement.',
    'jarvis.optimize covers optimization experiments and iterative quality tuning.',
    'jarvis.memory.index and jarvis.memory.search help inspect what the local OpenJarvis memory projection can actually retrieve.',
    'jarvis.scheduler.list covers scheduled jobs known to OpenJarvis.',
  ],
  complementaryCoverage: [
    'Supabase workflow_sessions and workflow_events remain the canonical ledger for route decisions, recall boundaries, artifact refs, and decision distillates.',
    'The repository already exposes structured recall_request, artifact_ref, and decision_distillate hot-state objects beyond OpenJarvis telemetry.',
    'GitHub PRs, commit history, and CI evidence remain the repo-visible review and settlement trail when the route produces code or documentation artifacts.',
    'agentTelemetryQueue and readiness surfaces cover queue health and drop behavior outside OpenJarvis itself.',
    'n8n execution history and workflow logs remain the best source for router-node execution details at the orchestration layer.',
    'Obsidian decision.trace and shared wiki promotion remain the durable semantic audit layer after runtime execution settles.',
  ],
  currentGaps: [
    'OpenJarvis does not yet provide one end-to-end visual trace that automatically spans n8n router nodes, shared MCP tool calls, Hermes local edits, and Supabase hot-state writes as a single timeline.',
    'OpenJarvis telemetry does not replace provider-native or workflow-native logs for ext.* and upstream.* wrappers.',
    'A high-fidelity reasoning trace still needs careful policy treatment; the repo should prefer compact decision distillates and artifact refs over raw unrestricted chain-of-thought storage.',
  ],
  recommendedPlacement: [
    'OpenJarvis: local telemetry, evaluation, optimization, and memory-projection observability.',
    'Supabase hot-state: canonical route events, recall boundaries, artifact refs, and runtime lane separation.',
    'GitHub: repo-visible review threads, CI evidence, and merge settlement for code or docs artifacts.',
    'n8n: workflow-router execution logs, wait and retry boundaries, and trigger history.',
    'Obsidian: durable decision history, runbook updates, and architecture-significant distillates.',
  ],
});

const buildOrchestrationGuidance = (): AutomationOrchestrationGuidance => ({
  currentPriority: 'compact-bootstrap-first',
  advisorStrategy: {
    priority: 'conditional-after-bootstrap',
    recommendedByDefault: false,
    rationale: [
      'The current repo bottleneck is startup context pressure across workflow and skill surfaces, not the absence of another subordinate orchestration layer.',
      'Advisor-style escalation only becomes cost-effective after the executor already starts from a compact hot-state bundle and only consults the higher-reasoning surface at hard decision points.',
      'In this repository, GPT already serves as the expensive episodic reasoning surface while Hermes is the persistent executor, so the first optimization is bundle compaction and route guidance reuse rather than adding a default extra advisor hop.',
    ],
    activationCriteria: [
      'Use only for repeated bounded tasks where Hermes or another cheaper executor can drive tools end-to-end and escalate rarely.',
      'Keep advisor output short and guidance-only; the advisor should not become the default tool caller or user-facing response surface.',
      'Cap advisory calls explicitly and track the spend separately from executor tokens.',
      'Enable only after compact session-open bundle, route guidance, and hot-state distillates are already in place.',
    ],
    avoidWhen: [
      'Do not add an advisor layer just to compensate for oversized startup context or duplicated planning documents.',
      'Do not route policy-sensitive or approval-boundary decisions into a hidden subordinate advisor; those still require GPT recall.',
      'Do not put advisor escalation in the default path for deterministic API-first routes that already terminate cheaply.',
    ],
  },
  tokenContextEconomics: {
    currentBottlenecks: [
      'workflow scripts and orchestration files dominate the current context footprint more than always-on instructions do.',
      'large SKILL.md and workflow surfaces still cost more than the compact session-open bundle, so bootstrap compression yields more immediate value than adding another orchestration tier.',
    ],
    latestAuditHighlights: [
      'context-footprint audit: workflows≈25457 estimated tokens, skills≈9566, file-instructions≈10347, workspace-instructions≈1615.',
      'largest current workflow files are run-openjarvis-goal-cycle.mjs and run-openjarvis-unattended.mjs, which indicates routing and bootstrap compaction remain the highest-leverage optimization.',
    ],
  },
});

const buildRouteOrchestrationGuidance = (params: {
  recommendedMode: AutomationRouteMode;
  policySensitive: boolean;
  requiresReasoning: boolean;
}): AutomationRouteOrchestrationGuidance => {
  if (params.policySensitive || params.recommendedMode === 'gpt-recall') {
    return {
      currentPriority: 'compact-bootstrap-first',
      advisorStrategy: {
        posture: 'gpt-recall-instead',
        reason: 'This route crosses a policy, approval, or high-risk ambiguity boundary, so GPT recall remains the correct escalation instead of a hidden subordinate advisor.',
        maxAdvisorUses: null,
      },
    };
  }

  if (
    !params.requiresReasoning
    && (params.recommendedMode === 'api-first' || params.recommendedMode === 'api-first-with-agent-fallback')
  ) {
    return {
      currentPriority: 'compact-bootstrap-first',
      advisorStrategy: {
        posture: 'not-needed',
        reason: 'The deterministic API-first path is already sufficient, and fallback remains an exception path rather than a default reasoning checkpoint, so another advisor layer would add overhead without improving the route.',
        maxAdvisorUses: null,
      },
    };
  }

  return {
    currentPriority: 'compact-bootstrap-first',
    advisorStrategy: {
      posture: 'conditional-escalation',
      reason: 'Use advisor-style escalation only if the cheaper executor reaches a hard reasoning checkpoint after starting from the compact session-open bundle and existing route guidance.',
      maxAdvisorUses: 1,
    },
  };
};

const matchCanonicalExamples = (objective: string, candidateApis: string[], candidateMcpTools: string[]): string[] => {
  const haystack = [objective, ...candidateApis, ...candidateMcpTools].join(' ').toLowerCase();
  const matches: string[] = [];

  if (haystack.includes('youtube') || haystack.includes('community')) {
    matches.push('youtube-community-post-handoff');
  }

  return matches;
};

const buildRuntimeSnapshot = async (refreshUpstreams = false) => {
  if (refreshUpstreams) {
    await listProxiedTools();
  }

  const [adapters] = await Promise.all([
    getExternalAdaptersStatus(),
  ]);

  const delegation = getDelegationStatus();
  const upstreams = listUpstreamDiagnostics();
  const enabledUpstreams = upstreams.filter((entry) => entry.enabled);
  const configuredN8nTaskCount = Object.values(delegation.tasks).filter((task) => task.configured).length;

  return {
    adapters,
    delegation,
    enabledUpstreams,
    configuredN8nTaskCount,
  };
};

export const buildAutomationCapabilityCatalog = async (options: {
  refreshUpstreams?: boolean;
} = {}): Promise<AutomationCapabilityCatalog> => {
  const snapshot = await buildRuntimeSnapshot(options.refreshUpstreams === true);
  const { adapters, delegation, enabledUpstreams, configuredN8nTaskCount } = snapshot;

  const n8nAdapter = findAdapter(adapters, 'n8n');
  const obsidianAdapter = findAdapter(adapters, 'obsidian');
  const openjarvisAdapter = findAdapter(adapters, 'openjarvis');
  const ollamaAdapter = findAdapter(adapters, 'ollama');
  const renderAdapter = findAdapter(adapters, 'render');
  const workstationAdapter = findAdapter(adapters, 'workstation');

  const surfaces: AutomationSurface[] = [
    {
      surfaceId: 'obsidian-semantic-owner',
      layer: 'semantic-owner',
      operationalState: resolveOperationalState({
        ready: Boolean(obsidianAdapter?.available),
        partial: !obsidianAdapter?.available,
      }),
      responsibility: 'Durable semantic ownership for decisions, runbooks, retros, and development archaeology.',
      bindings: ['obsidian.*', 'shared Obsidian via gcpCompute/shared MCP'],
      preferredWhen: ['decision history', 'operator context', 'durable knowledge promotion'],
      avoidWhen: ['wake-up signals', 'tight retry loops', 'short-lived execution heartbeats'],
    },
    {
      surfaceId: 'supabase-hot-state',
      layer: 'hot-state',
      operationalState: 'assumed',
      responsibility: 'Structured workstream state for workflow sessions, events, recalls, and runtime lanes.',
      bindings: ['workflow_sessions', 'workflow_steps', 'workflow_events'],
      preferredWhen: ['shared task state', 'routing decisions', 'runtime subscriptions'],
      avoidWhen: ['semantic source of truth', 'operator-facing architecture explanations'],
    },
    {
      surfaceId: 'github-artifact-plane',
      layer: 'artifact-review',
      operationalState: 'assumed',
      responsibility: 'Repo-visible artifact, review, and settlement plane for code changes, documentation deltas, CI evidence, and merge history.',
      bindings: ['git refs and commits', 'GitHub PRs/issues', 'CI artifacts and release evidence'],
      preferredWhen: ['repo-visible code or docs artifacts', 'review threads and merge settlement', 'CI or release evidence'],
      avoidWhen: ['shared mutable workflow state', 'durable semantic ownership'],
    },
    {
      surfaceId: 'n8n-router',
      layer: 'api-first',
      operationalState: resolveOperationalState({
        ready: Boolean(n8nAdapter?.available) && configuredN8nTaskCount > 0,
        partial: Boolean(n8nAdapter?.available) || configuredN8nTaskCount > 0,
      }),
      responsibility: 'Webhook, schedule, wait, retry, and IF/Switch routing for deterministic API-first automation.',
      bindings: ['ext.n8n.workflow.trigger', 'ext.n8n.workflow.list', 'N8N_WEBHOOK_* delegation paths'],
      preferredWhen: ['structured API lookup', 'FAQ match', 'long-running waits', 'schedule/webhook entrypoints'],
      avoidWhen: ['high-ambiguity reasoning', 'policy-sensitive acceptance decisions'],
    },
    {
      surfaceId: 'gcpcompute-shared-mcp',
      layer: 'mcp-wrapping',
      operationalState: resolveOperationalState({
        ready: enabledUpstreams.length > 0,
      }),
      responsibility: 'Shared MCP wrapper for operator knowledge, shared code intelligence, and remote-capable tool lanes.',
      bindings: enabledUpstreams.length > 0
        ? enabledUpstreams.map((entry) => `upstream.${entry.namespace}.*`)
        : ['upstream.<namespace>.<tool>'],
      preferredWhen: ['shared knowledge retrieval', 'team-shared tooling', 'remote-capable reasoning/tool use'],
      avoidWhen: ['local-only dirty workspace edits', 'machine-local interactive shells'],
    },
    {
      surfaceId: 'external-mcp-wrappers',
      layer: 'mcp-wrapping',
      operationalState: resolveOperationalState({
        ready: adapters.some((adapter) => adapter.available),
      }),
      responsibility: 'Expose provider-native APIs and CLIs as MCP-callable ext.* capabilities without changing provider auth/versioning.',
      bindings: ['ext.<adapterId>.<capability>'],
      preferredWhen: ['wrapping existing REST or CLI surfaces', 'LLM-friendly JSON contracts', 'incremental provider onboarding'],
      avoidWhen: ['semantic ownership', 'human approval policy decisions'],
    },
    {
      surfaceId: 'hermes-local-operator',
      layer: 'agent-fallback',
      operationalState: resolveOperationalState({
        ready: Boolean(openjarvisAdapter?.available) || Boolean(ollamaAdapter?.available),
        partial: Boolean(openjarvisAdapter?.available) || Boolean(ollamaAdapter?.available),
      }),
      responsibility: 'Persistent local fallback for IDE control, bounded reasoning, shell execution, and escalation preparation across GPT session boundaries.',
      bindings: ['Hermes goal-cycle', 'VS Code CLI allowlist bridge', 'openjarvis/ollama local reasoning lane'],
      preferredWhen: ['non-deterministic local work', 'IDE mutation', 'machine-local observation', 'fallback after API miss'],
      avoidWhen: ['high-stakes policy decisions', 'final acceptance without recall'],
    },
    {
      surfaceId: 'local-workstation-executor',
      layer: 'agent-fallback',
      operationalState: resolveOperationalState({
        ready: Boolean(workstationAdapter?.available),
      }),
      responsibility: 'Bounded local actuator for explicit command execution, browser and desktop control, text or hotkey input, screenshot capture, and workspace-scoped file operations.',
      bindings: ['ext.workstation.command.exec', 'ext.workstation.browser.open', 'ext.workstation.app.*', 'ext.workstation.input.*', 'ext.workstation.screen.capture', 'ext.workstation.file.*'],
      preferredWhen: ['browser or desktop steps on the operator machine', 'explicit local command steps that should stay observable', 'active-window input or focus changes', 'local screenshot capture', 'workspace-scoped file reads or writes'],
      avoidWhen: ['remote shared execution', 'out-of-workspace mutation', 'public acceptance without sanitization'],
    },
    {
      surfaceId: 'remote-heavy-execution',
      layer: 'remote-execution',
      operationalState: resolveOperationalState({
        ready: Boolean(renderAdapter?.available) || enabledUpstreams.length > 0,
        partial: Boolean(renderAdapter?.available) || enabledUpstreams.length > 0,
      }),
      responsibility: 'Always-on or heavy remote execution lane for shared MCP, remote workers, and hosted automation surfaces.',
      bindings: ['Render adapter', 'shared MCP upstreams', 'remote OpenJarvis or worker lanes'],
      preferredWhen: ['always-on automation', 'remote-capable jobs', 'shared services'],
      avoidWhen: ['local-only file edits', 'human-visible interactive local shells'],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    model: 'API-First & Agent-Fallback',
    surfaces,
    canonicalExamples: buildCanonicalExamples(),
    observability: buildObservabilityCoverage(),
    orchestrationGuidance: buildOrchestrationGuidance(),
    wrapperPattern: {
      localProviderPattern: 'ext.<adapterId>.<capability>',
      sharedProviderPattern: 'upstream.<namespace>.<tool>',
      guidance: [
        'Keep authentication, authorization, versioning, and monitoring in the provider-native API or CLI layer.',
        'Expose only stable provider capabilities as MCP tools and normalize request or response contracts into LLM-friendly JSON.',
        'Use n8n as the router for webhook, schedule, wait, and retry orchestration, then escalate to MCP or Hermes only when deterministic API handling is exhausted.',
      ],
    },
    runtimeSignals: {
      configuredN8nTaskCount,
      availableAdapters: adapters.filter((adapter) => adapter.available).map((adapter) => adapter.id),
      upstreamNamespaces: enabledUpstreams.map((entry) => entry.namespace),
    },
  };
};

const buildPrimaryApiActions = (params: {
  objective: string;
  trigger: string;
  structuredDataAvailable: boolean;
  clearApiAnswer: boolean;
  candidateApis: string[];
}): string[] => {
  const actions = [
    `Start from the ${params.trigger} trigger and persist route intent for: ${params.objective}.`,
    'Use deterministic API or DB lookups first and keep this step inside n8n or another low-cost API surface.',
  ];

  if (params.candidateApis.length > 0) {
    actions.push(`Probe candidate APIs first: ${params.candidateApis.join(', ')}.`);
  }

  if (params.structuredDataAvailable) {
    actions.push('Evaluate structured lookup completeness before invoking any reasoning-heavy path.');
  }

  if (params.clearApiAnswer) {
    actions.push('Return directly from the API path when the answer is deterministic and confidence is high.');
  } else {
    actions.push('Branch with IF or Switch when the API path is incomplete, ambiguous, or empty.');
  }

  return actions;
};

const buildFallbackActions = (params: {
  executionPreference: 'local' | 'remote' | 'hybrid';
  candidateMcpTools: string[];
  upstreamNamespaces: string[];
  localReasoningReady: boolean;
  workstationReady: boolean;
}): { surfaces: string[]; actions: string[] } => {
  const surfaces: string[] = [];
  const actions: string[] = [];

  if (params.upstreamNamespaces.length > 0) {
    surfaces.push('gcpcompute-shared-mcp');
    actions.push(`Call shared MCP tools first for team-shared knowledge or remote-capable tools: ${params.upstreamNamespaces.join(', ')}.`);
  }

  if (params.executionPreference !== 'remote') {
    surfaces.push('hermes-local-operator');
    actions.push('Let Hermes handle local IDE, shell, or bounded reasoning work after the API router declares a miss.');
    if (params.workstationReady) {
      surfaces.push('local-workstation-executor');
      actions.push('Use the local workstation executor for bounded browser, desktop app, screenshot, or workspace file steps instead of ad hoc shell glue.');
    }
  }

  if (params.localReasoningReady) {
    actions.push('Use local OpenJarvis or Ollama for bounded non-deterministic reasoning before escalating to GPT.');
  }

  if (params.executionPreference !== 'local') {
    surfaces.push('remote-heavy-execution');
    actions.push('Dispatch heavy or always-on tasks to the remote execution lane when local execution is not the best fit.');
  }

  if (params.candidateMcpTools.length > 0) {
    actions.push(`Prefer these wrapped MCP tools once fallback fires: ${params.candidateMcpTools.join(', ')}.`);
  }

  actions.push('Emit a compact distillate and artifact refs back into the structured workstream state when fallback completes.');

  return { surfaces: [...new Set(surfaces)], actions };
};

export const previewApiFirstAgentFallbackRoute = async (
  input: AutomationRoutePreviewInput,
): Promise<AutomationRoutePreview> => {
  const objective = compact(input.objective);
  const trigger = compact(input.trigger) || 'manual';
  const structuredDataAvailable = input.structuredDataAvailable === true;
  const clearApiAnswer = input.clearApiAnswer === true;
  const requiresReasoning = input.requiresReasoning === true;
  const requiresLongRunningWait = input.requiresLongRunningWait === true;
  const requiresDurableKnowledge = input.requiresDurableKnowledge !== false;
  const policySensitive = input.policySensitive === true;
  const executionPreference = input.executionPreference || 'hybrid';
  const candidateApis = sanitizeStringList(input.candidateApis);
  const candidateMcpTools = sanitizeStringList(input.candidateMcpTools);
  const matchedExampleIds = matchCanonicalExamples(objective, candidateApis, candidateMcpTools);

  const snapshot = await buildRuntimeSnapshot(false);
  const upstreamNamespaces = snapshot.enabledUpstreams.map((entry) => entry.namespace);
  const localReasoningReady = ['openjarvis', 'ollama'].some((adapterId) => {
    const adapter = findAdapter(snapshot.adapters, adapterId);
    return Boolean(adapter?.available);
  });
  const workstationReady = Boolean(findAdapter(snapshot.adapters, 'workstation')?.available);
  const hasReasoningFallback = localReasoningReady || upstreamNamespaces.length > 0;

  let recommendedMode: AutomationRouteMode;
  if (policySensitive) {
    recommendedMode = 'gpt-recall';
  } else if (structuredDataAvailable && clearApiAnswer && !requiresReasoning) {
    recommendedMode = 'api-first';
  } else if (structuredDataAvailable || requiresLongRunningWait) {
    recommendedMode = 'api-first-with-agent-fallback';
  } else {
    recommendedMode = 'agent-fallback';
  }

  const rationale: string[] = [];
  if (structuredDataAvailable) {
    rationale.push('A structured API or database lookup path exists, so deterministic handling should run first.');
  } else {
    rationale.push('No reliable structured answer path was declared, so fallback reasoning must be planned early.');
  }
  if (clearApiAnswer) {
    rationale.push('The request can terminate on the API path if the deterministic match succeeds.');
  }
  if (requiresReasoning) {
    rationale.push('The task requires non-deterministic reasoning or synthesis after the API path.');
  }
  if (requiresLongRunningWait) {
    rationale.push('A schedule, webhook, or wait boundary exists, so n8n remains the preferred orchestration surface.');
  }
  if (policySensitive) {
    rationale.push('The task is policy-sensitive, so GPT recall is the required escalation boundary.');
  }

  const primaryPath = recommendedMode === 'gpt-recall'
    ? {
      pathType: 'recall' as const,
      surfaces: ['hermes-local-operator'],
      actions: [
        'Do not continue autonomously.',
        'Raise a structured recall request with the blocked action, evidence refs, and next decision needed from GPT.',
      ],
    }
    : recommendedMode === 'agent-fallback'
      ? {
        pathType: 'mcp-path' as const,
        surfaces: [
          'gcpcompute-shared-mcp',
          'hermes-local-operator',
          ...(executionPreference !== 'remote' && workstationReady ? ['local-workstation-executor'] : []),
        ],
        actions: [
          'Start from MCP or Hermes because the deterministic API path is too weak for this request.',
          'Treat ext.* and upstream.* tools as the wrapping layer over provider-native APIs and CLIs.',
        ],
      }
      : {
        pathType: 'api-path' as const,
        surfaces: ['n8n-router', 'supabase-hot-state'],
        actions: buildPrimaryApiActions({
          objective,
          trigger,
          structuredDataAvailable,
          clearApiAnswer,
          candidateApis,
        }),
      };

  const fallbackPath = buildFallbackActions({
    executionPreference,
    candidateMcpTools,
    upstreamNamespaces,
    localReasoningReady,
    workstationReady,
  });

  const activationPack = buildAutomationActivationPack({
    sourceSurface: 'route-preview',
    objective,
    matchedExampleIds,
    candidateApis,
    candidateMcpTools,
    primarySurfaces: primaryPath.surfaces,
    fallbackSurfaces: fallbackPath.surfaces,
    requiresDurableKnowledge,
  }) as AutomationActivationPack;

  const escalationRequired = policySensitive || (!hasReasoningFallback && (requiresReasoning || !clearApiAnswer));

  return {
    objective,
    recommendedMode,
    rationale,
    activationPack,
    orchestrationGuidance: buildRouteOrchestrationGuidance({
      recommendedMode,
      policySensitive,
      requiresReasoning,
    }),
    matchedExampleIds,
    primaryPath,
    fallbackPath,
    statePlane: {
      hotState: 'Supabase workflow sessions/events remain the shared hot-state plane.',
      orchestration: snapshot.configuredN8nTaskCount > 0
        ? 'n8n is available for trigger routing, waits, retries, and webhook glue.'
        : 'Hermes can run directly against the hot-state plane until more n8n routes are activated.',
      semanticOwner: requiresDurableKnowledge
        ? 'Promote durable conclusions into Obsidian after runtime execution settles.'
        : 'Obsidian promotion can remain optional for this short-lived task.',
      artifactPlane: 'GitHub remains the repo-visible artifact, review, and settlement plane for code, docs, CI evidence, and merge history.',
    },
    modelPolicy: {
      apiPath: 'Do not spend LLM budget on the API path unless the deterministic lookup misses or returns low confidence.',
      fallbackPath: executionPreference === 'local'
        ? 'Prefer Hermes plus local OpenJarvis or Ollama for bounded reasoning, then shared MCP if local capability is insufficient.'
        : executionPreference === 'remote'
          ? 'Prefer shared MCP or remote workers first, using Hermes only for local control-plane or file-system work.'
          : 'Use n8n plus API lookups first, then shared MCP for knowledge/tool use, then Hermes for local execution or IDE mutation.',
      escalation: 'Escalate to GPT when policy, architecture, destructive change, or unresolved ambiguity crosses the fallback boundary.',
    },
    wrappingLayer: {
      localPattern: 'ext.<adapterId>.<capability>',
      sharedPattern: 'upstream.<namespace>.<tool>',
      recommendations: [
        'Wrap provider-native APIs without moving auth or versioning into the agent layer.',
        'Keep the router deterministic: API-first, then explicit decision point, then MCP or Hermes fallback.',
        'Persist route outcome in Supabase hot-state and promote only durable conclusions into Obsidian.',
      ],
    },
    candidates: {
      apis: candidateApis,
      mcpTools: candidateMcpTools,
    },
    escalation: {
      required: escalationRequired,
      target: escalationRequired ? 'gpt' : 'none',
      reason: escalationRequired
        ? policySensitive
          ? 'Policy-sensitive or high-risk work requires GPT acceptance.'
          : 'No reliable reasoning fallback is ready for this ambiguous task.'
        : 'Current API and fallback surfaces are sufficient for bounded automation.',
    },
  };
};

const resolveRuntimeLane = (value: unknown): AutomationRuntimeLane => {
  const normalized = compact(value);
  return AUTOMATION_RUNTIME_LANES.includes(normalized as AutomationRuntimeLane)
    ? normalized as AutomationRuntimeLane
    : 'operator-personal';
};

const resolveSharedBenefitPhase = (value: unknown): AutomationSharedBenefitPhase => {
  const normalized = compact(value);
  return AUTOMATION_SHARED_BENEFIT_PHASES.includes(normalized as AutomationSharedBenefitPhase)
    ? normalized as AutomationSharedBenefitPhase
    : 'constraint-only';
};

const buildStarterWorkflowCatalog = (): Map<string, N8nStarterWorkflowDefinition> => {
  const definitions = buildN8nStarterWorkflowDefinitions() as N8nStarterWorkflowDefinition[];
  return new Map(definitions.map((definition) => [definition.task, definition]));
};

const scoreStarterWorkflow = (params: {
  task: string;
  objectiveLower: string;
  candidateApisLower: string[];
  existingWorkflowTasksLower: string[];
}): number => {
  const hint = STARTER_WORKFLOW_HINTS[params.task];
  if (!hint) {
    return 0;
  }

  let score = 0;

  if (params.candidateApisLower.includes(params.task)) {
    score += 6;
  }

  if (params.existingWorkflowTasksLower.includes(params.task)) {
    score += 4;
  }

  if (params.candidateApisLower.some((candidate) => hint.apiHints.some((apiHint) => candidate.includes(apiHint)))) {
    score += 3;
  }

  for (const keyword of hint.objectiveKeywords) {
    if (params.objectiveLower.includes(keyword)) {
      score += 2;
    }
  }

  if (params.task === 'youtube-feed-fetch' && params.objectiveLower.includes('youtube') && !params.objectiveLower.includes('community')) {
    score += 1;
  }

  if ((params.task === 'news-rss-fetch' || params.task === 'news-summarize') && params.objectiveLower.includes('news')) {
    score += 1;
  }

  if (params.task === 'article-context-fetch' && (params.objectiveLower.includes('article') || params.objectiveLower.includes('metadata'))) {
    score += 1;
  }

  return score;
};

const matchStarterWorkflowTasks = (params: {
  objective: string;
  candidateApis: string[];
  existingWorkflowTasks: string[];
}): string[] => {
  const objectiveLower = params.objective.toLowerCase();
  const candidateApisLower = params.candidateApis.map((entry) => entry.toLowerCase());
  const existingWorkflowTasksLower = params.existingWorkflowTasks.map((entry) => entry.toLowerCase());
  const catalog = buildStarterWorkflowCatalog();

  return Array.from(catalog.keys())
    .map((task) => ({
      task,
      score: scoreStarterWorkflow({
        task,
        objectiveLower,
        candidateApisLower,
        existingWorkflowTasksLower,
      }),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.task.localeCompare(right.task))
    .map((entry) => entry.task)
    .slice(0, 3);
};

const buildWorkflowDraftRouterShape = (params: {
  routePreview: AutomationRoutePreview;
  trigger: string;
}): string => {
  const triggerLabel = params.trigger || 'manual';

  if (params.routePreview.recommendedMode === 'api-first') {
    return `${triggerLabel} -> deterministic lookup -> success return -> structured closeout`;
  }

  if (params.routePreview.recommendedMode === 'api-first-with-agent-fallback') {
    return `${triggerLabel} -> deterministic lookup -> explicit IF/Switch -> MCP or Hermes fallback -> structured closeout`;
  }

  if (params.routePreview.recommendedMode === 'agent-fallback') {
    return `${triggerLabel} -> MCP or Hermes fallback -> explicit recall gate -> structured closeout`;
  }

  return `${triggerLabel} -> evidence capture -> GPT recall -> structured closeout`;
};

const buildWorkflowDraftStages = (params: {
  trigger: string;
  runtimeLane: AutomationRuntimeLane;
  routePreview: AutomationRoutePreview;
  requiresDurableKnowledge: boolean;
}): AutomationWorkflowDraftStage[] => {
  const stages: AutomationWorkflowDraftStage[] = [
    {
      stageId: 'ingress',
      owner: 'api-router',
      summary: params.trigger === 'schedule'
        ? 'Start from a schedule trigger and persist the run into workflow hot-state before branching.'
        : params.trigger === 'webhook'
          ? 'Start from a webhook trigger and persist the inbound request into workflow hot-state before branching.'
          : params.trigger === 'event'
            ? 'Start from an event ingress and record the route intent before branching.'
            : 'Start from a manual ingress and create a workflow run before branching.',
      nodes: dedupeStringList([
        params.trigger === 'schedule'
          ? 'Schedule Trigger'
          : params.trigger === 'webhook'
            ? 'Webhook'
            : params.trigger === 'event'
              ? 'Event Trigger'
              : 'Manual Trigger',
        'workflow_session.start',
        'workflow_event.route_intent',
      ]),
      successCriteria: 'Every run has a stable workflow identity and runtime lane before any external side effect fires.',
    },
  ];

  if (params.routePreview.primaryPath.pathType === 'api-path') {
    stages.push({
      stageId: 'deterministic-path',
      owner: 'api-router',
      summary: 'Run deterministic API, DB, or n8n task handling first and keep the happy path free of unnecessary reasoning spend.',
      nodes: dedupeStringList([
        ...params.routePreview.primaryPath.actions,
        'HTTP Request or DB Query',
        'Completeness Check',
      ]),
      successCriteria: 'The route returns a bounded structured result or explicitly declares that fallback is required.',
    });
  } else if (params.routePreview.primaryPath.pathType === 'mcp-path') {
    stages.push({
      stageId: 'fallback-first',
      owner: 'mcp-wrapper',
      summary: 'Begin from wrapped MCP or Hermes surfaces because no stable deterministic path is strong enough to own the route.',
      nodes: dedupeStringList([
        ...params.routePreview.primaryPath.surfaces,
        ...params.routePreview.primaryPath.actions,
      ]),
      successCriteria: 'Fallback starts from an explicit wrapped surface rather than an implicit reasoning jump.',
    });
  }

  if (params.routePreview.recommendedMode !== 'gpt-recall') {
    stages.push({
      stageId: 'decision-router',
      owner: 'api-router',
      summary: 'Use an explicit IF or Switch boundary to decide whether the current result is sufficient or whether fallback must fire.',
      nodes: dedupeStringList([
        'IF or Switch',
        'Confidence or completeness gate',
        ...params.routePreview.matchedExampleIds,
      ]),
      successCriteria: 'Every non-happy path branches explicitly to fallback or recall instead of silently widening scope.',
    });
  }

  if (params.routePreview.fallbackPath.surfaces.length > 0) {
    stages.push({
      stageId: 'fallback-execution',
      owner: params.routePreview.fallbackPath.surfaces.includes('gcpcompute-shared-mcp')
        ? 'mcp-wrapper'
        : 'hermes-local',
      summary: 'Fallback should stay bounded: prefer wrapped shared tools first when available, then Hermes and the workstation executor for machine-local mutation, screenshots, browser launch, or diagnostics.',
      nodes: dedupeStringList([
        ...params.routePreview.fallbackPath.surfaces,
        ...params.routePreview.fallbackPath.actions,
      ]),
      successCriteria: 'Fallback completes with explicit artifact refs and decision distillates, not open-ended hidden reasoning.',
    });
  }

  if (params.routePreview.escalation.required) {
    stages.push({
      stageId: 'gpt-recall',
      owner: 'gpt-recall',
      summary: 'Cross the GPT recall boundary only when policy, product ambiguity, or missing reasoning coverage makes autonomous continuation unsafe.',
      nodes: ['recall_request', params.routePreview.escalation.reason],
      successCriteria: 'The route halts at the acceptance boundary with clear evidence and the exact next decision needed.',
    });
  }

  stages.push({
    stageId: 'finalize',
    owner: 'supabase-hot-state',
    summary: params.runtimeLane === 'public-guild'
      ? 'Finalize through the hot-state ledger, sanitize the public deliverable, and emit only the bounded result before any repo-visible settlement.'
      : 'Finalize through the hot-state ledger with a compact decision distillate before any repo-visible artifact settlement.'
    ,
    nodes: dedupeStringList([
      'workflow_event.route_selected',
      'decision_distillate',
      params.runtimeLane === 'public-guild' ? 'deliverable_sanitizer' : null,
    ]),
    successCriteria: 'The route closes with a compact ledger update and no ambiguous final state.',
  });

  stages.push({
    stageId: 'artifact-settlement',
    owner: 'github-artifact-plane',
    summary: params.runtimeLane === 'public-guild'
      ? 'When the route changes repo-visible automation behavior, settle code, docs, CI evidence, and reviewable artifacts through GitHub while the public reply remains bounded.'
      : 'Settle repo-visible code, docs, CI evidence, and reviewable artifacts through GitHub instead of treating hot-state or Obsidian as the artifact plane.',
    nodes: dedupeStringList([
      'artifact_ref',
      'GitHub PR, commit, or issue evidence',
      'CI or review status',
    ]),
    successCriteria: 'Repo-visible artifacts settle on GitHub and the hot-state ledger keeps only compact pointers back to that reviewable surface.',
  });

  if (params.requiresDurableKnowledge) {
    stages.push({
      stageId: 'durable-promotion',
      owner: 'obsidian',
      summary: 'Promote only durable operator meaning into Obsidian after runtime execution settles.',
      nodes: ['Obsidian decision distillate', 'runbook or changelog update when architecture-significant'],
      successCriteria: 'Durable knowledge moves to Obsidian without turning runtime packets into the semantic owner.',
    });
  }

  return stages;
};

const buildWorkflowDraftInternal = (params: {
  input: AutomationWorkflowDraftInput;
  routePreview: AutomationRoutePreview;
  dynamicWorkflowRequested: boolean;
}): AutomationWorkflowDraft => {
  const runtimeLane = resolveRuntimeLane(params.input.runtimeLane);
  const sharedBenefitPhase = resolveSharedBenefitPhase(params.input.sharedBenefitPhase);
  const trigger = compact(params.input.trigger) || 'manual';
  const existingWorkflowName = compact(params.input.existingWorkflowName) || null;
  const existingWorkflowTasks = dedupeStringList(sanitizeStringList(params.input.existingWorkflowTasks));
  const changeMode = existingWorkflowName || existingWorkflowTasks.length > 0
    ? 'update-existing'
    : 'create-new';
  const candidateApis = dedupeStringList(sanitizeStringList(params.input.candidateApis));
  const starterWorkflowTasks = matchStarterWorkflowTasks({
    objective: params.routePreview.objective,
    candidateApis,
    existingWorkflowTasks,
  });
  const starterWorkflowCatalog = buildStarterWorkflowCatalog();
  const starterCandidates = starterWorkflowTasks
    .map((task) => {
      const definition = starterWorkflowCatalog.get(task);
      if (!definition) {
        return null;
      }

      return {
        task: definition.task,
        workflowName: definition.workflow.name,
        fileName: definition.fileName,
        webhookPath: definition.webhookPath,
        description: definition.description,
        manualFollowUp: definition.manualFollowUp,
        seedPayload: params.input.includeSeedPayload === true
          ? toN8nWorkflowSeedPayload(definition.workflow) as Record<string, unknown>
          : undefined,
        workflow: params.input.includeWorkflowPayload === true
          ? definition.workflow
          : undefined,
      } satisfies AutomationWorkflowDraftCandidate;
    })
    .filter((candidate) => candidate != null) as AutomationWorkflowDraftCandidate[];

  return {
    runtimeLane,
    changeMode,
    recommended: params.dynamicWorkflowRequested
      || params.routePreview.primaryPath.pathType === 'api-path'
      || params.input.requiresLongRunningWait === true
      || starterCandidates.length > 0,
    rationale: dedupeStringList([
      ...params.routePreview.rationale,
      starterCandidates.length > 0
        ? `Matched reusable n8n starter workflows: ${starterCandidates.map((candidate) => candidate.task).join(', ')}.`
        : 'No close starter workflow matched, so keep the draft at router-stage level until a deterministic task stabilizes.',
      runtimeLane === 'public-guild'
        ? 'Public Discord traffic requires explicit deliverable sanitization and a bounded fallback contract.'
        : null,
    ]),
    routerShape: buildWorkflowDraftRouterShape({
      routePreview: params.routePreview,
      trigger,
    }),
    currentWorkflow: {
      name: existingWorkflowName,
      tasks: existingWorkflowTasks,
    },
    starterCandidates,
    stages: buildWorkflowDraftStages({
      trigger,
      runtimeLane,
      routePreview: params.routePreview,
      requiresDurableKnowledge: params.input.requiresDurableKnowledge !== false,
    }),
    modificationPolicy: dedupeStringList([
      changeMode === 'update-existing'
        ? `Modify the existing workflow${existingWorkflowName ? ` ${existingWorkflowName}` : ''} by patching router, fallback, hot-state closeout, and artifact-settlement stages instead of rebuilding provider auth or trigger ownership from scratch.`
        : 'Create a new workflow around ingress, deterministic routing, explicit fallback, hot-state closeout, and artifact settlement only.',
      'Keep waits, retries, and schedule or webhook ingress in n8n rather than inside GPT or Hermes runtime turns.',
      'Keep GitHub artifact settlement distinct from Supabase closeout and Obsidian durable promotion.',
      runtimeLane === 'public-guild'
        ? 'Preserve public-guild sanitization and keep GPT recall as the explicit boundary for policy or product ambiguity.'
        : 'Keep GPT recall as the explicit boundary for policy, destructive change, or unresolved ambiguity.',
      sharedBenefitPhase === 'required-now'
        ? 'Promote stable wrapper contracts into shared MCP during this change so teammates can consume the same ingress immediately.'
        : 'Keep teammate benefit as a wrapper-compatibility constraint first; do not block the local-first milestone on remote promotion.',
      starterCandidates.length > 0
        ? `Prefer the reusable starter tasks as the first draft basis: ${starterCandidates.map((candidate) => candidate.task).join(', ')}.`
        : null,
    ]),
  };
};

const buildAssetDelegationMatrix = (params: {
  runtimeLane: AutomationRuntimeLane;
  routePreview: AutomationRoutePreview;
  sharedBenefitPhase: AutomationSharedBenefitPhase;
  snapshot: Awaited<ReturnType<typeof buildRuntimeSnapshot>>;
  requiresDurableKnowledge: boolean;
}): AutomationAssetDelegation[] => {
  const n8nAdapter = findAdapter(params.snapshot.adapters, 'n8n');
  const obsidianAdapter = findAdapter(params.snapshot.adapters, 'obsidian');
  const openjarvisAdapter = findAdapter(params.snapshot.adapters, 'openjarvis');
  const ollamaAdapter = findAdapter(params.snapshot.adapters, 'ollama');
  const renderAdapter = findAdapter(params.snapshot.adapters, 'render');
  const workstationAdapter = findAdapter(params.snapshot.adapters, 'workstation');
  const sharedNamespaces = params.snapshot.enabledUpstreams.map((entry) => entry.namespace);
  const primarySurfaces = new Set(params.routePreview.primaryPath.surfaces);
  const fallbackSurfaces = new Set(params.routePreview.fallbackPath.surfaces);

  return [
    {
      assetId: 'supabase-hot-state',
      defaultMode: 'primary',
      currentState: 'assumed',
      ownership: 'Canonical mutable workflow ledger for sessions, route decisions, recall boundaries, artifact refs, and queue progress.',
      useFor: [
        'shared mutable workflow state',
        'route_selected, decision_distillate, artifact_ref, and recall_request events',
        'resume and retry boundaries across unattended turns',
      ],
      avoidFor: [
        'durable semantic ownership',
        'operator-facing architecture explanation as the final source of meaning',
      ],
      currentBottleneck: null,
      nextMove: 'Keep every deterministic and fallback turn writing compact route and closeout signals here before any durable promotion.',
    },
    {
      assetId: 'obsidian-semantic-owner',
      defaultMode: params.requiresDurableKnowledge ? 'primary' : 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(obsidianAdapter?.available),
        partial: !obsidianAdapter?.available,
      }),
      ownership: 'Durable semantic owner for decisions, playbooks, development slices, retros, and operator-visible continuity meaning.',
      useFor: [
        'decision notes and requirement notes',
        'operator runbooks and architecture-significant deltas',
        'shared knowledge promotion after runtime execution settles',
      ],
      avoidFor: [
        'hot mutable execution heartbeat',
        'tight retry loops and scheduler ownership',
      ],
      currentBottleneck: obsidianAdapter?.available
        ? null
        : 'Obsidian retrieval or write health is not fully confirmed, so durable promotion remains at risk until the adapter path is healthy.',
      nextMove: 'Promote only durable meaning here, and keep packets or summaries as projections rather than the sole runtime owner.',
    },
    {
      assetId: 'github-artifact-plane',
      defaultMode: 'supporting',
      currentState: 'assumed',
      ownership: 'Repo-visible artifact, review, and settlement plane for code changes, documentation deltas, CI evidence, and merge history.',
      useFor: [
        'PRs, branches, and review threads for repo-visible outputs',
        'CI or release evidence tied to code or documentation artifacts',
        'settling code and docs changes after the workflow ledger closes the route',
      ],
      avoidFor: [
        'shared mutable workflow queue state',
        'durable semantic ownership of operator meaning',
      ],
      currentBottleneck: params.sharedBenefitPhase === 'constraint-only'
        ? 'Keep GitHub settlement downstream of the hot-state closeout until the route contract is stable enough to externalize cleanly.'
        : null,
      nextMove: 'Settle repo-visible artifacts here after Supabase records the route outcome, and keep GitHub out of the role of workflow state machine or semantic owner.',
    },
    {
      assetId: 'n8n-router',
      defaultMode: params.routePreview.primaryPath.pathType === 'api-path' ? 'primary' : 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(n8nAdapter?.available) && params.snapshot.configuredN8nTaskCount > 0,
        partial: Boolean(n8nAdapter?.available) || params.snapshot.configuredN8nTaskCount > 0,
      }),
      ownership: 'Deterministic ingress, waits, retries, webhook schedules, and explicit IF or Switch routing before fallback.',
      useFor: [
        'webhook and schedule entrypoints',
        'deterministic API lookups and branch routing',
        'wait and retry boundaries outside GPT or Hermes turns',
      ],
      avoidFor: [
        'high-ambiguity reasoning',
        'policy acceptance decisions',
      ],
      currentBottleneck: params.routePreview.primaryPath.pathType === 'api-path'
        ? (Boolean(n8nAdapter?.available) && params.snapshot.configuredN8nTaskCount > 0
          ? null
          : 'Configured n8n tasks or adapter availability do not yet cover the deterministic path strongly enough.')
        : 'The current objective is still fallback-led, so n8n is not yet the first owner for this route.',
      nextMove: 'Push clear ingress, wait, and branch ownership into n8n before widening the route into MCP or Hermes-local work.',
    },
    {
      assetId: 'gcpcompute-shared-mcp',
      defaultMode: primarySurfaces.has('gcpcompute-shared-mcp') ? 'primary' : 'supporting',
      currentState: resolveOperationalState({
        ready: sharedNamespaces.length > 0,
      }),
      ownership: 'Shared wrapper layer for team-shared knowledge, remote-capable tool use, and promotable capability contracts.',
      useFor: [
        'shared knowledge retrieval',
        'teammate-consumable wrapped tools',
        'remote-capable execution that should outlive one local machine',
      ],
      avoidFor: [
        'local-only dirty workspace mutation',
        'machine-local IDE control and packet steering',
      ],
      currentBottleneck: sharedNamespaces.length === 0
        ? 'No enabled shared upstream namespace is active, so teammate-grade wrapper delegation is not actually available yet.'
        : (params.sharedBenefitPhase === 'constraint-only'
          ? 'Shared promotion is still treated as a compatibility constraint, not as the live primary lane for every stable wrapper.'
          : null),
      nextMove: 'Promote stable local wrappers here once the route contract is proven, so teammate reuse does not depend on one local Hermes instance.',
    },
    {
      assetId: 'hermes-local-operator',
      defaultMode: params.runtimeLane === 'operator-personal' || primarySurfaces.has('hermes-local-operator')
        ? 'primary'
        : 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(openjarvisAdapter?.available) || Boolean(ollamaAdapter?.available),
        partial: Boolean(openjarvisAdapter?.available) || Boolean(ollamaAdapter?.available),
      }),
      ownership: 'Machine-local hands layer for IDE mutation, shell diagnostics, bounded file edits, packet steering, and bounded VS Code chat relaunch.',
      useFor: [
        'local IDE control and file mutation',
        'bounded diagnostics after router miss',
        'continuity packet steering and explicit chat handoff',
      ],
      avoidFor: [
        'public-lane final acceptance',
        'remote shared ownership of stable capability contracts',
      ],
      currentBottleneck: params.runtimeLane === 'public-guild'
        ? 'Public guild routes can use Hermes for bounded fallback, but public acceptance still cannot terminate on unsanitized machine-local behavior.'
        : null,
      nextMove: 'Reserve Hermes for local mutation and bounded handoff work, and offload reusable or always-on behavior into shared wrappers or deterministic routers.',
    },
    {
      assetId: 'local-workstation-executor',
      defaultMode: primarySurfaces.has('local-workstation-executor') || fallbackSurfaces.has('local-workstation-executor')
        ? 'supporting'
        : 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(workstationAdapter?.available),
      }),
      ownership: 'Bounded local actuator for explicit command execution, browser and desktop control, text or hotkey input, screenshot capture, and workspace-scoped file operations on the operator machine.',
      useFor: [
        'explicit local command execution when the step must stay on the operator machine and leave an observable trace',
        'browser open, window activation, and desktop app launch on the operator workstation',
        'text entry or hotkey dispatch into the active desktop window for bounded GUI flows',
        'local screenshot capture for visual debugging or evidence collection',
        'workspace-scoped file reads and writes when the route must touch local artifacts',
      ],
      avoidFor: [
        'shared remote execution',
        'out-of-workspace mutation',
        'public-lane acceptance without sanitization',
      ],
      currentBottleneck: workstationAdapter?.available
        ? null
        : 'No first-class local command or GUI actuator is available, so computer-use still falls back to ad hoc shell or external GUI paths.',
      nextMove: 'Route bounded local command, browser, input, screenshot, and workspace file steps through ext.workstation.* so they leave observable traces instead of hidden manual glue.',
    },
    {
      assetId: 'openjarvis-local',
      defaultMode: 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(openjarvisAdapter?.available),
        partial: Boolean(ollamaAdapter?.available),
      }),
      ownership: 'Bounded local reasoning, telemetry, evaluation, and memory-projection surface underneath Hermes.',
      useFor: [
        'bounded local reasoning after deterministic misses',
        'local telemetry and evaluation loops',
        'cheaper executor support before GPT recall',
      ],
      avoidFor: [
        'durable semantic ownership',
        'team-shared ingress that should survive one machine',
      ],
      currentBottleneck: openjarvisAdapter?.available
        ? null
        : 'The richer local OpenJarvis surface is not fully available, so Hermes may fall back to Ollama-only reasoning or shared MCP first.',
      nextMove: 'Keep OpenJarvis as Hermes-local support, not as the semantic owner or the only shared automation plane.',
    },
    {
      assetId: 'remote-heavy-execution',
      defaultMode: fallbackSurfaces.has('remote-heavy-execution') ? 'supporting' : 'supporting',
      currentState: resolveOperationalState({
        ready: Boolean(renderAdapter?.available) || sharedNamespaces.length > 0,
        partial: Boolean(renderAdapter?.available) || sharedNamespaces.length > 0,
      }),
      ownership: 'Always-on and remote-heavy execution lane for shared workers, hosted automation, and workloads that should not stay on one local machine.',
      useFor: [
        'always-on automation',
        'remote-capable jobs and shared worker lanes',
        'execution that should continue beyond a local IDE session',
      ],
      avoidFor: [
        'local-only file edits',
        'human-visible machine-local iteration loops',
      ],
      currentBottleneck: (Boolean(renderAdapter?.available) || sharedNamespaces.length > 0)
        ? null
        : 'No remote execution lane is currently healthy enough to own always-on work beyond the local machine.',
      nextMove: 'Move proven always-on workloads here after wrapper contracts and observability are strong enough to survive without local babysitting.',
    },
    {
      assetId: 'skills-and-activation-pack',
      defaultMode: 'supporting',
      currentState: 'ready',
      ownership: 'Bootstrap and task-shaping layer that tells Hermes or GPT which surfaces, commands, and skills to activate first.',
      useFor: [
        'compact bootstrap and route shaping',
        'recommended skills, tool calls, and fallback order',
        'keeping unattended starts from widening into broad document archaeology',
      ],
      avoidFor: [
        'acting as the hot-state owner',
        'standing in for real wrapper capability contracts',
      ],
      currentBottleneck: 'Activation packs help Hermes start correctly, but they do not replace explicit ownership boundaries across Supabase, Obsidian, shared MCP, and local mutation.',
      nextMove: 'Keep activation packs short, route-specific, and bound to the live status surfaces instead of letting them become another planning backlog.',
    },
    {
      assetId: 'gpt-recall',
      defaultMode: 'escalation-only',
      currentState: 'assumed',
      ownership: 'Acceptance boundary for policy, architecture, destructive change, or unresolved ambiguity.',
      useFor: [
        'policy-sensitive decisions',
        'destructive or high-risk changes',
        'unresolved ambiguity after deterministic and bounded fallback paths are exhausted',
      ],
      avoidFor: [
        'default deterministic happy path execution',
        'routine waits, retries, and stable wrapper calls',
      ],
      currentBottleneck: params.routePreview.escalation.required
        ? 'The current route already crosses an explicit recall boundary, so unattended continuation should stop here.'
        : null,
      nextMove: 'Recall GPT only at the explicit acceptance boundary, and keep every cheaper route below that line deterministic or bounded.',
    },
  ];
};

const buildLaneGuardrails = (params: {
  runtimeLane: AutomationRuntimeLane;
  routePreview: AutomationRoutePreview;
  sharedBenefitPhase: AutomationSharedBenefitPhase;
}): string[] => dedupeStringList([
  'Keep authentication, authorization, and versioning in the provider-native API or CLI layer instead of pushing them into agent prompts or workflow notes.',
  'Use an explicit router boundary between deterministic API handling and MCP or Hermes fallback.',
  'Persist compact decision distillates and artifact refs into Supabase hot-state and promote only durable meaning into Obsidian.',
  'Use GitHub as the repo-visible artifact and review plane for code, docs, and CI evidence instead of treating it as the workflow state machine or semantic owner.',
  params.runtimeLane === 'public-guild'
    ? 'Sanitize the final Discord deliverable, including wrapped deliverable text, before any public reply is emitted.'
    : null,
  params.runtimeLane === 'public-guild'
    ? 'Do not let public-guild traffic mutate local-only files or machines without an explicit recall or approval boundary.'
    : null,
  params.routePreview.escalation.required
    ? 'When the route hits policy or unresolved ambiguity, stop at GPT recall instead of inventing a hidden autonomous acceptance step.'
    : null,
  params.sharedBenefitPhase !== 'required-now'
    ? 'Keep teammate scale-out as a compatibility constraint: local wrappers should be liftable into shared MCP later without changing hot-state or semantic owners.'
    : 'Design the wrapper boundary so teammates can consume the same shared ingress immediately, not by copying a local-agent-only workflow.',
]);

const buildCostPerformancePolicy = (params: {
  runtimeLane: AutomationRuntimeLane;
  routePreview: AutomationRoutePreview;
  sharedBenefitPhase: AutomationSharedBenefitPhase;
}): AutomationOptimizerPlan['costPerformancePolicy'] => ({
  defaultPath: params.routePreview.modelPolicy.apiPath,
  reasoningTier: params.routePreview.recommendedMode === 'api-first'
    ? 'Use zero-LLM deterministic handling on the happy path and keep reasoning spend behind explicit misses or recall boundaries.'
    : params.routePreview.recommendedMode === 'api-first-with-agent-fallback'
      ? 'Use deterministic routing first, then bounded wrapped fallback, and only then escalate to GPT when the acceptance boundary demands it.'
      : params.routePreview.recommendedMode === 'agent-fallback'
        ? 'Start from wrapped or local fallback surfaces, but keep GPT recall as the expensive acceptance boundary.'
        : 'This route is recall-led, so GPT is the primary reasoning boundary and deterministic tooling should only gather evidence for it.',
  escalationBoundary: params.routePreview.modelPolicy.escalation,
  costControls: dedupeStringList([
    params.routePreview.modelPolicy.apiPath,
    params.routePreview.modelPolicy.fallbackPath,
    'Keep waits, retries, and schedules in n8n instead of holding interactive reasoning surfaces open.',
    params.sharedBenefitPhase === 'constraint-only'
      ? 'Delay teammate-lane hardening until the local route contract is stable enough to externalize cleanly.'
      : 'Promote stable wrappers to shared MCP once the contract is stable enough for teammate reuse.',
    params.runtimeLane === 'public-guild'
      ? 'Treat public Discord replies as a bounded finalization step; do not let public traffic trigger uncontrolled fallback loops.'
      : null,
  ]),
  latencyControls: dedupeStringList([
    params.routePreview.primaryPath.pathType === 'api-path'
      ? 'Prefer schedule or webhook ingress plus deterministic APIs for low-latency first response.'
      : 'Use compact fallback entrypoints and avoid reopening large planning surfaces during route execution.',
    'Emit route selection and fallback transitions into Supabase so retries can resume without recomputing context.',
    params.routePreview.fallbackPath.surfaces.includes('gcpcompute-shared-mcp')
      ? 'Use shared MCP for remote-capable tools instead of recreating long-lived local shells.'
      : null,
    params.routePreview.fallbackPath.surfaces.includes('hermes-local-operator')
      ? 'Use Hermes only for machine-local edits, diagnostics, or bounded reasoning that cannot remain on the deterministic path.'
      : null,
    params.routePreview.fallbackPath.surfaces.includes('local-workstation-executor')
      ? 'Record workstation command, browser, input, screenshot, and file-action outcomes so local computer-use steps do not disappear from the route trace.'
      : null,
  ]),
});

const buildObservabilityPlan = (params: {
  runtimeLane: AutomationRuntimeLane;
  routePreview: AutomationRoutePreview;
  requiresDurableKnowledge: boolean;
}): AutomationOptimizerPlan['observabilityPlan'] => {
  const coverage = buildObservabilityCoverage();

  return {
    primaryTimeline: dedupeStringList([
      'n8n trigger and execution log',
      'workflow_event.route_intent and workflow_event.route_selected',
      params.routePreview.primaryPath.pathType === 'api-path'
        ? 'deterministic API result and completeness gate'
        : 'fallback entry and wrapped tool outcome',
      params.routePreview.fallbackPath.surfaces.includes('gcpcompute-shared-mcp')
        ? 'shared MCP tool latency and outcome'
        : null,
      params.routePreview.fallbackPath.surfaces.includes('hermes-local-operator')
        ? 'OpenJarvis telemetry and Hermes runtime action trail'
        : null,
      params.runtimeLane === 'public-guild'
        ? 'Discord deliverable sanitization and outbound response summary'
        : null,
      params.requiresDurableKnowledge ? 'Obsidian decision distillate or promotion target' : null,
    ]),
    signals: dedupeStringList([
      'workflow_event.route_intent',
      'workflow_event.route_selected',
      params.routePreview.primaryPath.pathType === 'api-path' ? 'api_match_completeness' : 'fallback_invoked',
      params.routePreview.escalation.required ? 'recall_request' : 'decision_distillate',
      params.runtimeLane === 'public-guild' ? 'deliverable_sanitized' : null,
      'artifact_ref',
    ]),
    currentGaps: dedupeStringList([
      ...coverage.currentGaps,
      params.runtimeLane === 'public-guild'
        ? 'Public Discord response quality and sanitization still need a single correlated trace across workflow ledger and outbound reply surfaces.'
        : null,
    ]).slice(0, 4),
  };
};

const buildSharedEnablementPlan = (params: {
  sharedBenefitPhase: AutomationSharedBenefitPhase;
  enabledUpstreamNamespaces: string[];
}): AutomationOptimizerPlan['sharedEnablementPlan'] => {
  if (params.sharedBenefitPhase === 'required-now') {
    return {
      currentMilestone: dedupeStringList([
        'Promote stable wrapped capabilities into shared MCP now so teammates can consume the same ingress without a local Hermes dependency.',
        params.enabledUpstreamNamespaces.length > 0
          ? `Attach the first shared export to the existing upstream namespaces: ${params.enabledUpstreamNamespaces.join(', ')}.`
          : 'Provision a shared MCP namespace for the first stable wrapper export.',
      ]),
      futureMilestones: [
        'Move always-on public or scheduled routes to the remote-heavy execution lane once the shared wrapper contract is stable.',
        'Correlate shared MCP traces with n8n execution history and Supabase route events.',
      ],
      blockedBy: [
        'Need stable auth and versioning boundaries for each provider wrapper before widening teammate access.',
        'Need end-to-end observability across n8n, shared MCP, and Supabase before broadening operational ownership.',
      ],
    };
  }

  if (params.sharedBenefitPhase === 'phase-1') {
    return {
      currentMilestone: dedupeStringList([
        'Ship the optimizer and workflow contract with shared-wrapper compatibility turned on for the first stable capabilities.',
        'Keep local and shared ingress aligned so phase-1 users do not need a separate local-agent-only contract.',
      ]),
      futureMilestones: [
        'Expand the shared surface once workflow and wrapper telemetry confirm stable route ownership.',
        'Move always-on or public-facing workloads toward remote-heavy execution when the operational contract is proven.',
      ],
      blockedBy: [
        'Need stable wrapper contracts before widening shared-team onboarding.',
        'Need a correlated trace across workflow router, shared MCP, and hot-state writes.',
      ],
    };
  }

  return {
    currentMilestone: dedupeStringList([
      'Keep the first milestone local-first: optimizer planning, router contracts, and workflow drafts can ship before teammate bootstrap becomes mandatory.',
      'Model future teammate scale-out as wrapper compatibility: stable capabilities should be promotable to shared MCP without changing their semantic owners.',
    ]),
    futureMilestones: [
      'Promote stable wrappers to shared MCP on gcpCompute so SSH-capable teammates can consume the same tools without local Hermes.',
      'Move always-on public or scheduled workloads to the remote-heavy execution lane once workflow contracts and observability are stable.',
    ],
    blockedBy: [
      'Need end-to-end observability across n8n, shared MCP, and Supabase before externalizing the lane broadly.',
      'Need stable auth and versioning boundaries for provider wrappers before teammate-facing promotion.',
    ],
  };
};

export const buildAutomationWorkflowDraft = async (
  input: AutomationWorkflowDraftInput,
): Promise<AutomationWorkflowDraft> => {
  const routePreview = await previewApiFirstAgentFallbackRoute(input);
  return buildWorkflowDraftInternal({
    input,
    routePreview,
    dynamicWorkflowRequested: true,
  });
};

export const buildAutomationOptimizerPlan = async (
  input: AutomationOptimizerPlanInput,
): Promise<AutomationOptimizerPlan> => {
  const routePreview = await previewApiFirstAgentFallbackRoute(input);
  const runtimeLane = resolveRuntimeLane(input.runtimeLane);
  const sharedBenefitPhase = resolveSharedBenefitPhase(input.sharedBenefitPhase);
  const snapshot = await buildRuntimeSnapshot(false);
  const workflowDraft = buildWorkflowDraftInternal({
    input,
    routePreview,
    dynamicWorkflowRequested: input.dynamicWorkflowRequested === true,
  });

  return {
    objective: routePreview.objective,
    runtimeLane,
    sharedBenefitPhase,
    dynamicWorkflowRequested: input.dynamicWorkflowRequested === true,
    routePreview,
    operatingContract: {
      ingressModel: 'deterministic API first -> explicit router decision -> MCP or Hermes fallback -> GPT recall only at the acceptance boundary',
      stateOwners: {
        hotState: 'Supabase workflow sessions and workflow events remain the canonical hot-state ledger.',
        semanticOwner: 'Obsidian remains the durable semantic owner for decisions, runbooks, and architecture-significant deltas.',
        artifactPlane: 'GitHub remains the repo-visible artifact, review, and settlement plane for code changes, docs deltas, CI evidence, and merge history.',
        workflowRouter: snapshot.configuredN8nTaskCount > 0
          ? 'n8n owns trigger, wait, retry, and router-node execution for deterministic automation.'
          : 'Hermes remains the temporary router entrypoint until n8n routes are activated for this slice.',
        teammateScaleOut: sharedBenefitPhase === 'constraint-only'
          ? 'Keep shared-team scale-out as a compatibility constraint first, then promote stable wrappers into shared MCP once the contract settles.'
          : 'Stable wrappers should be consumable through shared MCP so teammates can use the same ingress without copying a local-agent-only runtime.',
      },
      serviceGuardrails: buildLaneGuardrails({
        runtimeLane,
        routePreview,
        sharedBenefitPhase,
      }),
    },
    costPerformancePolicy: buildCostPerformancePolicy({
      runtimeLane,
      routePreview,
      sharedBenefitPhase,
    }),
    observabilityPlan: buildObservabilityPlan({
      runtimeLane,
      routePreview,
      requiresDurableKnowledge: input.requiresDurableKnowledge !== false,
    }),
    workflowDraft,
    assetDelegationMatrix: buildAssetDelegationMatrix({
      runtimeLane,
      routePreview,
      sharedBenefitPhase,
      snapshot,
      requiresDurableKnowledge: input.requiresDurableKnowledge !== false,
    }),
    sharedEnablementPlan: buildSharedEnablementPlan({
      sharedBenefitPhase,
      enabledUpstreamNamespaces: snapshot.enabledUpstreams.map((entry) => entry.namespace),
    }),
  };
};