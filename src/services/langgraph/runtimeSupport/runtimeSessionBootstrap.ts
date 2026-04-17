import crypto from 'crypto';

import { getWorkflowStepTemplates, primeWorkflowProfileCache } from '../../agent/agentWorkflowService';
import type { AgentDeliberationMode, AgentPriority } from '../../agent/agentRuntimeTypes';
import type { AgentSession } from '../../multiAgentTypes';
import type { SkillId } from '../../skills/types';

const buildDefaultPolicyGate = (deliberationMode: AgentDeliberationMode | undefined) => {
  return deliberationMode === 'guarded'
    ? { decision: 'review' as const, reasons: ['privacy_guarded_default'] }
    : { decision: 'allow' as const, reasons: ['legacy_default'] };
};

export const resolveSessionDeliberationDefaults = (
  deliberationMode: AgentDeliberationMode | undefined,
): Pick<AgentSession, 'riskScore' | 'policyGate'> => {
  return {
    riskScore: deliberationMode === 'guarded' ? 55 : 0,
    policyGate: buildDefaultPolicyGate(deliberationMode),
  };
};

export const normalizeAgentPriority = (value?: string | null): AgentPriority => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fast' || normalized === '빠름') {
    return 'fast';
  }
  if (normalized === 'precise' || normalized === '정밀') {
    return 'precise';
  }
  return 'balanced';
};

export const buildInitialSessionSteps = (params: {
  guildId: string;
  requestedSkillId: SkillId | null;
  priority: AgentPriority;
  timestamp: string;
}): AgentSession['steps'] => {
  const { guildId, requestedSkillId, priority, timestamp } = params;
  primeWorkflowProfileCache();
  const templates = getWorkflowStepTemplates({
    guildId,
    priority,
    hasRequestedSkill: Boolean(requestedSkillId),
  });

  return templates.map((template) => {
    const cancelled = Boolean(
      (priority === 'fast' && template.skipWhenFast)
      || (requestedSkillId && template.skipWhenRequestedSkill),
    );
    return {
      id: crypto.randomUUID(),
      role: template.role,
      title: requestedSkillId && template.role === 'planner'
        ? `스킬 실행: ${requestedSkillId}`
        : template.title,
      status: cancelled ? 'cancelled' : 'pending',
      startedAt: null,
      endedAt: cancelled ? timestamp : null,
      output: null,
      error: null,
    };
  });
};

export const createQueuedSession = (params: {
  guildId: string;
  requestedBy: string;
  goal: string;
  requestedSkillId: SkillId | null;
  priority: AgentPriority;
  timestamp: string;
  deliberationMode?: AgentDeliberationMode;
}): AgentSession => {
  const {
    guildId,
    requestedBy,
    goal,
    requestedSkillId,
    priority,
    timestamp,
    deliberationMode,
  } = params;
  const deliberationDefaults = resolveSessionDeliberationDefaults(deliberationMode);
  return {
    id: crypto.randomUUID(),
    guildId,
    requestedBy,
    goal: goal.trim(),
    conversationThreadId: null,
    conversationTurnIndex: null,
    priority,
    requestedSkillId,
    routedIntent: 'task',
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
    cancelRequested: false,
    trafficRoute: 'main',
    trafficRoutingDecision: null,
    trafficRouteResolvedAt: null,
    executionEngine: 'main',
    graphCheckpoint: null,
    hitlState: null,
    deliberationMode,
    riskScore: deliberationDefaults.riskScore,
    policyGate: deliberationDefaults.policyGate,
    personalization: undefined,
    memoryHints: [],
    steps: buildInitialSessionSteps({
      guildId,
      requestedSkillId,
      priority,
      timestamp,
    }),
    shadowGraph: null,
  };
};