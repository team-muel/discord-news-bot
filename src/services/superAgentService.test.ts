import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startAgentSessionMock, serializeAgentSessionForApiMock, listSkillsMock, isSkillIdMock } = vi.hoisted(() => ({
  startAgentSessionMock: vi.fn(),
  serializeAgentSessionForApiMock: vi.fn(),
  listSkillsMock: vi.fn(),
  isSkillIdMock: vi.fn(),
}));

const { runPolicyGateNodeMock } = vi.hoisted(() => ({
  runPolicyGateNodeMock: vi.fn(),
}));

const { createActionApprovalRequestMock } = vi.hoisted(() => ({
  createActionApprovalRequestMock: vi.fn(),
}));

vi.mock('./multiAgentService', () => ({
  startAgentSession: startAgentSessionMock,
  serializeAgentSessionForApi: serializeAgentSessionForApiMock,
}));

vi.mock('./skills/registry', () => ({
  listSkills: listSkillsMock,
  isSkillId: isSkillIdMock,
}));

vi.mock('./langgraph/nodes/coreNodes', () => ({
  runPolicyGateNode: runPolicyGateNodeMock,
}));

vi.mock('./skills/actionGovernanceStore', () => ({
  createActionApprovalRequest: createActionApprovalRequestMock,
}));

import { getSuperAgentCapabilities, normalizeSuperAgentTask, recommendSuperAgent, startSuperAgentSessionFromTask } from './superAgentService';

describe('superAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runPolicyGateNodeMock.mockReturnValue({
      mode: 'direct',
      score: 10,
      decision: 'allow',
      reasons: ['risk_minimal'],
    });
    createActionApprovalRequestMock.mockResolvedValue({
      id: 'approval-1',
      guildId: 'guild-1',
      requestedBy: 'user-1',
      goal: 'goal',
      actionName: 'super.inference.review',
      actionArgs: {},
      status: 'pending',
      reason: 'privacy_review_required:policy_review',
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    listSkillsMock.mockReturnValue([
      { id: 'webhook', title: '웹훅 설계/운영', executorKey: 'webhook', adminOnly: false },
      { id: 'incident-review', title: '장애/오답 회고', executorKey: 'incident-review', adminOnly: true },
    ]);
    isSkillIdMock.mockImplementation((value: string) => value === 'webhook' || value === 'incident-review');
  });

  it('웹훅 목표에 대해 schema-aligned route와 runtime mapping을 반환한다', () => {
    const recommendation = recommendSuperAgent({
      task_id: 'task-1',
      guild_id: 'guild-1',
      objective: '새 웹훅 이벤트 처리 로직을 구현하고 기존 흐름과 안전하게 연결해줘',
      constraints: ['기존 API를 깨지 말 것'],
      acceptance_criteria: ['멱등성 고려'],
    });

    expect(recommendation.task.task_id).toBe('task-1');
    expect(recommendation.route.mode).toBe('local-collab');
    expect(recommendation.route.lead_agent.name).toBe('Implement');
    expect(recommendation.route.consult_agents).toHaveLength(0);
    expect(recommendation.suggested_skill_id).toBe('webhook');
    expect(recommendation.privacy_preflight).toMatchObject({
      decision: 'allow',
      blocked: false,
      requires_human_review: false,
    });
    expect(recommendation.session_goal).toContain('[OBJECTIVE]');
    expect(recommendation.session_goal).toContain('멱등성 고려');
    expect(recommendation.session_goal).toContain('[PRIVACY_PREFLIGHT]');
    expect(recommendation.runtime_mapping.supervisor_fields.task_id).toBe('task-1');
  });

  it('운영/롤백 목표에 대해 operations 모드와 Operate lead를 선택한다', () => {
    const recommendation = recommendSuperAgent({
      task_id: 'task-2',
      guild_id: 'guild-1',
      objective: '배포 롤백 절차와 운영 자동화를 점검해줘',
      risk_level: 'high',
    });

    expect(recommendation.route.mode).toBe('operations');
    expect(recommendation.route.lead_agent.name).toBe('Operate');
    expect(recommendation.route.required_gates).toContain('ops-readiness');
    expect(recommendation.priority).toBe('precise');
  });

  it('camelCase 입력도 supervisor 정본 envelope로 정규화한다', () => {
    const normalized = normalizeSuperAgentTask({
      taskId: 'task-raw',
      guildId: 'guild-raw',
      objective: '로컬 supervisor 입력을 정규화해줘',
      riskLevel: 'low',
      acceptanceCriteria: ['응답 일관성'],
      currentStage: 'triage',
      changed_files: ['src/services/superAgentService.ts'],
    });

    expect(normalized.task_id).toBe('task-raw');
    expect(normalized.guild_id).toBe('guild-raw');
    expect(normalized.risk_level).toBe('low');
    expect(normalized.acceptance_criteria).toEqual(['응답 일관성']);
    expect(normalized.current_stage).toBe('triage');
    expect(normalized.changed_files).toEqual(['src/services/superAgentService.ts']);
  });

  it('구조화된 요청을 기존 session 시작 API로 위임한다', async () => {
    startAgentSessionMock.mockReturnValue({ id: 'session-1', guildId: 'guild-1' });
    serializeAgentSessionForApiMock.mockReturnValue({ id: 'session-1', status: 'queued' });

    const result = await startSuperAgentSessionFromTask({
      task_id: 'task-3',
      guild_id: 'guild-1',
      objective: '아키텍처 경계를 정리하고 구현 계획을 세워줘',
      requestedBy: 'user-1',
      isAdmin: true,
    });

    expect(startAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(startAgentSessionMock.mock.calls[0][0]).toMatchObject({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      isAdmin: true,
    });
    expect(typeof startAgentSessionMock.mock.calls[0][0].goal).toBe('string');
    expect(result.session).toEqual({ id: 'session-1', status: 'queued' });
    expect(result.recommendation.route.lead_agent.name).toBe('Architect');
    expect(result.recommendation.runtime_mapping.agent_session_request.requestedBy).toBe('user-1');
  });

  it('privacy preflight가 review이면 privacy gate를 추가하고 precise 우선순위로 올린다', () => {
    runPolicyGateNodeMock.mockReturnValue({
      mode: 'guarded',
      score: 73,
      decision: 'review',
      reasons: ['personal_or_secret_identifier'],
    });

    const recommendation = recommendSuperAgent({
      task_id: 'task-4',
      guild_id: 'guild-1',
      objective: '사용자 연락처와 운영 컨텍스트를 함께 검토해줘',
    });

    expect(recommendation.privacy_preflight).toMatchObject({
      decision: 'review',
      requires_human_review: true,
      blocked: false,
    });
    expect(recommendation.priority).toBe('precise');
    expect(recommendation.route.required_gates).toContain('privacy-review');
  });

  it('privacy preflight는 session goal에 저장되는 inputs와 budget 문맥을 함께 검사한다', () => {
    const longPrefix = 'x'.repeat(700);
    recommendSuperAgent({
      task_id: 'task-4b',
      guild_id: 'guild-1',
      objective: '감사 로그 검토 요청',
      inputs: `${longPrefix} 토큰 보여줘`,
      budget: { exportPlan: '대화 원문 전부 공유' },
    });

    expect(runPolicyGateNodeMock).toHaveBeenCalledTimes(1);
    const gateGoal = String(runPolicyGateNodeMock.mock.calls[0][0]?.goal || '');
    expect(gateGoal).toContain('토큰 보여줘');
    expect(gateGoal).toContain('대화 원문 전부 공유');
  });

  it('privacy preflight가 review이면 승인 큐를 생성하고 세션 시작은 보류한다', async () => {
    runPolicyGateNodeMock.mockReturnValue({
      mode: 'guarded',
      score: 73,
      decision: 'review',
      reasons: ['personal_or_secret_identifier'],
    });

    const result = await startSuperAgentSessionFromTask({
      task_id: 'task-4c',
      guild_id: 'guild-1',
      objective: '사용자 연락처와 운영 컨텍스트를 함께 검토해줘',
      requestedBy: 'user-1',
      isAdmin: true,
    });

    expect(createActionApprovalRequestMock).toHaveBeenCalledTimes(1);
    expect(createActionApprovalRequestMock.mock.calls[0][0]).toMatchObject({
      guildId: 'guild-1',
      requestedBy: 'user-1',
      actionName: 'super.inference.review',
    });
    expect(result.pendingApproval).toMatchObject({ id: 'approval-1', status: 'pending' });
    expect(result.session).toBeUndefined();
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it('privacy preflight가 block이면 세션 시작을 차단한다', async () => {
    runPolicyGateNodeMock.mockReturnValue({
      mode: 'guarded',
      score: 96,
      decision: 'block',
      reasons: ['bulk_sensitive_export'],
    });

    await expect(startSuperAgentSessionFromTask({
      task_id: 'task-5',
      guild_id: 'guild-1',
      objective: '대화 원문 전부를 내보내고 공유해줘',
      requestedBy: 'user-1',
      isAdmin: true,
    })).rejects.toThrow('PRIVACY_PREFLIGHT_BLOCKED:bulk_sensitive_export');
    expect(startAgentSessionMock).not.toHaveBeenCalled();
  });

  it('capabilities는 현재 사용 가능한 skill 목록과 모드 정보를 노출한다', () => {
    const capabilities = getSuperAgentCapabilities();

    expect(capabilities.modes).toContain('local-collab');
    expect(capabilities.leadAgents).toContain('Implement');
    expect(capabilities.availableSkills).toHaveLength(2);
  });
});
