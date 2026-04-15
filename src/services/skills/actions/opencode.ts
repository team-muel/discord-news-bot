import {
  EXECUTOR_ACTION_CANONICAL_NAME,
  type ActionDefinition,
  type ActionExecutionResult,
} from './types';
import { runDelegatedAction } from './mcpDelegatedAction';
import { runExternalAction, getExternalAdapterById } from '../../tools/toolRouter';
import logger from '../../../logger';
import {
  MCP_OPENCODE_TOOL_NAME as OPENCODE_TOOL_NAME,
  OPENSHELL_SANDBOX_DELEGATION,
  OPENSHELL_DEFAULT_SANDBOX_ID,
  OPENSHELL_DEFAULT_SANDBOX_IMAGE,
} from '../../../config';
const MAX_TASK_LENGTH = 2400;
const MAX_SPRINT_TASK_LENGTH = 12_000;

const DANGEROUS_COMMAND_PATTERN = /(?:\brm\s+-rf\b|\bdel\s+\/f\b|\bformat\b|\bmkfs\b|\bshutdown\b|\breboot\b|\bpoweroff\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-fd\b|\bRemove-Item\b\s+.*-Recurse|\bStop-Computer\b|\bRestart-Computer\b)/i;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const resolveTaskLengthLimit = (task: string): number => {
  return task.includes('[SPRINT]') ? MAX_SPRINT_TASK_LENGTH : MAX_TASK_LENGTH;
};

const resolveSafetyCheckText = (task: string): string => {
  if (!task.includes('[SPRINT]')) {
    return task;
  }

  const objectiveMatch = task.match(/\[OBJECTIVE\]\s*([\s\S]*?)(?:\n\[[A-Z_]+\]|$)/);
  return (objectiveMatch?.[1] || task).trim();
};

const withOpencodeRouting = (
  result: ActionExecutionResult,
  reason: string,
  evidenceId?: string,
): ActionExecutionResult => {
  return {
    ...result,
    agentRole: 'implement',
    handoff: {
      fromAgent: 'operate',
      toAgent: 'implement',
      reason,
      evidenceId,
    },
  };
};

const toMode = (value: unknown): 'read_only' | 'workspace_write' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'workspace_write') {
    return 'workspace_write';
  }
  return 'read_only';
};

export const opencodeExecuteAction: ActionDefinition = {
  name: EXECUTOR_ACTION_CANONICAL_NAME,
  description: 'Canonical implement.execute executor action. Legacy alias opencode.execute 도 지원하며, Opencode MCP 워커를 통해 샌드박스 터미널 작업을 실행합니다(기본: read_only).',
  category: 'code',
  execute: async ({ goal, args, guildId, requestedBy }) => {
    const task = String(args?.task || goal || '').trim();
    const taskLengthLimit = resolveTaskLengthLimit(task);
    const safetyCheckText = resolveSafetyCheckText(task);
    const cwd = toSingleLine(args?.cwd || '');
    const mode = toMode(args?.mode);

    if (!task) {
      return withOpencodeRouting({
        ok: false,
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: '실행할 task가 비어 있습니다.',
        artifacts: [],
        verification: ['task input required'],
        error: 'OPENCODE_TASK_EMPTY',
      }, 'task validation failed');
    }

    if (task.length > taskLengthLimit) {
      return withOpencodeRouting({
        ok: false,
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: `task 길이가 너무 깁니다(max=${taskLengthLimit}).`,
        artifacts: [],
        verification: ['task length guardrail'],
        error: 'OPENCODE_TASK_TOO_LONG',
      }, 'task validation failed');
    }

    if (DANGEROUS_COMMAND_PATTERN.test(safetyCheckText)) {
      return withOpencodeRouting({
        ok: false,
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: '파괴적 명령어 패턴이 감지되어 실행이 차단되었습니다.',
        artifacts: [toSingleLine(safetyCheckText).slice(0, 220)],
        verification: ['dangerous command guardrail'],
        error: 'OPENCODE_DANGEROUS_COMMAND_BLOCKED',
      }, 'task validation failed');
    }

    // D-05: OpenShell sandbox delegation — when enabled, route execution through sandboxed environment
    if (OPENSHELL_SANDBOX_DELEGATION && OPENSHELL_DEFAULT_SANDBOX_ID) {
      const adapter = getExternalAdapterById('openshell');
      if (adapter) {
        const available = await adapter.isAvailable();
        if (available) {
          // Verify sandbox exists; auto-create if missing (D-05 gap closure)
          const listResult = await runExternalAction('openshell', 'sandbox.list', {});
          const sandboxExists = listResult.ok && listResult.output.some((line) => line.includes(OPENSHELL_DEFAULT_SANDBOX_ID));
          if (!sandboxExists) {
            logger.info('[OPENCODE] sandbox=%s not found, attempting auto-create', OPENSHELL_DEFAULT_SANDBOX_ID);
            const createResult = await runExternalAction('openshell', 'sandbox.create', {
              from: OPENSHELL_DEFAULT_SANDBOX_IMAGE,
              name: OPENSHELL_DEFAULT_SANDBOX_ID,
            });
            if (!createResult.ok) {
              logger.warn('[OPENCODE] sandbox auto-create failed: %s, falling through to MCP', createResult.error);
              // Fall through to MCP delegation below
            }
          }

          logger.info('[OPENCODE] routing implement.execute through OpenShell sandbox=%s', OPENSHELL_DEFAULT_SANDBOX_ID);
          const sandboxResult = await runExternalAction('openshell', 'sandbox.exec', {
            sandboxId: OPENSHELL_DEFAULT_SANDBOX_ID,
            command: task,
            mode,
          });
          return withOpencodeRouting({
            ok: sandboxResult.ok,
            name: EXECUTOR_ACTION_CANONICAL_NAME,
            summary: sandboxResult.ok
              ? `OpenShell sandbox 실행 완료: ${sandboxResult.output[0]?.slice(0, 140) || 'done'}`
              : `OpenShell sandbox 실행 실패: ${sandboxResult.summary}`,
            artifacts: sandboxResult.output.slice(0, 10),
            verification: ['openshell sandbox delegation', sandboxResult.ok ? 'sandbox exec success' : 'sandbox exec failed'],
            error: sandboxResult.ok ? undefined : sandboxResult.error,
            durationMs: sandboxResult.durationMs,
          }, `openshell sandbox delegation (sandbox=${OPENSHELL_DEFAULT_SANDBOX_ID})`);
        } else {
          logger.debug('[OPENCODE] OpenShell sandbox unavailable, falling back to direct execution sandbox=%s', OPENSHELL_DEFAULT_SANDBOX_ID);
        }
      } else {
        logger.debug('[OPENCODE] OpenShell adapter not registered, falling back to direct execution');
      }
    }

    const delegated = await runDelegatedAction({
      actionName: EXECUTOR_ACTION_CANONICAL_NAME,
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
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: 'Opencode MCP 워커가 설정되지 않았습니다.',
        artifacts: ['env: MCP_IMPLEMENT_WORKER_URL', 'legacy env: MCP_OPENCODE_WORKER_URL'],
        verification: ['opencode worker url missing'],
        error: 'OPENCODE_WORKER_NOT_CONFIGURED',
      }),
      onEmptyResult: () => ({
        ok: false,
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: 'Opencode 실행 결과가 비어 있습니다.',
        artifacts: [],
        verification: ['delegated result empty'],
        error: 'OPENCODE_EMPTY_RESULT',
      }),
    });

    if (!delegated) {
      // ── OpenShell sandbox fallback: try running task in sandboxed environment ──
      const sandboxResult = await runExternalAction('openshell', 'sandbox.list');
      if (sandboxResult.ok && sandboxResult.output.length > 0) {
        return withOpencodeRouting({
          ok: false,
          name: EXECUTOR_ACTION_CANONICAL_NAME,
          summary: 'MCP 워커 불가 — OpenShell sandbox 사용 가능하나 자동 실행은 아직 지원되지 않습니다.',
          artifacts: [`available_sandboxes: ${sandboxResult.output.slice(0, 3).join(', ')}`],
          verification: ['mcp delegation failed', 'openshell sandbox available'],
          error: 'OPENCODE_SANDBOX_FALLBACK_PENDING',
        }, 'openshell sandbox fallback (execution pending)');
      }

      return withOpencodeRouting({
        ok: false,
        name: EXECUTOR_ACTION_CANONICAL_NAME,
        summary: 'Opencode 워커 호출에 실패했습니다.',
        artifacts: [],
        verification: ['delegation fallback failed'],
        error: 'OPENCODE_EXECUTE_FAILED',
      }, 'mcp delegation failed');
    }

    return withOpencodeRouting(
      delegated,
      delegated.ok ? 'delegated opencode execution finished' : 'delegated opencode execution failed',
      OPENCODE_TOOL_NAME,
    );
  },
};
