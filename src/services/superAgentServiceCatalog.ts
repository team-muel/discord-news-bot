export const SUPER_AGENT_SERVICE_BUNDLE_IDS = [
  'personal-workflow-copilot',
  'personal-backlog-router',
  'knowledge-distiller',
  'local-hands-runner',
  'weekly-quality-or-cost-reporter',
] as const;

export type SuperAgentServiceBundleId = (typeof SUPER_AGENT_SERVICE_BUNDLE_IDS)[number];
export type SuperAgentServiceBundlePriority = 'high' | 'medium';
export type SuperAgentServiceMode = 'local-collab' | 'delivery' | 'operations';
export type SuperAgentServiceLeadAgent = 'Implement' | 'Architect' | 'Review' | 'Operate';

export type SuperAgentServiceEntrypoints = {
  catalog: string;
  describe: string;
  recommend: string;
  session: string;
};

export type SuperAgentServiceBundle = {
  id: SuperAgentServiceBundleId;
  title: string;
  summary: string;
  desiredOutcome: string;
  priority: SuperAgentServiceBundlePriority;
  defaultMode: SuperAgentServiceMode;
  defaultLeadAgent: SuperAgentServiceLeadAgent;
  defaultPriority: 'fast' | 'balanced' | 'precise';
  suggestedSkillId: string | null;
  defaultObjective: string;
  defaultConstraints: string[];
  defaultAcceptanceCriteria: string[];
  runtimeSurfaces: string[];
  existingActions: string[];
  commandSurface: string[];
  operatorDocPath: string;
  entrypoints: SuperAgentServiceEntrypoints;
};

const SUPER_AGENT_SERVICE_CATALOG_PATH = '/agent/super/services';
const PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH = 'docs/PERSONAL_OPERATING_SYSTEM_SERVICES.md';

const buildSuperAgentServiceEntrypoints = (serviceId: SuperAgentServiceBundleId): SuperAgentServiceEntrypoints => ({
  catalog: SUPER_AGENT_SERVICE_CATALOG_PATH,
  describe: `${SUPER_AGENT_SERVICE_CATALOG_PATH}/${serviceId}`,
  recommend: `${SUPER_AGENT_SERVICE_CATALOG_PATH}/${serviceId}/recommend`,
  session: `${SUPER_AGENT_SERVICE_CATALOG_PATH}/${serviceId}/sessions`,
});

const SUPER_AGENT_SERVICE_BUNDLES: SuperAgentServiceBundle[] = [
  {
    id: 'personal-workflow-copilot',
    title: 'Personal Workflow Copilot',
    summary: 'Turns personal operating context into one bounded next step with the right owner lane and follow-up artifact list.',
    desiredOutcome: 'A bounded next step, explicit owner lane, and operator-visible follow-up artifacts.',
    priority: 'high',
    defaultMode: 'local-collab',
    defaultLeadAgent: 'Architect',
    defaultPriority: 'balanced',
    suggestedSkillId: null,
    defaultObjective: 'Turn the current personal workflow state into the next bounded plan, owner, and follow-up artifacts.',
    defaultConstraints: [
      'Prefer existing runtime surfaces and named services over ad hoc prompt-only routing.',
      'Return one bounded next step, blockers, and the minimal artifact list needed for follow-through.',
    ],
    defaultAcceptanceCriteria: [
      'The next owner lane is explicit.',
      'The next step is bounded enough to execute without reopening broad discovery.',
    ],
    runtimeSurfaces: [
      'GET /api/bot/agent/runtime/operator-snapshot',
      'GET /api/bot/agent/runtime/workset',
      'POST /api/bot/agent/super/sessions',
    ],
    existingActions: ['coordinate.route', 'architect.plan', 'operate.ops'],
    commandSurface: ['npm run local:control-plane:future', 'npm run openjarvis:goal:status'],
    operatorDocPath: PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH,
    entrypoints: buildSuperAgentServiceEntrypoints('personal-workflow-copilot'),
  },
  {
    id: 'personal-backlog-router',
    title: 'Personal Backlog Router',
    summary: 'Classifies backlog items into bounded next actions, hold queues, and escalation lanes using the existing supervisor and routing surfaces.',
    desiredOutcome: 'Backlog items are routed into now, next, later, or human-review lanes with an explicit owner.',
    priority: 'high',
    defaultMode: 'delivery',
    defaultLeadAgent: 'Architect',
    defaultPriority: 'balanced',
    suggestedSkillId: null,
    defaultObjective: 'Route the current personal backlog into bounded next actions, hold queues, and escalation lanes.',
    defaultConstraints: [
      'Prefer routing and sequencing over immediate implementation when ownership is still ambiguous.',
      'Fail closed to a review lane when the backlog item is under-specified or risky.',
    ],
    defaultAcceptanceCriteria: [
      'Each backlog item is assigned a clear next lane.',
      'Urgent or blocked work is separated from normal throughput work.',
    ],
    runtimeSurfaces: [
      'GET /api/bot/agent/task-routing/summary',
      'GET /api/bot/agent/runtime/operator-snapshot',
      'POST /api/bot/agent/super/recommend',
    ],
    existingActions: ['coordinate.route', 'architect.plan'],
    commandSurface: ['npm run local:autonomy:supervisor:status', 'npm run openjarvis:goal:status'],
    operatorDocPath: PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH,
    entrypoints: buildSuperAgentServiceEntrypoints('personal-backlog-router'),
  },
  {
    id: 'knowledge-distiller',
    title: 'Knowledge Distiller',
    summary: 'Converts source material into reusable operator knowledge with provenance, promotion targets, and bounded follow-up artifacts.',
    desiredOutcome: 'Reusable knowledge artifacts with preserved provenance and the right promotion target.',
    priority: 'high',
    defaultMode: 'delivery',
    defaultLeadAgent: 'Review',
    defaultPriority: 'balanced',
    suggestedSkillId: null,
    defaultObjective: 'Distill source material into reusable operator knowledge, promotion-ready notes, and linked follow-up artifacts.',
    defaultConstraints: [
      'Preserve source provenance and operator-facing meaning.',
      'Prefer durable semantic artifacts over one-off summaries.',
    ],
    defaultAcceptanceCriteria: [
      'The distilled output cites the source bundle or runtime surface.',
      'The promotion target and next artifact are explicit.',
    ],
    runtimeSurfaces: [
      'GET /api/bot/agent/obsidian/knowledge-control',
      'POST /api/bot/agent/obsidian/knowledge-promote',
      'GET /api/bot/agent/obsidian/internal-knowledge',
    ],
    existingActions: ['review.review', 'operate.ops'],
    commandSurface: ['npm run wiki:commit', 'npm run obsidian:backfill:system:report'],
    operatorDocPath: PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH,
    entrypoints: buildSuperAgentServiceEntrypoints('knowledge-distiller'),
  },
  {
    id: 'local-hands-runner',
    title: 'Local Hands Runner',
    summary: 'Runs one bounded local implementation or operator task through the existing execution, tool, and Hermes runtime surfaces.',
    desiredOutcome: 'A bounded local task is executed with explicit artifacts, verification, and rollback notes.',
    priority: 'high',
    defaultMode: 'operations',
    defaultLeadAgent: 'Implement',
    defaultPriority: 'precise',
    suggestedSkillId: null,
    defaultObjective: 'Execute one bounded local implementation or operator task with explicit artifacts, verification, and rollback notes.',
    defaultConstraints: [
      'Stay inside the bounded file and tool scope for the requested task.',
      'Verify the result before declaring the task complete.',
    ],
    defaultAcceptanceCriteria: [
      'The change or action is bounded and verified.',
      'Any rollback or recovery step is explicit when the task mutates state.',
    ],
    runtimeSurfaces: [
      'GET /api/bot/agent/actions/catalog',
      'POST /api/bot/agent/actions/execute',
      'POST /api/bot/agent/runtime/openjarvis/hermes-runtime/chat-launch',
    ],
    existingActions: ['implement.execute', 'tools.run.cli', 'operate.ops'],
    commandSurface: ['npm run openjarvis:hermes:runtime:chat-launch:executor', 'npm run openjarvis:hermes:runtime:swarm-launch:dry'],
    operatorDocPath: PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH,
    entrypoints: buildSuperAgentServiceEntrypoints('local-hands-runner'),
  },
  {
    id: 'weekly-quality-or-cost-reporter',
    title: 'Weekly Quality Or Cost Reporter',
    summary: 'Packages the existing weekly report and cost commands into one service that emits the current quality or cost picture.',
    desiredOutcome: 'A current weekly quality or cost picture using existing report scripts and runtime evidence only.',
    priority: 'medium',
    defaultMode: 'operations',
    defaultLeadAgent: 'Operate',
    defaultPriority: 'precise',
    suggestedSkillId: null,
    defaultObjective: 'Produce the weekly quality or cost report from the existing report commands and runtime evidence.',
    defaultConstraints: [
      'Use existing report scripts and current runtime evidence instead of inventing new metrics.',
      'Flag missing evidence rather than synthesizing unsupported conclusions.',
    ],
    defaultAcceptanceCriteria: [
      'The output names the commands or runtime surfaces used.',
      'Any evidence gap is explicit so the next weekly pass stays reproducible.',
    ],
    runtimeSurfaces: [
      'GET /api/bot/agent/runtime/operator-snapshot',
      'GET /api/bot/agent/runtime/unattended-health',
      'GET /api/bot/agent/runtime/loops',
    ],
    existingActions: ['operate.ops', 'tools.run.cli'],
    commandSurface: ['npm run gates:weekly-report:all:dry', 'npm run ops:gcp:report:weekly', 'npm run capability:audit:markdown'],
    operatorDocPath: PERSONAL_OPERATING_SYSTEM_OPERATOR_DOC_PATH,
    entrypoints: buildSuperAgentServiceEntrypoints('weekly-quality-or-cost-reporter'),
  },
];

const SUPER_AGENT_SERVICE_BUNDLE_MAP = new Map<SuperAgentServiceBundleId, SuperAgentServiceBundle>(
  SUPER_AGENT_SERVICE_BUNDLES.map((bundle) => [bundle.id, bundle]),
);

const cloneSuperAgentServiceBundle = (bundle: SuperAgentServiceBundle): SuperAgentServiceBundle => ({
  ...bundle,
  defaultConstraints: [...bundle.defaultConstraints],
  defaultAcceptanceCriteria: [...bundle.defaultAcceptanceCriteria],
  runtimeSurfaces: [...bundle.runtimeSurfaces],
  existingActions: [...bundle.existingActions],
  commandSurface: [...bundle.commandSurface],
  entrypoints: { ...bundle.entrypoints },
});

const normalizeServiceId = (value: unknown): SuperAgentServiceBundleId | null => {
  const normalized = String(value || '').trim() as SuperAgentServiceBundleId;
  return SUPER_AGENT_SERVICE_BUNDLE_MAP.has(normalized) ? normalized : null;
};

export const resolveSuperAgentServiceBundle = (serviceId: unknown): SuperAgentServiceBundle | null => {
  const normalized = normalizeServiceId(serviceId);
  if (!normalized) {
    return null;
  }
  const bundle = SUPER_AGENT_SERVICE_BUNDLE_MAP.get(normalized);
  return bundle ? cloneSuperAgentServiceBundle(bundle) : null;
};

export const listSuperAgentServiceBundles = (): SuperAgentServiceBundle[] => {
  return SUPER_AGENT_SERVICE_BUNDLES.map((bundle) => cloneSuperAgentServiceBundle(bundle));
};

export const getSuperAgentServiceBundle = (serviceId: unknown): SuperAgentServiceBundle | null => {
  return resolveSuperAgentServiceBundle(serviceId);
};