const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeStringList = (value) => Array.isArray(value)
  ? value.map((entry) => compact(entry)).filter(Boolean)
  : [];

const uniqueStrings = (values) => {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
};

const includesAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

const addSkill = (skills, skillId, reason) => {
  if (!compact(skillId) || !compact(reason) || skills.some((entry) => entry.skillId === skillId)) {
    return;
  }
  skills.push({ skillId, reason });
};

const SHARED_MCP_KEYWORDS = [
  'shared mcp',
  'gcpcompute',
  'bootstrap',
  'teammate',
  'team bootstrap',
  'skills hub',
  'skill hub',
  'tool-layer',
  'tool layer',
  'single ingress',
  'autopilot',
  'shared knowledge',
];

const VALIDATION_KEYWORDS = [
  'test',
  'tests',
  'smoke',
  'verify',
  'validation',
  'validate',
  'qa',
  'regression',
];

const IMPLEMENT_KEYWORDS = [
  'implement',
  'build',
  'fix',
  'patch',
  'refactor',
  'wire',
  'add ',
  'remove ',
  'update ',
];

const REVIEW_KEYWORDS = [
  'policy',
  'secret',
  'approval',
  'approve',
  'production',
  'release',
  'security',
];

const DURABLE_KNOWLEDGE_KEYWORDS = [
  'obsidian',
  'runbook',
  'decision',
  'retro',
  'wiki',
  'shared knowledge',
  'operator docs',
  'operator-visible',
];

const resolveObjectiveClass = ({ objectiveLower, matchedExampleIds }) => {
  if (includesAny(objectiveLower, SHARED_MCP_KEYWORDS)) {
    return 'shared-mcp-bootstrap';
  }

  if (
    matchedExampleIds.includes('youtube-community-post-handoff')
    || includesAny(objectiveLower, ['youtube', 'community post', 'community'])
  ) {
    return 'youtube-community';
  }

  if (includesAny(objectiveLower, VALIDATION_KEYWORDS)) {
    return 'validation';
  }

  return 'general';
};

const buildSummary = ({ objectiveClass, targetObjective }) => {
  if (objectiveClass === 'shared-mcp-bootstrap') {
    return `Start from compact routing surfaces, then validate the shared MCP bootstrap lane before widening into heavier docs or executor paths for: ${targetObjective}.`;
  }

  if (objectiveClass === 'youtube-community') {
    return `Keep the YouTube community flow deterministic first, then fall back to MCP or Hermes only if the scrape or interpretation path misses for: ${targetObjective}.`;
  }

  if (objectiveClass === 'validation') {
    return `Use the compact bundle to isolate the active lane first, then run focused validation before widening the scope for: ${targetObjective}.`;
  }

  return `Bootstrap from compact hot-state first, then confirm route ownership before widening into MCP or Hermes fallback for: ${targetObjective}.`;
};

const buildReadNext = ({ objectiveClass, requiresDurableKnowledge }) => {
  const docs = [];

  if (objectiveClass === 'shared-mcp-bootstrap') {
    docs.push('docs/planning/GPT_HERMES_SINGLE_INGRESS_OPERATING_PLAN.md');
    docs.push('docs/adr/ADR-008-multi-plane-operating-model.md');
    docs.push('docs/planning/MULTICA_CONTROL_PLANE_PLAYBOOK.md');
    docs.push('docs/SKILLSET_LAYER.md');
  }

  if (requiresDurableKnowledge) {
    docs.push('docs/CHANGELOG-ARCH.md');
  }

  return uniqueStrings(docs).slice(0, 4);
};

const buildCommands = ({ objectiveClass }) => {
  if (objectiveClass === 'shared-mcp-bootstrap') {
    return ['powershell -File scripts/bootstrap-team.ps1 -SharedOnly'];
  }

  return [];
};

const buildToolCalls = ({ sourceSurface, objectiveClass }) => {
  const tools = [];

  if (sourceSurface !== 'session-open') {
    tools.push('automation.session_start_prep');
  }

  if (sourceSurface !== 'route-preview') {
    tools.push('automation.route.preview');
  }

  if (objectiveClass === 'shared-mcp-bootstrap') {
    tools.push('automation.capability.catalog');
    tools.push('automation.optimizer.plan');
  }

  if (objectiveClass === 'youtube-community') {
    tools.push('automation.workflow.draft');
  }

  return uniqueStrings(tools).slice(0, 4);
};

const buildRecommendedSkills = ({ objectiveLower, objectiveClass, requiresDurableKnowledge }) => {
  const skills = [];

  if (objectiveClass === 'shared-mcp-bootstrap') {
    addSkill(skills, 'plan', 'Tool-layer and shared MCP rearrangement should be scoped before edits or workflow fan-out.');
  }

  if (includesAny(objectiveLower, VALIDATION_KEYWORDS)) {
    addSkill(skills, 'qa-local', 'This objective is validation-heavy, so focused local verification should run before widening the blast radius.');
  }

  if (includesAny(objectiveLower, IMPLEMENT_KEYWORDS)) {
    addSkill(skills, 'implement', 'The objective points to concrete code or workflow changes, so the build phase can stay small and safe.');
  }

  if (includesAny(objectiveLower, REVIEW_KEYWORDS)) {
    addSkill(skills, 'review', 'Approval, production, or security-sensitive work should surface runtime and release risks explicitly.');
  }

  if (requiresDurableKnowledge || objectiveClass === 'shared-mcp-bootstrap' || includesAny(objectiveLower, DURABLE_KNOWLEDGE_KEYWORDS)) {
    addSkill(skills, 'obsidian-knowledge', 'Durable operator context and architecture deltas should stay visible in the shared Obsidian surface.');
  }

  return skills.slice(0, 4);
};

const buildActivateFirst = ({
  sourceSurface,
  targetObjective,
  objectiveClass,
  toolCalls,
  commands,
  readNext,
}) => {
  const steps = [];

  if (sourceSurface === 'session-open') {
    steps.push(`Use this session-open bundle as the bootstrap source for ${targetObjective} instead of reopening large planning docs first.`);
  } else {
    steps.push(`Treat this route preview as the execution contract for ${targetObjective} and keep deterministic routing ahead of free-form fallback.`);
  }

  if (toolCalls[0]) {
    steps.push(`Activate ${toolCalls[0]} next if the current surface still lacks the route or hot-state detail needed to proceed.`);
  }

  if (commands[0]) {
    steps.push(`Validate the shared teammate lane with ${commands[0]} before widening into manual bootstrap archaeology.`);
  }

  if (objectiveClass === 'youtube-community') {
    steps.push('Keep the deterministic scrape path first and only widen into MCP or Hermes if the page shape or downstream interpretation drifts.');
  } else if (objectiveClass === 'validation') {
    steps.push('Run the smallest relevant validation slice first and only reopen broader routing analysis if the targeted evidence stays inconclusive.');
  } else if (readNext[0]) {
    steps.push(`Read ${readNext[0]} only after the compact route and bootstrap surfaces stop being sufficient.`);
  }

  return uniqueStrings(steps).slice(0, 4);
};

/**
 * @param {{
 *   sourceSurface?: 'session-open' | 'route-preview';
 *   objective?: unknown;
 *   matchedExampleIds?: unknown;
 *   candidateApis?: unknown;
 *   candidateMcpTools?: unknown;
 *   primarySurfaces?: unknown;
 *   fallbackSurfaces?: unknown;
 *   requiresDurableKnowledge?: boolean;
 * }} params
 */
export const buildAutomationActivationPack = (params = {}) => {
  const sourceSurface = params.sourceSurface === 'route-preview' ? 'route-preview' : 'session-open';
  const targetObjective = compact(params.objective) || 'the current objective';
  const objectiveLower = targetObjective.toLowerCase();
  const matchedExampleIds = sanitizeStringList(params.matchedExampleIds);
  const candidateApis = sanitizeStringList(params.candidateApis);
  const candidateMcpTools = sanitizeStringList(params.candidateMcpTools);
  const primarySurfaces = sanitizeStringList(params.primarySurfaces);
  const fallbackSurfaces = sanitizeStringList(params.fallbackSurfaces);
  const requiresDurableKnowledge = params.requiresDurableKnowledge !== false;
  const objectiveClass = resolveObjectiveClass({ objectiveLower, matchedExampleIds });
  const readNext = buildReadNext({ objectiveClass, requiresDurableKnowledge });
  const commands = buildCommands({ objectiveClass });
  const toolCalls = buildToolCalls({ sourceSurface, objectiveClass });
  const recommendedSkills = buildRecommendedSkills({ objectiveLower, objectiveClass, requiresDurableKnowledge });
  const apiSurfaces = uniqueStrings([
    ...primarySurfaces.filter((surfaceId) => surfaceId === 'n8n-router' || surfaceId === 'supabase-hot-state'),
    ...(candidateApis.length > 0 ? ['n8n-router'] : []),
  ]).slice(0, 4);
  const mcpSurfaces = uniqueStrings([
    ...primarySurfaces.filter((surfaceId) => surfaceId.includes('mcp') || surfaceId === 'external-mcp-wrappers'),
    ...fallbackSurfaces.filter((surfaceId) => surfaceId.includes('mcp') || surfaceId === 'external-mcp-wrappers'),
    ...(candidateMcpTools.length > 0 ? ['external-mcp-wrappers'] : []),
  ]).slice(0, 4);
  const fallbackOrder = uniqueStrings([...primarySurfaces, ...fallbackSurfaces]).slice(0, 6);

  return {
    targetObjective,
    objectiveClass,
    summary: buildSummary({ objectiveClass, targetObjective }),
    activateFirst: buildActivateFirst({
      sourceSurface,
      targetObjective,
      objectiveClass,
      toolCalls,
      commands,
      readNext,
    }),
    recommendedSkills,
    readNext,
    toolCalls,
    commands,
    apiSurfaces,
    mcpSurfaces,
    fallbackOrder,
  };
};