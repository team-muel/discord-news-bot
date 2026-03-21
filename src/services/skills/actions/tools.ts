import { executeToolByName, getToolRuntimeStatus } from '../../tools/toolRouter';
import type { ActionDefinition, ActionExecutionResult } from './types';

const MAX_GOAL_LENGTH = 2_400;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const withOpenjarvisRouting = (
  result: ActionExecutionResult,
  reason: string,
  evidenceId?: string,
): ActionExecutionResult => {
  return {
    ...result,
    agentRole: 'openjarvis',
    handoff: {
      fromAgent: 'openjarvis',
      toAgent: 'openjarvis',
      reason,
      evidenceId,
    },
  };
};

export const toolsRunCliAction: ActionDefinition = {
  name: 'tools.run.cli',
  description: '환경변수로 등록된 단일 로컬 CLI 도구를 안전한 인자 템플릿으로 실행합니다.',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const trimmedGoal = String(goal || '').trim();
    const toolName = toSingleLine(args?.toolName || args?.name || '');

    if (!trimmedGoal) {
      return withOpenjarvisRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: '실행할 goal이 비어 있습니다.',
        artifacts: [],
        verification: ['goal input required'],
        error: 'TOOLS_RUN_CLI_GOAL_EMPTY',
      }, 'goal validation failed');
    }

    if (trimmedGoal.length > MAX_GOAL_LENGTH) {
      return withOpenjarvisRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: `goal 길이가 너무 깁니다(max=${MAX_GOAL_LENGTH}).`,
        artifacts: [],
        verification: ['goal length guardrail'],
        error: 'TOOLS_RUN_CLI_GOAL_TOO_LONG',
      }, 'goal validation failed');
    }

    const runtime = getToolRuntimeStatus();
    const executed = await executeToolByName({
      toolName: toolName || undefined,
      goal: trimmedGoal,
      args: args || {},
      guildId,
      requestedBy,
    });

    return withOpenjarvisRouting({
      ok: executed.ok,
      name: 'tools.run.cli',
      summary: executed.summary,
      artifacts: [
        `tool:${executed.toolName}`,
        ...executed.artifacts,
      ],
      verification: [
        ...executed.verification,
        `registry_configured:${runtime.configured}`,
      ],
      error: executed.error,
      durationMs: executed.durationMs,
    }, executed.ok ? 'configured local cli tool executed' : 'configured local cli tool failed', toolName || executed.toolName);
  },
};