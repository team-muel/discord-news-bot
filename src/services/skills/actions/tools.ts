import { executeToolByName, getToolRuntimeStatus } from '../../tools/toolRouter';
import type { ActionDefinition, ActionExecutionResult } from './types';

const MAX_GOAL_LENGTH = 2_400;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const withOperateRouting = (
  result: ActionExecutionResult,
  reason: string,
  evidenceId?: string,
): ActionExecutionResult => {
  return {
    ...result,
    agentRole: 'operate',
    handoff: {
      fromAgent: 'operate',
      toAgent: 'operate',
      reason,
      evidenceId,
    },
  };
};

export const toolsRunCliAction: ActionDefinition = {
  name: 'tools.run.cli',
  description: '설정된 로컬 CLI 도구를 안전한 샌드박스 환경에서 실행합니다.',
  category: 'tool',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const trimmedGoal = String(goal || '').trim();
    const toolName = toSingleLine(args?.toolName || args?.name || '');

    if (!trimmedGoal) {
      return withOperateRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: '실행할 goal이 비어 있습니다.',
        artifacts: [],
        verification: ['goal input required'],
        error: 'TOOLS_RUN_CLI_GOAL_EMPTY',
      }, 'goal validation failed');
    }

    if (trimmedGoal.length > MAX_GOAL_LENGTH) {
      return withOperateRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: `goal 길이가 너무 깁니다 (max=${MAX_GOAL_LENGTH}).`,
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

    return withOperateRouting({
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
