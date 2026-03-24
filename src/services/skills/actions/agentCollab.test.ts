import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recommendSuperAgentMock, startSuperAgentSessionFromTaskMock } = vi.hoisted(() => ({
  recommendSuperAgentMock: vi.fn(),
  startSuperAgentSessionFromTaskMock: vi.fn(),
}));

const { buildAgentRuntimeReadinessReportMock } = vi.hoisted(() => ({
  buildAgentRuntimeReadinessReportMock: vi.fn(),
}));

vi.mock('../../superAgentService', () => ({
  recommendSuperAgent: recommendSuperAgentMock,
  startSuperAgentSessionFromTask: startSuperAgentSessionFromTaskMock,
}));

vi.mock('../../agentRuntimeReadinessService', () => ({
  buildAgentRuntimeReadinessReport: buildAgentRuntimeReadinessReportMock,
}));

vi.mock('../../llmClient', () => ({
  isAnyLlmConfigured: vi.fn(() => false),
  generateText: vi.fn(),
}));

import {
  localOrchestratorAllAction,
  localOrchestratorRouteAction,
  nemoclawReviewAction,
  opendevPlanAction,
  openjarvisOpsAction,
  qaTestAction,
  csoAuditAction,
  releaseShipAction,
  retroSummarizeAction,
} from './agentCollab';
import { getAction } from './registry';

const recommendationFixture = {
  task: { task_id: 'task-1', guild_id: 'guild-1', objective: 'test objective' },
  route: {
    mode: 'local-collab',
    lead_agent: { name: 'Architect', reason: 'architecture-heavy objective' },
    consult_agents: [{ name: 'Review', reason: 'risk review', timing: 'during-review' }],
    required_gates: ['typecheck', 'tests'],
    handoff: {
      next_owner: 'Architect',
      reason: 'architecture first',
      expected_outcome: 'milestone plan',
    },
    escalation: {
      required: false,
      target_mode: 'local-collab',
      reason: 'not release-sensitive',
    },
    next_action: 'define milestones',
  },
  privacy_preflight: {
    decision: 'allow',
    deliberation_mode: 'direct',
    risk_score: 10,
    reasons: ['low_risk'],
    requires_human_review: false,
    blocked: false,
  },
  runtime_mapping: {
    supervisor_fields: {
      task_id: 'task-1',
      mode: 'local-collab',
    },
  },
};

describe('agentCollab actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recommendSuperAgentMock.mockReturnValue(recommendationFixture);
    startSuperAgentSessionFromTaskMock.mockResolvedValue({
      recommendation: recommendationFixture,
      session: { id: 'session-1', status: 'queued' },
    });
    buildAgentRuntimeReadinessReportMock.mockResolvedValue({
      decision: 'pass',
      summary: { overall: 'healthy' },
      checks: [{ id: 'ops-readiness', status: 'pass' }],
    });
  });

  it('local-orchestrator action returns structured route output', async () => {
    const result = await localOrchestratorRouteAction.execute({
      goal: '아키텍처와 구현 라우팅 정리',
      guildId: 'guild-1',
    });

    expect(result.ok).toBe(true);
    expect(result.agentRole).toBe('operate');
    expect(result.handoff?.toAgent).toBe('architect');
    expect(result.artifacts[0]).toContain('lead_agent: Architect');
  });

  it('local-orchestrator all executes lead and consult results with synthesis', async () => {
    const result = await localOrchestratorAllAction.execute({
      goal: 'ALL. 아키텍처, 리뷰, 운영까지 한 번에 합성',
      guildId: 'guild-1',
    });

    expect(result.ok).toBe(true);
    expect(result.agentRole).toBe('operate');
    expect(result.handoff?.toAgent).toBe('architect');
    expect(result.verification).toContain('lead executed:architect');
    expect(result.verification).toContain('consult executed:review');
    expect(result.artifacts[result.artifacts.length - 1]).toContain('# Synthesis');
  });

  it('opendev action emits planning artifact', async () => {
    const result = await opendevPlanAction.execute({
      goal: '서비스 경계와 마일스톤 계획 수립',
      guildId: 'guild-1',
    });

    expect(result.ok).toBe(true);
    expect(result.agentRole).toBe('architect');
    expect(result.artifacts[0]).toContain('# Current State');
  });

  it('nemoclaw action blocks invalid sandbox code', async () => {
    const result = await nemoclawReviewAction.execute({
      goal: '이 코드의 보안 리스크를 검토',
      guildId: 'guild-1',
      args: {
        code: "export const action = { name: 'demo.action', execute: async () => { eval('x'); } };",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.agentRole).toBe('review');
    expect(result.error).toBe('NEMOCLAW_REVIEW_BLOCKED');
    expect(result.artifacts[1]).toContain('eval() is not allowed');
  });

  it('openjarvis action includes runtime readiness artifact', async () => {
    const result = await openjarvisOpsAction.execute({
      goal: '운영 자동화와 롤백 준비 상태 점검',
      guildId: 'guild-1',
    });

    expect(result.ok).toBe(true);
    expect(result.agentRole).toBe('operate');
    expect(buildAgentRuntimeReadinessReportMock).toHaveBeenCalledTimes(1);
    expect(result.artifacts[1]).toContain('"decision": "pass"');
  });

  it('neutral alias actions are registered', async () => {
    expect(getAction('coordinate.route')).not.toBeNull();
    expect(getAction('architect.plan')).not.toBeNull();
    expect(getAction('review.review')).not.toBeNull();
    expect(getAction('operate.ops')).not.toBeNull();
    expect(getAction('implement.execute')).not.toBeNull();
  });
});

// ──── Sprint Phase Actions ────────────────────────────────────────────────────

describe('sprint phase actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('qa.test', () => {
    it('returns OBJECTIVE_EMPTY on empty goal', async () => {
      const result = await qaTestAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('OBJECTIVE_EMPTY');
      expect(result.agentRole).toBe('implement');
    });

    it('returns ok with fallback text when LLM unavailable', async () => {
      const result = await qaTestAction.execute({ goal: 'test sprint changes', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('implement');
      expect(result.artifacts[0]).toContain('QA Report');
      expect(result.artifacts[0]).toContain('manual QA required');
    });

    it('is deterministic', () => {
      expect(qaTestAction.deterministic).toBe(true);
    });

    it('is registered in the action registry', () => {
      expect(getAction('qa.test')).not.toBeNull();
      expect(getAction('test.qa')).not.toBeNull();
    });
  });

  describe('cso.audit', () => {
    it('returns OBJECTIVE_EMPTY on empty goal', async () => {
      const result = await csoAuditAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('OBJECTIVE_EMPTY');
      expect(result.agentRole).toBe('review');
    });

    it('returns ok with fallback text when LLM unavailable', async () => {
      const result = await csoAuditAction.execute({ goal: 'audit auth module', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('review');
      expect(result.artifacts[0]).toContain('Security Audit');
      expect(result.artifacts[0]).toContain('manual audit required');
    });

    it('is registered in the action registry', () => {
      expect(getAction('cso.audit')).not.toBeNull();
      expect(getAction('security.audit')).not.toBeNull();
    });
  });

  describe('release.ship', () => {
    it('returns OBJECTIVE_EMPTY on empty goal', async () => {
      const result = await releaseShipAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('OBJECTIVE_EMPTY');
      expect(result.agentRole).toBe('operate');
    });

    it('returns ok with fallback text when LLM unavailable', async () => {
      const result = await releaseShipAction.execute({ goal: 'ship v2.1.0', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('operate');
      expect(result.artifacts[0]).toContain('Ship Report');
      expect(result.artifacts[0]).toContain('manual ship required');
    });

    it('is deterministic', () => {
      expect(releaseShipAction.deterministic).toBe(true);
    });

    it('is registered in the action registry', () => {
      expect(getAction('release.ship')).not.toBeNull();
      expect(getAction('ship.release')).not.toBeNull();
    });
  });

  describe('retro.summarize', () => {
    it('returns OBJECTIVE_EMPTY on empty goal', async () => {
      const result = await retroSummarizeAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('OBJECTIVE_EMPTY');
      expect(result.agentRole).toBe('architect');
    });

    it('returns ok with fallback text when LLM unavailable', async () => {
      const result = await retroSummarizeAction.execute({ goal: 'sprint-42 retro', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('architect');
      expect(result.artifacts[0]).toContain('Sprint Retro');
      expect(result.artifacts[0]).toContain('manual retro required');
    });

    it('is registered in the action registry', () => {
      expect(getAction('retro.summarize')).not.toBeNull();
      expect(getAction('summary.retro')).not.toBeNull();
    });
  });
});