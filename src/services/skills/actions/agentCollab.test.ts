import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recommendSuperAgentMock, startSuperAgentSessionFromTaskMock } = vi.hoisted(() => ({
  recommendSuperAgentMock: vi.fn(),
  startSuperAgentSessionFromTaskMock: vi.fn(),
}));

const { buildAgentRuntimeReadinessReportMock } = vi.hoisted(() => ({
  buildAgentRuntimeReadinessReportMock: vi.fn(),
}));

const { executeExternalActionMock } = vi.hoisted(() => ({
  executeExternalActionMock: vi.fn(),
}));

vi.mock('../../superAgentService', () => ({
  recommendSuperAgent: recommendSuperAgentMock,
  startSuperAgentSessionFromTask: startSuperAgentSessionFromTaskMock,
}));

vi.mock('../../agent/agentRuntimeReadinessService', () => ({
  buildAgentRuntimeReadinessReport: buildAgentRuntimeReadinessReportMock,
}));

vi.mock('../../tools/externalAdapterRegistry', () => ({
  executeExternalAction: executeExternalActionMock,
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
  jarvisResearchAction,
  jarvisDigestAction,
  jarvisMemoryIndexAction,
  jarvisMemorySearchAction,
  jarvisEvalAction,
  jarvisTelemetryAction,
  jarvisSchedulerListAction,
  jarvisSkillSearchAction,
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
    executeExternalActionMock.mockResolvedValue({
      ok: false, output: [], durationMs: 0, error: 'not configured',
    });
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
    expect(result.artifacts[1]).toContain('eval is not allowed');
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
    expect(getAction('nemoclaw.review')).not.toBeNull();
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

    it('returns ok with audit result when executed', async () => {
      const result = await csoAuditAction.execute({ goal: 'audit auth module', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('review');
      expect(result.artifacts.length).toBeGreaterThan(0);
      // Pipeline mode outputs "Security Pipeline Report", LLM-only mode outputs "Security Audit"
      const hasReport = result.artifacts[0].includes('Security Pipeline Report')
        || result.artifacts[0].includes('Security Audit');
      expect(hasReport).toBe(true);
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

    it('returns ok with quantitative fallback when LLM unavailable', async () => {
      const result = await retroSummarizeAction.execute({ goal: 'sprint-42 retro', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.agentRole).toBe('architect');
      expect(result.artifacts[0]).toContain('Sprint Retro (Quantitative)');
      expect(result.artifacts[0]).toContain('Keep');
      expect(result.artifacts[0]).toContain('Stop');
    });

    it('quantitative fallback includes phase data from args', async () => {
      const result = await retroSummarizeAction.execute({
        goal: 'sprint-99',
        guildId: 'g1',
        args: {
          sprintId: 'sprint-99',
          objective: 'Fix auth bug',
          changedFiles: ['src/auth.ts'],
          previousPhaseResults: [
            { phase: 'plan', status: 'success', output: 'planned' },
            { phase: 'implement', status: 'success', output: 'coded' },
            { phase: 'review', status: 'failed', output: 'type error found' },
          ],
        },
      });
      expect(result.ok).toBe(true);
      expect(result.artifacts[0]).toContain('succeeded: 2');
      expect(result.artifacts[0]).toContain('failed: 1');
      expect(result.artifacts[0]).toContain('src/auth.ts');
      expect(result.artifacts[0]).toContain('review');
    });

    it('is registered in the action registry', () => {
      expect(getAction('retro.summarize')).not.toBeNull();
      expect(getAction('summary.retro')).not.toBeNull();
    });
  });

  describe('sop.update', () => {
    it('is registered in the action registry', () => {
      expect(getAction('sop.update')).not.toBeNull();
      expect(getAction('knowledge.update')).not.toBeNull();
    });

    it('returns NO_LESSONS on empty input', async () => {
      const action = getAction('sop.update')!;
      const result = await action.execute({ goal: 'test', args: { lessons: [] }, guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('NO_LESSONS');
    });
  });
});

// ──── OpenJarvis Extended Actions ─────────────────────────────────────────────

describe('jarvis extended actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeExternalActionMock.mockResolvedValue({
      ok: true, output: ['result line 1'], durationMs: 42, error: null,
    });
  });

  describe('jarvis.research', () => {
    it('returns QUERY_EMPTY on empty goal', async () => {
      const result = await jarvisResearchAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('QUERY_EMPTY');
    });

    it('delegates to adapter and returns result', async () => {
      const result = await jarvisResearchAction.execute({ goal: 'AI safety trends', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(result.name).toBe('jarvis.research');
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.research', expect.objectContaining({ query: 'AI safety trends' }));
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.research')).not.toBeNull();
    });
  });

  describe('jarvis.digest', () => {
    it('delegates to adapter with default topic', async () => {
      const result = await jarvisDigestAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.digest', expect.objectContaining({ topic: 'daily briefing' }));
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.digest')).not.toBeNull();
    });
  });

  describe('jarvis.memory.index', () => {
    it('returns PATH_EMPTY on empty path', async () => {
      const result = await jarvisMemoryIndexAction.execute({ goal: '', args: {}, guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('PATH_EMPTY');
    });

    it('delegates to adapter with path', async () => {
      const result = await jarvisMemoryIndexAction.execute({ goal: '', args: { path: '/docs' }, guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.memory.index', { path: '/docs' });
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.memory.index')).not.toBeNull();
    });
  });

  describe('jarvis.memory.search', () => {
    it('returns QUERY_EMPTY on empty goal', async () => {
      const result = await jarvisMemorySearchAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('QUERY_EMPTY');
    });

    it('delegates to adapter and returns result', async () => {
      const result = await jarvisMemorySearchAction.execute({ goal: 'deployment rollback', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.memory.search', expect.objectContaining({ query: 'deployment rollback' }));
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.memory.search')).not.toBeNull();
    });
  });

  describe('jarvis.eval', () => {
    it('delegates to adapter with default dataset', async () => {
      const result = await jarvisEvalAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.eval', expect.objectContaining({ dataset: 'ipw_mixed' }));
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.eval')).not.toBeNull();
    });
  });

  describe('jarvis.telemetry', () => {
    it('delegates to adapter with default window', async () => {
      const result = await jarvisTelemetryAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.telemetry', { window: '1h' });
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.telemetry')).not.toBeNull();
    });
  });

  describe('jarvis.scheduler.list', () => {
    it('delegates to adapter', async () => {
      const result = await jarvisSchedulerListAction.execute({ goal: '', args: {}, guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.scheduler.list', {});
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.scheduler.list')).not.toBeNull();
    });
  });

  describe('jarvis.skill.search', () => {
    it('delegates to adapter', async () => {
      const result = await jarvisSkillSearchAction.execute({ goal: '', guildId: 'g1' });
      expect(result.ok).toBe(true);
      expect(executeExternalActionMock).toHaveBeenCalledWith('openjarvis', 'jarvis.skill.search', {});
    });

    it('is registered in the action registry', () => {
      expect(getAction('jarvis.skill.search')).not.toBeNull();
    });
  });
});