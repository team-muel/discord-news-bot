import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { CliToolAdapter, ExecuteCliToolInput, ExecuteCliToolResult, RegisteredCliTool } from '../types';

const execFileAsync = promisify(execFile);
const MAX_GOAL_LENGTH = 2_400;

const toSingleLine = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();

const sanitizeCliArg = (value: unknown, maxLen = 400): string => String(value || '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\r?\n/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLen);

const splitOutput = (value: string, maxOutputChars: number, prefix: string): string[] => {
  const normalized = String(value || '').slice(0, maxOutputChars).trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\r?\n/)
    .map((line) => toSingleLine(line))
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => `${prefix}${line}`);
};

const resolveTemplateToken = (token: string, input: ExecuteCliToolInput): string => {
  return token.replace(/\{([^}]+)\}/g, (_match, rawKey: string) => {
    const key = String(rawKey || '').trim();
    if (key === 'goal') {
      return sanitizeCliArg(input.goal, MAX_GOAL_LENGTH);
    }
    if (key === 'guildId') {
      return sanitizeCliArg(input.guildId || '', 120);
    }
    if (key === 'requestedBy') {
      return sanitizeCliArg(input.requestedBy || '', 120);
    }
    if (key.startsWith('arg:')) {
      const argKey = key.slice(4).trim();
      return sanitizeCliArg(input.args?.[argKey], 280);
    }
    return '';
  });
};

const buildCliArgs = (tool: RegisteredCliTool, input: ExecuteCliToolInput): string[] => {
  return tool.argsTemplate
    .map((token) => resolveTemplateToken(token, input))
    .map((token) => sanitizeCliArg(token, MAX_GOAL_LENGTH))
    .filter(Boolean);
};

const buildFailureResult = (
  tool: RegisteredCliTool,
  durationMs: number,
  error: unknown,
): ExecuteCliToolResult => {
  const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string; signal?: string };
  const exitCode = typeof execError.code === 'number' ? execError.code : null;
  const stderrArtifacts = splitOutput(execError.stderr || '', tool.maxOutputChars, '[stderr] ');
  const stdoutArtifacts = splitOutput(execError.stdout || '', tool.maxOutputChars, '[stdout] ');
  const signal = toSingleLine(execError.signal || '');
  const message = toSingleLine(execError.message || 'CLI execution failed');

  return {
    ok: false,
    toolName: tool.name,
    summary: signal
      ? `CLI tool ${tool.name} failed with signal ${signal}`
      : exitCode !== null
        ? `CLI tool ${tool.name} failed with exit code ${exitCode}`
        : `CLI tool ${tool.name} execution failed`,
    artifacts: [message, ...stderrArtifacts, ...stdoutArtifacts].filter(Boolean),
    verification: [`adapter:${tool.adapterId}`, `command:${basename(tool.command) || tool.command}`, 'cli execution failed'],
    error: 'LOCAL_CLI_TOOL_EXECUTION_FAILED',
    durationMs,
    adapterId: tool.adapterId,
    exitCode,
  };
};

export const scriptCliToolAdapter: CliToolAdapter = {
  id: 'script-cli',
  isAvailable: (tool) => tool.command.length > 0,
  execute: async (tool, input) => {
    const startedAt = Date.now();
    const args = buildCliArgs(tool, input);
    if (!input.goal.trim()) {
      return {
        ok: false,
        toolName: tool.name,
        summary: 'CLI tool goal is empty.',
        artifacts: [],
        verification: ['goal input required'],
        error: 'LOCAL_CLI_TOOL_GOAL_EMPTY',
        durationMs: Date.now() - startedAt,
        adapterId: tool.adapterId,
        exitCode: null,
      };
    }

    if (input.goal.trim().length > MAX_GOAL_LENGTH) {
      return {
        ok: false,
        toolName: tool.name,
        summary: `CLI tool goal is too long (max=${MAX_GOAL_LENGTH}).`,
        artifacts: [],
        verification: ['goal length guardrail'],
        error: 'LOCAL_CLI_TOOL_GOAL_TOO_LONG',
        durationMs: Date.now() - startedAt,
        adapterId: tool.adapterId,
        exitCode: null,
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(tool.command, args, {
        timeout: tool.timeoutMs,
        windowsHide: true,
        maxBuffer: 512 * 1024,
      });
      const durationMs = Date.now() - startedAt;
      const stdoutArtifacts = splitOutput(String(stdout || ''), tool.maxOutputChars, '[stdout] ');
      const stderrArtifacts = splitOutput(String(stderr || ''), tool.maxOutputChars, '[stderr] ');
      const firstLine = toSingleLine(stdoutArtifacts[0] || stderrArtifacts[0] || '').slice(0, 140);

      return {
        ok: true,
        toolName: tool.name,
        summary: firstLine ? `CLI tool ${tool.name} executed: ${firstLine}` : `CLI tool ${tool.name} executed successfully`,
        artifacts: [...stdoutArtifacts, ...stderrArtifacts],
        verification: [`adapter:${tool.adapterId}`, `command:${basename(tool.command) || tool.command}`, `args:${args.length}`],
        durationMs,
        adapterId: tool.adapterId,
        exitCode: 0,
      };
    } catch (error) {
      return buildFailureResult(tool, Date.now() - startedAt, error);
    }
  },
};