/**
 * Lead agent role actions — opendev.plan, review.review, openjarvis.ops.
 * Extracted from agentCollab.ts for domain-scoped cohesion.
 */
import { buildAgentRuntimeReadinessReport } from '../../agent/agentRuntimeReadinessService';
import { isAnyLlmConfigured } from '../../llmClient';
import { recommendSuperAgent } from '../../superAgentService';
import { runNemoClawDiscoverExecutor } from '../../workerGeneration/workerExecutors';
import { runExternalAction } from '../../tools/toolRouter';
import type { ActionDefinition } from './types';
import {
  compact,
  clip,
  toBoolean,
  toJson,
  resolveGoal,
  resolveGuildId,
  createTaskInput,
  withRouting,
  renderRecommendation,
  maybeGenerateRoleText,
  maybeDelegateAgentAction,
  MAX_PROMPT_CODE_CHARS,
} from './agentCollabHelpers';
import { getErrorMessage } from '../../../utils/errorMessage';

export const opendevPlanAction: ActionDefinition = {
  name: 'opendev.plan',
  description: 'OpenDev 역할로 목표를 아키텍처/계획/게이트 관점의 실행안으로 정리합니다.',
  category: 'agent',
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
        agentRole: 'architect',
      }, 'architect', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'opendev.plan',
      workerKind: 'architect',
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
      requestedLeadAgent: 'Architect',
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
      '# Ideal State Criteria',
      `- [ ] Objective fully addressed: ${query.slice(0, 80)}`,
      `- [ ] All required gates pass: ${recommendation.route.required_gates.join(', ') || 'none'}`,
      `- [ ] No regression in existing test suite`,
      `- [ ] Changed files ≤ SPRINT_CHANGED_FILE_CAP`,
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
        '출력은 현재 상태, 목표 상태, 이상 상태 기준, 마일스톤, 리스크 순서로 간결하게 정리한다.',
        '과장 없이 실행 가능한 단계만 제안한다.',
        '',
        '## Ideal State Criteria 작성 규칙',
        '목표를 8~12단어 이내의 개별 기준으로 역분해한다.',
        '각 기준은 이진(pass/fail) 평가가 가능해야 한다.',
        '`- [ ]` 체크박스 형태로 나열한다.',
        '기준 수는 3~8개 사이로 유지한다.',
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
      agentRole: 'architect',
    }, 'architect', 'opendev planning completed', recommendation.route.mode);
  },
};

const REVIEW_ACTION_NAME = 'review.review';

export const reviewReviewAction: ActionDefinition = {
  name: REVIEW_ACTION_NAME,
  description: 'Review 역할로 목표나 코드 스니펫을 검토하고 리스크와 테스트 갭을 반환합니다. 필요하면 NemoClaw sandbox를 보조로 사용합니다.',
  category: 'agent',
  execute: async ({ goal, args, guildId }) => {
    const query = resolveGoal(goal, args);
    if (!query) {
      return withRouting({
        ok: false,
        name: REVIEW_ACTION_NAME,
        summary: '리뷰할 objective가 비어 있습니다.',
        artifacts: [],
        verification: ['objective required'],
        error: 'OBJECTIVE_EMPTY',
        agentRole: 'review',
      }, 'review', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: REVIEW_ACTION_NAME,
      workerKind: 'review',
      toolName: REVIEW_ACTION_NAME,
      goal: query,
      args,
      guildId,
    });
    if (delegated) {
      return delegated;
    }

    const code = typeof args?.code === 'string' ? args.code.trim() : '';

    // Try the external review sandbox if available
    if (code) {
      const sandboxReview = await runExternalAction('review', 'code.review', { code, goal: query });
      if (sandboxReview.ok && sandboxReview.output.length > 0) {
        return withRouting({
          ok: true,
          name: REVIEW_ACTION_NAME,
          summary: 'Review sandbox 리뷰 완료',
          artifacts: [sandboxReview.output.join('\n')],
          verification: ['sandbox code.review executed', `adapter: review, duration: ${sandboxReview.durationMs}ms`],
          agentRole: 'review',
        }, 'review', 'review sandbox completed');
      }
    }

    const discover = code
      ? runNemoClawDiscoverExecutor({ goal: query, actionName: REVIEW_ACTION_NAME, code })
      : null;
    const recommendation = recommendSuperAgent(createTaskInput({
      goal: query,
      guildId,
      args,
      requestedLeadAgent: 'Review',
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
      actionName: 'action.review.review',
      system: [
        '너는 Review 에이전트다.',
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
      name: REVIEW_ACTION_NAME,
      summary: discover?.ok === false ? 'Review에서 차단 사유가 발견되었습니다.' : 'Review 완료',
      artifacts: [clip(synthesized), discover ? clip(toJson(discover)) : clip(toJson(recommendation.route))],
      verification: [
        ...(discover ? ['sandbox validation executed'] : []),
        'review emitted',
      ],
      error: discover?.ok === false ? 'NEMOCLAW_REVIEW_BLOCKED' : undefined,
      agentRole: 'review',
    }, 'review', 'review completed', discover?.evidenceId || recommendation.route.mode);
  },
};

export const nemoclawReviewAction: ActionDefinition = reviewReviewAction;

export const openjarvisOpsAction: ActionDefinition = {
  name: 'openjarvis.ops',
  description: 'OpenJarvis 역할로 운영 가드레일, readiness, rollback 관점의 실행안을 반환합니다.',
  category: 'agent',
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
        agentRole: 'operate',
      }, 'operate', 'task validation failed');
    }

    const delegated = await maybeDelegateAgentAction({
      actionName: 'openjarvis.ops',
      workerKind: 'operate',
      toolName: 'openjarvis.ops',
      goal: query,
      args,
      guildId,
    });
    if (delegated) {
      return delegated;
    }

    // Try external OpenJarvis adapter (jarvis serve API)
    const jarvisResult = await runExternalAction('openjarvis', 'jarvis.ask', {
      question: `Ops review: ${query}`,
      agent: 'orchestrator',
    });
    if (jarvisResult.ok && jarvisResult.output.length > 0) {
      return withRouting({
        ok: true,
        name: 'openjarvis.ops',
        summary: 'OpenJarvis 서버를 통한 운영 실행안 생성 완료',
        artifacts: [jarvisResult.output.join('\n')],
        verification: ['openjarvis adapter executed', `duration: ${jarvisResult.durationMs}ms`],
        agentRole: 'operate',
      }, 'operate', 'openjarvis adapter ops completed');
    }

    const resolvedGId = resolveGuildId(guildId, args);
    const recommendation = recommendSuperAgent(createTaskInput({
      goal: query,
      guildId: resolvedGId,
      args,
      requestedLeadAgent: 'Operate',
    }));

    let readinessArtifact = 'runtime_readiness=skipped';
    let readinessStatus = 'unknown';
    try {
      if (toBoolean(args?.includeReadiness, true)) {
        const readiness = await buildAgentRuntimeReadinessReport({
          guildId: resolvedGId,
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
      readinessArtifact = `runtime_readiness_error=${clip(getErrorMessage(error), 400)}`;
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
      agentRole: 'operate',
    }, 'operate', 'openjarvis operations planning completed', recommendation.route.mode);
  },
};
