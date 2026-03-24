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
  description: '?섍꼍蹂?섎줈 ?깅줉???⑥씪 濡쒖뺄 CLI ?꾧뎄瑜??덉쟾???몄옄 ?쒗뵆由우쑝濡??ㅽ뻾?⑸땲??',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const trimmedGoal = String(goal || '').trim();
    const toolName = toSingleLine(args?.toolName || args?.name || '');

    if (!trimmedGoal) {
      return withOperateRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: '?ㅽ뻾??goal??鍮꾩뼱 ?덉뒿?덈떎.',
        artifacts: [],
        verification: ['goal input required'],
        error: 'TOOLS_RUN_CLI_GOAL_EMPTY',
      }, 'goal validation failed');
    }

    if (trimmedGoal.length > MAX_GOAL_LENGTH) {
      return withOperateRouting({
        ok: false,
        name: 'tools.run.cli',
        summary: `goal 湲몄씠媛 ?덈Т 源곷땲??max=${MAX_GOAL_LENGTH}).`,
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
