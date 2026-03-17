import type { ActionDefinition } from './types';
import { runDelegatedAction } from './mcpDelegatedAction';

const OPENCODE_TOOL_NAME = String(process.env.MCP_OPENCODE_TOOL_NAME || 'opencode.run').trim() || 'opencode.run';
const MAX_TASK_LENGTH = 2400;

const DANGEROUS_COMMAND_PATTERN = /(\brm\s+-rf\b|\bdel\s+\/f\b|\bformat\b|\bmkfs\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-fd\b)/i;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const toMode = (value: unknown): 'read_only' | 'workspace_write' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'workspace_write') {
    return 'workspace_write';
  }
  return 'read_only';
};

export const opencodeExecuteAction: ActionDefinition = {
  name: 'opencode.execute',
  description: 'Opencode MCP 워커를 통해 샌드박스 터미널 작업을 실행합니다(기본: read_only).',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const task = String(args?.task || goal || '').trim();
    const cwd = toSingleLine(args?.cwd || '');
    const mode = toMode(args?.mode);

    if (!task) {
      return {
        ok: false,
        name: 'opencode.execute',
        summary: '실행할 task가 비어 있습니다.',
        artifacts: [],
        verification: ['task input required'],
        error: 'OPENCODE_TASK_EMPTY',
      };
    }

    if (task.length > MAX_TASK_LENGTH) {
      return {
        ok: false,
        name: 'opencode.execute',
        summary: `task 길이가 너무 깁니다(max=${MAX_TASK_LENGTH}).`,
        artifacts: [],
        verification: ['task length guardrail'],
        error: 'OPENCODE_TASK_TOO_LONG',
      };
    }

    if (DANGEROUS_COMMAND_PATTERN.test(task)) {
      return {
        ok: false,
        name: 'opencode.execute',
        summary: '파괴적 명령어 패턴이 감지되어 실행이 차단되었습니다.',
        artifacts: [toSingleLine(task).slice(0, 220)],
        verification: ['dangerous command guardrail'],
        error: 'OPENCODE_DANGEROUS_COMMAND_BLOCKED',
      };
    }

    const delegated = await runDelegatedAction({
      actionName: 'opencode.execute',
      workerKind: 'opencode',
      toolName: OPENCODE_TOOL_NAME,
      args: {
        task,
        cwd: cwd || undefined,
        mode,
        guildId: guildId || undefined,
        requestedBy: requestedBy || undefined,
      },
      successSummary: (blocks) => {
        const first = toSingleLine(blocks[0] || '').slice(0, 140);
        return first
          ? `Opencode 실행 완료: ${first}`
          : 'Opencode 실행 완료';
      },
      strictFailureSummary: 'Opencode 워커 호출 실패(엄격 모드)',
      strictFailureVerification: ['mcp strict routing', 'opencode delegation failed'],
      strictFailureError: 'OPENCODE_DELEGATION_FAILED',
      onWorkerMissing: () => ({
        ok: false,
        name: 'opencode.execute',
        summary: 'Opencode MCP 워커가 설정되지 않았습니다.',
        artifacts: ['env: MCP_OPENCODE_WORKER_URL'],
        verification: ['opencode worker url missing'],
        error: 'OPENCODE_WORKER_NOT_CONFIGURED',
      }),
      onEmptyResult: () => ({
        ok: false,
        name: 'opencode.execute',
        summary: 'Opencode 실행 결과가 비어 있습니다.',
        artifacts: [],
        verification: ['delegated result empty'],
        error: 'OPENCODE_EMPTY_RESULT',
      }),
    });

    if (!delegated) {
      return {
        ok: false,
        name: 'opencode.execute',
        summary: 'Opencode 워커 호출에 실패했습니다.',
        artifacts: [],
        verification: ['delegation fallback failed'],
        error: 'OPENCODE_EXECUTE_FAILED',
      };
    }

    return delegated;
  },
};
