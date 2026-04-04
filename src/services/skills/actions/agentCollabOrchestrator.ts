/**
 * Orchestrator actions — local.orchestrator.route and local.orchestrator.all.
 * Extracted from agentCollab.ts for domain-scoped cohesion.
 */
import { isAnyLlmConfigured } from '../../llmClient';
import {
  recommendSuperAgent,
  startSuperAgentSessionFromTask,
} from '../../superAgentService';
import { opencodeExecuteAction } from './opencode';
import type { ActionDefinition, ActionExecutionResult, AgentRoleName } from './types';
import {
  compact,
  clip,
  toBoolean,
  toJson,
  resolveGoal,
  createTaskInput,
  leadAgentToRole,
  roleToLeadAgent,
  withRouting,
  renderRecommendation,
  maybeGenerateRoleText,
  maybeDelegateAgentAction,
} from './agentCollabHelpers';

// Forward-declared to avoid circular import — bound lazily at first call.
let _opendevPlanAction: ActionDefinition | null = null;
let _nemoclawReviewAction: ActionDefinition | null = null;
let _openjarvisOpsAction: ActionDefinition | null = null;

const getRoleActions = async () => {
  if (!_opendevPlanAction) {
    const mod = await import('./agentCollabRoles');
    _opendevPlanAction = mod.opendevPlanAction;
    _nemoclawReviewAction = mod.nemoclawReviewAction;
    _openjarvisOpsAction = mod.openjarvisOpsAction;
  }
  return { opendevPlanAction: _opendevPlanAction!, nemoclawReviewAction: _nemoclawReviewAction!, openjarvisOpsAction: _openjarvisOpsAction! };
};

const executeRoleAction = async (params: {
  role: AgentRoleName;
  goal: string;
  guildId?: string;
  requestedBy?: string;
  args?: Record<string, unknown>;
}): Promise<ActionExecutionResult> => {
  const actionArgs = { ...(params.args || {}) };
  if (params.role === 'implement' && typeof actionArgs.task !== 'string') {
    actionArgs.task = params.goal;
  }

  if (params.role === 'implement') {
    return opencodeExecuteAction.execute({
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      args: actionArgs,
    });
  }

  const { opendevPlanAction, nemoclawReviewAction, openjarvisOpsAction } = await getRoleActions();

  if (params.role === 'architect') {
    return opendevPlanAction.execute({
      goal: params.goal,
      guildId: params.guildId,
      requestedBy: params.requestedBy,
      args: actionArgs,
    });
  }
  if (params.role === 'review') {
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
  role: AgentRoleName;
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
  consultResults: Array<{ role: AgentRoleName; result: ActionExecutionResult }>;
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
        agentRole: 'operate',
      }, 'operate', 'task validation failed');
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
          agentRole: 'operate',
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
        agentRole: 'operate',
      }, leadRole, 'local orchestrator selected next owner', recommendation.route.mode);
    } catch (error) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.route',
        summary: 'local-orchestrator 라우팅 생성에 실패했습니다.',
        artifacts: [clip(error instanceof Error ? error.message : String(error), 400)],
        verification: ['super-agent routing failed'],
        error: 'LOCAL_ORCHESTRATOR_ROUTE_FAILED',
        agentRole: 'operate',
      }, 'operate', 'local orchestrator routing failed');
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
        agentRole: 'operate',
      }, 'operate', 'task validation failed');
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
        agentRole: 'operate',
      }, leadRole, 'local orchestrator full collaboration completed', recommendation.route.mode);
    } catch (error) {
      return withRouting({
        ok: false,
        name: 'local.orchestrator.all',
        summary: 'local-orchestrator 전체 협업 실행에 실패했습니다.',
        artifacts: [clip(error instanceof Error ? error.message : String(error), 400)],
        verification: ['local orchestrator full collaboration failed'],
        error: 'LOCAL_ORCHESTRATOR_ALL_FAILED',
        agentRole: 'operate',
      }, 'operate', 'local orchestrator full collaboration failed');
    }
  },
};
