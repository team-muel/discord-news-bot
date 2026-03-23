import { buildAgentRuntimeReadinessReport } from '../../agentRuntimeReadinessService';
import { generateText, isAnyLlmConfigured } from '../../llmClient';
import {
  recommendSuperAgent,
  startSuperAgentSessionFromTask,
  type SuperAgentLeadAgent,
  type SuperAgentTaskInput,
} from '../../superAgentService';
import { runNemoClawDiscoverExecutor } from '../../workerGeneration/workerExecutors';
import { executeExternalAction } from '../../tools/externalAdapterRegistry';
import { runDelegatedAction } from './mcpDelegatedAction';
import { opencodeExecuteAction } from './opencode';
import type { ActionDefinition, ActionExecutionResult, LegacyAgentRole } from './types';

const MAX_ARTIFACT_CHARS = 3200;
const MAX_PROMPT_CODE_CHARS = 1800;

const compact = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const clip = (value: unknown, max = MAX_ARTIFACT_CHARS): string => String(value || '').slice(0, max);

const toStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => compact(item)).filter(Boolean);
  }
  const single = compact(value);
  return single ? [single] : [];
};

const toBoolean = (value: unknown, fallback = false): boolean => {
  const normalized = compact(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const toJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const resolveGoal = (goal: string, args?: Record<string, unknown>): string => {
  const query = compact(args?.query);
  return query || compact(goal);
};

const resolveGuildId = (guildId?: string, args?: Record<string, unknown>): string => {
  return compact(guildId) || compact(args?.guildId) || 'local-ide';
};

const createTaskInput = (params: {
  goal: string;
  guildId?: string;
  args?: Record<string, unknown>;
  requestedLeadAgent?: SuperAgentLeadAgent;
}): SuperAgentTaskInput => {
  return {
    task_id: compact(params.args?.taskId) || `task-${Date.now()}`,
    guild_id: resolveGuildId(params.guildId, params.args),
    objective: params.goal,
    constraints: toStringList(params.args?.constraints),
    acceptance_criteria: toStringList(params.args?.acceptanceCriteria),
    inputs: params.args?.inputs ?? {},
    budget: params.args?.budget ?? {},
    route_mode: compact(params.args?.routeMode) || null,
    requested_lead_agent: params.requestedLeadAgent || compact(params.args?.requestedLeadAgent) || null,
    current_stage: compact(params.args?.currentStage) || null,
    changed_files: toStringList(params.args?.changedFiles),
  };
};

const leadAgentToRole = (value: string): LegacyAgentRole => {
  const normalized = compact(value).toLowerCase();
  if (normalized === 'opencode') return 'opencode';
  if (normalized === 'opendev') return 'opendev';
  if (normalized === 'nemoclaw') return 'nemoclaw';
  return 'openjarvis';
};

const roleToLeadAgent = (value: LegacyAgentRole): SuperAgentLeadAgent => {
  if (value === 'opencode') return 'OpenCode';
  if (value === 'opendev') return 'OpenDev';
  if (value === 'nemoclaw') return 'NemoClaw';
  return 'OpenJarvis';
};

const withRouting = (
  result: ActionExecutionResult,
  toAgent: LegacyAgentRole,
  reason: string,
  evidenceId?: string,
): ActionExecutionResult => ({
  ...result,
  handoff: result.handoff || {
    fromAgent: 'openjarvis',
    toAgent,
    reason,
    evidenceId,
  },
});

const renderRecommendation = (recommendation: ReturnType<typeof recommendSuperAgent>): string => {
  const consults = recommendation.route.consult_agents.length > 0
    ? recommendation.route.consult_agents.map((item) => `- ${item.name} (${item.timing}): ${item.reason}`).join('\n')
    : '- none';

  return [
    '# Route',
    `- mode: ${recommendation.route.mode}`,
    `- lead_agent: ${recommendation.route.lead_agent.name}`,
    `- lead_reason: ${recommendation.route.lead_agent.reason}`,
    '',
    '# Consult Agents',
    consults,
    '',
    '# Required Gates',
    ...recommendation.route.required_gates.map((item) => `- ${item}`),
    '',
    '# Handoff',
    `- next_owner: ${recommendation.route.handoff.next_owner}`,
    `- expected_outcome: ${recommendation.route.handoff.expected_outcome}`,
    '',
    '# Escalation',
    `- required: ${recommendation.route.escalation.required}`,
    `- target_mode: ${recommendation.route.escalation.target_mode}`,
    `- reason: ${recommendation.route.escalation.reason}`,
    '',
    '# Next Action',
    `- ${recommendation.route.next_action}`,
  ].join('\n');
};

const maybeGenerateRoleText = async (params: {
  enabled: boolean;
  actionName: string;
  system: string;
  user: string;
  fallback: string;
}): Promise<string> => {
  if (!params.enabled) {
    return params.fallback;
  }

  try {
    const raw = await generateText({
      system: params.system,
      user: params.user,
      actionName: params.actionName,
      temperature: 0.2,
      maxTokens: 1000,
    });
    return compact(raw) ? clip(raw) : params.fallback;
  } catch {
    return params.fallback;
  }
};

const tryParseDelegatedActionResult = (blocks: string[]): ActionExecutionResult | null => {
  const first = String(blocks[0] || '').trim();
  if (!first) {
    return null;
  }
  try {
    const parsed = JSON.parse(first) as Partial<ActionExecutionResult>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean' || typeof parsed.name !== 'string') {
      return null;
    }
    return {
      ok: parsed.ok,
      name: parsed.name,
      summary: String(parsed.summary || '').trim() || parsed.name,
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map((item) => String(item || '')) : [],
      verification: Array.isArray(parsed.verification) ? parsed.verification.map((item) => String(item || '')) : [],
      error: parsed.error ? String(parsed.error) : undefined,
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
      agentRole: parsed.agentRole,
      handoff: parsed.handoff,
    };
  } catch {
    return null;
  }
};

const getActiveWorkerRole = (): string => String(process.env.AGENT_ROLE_WORKER_ROLE || '').trim().toLowerCase();

const maybeDelegateAgentAction = async (params: {
  actionName: string;
  workerKind: 'local-orchestrator' | 'opendev' | 'nemoclaw' | 'openjarvis';
  toolName: string;
  goal: string;
  args?: Record<string, unknown>;
  guildId?: string;
  requestedBy?: string;
}): Promise<ActionExecutionResult | null> => {
  if (getActiveWorkerRole() === params.workerKind) {
    return null;
  }

  return runDelegatedAction({
    actionName: params.actionName,
    workerKind: params.workerKind,
    toolName: params.toolName,
    args: {
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      ...(params.args || {}),
    },
    successSummary: (blocks) => {
      const parsed = tryParseDelegatedActionResult(blocks);
      return parsed?.summary || compact(blocks[0] || '') || `${params.actionName} delegated`;
    },
    strictFailureSummary: `${params.actionName} worker delegation failed`,
    strictFailureVerification: ['mcp strict routing', `${params.workerKind} delegation failed`],
    strictFailureError: `${params.actionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_DELEGATION_FAILED`,
    parseStructuredResult: tryParseDelegatedActionResult,
    onWorkerMissing: () => null,
    onEmptyResult: () => ({
      ok: false,
      name: params.actionName,
      summary: `${params.actionName} worker returned empty result`,
      artifacts: [],
      verification: ['delegated result empty'],
      error: `${params.actionName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_EMPTY_RESULT`,
    }),
  });
};

const executeRoleAction = async (params: {
  role: LegacyAgentRole;
  goal: string;
  guildId?: string;
  requestedBy?: string;
  args?: Record<string, unknown>;
}): Promise<ActionExecutionResult> => {
  const actionArgs = { ...(params.args || {}) };
  if (params.role === 'opencode' && typeof actionArgs.task !== 'string') {
    actionArgs.task = params.goal;
  }

  if (params.role === 'opencode') {
    return opencodeExecuteAction.execute({
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      args: actionArgs,
    });
  }
  if (params.role === 'opendev') {
    return opendevPlanAction.execute({
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      args: actionArgs,
    });
  }
  if (params.role === 'nemoclaw') {
    return nemoclawReviewAction.execute({
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      args: actionArgs,
    });
  }
  return openjarvisOpsAction.execute({
    goal: params.goal,
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    args: actionArgs,
  });
};

const buildConsultArgs = (params: {
  baseArgs?: Record<string, unknown>;
  recommendation: ReturnType<typeof recommendSuperAgent>;
  leadResult: ActionExecutionResult;
  role: LegacyAgentRole;
}): Record<string, unknown> => ({
  ...(params.baseArgs || {}),
  requestedLeadAgent: roleToLeadAgent(params.role),
  inputs: {
    route: params.recommendation.route,
    leadResult: {
      ok: params.leadResult.ok,
      summary: params.leadResult.summary,
      verification: params.leadResult.verification,
    },
    existingInputs: params.baseArgs?.inputs ?? {},
  },
});

const renderOrchestrationFallback = (params: {
  recommendation: ReturnType<typeof recommendSuperAgent>;
  leadResult: ActionExecutionResult;
  consultResults: Array<{ role: LegacyAgentRole; result: ActionExecutionResult }>;
}): string => {
  const consults = params.consultResults.length > 0
    ? params.consultResults.map((item) => `- ${item.role}: ${item.result.ok ? 'ok' : 'failed'} | ${item.result.summary}`).join('\n')
    : '- none';

  return [
    '# Route',
    `- mode: ${params.recommendation.route.mode}`,
    `- lead_agent: ${params.recommendation.route.lead_agent.name}`,
    `- next_action: ${params.recommendation.route.next_action}`,
    '',
    '# Lead Result',
    `- status: ${params.leadResult.ok ? 'ok' : 'failed'}`,
    `- summary: ${params.leadResult.summary}`,
    '',
    '# Consult Results',
    consults,
    '',
    '# Synthesis',
    `- required_gates: ${params.recommendation.route.required_gates.join(', ') || 'none'}`,
    `- escalation_required: ${params.recommendation.route.escalation.required}`,
    `- handoff_next_owner: ${params.recommendation.route.handoff.next_owner}`,
  ].join('\n');
};

export const localOrchestratorRouteAction: ActionDefinition = {
  name: 'local.orchestrator.route',
  description: '로컬 오케스트레이터 기준으로 lead/consult/게이트를 실제 라우팅 결과로 반환하고, 선택적으로 세션까지 시작합니다.',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.route',
        summary: '라우팅할 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'local.orchestrator.route',
      workerKind: 'local-orchestrator',
      toolName: 'local.orchestrator.route',
      goal: query,
      args,
      guildId,
      requestedBy,
    });
    if (delegated) {
      return delegated;
    }

    const taskInput = createTaskInput({ goal: query, guildId, args });
    const shouldStartSession = toBoolean(args?.startSession, false);

    try {
      if (shouldStartSession) {
        const started = await startSuperAgentSessionFromTask({
          ...taskInput,
          requestedBy: compact(requestedBy) || compact(args?.requestedBy) || 'system',
          isAdmin: toBoolean(args?.isAdmin, false),
        });

        const leadRole = leadAgentToRole(started.recommendation.route.lead_agent.name);
        const artifacts = [
          renderRecommendation(started.recommendation),
          clip(toJson({
            privacy_preflight: started.recommendation.privacy_preflight,
            runtime_mapping: started.recommendation.runtime_mapping.supervisor_fields,
          })),
        ];

        if (started.session) {
          artifacts.push(clip(`session=${toJson(started.session)}`));
        }
        if (started.pendingApproval) {
          artifacts.push(clip(`pending_approval=${toJson(started.pendingApproval)}`));
        }

        return withRouting({
          ok: true,
          name: 'local.orchestrator.route',
          summary: started.session
            ? `local-orchestrator가 ${started.recommendation.route.lead_agent.name} lead로 세션을 시작했습니다.`
            : `local-orchestrator가 ${started.recommendation.route.lead_agent.name} lead 라우팅과 승인 대기를 생성했습니다.`,
          artifacts,
          verification: ['super-agent recommendation generated', 'super-agent session start attempted'],
          agentRole: 'openjarvis',
        }, leadRole, 'local orchestrator selected next owner', started.recommendation.route.mode);
      }

      const recommendation = recommendSuperAgent(taskInput);
      const leadRole = leadAgentToRole(recommendation.route.lead_agent.name);
      return withRouting({
        ok: true,
        name: 'local.orchestrator.route',
        summary: `local-orchestrator가 ${recommendation.route.lead_agent.name} lead와 ${recommendation.route.mode} 모드를 선택했습니다.`,
        artifacts: [
          renderRecommendation(recommendation),
          clip(toJson({
            privacy_preflight: recommendation.privacy_preflight,
            runtime_mapping: recommendation.runtime_mapping.supervisor_fields,
          })),
        ],
        verification: ['super-agent recommendation generated'],
        agentRole: 'openjarvis',
      }, leadRole, 'local orchestrator selected next owner', recommendation.route.mode);
    } catch (error) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.route',
        summary: 'local-orchestrator 라우팅 생성에 실패했습니다.',
        artifacts: [clip(error instanceof Error ? error.message : String(error), 400)],
        verification: ['super-agent routing failed'],
        error: 'LOCAL_ORCHESTRATOR_ROUTE_FAILED',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'local orchestrator routing failed');
    }
  },
};

export const localOrchestratorAllAction: ActionDefinition = {
  name: 'local.orchestrator.all',
  description: '로컬 오케스트레이터가 lead 실행, consult 실행, synthesis까지 한 번에 수행합니다.',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.all',
        summary: '오케스트레이션할 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'local.orchestrator.all',
      workerKind: 'local-orchestrator',
      toolName: 'local.orchestrator.all',
      goal: query,
      args,
      guildId,
      requestedBy,
    });
    if (delegated) {
      return delegated;
    }

    try {
      const recommendation = recommendSuperAgent(createTaskInput({ goal: query, guildId, args }));
      const leadRole = leadAgentToRole(recommendation.route.lead_agent.name);
      const consultRoles = recommendation.route.consult_agents
        .map((item) => leadAgentToRole(item.name))
        .filter((role, index, list) => role !== leadRole && list.indexOf(role) === index);

      const leadResult = await executeRoleAction({
        role: leadRole,
        goal: query,
        guildId,
        requestedBy,
        args: {
          ...(args || {}),
          requestedLeadAgent: recommendation.route.lead_agent.name,
        },
      });

      const consultResults = await Promise.all(consultRoles.map(async (role) => ({
        role,
        result: await executeRoleAction({
          role,
          goal: query,
          guildId,
          requestedBy,
          args: buildConsultArgs({
            baseArgs: args,
            recommendation,
            leadResult,
            role,
          }),
        }),
      })));

      const fallback = renderOrchestrationFallback({ recommendation, leadResult, consultResults });
      const synthesis = await maybeGenerateRoleText({
        enabled: isAnyLlmConfigured(),
        actionName: 'action.local.orchestrator.all',
        system: [
          '너는 Local Orchestrator다.',
          'lead 결과와 consult 결과를 합성해 한 개의 다음 행동과 release gate 상태를 결정한다.',
          '출력은 Route, Lead Result, Consult Results, Synthesis 순서로만 작성한다.',
        ].join('\n'),
        user: [
          `목표: ${query}`,
          `라우팅:\n${renderRecommendation(recommendation)}`,
          `lead 결과:\n${toJson({ ok: leadResult.ok, summary: leadResult.summary, verification: leadResult.verification })}`,
          `consult 결과:\n${toJson(consultResults.map((item) => ({ role: item.role, ok: item.result.ok, summary: item.result.summary, verification: item.result.verification })))}`,
        ].join('\n\n'),
        fallback,
      });

      const degradedRoles = consultResults.filter((item) => !item.result.ok).map((item) => item.role);
      const ok = leadResult.ok && degradedRoles.length === 0;
      const summary = ok
        ? `local-orchestrator가 ${recommendation.route.lead_agent.name} lead와 ${consultResults.length}개 consult를 실제 실행하고 합성했습니다.`
        : degradedRoles.length > 0
          ? `local-orchestrator가 전체 협업을 실행했지만 consult 일부가 저하되었습니다: ${degradedRoles.join(', ')}`
          : `local-orchestrator 전체 협업에서 lead 실행이 실패했습니다: ${leadRole}`;

      return withRouting({
        ok,
        name: 'local.orchestrator.all',
        summary,
        artifacts: [
          renderRecommendation(recommendation),
          clip(`lead=${toJson(leadResult)}`),
          ...consultResults.map((item) => clip(`consult:${item.role}=${toJson(item.result)}`)),
          clip(synthesis),
        ],
        verification: [
          'super-agent recommendation generated',
          `lead executed:${leadRole}`,
          ...consultResults.map((item) => `consult executed:${item.role}`),
          'local orchestrator synthesis emitted',
        ],
        error: leadResult.ok ? (degradedRoles.length > 0 ? 'LOCAL_ORCHESTRATOR_CONSULT_DEGRADED' : undefined) : 'LOCAL_ORCHESTRATOR_LEAD_FAILED',
        agentRole: 'openjarvis',
      }, leadRole, 'local orchestrator full collaboration completed', recommendation.route.mode);
    } catch (error) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.all',
        summary: 'local-orchestrator 전체 협업 실행에 실패했습니다.',
        artifacts: [clip(error instanceof Error ? error.message : String(error), 400)],
        verification: ['local orchestrator full collaboration failed'],
        error: 'LOCAL_ORCHESTRATOR_ALL_FAILED',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'local orchestrator full collaboration failed');
    }
  },
};

export const opendevPlanAction: ActionDefinition = {
  name: 'opendev.plan',
  description: 'OpenDev 역할로 목표를 아키텍처/계획/게이트 관점의 실행안으로 정리합니다.',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'opendev.plan',
        summary: '계획할 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'opendev',
      }, 'opendev', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'opendev.plan',
      workerKind: 'opendev',
      toolName: 'opendev.plan',
      goal: query,
      args,
      guildId,
    });
    if (delegated) {
      return delegated;
    }

    const recommendation = recommendSuperAgent(createTaskInput({
      goal: query,
      guildId,
      args,
      requestedLeadAgent: 'OpenDev',
    }));
    const fallback = [
      '# Current State',
      `- selected_mode: ${recommendation.route.mode}`,
      `- lead_agent: ${recommendation.route.lead_agent.name}`,
      '',
      '# Target State',
      `- next_owner: ${recommendation.route.handoff.next_owner}`,
      `- expected_outcome: ${recommendation.route.handoff.expected_outcome}`,
      '',
      '# Milestones',
      `- 1. Confirm scope and non-goals from the objective: ${query}`,
      `- 2. Apply required gates: ${recommendation.route.required_gates.join(', ') || 'none'}`,
      `- 3. Execute next action: ${recommendation.route.next_action}`,
      '',
      '# Risks',
      `- escalation_required: ${recommendation.route.escalation.required}`,
      `- escalation_reason: ${recommendation.route.escalation.reason}`,
    ].join('\n');

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.opendev.plan',
      system: [
        '너는 OpenDev 아키텍처 에이전트다.',
        '출력은 현재 상태, 목표 상태, 마일스톤, 리스크 순서로 간결하게 정리한다.',
        '과장 없이 실행 가능한 단계만 제안한다.',
      ].join('\n'),
      user: [
        `목표: ${query}`,
        '라우팅 근거:',
        renderRecommendation(recommendation),
      ].join('\n\n'),
      fallback,
    });

    return withRouting({
      ok: true,
      name: 'opendev.plan',
      summary: 'OpenDev 계획 산출 완료',
      artifacts: [clip(synthesized), clip(toJson(recommendation.route))],
      verification: ['super-agent route synthesized', 'opendev planning emitted'],
      agentRole: 'opendev',
    }, 'opendev', 'opendev planning completed', recommendation.route.mode);
  },
};

export const nemoclawReviewAction: ActionDefinition = {
  name: 'nemoclaw.review',
  description: 'NemoClaw 역할로 목표나 코드 스니펫을 리뷰하고 리스크와 테스트 갭을 반환합니다.',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'nemoclaw.review',
        summary: '리뷰할 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'nemoclaw',
      }, 'nemoclaw', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'nemoclaw.review',
      workerKind: 'nemoclaw',
      toolName: 'nemoclaw.review',
      goal: query,
      args,
      guildId,
    });
    if (delegated) {
      return delegated;
    }

    const code = typeof args?.code === 'string' ? args.code.trim() : '';

    // Try external NemoClaw sandbox review if available
    if (code) {
      const sandboxReview = await executeExternalAction('nemoclaw', 'code.review', { code, goal: query });
      if (sandboxReview.ok && sandboxReview.output.length > 0) {
        return withRouting({
          ok: true,
          name: 'nemoclaw.review',
          summary: 'NemoClaw sandbox 리뷰 완료',
          artifacts: [sandboxReview.output.join('\n')],
          verification: ['sandbox code.review executed', `adapter: nemoclaw, duration: ${sandboxReview.durationMs}ms`],
          agentRole: 'nemoclaw',
        }, 'nemoclaw', 'nemoclaw sandbox review completed');
      }
    }

    const discover = code
      ? runNemoClawDiscoverExecutor({ goal: query, actionName: 'nemoclaw.review', code })
      : null;
    const recommendation = recommendSuperAgent(createTaskInput({
      goal: query,
      guildId,
      args,
      requestedLeadAgent: 'NemoClaw',
    }));

    const findings: string[] = [];
    if (discover?.validationErrors.length) {
      findings.push(...discover.validationErrors.map((item) => `- high: ${item}`));
    }
    if (discover?.validationWarnings.length) {
      findings.push(...discover.validationWarnings.map((item) => `- medium: ${item}`));
    }
    if (findings.length === 0) {
      findings.push('- no critical findings identified');
    }

    const fallback = [
      '# Findings',
      ...findings,
      '',
      '# Review Context',
      `- risk_level: ${discover?.riskLevel || 'unknown'}`,
      `- required_gates: ${recommendation.route.required_gates.join(', ') || 'none'}`,
      `- next_action: ${recommendation.route.next_action}`,
      '',
      '# Open Questions',
      `- consult_agents: ${recommendation.route.consult_agents.map((item) => item.name).join(', ') || 'none'}`,
    ].join('\n');

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.nemoclaw.review',
      system: [
        '너는 NemoClaw 리뷰 에이전트다.',
        '출력은 Findings, Open Questions, Required Gates 순서만 사용한다.',
        '구체적 근거가 없으면 추정이라고 밝힌다.',
      ].join('\n'),
      user: [
        `목표: ${query}`,
        discover ? `정적 검증 결과: ${toJson(discover)}` : '정적 검증 결과: 없음',
        code ? `코드 스니펫:\n${clip(code, MAX_PROMPT_CODE_CHARS)}` : '코드 스니펫: 없음',
        `라우팅 정보:\n${renderRecommendation(recommendation)}`,
      ].join('\n\n'),
      fallback,
    });

    return withRouting({
      ok: discover ? discover.ok : true,
      name: 'nemoclaw.review',
      summary: discover?.ok === false ? 'NemoClaw 리뷰에서 차단 사유가 발견되었습니다.' : 'NemoClaw 리뷰 완료',
      artifacts: [clip(synthesized), discover ? clip(toJson(discover)) : clip(toJson(recommendation.route))],
      verification: [
        ...(discover ? ['sandbox validation executed'] : []),
        'nemoclaw review emitted',
      ],
      error: discover?.ok === false ? 'NEMOCLAW_REVIEW_BLOCKED' : undefined,
      agentRole: 'nemoclaw',
    }, 'nemoclaw', 'nemoclaw review completed', discover?.evidenceId || recommendation.route.mode);
  },
};

export const openjarvisOpsAction: ActionDefinition = {
  name: 'openjarvis.ops',
  description: 'OpenJarvis 역할로 운영 가드레일, readiness, rollback 관점의 실행안을 반환합니다.',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'openjarvis.ops',
        summary: '운영 검토 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'openjarvis.ops',
      workerKind: 'openjarvis',
      toolName: 'openjarvis.ops',
      goal: query,
      args,
      guildId,
    });
    if (delegated) {
      return delegated;
    }

    // Try external OpenJarvis adapter (jarvis serve API)
    const jarvisResult = await executeExternalAction('openjarvis', 'jarvis.ask', {
      question: `Ops review: ${query}`,
    });
    if (jarvisResult.ok && jarvisResult.output.length > 0) {
      return withRouting({
        ok: true,
        name: 'openjarvis.ops',
        summary: 'OpenJarvis 서버를 통한 운영 실행안 생성 완료',
        artifacts: [jarvisResult.output.join('\n')],
        verification: ['openjarvis adapter executed', `duration: ${jarvisResult.durationMs}ms`],
        agentRole: 'openjarvis',
      }, 'openjarvis', 'openjarvis adapter ops completed');
    }

    const resolvedGuildId = resolveGuildId(guildId, args);
    const recommendation = recommendSuperAgent(createTaskInput({
      goal: query,
      guildId: resolvedGuildId,
      args,
      requestedLeadAgent: 'OpenJarvis',
    }));

    let readinessArtifact = 'runtime_readiness=skipped';
    let readinessStatus = 'unknown';
    try {
      if (toBoolean(args?.includeReadiness, true)) {
        const readiness = await buildAgentRuntimeReadinessReport({
          guildId: resolvedGuildId,
          windowDays: Number(args?.windowDays || 30),
        });
        readinessStatus = String(readiness.decision || 'unknown');
        readinessArtifact = clip(toJson({
          decision: readiness.decision,
          failed_check_ids: readiness.failedCheckIds,
          metrics: readiness.metrics,
          failed_checks: readiness.checks.filter((item: { status: string }) => item.status === 'fail').slice(0, 5),
        }));
      }
    } catch (error) {
      readinessArtifact = `runtime_readiness_error=${clip(error instanceof Error ? error.message : String(error), 400)}`;
      readinessStatus = 'error';
    }

    const fallback = [
      '# Operations Route',
      `- mode: ${recommendation.route.mode}`,
      `- lead_agent: ${recommendation.route.lead_agent.name}`,
      `- required_gates: ${recommendation.route.required_gates.join(', ') || 'none'}`,
      '',
      '# Runtime Readiness',
      `- status: ${readinessStatus}`,
      '',
      '# Rollback And Guardrails',
      `- escalation_required: ${recommendation.route.escalation.required}`,
      `- escalation_reason: ${recommendation.route.escalation.reason}`,
      `- next_action: ${recommendation.route.next_action}`,
    ].join('\n');

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.openjarvis.ops',
      system: [
        '너는 OpenJarvis 운영 에이전트다.',
        '출력은 blast radius, guardrails, rollback, first-run metrics 순서로 정리한다.',
        '실행 불가능한 운영 권고는 쓰지 않는다.',
      ].join('\n'),
      user: [
        `목표: ${query}`,
        `라우팅 정보:\n${renderRecommendation(recommendation)}`,
        `런타임 readiness:\n${readinessArtifact}`,
      ].join('\n\n'),
      fallback,
    });

    return withRouting({
      ok: true,
      name: 'openjarvis.ops',
      summary: 'OpenJarvis 운영 실행안 생성 완료',
      artifacts: [clip(synthesized), readinessArtifact],
      verification: ['openjarvis ops plan emitted', 'runtime readiness consulted'],
      agentRole: 'openjarvis',
    }, 'openjarvis', 'openjarvis operations planning completed', recommendation.route.mode);
  },
};

// ──── Sprint Phase Actions ────────────────────────────────────────────────────

export const qaTestAction: ActionDefinition = {
  name: 'qa.test',
  description: 'QA 역할로 변경된 코드의 테스트를 실행하고 버그를 탐지/수정합니다.',
  deterministic: true,
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'qa.test',
        summary: 'QA 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'opencode',
      }, 'opencode', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.qa.test',
      system: [
        '너는 QA 리드 에이전트다.',
        '변경된 코드에 대해 테스트 대상을 식별하고, 테스트를 실행하고, 버그를 발견하면 수정 방안을 제시한다.',
        '각 버그에 대해 재현 경로를 포함한다.',
        '모든 테스트가 통과하면 명확히 보고한다.',
      ].join('\n'),
      user: `QA 대상: ${query}`,
      fallback: `# QA Report\n- target: ${query}\n- status: manual QA required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'qa.test',
      summary: 'QA 테스트 실행 완료',
      artifacts: [clip(synthesized)],
      verification: ['qa test report emitted'],
      agentRole: 'opencode',
    }, 'opencode', 'qa testing completed');
  },
};

export const csoAuditAction: ActionDefinition = {
  name: 'cso.audit',
  description: 'CSO 역할로 OWASP Top 10 + STRIDE 위협 모델링 보안 감사를 수행합니다.',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'cso.audit',
        summary: '보안 감사 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'nemoclaw',
      }, 'nemoclaw', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.cso.audit',
      system: [
        '너는 CSO(Chief Security Officer) 에이전트다.',
        'OWASP Top 10과 STRIDE 위협 모델을 기준으로 보안 감사를 수행한다.',
        '8/10 이상 신뢰도의 취약점만 보고한다.',
        '각 취약점에 구체적 공격 시나리오와 수정 방안을 포함한다.',
        '취약점이 없으면 "no findings above confidence threshold"를 명시한다.',
      ].join('\n'),
      user: `보안 감사 대상: ${query}`,
      fallback: `# Security Audit\n- target: ${query}\n- status: manual audit required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'cso.audit',
      summary: 'CSO 보안 감사 완료',
      artifacts: [clip(synthesized)],
      verification: ['cso security audit emitted'],
      agentRole: 'nemoclaw',
    }, 'nemoclaw', 'security audit completed');
  },
};

export const releaseShipAction: ActionDefinition = {
  name: 'release.ship',
  description: '릴리스 엔지니어 역할로 테스트 실행, 커버리지 확인, PR 생성을 수행합니다.',
  deterministic: true,
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'release.ship',
        summary: 'Ship 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'openjarvis',
      }, 'openjarvis', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.release.ship',
      system: [
        '너는 릴리스 엔지니어다.',
        '모든 게이트(테스트, 타입체크, 커버리지)를 확인하고 결과를 보고한다.',
        'PR 생성이 가능하면 PR 제목과 본문을 작성한다.',
        '실패한 게이트가 있으면 해당 phase로 복귀를 권고한다.',
      ].join('\n'),
      user: `Ship 대상: ${query}`,
      fallback: `# Ship Report\n- target: ${query}\n- status: manual ship required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'release.ship',
      summary: '릴리스 Ship 보고 완료',
      artifacts: [clip(synthesized)],
      verification: ['release ship report emitted'],
      agentRole: 'openjarvis',
    }, 'openjarvis', 'release ship completed');
  },
};

export const retroSummarizeAction: ActionDefinition = {
  name: 'retro.summarize',
  description: '회고 역할로 스프린트 결과를 요약하고 개선 사항을 도출합니다.',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: 'retro.summarize',
        summary: '회고 대상이 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'opendev',
      }, 'opendev', 'task validation failed');
    }

    const synthesized = await maybeGenerateRoleText({
      enabled: isAnyLlmConfigured(),
      actionName: 'action.retro.summarize',
      system: [
        '너는 스프린트 회고 에이전트다.',
        '완료된 스프린트의 결과를 요약하고 keep/stop/start 형식으로 교훈을 정리한다.',
        '반복 패턴을 식별하고 다음 스프린트에 대한 개선 사항을 제안한다.',
        '메트릭(변경 LOC, 테스트 수, phase 반복 횟수)을 포함한다.',
      ].join('\n'),
      user: `회고 대상: ${query}`,
      fallback: `# Sprint Retro\n- target: ${query}\n- status: manual retro required (LLM unavailable)`,
    });

    return withRouting({
      ok: true,
      name: 'retro.summarize',
      summary: '스프린트 회고 완료',
      artifacts: [clip(synthesized)],
      verification: ['retro summary emitted'],
      agentRole: 'opendev',
    }, 'opendev', 'sprint retro completed');
  },
};