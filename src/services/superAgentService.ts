import {
  serializeAgentSessionForApi,
  startAgentSession,
  type AgentSessionApiView,
} from './multiAgentService';
import { runPolicyGateNode, type PolicyGateResult } from './langgraph/nodes/coreNodes';
import { createActionApprovalRequest, type ActionApprovalRequest } from './skills/actionGovernanceStore';
import { isSkillId, listSkills } from './skills/registry';

export const SUPER_AGENT_MODES = ['local-collab', 'delivery', 'operations'] as const;
export const SUPER_AGENT_LEAD_AGENTS = ['OpenCode', 'OpenDev', 'NemoClaw', 'OpenJarvis'] as const;
export const SUPER_AGENT_CONSULT_TIMINGS = [
  'before-edit',
  'during-implementation',
  'before-release',
  'already-consulted',
  'during-review',
  'during-validation',
  'before-implementation',
] as const;

export type SuperAgentMode = (typeof SUPER_AGENT_MODES)[number];
export type SuperAgentLeadAgent = (typeof SUPER_AGENT_LEAD_AGENTS)[number];
export type SuperAgentConsultTiming = (typeof SUPER_AGENT_CONSULT_TIMINGS)[number];

export type SuperAgentConsultAgent = {
  name: SuperAgentLeadAgent;
  reason: string;
  timing: SuperAgentConsultTiming;
};

export type SuperAgentTaskEnvelope = {
  task_id: string;
  guild_id: string;
  objective: string;
  constraints: string[];
  risk_level: string;
  acceptance_criteria: string[];
  inputs: unknown;
  budget: unknown;
  current_stage?: string;
  lead_agent?: SuperAgentLeadAgent;
  consult_agent?: SuperAgentLeadAgent;
  current_state?: unknown;
  changed_files?: string[];
  consult_results?: unknown;
};

export type SuperAgentTaskInput = {
  taskId?: string;
  task_id?: string;
  guildId?: string;
  guild_id?: string;
  objective: string;
  constraints?: unknown;
  riskLevel?: string;
  risk_level?: string;
  acceptanceCriteria?: unknown;
  acceptance_criteria?: unknown;
  inputs?: unknown;
  budget?: unknown;
  routeMode?: string | null;
  route_mode?: string | null;
  currentStage?: string | null;
  current_stage?: string | null;
  requestedLeadAgent?: string | null;
  requested_lead_agent?: string | null;
  skillId?: string | null;
  skill_id?: string | null;
  priority?: string | null;
  lead_agent?: string | null;
  consult_agent?: string | null;
  current_state?: unknown;
  changed_files?: unknown;
  consult_results?: unknown;
};

export type SuperAgentRouteResponse = {
  task_id: string;
  guild_id: string;
  mode: SuperAgentMode;
  lead_agent: {
    name: SuperAgentLeadAgent;
    reason: string;
  };
  consult_agents: SuperAgentConsultAgent[];
  required_gates: string[];
  handoff: {
    next_owner: SuperAgentLeadAgent;
    reason: string;
    expected_outcome: string;
  };
  escalation: {
    required: boolean;
    target_mode: SuperAgentMode;
    reason: string;
  };
  next_action: string;
};

export type SuperAgentRuntimeMapping = {
  agent_session_request: {
    guildId: string;
    goal: string;
    skillId: string | null;
    priority: 'fast' | 'balanced' | 'precise';
    requestedBy?: string;
    isAdmin?: boolean;
  };
  supervisor_fields: {
    task_id: string;
    objective: string;
    mode: SuperAgentMode;
    lead_agent: SuperAgentRouteResponse['lead_agent'];
    consult_agents: SuperAgentRouteResponse['consult_agents'];
    required_gates: string[];
    escalation: SuperAgentRouteResponse['escalation'];
    next_action: string;
    current_stage?: string;
    privacy_preflight: SuperAgentPrivacyPreflight;
  };
};

export type SuperAgentPrivacyPreflight = {
  deliberation_mode: PolicyGateResult['mode'];
  risk_score: number;
  decision: PolicyGateResult['decision'];
  reasons: string[];
  requires_human_review: boolean;
  blocked: boolean;
};

export type SuperAgentRecommendation = {
  task: SuperAgentTaskEnvelope;
  route: SuperAgentRouteResponse;
  privacy_preflight: SuperAgentPrivacyPreflight;
  runtime_mapping: SuperAgentRuntimeMapping;
  priority: 'fast' | 'balanced' | 'precise';
  suggested_skill_id: string | null;
  session_goal: string;
};

export type SuperAgentStartResult = {
  recommendation: SuperAgentRecommendation;
  session_goal: string;
  session?: AgentSessionApiView;
  pendingApproval?: ActionApprovalRequest;
};

const nowTaskId = () => `super-${Date.now()}`;
const MAX_SUPERVISOR_PAYLOAD_CHARS = Math.max(400, Number(process.env.SUPER_AGENT_PAYLOAD_CLIP_CHARS || 2_000));
const SUPER_AGENT_REVIEW_APPROVAL_ACTION = String(process.env.SUPER_AGENT_REVIEW_APPROVAL_ACTION || 'super.inference.review').trim() || 'super.inference.review';

const toTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
};

const pickFirst = <T>(...values: T[]): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
};

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => toTrimmedString(item)).filter(Boolean);
  }
  const single = toTrimmedString(value);
  return single ? [single] : [];
};

const toChangedFiles = (value: unknown): string[] | undefined => {
  const items = toStringList(value);
  return items.length > 0 ? items : undefined;
};

const toMode = (value: unknown): SuperAgentMode | null => {
  const normalized = toTrimmedString(value);
  return SUPER_AGENT_MODES.includes(normalized as SuperAgentMode)
    ? (normalized as SuperAgentMode)
    : null;
};

const toLeadAgent = (value: unknown): SuperAgentLeadAgent | null => {
  const normalized = toTrimmedString(value);
  return SUPER_AGENT_LEAD_AGENTS.includes(normalized as SuperAgentLeadAgent)
    ? (normalized as SuperAgentLeadAgent)
    : null;
};

const toPriority = (value: unknown, fallback: 'fast' | 'balanced' | 'precise'): 'fast' | 'balanced' | 'precise' => {
  const normalized = toTrimmedString(value).toLowerCase();
  if (normalized === 'fast') return 'fast';
  if (normalized === 'precise') return 'precise';
  if (normalized === 'balanced') return 'balanced';
  return fallback;
};

const stringifyPayload = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const clipSupervisorPayload = (label: string, value: unknown): string => {
  const payload = stringifyPayload(value);
  if (!payload) {
    return '';
  }
  if (payload.length <= MAX_SUPERVISOR_PAYLOAD_CHARS) {
    return `${label}: ${payload}`;
  }

  return `${label}: ${payload.slice(0, MAX_SUPERVISOR_PAYLOAD_CHARS)}\n... (truncated for privacy-safe supervisor serialization)`;
};

const buildTaskContextSections = (task: SuperAgentTaskEnvelope): string[] => {
  const lines: string[] = [task.objective];

  if (task.constraints.length > 0) {
    lines.push(`Constraints: ${task.constraints.join(' | ')}`);
  }
  if (task.acceptance_criteria.length > 0) {
    lines.push(`Acceptance criteria: ${task.acceptance_criteria.join(' | ')}`);
  }

  const inputs = clipSupervisorPayload('Inputs', task.inputs);
  if (inputs) {
    lines.push(inputs);
  }

  const budget = clipSupervisorPayload('Budget', task.budget);
  if (budget) {
    lines.push(budget);
  }

  return lines;
};

const buildPrivacyPreflightGoal = (task: SuperAgentTaskEnvelope): string => {
  return buildTaskContextSections(task).join('\n').trim();
};

const buildSuperAgentPrivacyPreflight = (task: SuperAgentTaskEnvelope): SuperAgentPrivacyPreflight => {
  const policyGate = runPolicyGateNode({
    goal: buildPrivacyPreflightGoal(task),
    guildId: task.guild_id,
  });

  return {
    deliberation_mode: policyGate.mode,
    risk_score: policyGate.score,
    decision: policyGate.decision,
    reasons: [...policyGate.reasons],
    requires_human_review: policyGate.decision === 'review',
    blocked: policyGate.decision === 'block',
  };
};

const inferMode = (objective: string): SuperAgentMode => {
  if (/(incident|release|recover|recovery|rollback|deploy|workflow|runbook|automation|배포|롤백|장애|복구|운영)/i.test(objective)) {
    return 'operations';
  }
  if (/(architecture|roadmap|adr|trade-off|formal gate|release-ready|pr-ready|검증|아키텍처|로드맵|설계 검토|릴리스)/i.test(objective)) {
    return 'delivery';
  }
  return 'local-collab';
};

const inferLeadAgent = (objective: string, requestedLeadAgent: SuperAgentLeadAgent | null): SuperAgentLeadAgent => {
  if (requestedLeadAgent) {
    return requestedLeadAgent;
  }

  // Sprint phase-based deterministic routing (highest priority)
  if (/\[PHASE\]\s*(plan|설계)/i.test(objective)) return 'OpenDev';
  if (/\[PHASE\]\s*(implement|구현)/i.test(objective)) return 'OpenCode';
  if (/\[PHASE\]\s*(review|리뷰)/i.test(objective)) return 'NemoClaw';
  if (/\[PHASE\]\s*(qa|테스트)/i.test(objective)) return 'OpenCode';
  if (/\[PHASE\]\s*(security-audit|보안)/i.test(objective)) return 'NemoClaw';
  if (/\[PHASE\]\s*(ops-validate|운영)/i.test(objective)) return 'OpenJarvis';
  if (/\[PHASE\]\s*(ship|배포)/i.test(objective)) return 'OpenJarvis';
  if (/\[PHASE\]\s*(retro|회고)/i.test(objective)) return 'OpenDev';

  // Keyword-based fallback for non-sprint invocations
  if (/(review|risk|regression|security|audit|보안|리스크|회귀|리뷰)/i.test(objective)) {
    return 'NemoClaw';
  }
  if (/(architecture|roadmap|adr|boundary|contract|migration|설계|아키텍처|경계|계약|마이그레이션)/i.test(objective)) {
    return 'OpenDev';
  }
  if (/(workflow|deploy|release|rollback|automation|script|runbook|배포|롤백|자동화|스크립트|운영)/i.test(objective)) {
    return 'OpenJarvis';
  }
  return 'OpenCode';
};

const inferSuggestedSkillId = (objective: string, explicitSkillId?: string | null): string | null => {
  const explicit = toTrimmedString(explicitSkillId);
  if (explicit && isSkillId(explicit)) {
    return explicit;
  }

  if (/(webhook|웹훅)/i.test(objective) && isSkillId('webhook')) {
    return 'webhook';
  }
  if (/(onboarding|온보딩)/i.test(objective) && isSkillId('guild-onboarding-blueprint')) {
    return 'guild-onboarding-blueprint';
  }
  if (/(incident|postmortem|회고|장애)/i.test(objective) && isSkillId('incident-review')) {
    return 'incident-review';
  }
  return null;
};

const pushConsult = (items: SuperAgentConsultAgent[], candidate: SuperAgentConsultAgent) => {
  if (items.some((item) => item.name === candidate.name) || items.length >= 2) {
    return;
  }
  items.push(candidate);
};

const inferConsultAgents = (objective: string, leadAgent: SuperAgentLeadAgent, mode: SuperAgentMode): SuperAgentConsultAgent[] => {
  const items: SuperAgentConsultAgent[] = [];
  const architectureHeavy = /(architecture|adr|contract|boundary|migration|설계|아키텍처|계약|경계|마이그레이션)/i.test(objective);
  const safetyHeavy = /(security|risk|regression|test|보안|리스크|회귀|테스트)/i.test(objective);
  const opsHeavy = /(workflow|deploy|release|rollback|automation|script|runbook|배포|롤백|운영|자동화)/i.test(objective);

  if (leadAgent === 'OpenCode') {
    if (architectureHeavy) {
      pushConsult(items, { name: 'OpenDev', reason: '경계와 계약 검토가 필요합니다.', timing: 'before-edit' });
    }
    if (safetyHeavy || mode === 'delivery') {
      pushConsult(items, { name: 'NemoClaw', reason: '실패 경로와 회귀 리스크를 조기에 점검합니다.', timing: 'during-implementation' });
    }
    if (opsHeavy || mode === 'operations') {
      pushConsult(items, { name: 'OpenJarvis', reason: '운영 영향과 롤백 경로를 확인합니다.', timing: 'before-release' });
    }
  } else if (leadAgent === 'OpenDev') {
    pushConsult(items, { name: 'OpenCode', reason: '구현 가능성과 변경 범위를 확인합니다.', timing: 'before-implementation' });
    if (opsHeavy || mode !== 'local-collab') {
      pushConsult(items, { name: 'OpenJarvis', reason: '배포 및 운영 가드레일을 함께 검토합니다.', timing: 'before-release' });
    }
  } else if (leadAgent === 'OpenJarvis') {
    pushConsult(items, { name: 'OpenCode', reason: '코드 수정 필요 범위를 확인합니다.', timing: 'during-implementation' });
    if (safetyHeavy || mode !== 'local-collab') {
      pushConsult(items, { name: 'NemoClaw', reason: '운영 변경의 리스크를 점검합니다.', timing: 'before-release' });
    }
  } else {
    pushConsult(items, { name: 'OpenCode', reason: '수정 경로와 검증 범위를 구체화합니다.', timing: 'during-review' });
    if (opsHeavy) {
      pushConsult(items, { name: 'OpenJarvis', reason: '운영 blast radius를 확인합니다.', timing: 'before-release' });
    }
  }

  return items;
};

const resolveRequiredGates = (params: {
  mode: SuperAgentMode;
  objective: string;
  leadAgent: SuperAgentLeadAgent;
  consultAgents: SuperAgentConsultAgent[];
  riskLevel: string;
}): string[] => {
  const gates = new Set<string>(['typecheck', 'tests']);
  if (params.mode !== 'local-collab' || /high|critical|높음|긴급/i.test(params.riskLevel) || params.leadAgent === 'NemoClaw') {
    gates.add('security');
  }
  if (params.leadAgent === 'OpenDev') {
    gates.add('architecture-alignment');
  }
  if (params.mode === 'operations' || params.consultAgents.some((item) => item.name === 'OpenJarvis') || /(deploy|rollback|automation|배포|롤백|자동화)/i.test(params.objective)) {
    gates.add('ops-readiness');
  }
  if (params.mode !== 'local-collab') {
    gates.add('regression-check');
  }
  if (params.mode === 'operations') {
    gates.add('rollback-readiness');
  }
  return [...gates];
};

export const normalizeSuperAgentTask = (raw: SuperAgentTaskInput): SuperAgentTaskEnvelope => {
  const task_id = toTrimmedString(pickFirst(raw.task_id, raw.taskId)) || nowTaskId();
  const guild_id = toTrimmedString(pickFirst(raw.guild_id, raw.guildId));
  const objective = toTrimmedString(raw.objective);
  if (!task_id || !guild_id || !objective) {
    throw new Error('task_id, guild_id and objective are required');
  }

  const lead_agent = toLeadAgent(raw.lead_agent);
  const consult_agent = toLeadAgent(raw.consult_agent);

  return {
    task_id,
    guild_id,
    objective,
    constraints: toStringList(raw.constraints),
    risk_level: toTrimmedString(pickFirst(raw.risk_level, raw.riskLevel)) || 'balanced',
    acceptance_criteria: toStringList(pickFirst(raw.acceptance_criteria, raw.acceptanceCriteria)),
    inputs: raw.inputs ?? {},
    budget: raw.budget ?? {},
    current_stage: toTrimmedString(pickFirst(raw.current_stage, raw.currentStage)) || undefined,
    lead_agent: lead_agent || undefined,
    consult_agent: consult_agent || undefined,
    current_state: raw.current_state,
    changed_files: toChangedFiles(raw.changed_files),
    consult_results: raw.consult_results,
  };
};

const buildStructuredGoal = (params: {
  task: SuperAgentTaskEnvelope;
  route: SuperAgentRouteResponse;
  privacyPreflight: SuperAgentPrivacyPreflight;
}): string => {
  const lines = [
    `[TASK_ID] ${params.task.task_id}`,
    `[SUPER_AGENT_MODE] ${params.route.mode}`,
    `[LEAD_AGENT] ${params.route.lead_agent.name} - ${params.route.lead_agent.reason}`,
    params.route.consult_agents.length > 0
      ? `[CONSULT_AGENTS]\n${params.route.consult_agents.map((item) => `- ${item.name} (${item.timing}): ${item.reason}`).join('\n')}`
      : '[CONSULT_AGENTS]\n- none',
    `[OBJECTIVE]\n${params.task.objective}`,
  ];

  if (params.task.constraints.length > 0) {
    lines.push(`[CONSTRAINTS]\n${params.task.constraints.map((item) => `- ${item}`).join('\n')}`);
  }
  if (params.task.acceptance_criteria.length > 0) {
    lines.push(`[ACCEPTANCE_CRITERIA]\n${params.task.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`);
  }

  const serializedInputs = clipSupervisorPayload('Inputs', params.task.inputs);
  if (serializedInputs) {
    lines.push(`[INPUTS]\n${serializedInputs.slice('Inputs: '.length)}`);
  }

  const serializedBudget = clipSupervisorPayload('Budget', params.task.budget);
  if (serializedBudget) {
    lines.push(`[BUDGET]\n${serializedBudget.slice('Budget: '.length)}`);
  }

  if (params.task.current_stage) {
    lines.push(`[CURRENT_STAGE]\n${params.task.current_stage}`);
  }

  lines.push(
    '[PRIVACY_PREFLIGHT]',
    `- decision: ${params.privacyPreflight.decision}`,
    `- deliberation_mode: ${params.privacyPreflight.deliberation_mode}`,
    `- risk_score: ${params.privacyPreflight.risk_score}`,
    `- reasons: ${params.privacyPreflight.reasons.length > 0 ? params.privacyPreflight.reasons.join(', ') : 'none'}`,
  );

  lines.push(
    `[REQUIRED_GATES]\n${params.route.required_gates.map((item) => `- ${item}`).join('\n')}`,
    `[NEXT_ACTION]\n${params.route.next_action}`,
  );

  return lines.join('\n\n').trim();
};

export const getSuperAgentCapabilities = () => {
  return {
    modes: [...SUPER_AGENT_MODES],
    leadAgents: [...SUPER_AGENT_LEAD_AGENTS],
    consultTimings: [...SUPER_AGENT_CONSULT_TIMINGS],
    availableSkills: listSkills().map((skill) => ({
      id: skill.id,
      title: skill.title,
      executorKey: skill.executorKey,
      adminOnly: skill.adminOnly === true,
    })),
  };
};

export const recommendSuperAgent = (raw: SuperAgentTaskInput): SuperAgentRecommendation => {
  const task = normalizeSuperAgentTask(raw);
  const privacyPreflight = buildSuperAgentPrivacyPreflight(task);
  const requestedMode = toMode(pickFirst(raw.route_mode, raw.routeMode));
  const inferredMode = inferMode(task.objective);
  const mode = requestedMode || inferredMode;
  const requestedLeadAgent = toLeadAgent(pickFirst(raw.requested_lead_agent, raw.requestedLeadAgent, task.lead_agent));
  const leadAgentName = inferLeadAgent(task.objective, requestedLeadAgent);
  const consultAgents = inferConsultAgents(task.objective, leadAgentName, mode);
  const requiredGates = resolveRequiredGates({
    mode,
    objective: task.objective,
    leadAgent: leadAgentName,
    consultAgents,
    riskLevel: task.risk_level,
  });
  if (privacyPreflight.requires_human_review && !requiredGates.includes('privacy-review')) {
    requiredGates.push('privacy-review');
  }
  const priority = toPriority(
    raw.priority,
    privacyPreflight.requires_human_review || mode === 'operations' || /high|critical|높음|긴급/i.test(task.risk_level)
      ? 'precise'
      : 'balanced',
  );
  const suggestedSkillId = inferSuggestedSkillId(task.objective, pickFirst(raw.skill_id, raw.skillId));

  const route: SuperAgentRouteResponse = {
    task_id: task.task_id,
    guild_id: task.guild_id,
    mode,
    lead_agent: {
      name: leadAgentName,
      reason: requestedLeadAgent
        ? '사용자가 lead agent를 지정했습니다.'
        : `${leadAgentName}가 현재 목표의 주 책임에 가장 가깝습니다.`,
    },
    consult_agents: consultAgents,
    required_gates: requiredGates,
    handoff: {
      next_owner: leadAgentName,
      reason: mode === 'local-collab'
        ? 'lead agent가 consult 결과를 종합해 다음 단계를 진행합니다.'
        : `${leadAgentName}가 현재 단계의 실행 owner입니다.`,
      expected_outcome: mode === 'local-collab'
        ? '구현 또는 검토를 진행할 수 있는 단일 next action 확정'
        : '현재 모드의 다음 formal stage로 진행 가능한 결과 산출',
    },
    escalation: {
      required: requestedMode === 'local-collab' && inferredMode !== 'local-collab',
      target_mode: requestedMode === 'local-collab' && inferredMode !== 'local-collab' ? inferredMode : mode,
      reason: requestedMode === 'local-collab' && inferredMode !== 'local-collab'
        ? `목표 특성상 ${inferredMode} 모드 승격이 더 안전합니다.`
        : '현재 추천 모드에서 바로 진행 가능합니다.',
    },
    next_action: mode === 'local-collab'
      ? `${leadAgentName}가 목표를 분해하고 consult 필요 여부를 확정합니다.`
      : `${leadAgentName}가 ${mode} 모드 기준으로 현재 단계를 시작합니다.`,
  };

  const session_goal = buildStructuredGoal({ task, route, privacyPreflight });

  const runtime_mapping: SuperAgentRuntimeMapping = {
    agent_session_request: {
      guildId: task.guild_id,
      goal: session_goal,
      skillId: suggestedSkillId,
      priority,
    },
    supervisor_fields: {
      task_id: task.task_id,
      objective: task.objective,
      mode,
      lead_agent: route.lead_agent,
      consult_agents: route.consult_agents,
      required_gates: route.required_gates,
      escalation: route.escalation,
      next_action: route.next_action,
      current_stage: task.current_stage,
      privacy_preflight: privacyPreflight,
    },
  };

  return {
    task,
    route,
    privacy_preflight: privacyPreflight,
    runtime_mapping,
    priority,
    suggested_skill_id: suggestedSkillId,
    session_goal,
  };
};

export const startSuperAgentSessionFromTask = async (params: SuperAgentTaskInput & {
  requestedBy: string;
  isAdmin?: boolean;
}): Promise<SuperAgentStartResult> => {
  const recommendation = recommendSuperAgent(params);
  if (recommendation.privacy_preflight.blocked) {
    const reasonText = recommendation.privacy_preflight.reasons.length > 0
      ? recommendation.privacy_preflight.reasons.join(', ')
      : 'privacy_block_threshold';
    throw new Error(`PRIVACY_PREFLIGHT_BLOCKED:${reasonText}`);
  }

  if (recommendation.privacy_preflight.requires_human_review) {
    const approval = await createActionApprovalRequest({
      guildId: recommendation.runtime_mapping.agent_session_request.guildId,
      requestedBy: params.requestedBy,
      goal: recommendation.session_goal,
      actionName: SUPER_AGENT_REVIEW_APPROVAL_ACTION,
      actionArgs: {
        objective: recommendation.task.objective,
        constraints: recommendation.task.constraints,
        acceptanceCriteria: recommendation.task.acceptance_criteria,
        privacyPreflight: recommendation.privacy_preflight,
        suggestedSkillId: recommendation.suggested_skill_id,
      },
      reason: `privacy_review_required:${recommendation.privacy_preflight.reasons.join(',') || 'policy_review'}`,
    });

    recommendation.runtime_mapping.agent_session_request.requestedBy = params.requestedBy;
    recommendation.runtime_mapping.agent_session_request.isAdmin = params.isAdmin === true;

    return {
      recommendation,
      session_goal: recommendation.session_goal,
      pendingApproval: approval,
    };
  }

  const session = startAgentSession({
    guildId: recommendation.runtime_mapping.agent_session_request.guildId,
    requestedBy: params.requestedBy,
    goal: recommendation.runtime_mapping.agent_session_request.goal,
    skillId: recommendation.runtime_mapping.agent_session_request.skillId,
    priority: recommendation.runtime_mapping.agent_session_request.priority,
    isAdmin: params.isAdmin === true,
  });

  recommendation.runtime_mapping.agent_session_request.requestedBy = params.requestedBy;
  recommendation.runtime_mapping.agent_session_request.isAdmin = params.isAdmin === true;

  return {
    recommendation,
    session_goal: recommendation.session_goal,
    session: serializeAgentSessionForApi(session),
  };
};
