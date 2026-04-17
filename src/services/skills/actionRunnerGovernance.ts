import { createActionApprovalRequest, getGuildActionPolicy, type ActionApprovalRequest, type GuildActionPolicy } from './actionGovernanceStore';
import { HIGH_RISK_APPROVAL_ACTIONS } from './actionRunnerConfig';
import logger from '../../logger';
import { getErrorMessage } from '../../utils/errorMessage';

export type GovernanceGateBlock = {
  proceed: false;
  handledAny: boolean;
  lineStatus: string;
  summary: string;
  artifacts: string[];
  verification: string[];
  error: 'ACTION_POLICY_UNAVAILABLE' | 'ACTION_DISABLED_BY_POLICY' | 'ACTION_APPROVAL_REQUIRED';
};

export type GovernanceGateResult =
  | { proceed: true }
  | GovernanceGateBlock;

export type GovernanceGateDeps = {
  getGuildActionPolicy?: typeof getGuildActionPolicy;
  createActionApprovalRequest?: typeof createActionApprovalRequest;
};

const buildBlockedResult = (params: {
  handledAny: boolean;
  lineStatus: string;
  summary: string;
  artifacts?: string[];
  verification: string[];
  error: GovernanceGateBlock['error'];
}): GovernanceGateBlock => ({
  proceed: false,
  handledAny: params.handledAny,
  lineStatus: params.lineStatus,
  summary: params.summary,
  artifacts: [...(params.artifacts || [])],
  verification: [...params.verification],
  error: params.error,
});

const isAutoApprovalRequired = (actionName: string, requestedBy: string): boolean => {
  return actionName === 'privacy.forget.guild' && !String(requestedBy || '').startsWith('system:');
};

const resolveEffectiveRunMode = (params: {
  actionName: string;
  requestedBy: string;
  governance: Pick<GuildActionPolicy, 'runMode'>;
}): 'auto' | 'approval_required' | 'disabled' => {
  const autoApprovalRequired = isAutoApprovalRequired(params.actionName, params.requestedBy);
  const highRiskActionGuard = HIGH_RISK_APPROVAL_ACTIONS.has(params.actionName) && params.governance.runMode === 'auto';
  if (autoApprovalRequired || highRiskActionGuard) {
    return 'approval_required';
  }
  return params.governance.runMode;
};

const buildApprovalReason = (params: {
  actionName: string;
  requestedBy: string;
  governance: Pick<GuildActionPolicy, 'runMode'>;
}): string => {
  if (isAutoApprovalRequired(params.actionName, params.requestedBy)) {
    return 'high-risk action guard: privacy.forget.guild';
  }
  if (HIGH_RISK_APPROVAL_ACTIONS.has(params.actionName) && params.governance.runMode === 'auto') {
    return `high-risk action guard: ${params.actionName}`;
  }
  return 'action policy run_mode=approval_required';
};

export const evaluateActionGovernanceGate = async (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  actionName: string;
  actionArgs: Record<string, unknown>;
  fastPath: boolean;
}, deps: GovernanceGateDeps = {}): Promise<GovernanceGateResult> => {
  if (params.fastPath) {
    return { proceed: true };
  }

  const getGuildActionPolicyFn = deps.getGuildActionPolicy ?? getGuildActionPolicy;
  const createActionApprovalRequestFn = deps.createActionApprovalRequest ?? createActionApprovalRequest;

  let governance: GuildActionPolicy;
  try {
    governance = await getGuildActionPolicyFn(params.guildId, params.actionName);
  } catch (err) {
    logger.warn(
      '[ACTION-RUNNER] action-governance failed action=%s guildId=%s: %s',
      params.actionName,
      params.guildId,
      getErrorMessage(err),
    );
    return buildBlockedResult({
      handledAny: false,
      lineStatus: '상태: 실패 (ACTION_POLICY_UNAVAILABLE)',
      summary: '길드 액션 정책 조회 실패로 실행이 차단되었습니다.',
      verification: ['tenant action policy unavailable'],
      error: 'ACTION_POLICY_UNAVAILABLE',
    });
  }

  if (!governance.enabled || governance.runMode === 'disabled') {
    return buildBlockedResult({
      handledAny: false,
      lineStatus: '상태: 실패 (ACTION_DISABLED_BY_POLICY)',
      summary: '길드 액션 정책에서 비활성화된 액션입니다.',
      verification: ['tenant action policy disabled'],
      error: 'ACTION_DISABLED_BY_POLICY',
    });
  }

  const effectiveRunMode = resolveEffectiveRunMode({
    actionName: params.actionName,
    requestedBy: params.requestedBy,
    governance,
  });
  if (effectiveRunMode !== 'approval_required') {
    return { proceed: true };
  }

  const request: ActionApprovalRequest = await createActionApprovalRequestFn({
    guildId: params.guildId,
    requestedBy: params.requestedBy,
    goal: params.goal,
    actionName: params.actionName,
    actionArgs: params.actionArgs || {},
    reason: buildApprovalReason({
      actionName: params.actionName,
      requestedBy: params.requestedBy,
      governance,
    }),
  });

  return buildBlockedResult({
    handledAny: true,
    lineStatus: `상태: 승인 대기 (requestId=${request.id})`,
    summary: '승인 게이트에 의해 실행이 보류되었습니다.',
    artifacts: [request.id],
    verification: ['tenant action policy approval_required'],
    error: 'ACTION_APPROVAL_REQUIRED',
  });
};